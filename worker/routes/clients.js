// worker/routes/clients.js
import { jsonResponse, jsonError } from '../lib/response.js';

export async function handleClients(request, env, path, session) {
  const method = request.method;
  const segments = path.split('/').filter(Boolean); // ['api', 'clients', ':id'?, 'logo'?]
  const clientId = segments[2];

  // Logo do cliente (R2)
  if (clientId && segments[3] === 'logo') {
    return handleLogo(request, env, clientId, method);
  }

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

  // extra_people / extra_names: pessoas adicionais (clientes conjuntos, ex.: casais)
  let sql = `SELECT clients.*,
    (SELECT COUNT(*) FROM client_people cp WHERE cp.client_id = clients.id) AS extra_people,
    (SELECT group_concat(cp.name, ' · ') FROM client_people cp WHERE cp.client_id = clients.id) AS extra_names
    FROM clients WHERE 1=1`;
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

  // Junta pessoas adicionais (clientes conjuntos)
  const people = await env.DB.prepare(
    'SELECT * FROM client_people WHERE client_id = ? ORDER BY position ASC, created_at ASC'
  ).bind(clientId).all();

  return jsonResponse({
    client,
    installments: installments.results,
    rules: rules.results,
    people: people.results,
  });
}

async function createClient(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { id, name, email, phone, country, identification, practice_area, notes, honorarios_total, honorarios_parcelas, contract_start_date, address, nationality, marital_status, rg, birth_date, birth_place, doc_type, doc_number, doc_validity, niss, filiation, person_type, rep_name, rep_role, duns, process_summary, emails, phones, rep_nif, rep_nationality, rep_address, address_parts, rep_address_parts, father_name, mother_name, plan_type } = body || {};
  if (!id || !name || !country) {
    return jsonError('id, name e country são obrigatórios', 400);
  }
  const PLAN_TYPES = ['installment', 'monthly', 'oficioso', 'probono'];
  const planType = PLAN_TYPES.includes(plan_type) ? plan_type : 'installment';

  try {
    await env.DB.prepare(`
      INSERT INTO clients (id, name, email, phone, country, identification, practice_area, status, notes, honorarios_total, honorarios_parcelas, contract_start_date, plan_type, address, nationality, marital_status, rg, birth_date, birth_place, doc_type, doc_number, doc_validity, niss, filiation, person_type, rep_name, rep_role, duns, process_summary, emails, phones, rep_nif, rep_nationality, rep_address, address_parts, rep_address_parts, father_name, mother_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, name, email || null, phone || null, country,
      identification || null, practice_area || null, notes || '',
      honorarios_total || 0, honorarios_parcelas || 0, contract_start_date || null, planType,
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

  // Pessoas adicionais (cliente conjunto): opcional, array de objetos
  if (Array.isArray(body.people) && body.people.length) {
    const stmts = peopleInsertStatements(env, id, body.people);
    if (stmts.length) await env.DB.batch(stmts);
  }

  return jsonResponse({ ok: true, id }, 201);
}

// Constrói os INSERTs das pessoas adicionais (ignora entradas sem nome).
function peopleInsertStatements(env, clientId, people) {
  const stmts = [];
  let pos = 2;
  for (const p of people) {
    if (!p || !String(p.name || '').trim()) continue;
    const pid = p.id && String(p.id).startsWith(`${clientId}-pes`) ? p.id : `${clientId}-pes${pos}-${Math.random().toString(36).slice(2, 6)}`;
    stmts.push(env.DB.prepare(`
      INSERT INTO client_people (id, client_id, position, name, identification, nationality, marital_status, rg, birth_date, birth_place, doc_type, doc_number, doc_validity, niss, father_name, mother_name, filiation, address, address_parts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      pid, clientId, pos,
      String(p.name).trim(),
      p.identification || null, p.nationality || null, p.marital_status || null, p.rg || null,
      p.birth_date || null, p.birth_place || null,
      p.doc_type || null, p.doc_number || null, p.doc_validity || null, p.niss || null,
      p.father_name || null, p.mother_name || null,
      p.filiation || [p.father_name, p.mother_name].filter(Boolean).join(' e ') || null,
      p.address || null, serializeContacts(p.address_parts)
    ));
    pos++;
  }
  return stmts;
}

