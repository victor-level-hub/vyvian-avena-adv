// worker/routes/stats.js
// Estatísticas para a Área Privada.
// FASE A: acessos ao site (contador próprio no D1 — ver worker/lib/visits.js).
// FASE B: Instagram (@vyvianavenaadv) — seguidores e engajamento das publicações,
// alimentado pelo cron diário via worker/lib/instagram.js.
// ENGAJAMENTO (0027): /api/stats/engagement — métricas de conta por dia, ranking de
// publicações, desempenho por formato e demografia, agrupado por plataforma.
import { jsonResponse, jsonError } from '../lib/response.js';

const RANGES = {
  '1d':   { days: 1,   granularity: 'hour' },
  '7d':   { days: 7,   granularity: 'day' },
  '15d':  { days: 15,  granularity: 'day' },
  '30d':  { days: 30,  granularity: 'day' },
  '60d':  { days: 60,  granularity: 'day' },
  '90d':  { days: 90,  granularity: 'day' },
  '120d': { days: 120, granularity: 'day' },
};

export async function handleStats(request, env, path, session) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405);

  if (path === '/api/stats/site') {
    const url = new URL(request.url);
    const asked = url.searchParams.get('range');
    const rangeKey = RANGES[asked] ? asked : '7d';
    const { days, granularity } = RANGES[rangeKey];
    return granularity === 'hour'
      ? await siteHourly(env, rangeKey)
      : await siteDaily(env, rangeKey, days);
  }

  // FASE B: Instagram — seguidores (evolução + novos no período) e engajamento dos posts.
  if (path === '/api/stats/instagram') {
    const url = new URL(request.url);
    const asked = url.searchParams.get('range');
    const rangeKey = RANGES[asked] ? asked : '30d';
    return await instagramStats(env, rangeKey, RANGES[rangeKey].days);
  }

  // Engajamento (0027): métricas de conta, ranking de publicações e demografia,
  // organizado por plataforma para a aba "Engajamento".
  if (path === '/api/stats/engagement') {
    const url = new URL(request.url);
    const asked = url.searchParams.get('range');
    const rangeKey = RANGES[asked] ? asked : '30d';
    return await engagementStats(env, rangeKey, RANGES[rangeKey].days);
  }

  return jsonError('Not found', 404);
}

// ─── Engajamento ────────────────────────────────────────────────────────────

// Colunas de ig_daily_insights somadas no período. 'reach' é deliberadamente somado
// por dia: é alcance diário acumulado, não alcance único do período (a API não dá o
// segundo sem uma chamada por janela). O frontend rotula-o como tal.
const DAY_COLS = ['reach', 'views', 'accounts_engaged', 'total_interactions',
                  'likes', 'comments', 'saves', 'shares', 'replies', 'profile_links_taps'];

const sumCols = (rows) => {
  const out = {};
  for (const c of DAY_COLS) {
    let sum = null;
    for (const r of rows) if (typeof r[c] === 'number') sum = (sum || 0) + r[c];
    out[c] = sum;
  }
  return out;
};

// Rótulo do formato tal como aparece na interface.
function formatLabel(mediaType, productType) {
  if (productType === 'REELS') return 'Reel';
  if (mediaType === 'CAROUSEL_ALBUM') return 'Álbum';
  if (mediaType === 'VIDEO') return 'Vídeo';
  return 'Imagem';
}

