// src/admin/auth.js
// Autenticação MOCK — placeholder até integrarmos Supabase Auth.
// Aceita qualquer e-mail/palavra-passe e grava flag em sessionStorage.

const AUTH_KEY = 'vyvian_admin_session';

export function login(email, password) {
  // Validação simulada — qualquer entrada não-vazia é aceite
  if (!email || !password) {
    return { ok: false, error: 'Preencha e-mail e palavra-passe.' };
  }
  const session = {
    email,
    name: 'Vyvian Avena',
    initials: 'V',
    role: 'admin',
    loggedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return { ok: true, session };
}

export function logout() {
  sessionStorage.removeItem(AUTH_KEY);
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return getSession() !== null;
}
