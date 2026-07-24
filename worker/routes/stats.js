// worker/routes/stats.js
// Estatísticas para a Área Privada.
// FASE A: acessos ao site (contador próprio no D1 — ver worker/lib/visits.js).
// (Instagram fica para a Fase B, noutro endpoint.)
import { jsonResponse, jsonError } from '../lib/response.js';

const RANGES = {
  '1d':  { days: 1,  granularity: 'hour' },
  '7d':  { days: 7,  granularity: 'day' },
  '15d': { days: 15, granularity: 'day' },
  '30d': { days: 30, granularity: 'day' },
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

  return jsonError('Not found', 404);
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
