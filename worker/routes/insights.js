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
  let mt = path.match(/^\/api\/insights\/articles\/(\d+)$/);
  if (mt) {
    if (m === "GET") return getArticle(env, +mt[1]);
    if (m === "PATCH") return updateArticle(request, env, +mt[1]);
  }
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/images$/);
  if (mt && m === "POST") return generateImages(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/articles\/(\d+)\/escolher-imagem$/);
  if (mt && m === "POST") return chooseImage(request, env, +mt[1]);
  mt = path.match(/^\/api\/insights\/images\/(\d+)$/);
  if (mt && m === "GET") return serveImage(env, +mt[1]);

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
      String(t.titulo || "").slice(0, 200),
      String(t.resumo || "").slice(0, 1000),
      String(t.justificacao || "").slice(0, 600),
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
  const topic = await env.DB.prepare(`SELECT * FROM insight_topics WHERE id = ?`).bind(+body.topic_id || 0).first();
  if (!topic) return jsonError("Sugestão não encontrada", 404);

  const fontes = safeParse(topic.fontes);
  const prompt = `${PERFIL}

Escreve um artigo COMPLETO para o blogue da Dra. Vyvian (vyavenaadv.com/blog) sobre o assunto:

ASSUNTO: ${topic.titulo}
CONTEXTO: ${topic.resumo}
FONTES JÁ IDENTIFICADAS (usa a pesquisa Google para confirmar os factos nelas e aprofundar):
${fontes.map((f) => `- ${f.nome}: ${f.titulo || ""} — ${f.url}`).join("\n") || "(procura tu as fontes oficiais)"}

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
  "markdown": "corpo do artigo em Markdown, SEM o título repetido no início"
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
  ).bind(topic.id, String(art.titulo).slice(0, 120), String(art.descricao || "").slice(0, 300),
         String(art.area || topic.area || "").slice(0, 30) || null,
         art.idioma === "pt-BR" ? "pt-BR" : "pt-PT", String(art.markdown)).run();
  await env.DB.prepare(`UPDATE insight_topics SET estado='artigo_gerado' WHERE id = ?`).bind(topic.id).run();

  return getArticle(env, ins.meta.last_row_id);
}

async function getArticle(env, id) {
  const a = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(id).first();
  if (!a) return jsonError("Artigo não encontrado", 404);
  const imgs = (await env.DB.prepare(
    `SELECT id, provider, ronda, criado_em FROM insight_images WHERE article_id = ? ORDER BY id ASC`
  ).bind(id).all()).results || [];
  const ronda = imgs.length ? Math.max(...imgs.map((i) => i.ronda)) : 0;
  return jsonResponse({ article: a, images: imgs.filter((i) => i.ronda === ronda), ronda });
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
sem marcas visíveis, sem rostos distorcidos.`;

function imagePrompts(article) {
  const base = `${DIRECAO_ARTE}\n\nTema do artigo: "${article.titulo}" — ${article.descricao || ""}`;
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
    `SELECT COALESCE(MAX(ronda), 0) AS r FROM insight_images WHERE article_id = ?`
  ).bind(articleId).first();
  const ronda = (prev?.r || 0) + 1;

  const prompts = imagePrompts(article);
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
