// worker/routes/extracao.js
// POST /api/cadastro/extrair-documento
//   Recebe: image/jpeg|image/png|application/pdf (binário)
//   Chama Claude Haiku 4.5 com visão para extrair os campos do documento.
//   Devolve: { ok, fields: {...}, raw, usage }
//
// O modelo recebe a imagem + um prompt pedindo JSON estruturado.
// Não armazenamos o documento — fica só no pedido.
import { jsonResponse, jsonError } from "../lib/response.js";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (limite seguro abaixo do limite do Claude)

const SCHEMA = `{
  "doc_type": "Título de Residência" | "Cartão de Cidadão" | "Passaporte" | "BI/RG" | null,
  "doc_number": "string ou null",
  "doc_validity": "YYYY-MM-DD ou null (data de validade)",
  "name": "string (nome completo, em maiúsculas/minúsculas naturais)",
  "birth_date": "YYYY-MM-DD ou null",
  "birth_place": "string ou null (cidade, distrito/estado, país)",
  "nationality": "string ou null (ex.: 'portuguesa', 'brasileira')",
  "identification": "string ou null (NIF / contribuinte fiscal — se visível)",
  "niss": "string ou null (Número de Identificação da Segurança Social, se visível)",
  "filiation": "string ou null (nome do pai e/ou da mãe, se visíveis)",
  "marital_status": "string ou null",
  "country": "PT" | "BR" | null
}`;

const PROMPT =
`Recebes a imagem de um documento de identificação (Título de Residência português, Cartão de Cidadão, Passaporte, RG/BI ou similar) para registo de cliente num escritório de advocacia.

Extrai os campos visíveis e devolve EXCLUSIVAMENTE JSON válido com esta estrutura (sem markdown, sem texto antes ou depois):

${SCHEMA}

Regras:
- Datas SEMPRE em formato ISO YYYY-MM-DD.
- Se um campo não estiver visível ou não fizer sentido, devolve null (não inventes).
- Nome em capitalização natural (não em MAIÚSCULAS gritantes), salvo se for assim no documento.
- "country": "PT" se for documento português ou indicar Portugal; "BR" se brasileiro; null se ambíguo.
- "doc_type": escolhe a etiqueta mais próxima da lista; "Título de Residência" para títulos portugueses para estrangeiros.
- Não incluas comentários nem campos extra. SÓ o objeto JSON.`;

export async function handleExtracao(request, env, path, session) {
  if (request.method !== "POST") return jsonError("Method not allowed", 405);
  if (!env.ANTHROPIC_API_KEY) return jsonError("Servi\u00e7o de extra\u00e7\u00e3o n\u00e3o configurado.", 503);

  const ct = (request.headers.get("content-type") || "").toLowerCase();
  const tipoAnthropic =
    ct.includes("image/png") ? { type: "image", media_type: "image/png" } :
    ct.includes("image/jpeg") || ct.includes("image/jpg") ? { type: "image", media_type: "image/jpeg" } :
    ct.includes("image/webp") ? { type: "image", media_type: "image/webp" } :
    ct.includes("application/pdf") ? { type: "document", media_type: "application/pdf" } :
    null;
  if (!tipoAnthropic) return jsonError("Tipo n\u00e3o suportado. Use PNG/JPEG/WEBP ou PDF.", 415);

  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return jsonError("Ficheiro vazio.", 400);
  if (buf.byteLength > MAX_BYTES) return jsonError("Ficheiro demasiado grande (m\u00e1x. 8 MB).", 413);

  // base64 do binário (em chunks para ficheiros maiores)
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  const b64 = btoa(bin);

  const body = {
    model: "claude-haiku-4-5",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: [
        {
          type: tipoAnthropic.type,
          source: { type: "base64", media_type: tipoAnthropic.media_type, data: b64 },
        },
        { type: "text", text: PROMPT },
      ],
    }],
  };

  const ar = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!ar.ok) {
    const errTxt = await ar.text();
    return jsonError(`API Anthropic: ${ar.status} ${errTxt.slice(0, 200)}`, 502);
  }
  const data = await ar.json();
  const raw = (data.content || []).map(c => c.text || "").join("").trim();

  // tentar parsear JSON; se vier dentro de ```json ... ```, tirar fences
  let fields = null;
  let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { fields = JSON.parse(cleaned); }
  catch (e) {
    return jsonResponse({ ok: false, error: "Resposta da IA n\u00e3o pôde ser interpretada", raw, usage: data.usage }, 200);
  }

  return jsonResponse({ ok: true, fields, usage: data.usage });
}
