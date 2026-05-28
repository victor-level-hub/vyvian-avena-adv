// worker/routes/notifications.js
import { jsonResponse, jsonError } from '../lib/response.js';
import { sendEmailViaResend, sendWhatsappViaZapi, renderTemplate } from '../lib/senders.js';

export async function handleNotifications(request, env, path, session) {
  const method = request.method;
  const segments = path.split('/').filter(Boolean);
  const subRoute = segments[2];
  const id = segments[3];

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
  if (subRoute === 'send' && method === 'POST') {
    return sendNow(request, env);
  }
  if (subRoute === 'process-queue' && method === 'POST') {
    return processQueue(env);
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
  if (!id || !client_id || !channel) return jsonError('Campos obrigatórios em falta', 400);
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
  const result = await env.DB.prepare(`
    SELECT n.*, c.name as client_name
    FROM notification_log n
    LEFT JOIN clients c ON c.id = n.client_id
    ORDER BY n.sent_at DESC
    LIMIT ?
  `).bind(limit).all();
  return jsonResponse({ log: result.results });
}

// ============================================================
// POST /api/notifications/send
// Envia uma notificação MANUALMENTE (botão "Reenviar" / "Enviar agora")
// Body: { installment_id, channel }
// ============================================================
async function sendNow(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const { installment_id, channel } = body || {};
  if (!installment_id || !channel) return jsonError('installment_id e channel obrigatórios', 400);

  // Busca contexto completo
  const inst = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone, c.country as client_country
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ?
  `).bind(installment_id).first();

  if (!inst) return jsonError('Parcela não encontrada', 404);

  // Busca regra correspondente para descobrir template
  const rule = await env.DB.prepare(`
    SELECT * FROM notification_rules
    WHERE client_id = ? AND channel = ? AND enabled = 1
    LIMIT 1
  `).bind(inst.client_id, channel).first();

  const templateId = rule?.template_id;
  let template = null;
  if (templateId) {
    template = await env.DB.prepare('SELECT * FROM message_templates WHERE id = ?').bind(templateId).first();
  }
  if (!template) {
    return jsonError('Sem template configurado para este canal/cliente', 400);
  }

  // Renderizar
  const ctx = {
    cliente: { nome: inst.client_name, email: inst.client_email, telefone: inst.client_phone },
    parcela: {
      data: inst.due_date,
      numero: `${inst.installment_number}/${inst.total_installments}`,
      valor: `${inst.currency === 'BRL' ? 'R$' : '€'} ${Number(inst.amount).toFixed(2)}`,
    },
    processo: { referencia: inst.id },
  };
  const subject = renderTemplate(template.subject, ctx);
  const messageBody = renderTemplate(template.body, ctx);

  let sendResult;
  if (channel === 'email') {
    sendResult = await sendEmailViaResend(env, {
      to: inst.client_email,
      subject,
      text: messageBody,
      fromName: 'Dra. Vyvian Avena',
    });
  } else if (channel === 'whatsapp') {
    sendResult = await sendWhatsappViaZapi(env, {
      to: inst.client_phone,
      message: messageBody,
    });
  } else {
    return jsonError('Canal não suportado: ' + channel, 400);
  }

  // Registar no log
  const logId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO notification_log (id, installment_id, client_id, channel, status, sent_at, message_preview, error_message, external_id)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
  `).bind(
    logId,
    installment_id,
    inst.client_id,
    channel,
    sendResult.ok ? 'sent' : 'failed',
    messageBody.slice(0, 200),
    sendResult.ok ? null : sendResult.error,
    sendResult.externalId || null,
  ).run();

  if (!sendResult.ok) return jsonError(sendResult.error, 500);
  return jsonResponse({ ok: true, externalId: sendResult.externalId, logId });
}

// ============================================================
// POST /api/notifications/process-queue
// Processa todas as notificações com status 'queued' (cron diário enfila)
// ============================================================
async function processQueue(env) {
  const queued = await env.DB.prepare(`
    SELECT id, installment_id, client_id, channel
    FROM notification_log
    WHERE status = 'queued'
    LIMIT 50
  `).all();

  const results = { processed: 0, sent: 0, failed: 0 };

  for (const log of queued.results) {
    const inst = await env.DB.prepare(`
      SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone
      FROM installments i JOIN clients c ON c.id = i.client_id
      WHERE i.id = ?
    `).bind(log.installment_id).first();

    if (!inst) {
      await env.DB.prepare(`UPDATE notification_log SET status='failed', error_message='Parcela não existe' WHERE id=?`).bind(log.id).run();
      results.failed++; continue;
    }

    const rule = await env.DB.prepare(`SELECT template_id FROM notification_rules WHERE client_id=? AND channel=? AND enabled=1 LIMIT 1`).bind(log.client_id, log.channel).first();
    const template = rule?.template_id ? await env.DB.prepare('SELECT * FROM message_templates WHERE id = ?').bind(rule.template_id).first() : null;

    if (!template) {
      await env.DB.prepare(`UPDATE notification_log SET status='failed', error_message='Sem template' WHERE id=?`).bind(log.id).run();
      results.failed++; continue;
    }

    const ctx = {
      cliente: { nome: inst.client_name, email: inst.client_email, telefone: inst.client_phone },
      parcela: {
        data: inst.due_date,
        numero: `${inst.installment_number}/${inst.total_installments}`,
        valor: `${inst.currency === 'BRL' ? 'R$' : '€'} ${Number(inst.amount).toFixed(2)}`,
      },
      processo: { referencia: inst.id },
    };
    const subject = renderTemplate(template.subject, ctx);
    const messageBody = renderTemplate(template.body, ctx);

    let r;
    if (log.channel === 'email') {
      r = await sendEmailViaResend(env, { to: inst.client_email, subject, text: messageBody, fromName: 'Dra. Vyvian Avena' });
    } else if (log.channel === 'whatsapp') {
      r = await sendWhatsappViaZapi(env, { to: inst.client_phone, message: messageBody });
    } else {
      r = { ok: false, error: 'Canal não suportado' };
    }

    await env.DB.prepare(`
      UPDATE notification_log SET status=?, error_message=?, external_id=?, message_preview=?, sent_at=datetime('now') WHERE id=?
    `).bind(
      r.ok ? 'sent' : 'failed',
      r.ok ? null : r.error,
      r.externalId || null,
      messageBody.slice(0, 200),
      log.id,
    ).run();

    results.processed++;
    if (r.ok) results.sent++; else results.failed++;
  }

  return jsonResponse(results);
}
