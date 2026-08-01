// worker/lib/instagram.js
// Fase B — sincronização das estatísticas do Instagram (@vyvianavenaadv).
// API oficial "Instagram API with Instagram login" (graph.instagram.com).
//
// O token de longa duração (60 dias) vive no KV (SESSIONS, chave 'ig:token'). É semeado
// a partir do segredo IG_SEED_TOKEN na primeira execução e auto-renovado quando falta
// pouco para expirar (ig_refresh_token — não precisa de app secret). O KV é a fonte de
// verdade porque, ao contrário de um segredo, o Worker pode reescrevê-lo em runtime.

const IG_API = 'https://graph.instagram.com';
const KV_KEY = 'ig:token';
const REFRESH_MARGIN_S = 10 * 24 * 3600;   // renovar quando faltarem < 10 dias
const SEED_TTL_S = 50 * 24 * 3600;         // validade assumida no arranque (margem)
const POSTS_LIMIT = 12;
const THUMB_PREFIX = 'ig/thumbs/';

// ─── engajamento (0027) ─────────────────────────────────────────────────────
// O Worker tem um tecto de subrequests por invocação, e o sync base já gasta ~14
// (perfil + media + miniaturas). Os limites abaixo mantêm a corrida diária folgada:
// os dias em falta recuperam-se ao longo de algumas noites em vez de todos de uma vez.
const DAY_REFRESH = 2;    // dias recentes sempre revistos (os valores assentam com atraso)
const DAY_BACKFILL = 30;  // horizonte de histórico a preencher
const DAY_MAX_CALLS = 7;  // no máximo estes pedidos de dias por corrida

// Métricas de conta com period=day. Pedidas em bloco; se a Meta rejeitar o bloco
// (métrica descontinuada), o helper repete uma a uma e guarda as que responderem.
const DAY_METRICS = [
  'reach', 'views', 'accounts_engaged', 'total_interactions',
  'likes', 'comments', 'saves', 'shares', 'replies', 'profile_links_taps',
];

// Métricas por publicação — variam com o tipo de peça.
const REELS_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares',
                       'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];
const FEED_METRICS  = ['reach', 'views', 'likes', 'comments', 'saved', 'shares',
                       'total_interactions', 'profile_visits', 'follows'];

// Demografia: 'follower' é quem segue, 'engaged' é quem reagiu no período.
const DEMOGRAPHICS = [
  { kind: 'follower', metric: 'follower_demographics',          breakdown: 'country' },
  { kind: 'follower', metric: 'follower_demographics',          breakdown: 'city' },
  { kind: 'follower', metric: 'follower_demographics',          breakdown: 'age' },
  { kind: 'follower', metric: 'follower_demographics',          breakdown: 'gender' },
  { kind: 'engaged',  metric: 'engaged_audience_demographics',  breakdown: 'country' },
  { kind: 'engaged',  metric: 'engaged_audience_demographics',  breakdown: 'age' },
];

// ─── token ────────────────────────────────────────────────────────────────

async function loadToken(env) {
  let rec = null;
  try { rec = await env.SESSIONS.get(KV_KEY, 'json'); } catch { /* ignore */ }
  if (rec && rec.access_token) return rec;

  // arranque: copiar o segredo para o KV (a partir daqui o KV manda)
  if (env.IG_SEED_TOKEN) {
    const now = Math.floor(Date.now() / 1000);
    const seeded = { access_token: env.IG_SEED_TOKEN, expires_at: now + SEED_TTL_S };
    try { await env.SESSIONS.put(KV_KEY, JSON.stringify(seeded)); } catch { /* ignore */ }
    return seeded;
  }
  return null;
}

