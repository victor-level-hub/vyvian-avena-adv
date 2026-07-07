// worker/routes/calendar.js
// Calendário jurídico:
//   GET    /api/calendar                    -> { types, events }
//   POST   /api/calendar/events             -> criar evento
//   PUT    /api/calendar/events/:id         -> editar evento
//   DELETE /api/calendar/events/:id         -> apagar evento (manuais)
//   POST   /api/calendar/types              -> criar tipo personalizado
//   PUT    /api/calendar/types/:id          -> editar tipo (nativos: só is_visible)
//   DELETE /api/calendar/types/:id?strategy=delete|move -> apagar tipo personalizado
import { jsonResponse, jsonError } from '../lib/response.js';

const EVENT_FIELDS = ['title', 'description', 'type_id', 'start_date', 'end_date', 'is_all_day', 'amount', 'currency', 'status', 'client_name', 'case_reference', 'is_recurring', 'recurrence_rule'];
const STATUS_OK = ['none', 'paid', 'pending', 'overdue'];

export async function handleCalendar(request, env, path, session) {
  const segments = path.split('/').filter(Boolean); // ['api','calendar', kind?, id?]
  const kind = segments[2];
  const id = segments[3];
  const method = request.method;

  // GET /api/calendar — tudo (volume pequeno; filtragem é no cliente)
  if (!kind && method === 'GET') {
    const [types, events] = await Promise.all([
      env.DB.prepare('SELECT * FROM calendar_types ORDER BY is_default DESC, label ASC').all(),
      env.DB.prepare('SELECT * FROM calendar_events ORDER BY start_date ASC').all(),
    ]);
    return jsonResponse({ types: types.results, events: events.results });
  }

  if (kind === 'events') {
    if (!id && method === 'POST') return createEvent(request, env);
    if (id && method === 'PUT') return updateEvent(request, env, id);
    if (id && method === 'DELETE') return deleteEvent(env, id);
  }

  if (kind === 'types') {
    if (!id && method === 'POST') return createType(request, env);
    if (id && method === 'PUT') return updateType(request, env, id);
    if (id && method === 'DELETE') return deleteType(request, env, id);
  }

  return jsonError('Not found', 404);
}

// ── Eventos ──────────────────────────────────────────────────────

async function createEvent(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const { title, type_id, start_date } = body || {};
  if (!title || !type_id || !start_date) return jsonError('title, type_id e start_date são obrigatórios', 400);

  const type = await env.DB.prepare('SELECT id FROM calendar_types WHERE id = ?').bind(type_id).first();
  if (!type) return jsonError('Tipo de data não existe', 400);
  if (body.status && !STATUS_OK.includes(body.status)) return jsonError('status inválido', 400);

  const eid = body.id || ('evt-' + crypto.randomUUID().slice(0, 13));
  await env.DB.prepare(`
    INSERT INTO calendar_events (id, title, description, type_id, start_date, end_date, is_all_day, amount, currency, status, client_name, case_reference, source, is_recurring, recurrence_rule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
  `).bind(
    eid, title, body.description || null, type_id, start_date, body.end_date || null,
    body.is_all_day === false ? 0 : 1, Number(body.amount) || 0, body.currency || 'EUR',
    body.status || 'none', body.client_name || null, body.case_reference || null,
    body.is_recurring ? 1 : 0, body.recurrence_rule || null,
  ).run();

  return jsonResponse({ ok: true, id: eid }, 201);
}

async function updateEvent(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  if (body.status && !STATUS_OK.includes(body.status)) return jsonError('status inválido', 400);
  if (body.type_id) {
    const type = await env.DB.prepare('SELECT id FROM calendar_types WHERE id = ?').bind(body.type_id).first();
    if (!type) return jsonError('Tipo de data não existe', 400);
  }

  const updates = [];
  const params = [];
  for (const key of EVENT_FIELDS) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(key === 'is_all_day' || key === 'is_recurring' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (updates.length === 0) return jsonError('Nenhum campo para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(id);

  const result = await env.DB.prepare(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  if (result.meta.changes === 0) return jsonError('Evento não encontrado', 404);
  return jsonResponse({ ok: true });
}

async function deleteEvent(env, id) {
  const result = await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return jsonError('Evento não encontrado', 404);
  return jsonResponse({ ok: true });
}

// ── Tipos ────────────────────────────────────────────────────────

function slugify(label) {
  return label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '').slice(0, 40);
}

async function createType(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const { label, color } = body || {};
  if (!label || !color) return jsonError('label e color são obrigatórios', 400);

  let tid = slugify(label) || 'tipo';
  const exists = await env.DB.prepare('SELECT id FROM calendar_types WHERE id = ?').bind(tid).first();
  if (exists) tid = tid + '_' + crypto.randomUUID().slice(0, 4);

  await env.DB.prepare(`
    INSERT INTO calendar_types (id, label, color, description, is_default, is_visible)
    VALUES (?, ?, ?, ?, 0, 1)
  `).bind(tid, label, color, body.description || null).run();

  return jsonResponse({ ok: true, id: tid }, 201);
}

async function updateType(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const type = await env.DB.prepare('SELECT * FROM calendar_types WHERE id = ?').bind(id).first();
  if (!type) return jsonError('Tipo não encontrado', 404);

  // Tipos nativos: apenas visibilidade; personalizados: tudo
  const allowed = type.is_default ? ['is_visible'] : ['label', 'color', 'description', 'is_visible'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(key === 'is_visible' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (updates.length === 0) return jsonError('Nenhum campo para atualizar', 400);
  updates.push("updated_at = datetime('now')");
  params.push(id);

  await env.DB.prepare(`UPDATE calendar_types SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return jsonResponse({ ok: true });
}

async function deleteType(request, env, id) {
  const type = await env.DB.prepare('SELECT * FROM calendar_types WHERE id = ?').bind(id).first();
  if (!type) return jsonError('Tipo não encontrado', 404);
  if (type.is_default) return jsonError('Tipos nativos não podem ser apagados', 400);

  const url = new URL(request.url);
  const strategy = url.searchParams.get('strategy') || 'move';
  if (strategy === 'delete') {
    await env.DB.prepare('DELETE FROM calendar_events WHERE type_id = ?').bind(id).run();
  } else {
    await env.DB.prepare("UPDATE calendar_events SET type_id = 'evento_pessoal', updated_at = datetime('now') WHERE type_id = ?").bind(id).run();
  }
  await env.DB.prepare('DELETE FROM calendar_types WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true });
}
