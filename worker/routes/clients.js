// worker/routes/clients.js
import { jsonResponse, jsonError } from '../lib/response.js';

export async function handleClients(request, env, path, session) {
  const method = request.method;
  const segments = path.split('/').filter(Boolean); // ['api', 'clients', ':id'?]
  const clientId = segments[2];

  // GET /api/clients
  if (!clientId && method === 'GET') {
    return listClients(request, env);
  }
  // POST /api/clients
  if (!clientId && method === 'POST') {
    return createClient(request, env);
  }
  // GET /api/clients/:id
  if (clientId && method === 'GET') {
    return getClient(env, clientId);
  }
  // PUT /api/clients/:id
  if (clientId && method === 'PUT') {
    return updateClient(request, env, clientId);
  }
  // DELETE /api/clients/:id
  if (clientId && method === 'DELETE') {
    return deleteClient(env, clientId);
  }
  return jsonError('Method not allowed', 405);
}

async function listClients(request, env) {
  const url = new URL(request.url);
  const country = url.searchParams.get('country');
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');

  let sql = 'SELECT * FROM clients WHERE 1=1';
  const params = [];
  if (country) { sql += ' AND country = ?'; params.push(country); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (search) {
    sql += ' AND (name LIKE ? OR email LIKE ? OR identification LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY name ASC';

  const result = await env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ clients: result.results });
}

async function getClient(env, clientId) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return jsonError('Cliente não encontrado', 404);

  // Junta parcelas
  const installments = await env.DB.prepare(
    'SELECT * FROM installments WHERE client_id = ? ORDER BY due_date ASC'
  ).bind(clientId).all();

  // Junta regras notificação
  const rules = await env.DB.prepare(
    'SELECT * FROM notification_rules WHERE client_id = ?'
  ).bind(clientId).all();

  return jsonResponse({
    client,
    installments: installments.results,
    rules: rules.results,
  });
}

async function createClient(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { id, name, email, phone, country, identification, practice_area, notes, honorarios_total, honorarios_parcelas, contract_start_date, address, nationality, marital_status, rg, birth_date, birth_place, doc_type, doc_number, doc_validity, niss, filiation, person_type, rep_name, rep_role, duns, process_summary, emails, phones, rep_nif, rep_nationality, rep_address, address_parts, rep_address_parts, father_name, mother_name } = body || {};
  if (!id || !name || !country) {
    return jsonError('id, name e country são obrigatórios', 400);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO clients (id, name, email, phone, country, identification, practice_area, status, notes, honorarios_total, honorarios_parcelas, contract_start_date, address, nationality, marital_status, rg, birth_date, birth_place, doc_type, doc_number, doc_validity, niss, filiation, person_type, rep_name, rep_role, duns, process_summary, emails, phones, rep_nif, rep_nationality, rep_address, address_parts, rep_address_parts, father_name, mother_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, name, email || null, phone || null, country,
      identification || null, practice_area || null, notes || '',
      honorarios_total || 0, honorarios_parcelas || 0, contract_start_date || null,
      address || null, nationality || null, marital_status || null, rg || null,
      birth_date || null, birth_place || null, doc_type || null, doc_number || null, doc_validity || null, niss || null, filiation || null,
      person_type === 'coletiva' ? 'coletiva' : 'singular', rep_name || null, rep_role || null, duns || null, process_summary || null,
      serializeContacts(emails), serializeContacts(phones),
      rep_nif || null, rep_nationality || null, rep_address || null,
      serializeContacts(address_parts), serializeContacts(rep_address_parts), father_name || null, mother_name || null
    ).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return jsonError('Já existe cliente com esse ID', 409);
    throw err;
  }

  return jsonResponse({ ok: true, id }, 201);
}

async function updateClient(request, env, clientId) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['name', 'email', 'phone', 'country', 'identification', 'practice_area', 'status', 'notes', 'honorarios_total', 'honorarios_parcelas', 'contract_start_date', 'address', 'nationality', 'marital_status', 'rg', 'birth_date', 'birth_place', 'doc_type', 'doc_number', 'doc_validity', 'niss', 'filiation', 'person_type', 'rep_name', 'rep_role', 'duns', 'process_summary', 'emails', 'phones', 'rep_nif', 'rep_nationality', 'rep_address', 'address_parts', 'rep_address_parts', 'father_name', 'mother_name'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(['emails', 'phones', 'address_parts', 'rep_address_parts'].includes(key) ? serializeContacts(body[key]) : body[key]);
    }
  }
  if (updates.length === 0) return jsonError('Nenhum campo para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(clientId);

  const result = await env.DB.prepare(
    `UPDATE clients SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (result.meta.changes === 0) return jsonError('Cliente não encontrado', 404);
  return jsonResponse({ ok: true });
}

async function deleteClient(env, clientId) {
  // Cascata vai apagar parcelas e regras
  const result = await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(clientId).run();
  if (result.meta.changes === 0) return jsonError('Cliente não encontrado', 404);
  return jsonResponse({ ok: true });
}

// Aceita array [{label, value}] ou string JSON; devolve string JSON ou null.
function serializeContacts(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return null; }
}
