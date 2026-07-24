// worker/lib/visits.js
// Contador de acessos ao site público — próprio, sem cookies (RGPD ok).
//
// A contagem é feita por um "beacon": o site público dispara POST /api/hit a cada
// page view (ver src/lib/analytics.js + Layout.jsx). Como /api/* nunca corresponde a
// um asset estático, o Worker é SEMPRE invocado para o beacon (ao contrário das páginas
// servidas diretamente do storage de assets). Tudo protegido por try/catch e escrito
// via ctx.waitUntil — nunca bloqueia nem parte a resposta.

// Robôs / pré-visualizadores conhecidos (não contam como acesso de pessoa).
const BOT_RE = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternalhit|facebot|embedly|quora|pinterest|slackbot|telegram|whatsapp|discord|twitter|linkedinbot|preview|monitor|uptime|curl|wget|libwww|python-requests|axios|node-fetch|go-http|headless|phantom|lighthouse|gtmetrix|pingdom|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|applebot|screaming|scan/i;

// O beacon é legítimo? (disparado pelo próprio site, por um browser real)
export function isValidHit(request) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOT_RE.test(ua)) return false;          // sem UA ou robô → não conta
  // Mesma origem: o beacon vem do próprio site. Se houver Origin/Referer, tem de bater
  // com o host do pedido; se estiver ausente (alguns browsers omitem), o filtro de UA
  // acima já protege o suficiente para um contador de vaidade.
  try {
    const host = new URL(request.url).host;
    const src = request.headers.get('Origin') || request.headers.get('Referer') || '';
    if (src && new URL(src).host !== host) return false;
  } catch {
    return false;
  }
  return true;
}

// Regista um page view no D1. Silencioso em erro — nunca deve partir o serviço.
export async function recordVisit(request, env) {
  try {
    if (!env.DB) return;
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);        // 'YYYY-MM-DDTHH' (UTC)
    const day = now.toISOString().slice(0, 10);         // 'YYYY-MM-DD'    (UTC)

    // page views por hora (incremento atómico)
    await env.DB.prepare(
      `INSERT INTO site_visits_hourly (hour, views) VALUES (?, 1)
       ON CONFLICT(hour) DO UPDATE SET views = views + 1`
    ).bind(hour).run();

    // visitante único do dia (sem cookies; ignora se já visto hoje)
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const secret = env.JWT_SECRET || env.VISITS_SALT || 'vyvian-visits-salt';
    const visitorHash = await hashVisitor(day, ip, ua, secret);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO site_visitors_daily (day, visitor_hash) VALUES (?, ?)`
    ).bind(day, visitorHash).run();
  } catch (err) {
    console.error('recordVisit falhou:', err && err.message);
  }
}

// SHA-256(dia|ip|ua|segredo) → hex de 128 bits. Irreversível; como o dia entra no
// hash, o mesmo visitante gera hashes diferentes em dias diferentes (privacidade).
async function hashVisitor(day, ip, ua, secret) {
  const data = new TextEncoder().encode(`${day}|${ip}|${ua}|${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}