async function updateClient(request, env, clientId) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['name', 'email', 'phone', 'country', 'identification', 'practice_area', 'status', 'notes', 'honorarios_total', 'honorarios_parcelas', 'contract_start_date', 'plan_type', 'address', 'nationality', 'marital_status', 'rg', 'birth_date', 'birth_place', 'doc_type', 'doc_number', 'doc_validity', 'niss', 'filiation', 'person_type', 'rep_name', 'rep_role', 'duns', 'process_summary', 'emails', 'phones', 'rep_nif', 'rep_nationality', 'rep_address', 'address_parts', 'rep_address_parts', 'father_name', 'mother_name'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(['emails', 'phones', 'address_parts', 'rep_address_parts'].includes(key) ? serializeContacts(body[key]) : body[key]);
    }
  }
  // Sincronização das pessoas adicionais: quando `people` vem no body,
  // o array é a verdade completa — substitui as linhas existentes.
  const syncPeople = Array.isArray(body.people);

  if (updates.length === 0 && !syncPeople) return jsonError('Nenhum campo para atualizar', 400);

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(clientId);
    const result = await env.DB.prepare(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();
    if (result.meta.changes === 0) return jsonError('Cliente não encontrado', 404);
  } else {
    const exists = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
    if (!exists) return jsonError('Cliente não encontrado', 404);
  }

  if (syncPeople) {
    const stmts = [
      env.DB.prepare('DELETE FROM client_people WHERE client_id = ?').bind(clientId),
      ...peopleInsertStatements(env, clientId, body.people),
    ];
    await env.DB.batch(stmts);
  }

  return jsonResponse({ ok: true });
}

async function deleteClient(env, clientId) {
  // D1 primeiro: a cascata apaga parcelas, regras, log e registos de documentos.
  const result = await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(clientId).run();
  if (result.meta.changes === 0) return jsonError('Cliente não encontrado', 404);

  // R2 depois, em best-effort: se falhar ficam ficheiros orfaos (inofensivo);
  // o inverso — apagar ficheiros e o D1 falhar — deixaria um cliente com
  // documentos partidos. Chaves: recibos/{id}/*, documentos/{id}/*, logos/{id}.
  try {
    const keys = [`logos/${clientId}`];
    for (const prefix of [`recibos/${clientId}/`, `documentos/${clientId}/`]) {
      let cursor;
      do {
        const page = await env.RECIBOS.list({ prefix, cursor });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    if (keys.length) await env.RECIBOS.delete(keys);
  } catch (err) {
    console.error('deleteClient: limpeza R2 falhou (ficheiros orfaos):', err.message);
  }

  return jsonResponse({ ok: true });
}

// Aceita array [{label, value}] ou string JSON; devolve string JSON ou null.
function serializeContacts(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return null; }
}

// ── Logo do cliente ─────────────────────────────────────────────
// POST: corpo binário (image/png|jpeg|webp|svg, máx 2 MB) -> guarda no R2
// GET: devolve a imagem · DELETE: remove
const LOGO_MAX = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

async function handleLogo(request, env, clientId, method) {
  const client = await env.DB.prepare('SELECT id, logo_key, logo_type FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return jsonError('Cliente não encontrado', 404);
  const key = `logos/${clientId}`;

  if (method === 'POST' || method === 'PUT') {
    const ct = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!LOGO_TYPES.includes(ct)) return jsonError('Tipo não suportado. Use PNG, JPEG, WEBP ou SVG.', 415);
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength === 0) return jsonError('Ficheiro vazio.', 400);
    if (buf.byteLength > LOGO_MAX) return jsonError('Ficheiro demasiado grande (máx. 2 MB).', 413);
    await env.RECIBOS.put(key, buf, { httpMetadata: { contentType: ct } });
    await env.DB.prepare("UPDATE clients SET logo_key = ?, logo_type = ?, updated_at = datetime('now') WHERE id = ?").bind(key, ct, clientId).run();
    return jsonResponse({ ok: true });
  }

  if (method === 'GET') {
    if (!client.logo_key) return jsonError('Sem logo', 404);
    const obj = await env.RECIBOS.get(client.logo_key);
    if (!obj) return jsonError('Sem logo', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': client.logo_type || 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  if (method === 'DELETE') {
    if (client.logo_key) await env.RECIBOS.delete(client.logo_key);
    await env.DB.prepare("UPDATE clients SET logo_key = NULL, logo_type = NULL, updated_at = datetime('now') WHERE id = ?").bind(clientId).run();
    return jsonResponse({ ok: true });
  }

  return jsonError('Method not allowed', 405);
}