async function engagementStats(env, rangeKey, days) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const prevSince = new Date(Date.now() - (2 * days - 1) * 86400000).toISOString().slice(0, 10);

  // Série diária do período + período homólogo anterior (para a variação Δ).
  const cur = await env.DB.prepare(
    `SELECT * FROM ig_daily_insights WHERE day >= ? ORDER BY day ASC`
  ).bind(since).all();
  const prev = await env.DB.prepare(
    `SELECT * FROM ig_daily_insights WHERE day >= ? AND day < ? ORDER BY day ASC`
  ).bind(prevSince, since).all();

  const curRows = cur.results || [];
  const totals = sumCols(curRows);
  const prevTotals = sumCols(prev.results || []);

  const series = curRows.map((r) => ({
    key: r.day,
    label: r.day.slice(8, 10) + '/' + r.day.slice(5, 7),
    reach: r.reach ?? 0,
    views: r.views ?? 0,
    interactions: r.total_interactions ?? 0,
    accounts_engaged: r.accounts_engaged ?? 0,
  }));

  // Seguidores, para contexto e para a taxa de engajamento por seguidor.
  const latest = await env.DB.prepare(
    `SELECT followers_count, media_count, captured_at FROM ig_snapshots ORDER BY day DESC LIMIT 1`
  ).first();

  // Publicações com os respetivos insights. LEFT JOIN: uma peça sem insights ainda
  // aparece na lista com curtidas e comentários da própria media.
  const postsRes = await env.DB.prepare(
    `SELECT p.id, p.caption, p.media_type, p.media_product_type, p.permalink, p.timestamp,
            p.like_count, p.comments_count, p.thumb_key,
            i.reach, i.views, i.total_interactions, i.saved, i.shares,
            i.profile_visits, i.follows, i.avg_watch_time, i.watch_time_total
     FROM ig_posts p LEFT JOIN ig_post_insights i ON i.id = p.id
     ORDER BY p.timestamp DESC LIMIT 12`
  ).all();

  const posts = (postsRes.results || []).map((p) => {
    // Sem insights, as interações caem para curtidas + comentários — subestima, mas
    // mantém o ranking utilizável em vez de mostrar zero.
    const interactions = p.total_interactions != null
      ? p.total_interactions
      : (p.like_count || 0) + (p.comments_count || 0);
    const reach = p.reach ?? null;
    return {
      id: p.id,
      caption: p.caption,
      media_type: p.media_type,
      format: formatLabel(p.media_type, p.media_product_type),
      permalink: p.permalink,
      timestamp: p.timestamp,
      thumb_url: p.thumb_key ? '/api/ig/thumb/' + p.id : null,
      likes: p.like_count || 0,
      comments: p.comments_count || 0,
      saved: p.saved ?? null,
      shares: p.shares ?? null,
      reach,
      views: p.views ?? null,
      profile_visits: p.profile_visits ?? null,
      follows: p.follows ?? null,
      avg_watch_time: p.avg_watch_time ?? null,
      watch_time_total: p.watch_time_total ?? null,
      interactions,
      // Taxa por alcance: de quem viu, quantos reagiram. É a leitura honesta de
      // engajamento — a taxa sobre seguidores infla quando um Reel sai da base.
      rate: reach ? (interactions / reach) * 100 : null,
      has_insights: p.total_interactions != null,
    };
  });

  const ranking = [...posts].sort((a, b) => b.interactions - a.interactions);
  const best = ranking.length ? ranking[0] : null;

  // Desempenho por formato — responde a "o que devo publicar mais?".
  const byFormatMap = {};
  for (const p of posts) {
    const f = (byFormatMap[p.format] ||= { format: p.format, posts: 0, interactions: 0, reach: 0, has_reach: false });
    f.posts++;
    f.interactions += p.interactions;
    if (typeof p.reach === 'number') { f.reach += p.reach; f.has_reach = true; }
  }
  const by_format = Object.values(byFormatMap).map((f) => ({
    format: f.format,
    posts: f.posts,
    interactions: f.interactions,
    avg_interactions: Math.round(f.interactions / f.posts),
    reach: f.has_reach ? f.reach : null,
    rate: f.has_reach && f.reach ? (f.interactions / f.reach) * 100 : null,
  })).sort((a, b) => b.avg_interactions - a.avg_interactions);

  // Melhor dia da semana por interações (das publicações que temos).
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const wdMap = {};
  for (const p of posts) {
    if (!p.timestamp) continue;
    const d = new Date(p.timestamp);
    if (isNaN(d.getTime())) continue;
    const k = d.getUTCDay();
    (wdMap[k] ||= { day: WD[k], posts: 0, interactions: 0 });
    wdMap[k].posts++;
    wdMap[k].interactions += p.interactions;
  }
  const by_weekday = Object.values(wdMap)
    .map((w) => ({ ...w, avg: Math.round(w.interactions / w.posts) }))
    .sort((a, b) => b.avg - a.avg);

  // Demografia: a fotografia mais recente de cada combinação tipo+dimensão.
  const demoDay = await env.DB.prepare(
    `SELECT MAX(day) AS day FROM ig_demographics`
  ).first();
  const demographics = {};
  if (demoDay && demoDay.day) {
    const dRes = await env.DB.prepare(
      `SELECT kind, dimension, bucket, value FROM ig_demographics
       WHERE day = ? ORDER BY value DESC`
    ).bind(demoDay.day).all();
    for (const r of dRes.results || []) {
      const key = r.kind + '_' + r.dimension;
      (demographics[key] ||= []).push({ bucket: r.bucket, value: r.value });
    }
    for (const k of Object.keys(demographics)) demographics[k] = demographics[k].slice(0, 8);
  }

  const followers = latest ? latest.followers_count : null;

  return jsonResponse({
    range: rangeKey,
    period_days: days,
    since,
    platforms: {
      instagram: {
        connected: true,
        handle: '@vyvianavenaadv',
        // Sem uma única linha diária nem posts, a aba mostra o estado "a recolher".
        has_data: curRows.length > 0 || posts.length > 0,
        has_daily: curRows.length > 0,
        days_collected: curRows.length,
        updated_at: latest ? latest.captured_at : null,
        followers_count: followers,
        media_count: latest ? latest.media_count : null,
        totals,
        prev_totals: prevTotals,
        // Interações por conta alcançada no período — a métrica-chave da aba.
        engagement_rate: totals.reach && totals.total_interactions != null
          ? (totals.total_interactions / totals.reach) * 100
          : null,
        series,
        posts,
        ranking,
        best,
        by_format,
        by_weekday,
        demographics,
        demographics_day: demoDay ? demoDay.day : null,
      },
      facebook: {
        connected: false,
        page: 'Vyvian Avena Advogada',
        // O token atual vem do fluxo "Instagram API with Instagram login", que dá acesso
        // à conta do Instagram e a mais nada. As métricas da Página exigem um token de
        // Página obtido por Facebook Login — ligação por fazer, não uma avaria.
        reason: 'A ligação atual é só do Instagram. As métricas da Página do Facebook '
              + 'precisam de um token de Página (Facebook Login com pages_read_engagement).',
      },
    },
  });
}

