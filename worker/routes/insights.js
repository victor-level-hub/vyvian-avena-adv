// worker/routes/insights.js
// Insights (aba Redes Sociais → Insights) — pesquisa de temas com potencial de
// engajamento, geração de artigos no padrão do blogue, geração de imagens e
// gestão de fontes acompanhadas.
//
// IA: Gemini (env.GEMINI_API_KEY) com grounding de pesquisa Google para temas,
// artigos e preenchimento de fontes; Gemini Image (nano banana) para imagens,
// com fallback Recraft (env.RECRAFT_API_KEY). Imagens ficam no R2 (env.RECIBOS,
// prefixo insights/).
import { jsonResponse, jsonError } from "../lib/response.js";
import { upsertKeywords, resumoBanco, blocoBancoParaPrompt, updateKeywordMetrics } from "../lib/keywords.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Aliases "latest": resistentes a descontinuações (a 24/07/2026, o gemini-2.5-flash
// direto já devolvia "no longer available to new users" para esta chave).
const MODEL_PESQUISA = "gemini-flash-latest";
const MODEL_ARTIGO = "gemini-pro-latest";
const MODEL_IMAGEM = "gemini-3.1-flash-image"; // nano banana atual (16:9 OK, testado)
const MODEL_CLAUDE = "claude-sonnet-4-5";

// ---------------------------------------------------------------- helpers

// Claude (Anthropic) com pesquisa web — motor principal quando ANTHROPIC_API_KEY existe.
async function claudeWebSearch(env, prompt, { maxTokens = 16000, temperature = 0.4 } = {}) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_CLAUDE,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Claude: ${r.status} ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// Gemini com grounding de pesquisa Google — fallback (ou motor único sem chave Anthropic).
async function geminiWebSearch(env, model, prompt, { maxTokens = 16384, temperature = 0.4 } = {}) {
  const data = await gemini(env, model, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });
  return geminiText(data);
}

// Pesquisa+redação com fallback: Claude → Gemini (ou só Gemini se não houver chave).
async function pesquisaIA(env, prompt, opts = {}) {
  if (env.ANTHROPIC_API_KEY) {
    try {
      return await claudeWebSearch(env, prompt, opts);
    } catch (e) {
      console.error("Claude falhou, fallback Gemini:", e.message);
    }
  }
  return geminiWebSearch(env, opts.geminiModel || MODEL_PESQUISA, prompt, opts);
}

