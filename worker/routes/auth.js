// worker/routes/auth.js
import { jsonResponse, jsonError } from '../lib/response.js';
import { verifyPassword, signJWT, requireAuth } from '../lib/auth.js';

export async function handleAuth(request, env, path) {
  // POST /api/auth/login
  if (path === '/api/auth/login' && request.method === 'POST') {
    return login(request, env);
  }
  // POST /api/auth/logout
  if (path === '/api/auth/logout' && request.method === 'POST') {
    return logout(request, env);
  }
  // GET /api/auth/me
  if (path === '/api/auth/me' && request.method === 'GET') {
    return me(request, env);
  }
  return jsonError('Not found', 404);
}

async function login(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { email, password } = body || {};
  // Exigir texto: um email que seja objeto ou array ia direto ao .bind(), o D1
  // lançava e o catch global devolvia 500 com detalhe interno a um anónimo.
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return jsonError('Preencha e-mail e palavra-passe.', 400);
  }
  // Os utilizadores são criados sempre em minúsculas (worker/routes/config.js:130).
  // Sem normalizar aqui, quem escrevesse "Dra@Exemplo.pt" — o que o teclado do
  // telemóvel faz sozinho — levava "Credenciais inválidas" com a password certa.
  const emailNorm = email.trim().toLowerCase();

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, name, initials, role, cargo, phone, permissions, photo_key, status FROM users WHERE lower(trim(email)) = ?'
  ).bind(emailNorm).first();

  // Mensagem genérica para não revelar se o utilizador existe — e o MESMO trabalho
  // criptográfico nos dois casos. Sem isto, um e-mail inexistente respondia de
  // imediato enquanto um existente corria o PBKDF2 de 100 000 iterações: a
  // diferença de dezenas de milissegundos revelava que contas existem, apesar de a
  // mensagem ser igual. Verifica-se contra um hash-isco antes de responder.
  const HASH_ISCO = 'pbkdf2-sha256$100000$aXNjby1zYWx0LTE2Ynl0ZQ==$aXNjby1oYXNoLXBhcmEtY29tcGFyYWNhbw==';
  if (!user) {
    await verifyPassword(password, HASH_ISCO).catch(() => false);
    return jsonError('Credenciais inválidas.', 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return jsonError('Credenciais inválidas.', 401);
  }

  // Gera ID único da sessão (jti) e guarda em KV (permite revogação)
  const jti = crypto.randomUUID();
  const ttlSeconds = 60 * 60 * 24 * 7; // 7 dias

  await env.SESSIONS.put(
    jti,
    JSON.stringify({
      userId: user.id,
      email: user.email,
      loggedAt: new Date().toISOString(),
      userAgent: request.headers.get('User-Agent') || '',
    }),
    { expirationTtl: ttlSeconds }
  );

  const token = await signJWT(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      initials: user.initials,
      role: user.role,
      jti,
    },
    env.JWT_SECRET,
    ttlSeconds
  );

  let permissions = ['*'];
  try { const p = JSON.parse(user.permissions || '["*"]'); if (Array.isArray(p)) permissions = p; } catch {}

  return jsonResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      initials: user.initials,
      role: user.role,
      cargo: user.cargo || null,
      phone: user.phone || null,
      permissions,
      has_photo: !!user.photo_key,
    },
  });
}

async function logout(request, env) {
  const session = await requireAuth(request, env);
  if (!session) return jsonError('Unauthorized', 401);

  // Revoga sessão removendo do KV
  if (session.jti) {
    await env.SESSIONS.delete(session.jti);
  }
  return jsonResponse({ ok: true });
}

async function me(request, env) {
  const session = await requireAuth(request, env);
  if (!session) return jsonError('Unauthorized', 401);

  // dados frescos da BD (permissões podem ter mudado depois do login)
  const u = await env.DB.prepare(
    'SELECT id, email, name, initials, role, cargo, phone, permissions, photo_key FROM users WHERE id = ?'
  ).bind(session.sub).first();
  if (!u) return jsonError('Unauthorized', 401);
  let permissions = ['*'];
  try { const p = JSON.parse(u.permissions || '["*"]'); if (Array.isArray(p)) permissions = p; } catch {}

  return jsonResponse({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      initials: u.initials,
      role: u.role,
      cargo: u.cargo || null,
      phone: u.phone || null,
      permissions,
      has_photo: !!u.photo_key,
    },
  });
}
