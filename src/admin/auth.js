// src/admin/auth.js
// Autenticação via API (Worker + D1 + KV).
// Token JWT armazenado em sessionStorage.

import { auth as authApi, setToken, clearToken, getToken } from './apiClient.js';

const USER_KEY = 'vyvian_admin_user';

export async function login(email, password) {
  if (!email || !password) {
    return { ok: false, error: 'Preencha e-mail e palavra-passe.' };
  }
  try {
    const res = await authApi.login(email, password);
    if (res.token && res.user) {
      setToken(res.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
      return { ok: true, session: res.user };
    }
    return { ok: false, error: 'Resposta inválida do servidor.' };
  } catch (err) {
    return { ok: false, error: err.message || 'Erro de comunicação.' };
  }
}

export async function logout() {
  try { await authApi.logout(); } catch {}
  clearToken();
  try { sessionStorage.removeItem(USER_KEY); } catch {}
}

export function getSession() {
  try {
    if (!getToken()) return null;
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!getToken() && !!getSession();
}
