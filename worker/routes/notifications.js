// worker/routes/notifications.js
import { jsonResponse, jsonError } from '../lib/response.js';
import { runDailyCron } from '../cron.js'; // Fase 2

export async function handleNotifications(request, env, path, session) {
  const method = request.method;
  const segments = path.split('/').filter(Boolean);
  const subRoute = segments[2]; // 'rules' | 'templates' | 'log' | 'process-queue'
  const id = segments[3];

  // NOVO (Fase 2): força processamento das notificações devidas agora
  if (subRoute === 'process-queue' && method === 'POST') {
    const result = await runDailyCron(env);
    return jsonResponse({ ok: true, ...result });
  }

  if (subRoute === 'rules') {
    if (!id && method === 'GET') return listRules(request, env);
    if (!id && method === 'POST') return createRule(request, env);
    if (id && method === 'PATCH') return updateRule(request, env, id);
    if (id && method === 'DELETE') return deleteRule(env, id);
  }
  if (subRoute === 'templates') {
    if (!id && method === 'GET') return listTemplates(env);
    if (id && method === 'GET') return getTemplate(env, id);
    if (id && method === 'PUT') return updateTemplate(request, env, id);
  }
  if (subRoute === 'log') {
    if (method === 'GET') return listLog(request, env);
  }
  // Preferências de alertas da Dra. Vyvian (reestruturação 2026-07)
  if (subRoute === 'owner-prefs') {
    if (method === 'GET') return getOwnerPrefs(env);
    if (method === 'PUT') return updateOwnerPrefs(request, env);
  }

  return jsonError('Not found', 404);
}

async function listRules(request, env) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  let sql = 'SELECT * FROM notification_rules';
  const params = [];
  if (clientId) { sql += ' WHERE client_id = ?'; params.push(clientId); }
  const result = await env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ rules: result.results });
}

async function createRule(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { id, client_id, channel, days_before, enabled, template_id } = body || {};
  if (!id || !client_id || !channel) {
    return jsonError('Campos obrigatórios em falta', 400);
  }

  await env.DB.prepare(`
    INSERT INTO notification_rules (id, client_id, channel, days_before, enabled, template_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, client_id, channel, days_before ?? 3, enabled ? 1 : 0, template_id || null).run();

  return jsonResponse({ ok: true, id }, 201);
}

async function updateRule(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['channel', 'days_before', 'enabled', 'template_id'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(key === 'enabled' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (updates.length === 0) return jsonError('Nada para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(id);

  const result = await env.DB.prepare(
    `UPDATE notification_rules SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (result.meta.changes === 0) return jsonError('Regra não encontrada', 404);
  return jsonResponse({ ok: true });
}

async function deleteRule(env, id) {
  const result = await env.DB.prepare('DELETE FROM notification_rules WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return jsonError('Regra não encontrada', 404);
  return jsonResponse({ ok: true });
}

async function listTemplates(env) {
  const result = await env.DB.prepare('SELECT * FROM message_templates ORDER BY language, channel, name').all();
  return jsonResponse({ templates: result.results });
}

async function getTemplate(env, id) {
  const t = await env.DB.prepare('SELECT * FROM message_templates WHERE id = ?').bind(id).first();
  if (!t) return jsonError('Template não encontrado', 404);
  return jsonResponse({ template: t });
}

async function updateTemplate(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['name', 'subject', 'body', 'language'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(body[key]);
    }
  }
  if (updates.length === 0) return jsonError('Nada para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(id);

  const result = await env.DB.prepare(
    `UPDATE message_templates SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (result.meta.changes === 0) return jsonError('Template não encontrado', 404);
  return jsonResponse({ ok: true });
}

async function listLog(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const clientId = url.searchParams.get('client_id');

  let sql = `
    SELECT n.*, c.name as client_name
    FROM notification_log n
    LEFT JOIN clients c ON c.id = n.client_id
  `;
  const params = [];
  if (clientId) { sql += ' WHERE n.client_id = ?'; params.push(clientId); }
  sql += ' ORDER BY n.sent_at DESC LIMIT ?';
  params.push(limit);

  const result = await env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ log: result.results });
}

// ============ ALERTAS PARA A DRA. (owner) ============

async function getOwnerPrefs(env) {
  const [prefs, contacts, log] = await Promise.all([
    env.DB.prepare('SELECT alert_type, email_enabled, whatsapp_enabled FROM owner_alert_prefs').all(),
    env.DB.prepare('SELECT email, whatsapp FROM owner_alert_contacts WHERE id = 1').first(),
    env.DB.prepare('SELECT alert_type, channel, status, sent_at, message_preview, error_message FROM owner_alert_log ORDER BY sent_at DESC LIMIT 20').all(),
  ]);
  return jsonResponse({
    prefs: prefs.results || [],
    contacts: contacts || { email: null, whatsapp: null },
    log: log.results || [],
  });
}

async function updateOwnerPrefs(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const VALID = ['vence_hoje', 'em_atraso', 'resumo_diario', 'pagamento_recebido'];
  if (Array.isArray(body.prefs)) {
    for (const p of body.prefs) {
      if (!VALID.includes(p.alert_type)) return jsonError(`alert_type inválido: ${p.alert_type}`, 400);
      await env.DB.prepare(
        "UPDATE owner_alert_prefs SET email_enabled = ?, whatsapp_enabled = ?, updated_at = datetime('now') WHERE alert_type = ?"
      ).bind(p.email_enabled ? 1 : 0, p.whatsapp_enabled ? 1 : 0, p.alert_type).run();
    }
  }
  if (body.contacts) {
    await env.DB.prepare(
      "UPDATE owner_alert_contacts SET email = ?, whatsapp = ?, updated_at = datetime('now') WHERE id = 1"
    ).bind(body.contacts.email || null, body.contacts.whatsapp || null).run();
  }
  return getOwnerPrefs(env);
}