async function gemini(env, model, body) {
  const r = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini ${model}: ${r.status} ${t.slice(0, 300)}`);
  }
  return r.json();
}

function geminiText(data) {
  const cand = (data.candidates || [])[0] || {};
  return ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("").trim();
}

// Extrai o primeiro objeto/array JSON de um texto (tolera fences e prosa à volta).
function extractJson(raw) {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = Math.min(...["[", "{"].map((c) => { const i = s.indexOf(c); return i === -1 ? Infinity : i; }));
  if (start === Infinity) throw new Error("Resposta sem JSON");
  s = s.slice(start);
  // recorta até ao fecho equilibrado
  const open = s[0], close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(s.slice(0, i + 1)); }
  }
  throw new Error("JSON incompleto na resposta");
}

// Os modelos com pesquisa web devolvem por vezes o texto embrulhado em tags de citação
// (<cite index="2-10">…</cite>, <ref>…</ref>) ou com marcas [1]/[2-3] no fim das frases.
// O editor (TipTap) descarta-as em silêncio, mas a pré-visualização e o blogue renderiam
// HTML cru — o <cite> aparece em itálico. Limpamos sempre antes de guardar.
export function limparCitacoes(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/<\/?(?:cite|ref|citation|source)\b[^>]*>/gi, "")
    .replace(/(?<=\S)[ \t]*\[\d+(?:[-–,]\s*\d+)*\](?=[\s.,;:!?)]|$)/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const hostDe = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// Contexto fixo da Dra. para os prompts.
const PERFIL = `A Dra. Vyvian Avena é advogada luso-brasileira, inscrita na Ordem dos Advogados
de Portugal, com escritório em Portugal e atuação também no Brasil (vyavenaadv.com,
Instagram @vyvianavenaadv). Público-alvo: brasileiros a viver em Portugal ou a planear
mudar-se, famílias binacionais Portugal-Brasil e portugueses com interesses no Brasil.
Áreas de atuação: Direito de Família (divórcio, responsabilidades parentais, pensões),
Direito Civil (contratos, arrendamento, sucessões e heranças), Direito Comercial,
Cobrança de Dívida, Nacionalidade portuguesa e imigração (AIMA, vistos, CPLP),
Direito Notarial (procurações, escrituras, apostilas).
Slugs de área válidos: familia | civil | comercial | cobranca | nacionalidade | notarial.`;

// ---------------------------------------------------------------- router

export async function handleInsights(request, env, path, session) {
  if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) {
    return jsonError("Serviço de IA não configurado (GEMINI_API_KEY / ANTHROPIC_API_KEY).", 503);
  }
  const m = request.method;

  if (path === "/api/insights/refresh" && m === "POST") return refresh(request, env);
  if (path === "/api/insights/topics" && m === "GET") return listTopics(env);

  if (path === "/api/insights/articles" && m === "POST") return generateArticle(request, env);
  if (path === "/api/insights/articles" && m === "GET") return listFreeArticles(env);
  let mt = path.match(/^\/api\/insights\/articles\/(\d+)$/);
  if (mt) {
    if (m === "GET") return getArticle(env, +mt[1]);
    if (m === "PATCH") return updateArticle(request, env, +mt[1]);
  }
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/inserir-imagens$/);
  if (mt && m === "POST") return inserirImagens(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/images$/);
  if (mt && m === "POST") return generateImages(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/escolher-imagem$/);
  if (mt && m === "POST") return chooseImage(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/images\/(\d+)$/);
  if (mt && m === "GET") return serveImage(env, +mt[1]);
  if (mt && m === "PUT") return replaceImage(request, env, +mt[1]);

  // Banco de Imagens — a Dra. guarda imagens geradas para reutilizar.
  if (path === "/api/insights/banco" && m === "GET") return listBank(env);
  if (path === "/api/insights/banco" && m === "POST") return saveToBank(request, env);
  mt = path.match(/^\/api\/insights\/banco\/(\d+)$/);
  if (mt && m === "DELETE") return removeFromBank(env, +mt[1]);
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/imagens-do-banco$/);
  if (mt && m === "POST") return adoptFromBank(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/images\/(\d+)$/);
  if (mt && m === "DELETE") return descartarImagem(env, +mt[1], +mt[2]);

  // Banco de Palavras (SEO) — termos com potencial + métricas reais
  if (path === "/api/insights/palavras" && m === "GET") return listKeywords(env);

  // Correções de imagem apontadas pela Dra. — entram no prompt de todas as gerações.
  if (path === "/api/insights/image-rules" && m === "GET") return listImageRules(env);
  if (path === "/api/insights/image-rules" && m === "POST") return addImageRule(request, env);
  mt = path.match(/^\/api\/insights\/image-rules\/(\d+)$/);
  if (mt && m === "DELETE") return removeImageRule(env, +mt[1]);

  if (path === "/api/insights/sources" && m === "GET") return listSources(env);
  if (path === "/api/insights/sources" && m === "POST") return addSource(request, env);
  mt = path.match(/^\/api\/insights\/sources\/(\d+)$/);
  if (mt && m === "PATCH") return updateSource(request, env, +mt[1]);
  if (mt && m === "DELETE") return deleteSource(env, +mt[1]);

  return jsonError("Not found", 404);
}

// ------------------------------------------------ 1) Atualizar sugestões

async function refresh(request, env) {
  const t0 = Date.now();
  let body = {};
  try { body = await request.json(); } catch {}
  const titulosExistentes = Array.isArray(body.existing_titles) ? body.existing_titles.slice(0, 40) : [];

  const fontes = (await env.DB.prepare(
    `SELECT nome, tipo, url FROM insight_sources ORDER BY fiabilidade DESC, engajamento DESC LIMIT 40`
  ).all()).results || [];
  const banco = blocoBancoParaPrompt(await resumoBanco(env, 10));

  const prompt = `${PERFIL}

MISSÃO: usa a pesquisa Google para identificar, HOJE, os 10 assuntos com maior potencial
de engajamento para o público da Dra. Vyvian (posts de blogue e Instagram). Procura
novidades e discussões recentes (últimas ~4 semanas) em fontes respeitadas de Portugal:
sites do Governo (AIMA, IRN/Justiça, Finanças/AT, Segurança Social, Diário da República,
ePortugal), Ordem dos Advogados, imprensa portuguesa de referência, blogues e sites de
escritórios de advocacia com relevância, e perfis de Instagram com bom público do nicho
imigração/nacionalidade.

Fontes que a Dra. já acompanha (dá-lhes prioridade na verificação, mas não te limites a elas):
${fontes.map((f) => `- ${f.nome} (${f.tipo}) — ${f.url}`).join("\n")}

${titulosExistentes.length ? `O blogue já tem artigos sobre estes títulos — EVITA repetir o mesmo ângulo:
${titulosExistentes.map((t) => `- ${t}`).join("\n")}` : ""}
${banco}
${banco ? `Ao escolher os 10 assuntos, dá vantagem a temas que cubram termos do banco AINDA NÃO
usados (alargam o portfólio de indexação do site) e a temas ligados aos termos com melhor
desempenho — sem forçar: a atualidade e o impacto continuam a mandar.` : ""}

REGRAS IMPORTANTES:
- Para CADA assunto, indica TODAS as fontes que encontraste a falar dele (mínimo 1,
  idealmente 2 a 4 de tipos diferentes), para a Dra. poder cruzar e avaliar a fiabilidade
  da notícia. Se um assunto só aparece numa fonte, di-lo na justificação.
- Prefere assuntos acionáveis para o público (mudanças de lei ou de regra, decisões de
  tribunais superiores, prazos e agendamentos AIMA/IRN, taxas, dúvidas muito frequentes).
- Nada de política partidária nem especulação; só factos verificáveis.
- "score" = potencial de engajamento 0-100 (considera atualidade, impacto no público e
  quanto o nicho está a falar disso).

Responde EXCLUSIVAMENTE com JSON válido (sem markdown, sem texto antes/depois):
[
  {
    "titulo": "assunto em 1 linha (máx. 90 caracteres)",
    "resumo": "2-3 frases: o que aconteceu / o que é",
    "justificacao": "1-2 frases: porque deve engajar o público da Dra.",
    "area": "familia|civil|comercial|cobranca|nacionalidade|notarial",
    "score": 0-100,
    "fontes": [
      { "nome": "nome do canal", "tipo": "governo|site|blogue|instagram|midia|escritorio", "url": "https://...", "titulo": "título da notícia/post nessa fonte" }
    ]
  }
]
Exatamente 10 objetos, ordenados por score descendente.`;

  let topics;
  try {
    const texto = await pesquisaIA(env, prompt, { temperature: 0.4, maxTokens: 16384 });
    topics = extractJson(texto);
    if (!Array.isArray(topics) || !topics.length) throw new Error("lista vazia");
  } catch (e) {
    await env.DB.prepare(`INSERT INTO insight_batches (estado, erro, duracao_ms) VALUES ('erro', ?, ?)`)
      .bind(String(e.message).slice(0, 500), Date.now() - t0).run();
    return jsonError(`Falha na pesquisa de temas: ${e.message}`, 502);
  }

  const batch = await env.DB.prepare(`INSERT INTO insight_batches (estado, duracao_ms) VALUES ('ok', ?)`)
    .bind(Date.now() - t0).run();
  const batchId = batch.meta.last_row_id;

  const stmts = [];
  for (const t of topics.slice(0, 10)) {
    stmts.push(env.DB.prepare(
      `INSERT INTO insight_topics (batch_id, titulo, resumo, justificacao, area, score, fontes) VALUES (?,?,?,?,?,?,?)`
    ).bind(
      batchId,
      limparCitacoes(String(t.titulo || "")).slice(0, 200),
      limparCitacoes(String(t.resumo || "")).slice(0, 1000),
      limparCitacoes(String(t.justificacao || "")).slice(0, 600),
      String(t.area || "").slice(0, 30) || null,
      Number.isFinite(+t.score) ? Math.max(0, Math.min(100, Math.round(+t.score))) : null,
      JSON.stringify(Array.isArray(t.fontes) ? t.fontes.slice(0, 8) : []),
    ));
  }
  await env.DB.batch(stmts);

  // contador "indicados" das fontes acompanhadas (match por hostname / handle IG)
  try {
    const rows = (await env.DB.prepare(`SELECT id, url FROM insight_sources`).all()).results || [];
    const porHost = new Map(rows.map((r) => [hostDe(r.url) + new URL(r.url).pathname.replace(/\/$/, ""), r.id]));
    const soHost = new Map(rows.map((r) => [hostDe(r.url), r.id]));
    const hits = new Map();
    for (const t of topics.slice(0, 10)) for (const f of t.fontes || []) {
      const h = hostDe(f.url || "");
      if (!h) continue;
      let id = null;
      try { id = porHost.get(h + new URL(f.url).pathname.replace(/\/$/, "")) ?? null; } catch {}
      if (id == null) id = soHost.get(h) ?? null;
      if (id != null) hits.set(id, (hits.get(id) || 0) + 1);
    }
    if (hits.size) await env.DB.batch([...hits].map(([id, n]) =>
      env.DB.prepare(`UPDATE insight_sources SET indicados = indicados + ?, atualizado_em = datetime('now') WHERE id = ?`).bind(n, id)
    ));
  } catch (e) { console.error("indicados:", e.message); }

  return listTopics(env);
}

async function listTopics(env) {
  const batch = await env.DB.prepare(
    `SELECT * FROM insight_batches WHERE estado='ok' ORDER BY id DESC LIMIT 1`
  ).first();
  if (!batch) return jsonResponse({ batch: null, topics: [] });
  const rows = (await env.DB.prepare(
    `SELECT t.*, a.id AS artigo_id FROM insight_topics t
     LEFT JOIN insight_articles a ON a.topic_id = t.id
     WHERE t.batch_id = ? ORDER BY t.score DESC, t.id ASC`
  ).bind(batch.id).all()).results || [];
  const topics = rows.map((r) => ({ ...r, fontes: safeParse(r.fontes) }));
  return jsonResponse({ batch, topics });
}

const safeParse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };

// ------------------------------------------------ 2) Gerar artigo

async function generateArticle(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}

  // Duas origens: uma sugestão do motor (topic_id) OU um tema livre escrito pela Dra.
  const temaLivre = String(body.tema || "").trim().slice(0, 300);
  let topic = null;
  if (+body.topic_id) {
    topic = await env.DB.prepare(`SELECT * FROM insight_topics WHERE id = ?`).bind(+body.topic_id).first();
    if (!topic) return jsonError("Sugestão não encontrada", 404);
  } else if (!temaLivre) {
    return jsonError("Indique a sugestão (topic_id) ou escreva o tema", 400);
  }

  const fontes = topic ? safeParse(topic.fontes) : [];
  const assunto = topic ? topic.titulo : temaLivre;
  const contexto = topic
    ? topic.resumo
    : "Tema proposto diretamente pela Dra. Vyvian. Pesquisa a atualidade e as fontes oficiais portuguesas sobre este assunto antes de escrever.";
  const banco = blocoBancoParaPrompt(await resumoBanco(env, 10));
  const prompt = `${PERFIL}

Escreve um artigo COMPLETO para o blogue da Dra. Vyvian (vyavenaadv.com/blog) sobre o assunto:

ASSUNTO: ${assunto}
CONTEXTO: ${contexto}
FONTES JÁ IDENTIFICADAS (usa a pesquisa Google para confirmar os factos nelas e aprofundar):
${fontes.map((f) => `- ${f.nome}: ${f.titulo || ""} — ${f.url}`).join("\n") || "(procura tu as fontes oficiais)"}
${banco}

SEO E PALAVRAS-CHAVE (obrigatório):
- O público NÃO é só o leitor brasileiro: inclui também portugueses, luso-descendentes e
  famílias binacionais. Escolhe o ângulo e os termos conforme o tema, sem assumir um só público.
- Antes de escrever, define a PALAVRA-CHAVE PRINCIPAL do artigo: o conjunto de palavras que
  alguém digitaria no Google para encontrar este texto (ex.: «rastreamento processo aima»).
- Usa a palavra-chave principal de forma NATURAL no título, na "descricao", no primeiro
  parágrafo e em 2-3 dos títulos "##". Nada de repetição forçada (keyword stuffing).
- Inclui variações que os dois públicos pesquisam (PT-PT e PT-BR, ex.: «telemóvel/celular»,
  «arrendamento/aluguel») quando o tema o justificar.
- Devolve no JSON 3 a 6 "palavras_chave" (a principal primeiro), cada uma com um score 0-100
  do potencial de pesquisa que estimas — vão para o banco de palavras do blogue.

PADRÃO EDITORIAL DO BLOGUE (obrigatório — é o padrão acordado com a Dra.):
- Idioma: PT-PT por defeito; usa PT-BR apenas se o público-alvo do tema for claramente o
  leitor brasileiro (ex.: cidadania para brasileiros) — nesse caso escreve TODO o artigo em PT-BR.
- Título: máximo 60 caracteres, claro e sem clickbait.
- "descricao": 1 frase de 120-155 caracteres para as metas/SEO.
- SEM prazos concretos, SEM valores em euros/reais, SEM listas de documentos exigidos —
  a lei muda; onde o tema tocar num ponto que possa mudar, remete para consulta com um
  bloco de citação (linha a começar por "> ") que o site apresenta como caixa de aviso.
- Estrutura: 2-3 parágrafos de abertura (sem título), depois 4-6 secções "## Título",
  parágrafos de 2-4 frases, prosa corrida e próxima do leitor (trata-o por "o leitor" ou
  2.ª pessoa de cortesia), sem jargão desnecessário; usa listas com moderação.
- Uma secção final que enquadra quando procurar apoio jurídico (sem vender agressivamente).
- Comprimento total: 900-1400 palavras.
- Rigor absoluto: só factos confirmados nas fontes; nada de números inventados.

Responde EXCLUSIVAMENTE com JSON válido:
{
  "titulo": "máx. 60 caracteres",
  "descricao": "120-155 caracteres",
  "area": "familia|civil|comercial|cobranca|nacionalidade|notarial",
  "idioma": "pt-PT" ou "pt-BR",
  "markdown": "corpo do artigo em Markdown, SEM o título repetido no início",
  "palavras_chave": [{ "termo": "conjunto de palavras pesquisável", "score": 0-100 }]
}`;

  let art;
  try {
    const texto = await pesquisaIA(env, prompt, {
      temperature: 0.55, maxTokens: 20000, geminiModel: MODEL_ARTIGO,
    });
    art = extractJson(texto);
    if (!art.markdown || !art.titulo) throw new Error("artigo incompleto");
  } catch (e) {
    return jsonError(`Falha na geração do artigo: ${e.message}`, 502);
  }

  const ins = await env.DB.prepare(
    `INSERT INTO insight_articles (topic_id, titulo, descricao, area, idioma, markdown) VALUES (?,?,?,?,?,?)`
  ).bind(topic ? topic.id : null, limparCitacoes(String(art.titulo)).slice(0, 120),
         limparCitacoes(String(art.descricao || "")).slice(0, 300),
         String(art.area || (topic && topic.area) || "").slice(0, 30) || null,
         art.idioma === "pt-BR" ? "pt-BR" : "pt-PT", limparCitacoes(String(art.markdown))).run();
  if (topic) {
    await env.DB.prepare(`UPDATE insight_topics SET estado='artigo_gerado' WHERE id = ?`).bind(topic.id).run();
  }

  // Banco de Palavras: os termos devolvidos pela IA entram no banco e as
  // métricas (usos, etc.) são já recalculadas — nunca parte a geração.
  try {
    const n = await upsertKeywords(env, art.palavras_chave);
    if (n) await updateKeywordMetrics(env);
  } catch (e) { console.error("keyword_bank:", e && e.message); }

  return getArticle(env, ins.meta.last_row_id);
}

// Artigos de tema livre (sem sugestão associada) — para a Dra. os reabrir depois.
async function listFreeArticles(env) {
  const rows = (await env.DB.prepare(
    `SELECT id, titulo, area, idioma, criado_em FROM insight_articles
     WHERE topic_id IS NULL ORDER BY id DESC LIMIT 20`
  ).all()).results || [];
  return jsonResponse({ articles: rows });
}

// ------------------------------------------------ fotos no corpo do artigo
// A Dra. escolhe as imagens; a IA decide após que parágrafo cada uma encaixa
// melhor e o Worker insere o markdown correspondente (imagens públicas em GET).
async function inserirImagens(request, env, articleId) {
  let body = {};
  try { body = await request.json(); } catch {}
  const ids = (Array.isArray(body.image_ids) ? body.image_ids : []).map(Number).filter(Boolean).slice(0, 4);
  if (!ids.length) return jsonError("Escolha pelo menos uma imagem", 400);

  const a = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(articleId).first();
  if (!a) return jsonError("Artigo não encontrado", 404);
  const imgs = (await env.DB.prepare(
    `SELECT id, prompt FROM insight_images WHERE article_id = ? AND id IN (${ids.map(() => "?").join(",")})`
  ).bind(articleId, ...ids).all()).results || [];
  if (!imgs.length) return jsonError("Imagens não encontradas neste artigo", 404);

  // blocos do markdown (separados por linha em branco); imagens já existentes não contam
  const blocos = String(a.markdown || "").split(/\n{2,}/);
  const lista = blocos.map((b, i) => `[${i}] ${b.replace(/\s+/g, " ").slice(0, 180)}`).join("\n");
  const cenas = imgs.map((im) => {
    const desc = String(im.prompt || "").split("\n").filter((l) => /^Cena/i.test(l.trim()))[0] || String(im.prompt || "").slice(-160);
    return `- imagem ${im.id}: ${desc.trim().slice(0, 200)}`;
  }).join("\n");

  const prompt = `Vais posicionar fotografias dentro de um artigo de blogue jurídico em português.

BLOCOS DO ARTIGO (por ordem; [n] é o índice do bloco):
${lista}

FOTOGRAFIAS DISPONÍVEIS (descrição da cena de cada uma):
${cenas}

Regras:
- Cada fotografia entra DEPOIS do bloco cujo conteúdo mais se relaciona com a cena.
- Distribui as fotografias ao longo do artigo (nunca duas seguidas, nunca após o mesmo bloco).
- Evita o bloco 0 (abertura) e o último bloco.
- "alt" é uma descrição breve e natural da cena em português (8-14 palavras, sem aspas).

Responde EXCLUSIVAMENTE com JSON válido:
{"colocacoes":[{"image_id":123,"apos_bloco":4,"alt":"..."}]}`;

  let plano;
  try {
    const data = await gemini(env, MODEL_PESQUISA, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    });
    plano = extractJson(geminiText(data));
  } catch (e) {
    return jsonError(`Falha a posicionar as imagens: ${e.message}`, 502);
  }

  const colocacoes = (plano.colocacoes || [])
    .filter((c) => ids.includes(Number(c.image_id)))
    .map((c) => ({
      id: Number(c.image_id),
      apos: Math.max(1, Math.min(blocos.length - 2, Number(c.apos_bloco) || 1)),
      alt: String(c.alt || "Fotografia ilustrativa do artigo").slice(0, 140).replace(/["\]]/g, ""),
    }));
  if (!colocacoes.length) return jsonError("A IA não devolveu posições válidas", 502);

  // remover duplicados de posição (empurra para o bloco seguinte) e inserir de trás para a frente
  const usadas = new Set();
  for (const c of colocacoes) { while (usadas.has(c.apos)) c.apos++; usadas.add(c.apos); }
  colocacoes.sort((x, y) => y.apos - x.apos);
  for (const c of colocacoes) {
    const md = `![${c.alt}](/api/insights/images/${c.id})`;
    blocos.splice(Math.min(c.apos, blocos.length - 1) + 1, 0, md);
  }

  await env.DB.prepare(`UPDATE insight_articles SET markdown = ? WHERE id = ?`)
    .bind(blocos.join("\n\n"), articleId).run();
  return getArticle(env, articleId);
}

async function getArticle(env, id) {
  const a = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(id).first();
  if (!a) return jsonError("Artigo não encontrado", 404);
  const imgs = (await env.DB.prepare(
    `SELECT id, provider, ronda, criado_em,
            CASE WHEN prompt LIKE 'banco#%' THEN CAST(substr(prompt, 7) AS INTEGER) ELSE NULL END AS banco_origem
     FROM insight_images WHERE article_id = ? ORDER BY id ASC`
  ).bind(id).all()).results || [];
  const ativas = imgs.filter((i) => i.ronda > 0); // ronda -1 = opção descartada pela Dra.
  const ronda = ativas.length ? Math.max(...ativas.map((i) => i.ronda)) : 0;
  return jsonResponse({ article: a, images: ativas.filter((i) => i.ronda === ronda), ronda });
}

/* Descartar uma opção da ronda atual (pedido do Victor, 27 jul): a linha fica
   com ronda = -1 — sai da grelha de opções mas o ficheiro e o registo mantêm-se
   (o banco, o corpo de artigos e serveImage continuam a funcionar). Se era a
   capa, a escolha é limpa. Os bytes só são apagados via remoção do banco. */
async function descartarImagem(env, articleId, imageId) {
  const img = await env.DB.prepare(
    `SELECT id FROM insight_images WHERE id = ? AND article_id = ? AND ronda > 0`
  ).bind(imageId, articleId).first();
  if (!img) return jsonError("Imagem não encontrada neste artigo", 404);
  await env.DB.prepare(`UPDATE insight_images SET ronda = -1 WHERE id = ?`).bind(imageId).run();
  await env.DB.prepare(
    `UPDATE insight_articles SET imagem_escolhida = NULL WHERE id = ? AND imagem_escolhida = ?`
  ).bind(articleId, imageId).run();
  return getArticle(env, articleId);
}

async function updateArticle(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  const a = await env.DB.prepare(`SELECT id FROM insight_articles WHERE id = ?`).bind(id).first();
  if (!a) return jsonError("Artigo não encontrado", 404);
  const sets = [], vals = [];
  if (typeof body.titulo === "string") { sets.push("titulo = ?"); vals.push(body.titulo.slice(0, 120)); }
  if (typeof body.descricao === "string") { sets.push("descricao = ?"); vals.push(body.descricao.slice(0, 300)); }
  if (typeof body.markdown === "string") { sets.push("markdown = ?"); vals.push(body.markdown); }
  if (typeof body.area === "string") { sets.push("area = ?"); vals.push(body.area.slice(0, 30)); }
  if (!sets.length) return jsonError("Nada para atualizar", 400);
  sets.push("atualizado_em = datetime('now')");
  await env.DB.prepare(`UPDATE insight_articles SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  return getArticle(env, id);
}