// Devolve um token válido, renovando-o se estiver perto de expirar.
async function ensureToken(env, summary) {
  const rec = await loadToken(env);
  if (!rec) throw new Error('sem token do Instagram (IG_SEED_TOKEN em falta)');

  const now = Math.floor(Date.now() / 1000);
  if (rec.expires_at && rec.expires_at - now > REFRESH_MARGIN_S) {
    return rec.access_token;                        // ainda válido com folga
  }

  try {
    const url = `${IG_API}/refresh_access_token?grant_type=ig_refresh_token` +
                `&access_token=${encodeURIComponent(rec.access_token)}`;
    const r = await fetch(url);
    const j = await r.json();
    if (r.ok && j.access_token) {
      const updated = { access_token: j.access_token, expires_at: now + (j.expires_in || 60 * 24 * 3600) };
      try { await env.SESSIONS.put(KV_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      if (summary) summary.refreshed = true;
      return updated.access_token;
    }
    console.error('ig refresh falhou:', JSON.stringify(j).slice(0, 200));
  } catch (e) {
    console.error('ig refresh erro:', e && e.message);
  }
  return rec.access_token;                           // tenta usar o atual mesmo assim
}

// ─── sync ───────────────────────────────────────────────────────────────────

export async function syncInstagram(env) {
  const summary = { followers: null, media_count: null, posts: 0, thumbs: 0, refreshed: false, errors: [] };
  const token = await ensureToken(env, summary);

  // 1) Perfil — seguidores + nº de publicações → fotografia do dia.
  try {
    const me = await fetch(
      `${IG_API}/me?fields=followers_count,media_count&access_token=${encodeURIComponent(token)}`
    ).then((r) => r.json());

    if (me && typeof me.followers_count === 'number') {
      const day = new Date().toISOString().slice(0, 10);
      await env.DB.prepare(
        `INSERT INTO ig_snapshots (day, followers_count, media_count) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET followers_count = excluded.followers_count,
                                        media_count     = excluded.media_count,
                                        captured_at     = datetime('now')`
      ).bind(day, me.followers_count, me.media_count ?? null).run();
      summary.followers = me.followers_count;
      summary.media_count = me.media_count ?? null;
    } else {
      summary.errors.push('perfil: ' + JSON.stringify(me).slice(0, 160));
    }
  } catch (e) {
    summary.errors.push('perfil: ' + (e && e.message));
  }

  // 2) Últimas publicações + engajamento (upsert por id; miniatura → R2).
  try {
    const media = await fetch(
      `${IG_API}/me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count` +
      `&limit=${POSTS_LIMIT}&access_token=${encodeURIComponent(token)}`
    ).then((r) => r.json());

    const posts = (media && media.data) || [];
    for (const p of posts) {
      // Os URLs de imagem do Instagram expiram — copiamos a miniatura para o R2.
      let thumbKey = null;
      const imgUrl = p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url;
      if (imgUrl) {
        const key = THUMB_PREFIX + p.id + '.jpg';
        try {
          const img = await fetch(imgUrl);
          if (img.ok && img.body) {
            await env.RECIBOS.put(key, img.body, {
              httpMetadata: { contentType: img.headers.get('content-type') || 'image/jpeg' },
            });
            thumbKey = key;
            summary.thumbs++;
          }
        } catch { /* miniatura é best-effort */ }
      }

      await env.DB.prepare(
        `INSERT INTO ig_posts (id, caption, media_type, media_product_type, permalink, timestamp, like_count, comments_count, thumb_key, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           caption            = excluded.caption,
           media_type         = excluded.media_type,
           media_product_type = COALESCE(excluded.media_product_type, ig_posts.media_product_type),
           permalink          = excluded.permalink,
           timestamp          = excluded.timestamp,
           like_count         = excluded.like_count,
           comments_count     = excluded.comments_count,
           thumb_key          = COALESCE(excluded.thumb_key, ig_posts.thumb_key),
           fetched_at         = datetime('now')`
      ).bind(
        p.id, p.caption ?? null, p.media_type ?? null, p.media_product_type ?? null,
        p.permalink ?? null, p.timestamp ?? null, p.like_count ?? 0, p.comments_count ?? 0, thumbKey
      ).run();
      summary.posts++;
    }
  } catch (e) {
    summary.errors.push('media: ' + (e && e.message));
  }

  // 3) Engajamento (0027): métricas diárias da conta, insights por publicação e demografia.
  //    Cada bloco isola os seus erros — um insight em falta nunca derruba o resto do sync.
  summary.engagement = { days: 0, posts: 0, demographics: 0 };
  try {
    summary.engagement.days = await syncDailyInsights(env, token, summary);
  } catch (e) {
    summary.errors.push('insights/dia: ' + (e && e.message));
  }
  try {
    summary.engagement.posts = await syncPostInsights(env, token, summary);
  } catch (e) {
    summary.errors.push('insights/posts: ' + (e && e.message));
  }
  try {
    summary.engagement.demographics = await syncDemographics(env, token, summary);
  } catch (e) {
    summary.errors.push('insights/demografia: ' + (e && e.message));
  }

  return summary;
}

// ─── engajamento: helpers ───────────────────────────────────────────────────

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const unixAtMidnight = (day) => Math.floor(Date.parse(day + 'T00:00:00Z') / 1000);

// Um valor de insight chega em 'total_value.value' (metric_type=total_value) ou no
// primeiro elemento de 'values' (métricas de tempo de vida da media). Normalizamos aqui.
function readMetric(entry) {
  if (!entry) return null;
  if (entry.total_value && typeof entry.total_value.value === 'number') return entry.total_value.value;
  if (Array.isArray(entry.values) && entry.values.length) {
    const v = entry.values[entry.values.length - 1].value;
    if (typeof v === 'number') return v;
  }
  return null;
}

// Pede um conjunto de métricas de uma vez. Se a Meta recusar o conjunto (basta uma
// métrica descontinuada para o pedido inteiro falhar com erro 100), repete métrica a
// métrica e devolve as que responderam — assim a aba degrada em vez de ficar vazia.
async function fetchMetrics(node, token, metrics, params, summary, label) {
  const call = async (list) => {
    const qs = new URLSearchParams({ ...params, metric: list.join(','), access_token: token });
    const r = await fetch(`${IG_API}/${node}/insights?${qs}`);
    const j = await r.json();
    if (j && j.error) throw new Error(j.error.message || 'erro da API');
    return (j && j.data) || [];
  };

  const out = {};
  try {
    for (const d of await call(metrics)) out[d.name] = readMetric(d);
    return out;
  } catch (e) {
    if (metrics.length === 1) {
      if (summary) summary.errors.push(`${label}/${metrics[0]}: ` + (e && e.message));
      return out;
    }
  }

  for (const m of metrics) {
    try {
      for (const d of await call([m])) out[d.name] = readMetric(d);
    } catch (e) {
      if (summary) summary.errors.push(`${label}/${m}: ` + String(e && e.message).slice(0, 90));
    }
  }
  return out;
}

// Métricas de conta, uma linha por dia. Revê sempre os dias mais recentes (os números
// da Meta assentam com atraso de algumas horas) e aproveita as chamadas que sobram para
// preencher buracos mais antigos, do mais recente para o mais antigo.
async function syncDailyInsights(env, token, summary) {
  const today = dayKey(Date.now());
  const wanted = [];
  for (let i = 0; i < DAY_BACKFILL; i++) wanted.push(dayKey(Date.now() - i * 86400000));

  const known = new Set();
  const rows = await env.DB.prepare(
    `SELECT day FROM ig_daily_insights WHERE day >= ?`
  ).bind(wanted[wanted.length - 1]).all();
  for (const r of rows.results || []) known.add(r.day);

  const todo = wanted.filter((d, i) => i < DAY_REFRESH || !known.has(d)).slice(0, DAY_MAX_CALLS);

  let done = 0;
  for (const day of todo) {
    const since = unixAtMidnight(day);
    const m = await fetchMetrics('me', token, DAY_METRICS, {
      period: 'day',
      metric_type: 'total_value',
      since: String(since),
      until: String(since + 86400),
    }, summary, 'dia ' + day);

    if (!Object.keys(m).length) continue;

    await env.DB.prepare(
      `INSERT INTO ig_daily_insights
         (day, reach, views, accounts_engaged, total_interactions, likes, comments,
          saves, shares, replies, profile_links_taps, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(day) DO UPDATE SET
         reach              = COALESCE(excluded.reach, ig_daily_insights.reach),
         views              = COALESCE(excluded.views, ig_daily_insights.views),
         accounts_engaged   = COALESCE(excluded.accounts_engaged, ig_daily_insights.accounts_engaged),
         total_interactions = COALESCE(excluded.total_interactions, ig_daily_insights.total_interactions),
         likes              = COALESCE(excluded.likes, ig_daily_insights.likes),
         comments           = COALESCE(excluded.comments, ig_daily_insights.comments),
         saves              = COALESCE(excluded.saves, ig_daily_insights.saves),
         shares             = COALESCE(excluded.shares, ig_daily_insights.shares),
         replies            = COALESCE(excluded.replies, ig_daily_insights.replies),
         profile_links_taps = COALESCE(excluded.profile_links_taps, ig_daily_insights.profile_links_taps),
         captured_at        = datetime('now')`
    ).bind(
      day, m.reach ?? null, m.views ?? null, m.accounts_engaged ?? null,
      m.total_interactions ?? null, m.likes ?? null, m.comments ?? null,
      m.saves ?? null, m.shares ?? null, m.replies ?? null, m.profile_links_taps ?? null
    ).run();
    done++;
    if (day === today) summary.engagement_today = m;
  }
  return done;
}

// Insights de tempo de vida por publicação, para as peças que já temos em ig_posts.
// O conjunto de métricas depende do tipo: os Reels dão tempo de visualização, o feed
// dá visitas ao perfil e seguidores ganhos.
async function syncPostInsights(env, token, summary) {
  const res = await env.DB.prepare(
    `SELECT id, media_type, media_product_type FROM ig_posts ORDER BY timestamp DESC LIMIT ?`
  ).bind(POSTS_LIMIT).all();

  let done = 0;
  for (const p of res.results || []) {
    const isReel = p.media_product_type === 'REELS';
    const m = await fetchMetrics(p.id, token, isReel ? REELS_METRICS : FEED_METRICS, {},
                                 summary, 'post ' + p.id);
    if (!Object.keys(m).length) continue;

    await env.DB.prepare(
      `INSERT INTO ig_post_insights
         (id, reach, views, total_interactions, likes, comments, saved, shares,
          profile_visits, follows, avg_watch_time, watch_time_total, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         reach              = COALESCE(excluded.reach, ig_post_insights.reach),
         views              = COALESCE(excluded.views, ig_post_insights.views),
         total_interactions = COALESCE(excluded.total_interactions, ig_post_insights.total_interactions),
         likes              = COALESCE(excluded.likes, ig_post_insights.likes),
         comments           = COALESCE(excluded.comments, ig_post_insights.comments),
         saved              = COALESCE(excluded.saved, ig_post_insights.saved),
         shares             = COALESCE(excluded.shares, ig_post_insights.shares),
         profile_visits     = COALESCE(excluded.profile_visits, ig_post_insights.profile_visits),
         follows            = COALESCE(excluded.follows, ig_post_insights.follows),
         avg_watch_time     = COALESCE(excluded.avg_watch_time, ig_post_insights.avg_watch_time),
         watch_time_total   = COALESCE(excluded.watch_time_total, ig_post_insights.watch_time_total),
         updated_at         = datetime('now')`
    ).bind(
      p.id, m.reach ?? null, m.views ?? null, m.total_interactions ?? null,
      m.likes ?? null, m.comments ?? null, m.saved ?? null, m.shares ?? null,
      m.profile_visits ?? null, m.follows ?? null,
      m.ig_reels_avg_watch_time ?? null, m.ig_reels_video_view_total_time ?? null
    ).run();
    done++;
  }
  return done;
}

// Demografia de seguidores e de quem interage. Uma fotografia por dia — se já houver
// uma de hoje, não repetimos (poupa 6 chamadas quando o sync corre mais do que uma vez).
async function syncDemographics(env, token, summary) {
  const today = dayKey(Date.now());
  const seen = await env.DB.prepare(
    `SELECT 1 FROM ig_demographics WHERE day = ? LIMIT 1`
  ).bind(today).first();
  if (seen) return 0;

  let done = 0;
  for (const spec of DEMOGRAPHICS) {
    const qs = new URLSearchParams({
      metric: spec.metric,
      period: 'lifetime',
      timeframe: 'last_30_days',
      metric_type: 'total_value',
      breakdown: spec.breakdown,
      access_token: token,
    });

    let entry = null;
    try {
      const j = await fetch(`${IG_API}/me/insights?${qs}`).then((r) => r.json());
      // Contas com menos de 100 seguidores não têm demografia — é esperado, não é falha.
      if (j && j.error) {
        summary.errors.push(`demografia/${spec.kind}/${spec.breakdown}: ` +
                            String(j.error.message).slice(0, 90));
        continue;
      }
      entry = (j.data || [])[0];
    } catch (e) {
      summary.errors.push(`demografia/${spec.kind}/${spec.breakdown}: ` + (e && e.message));
      continue;
    }

    const groups = (entry && entry.total_value && entry.total_value.breakdowns) || [];
    for (const g of groups) {
      for (const r of g.results || []) {
        const bucket = (r.dimension_values || [])[0];
        if (!bucket || typeof r.value !== 'number') continue;
        await env.DB.prepare(
          `INSERT INTO ig_demographics (day, kind, dimension, bucket, value)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(day, kind, dimension, bucket) DO UPDATE SET value = excluded.value`
        ).bind(today, spec.kind, spec.breakdown, bucket, r.value).run();
        done++;
      }
    }
  }
  return done;
}
