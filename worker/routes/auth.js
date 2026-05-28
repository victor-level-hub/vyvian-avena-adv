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
  if (!email || !password) {
    return jsonError('Preencha e-mail e palavra-passe.', 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, name, initials, role FROM users WHERE email = ?'
  ).bind(email).first();

  // Mensagem genérica para não revelar se o utilizador existe
  if (!user) {
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

  return jsonResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      initials: user.initials,
      role: user.role,
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

  return jsonResponse({
    user: {
      id: session.sub,
      email: session.email,
      name: session.name,
      initials: session.initials,
      role: session.role,
    },
  });
}