// ------------------------------------------------ 3) Imagens (Gemini → R2, fallback Recraft)

const DIRECAO_ARTE = `Fotografia editorial realista para o blogue de uma advogada em Portugal.
Estética da marca: escritório de advocacia elegante e sóbrio, luz natural suave, tons
verde-floresta escuro (#12302a), dourado discreto (#b8935a) e creme; ambientes portugueses
(Lisboa/Porto: azulejos discretos, calçada, arquitetura clássica) quando fizer sentido.
Pessoas plausíveis e diversas em contexto (consulta, documentos, videochamada, família),
enquadramento 16:9, profundidade de campo suave, SEM texto na imagem, sem logótipos,
sem marcas visíveis, sem rostos distorcidos.
Coerência física obrigatória: ecrãs de telemóveis e computadores sempre virados para a
pessoa que os está a usar — quem olha para um telemóvel vê o ecrã, e a câmara vê as
COSTAS do aparelho. Nunca mostrar um ecrã virado para a câmara enquanto a pessoa olha
para ele; mãos com cinco dedos e a segurar os objetos de forma natural.`;

/* ---------------- Banco de Palavras (SEO) ---------------- */
async function listKeywords(env) {
  const rows = (await env.DB.prepare(
    `SELECT id, termo, tipo, score, usos, visitas, ig_curtidas, ig_comentarios, origem, criado_em, atualizado_em
     FROM keyword_bank ORDER BY score DESC, usos DESC LIMIT 400`
  ).all()).results || [];
  return jsonResponse({ keywords: rows });
}

