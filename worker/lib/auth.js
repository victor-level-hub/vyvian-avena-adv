// worker/lib/auth.js
// Verificação de password (PBKDF2-SHA256), JWT HS256, sessões em KV.

// ============================================================
// PASSWORD VERIFY
// ============================================================
// Formato armazenado: pbkdf2-sha256$<iterations>$<base64salt>$<base64hash>

export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    throw new Error('Invalid password hash format');
  }
  const iterations = parseInt(parts[1], 10);
  const salt = base64ToBytes(parts[2]);
  const expectedHash = base64ToBytes(parts[3]);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );
  const derivedHash = new Uint8Array(derivedBits);

  // Comparação constant-time
  if (derivedHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHash.length; i++) {
    diff |= derivedHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}

// ============================================================
// JWT HS256
// ============================================================

export async function signJWT(payload, secret, ttlSeconds = 86400 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = bytesToBase64Url(new Uint8Array(signature));

  return `${data}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signature = base64UrlToBytes(sigB64);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(data)
  );
  if (!isValid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;

  return payload;
}

// ============================================================
// EXTRAIR SESSÃO DO REQUEST
// ============================================================

export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;

  // Verifica se a sessão ainda existe no KV (permite revogação)
  if (payload.jti) {
    const kvSession = await env.SESSIONS.get(payload.jti);
    if (!kvSession) return null;
  }

  return payload;
}

// ============================================================
// HELPERS BASE64
// ============================================================

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return base64ToBytes(b64);
}
