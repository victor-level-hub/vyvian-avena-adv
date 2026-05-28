// worker/routes/installments.js
import { jsonResponse, jsonError } from '../lib/response.js';

export async function handleInstallments(request, env, path, session) {
  const method = request.method;
  const segments = path.split('/').filter(Boolean);
  const installmentId = segments[2];

  if (!installmentId && method === 'GET') {
    return listInstallments(request, env);
  }
  if (!installmentId && method === 'POST') {
    return createInstallment(request, env);
  }
  if (installmentId === 'upcoming' && method === 'GET') {
    return upcoming(request, env);
  }
  if (installmentId && method === 'GET') {
    return getInstallment(env, installmentId);
  }
  if (installmentId && method === 'PATCH') {
    return updateInstallment(request, env, installmentId);
  }
  if (installmentId && method === 'DELETE') {
    return deleteInstallment(env, installmentId);
  }
  return jsonError('Method not allowed', 405);
}

async function listInstallments(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const clientId = url.searchParams.get('client_id');
  const month = url.searchParams.get('month'); // YYYY-MM
  const year = url.searchParams.get('year');

  let sql = `
    SELECT i.*, c.name as client_name, c.country as client_country
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (clientId) { sql += ' AND i.client_id = ?'; params.push(clientId); }
  if (month) { sql += " AND strftime('%Y-%m', i.due_date) = ?"; params.push(month); }
  if (year) { sql += " AND strftime('%Y', i.due_date) = ?"; params.push(year); }

  sql += ' ORDER BY i.due_date ASC';

  const result = await env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ installments: result.results });
}

async function upcoming(request, env) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  const result = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.country as client_country
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('pending', 'due_today', 'late')
      AND date(i.due_date) <= date('now', '+' || ? || ' days')
    ORDER BY i.due_date ASC
  `).bind(days).all();

  return jsonResponse({ installments: result.results });
}

async function getInstallment(env, id) {
  const i = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.country as client_country, c.email as client_email, c.phone as client_phone
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ?
  `).bind(id).first();
  if (!i) return jsonError('Parcela não encontrada', 404);
  return jsonResponse({ installment: i });
}

async function createInstallment(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { id, client_id, installment_number, total_installments, amount, currency, due_date, notes } = body || {};
  if (!id || !client_id || !installment_number || !total_installments || !amount || !due_date) {
    return jsonError('Campos obrigatórios em falta', 400);
  }

  await env.DB.prepare(`
    INSERT INTO installments (id, client_id, installment_number, total_installments, amount, currency, due_date, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(id, client_id, installment_number, total_installments, amount, currency || 'EUR', due_date, notes || null).run();

  return jsonResponse({ ok: true, id }, 201);
}

async function updateInstallment(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['status', 'paid_date', 'payment_method', 'amount', 'due_date', 'notes', 'receipt_path'];
  const updates = [];
  const params = [];

  // Atalho: action=mark_paid
  if (body.action === 'mark_paid') {
    updates.push("status = 'paid'");
    updates.push("paid_date = ?");
    params.push(body.paid_date || new Date().toISOString().slice(0, 10));
    if (body.payment_method) {
      updates.push('payment_method = ?');
      params.push(body.payment_method);
    }
  } else {
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(body[key]);
      }
    }
  }

  if (updates.length === 0) return jsonError('Nenhum campo para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(id);

  const result = await env.DB.prepare(
    `UPDATE installments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (result.meta.changes === 0) return jsonError('Parcela não encontrada', 404);
  return jsonResponse({ ok: true });
}

async function deleteInstallment(env, id) {
  const result = await env.DB.prepare('DELETE FROM installments WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return jsonError('Parcela não encontrada', 404);
  return jsonResponse({ ok: true });
}