/* ---------------- Banco de Imagens ----------------
   Guarda referências às imagens geradas (bytes continuam no R2). UNIQUE(image_id)
   impede duplicados — quem tentar guardar de novo recebe a data original. */
async function listBank(env) {
  const rows = (await env.DB.prepare(
    `SELECT b.id, b.image_id, b.criado_em, i.provider, i.article_id, a.titulo AS artigo_titulo
     FROM image_bank b
     JOIN insight_images i ON i.id = b.image_id
     LEFT JOIN insight_articles a ON a.id = i.article_id
     ORDER BY b.criado_em DESC, b.id DESC LIMIT 200`
  ).all()).results || [];

  // «usos»: artigos onde a imagem está de facto em uso (capa ou corpo), contando
  // também as cópias adotadas via «Usar imagem do banco» (prompt banco#id).
  if (rows.length) {
    const arts = (await env.DB.prepare(
      `SELECT id, titulo, imagem_escolhida, markdown FROM insight_articles ORDER BY id DESC LIMIT 100`
    ).all()).results || [];
    const copias = (await env.DB.prepare(
      `SELECT id, prompt FROM insight_images WHERE prompt LIKE 'banco#%'`
    ).all()).results || [];
    for (const b of rows) {
      const ids = [b.image_id, ...copias.filter((c) => c.prompt === `banco#${b.image_id}`).map((c) => c.id)];
      b.usos = arts
        .filter((a) => ids.some((id) =>
          a.imagem_escolhida === id || (a.markdown || "").includes(`/api/insights/images/${id})`)))
        .map((a) => ({ article_id: a.id, titulo: a.titulo }));
    }
  }
  return jsonResponse({ images: rows });
}

