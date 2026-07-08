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
  const { template_id, client_id, overrides, local, data } = body || {};
  if (!template_id || !client_id) return jsonError("template_id e client_id s\u00e3o obrigat\u00f3rios", 400);

  const tpl = await env.DB.prepare("SELECT * FROM procuracao_templates WHERE id = ?").bind(template_id).first();
  if (!tpl) return jsonError("Modelo n\u00e3o encontrado", 404);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(client_id).first();
  if (!client) return jsonError("Cliente n\u00e3o encontrado", 404);

  // valores: dados do cliente + overrides (campos editáveis, ex.: poderes)
  const valores = { ...valoresDoCliente(client), ...(overrides || {}) };
  const texto = preencherTemplate(tpl.corpo, valores);

  if (!comoPDF) {
    return jsonResponse({ texto, campos_editaveis: JSON.parse(tpl.campos_editaveis || "[]"), nome_outorgante: client.name });
  }

  const bytes = await generateProcuracaoPDF({
    texto,
    local: local || "Santa Maria da Feira",
    data: data || new Date().toISOString(),
    nomeOutorgante: client.name,
    // nomes das partes a negrito no corpo (como no documento original do escritório)
    boldSegments: [client.name, client.rep_name, "Vyvian Avena", "Juliana Santos"].filter(Boolean),
  });
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="procuracao-${client.id}.pdf"`,
      ...CORS,
    },
  });
}
