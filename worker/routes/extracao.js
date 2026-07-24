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
  "identification": "string ou null (singular: NIF/CPF; coletiva: NIFC/CNPJ da empresa)",
  "address": "string ou null (morada completa numa linha; coletiva: SEDE da empresa)",
  "address_parts": "objeto ou null — morada decomposta: { \\"country\\": \\"PT\\"|\\"BR\\", \\"via_type\\": \\"Rua|Avenida|Travessa|…\\", \\"via_name\\": string, \\"number\\": string, \\"complement\\": string ou null, e se PT: \\"freguesia\\", \\"concelho\\", \\"distrito\\", \\"cp\\"; se BR: \\"bairro\\", \\"cidade\\", \\"estado\\", \\"cep\\" }",
  "duns": "string ou null (número DUNS da empresa, se visível)",
  "rep_name": "string ou null (coletiva: nome completo do responsável/representante legal)",
  "rep_role": "string ou null (coletiva: cargo do responsável, ex.: 'sócio-gerente', 'administrador')",
  "rep_nif": "string ou null (coletiva: NIF/CPF pessoal do responsável, se visível)",
  "rep_nationality": "string ou null (coletiva: nacionalidade do responsável)",
  "rep_address_parts": "objeto ou null (coletiva: morada PESSOAL do responsável, mesma estrutura de address_parts — só se distinta da sede)",
  "doc_type": "Título de Residência" | "Cartão de Cidadão" | "Passaporte" | "BI/RG" | null,
  "doc_number": "string ou null (coletiva: documento do REPRESENTANTE)",
  "doc_validity": "YYYY-MM-DD ou null (data de validade)",
  "birth_date": "YYYY-MM-DD ou null",
  "birth_place": "string ou null (cidade, distrito/estado, país)",
  "nationality": "string ou null (ex.: 'portuguesa', 'brasileira')",
  "niss": "string ou null (Número de Identificação da Segurança Social, se visível)",
  "father_name": "string ou null (nome do pai, se visível)",
  "mother_name": "string ou null (nome da mãe, se visível)",
  "marital_status": "string ou null",
  "country": "PT" | "BR" | null,
  "email": "string ou null (e-mail do CLIENTE — pessoa ou empresa)",
  "phone": "string ou null (telefone do CLIENTE, com indicativo se visível)",
  "process_summary": "string ou null (resumo do processo/caso jurídico, se o documento contiver essa informação)",
  "process_ref": "string ou null (número/referência do processo, se visível — ex.: '1102202200157325', '1289/26')",
  "process_match": "número ou null (índice do processo EXISTENTE a que este documento pertence — só quando a NOTA final listar processos; caso contrário null)",
  "practice_area": "Família" | "Cível" | "Trabalhista" | "Empresarial" | "Nacionalidade" | "Administrativo" | "Criminal" | null
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
- Pessoa COLETIVA: "name" = denominação da empresa; "identification" = NIFC/CNPJ da empresa; "address"/"address_parts" = SEDE; "duns" se visível; "rep_name"/"rep_role"/"rep_nif"/"rep_nationality" = dados do responsável; "doc_type"/"doc_number"/"doc_validity", "birth_date", "birth_place", "marital_status", "niss", "father_name", "mother_name" referem-se ao RESPONSÁVEL, se visíveis.
- Pessoa SINGULAR: "rep_name"/"rep_role"/"rep_nif"/"rep_nationality"/"rep_address_parts"/"duns" = null.
- "address_parts": decompõe a morada nos componentes; via_type é só o tipo (Rua, Avenida, Travessa…), via_name é o nome sem o tipo. Códigos postais PT no formato "9999-999"; CEP BR "99999-999". Componente não visível => null/omitir.
- Datas SEMPRE em formato ISO YYYY-MM-DD.
- Se um campo não estiver visível ou não fizer sentido, devolve null (não inventes).
- Nome em capitalização natural (não em MAIÚSCULAS gritantes), salvo se for assim no documento.
- "country": "PT" se for documento português ou indicar Portugal; "BR" se brasileiro; null se ambíguo.
- "doc_type": escolhe a etiqueta mais próxima da lista; "Título de Residência" para títulos portugueses para estrangeiros.
- "email"/"phone": APENAS os contactos do próprio CLIENTE (a pessoa ou a empresa cliente do escritório). Num e-mail ou carta há contactos de várias partes — IGNORA os de advogados (ex.: domínios @adv.oa.pt), peritos, seguradoras, tribunais e outros terceiros. Se não conseguires distinguir com confiança, devolve null.
- "process_summary": se o documento contiver informação sobre o caso/processo (factos, datas, partes, valores, pedidos), escreve um resumo objetivo em português (5-10 frases, prosa corrida, sem markdown) útil para um advogado: o que aconteceu, quando, quem está envolvido, valores em causa, estado atual e próximos passos se visíveis. Documentos de identificação puros => null. Inclui referências de processo/apólice/sinistro se visíveis.
- "practice_area": classifica a área de atuação do caso a partir do conteúdo do documento, escolhendo APENAS uma das etiquetas da lista. Exemplos: divórcio, partilhas, responsabilidades parentais => "Família"; processos do Instituto da Segurança Social, reversão fiscal, contencioso com entidades públicas, licenciamentos => "Administrativo"; contratos, responsabilidade civil, sinistros, cobranças => "Cível"; despedimento, contrato de trabalho => "Trabalhista"; sociedades, quotas, insolvência de empresas => "Empresarial"; nacionalidade portuguesa, vistos, residência => "Nacionalidade"; crimes, queixas-crime, defesa penal => "Criminal". Documentos de identificação puros ou casos ambíguos => null.
- Não incluas comentários nem campos extra. SÓ o objeto JSON.`;

// Instrução extra quando o cadastro já tem processos: a IA decide se o documento
// pertence a um processo existente (funde o resumo) ou é um processo NOVO.
const PROCESSOS_NOTE = (lista) =>
`\n\nNOTA: o cliente já tem ${lista.length} processo(s) registado(s) no cadastro:
${lista.map((p, i) => `[${i}] ref: ${p.ref || "(sem ref)"} · área: ${p.area || "?"} · resumo: ${p.resumo ? p.resumo.slice(0, 900) : "(vazio)"}`).join("\n")}