async function saveToBank(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const ids = (Array.isArray(body.image_ids) ? body.image_ids : [body.image_id]).map(Number).filter(Boolean).slice(0, 12);
  if (!ids.length) return jsonError("Indique as imagens a guardar", 400);

  const resultados = [];
  for (const id of ids) {
    const img = await env.DB.prepare(`SELECT id FROM insight_images WHERE id = ?`).bind(id).first();
    if (!img) { resultados.push({ image_id: id, estado: "inexistente" }); continue; }
    const ja = await env.DB.prepare(`SELECT criado_em FROM image_bank WHERE image_id = ?`).bind(id).first();
    if (ja) { resultados.push({ image_id: id, estado: "ja_existia", criado_em: ja.criado_em }); continue; }
    await env.DB.prepare(`INSERT INTO image_bank (image_id) VALUES (?)`).bind(id).run();
    resultados.push({ image_id: id, estado: "guardada" });
  }
  return jsonResponse({ ok: true, resultados });
}

/* Remover do banco apaga também os bytes do R2 e o registo em insight_images —
   MAS só quando a imagem já não está em uso em nenhum artigo: não é capa,
   não aparece no markdown de nenhum artigo, não pertence à ronda atual de
   opções do seu artigo e nenhuma outra linha partilha a mesma chave R2. */
