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
// ── Logo do cliente ──
export const clientLogo = {
  async upload(clientId, file) {
    const token = getToken();
    const res = await fetch(`/api/clients/${clientId}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { const e = await res.json(); m = e.error || m; } catch {} throw new Error(m); }
    return res.json();
  },
  async fetchUrl(clientId) {
    const token = getToken();
    const res = await fetch(`/api/clients/${clientId}/logo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  remove: (clientId) => request(`/api/clients/${clientId}/logo`, { method: 'DELETE' }),
};

export const installments = {
  list: (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return request(`/api/installments${qs ? '?' + qs : ''}`);
  },
  create: (data) => request('/api/installments', { method: 'POST', body: data }),
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
  getOwnerPrefs: () => request('/api/notifications/owner-prefs'),
  updateOwnerPrefs: (data) => request('/api/notifications/owner-prefs', { method: 'PUT', body: data }),
  getTemplate: (id) => request(`/api/notifications/templates/${id}`),
  updateTemplate: (id, data) => request(`/api/notifications/templates/${id}`, { method: 'PUT', body: data }),
  // listLog(50) ou listLog({ limit, client_id })
  listLog: (opts = 50) => {
    const o = typeof opts === 'number' ? { limit: opts } : opts;
    const qs = new URLSearchParams();
    qs.set('limit', o.limit || 50);
    if (o.client_id) qs.set('client_id', o.client_id);
    return request(`/api/notifications/log?${qs.toString()}`);
  },
};

// ============ DASHBOARD ============
export const dashboard = {
  // days: janela (em dias) dos próximos vencimentos — default 30 no worker
  get: (days) => request('/api/dashboard' + (days ? `?upcoming_days=${encodeURIComponent(days)}` : '')),
};

// ============ ESTATÍSTICAS ============
export const stats = {
  // range: '1d' | '7d' | '15d' | '30d' — acessos ao site
  site: (range = '7d') => request(`/api/stats/site?range=${encodeURIComponent(range)}`),
};

// ============ INSIGHTS (Redes Sociais → Insights) ============
export const insights = {
  // Pesquisa 10 novos temas (demora ~1-2 min — a IA pesquisa na web).
  refresh: (existingTitles = []) =>
    request('/api/insights/refresh', { method: 'POST', body: { existing_titles: existingTitles } }),
  topics: () => request('/api/insights/topics'),

  generateArticle: (topicId) => request('/api/insights/articles', { method: 'POST', body: { topic_id: topicId } }),
  getArticle: (id) => request(`/api/insights/articles/${id}`),
  saveArticle: (id, data) => request(`/api/insights/articles/${id}`, { method: 'PATCH', body: data }),

  // Gera 4 opções de imagem (Gemini; fallback Recraft). Repetir = gerar todas de novo.
  generateImages: (articleId) => request(`/api/insights/articles/${articleId}/images`, { method: 'POST', body: {} }),
  chooseImage: (articleId, imageId) =>
    request(`/api/insights/articles/${articleId}/escolher-imagem`, { method: 'POST', body: { image_id: imageId } }),
  // URL autenticada não existe — buscar como blob com o Bearer:
  async imageUrl(imageId) {
    const token = getToken();
    const res = await fetch(`/api/insights/images/${imageId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  sources: () => request('/api/insights/sources'),
  addSource: (url) => request('/api/insights/sources', { method: 'POST', body: { url } }),
  updateSource: (id, data) => request(`/api/insights/sources/${id}`, { method: 'PATCH', body: data }),
  removeSource: (id) => request(`/api/insights/sources/${id}`, { method: 'DELETE' }),
};

// ============ RECIBOS VERDES (arquivo por parcela) ============
export const recibos = {
  // Metadados: { exists, size, uploaded_at, filename }
  info: (installmentId) => request(`/api/recibos/${installmentId}?info=true`),

  // Metadados dos 3 tipos de documento de uma vez: { docs: { recibo, 'fatura-recibo', fatura } }
  infoAll: (installmentId) => request(`/api/recibos/${installmentId}?info=all`),

  // Upload do documento (PDF) anexado pela utilizadora. tipo: recibo | fatura-recibo | fatura.
  async upload(installmentId, file, tipo = 'recibo') {
    const token = getToken();
    const res = await fetch(`/api/recibos/${installmentId}?tipo=${encodeURIComponent(tipo)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Filename': file.name || `${tipo}.pdf`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const e = await res.json(); msg = e.error || msg; } catch {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.json();
  },

  // Abre o documento anexado numa nova aba (com Bearer token, à prova de popup-blocker).
  async openInNewTab(installmentId, tipo = 'recibo') {
    const tab = window.open('', '_blank');
    try {
      const token = getToken();
      const res = await fetch(`/api/recibos/${installmentId}?tipo=${encodeURIComponent(tipo)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error || msg; } catch {}
        if (tab) tab.close();
        const err = new Error(msg); err.status = res.status; throw err;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (tab) tab.location.href = objUrl;
      else { const a = document.createElement('a'); a.href = objUrl; a.download = `recibo-${installmentId}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },

  // Remove o documento anexado.
  remove: (installmentId, tipo = 'recibo') => request(`/api/recibos/${installmentId}?tipo=${encodeURIComponent(tipo)}`, { method: 'DELETE' }),

  // Envia o RV anexado ao cliente por email. Devolve {ok|skipped|error}.
  sendToClient: (installmentId) => request(`/api/recibos/${installmentId}/send`, { method: 'POST' }),
};

// ============ PROCURAÇÕES ============
export const procuracoes = {
  // Lista os modelos ativos.
  listTemplates: () => request('/api/procuracoes/templates'),

  // Preview: texto preenchido + lista de campos editáveis ainda em aberto.
  // body: { template_id, client_id }
  preview: (body) => request('/api/procuracoes/preview', { method: 'POST', body }),

  // Gera o PDF e abre numa nova aba (com Bearer + à prova de popup-blocker).
  // body: { template_id, client_id, overrides?, local?, data? }
  async generateOpen(body) {
    const tab = window.open('', '_blank');
    try {
      const token = getToken();
      const res = await fetch('/api/procuracoes/gerar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error || msg; } catch {}
        if (tab) tab.close();
        const err = new Error(msg); err.status = res.status; throw err;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (tab) tab.location.href = objUrl;
      else { const a = document.createElement('a'); a.href = objUrl; a.download = `procuracao.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },
};

// ============ PLANOS DE PAGAMENTO ============
export const planos = {
  // Resumo do plano do cliente: { total, paid, outstanding, count, plan_number, has_email }
  info: (clientId) => request(`/api/planos/${clientId}/info`),

  // Envia o plano (PDF anexo) ao cliente por email. body: { client_id, channel?, local? }
  enviar: (clientId, opts = {}) =>
    request('/api/planos/enviar', { method: 'POST', body: { client_id: clientId, channel: 'email', ...opts } }),

  // Gera o PDF do plano e abre numa nova aba (Bearer + à prova de popup-blocker).
  async generateOpen(clientId, opts = {}) {
    const tab = window.open('', '_blank');
    try {
      const token = getToken();
      const res = await fetch('/api/planos/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ client_id: clientId, ...opts }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error || msg; } catch {}
        if (tab) tab.close();
        const err = new Error(msg); err.status = res.status; throw err;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (tab) tab.location.href = objUrl;
      else { const a = document.createElement('a'); a.href = objUrl; a.download = `plano-pagamento.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },
};

// ============ UPLOAD TOKENS (admin) ============
export const uploadTokens = {
  // body: { client_id, instructions?, days? }
  create: (body) => request('/api/upload-tokens', { method: 'POST', body }),
  list: (clientId) => request('/api/upload-tokens?client_id=' + encodeURIComponent(clientId)),
  revoke: (token) => request('/api/upload-tokens/' + encodeURIComponent(token), { method: 'DELETE' }),
};

// ============ CLIENT DOCUMENTS (admin) ============
export const clientDocs = {
  list: (clientId) => request('/api/client-documents?client_id=' + encodeURIComponent(clientId)),
  remove: (docId) => request('/api/client-documents/' + encodeURIComponent(docId), { method: 'DELETE' }),
  // Abre o documento numa nova aba (com Bearer + à prova de popup-blocker)
  async openInNewTab(docId) {
    const tab = window.open('', '_blank');
    try {
      const token = getToken();
      const res = await fetch('/api/client-documents/' + encodeURIComponent(docId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error || msg; } catch {}
        if (tab) tab.close();
        const err = new Error(msg); err.status = res.status; throw err;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (tab) tab.location.href = objUrl;
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },
};


export const calendar = {
  getAll: () => request('/api/calendar'),
  createEvent: (data) => request('/api/calendar/events', { method: 'POST', body: data }),
  updateEvent: (id, data) => request(`/api/calendar/events/${id}`, { method: 'PUT', body: data }),
  deleteEvent: (id) => request(`/api/calendar/events/${id}`, { method: 'DELETE' }),
  createType: (data) => request('/api/calendar/types', { method: 'POST', body: data }),
  updateType: (id, data) => request(`/api/calendar/types/${id}`, { method: 'PUT', body: data }),
  deleteType: (id, strategy) => request(`/api/calendar/types/${id}?strategy=${strategy || 'move'}`, { method: 'DELETE' }),
};
