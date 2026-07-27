// worker/lib/keywords.js — Banco de Palavras (SEO).
//
// "Palavras" e "conjuntos de palavras" com potencial de pesquisa, guardados em
// keyword_bank (migração 0020). Três responsabilidades:
//   1. upsertKeywords  — a IA devolve termos novos ao gerar um artigo; entram no
//      banco (ou atualizam o score se já existirem).
//   2. resumoBanco     — o que é injetado nos prompts: termos com melhor
//      desempenho + termos ainda por cobrir (portfólio de indexação abrangente).
//   3. updateKeywordMetrics — cron diário: recalcula usos (artigos Insights),
//      visitas (site_page_views em /blog/*) e engajamento IG (ig_posts) por termo.

// minúsculas, sem acentos, espaços únicos — chave canónica de um termo
export function normalizarTermo(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Insere/atualiza termos vindos da IA: [{ termo, tipo, score }]
export async function upsertKeywords(env, lista) {
  const stmts = [];
  for (const k of Array.isArray(lista) ? lista : []) {
    const termo = normalizarTermo(k && k.termo);
    if (!termo || termo.length < 3 || termo.length > 80) continue;
    const tipo = termo.includes(" ") ? "conjunto" : "palavra";
    const score = Math.max(0, Math.min(100, Math.round(+((k && k.score)) || 50)));
    stmts.push(env.DB.prepare(
      `INSERT INTO keyword_bank (termo, tipo, score, atualizado_em)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(termo) DO UPDATE SET
         score = CASE WHEN excluded.score > score THEN excluded.score ELSE score END,
         atualizado_em = datetime('now')`
    ).bind(termo, tipo, score));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// Resumo para os prompts: termos fortes (já usados, ordenados por desempenho real)
// e termos por cobrir (usos = 0, ordenados pelo potencial estimado).
export async function resumoBanco(env, n = 10) {
  try {
    const fortes = (await env.DB.prepare(
      `SELECT termo, score, usos, visitas, ig_curtidas + ig_comentarios AS ig
       FROM keyword_bank WHERE usos > 0
       ORDER BY (visitas + ig_curtidas + ig_comentarios) DESC, score DESC LIMIT ?`
    ).bind(n).all()).results || [];
    const porUsar = (await env.DB.prepare(
      `SELECT termo, score FROM keyword_bank WHERE usos = 0 ORDER BY score DESC LIMIT ?`
    ).bind(n).all()).results || [];
    return { fortes, porUsar };
  } catch {
    return { fortes: [], porUsar: [] };
  }
}

// Bloco de texto pronto a colar nos prompts (vazio se o banco ainda não tem dados).
export function blocoBancoParaPrompt({ fortes, porUsar }) {
  if (!fortes.length && !porUsar.length) return "";
  const linhas = ["\nBANCO DE PALAVRAS-CHAVE do blogue (usa-o a teu favor):"];
  if (fortes.length) {
    linhas.push(`- Termos com melhor desempenho real (bom sinal de interesse — reforça quando fizer sentido): ${fortes.map((t) => `«${t.termo}»`).join(", ")}.`);
  }
  if (porUsar.length) {
    linhas.push(`- Termos com potencial AINDA NÃO cobertos por nenhum artigo (prioriza cobrir estes — alargam a indexação): ${porUsar.map((t) => `«${t.termo}» (${t.score})`).join(", ")}.`);
  }
  return linhas.join("\n");
}

// Cron diário: recalcula as métricas reais de cada termo.
export async function updateKeywordMetrics(env) {
  const termos = (await env.DB.prepare(
    `SELECT id, termo FROM keyword_bank ORDER BY id LIMIT 400`
  ).all()).results || [];
  if (!termos.length) return { termos: 0 };

  const artigos = ((await env.DB.prepare(
    `SELECT titulo, markdown FROM insight_articles ORDER BY id DESC LIMIT 300`
  ).all()).results || []).map((a) => normalizarTermo(`${a.titulo} ${a.markdown || ""}`));

  const posts = ((await env.DB.prepare(
    `SELECT caption, like_count, comments_count FROM ig_posts`
  ).all()).results || []).map((p) => ({
    texto: normalizarTermo(p.caption || ""),
    likes: p.like_count || 0,
    comments: p.comments_count || 0,
  }));

  const paginas = ((await env.DB.prepare(
    `SELECT path, SUM(views) AS v FROM site_page_views WHERE path LIKE '/blog/%' GROUP BY path`
  ).all()).results || []).map((p) => ({
    texto: normalizarTermo(String(p.path).replace(/[-/]/g, " ")),
    v: p.v || 0,
  }));

  const stmts = [];
  for (const t of termos) {
    const alvo = t.termo;
    const usos = artigos.filter((a) => a.includes(alvo)).length;
    let curtidas = 0, comentarios = 0;
    for (const p of posts) if (p.texto.includes(alvo)) { curtidas += p.likes; comentarios += p.comments; }
    let visitas = 0;
    for (const pg of paginas) if (pg.texto.includes(alvo)) visitas += pg.v;
    stmts.push(env.DB.prepare(
      `UPDATE keyword_bank
       SET usos = ?, visitas = ?, ig_curtidas = ?, ig_comentarios = ?, atualizado_em = datetime('now')
       WHERE id = ? AND (usos != ? OR visitas != ? OR ig_curtidas != ? OR ig_comentarios != ?)`
    ).bind(usos, visitas, curtidas, comentarios, t.id, usos, visitas, curtidas, comentarios));
  }
  // lotes de 40 para não estourar limites do D1
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return { termos: termos.length };
}