// Instagram: fotografias diárias de seguidores + últimas publicações com engajamento.
async function instagramStats(env, rangeKey, days) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  // Evolução de seguidores no período (um ponto por dia disponível).
  const snaps = await env.DB.prepare(
    `SELECT day, followers_count FROM ig_snapshots WHERE day >= ? ORDER BY day ASC`
  ).bind(since).all();
  const rows = snaps.results || [];
  const series = rows.map((r) => ({
    key: r.day,
    label: r.day.slice(8, 10) + '/' + r.day.slice(5, 7),   // 'DD/MM'
    followers: r.followers_count,
  }));

  // Estado mais recente (pode não ser exatamente hoje se o cron ainda não correu).
  const latest = await env.DB.prepare(
    `SELECT followers_count, media_count, captured_at FROM ig_snapshots ORDER BY day DESC LIMIT 1`
  ).first();

  // Novos seguidores no período = atual − primeiro ponto do período.
  let new_followers = null;
  if (rows.length >= 2) new_followers = rows[rows.length - 1].followers_count - rows[0].followers_count;
  else if (rows.length === 1) new_followers = 0;

  // Últimas 12 publicações por data de publicação.
  const postsRes = await env.DB.prepare(
    `SELECT id, caption, media_type, permalink, timestamp, like_count, comments_count, thumb_key
     FROM ig_posts ORDER BY timestamp DESC LIMIT 12`
  ).all();
  const posts = (postsRes.results || []).map((p) => ({
    id: p.id,
    caption: p.caption,
    media_type: p.media_type,
    permalink: p.permalink,
    timestamp: p.timestamp,
    like_count: p.like_count,
    comments_count: p.comments_count,
    thumb_url: p.thumb_key ? '/api/ig/thumb/' + p.id : null,
  }));

  return jsonResponse({
    range: rangeKey,
    period_days: days,
    since,
    followers_count: latest ? latest.followers_count : null,
    media_count: latest ? latest.media_count : null,
    new_followers,
    series,
    posts,
    updated_at: latest ? latest.captured_at : null,
    has_data: !!latest,
  });
}