async function removeFromBank(env, imageId) {
  await env.DB.prepare(`DELETE FROM image_bank WHERE image_id = ?`).bind(imageId).run();

  const img = await env.DB.prepare(`SELECT * FROM insight_images WHERE id = ?`).bind(imageId).first();
  if (!img) return jsonResponse({ ok: true, apagada: false, motivo: "inexistente" });

  const emUso = await imagemEmUso(env, img);
  if (emUso) return jsonResponse({ ok: true, apagada: false, motivo: emUso });

  try { await env.RECIBOS.delete(img.r2_key); } catch { /* já não existia */ }
  await env.DB.prepare(`DELETE FROM insight_images WHERE id = ?`).bind(imageId).run();
  return jsonResponse({ ok: true, apagada: true });
}

// Devolve o motivo se a imagem ainda estiver em uso; null se puder ser apagada.
async function imagemEmUso(env, img) {
  const capa = await env.DB.prepare(
    `SELECT id FROM insight_articles WHERE imagem_escolhida = ?`
  ).bind(img.id).first();
  if (capa) return "capa";

  const corpo = await env.DB.prepare(
    `SELECT id FROM insight_articles WHERE markdown LIKE ?`
  ).bind(`%/api/insights/images/${img.id})%`).first();
  if (corpo) return "corpo";

  if (img.article_id) {
    const atual = await env.DB.prepare(
      `SELECT COALESCE(MAX(CASE WHEN ronda > 0 THEN ronda END), 0) AS r FROM insight_images WHERE article_id = ?`
    ).bind(img.article_id).first();
    if ((atual?.r || 0) === img.ronda) return "opcoes";
  }

  const partilha = await env.DB.prepare(
    `SELECT id FROM insight_images WHERE r2_key = ? AND id != ?`
  ).bind(img.r2_key, img.id).first();
  if (partilha) return "partilhada";

  return null;
}

/* A Dra. escolhe imagens do banco para juntar às opções de um artigo.
   Cada imagem é COPIADA no R2 para uma chave própria do artigo (as chaves
   determinísticas evitam duplicar a mesma imagem duas vezes na mesma ronda),
   com nova linha em insight_images na ronda atual — a partir daí comporta-se
   como qualquer opção gerada: pode ser capa ou entrar no corpo. */
async function adoptFromBank(request, env, articleId) {
  const a = await env.DB.prepare(`SELECT id FROM insight_articles WHERE id = ?`).bind(articleId).first();
  if (!a) return jsonError("Artigo não encontrado", 404);

  let body = {};
  try { body = await request.json(); } catch {}
  const ids = (Array.isArray(body.image_ids) ? body.image_ids : []).map(Number).filter(Boolean).slice(0, 12);
  if (!ids.length) return jsonError("Indique as imagens do banco a adicionar", 400);

  const atual = await env.DB.prepare(
    `SELECT COALESCE(MAX(CASE WHEN ronda > 0 THEN ronda END), 0) AS r FROM insight_images WHERE article_id = ?`
  ).bind(articleId).first();
  const ronda = Math.max(1, atual?.r || 0);

  const resultados = [];
  for (const srcId of ids) {
    const noBanco = await env.DB.prepare(`SELECT id FROM image_bank WHERE image_id = ?`).bind(srcId).first();
    const src = await env.DB.prepare(`SELECT * FROM insight_images WHERE id = ?`).bind(srcId).first();
    if (!noBanco || !src) { resultados.push({ image_id: srcId, estado: "inexistente" }); continue; }

    // a imagem nasceu neste artigo e ainda está nas opções atuais — copiar seria duplicar
    if (src.article_id === articleId && src.ronda === ronda) {
      resultados.push({ image_id: srcId, estado: "ja_no_artigo" });
      continue;
    }

    const ext = (src.content_type || "").includes("png") ? "png" : "jpg";
    const key = `insights/art-${articleId}/r${ronda}-banco${srcId}.${ext}`;

    const ja = await env.DB.prepare(
      `SELECT id FROM insight_images WHERE article_id = ? AND r2_key = ?`
    ).bind(articleId, key).first();
    if (ja) { resultados.push({ image_id: srcId, estado: "ja_no_artigo" }); continue; }

    const obj = await env.RECIBOS.get(src.r2_key);
    if (!obj) { resultados.push({ image_id: srcId, estado: "inexistente" }); continue; }
    await env.RECIBOS.put(key, obj.body, { httpMetadata: { contentType: src.content_type || "image/jpeg" } });
    await env.DB.prepare(
      `INSERT INTO insight_images (article_id, r2_key, content_type, prompt, provider, ronda) VALUES (?,?,?,?,?,?)`
    ).bind(articleId, key, src.content_type, `banco#${srcId}`, src.provider, ronda).run();
    resultados.push({ image_id: srcId, estado: "adicionada" });
  }

  const imgs = (await env.DB.prepare(
    `SELECT id, provider, ronda, criado_em,
            CASE WHEN prompt LIKE 'banco#%' THEN CAST(substr(prompt, 7) AS INTEGER) ELSE NULL END AS banco_origem
     FROM insight_images WHERE article_id = ? ORDER BY id ASC`
  ).bind(articleId).all()).results || [];
  const r = imgs.length ? Math.max(...imgs.map((i) => i.ronda)) : 0;
  const artigo = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(articleId).first();
  return jsonResponse({ article: artigo, images: imgs.filter((i) => i.ronda === r), ronda: r, resultados });
}

