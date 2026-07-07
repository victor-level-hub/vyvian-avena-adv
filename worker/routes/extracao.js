// worker/routes/extracao.js
// POST /api/cadastro/extrair-documento
//   Recebe: image/jpeg|image/png|image/webp|application/pdf (binário)
//   Chama o Gemini 2.5 Pro com visão para extrair os campos do documento.
//   Devolve: { ok, fields: {...}, raw, usage }
//
// O modelo recebe a imagem + um prompt pedindo JSON estruturado.
// Não armazenamos o documento — fica só no pedido.
import { jsonResponse, jsonError } from "../lib/response.js";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (limite seguro para envio inline ao Gemini)

const SCHEMA = `{
  "person_type": "singular" | "coletiva",
  "name": "string (pessoa singular: nome completo; pessoa coletiva: denominação da EMPRESA)",
  "identification": "string ou null (singular: NIF/CPF; coletiva: NIPC/CNPJ da empresa)",
  "address": "string ou null (singular: morada, se visível; coletiva: SEDE da empresa)",
  "duns": "string ou null (número DUNS da empresa, se visível)",
  "rep_name": "string ou null (coletiva: nome completo do representante legal)",
  "rep_role": "string ou null (coletiva: cargo do representante, ex.: 'sócio-gerente', 'administrador')",
  "doc_type": "Título de Residência" | "Cartão de Cidadão" | "Passaporte" | "BI/RG" | null,
  "doc_number": "string ou null (coletiva: documento do REPRESENTANTE)",
  "doc_validity": "YYYY-MM-DD ou null (data de validade)",
  "birth_date": "YYYY-MM-DD ou null",
  "birth_place": "string ou null (cidade, distrito/estado, país)",
  "nationality": "string ou null (ex.: 'portuguesa', 'brasileira')",
  "niss": "string ou null (Número de Identificação da Segurança Social, se visível)",
  "filiation": "string ou null (nome do pai e/ou da mãe, se visíveis)",
  "marital_status": "string ou null",
  "country": "PT" | "BR" | null,
  "process_summary": "string ou null (resumo do processo/caso jurídico, se o documento contiver essa informação)"
}`;

const PROMPT =
`Recebes um documento para registo de cliente num escritório de advocacia. Pode ser:
(a) um documento de identificação pessoal (Título de Residência português, Cartão de Cidadão, Passaporte, RG/BI ou similar),
(b) um documento societário/legal (procuração, certidão permanente, contrato) onde o cliente é uma EMPRESA (pessoa coletiva), ou
(c) um documento sobre o CASO/PROCESSO do cliente (e-mail, participação de sinistro, citação, contrato em disputa, sentença…).

Extrai os campos visíveis e devolve EXCLUSIVAMENTE JSON válido com esta estrutura (sem markdown, sem texto antes ou depois):

${SCHEMA}

Regras:
- "person_type": "coletiva" se o cliente/outorgante for uma empresa (Lda, Unipessoal, SA, etc.); caso contrário "singular".
- Pessoa COLETIVA: "name" = denominação da empresa; "identification" = NIPC/CNPJ; "address" = sede; "duns" se visível; "rep_name"/"rep_role" = representante legal e cargo (ex.: sócio-gerente); "doc_type"/"doc_number"/"doc_validity" e restantes campos pessoais referem-se ao REPRESENTANTE, se visíveis.
- Pessoa SINGULAR: "rep_name"/"rep_role"/"duns" = null.
- Datas SEMPRE em formato ISO YYYY-MM-DD.
- Se um campo não estiver visível ou não fizer sentido, devolve null (não inventes).
- Nome em capitalização natural (não em MAIÚSCULAS gritantes), salvo se for assim no documento.
- "country": "PT" se for documento português ou indicar Portugal; "BR" se brasileiro; null se ambíguo.
- "doc_type": escolhe a etiqueta mais próxima da lista; "Título de Residência" para títulos portugueses para estrangeiros.
- "process_summary": se o documento contiver informação sobre o caso/processo (factos, datas, partes, valores, pedidos), escreve um resumo objetivo em português (5-10 frases, prosa corrida, sem markdown) útil para um advogado: o que aconteceu, quando, quem está envolvido, valores em causa, estado atual e próximos passos se visíveis. Documentos de identificação puros => null.
- Não incluas comentários nem campos extra. SÓ o objeto JSON.`;

// Instrução extra quando já existe um resumo do processo: fundir em vez de substituir.
const MERGE_NOTE = (atual) =>
`\n\nNOTA: já existe o seguinte resumo do processo deste cliente:
---
${atual}
---
Se este documento acrescentar informação relevante ao caso, devolve em "process_summary" uma versão MELHORADA que integre o resumo existente com os factos novos (sem perder informação, sem duplicar, mantendo prosa corrida). Se o documento não acrescentar nada ao caso, devolve "process_summary": null.`;

export async function handleExtracao(request, env, path, session) {
  if (request.method !== "POST") return jsonError("Method not allowed", 405);
  if (!env.GEMINI_API_KEY) return jsonError("Servi\u00e7o de extra\u00e7\u00e3o n\u00e3o configurado.", 503);

  const ct = (request.headers.get("content-type") || "").toLowerCase();
  const geminiMime =
    ct.includes("image/png") ? "image/png" :
    ct.includes("image/jpeg") || ct.includes("image/jpg") ? "image/jpeg" :
    ct.includes("image/webp") ? "image/webp" :
    ct.includes("application/pdf") ? "application/pdf" :
    null;
  if (!geminiMime) return jsonError("Tipo n\u00e3o suportado. Use PNG/JPEG/WEBP ou PDF.", 415);

  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return jsonError("Ficheiro vazio.", 400);
  if (buf.byteLength > MAX_BYTES) return jsonError("Ficheiro demasiado grande (m\u00e1x. 8 MB).", 413);

  // base64 do binário (em chunks para ficheiros maiores)
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  const b64 = btoa(bin);

  // resumo do processo já existente (opcional) — enviado pelo frontend para melhoria incremental
  let resumoAtual = "";
  const rh = request.headers.get("x-resumo-atual");
  if (rh) {
    try { resumoAtual = decodeURIComponent(rh).slice(0, 6000); } catch { resumoAtual = ""; }
  }
  const promptFinal = resumoAtual ? PROMPT + MERGE_NOTE(resumoAtual) : PROMPT;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: geminiMime, data: b64 } },
        { text: promptFinal },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json", // força JSON limpo (sem fences markdown)
      maxOutputTokens: 4096,                 // folga p/ thinking + resumo do processo
    },
  };

  const ar = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!ar.ok) {
    const errTxt = await ar.text();
    return jsonError(`API Gemini: ${ar.status} ${errTxt.slice(0, 200)}`, 502);
  }
  const data = await ar.json();
  const cand = (data.candidates || [])[0] || {};
  const raw = ((cand.content && cand.content.parts) || []).map(p => p.text || "").join("").trim();

  // normaliza usage para o formato que o frontend espera (input_tokens/output_tokens)
  const um = data.usageMetadata || {};
  const usage = { input_tokens: um.promptTokenCount || 0, output_tokens: um.candidatesTokenCount || 0 };

  // tentar parsear JSON; se vier dentro de ```json ... ```, tirar fences
  let fields = null;
  let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { fields = JSON.parse(cleaned); }
  catch (e) {
    return jsonResponse({ ok: false, error: "Resposta da IA n\u00e3o pôde ser interpretada", raw, usage }, 200);
  }

  return jsonResponse({ ok: true, fields, usage });
}
