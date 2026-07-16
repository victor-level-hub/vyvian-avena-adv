// worker/routes/procuracoes.js
//   GET  /api/procuracoes/templates            -> lista de modelos ativos
//   POST /api/procuracoes/preview              -> { texto } preenchido (para a UI mostrar/editar)
//   POST /api/procuracoes/gerar                -> PDF da procuração
import { jsonResponse, jsonError } from "../lib/response.js";
import { generateProcuracaoPDF, preencherTemplate, valoresDoCliente } from "../lib/procgen.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function handleProcuracoes(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','procuracoes', sub]
  const sub = segments[2];

  if (sub === "templates" && request.method === "GET") {
    const r = await env.DB.prepare(
      "SELECT id, nome, country, categoria, corpo, campos_editaveis FROM procuracao_templates WHERE ativo = 1 ORDER BY categoria, nome"
    ).all();
    return jsonResponse({ templates: r.results });
  }

  if (sub === "preview" && request.method === "POST") {
    return montarTexto(request, env, false);
  }
  if (sub === "gerar" && request.method === "POST") {
    return montarTexto(request, env, true);
  }
  return jsonError("Not found", 404);
}

async function montarTexto(request, env, comoPDF) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON", 400); }
  const { template_id, client_id, overrides, local, data, person_id } = body || {};
  if (!template_id || !client_id) return jsonError("template_id e client_id s\u00e3o obrigat\u00f3rios", 400);

  const tpl = await env.DB.prepare("SELECT * FROM procuracao_templates WHERE id = ?").bind(template_id).first();
  if (!tpl) return jsonError("Modelo n\u00e3o encontrado", 404);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(client_id).first();
  if (!client) return jsonError("Cliente n\u00e3o encontrado", 404);

  // Outorgante: por defeito o titular (tabela `clients`); com person_id de uma
  // pessoa adicional, a procuração é preenchida com os dados DESSA pessoa
  // (client_people tem os mesmos campos pessoais).
  let outorgante = client;
  let sufixo = "";
  if (person_id && person_id !== client_id) {
    const p = await env.DB.prepare(
      "SELECT * FROM client_people WHERE id = ? AND client_id = ?"
    ).bind(person_id, client_id).first();
    if (!p) return jsonError("Pessoa n\u00e3o encontrada neste cliente", 404);
    outorgante = pessoaComoOutorgante(p);
    sufixo = `-pes${p.position || 2}`;
  }

  // valores: dados do outorgante + overrides (campos editáveis, ex.: poderes)
  const valores = { ...valoresDoCliente(outorgante), ...(overrides || {}) };
  const texto = preencherTemplate(tpl.corpo, valores);

  if (!comoPDF) {
    return jsonResponse({ texto, campos_editaveis: JSON.parse(tpl.campos_editaveis || "[]"), poderes_default: tpl.poderes_default || null, nome_outorgante: outorgante.name });
  }

  const bytes = await generateProcuracaoPDF({
    texto,
    local: local || "Santa Maria da Feira",
    data: data || new Date().toISOString(),
    nomeOutorgante: outorgante.name,
    // nomes das partes a negrito no corpo (como no documento original do escritório)
    boldSegments: [outorgante.name, client.rep_name, "Vyvian Avena", "Juliana Santos"].filter(Boolean),
  });
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="procuracao-${client.id}${sufixo}.pdf"`,
      ...CORS,
    },
  });
}

// Só os campos que o template usa (ver valoresDoCliente): evita herdar dados do
// titular numa procuração que é de outra pessoa.
function pessoaComoOutorgante(p) {
  return {
    name: p.name,
    marital_status: p.marital_status,
    nationality: p.nationality,
    address: p.address,
    birth_place: p.birth_place,
    birth_date: p.birth_date,
    identification: p.identification,
    niss: p.niss,
    doc_type: p.doc_type,
    doc_number: p.doc_number,
    doc_validity: p.doc_validity,
    // As pessoas adicionais guardam pai/mãe em campos separados e não têm a
    // filiação composta (o titular compõe-na no cadastro) — sem isto, o
    // {{filiacao}} da procuração saía como [•] com os nomes já registados.
    filiation: p.filiation || [p.father_name, p.mother_name].filter(Boolean).join(" e ") || null,
  };
}