/* ---------------- correções de imagem (apontadas pela Dra.) ----------------
   Guardadas no KV (SESSIONS, chave insights:img-correcoes) — sem migração.
   Cada erro grotesco visto numa imagem gerada vira uma regra permanente
   que é acrescentada ao prompt de TODAS as gerações seguintes. */
const IMG_RULES_KEY = "insights:img-correcoes";

async function getImageRules(env) {
  try {
    const raw = await env.SESSIONS.get(IMG_RULES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function listImageRules(env) {
  return jsonResponse({ rules: await getImageRules(env) });
}

async function addImageRule(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const texto = String(body.texto || "").trim().slice(0, 240);
  if (!texto) return jsonError("Descreva o erro a evitar", 400);
  const rules = await getImageRules(env);
  if (rules.length >= 40) return jsonError("Limite de 40 correções — apague alguma antiga primeiro", 400);
  const rule = { id: Date.now(), texto, criado_em: new Date().toISOString().slice(0, 19).replace("T", " ") };
  rules.unshift(rule);
  await env.SESSIONS.put(IMG_RULES_KEY, JSON.stringify(rules));
  return jsonResponse({ ok: true, rule, rules });
}

async function removeImageRule(env, id) {
  const rules = (await getImageRules(env)).filter((r) => r.id !== id);
  await env.SESSIONS.put(IMG_RULES_KEY, JSON.stringify(rules));
  return jsonResponse({ ok: true, rules });
}

function imagePrompts(article, regras = []) {
  let base = `${DIRECAO_ARTE}`;
  if (regras.length) {
    base += `\nERROS JÁ OBSERVADOS EM GERAÇÕES ANTERIORES — NUNCA REPETIR:\n` +
      regras.map((r) => `- ${r.texto}`).join("\n");
  }
  base += `\n\nTema do artigo: "${article.titulo}" — ${article.descricao || ""}`;
  return [
    `${base}\nCena 1: momento humano central do tema (protagonista em primeiro plano, ambiente desfocado).`,
    `${base}\nCena 2: a interação com a advogada — reunião ou consulta, cumplicidade e confiança.`,
    `${base}\nCena 3: o detalhe simbólico — mãos, documentos, objetos do tema em close-up elegante.`,
    `${base}\nCena 4: o contexto português — o tema enquadrado na cidade/ambiente de Portugal.`,
  ];
}

async function gerarUmaImagem(env, prompt) {
  // 1º Gemini (nano banana)
  try {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada");
    const data = await gemini(env, MODEL_IMAGEM, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    });
    const parts = ((data.candidates || [])[0]?.content?.parts) || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    const d = img && (img.inlineData || img.inline_data);
    if (d && d.data) {
      const bin = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
      return { bytes: bin, contentType: d.mimeType || d.mime_type || "image/png", provider: "gemini" };
    }
    throw new Error("sem imagem na resposta");
  } catch (e) {
    if (!env.RECRAFT_API_KEY) throw e;
    // 2º Recraft
    const r = await fetch("https://external.api.recraft.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RECRAFT_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 1000), style: "realistic_image", size: "1820x1024", n: 1 }),
    });
    if (!r.ok) throw new Error(`Recraft ${r.status}: ${(await r.text()).slice(0, 200)} (Gemini: ${e.message})`);
    const j = await r.json();
    const url = j.data?.[0]?.url;
    if (!url) throw new Error("Recraft sem URL");
    const ir = await fetch(url);
    if (!ir.ok) throw new Error(`download Recraft ${ir.status}`);
    return { bytes: new Uint8Array(await ir.arrayBuffer()), contentType: ir.headers.get("content-type") || "image/png", provider: "recraft" };
  }
}

async function generateImages(request, env, articleId) {
  const article = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(articleId).first();
  if (!article) return jsonError("Artigo não encontrado", 404);

  const prev = await env.DB.prepare(
    `SELECT COALESCE(MAX(CASE WHEN ronda > 0 THEN ronda END), 0) AS r FROM insight_images WHERE article_id = ?`
  ).bind(articleId).first();
  const ronda = (prev?.r || 0) + 1;

  const prompts = imagePrompts(article, await getImageRules(env));
  const results = await Promise.allSettled(prompts.map((p) => gerarUmaImagem(env, p)));
  const ok = [];
  results.forEach((r, i) => { if (r.status === "fulfilled") ok.push({ ...r.value, prompt: prompts[i], i }); });
  if (!ok.length) {
    const razoes = results.map((r) => r.status === "rejected" ? String(r.reason?.message || r.reason).slice(0, 120) : "").filter(Boolean);
    return jsonError(`Nenhuma imagem gerada. ${razoes[0] || ""}`, 502);
  }

  const stmts = [];
  for (const img of ok) {
    const ext = img.contentType.includes("jpeg") ? "jpg" : img.contentType.includes("webp") ? "webp" : "png";
    const key = `insights/art-${articleId}/r${ronda}-${img.i + 1}.${ext}`;
    await env.RECIBOS.put(key, img.bytes, { httpMetadata: { contentType: img.contentType } });
    stmts.push(env.DB.prepare(
      `INSERT INTO insight_images (article_id, r2_key, content_type, prompt, provider, ronda) VALUES (?,?,?,?,?,?)`
    ).bind(articleId, key, img.contentType, img.prompt.slice(-400), img.provider, ronda));
  }
  await env.DB.batch(stmts);
  // nova ronda invalida a escolha anterior
  await env.DB.prepare(`UPDATE insight_articles SET imagem_escolhida = NULL WHERE id = ?`).bind(articleId).run();

  return getArticle(env, articleId);
}

async function chooseImage(request, env, articleId) {
  let body = {};
  try { body = await request.json(); } catch {}
  const img = await env.DB.prepare(
    `SELECT id FROM insight_images WHERE id = ? AND article_id = ?`
  ).bind(+body.image_id || 0, articleId).first();
  if (!img) return jsonError("Imagem não encontrada", 404);
  await env.DB.prepare(
    `UPDATE insight_articles SET imagem_escolhida = ?, atualizado_em = datetime('now') WHERE id = ?`
  ).bind(img.id, articleId).run();
  return getArticle(env, articleId);
}

// Substitui os bytes de uma imagem (mesma chave R2) — usado pelo admin para
// gravar a versão com a marca de água (favicon da Dra.) composta no browser.
async function replaceImage(request, env, id) {
  const img = await env.DB.prepare(`SELECT * FROM insight_images WHERE id = ?`).bind(id).first();
  if (!img) return jsonError("Imagem não encontrada", 404);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return jsonError("Corpo vazio", 400);
  if (bytes.length > 8 * 1024 * 1024) return jsonError("Imagem demasiado grande (máx. 8 MB)", 413);
  const contentType = request.headers.get("content-type") || img.content_type || "image/jpeg";
  await env.RECIBOS.put(img.r2_key, bytes, { httpMetadata: { contentType } });
  await env.DB.prepare(`UPDATE insight_images SET content_type = ? WHERE id = ?`).bind(contentType, id).run();
  return jsonResponse({ ok: true, id, bytes: bytes.length });
}

async function serveImage(env, id) {
  const img = await env.DB.prepare(`SELECT * FROM insight_images WHERE id = ?`).bind(id).first();
  if (!img) return jsonError("Imagem não encontrada", 404);
  const obj = await env.RECIBOS.get(img.r2_key);
  if (!obj) return jsonError("Ficheiro não encontrado no armazenamento", 404);
  return new Response(obj.body, {
    headers: { "Content-Type": img.content_type || "image/png", "Cache-Control": "private, max-age=3600" },
  });
}

// ------------------------------------------------ 4) Fontes

async function listSources(env) {
  const rows = (await env.DB.prepare(
    `SELECT * FROM insight_sources ORDER BY fiabilidade DESC, engajamento DESC, nome ASC`
  ).all()).results || [];
  return jsonResponse({ sources: rows });
}

async function addSource(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const url = String(body.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return jsonError("Indique um link válido (https://…).", 400);

  const dup = await env.DB.prepare(`SELECT id FROM insight_sources WHERE url = ?`).bind(url).first();
  if (dup) return jsonError("Essa fonte já está na lista.", 409);

  const prompt = `${PERFIL}

A Dra. quer acompanhar esta fonte de conteúdo jurídico/imigração: ${url}
Usa a pesquisa Google para identificar o canal e responde EXCLUSIVAMENTE com JSON:
{
  "nome": "nome do canal (para Instagram usa @handle e o nome, ex.: '@handle (Nome)')",
  "tipo": "governo|site|blogue|instagram|midia|escritorio",
  "fiabilidade": 1-5  (5 = fonte oficial/altamente credível; 1 = pouco verificável),
  "engajamento": 1-5  (alcance/interação do canal com o público),
  "resumo": "1-2 frases: que temas costuma tratar e para que público"
}`;

  let meta = null;
  try {
    const texto = await pesquisaIA(env, prompt, { temperature: 0.2, maxTokens: 2048 });
    meta = extractJson(texto);
  } catch (e) {
    console.error("addSource IA:", e.message);
  }

  const nome = (meta?.nome || hostDe(url) || url).slice(0, 160);
  const tipo = ["governo", "site", "blogue", "instagram", "midia", "escritorio"].includes(meta?.tipo) ? meta.tipo
    : /instagram\.com/i.test(url) ? "instagram" : "site";
  const clamp5 = (v, d) => (Number.isFinite(+v) ? Math.max(1, Math.min(5, Math.round(+v))) : d);

  const ins = await env.DB.prepare(
    `INSERT INTO insight_sources (nome, tipo, url, fiabilidade, engajamento, resumo, origem) VALUES (?,?,?,?,?,?, 'manual')`
  ).bind(nome, tipo, url, clamp5(meta?.fiabilidade, 3), clamp5(meta?.engajamento, 3),
         (meta?.resumo || "").slice(0, 500) || null).run();

  const row = await env.DB.prepare(`SELECT * FROM insight_sources WHERE id = ?`).bind(ins.meta.last_row_id).first();
  return jsonResponse({ source: row, preenchido_por_ia: !!meta });
}

async function updateSource(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  const sets = [], vals = [];
  for (const [k, max] of [["nome", 160], ["tipo", 20], ["resumo", 500]]) {
    if (typeof body[k] === "string") { sets.push(`${k} = ?`); vals.push(body[k].slice(0, max)); }
  }
  for (const k of ["fiabilidade", "engajamento"]) {
    if (body[k] != null && Number.isFinite(+body[k])) { sets.push(`${k} = ?`); vals.push(Math.max(1, Math.min(5, Math.round(+body[k])))); }
  }
  if (!sets.length) return jsonError("Nada para atualizar", 400);
  sets.push("atualizado_em = datetime('now')");
  await env.DB.prepare(`UPDATE insight_sources SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  const row = await env.DB.prepare(`SELECT * FROM insight_sources WHERE id = ?`).bind(id).first();
  if (!row) return jsonError("Fonte não encontrada", 404);
  return jsonResponse({ source: row });
}

async function deleteSource(env, id) {
  await env.DB.prepare(`DELETE FROM insight_sources WHERE id = ?`).bind(id).run();
  return jsonResponse({ ok: true });
}
