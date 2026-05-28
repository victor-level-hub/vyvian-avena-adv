// src/admin/apiClient.js
// Cliente HTTP para a API do Worker.

const TOKEN_KEY = 'vyvian_admin_token';

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
}

export function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ============ AUTH ============
export const auth = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
};

// ============ CLIENTS ============
export const clients = {
  list: (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return request(`/api/clients${qs ? '?' + qs : ''}`);
  },
  get: (id) => request(`/api/clients/${id}`),
  create: (data) => request('/api/clients', { method: 'POST', body: data }),
  update: (id, data) => request(`/api/clients/${id}`, { method: 'PUT', body: data }),
  remove: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
};

// ============ INSTALLMENTS ============
export const installments = {
  list: (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return request(`/api/installments${qs ? '?' + qs : ''}`);
  },
  upcoming: (days = 30) => request(`/api/installments/upcoming?days=${days}`),
  get: (id) => request(`/api/installments/${id}`),
  markPaid: (id, paidDate, paymentMethod) =>
    request(`/api/installments/${id}`, {
      method: 'PATCH',
      body: { action: 'mark_paid', paid_date: paidDate, payment_method: paymentMethod },
    }),
  update: (id, data) => request(`/api/installments/${id}`, { method: 'PATCH', body: data }),
  remove: (id) => request(`/api/installments/${id}`, { method: 'DELETE' }),
};

// ============ NOTIFICATIONS ============
export const notifications = {
  listRules: (clientId) => request(`/api/notifications/rules${clientId ? '?client_id=' + clientId : ''}`),
  createRule: (data) => request('/api/notifications/rules', { method: 'POST', body: data }),
  updateRule: (id, data) => request(`/api/notifications/rules/${id}`, { method: 'PATCH', body: data }),
  removeRule: (id) => request(`/api/notifications/rules/${id}`, { method: 'DELETE' }),
  listTemplates: () => request('/api/notifications/templates'),
  getTemplate: (id) => request(`/api/notifications/templates/${id}`),
  updateTemplate: (id, data) => request(`/api/notifications/templates/${id}`, { method: 'PUT', body: data }),
  listLog: (limit = 50) => request(`/api/notifications/log?limit=${limit}`),
};

// ============ DASHBOARD ============
export const dashboard = {
  get: () => request('/api/dashboard'),
};
