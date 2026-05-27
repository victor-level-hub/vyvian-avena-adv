// src/admin/auth.js
// Autenticação MOCK — placeholder até integrarmos backend real (D1 + Workers + KV).
// AVISO: A senha abaixo é visível no JS bundle público do site.
// NÃO é segurança real — apenas filtro de visitantes curiosos durante a fase de demo.
// Será substituída por auth com JWT + bcrypt + sessões em KV quando entrarmos no backend.

const AUTH_KEY = 'vyvian_admin_session';
const DEMO_PASSWORD = 'A299792xyz!'; // TODO: remover quando backend real entrar

export function login(email, password) {
  if (!email || !password) {
    return { ok: false, error: 'Preencha e-mail e palavra-passe.' };
  }
  if (password !== DEMO_PASSWORD) {
    return { ok: false, error: 'Credenciais inválidas.' };
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
