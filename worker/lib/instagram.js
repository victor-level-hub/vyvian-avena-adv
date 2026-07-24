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
      `${IG_API}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count` +
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
        `INSERT INTO ig_posts (id, caption, media_type, permalink, timestamp, like_count, comments_count, thumb_key, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           caption        = excluded.caption,
           media_type     = excluded.media_type,
           permalink      = excluded.permalink,
           timestamp      = excluded.timestamp,
           like_count     = excluded.like_count,
           comments_count = excluded.comments_count,
           thumb_key      = COALESCE(excluded.thumb_key, ig_posts.thumb_key),
           fetched_at     = datetime('now')`
      ).bind(
        p.id, p.caption ?? null, p.media_type ?? null, p.permalink ?? null,
        p.timestamp ?? null, p.like_count ?? 0, p.comments_count ?? 0, thumbKey
      ).run();
      summary.posts++;
    }
  } catch (e) {
    summary.errors.push('media: ' + (e && e.message));
  }

  return summary;
}