Decide a que processo pertence este documento:
- Se pertencer a um processo EXISTENTE (mesmo número de processo, ou mesmas partes e assunto), devolve "process_match" com o índice desse processo e, em "process_summary", uma versão MELHORADA que integre o resumo existente com os factos novos (sem perder informação, sem duplicar, prosa corrida).
- Se for um processo DIFERENTE dos listados (número novo, assunto distinto), devolve "process_match": null, "process_ref" com o número/referência se visível, "practice_area" com a área desse novo caso, e em "process_summary" um resumo APENAS deste novo processo.
- Se o documento não contiver informação de processo (ex.: documento de identificação puro), devolve "process_match": null e "process_summary": null.`;

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

  // Texto colado pelo utilizador (modal "Ler com IA"): segue o mesmo fluxo,
  // mas como parte textual em vez de inline_data.
  let textoColado = null;
  if (ct.includes("text/plain")) {
    textoColado = (await request.text()).trim();
    if (!textoColado) return jsonError("Texto vazio.", 400);
    if (textoColado.length > 30000) return jsonError("Texto demasiado longo (m\u00e1x. 30 000 caracteres).", 413);
  }

  const geminiMime =
    ct.includes("image/png") ? "image/png" :
    ct.includes("image/jpeg") || ct.includes("image/jpg") ? "image/jpeg" :
    ct.includes("image/webp") ? "image/webp" :
    ct.includes("application/pdf") ? "application/pdf" :
    null;
  if (!geminiMime && textoColado === null) return jsonError("Tipo n\u00e3o suportado. Use PNG/JPEG/WEBP, PDF ou texto.", 415);

  let b64 = null;
  if (textoColado === null) {
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength === 0) return jsonError("Ficheiro vazio.", 400);
    if (buf.byteLength > MAX_BYTES) return jsonError("Ficheiro demasiado grande (m\u00e1x. 8 MB).", 413);
    // base64 do binário (em chunks para ficheiros maiores)
    const u8 = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    b64 = btoa(bin);
  }

  // contexto dos processos já registados (opcional) — enviado pelo frontend.
  // X-Processos: JSON [{ref, area, resumo}] url-encoded -> a IA decide se o documento
  // pertence a um processo existente ou é novo. X-Resumo-Atual mantém-se por retrocompatibilidade.
  let extraNote = "";
  const ph = request.headers.get("x-processos");
  if (ph) {
    try {
      const lista = JSON.parse(decodeURIComponent(ph));
      if (Array.isArray(lista) && lista.length) extraNote = PROCESSOS_NOTE(lista.slice(0, 10));
    } catch { extraNote = ""; }
  }
  if (!extraNote) {
    const rh = request.headers.get("x-resumo-atual");
    if (rh) {
      try { extraNote = MERGE_NOTE(decodeURIComponent(rh).slice(0, 6000)); } catch { extraNote = ""; }
    }
  }
  const promptFinal = PROMPT + extraNote;

  const docPart = textoColado !== null
    ? { text: "DOCUMENTO \u2014 texto colado pelo utilizador (e-mail, mensagem, excerto\u2026). Trata-o como o conte\u00fado do documento a analisar:\n-----\n" + textoColado + "\n-----" }
    : { inline_data: { mime_type: geminiMime, data: b64 } };
  const body = {
    contents: [{
      parts: [
        docPart,
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