// 1 dia → 24 pontos, um por hora (últimas 24h, UTC).
async function siteHourly(env, rangeKey) {
  const now = Date.now();
  const buckets = [];
  const byHour = {};
  for (let i = 23; i >= 0; i--) {
    const key = new Date(now - i * 3600000).toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    byHour[key] = 0;
    buckets.push(key);
  }
  const since = buckets[0];

  const rows = await env.DB.prepare(
    `SELECT hour, views FROM site_visits_hourly WHERE hour >= ? ORDER BY hour ASC`
  ).bind(since).all();
  for (const r of rows.results || []) if (r.hour in byHour) byHour[r.hour] = r.views;

  const series = buckets.map((h) => ({ key: h, label: h.slice(11, 13) + 'h', views: byHour[h] }));
  const total_views = series.reduce((s, p) => s + p.views, 0);

  // período anterior (24-48h atrás) para a variação Δ
  const prevSince = new Date(now - 47 * 3600000).toISOString().slice(0, 13);
  const prev = await env.DB.prepare(
    `SELECT COALESCE(SUM(views), 0) AS v FROM site_visits_hourly WHERE hour >= ? AND hour < ?`
  ).bind(prevSince, since).first();

  return jsonResponse({
    range: rangeKey,
    granularity: 'hour',
    series,
    total_views,
    total_visitors: null,           // hash de visitante é diário — não faz sentido por hora
    prev_total_views: prev ? prev.v : 0,
    tz: 'UTC',
  });
}

// 7 / 15 / 30 dias → um ponto por dia (UTC), com views e visitantes únicos.
async function siteDaily(env, rangeKey, days) {
  const now = Date.now();
  const buckets = [];
  const viewsByDay = {};
  const visByDay = {};
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now - i * 86400000).toISOString().slice(0, 10); // 'YYYY-MM-DD'
    viewsByDay[key] = 0;
    visByDay[key] = 0;
    buckets.push(key);
  }
  const since = buckets[0];

  const vrows = await env.DB.prepare(
    `SELECT substr(hour, 1, 10) AS day, SUM(views) AS views
     FROM site_visits_hourly WHERE substr(hour, 1, 10) >= ? GROUP BY day`
  ).bind(since).all();
  for (const r of vrows.results || []) if (r.day in viewsByDay) viewsByDay[r.day] = r.views;

  const prows = await env.DB.prepare(
    `SELECT day, COUNT(*) AS visitors FROM site_visitors_daily WHERE day >= ? GROUP BY day`
  ).bind(since).all();
  for (const r of prows.results || []) if (r.day in visByDay) visByDay[r.day] = r.visitors;

  const series = buckets.map((d) => ({
    key: d,
    label: d.slice(8, 10) + '/' + d.slice(5, 7),   // 'DD/MM'
    views: viewsByDay[d],
    visitors: visByDay[d],
  }));
  const total_views = series.reduce((s, p) => s + p.views, 0);
  const total_visitors = series.reduce((s, p) => s + p.visitors, 0);

  // período anterior (mesma duração, imediatamente antes) para a variação Δ
  const prevSince = new Date(now - (2 * days - 1) * 86400000).toISOString().slice(0, 10);
  const prev = await env.DB.prepare(
    `SELECT COALESCE(SUM(views), 0) AS v FROM site_visits_hourly
     WHERE substr(hour, 1, 10) >= ? AND substr(hour, 1, 10) < ?`
  ).bind(prevSince, since).first();

  return jsonResponse({
    range: rangeKey,
    granularity: 'day',
    series,
    total_views,
    total_visitors,
    prev_total_views: prev ? prev.v : 0,
    tz: 'UTC',
  });
}
