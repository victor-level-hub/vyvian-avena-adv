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

  return jsonError('Not found', 404);
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
