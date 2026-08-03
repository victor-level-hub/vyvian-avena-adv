// tests/worker/calendar.test.js
// Calendário jurídico (worker/routes/calendar.js) e notificações
// (worker/routes/notifications.js). São as duas superfícies que mexem com datas e
// com envios para fora — as datas entram como texto cru e os envios têm de ser
// idempotentes no dia.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleCalendar } from '../../worker/routes/calendar.js';
import { handleNotifications } from '../../worker/routes/notifications.js';
import { criarEnv, req, json, mockFetch } from '../helpers/env.js';

const SESSAO = { sub: 1, name: 'Victor', email: 'v@exemplo.pt', role: 'admin' };

let env;
beforeEach(() => { env = criarEnv(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// ── atalhos ──────────────────────────────────────────────────────────────────
// O router passa o pathname (sem query) ao handler, mas o Request leva o URL todo.
function cal(metodo, caminho, corpo) {
  const pathname = caminho.split('?')[0];
  const opcoes = corpo === undefined ? {} : (typeof corpo === 'string' ? { body: corpo } : { body: corpo });
  return handleCalendar(req(metodo, caminho, opcoes), env, pathname, SESSAO);
}
function nots(metodo, caminho, corpo) {
  const pathname = caminho.split('?')[0];
  const opcoes = corpo === undefined ? {} : { body: corpo };
  return handleNotifications(req(metodo, caminho, opcoes), env, pathname, SESSAO);
}

const EVENTO = { title: 'Reunião com cliente', type_id: 'cliente', start_date: '2026-09-10' };
async function criarEvento(extra = {}) {
  const r = await cal('POST', '/api/calendar/events', { ...EVENTO, ...extra });
  const b = await json(r);
  return b.id;
}
const todosOsEventos = async () => (await json(await cal('GET', '/api/calendar'))).events;

// Filtros que o frontend aplica sobre o payload devolvido (a API não filtra).
const noDia = (evts, dia) => evts.filter((e) => e.start_date.slice(0, 10) === dia);
const noMes = (evts, mes) => evts.filter((e) => e.start_date.slice(0, 7) === mes);
const noIntervalo = (evts, de, ate) => evts.filter((e) => {
  const fim = (e.end_date || e.start_date).slice(0, 10);
  return e.start_date.slice(0, 10) <= ate && fim >= de;
});

const horaEmLisboa = (iso) => new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
const diaEmLisboa = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — leitura
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/calendar', () => {
  it('devolve os tipos nativos e os eventos de sistema já semeados', async () => {
    const b = await json(await cal('GET', '/api/calendar'));
    expect(b.types.length).toBeGreaterThanOrEqual(10);
    expect(b.events.length).toBeGreaterThan(0);
    expect(b.types.map((t) => t.id)).toContain('feriado_nacional');
  });

  it('os tipos nativos vêm antes dos personalizados', async () => {
    await cal('POST', '/api/calendar/types', { label: 'Aniversários', color: '#123456' });
    const b = await json(await cal('GET', '/api/calendar'));
    const primeiroPersonalizado = b.types.findIndex((t) => t.is_default === 0);
    const ultimoNativo = b.types.map((t) => t.is_default).lastIndexOf(1);
    expect(ultimoNativo).toBeLessThan(primeiroPersonalizado);
  });

  it('os eventos vêm ordenados por data de início ascendente', async () => {
    const datas = (await todosOsEventos()).map((e) => e.start_date);
    expect([...datas].sort()).toEqual(datas);
  });

  it('inclui tipos marcados como invisíveis (a escolha é do frontend)', async () => {
    const b = await json(await cal('GET', '/api/calendar'));
    expect(b.types.find((t) => t.id === 'prazo_processual_modelo').is_visible).toBe(0);
  });

  it('ignora parâmetros de filtro no URL e devolve sempre tudo', async () => {
    const comFiltro = await json(await cal('GET', '/api/calendar?month=2026-02&type=cliente'));
    const semFiltro = await json(await cal('GET', '/api/calendar'));
    expect(comFiltro.events).toEqual(semFiltro.events);
  });

  it('devolve os eventos criados à mistura com os de sistema', async () => {
    await criarEvento({ title: 'Audiência' });
    const eventos = await todosOsEventos();
    expect(eventos.some((e) => e.title === 'Audiência' && e.source === 'manual')).toBe(true);
    expect(eventos.some((e) => e.source === 'system')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — criar evento
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/calendar/events', () => {
  it('cria um evento manual e devolve 201 com o id gerado', async () => {
    const r = await cal('POST', '/api/calendar/events', EVENTO);
    expect(r.status).toBe(201);
    expect((await json(r)).id).toMatch(/^evt-[0-9a-f-]{13}$/);
  });

  it('grava os valores por omissão (dia inteiro, EUR, sem estado, origem manual)', async () => {
    const id = await criarEvento();
    expect(env.DB.linha('SELECT * FROM calendar_events WHERE id = ?', id)).toMatchObject({
      is_all_day: 1, amount: 0, currency: 'EUR', status: 'none', source: 'manual', is_recurring: 0,
    });
  });

  it('aceita um id escolhido pelo cliente', async () => {
    const r = await cal('POST', '/api/calendar/events', { ...EVENTO, id: 'evt-meu-id' });
    expect((await json(r)).id).toBe('evt-meu-id');
    expect(env.DB.conta('calendar_events', "id = 'evt-meu-id'")).toBe(1);
  });

  it.each(['title', 'type_id', 'start_date'])('recusa sem %s com 400', async (campo) => {
    const corpo = { ...EVENTO };
    delete corpo[campo];
    const r = await cal('POST', '/api/calendar/events', corpo);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toContain('obrigatórios');
  });

  it('recusa título vazio', async () => {
    expect((await cal('POST', '/api/calendar/events', { ...EVENTO, title: '' })).status).toBe(400);
  });

  it('recusa JSON inválido com 400', async () => {
    const r = await cal('POST', '/api/calendar/events', '{isto não é json');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Invalid JSON');
  });

  it('recusa um corpo nulo com 400', async () => {
    expect((await cal('POST', '/api/calendar/events', 'null')).status).toBe(400);
  });

  it('recusa um tipo de data que não existe', async () => {
    const r = await cal('POST', '/api/calendar/events', { ...EVENTO, type_id: 'inventado' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Tipo de data não existe');
  });

  it('não grava nada quando o tipo é inválido', async () => {
    const antes = env.DB.conta('calendar_events');
    await cal('POST', '/api/calendar/events', { ...EVENTO, type_id: 'inventado' });
    expect(env.DB.conta('calendar_events')).toBe(antes);
  });

  it('recusa um estado fora da lista', async () => {
    const r = await cal('POST', '/api/calendar/events', { ...EVENTO, status: 'quase_pago' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('status inválido');
  });

  it.each(['none', 'paid', 'pending', 'overdue'])('aceita o estado %s', async (status) => {
    const id = await criarEvento({ status });
    expect(env.DB.linha('SELECT status FROM calendar_events WHERE id = ?', id).status).toBe(status);
  });

  it('is_all_day a false grava 0; qualquer outro valor grava 1', async () => {
    const a = await criarEvento({ is_all_day: false });
    const b = await criarEvento({ is_all_day: 0 });
    expect(env.DB.linha('SELECT is_all_day FROM calendar_events WHERE id = ?', a).is_all_day).toBe(0);
    expect(env.DB.linha('SELECT is_all_day FROM calendar_events WHERE id = ?', b).is_all_day).toBe(1);
  });

  it.each([
    ['1250.75', 1250.75],
    [1250.75, 1250.75],
    ['abc', 0],
    [null, 0],
    [-40, -40],
  ])('valor %s é gravado como %s', async (dado, esperado) => {
    const id = await criarEvento({ amount: dado });
    expect(env.DB.linha('SELECT amount FROM calendar_events WHERE id = ?', id).amount).toBe(esperado);
  });

  it('guarda a regra de recorrência quando o evento é recorrente', async () => {
    const id = await criarEvento({ is_recurring: true, recurrence_rule: 'FREQ=MONTHLY' });
    expect(env.DB.linha('SELECT is_recurring, recurrence_rule FROM calendar_events WHERE id = ?', id))
      .toMatchObject({ is_recurring: 1, recurrence_rule: 'FREQ=MONTHLY' });
  });

  it('os campos opcionais em falta ficam a NULL', async () => {
    const id = await criarEvento();
    const e = env.DB.linha('SELECT description, end_date, client_name, case_reference FROM calendar_events WHERE id = ?', id);
    expect(e).toEqual({ description: null, end_date: null, client_name: null, case_reference: null });
  });

  it('guarda cliente e referência de processo', async () => {
    const id = await criarEvento({ client_name: 'Maria Silva', case_reference: 'PROC-2026/114' });
    expect(env.DB.linha('SELECT client_name, case_reference FROM calendar_events WHERE id = ?', id))
      .toMatchObject({ client_name: 'Maria Silva', case_reference: 'PROC-2026/114' });
  });

  // ── datas inválidas ────────────────────────────────────────────────────────
  // BUG: createEvent (worker/routes/calendar.js:47-69) não valida start_date nem
  // end_date — grava a string tal e qual. Uma data impossível ('2026-13-45'), um
  // formato português ('31/12/2026') ou puro texto entram na base e só rebentam
  // mais tarde, no cliente, que faz new Date(start_date) e recebe Invalid Date.
  for (const dataMa of ['2026-13-45', '2026-02-30', '31/12/2026', 'amanhã', '2026-09']) {
    it.fails(`recusa a data de início inválida «${dataMa}»`, async () => {
      const r = await cal('POST', '/api/calendar/events', { ...EVENTO, start_date: dataMa });
      expect(r.status).toBe(400);
    });
  }

  it('recusa a data de início vazia (só porque é falsy)', async () => {
    expect((await cal('POST', '/api/calendar/events', { ...EVENTO, start_date: '' })).status).toBe(400);
  });

  it('documenta que uma data impossível fica mesmo gravada', async () => {
    const id = await criarEvento({ start_date: '2026-13-45' });
    expect(env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date).toBe('2026-13-45');
    expect(isNaN(new Date('2026-13-45').getTime())).toBe(true);
  });

  // BUG: a data de fim nunca é comparada com a de início — um evento que "acaba
  // antes de começar" é aceite com 201 (worker/routes/calendar.js:51-66).
  it.fails('recusa uma data de fim anterior à de início', async () => {
    const r = await cal('POST', '/api/calendar/events', {
      ...EVENTO, start_date: '2026-09-10', end_date: '2026-09-01',
    });
    expect(r.status).toBe(400);
  });

  // BUG: o INSERT não trata a colisão de chave primária — repetir o id rebenta com
  // "UNIQUE constraint failed" e o router devolve 500 em vez de um 409 tratado
  // (worker/routes/calendar.js:58-66 + worker/index.js:208-211).
  it.fails('responde 409 quando o id já existe', async () => {
    await cal('POST', '/api/calendar/events', { ...EVENTO, id: 'evt-repetido' });
    const r = await cal('POST', '/api/calendar/events', { ...EVENTO, id: 'evt-repetido' });
    expect(r.status).toBe(409);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — editar evento
// ═════════════════════════════════════════════════════════════════════════════
describe('PUT /api/calendar/events/:id', () => {
  it('altera o título', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { title: 'Audiência adiada' });
    expect(r.status).toBe(200);
    expect(env.DB.linha('SELECT title FROM calendar_events WHERE id = ?', id).title).toBe('Audiência adiada');
  });

  it('altera vários campos de uma vez', async () => {
    const id = await criarEvento();
    await cal('PUT', `/api/calendar/events/${id}`, {
      start_date: '2026-09-20', end_date: '2026-09-21', amount: 300, currency: 'BRL', status: 'pending',
    });
    expect(env.DB.linha('SELECT * FROM calendar_events WHERE id = ?', id)).toMatchObject({
      start_date: '2026-09-20', end_date: '2026-09-21', amount: 300, currency: 'BRL', status: 'pending',
    });
  });

  it('muda o evento para outro tipo existente', async () => {
    const id = await criarEvento();
    await cal('PUT', `/api/calendar/events/${id}`, { type_id: 'processo' });
    expect(env.DB.linha('SELECT type_id FROM calendar_events WHERE id = ?', id).type_id).toBe('processo');
  });

  it('recusa mudar para um tipo inexistente', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { type_id: 'inventado' });
    expect(r.status).toBe(400);
    expect(env.DB.linha('SELECT type_id FROM calendar_events WHERE id = ?', id).type_id).toBe('cliente');
  });

  it('recusa um estado inválido', async () => {
    const id = await criarEvento();
    expect((await cal('PUT', `/api/calendar/events/${id}`, { status: 'talvez' })).status).toBe(400);
  });

  it('recusa quando não há nenhum campo conhecido para atualizar', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { campo_inventado: 'x' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Nenhum campo para atualizar');
  });

  it('recusa um corpo vazio', async () => {
    const id = await criarEvento();
    expect((await cal('PUT', `/api/calendar/events/${id}`, {})).status).toBe(400);
  });

  it('recusa JSON inválido com 400', async () => {
    const id = await criarEvento();
    expect((await cal('PUT', `/api/calendar/events/${id}`, '{')).status).toBe(400);
  });

  it('404 para um evento que não existe', async () => {
    const r = await cal('PUT', '/api/calendar/events/evt-fantasma', { title: 'x' });
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Evento não encontrado');
  });

  it('não deixa alterar a origem do evento (source é ignorado)', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { source: 'system' });
    expect(r.status).toBe(400);
    expect(env.DB.linha('SELECT source FROM calendar_events WHERE id = ?', id).source).toBe('manual');
  });

  it('marca a hora da última alteração', async () => {
    const id = await criarEvento();
    env.DB.exec(`UPDATE calendar_events SET updated_at = '2000-01-01 00:00:00' WHERE id = '${id}'`);
    await cal('PUT', `/api/calendar/events/${id}`, { title: 'novo' });
    expect(env.DB.linha('SELECT updated_at FROM calendar_events WHERE id = ?', id).updated_at)
      .not.toBe('2000-01-01 00:00:00');
  });

  it('deixa editar um evento de sistema (feriados são editáveis)', async () => {
    const r = await cal('PUT', '/api/calendar/events/2026-feriado-natal', { title: 'Natal (editado)' });
    expect(r.status).toBe(200);
    expect(env.DB.linha("SELECT title FROM calendar_events WHERE id = '2026-feriado-natal'").title)
      .toBe('Natal (editado)');
  });

  // BUG: o POST exige título, o PUT não — title = '' passa a validação (só
  // `body[key] !== undefined`) e apaga o título do evento
  // (worker/routes/calendar.js:82-87). Fica um evento sem nome no calendário.
  it.fails('não deixa esvaziar o título de um evento', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { title: '' });
    expect(r.status).toBe(400);
  });

  // BUG: `if (body.type_id)` deixa passar type_id = '' sem validação
  // (worker/routes/calendar.js:75-78) — o UPDATE viola a chave estrangeira e o
  // pedido rebenta com 500 em vez de devolver 400.
  it.fails('recusa um type_id vazio com 400', async () => {
    const id = await criarEvento();
    const r = await cal('PUT', `/api/calendar/events/${id}`, { type_id: '' });
    expect(r.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — apagar evento
// ═════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/calendar/events/:id', () => {
  it('apaga um evento manual', async () => {
    const id = await criarEvento();
    const r = await cal('DELETE', `/api/calendar/events/${id}`);
    expect(r.status).toBe(200);
    expect(env.DB.conta('calendar_events', `id = '${id}'`)).toBe(0);
  });

  it('404 para um evento inexistente', async () => {
    const r = await cal('DELETE', '/api/calendar/events/evt-fantasma');
    expect(r.status).toBe(404);
  });

  it('apagar duas vezes devolve 404 à segunda', async () => {
    const id = await criarEvento();
    await cal('DELETE', `/api/calendar/events/${id}`);
    expect((await cal('DELETE', `/api/calendar/events/${id}`)).status).toBe(404);
  });

  it('não toca nos outros eventos', async () => {
    const a = await criarEvento({ title: 'A' });
    await criarEvento({ title: 'B' });
    await cal('DELETE', `/api/calendar/events/${a}`);
    expect(env.DB.conta('calendar_events', "title = 'B'")).toBe(1);
  });

  // BUG: o cabeçalho da rota diz «DELETE /api/calendar/events/:id -> apagar evento
  // (manuais)», mas deleteEvent (worker/routes/calendar.js:97-101) apaga qualquer
  // linha — inclusive os feriados nacionais semeados com source = 'system', que
  // ninguém consegue repor sem correr a migração outra vez.
  it.fails('não apaga eventos de sistema', async () => {
    const r = await cal('DELETE', '/api/calendar/events/2026-feriado-natal');
    expect(r.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — rotas e métodos
// ═════════════════════════════════════════════════════════════════════════════
describe('calendário — rotas desconhecidas', () => {
  it.each([
    ['POST', '/api/calendar'],
    ['DELETE', '/api/calendar'],
    ['PATCH', '/api/calendar/events/evt-1'],
    ['GET', '/api/calendar/events'],
    ['POST', '/api/calendar/events/evt-1'],
    ['GET', '/api/calendar/types'],
    ['PUT', '/api/calendar/types'],
    ['GET', '/api/calendar/seja-o-que-for'],
  ])('%s %s devolve 404', async (metodo, caminho) => {
    const r = await cal(metodo, caminho, metodo === 'GET' || metodo === 'DELETE' ? undefined : {});
    expect(r.status).toBe(404);
  });

  // Documenta a escolha da rota: um método não suportado não devolve 405, cai no
  // mesmo 404 do fim de handleCalendar (worker/routes/calendar.js:42).
  it('um método não suportado devolve 404 e não 405', async () => {
    const r = await cal('PATCH', '/api/calendar', {});
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Not found');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — consultas por dia, mês e intervalo (filtragem do frontend)
// ═════════════════════════════════════════════════════════════════════════════
describe('eventos por dia, mês e intervalo', () => {
  it('encontra o feriado de um dia concreto', async () => {
    const eventos = noDia(await todosOsEventos(), '2026-04-25');
    expect(eventos.map((e) => e.title)).toContain('Dia da Liberdade');
  });

  it('um dia sem nada devolve lista vazia', async () => {
    expect(noDia(await todosOsEventos(), '2026-02-14')).toEqual([]);
  });

  it('fevereiro de 2026 não tem eventos nenhuns', async () => {
    expect(noMes(await todosOsEventos(), '2026-02')).toEqual([]);
  });

  it('dezembro de 2026 traz vários eventos, incluindo o Natal', async () => {
    const dezembro = noMes(await todosOsEventos(), '2026-12');
    expect(dezembro.length).toBeGreaterThan(3);
    expect(dezembro.map((e) => e.title)).toContain('Natal');
  });

  it('o mês vazio passa a ter eventos assim que se cria um', async () => {
    await criarEvento({ title: 'Consulta', start_date: '2026-02-14' });
    expect(noMes(await todosOsEventos(), '2026-02').map((e) => e.title)).toEqual(['Consulta']);
  });

  it('um intervalo apanha os eventos de vários dias que o atravessam', async () => {
    const eventos = noIntervalo(await todosOsEventos(), '2026-08-01', '2026-08-05');
    expect(eventos.map((e) => e.id)).toContain('2026-ferias-judiciais-verao'); // 15/07 a 31/08
  });

  it('um intervalo invertido (fim antes do início) não devolve nada', async () => {
    expect(noIntervalo(await todosOsEventos(), '2026-12-31', '2026-01-01')).toEqual([]);
  });

  it('um intervalo de um só dia é o mesmo que a consulta por dia', async () => {
    const eventos = await todosOsEventos();
    expect(noIntervalo(eventos, '2026-04-25', '2026-04-25').map((e) => e.id))
      .toEqual(expect.arrayContaining(noDia(eventos, '2026-04-25').map((e) => e.id)));
  });

  it('um intervalo num ano sem eventos devolve lista vazia', async () => {
    expect(noIntervalo(await todosOsEventos(), '2019-01-01', '2019-12-31')).toEqual([]);
  });

  it('um evento que atravessa a meia-noite só aparece no dia em que começa', async () => {
    await criarEvento({
      title: 'Plantão', start_date: '2026-05-10T23:00:00Z', end_date: '2026-05-11T01:00:00Z', is_all_day: false,
    });
    const eventos = await todosOsEventos();
    expect(noDia(eventos, '2026-05-10').map((e) => e.title)).toContain('Plantão');
    expect(noDia(eventos, '2026-05-11').map((e) => e.title)).not.toContain('Plantão');
  });

  it('um evento que atravessa a meia-noite aparece nos dois dias quando se usa o intervalo', async () => {
    await criarEvento({
      title: 'Plantão', start_date: '2026-05-10T23:00:00Z', end_date: '2026-05-11T01:00:00Z', is_all_day: false,
    });
    const eventos = await todosOsEventos();
    expect(noIntervalo(eventos, '2026-05-11', '2026-05-11').map((e) => e.title)).toContain('Plantão');
  });

  it('um evento no último dia do ano não escorrega para o ano seguinte', async () => {
    await criarEvento({ title: 'Fecho de contas', start_date: '2026-12-31' });
    expect(noMes(await todosOsEventos(), '2027-01')).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — fuso Europe/Lisbon
// ═════════════════════════════════════════════════════════════════════════════
describe('datas e fuso Europe/Lisbon', () => {
  it('guarda a data-hora exatamente como veio, com o offset de verão (+01:00)', async () => {
    const id = await criarEvento({ start_date: '2026-07-20T15:00:00+01:00', is_all_day: false });
    const guardado = env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date;
    expect(guardado).toBe('2026-07-20T15:00:00+01:00');
    expect(horaEmLisboa(guardado)).toBe('15:00');
  });

  it('uma hora em UTC no verão mostra-se uma hora à frente em Lisboa', async () => {
    const id = await criarEvento({ start_date: '2026-07-20T14:00:00Z', is_all_day: false });
    const guardado = env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date;
    expect(horaEmLisboa(guardado)).toBe('15:00');
  });

  it('no inverno a hora de Lisboa coincide com UTC', async () => {
    const id = await criarEvento({ start_date: '2026-01-20T14:00:00Z', is_all_day: false });
    expect(horaEmLisboa(env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date))
      .toBe('14:00');
  });

  it('na noite da mudança para a hora de verão uma hora real parece duas no relógio', async () => {
    // 29/03/2026: às 01:00 UTC os relógios saltam de 01:00 (WET) para 02:00 (WEST).
    const id = await criarEvento({
      title: 'Vigília', start_date: '2026-03-29T00:30:00Z', end_date: '2026-03-29T01:30:00Z', is_all_day: false,
    });
    const e = env.DB.linha('SELECT start_date, end_date FROM calendar_events WHERE id = ?', id);
    expect(horaEmLisboa(e.start_date)).toBe('00:30');
    expect(horaEmLisboa(e.end_date)).toBe('02:30');
    expect(new Date(e.end_date) - new Date(e.start_date)).toBe(3600000); // uma hora, de facto
  });

  it('na volta à hora de inverno a mesma hora do relógio corresponde a dois instantes', async () => {
    // 25/10/2026: às 01:00 UTC os relógios recuam de 02:00 (WEST) para 01:00 (WET).
    const a = await criarEvento({ title: 'Antes', start_date: '2026-10-25T00:30:00Z', is_all_day: false });
    const b = await criarEvento({ title: 'Depois', start_date: '2026-10-25T01:30:00Z', is_all_day: false });
    const ea = env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', a).start_date;
    const eb = env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', b).start_date;
    expect(horaEmLisboa(ea)).toBe('01:30');
    expect(horaEmLisboa(eb)).toBe('01:30');
    expect(ea).not.toBe(eb);
  });

  it('um evento de dia inteiro no verão continua no mesmo dia em Lisboa', async () => {
    const id = await criarEvento({ start_date: '2026-07-15' });
    expect(diaEmLisboa(env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date))
      .toBe('2026-07-15');
  });

  it('a API não converte fusos: um mesmo instante em offsets diferentes fica como veio', async () => {
    const id = await criarEvento({ start_date: '2026-07-20T12:00:00-03:00', is_all_day: false });
    expect(env.DB.linha('SELECT start_date FROM calendar_events WHERE id = ?', id).start_date)
      .toBe('2026-07-20T12:00:00-03:00');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — tipos
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/calendar/types', () => {
  it('cria um tipo personalizado com id derivado do rótulo', async () => {
    const r = await cal('POST', '/api/calendar/types', { label: 'Reuniões internas', color: '#AABBCC' });
    expect(r.status).toBe(201);
    expect((await json(r)).id).toBe('reunioes_internas');
  });

  it('o tipo nasce visível e não nativo', async () => {
    await cal('POST', '/api/calendar/types', { label: 'Formações', color: '#AABBCC' });
    expect(env.DB.linha("SELECT is_default, is_visible FROM calendar_types WHERE id = 'formacoes'"))
      .toMatchObject({ is_default: 0, is_visible: 1 });
  });

  it('tira os acentos do id', async () => {
    const r = await cal('POST', '/api/calendar/types', { label: 'Audiência à distância', color: '#111' });
    expect((await json(r)).id).toBe('audiencia_a_distancia');
  });

  it('um rótulo que colide com um tipo nativo ganha sufixo', async () => {
    const r = await cal('POST', '/api/calendar/types', { label: 'Financeiro', color: '#111' });
    const id = (await json(r)).id;
    expect(id).toMatch(/^financeiro_[0-9a-f]{4}$/);
    expect(env.DB.conta('calendar_types', "label = 'Financeiro'")).toBe(2);
  });

  it('um rótulo só com símbolos vira o id «tipo»', async () => {
    expect((await json(await cal('POST', '/api/calendar/types', { label: '!!! ???', color: '#111' }))).id)
      .toBe('tipo');
  });

  it('o id é cortado aos 40 caracteres', async () => {
    const id = (await json(await cal('POST', '/api/calendar/types', { label: 'a'.repeat(80), color: '#111' }))).id;
    expect(id).toHaveLength(40);
  });

  it.each(['label', 'color'])('recusa sem %s', async (campo) => {
    const corpo = { label: 'X', color: '#111' };
    delete corpo[campo];
    expect((await cal('POST', '/api/calendar/types', corpo)).status).toBe(400);
  });

  it('recusa JSON inválido', async () => {
    expect((await cal('POST', '/api/calendar/types', 'nada disto')).status).toBe(400);
  });

  it('guarda a descrição quando vem', async () => {
    await cal('POST', '/api/calendar/types', { label: 'Perícias', color: '#111', description: 'Datas de perícia' });
    expect(env.DB.linha("SELECT description FROM calendar_types WHERE id = 'pericias'").description)
      .toBe('Datas de perícia');
  });
});

describe('PUT /api/calendar/types/:id', () => {
  it('num tipo nativo só muda a visibilidade', async () => {
    const r = await cal('PUT', '/api/calendar/types/feriado_nacional', { is_visible: false, label: 'Outro nome' });
    expect(r.status).toBe(200);
    expect(env.DB.linha("SELECT label, is_visible FROM calendar_types WHERE id = 'feriado_nacional'"))
      .toMatchObject({ label: 'Feriados nacionais', is_visible: 0 });
  });

  it('num tipo nativo, mexer só no rótulo não dá nada para atualizar', async () => {
    const r = await cal('PUT', '/api/calendar/types/feriado_nacional', { label: 'Outro nome' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Nenhum campo para atualizar');
  });

  it('num tipo personalizado muda rótulo, cor e descrição', async () => {
    await cal('POST', '/api/calendar/types', { label: 'Perícias', color: '#111' });
    await cal('PUT', '/api/calendar/types/pericias', { label: 'Perícias médicas', color: '#222', description: 'x' });
    expect(env.DB.linha("SELECT label, color, description FROM calendar_types WHERE id = 'pericias'"))
      .toMatchObject({ label: 'Perícias médicas', color: '#222', description: 'x' });
  });

  it('404 para um tipo que não existe', async () => {
    expect((await cal('PUT', '/api/calendar/types/inventado', { is_visible: true })).status).toBe(404);
  });

  it('recusa JSON inválido', async () => {
    expect((await cal('PUT', '/api/calendar/types/feriado_nacional', '{')).status).toBe(400);
  });

  it('volta a mostrar um tipo escondido', async () => {
    await cal('PUT', '/api/calendar/types/feriado_nacional', { is_visible: false });
    await cal('PUT', '/api/calendar/types/feriado_nacional', { is_visible: true });
    expect(env.DB.linha("SELECT is_visible FROM calendar_types WHERE id = 'feriado_nacional'").is_visible).toBe(1);
  });
});

describe('DELETE /api/calendar/types/:id', () => {
  async function tipoComEvento() {
    await cal('POST', '/api/calendar/types', { label: 'Perícias', color: '#111' });
    await criarEvento({ title: 'Perícia', type_id: 'pericias' });
  }

  it('recusa apagar um tipo nativo', async () => {
    const r = await cal('DELETE', '/api/calendar/types/feriado_nacional');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Tipos nativos não podem ser apagados');
  });

  it('404 para um tipo inexistente', async () => {
    expect((await cal('DELETE', '/api/calendar/types/inventado')).status).toBe(404);
  });

  it('com strategy=delete apaga também os eventos do tipo', async () => {
    await tipoComEvento();
    const r = await cal('DELETE', '/api/calendar/types/pericias?strategy=delete');
    expect(r.status).toBe(200);
    expect(env.DB.conta('calendar_events', "title = 'Perícia'")).toBe(0);
    expect(env.DB.conta('calendar_types', "id = 'pericias'")).toBe(0);
  });

  it('sem strategy os eventos passam para «Eventos pessoais»', async () => {
    await tipoComEvento();
    await cal('DELETE', '/api/calendar/types/pericias');
    expect(env.DB.linha("SELECT type_id FROM calendar_events WHERE title = 'Perícia'").type_id)
      .toBe('evento_pessoal');
  });

  it('uma strategy desconhecida comporta-se como «move»', async () => {
    await tipoComEvento();
    await cal('DELETE', '/api/calendar/types/pericias?strategy=seja-o-que-for');
    expect(env.DB.linha("SELECT type_id FROM calendar_events WHERE title = 'Perícia'").type_id)
      .toBe('evento_pessoal');
  });

  it('apagar um tipo sem eventos não mexe nos outros eventos', async () => {
    await cal('POST', '/api/calendar/types', { label: 'Vazio', color: '#111' });
    const antes = env.DB.conta('calendar_events');
    await cal('DELETE', '/api/calendar/types/vazio');
    expect(env.DB.conta('calendar_events')).toBe(antes);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — regras por cliente
// ═════════════════════════════════════════════════════════════════════════════
describe('/api/notifications/rules', () => {
  beforeEach(async () => {
    await env.DB.prepare('INSERT INTO clients (id, name, email, phone, country) VALUES (?, ?, ?, ?, ?)')
      .bind('cli-1', 'Maria Silva', 'maria@exemplo.pt', '+351911111111', 'PT').run();
    await env.DB.prepare('INSERT INTO clients (id, name, email, country) VALUES (?, ?, ?, ?)')
      .bind('cli-2', 'João Costa', 'joao@exemplo.br', 'BR').run();
  });

  const regra = (extra = {}) => nots('POST', '/api/notifications/rules',
    { id: 'r1', client_id: 'cli-1', channel: 'email', enabled: true, ...extra });

  it('cria uma regra e devolve 201', async () => {
    const r = await regra();
    expect(r.status).toBe(201);
    expect((await json(r)).id).toBe('r1');
  });

  it('o pré-aviso por omissão é de 3 dias', async () => {
    await regra();
    expect(env.DB.linha("SELECT days_before FROM notification_rules WHERE id = 'r1'").days_before).toBe(3);
  });

  it('days_before = 0 é respeitado (aviso no próprio dia)', async () => {
    await regra({ days_before: 0 });
    expect(env.DB.linha("SELECT days_before FROM notification_rules WHERE id = 'r1'").days_before).toBe(0);
  });

  // Documenta uma armadilha: quem criar a regra sem passar `enabled` fica com ela
  // desligada, apesar de a coluna ter DEFAULT 1 (worker/routes/notifications.js:62).
  it('sem o campo enabled a regra nasce desativada', async () => {
    await nots('POST', '/api/notifications/rules', { id: 'r2', client_id: 'cli-1', channel: 'email' });
    expect(env.DB.linha("SELECT enabled FROM notification_rules WHERE id = 'r2'").enabled).toBe(0);
  });

  it.each(['id', 'client_id', 'channel'])('recusa sem %s com 400', async (campo) => {
    const corpo = { id: 'r1', client_id: 'cli-1', channel: 'email' };
    delete corpo[campo];
    const r = await nots('POST', '/api/notifications/rules', corpo);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Campos obrigatórios em falta');
  });

  it('recusa JSON inválido', async () => {
    expect((await nots('POST', '/api/notifications/rules', 'xpto')).status).toBe(400);
  });

  // BUG: createRule (worker/routes/notifications.js:59-62) não confirma que o cliente
  // existe. A chave estrangeira rebenta e o router devolve 500 com o detalhe do SQL
  // em vez de um 400 dizendo que o cliente não existe.
  it.fails('recusa uma regra para um cliente inexistente com 400', async () => {
    const r = await nots('POST', '/api/notifications/rules',
      { id: 'r9', client_id: 'nao-existe', channel: 'email', enabled: true });
    expect(r.status).toBe(400);
  });

  // BUG: mesma origem — repetir o id viola a chave primária e sai 500 em vez de 409.
  it.fails('responde 409 quando o id da regra já existe', async () => {
    await regra();
    const r = await regra();
    expect(r.status).toBe(409);
  });

  it('lista todas as regras', async () => {
    await regra();
    await regra({ id: 'r2', client_id: 'cli-2' });
    expect((await json(await nots('GET', '/api/notifications/rules'))).rules).toHaveLength(2);
  });

  it('filtra as regras por cliente', async () => {
    await regra();
    await regra({ id: 'r2', client_id: 'cli-2' });
    const b = await json(await nots('GET', '/api/notifications/rules?client_id=cli-2'));
    expect(b.rules.map((x) => x.id)).toEqual(['r2']);
  });

  it('um cliente sem regras devolve lista vazia', async () => {
    expect((await json(await nots('GET', '/api/notifications/rules?client_id=cli-2'))).rules).toEqual([]);
  });

  it('altera o canal e o pré-aviso', async () => {
    await regra();
    const r = await nots('PATCH', '/api/notifications/rules/r1', { channel: 'whatsapp', days_before: 7 });
    expect(r.status).toBe(200);
    expect(env.DB.linha("SELECT channel, days_before FROM notification_rules WHERE id = 'r1'"))
      .toMatchObject({ channel: 'whatsapp', days_before: 7 });
  });

  it('desativa uma regra', async () => {
    await regra();
    await nots('PATCH', '/api/notifications/rules/r1', { enabled: false });
    expect(env.DB.linha("SELECT enabled FROM notification_rules WHERE id = 'r1'").enabled).toBe(0);
  });

  it('recusa um PATCH sem campos conhecidos', async () => {
    await regra();
    const r = await nots('PATCH', '/api/notifications/rules/r1', { inventado: 1 });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Nada para atualizar');
  });

  it('404 ao alterar uma regra inexistente', async () => {
    expect((await nots('PATCH', '/api/notifications/rules/rX', { enabled: true })).status).toBe(404);
  });

  it('apaga uma regra', async () => {
    await regra();
    expect((await nots('DELETE', '/api/notifications/rules/r1')).status).toBe(200);
    expect(env.DB.conta('notification_rules')).toBe(0);
  });

  it('404 ao apagar uma regra inexistente', async () => {
    expect((await nots('DELETE', '/api/notifications/rules/rX')).status).toBe(404);
  });

  it('apagar o cliente arrasta as regras dele', async () => {
    await regra();
    await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind('cli-1').run();
    expect(env.DB.conta('notification_rules')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — templates e registo
// ═════════════════════════════════════════════════════════════════════════════
describe('/api/notifications/templates', () => {
  beforeEach(() => {
    env.DB.exec(`INSERT INTO message_templates (id, name, channel, language, subject, body, is_default) VALUES
      ('t-email', 'Lembrete email', 'email', 'pt-PT', 'Assunto', 'Olá {{nome}}', 1),
      ('t-wa', 'Lembrete WhatsApp', 'whatsapp', 'pt-BR', NULL, 'Oi {{nome}}', 1)`);
  });

  it('lista os templates ordenados por idioma, canal e nome', async () => {
    const b = await json(await nots('GET', '/api/notifications/templates'));
    expect(b.templates.map((t) => t.id)).toEqual(['t-wa', 't-email']); // pt-BR antes de pt-PT
  });

  it('devolve um template pelo id', async () => {
    const b = await json(await nots('GET', '/api/notifications/templates/t-email'));
    expect(b.template.body).toBe('Olá {{nome}}');
  });

  it('404 para um template inexistente', async () => {
    expect((await nots('GET', '/api/notifications/templates/nada')).status).toBe(404);
  });

  it('altera o corpo do template', async () => {
    const r = await nots('PUT', '/api/notifications/templates/t-email', { body: 'Bom dia {{nome}}' });
    expect(r.status).toBe(200);
    expect(env.DB.linha("SELECT body FROM message_templates WHERE id = 't-email'").body).toBe('Bom dia {{nome}}');
  });

  it('não deixa alterar o canal do template', async () => {
    const r = await nots('PUT', '/api/notifications/templates/t-email', { channel: 'whatsapp' });
    expect(r.status).toBe(400);
    expect(env.DB.linha("SELECT channel FROM message_templates WHERE id = 't-email'").channel).toBe('email');
  });

  it('404 ao alterar um template inexistente', async () => {
    expect((await nots('PUT', '/api/notifications/templates/nada', { body: 'x' })).status).toBe(404);
  });

  it('recusa JSON inválido', async () => {
    expect((await nots('PUT', '/api/notifications/templates/t-email', '{')).status).toBe(400);
  });
});

describe('GET /api/notifications/log', () => {
  beforeEach(async () => {
    env.DB.exec(`INSERT INTO clients (id, name, email, country) VALUES ('cli-1', 'Maria Silva', 'm@e.pt', 'PT')`);
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
                 VALUES ('i-1', 'cli-1', 1, 3, 100, '2026-09-01')`);
    for (let i = 1; i <= 5; i++) {
      env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status, sent_at, message_preview)
                   VALUES ('n-${i}', 'i-1', 'cli-1', 'email', 'sent', '2026-08-0${i}T10:00:00Z', 'msg ${i}')`);
    }
  });

  it('devolve o registo do mais recente para o mais antigo', async () => {
    const b = await json(await nots('GET', '/api/notifications/log'));
    expect(b.log.map((l) => l.id)).toEqual(['n-5', 'n-4', 'n-3', 'n-2', 'n-1']);
  });

  it('junta o nome do cliente a cada linha', async () => {
    const b = await json(await nots('GET', '/api/notifications/log'));
    expect(b.log[0].client_name).toBe('Maria Silva');
  });

  it('respeita o limite pedido', async () => {
    const b = await json(await nots('GET', '/api/notifications/log?limit=2'));
    expect(b.log).toHaveLength(2);
  });

  it('o limite máximo é 200', async () => {
    await nots('GET', '/api/notifications/log?limit=9999');
    const ultima = env.DB.queries[env.DB.queries.length - 1];
    expect(ultima.args[ultima.args.length - 1]).toBe(200);
  });

  it('filtra por cliente', async () => {
    env.DB.exec(`INSERT INTO clients (id, name, country) VALUES ('cli-2', 'João', 'BR')`);
    const b = await json(await nots('GET', '/api/notifications/log?client_id=cli-2'));
    expect(b.log).toEqual([]);
  });

  // BUG: `Math.min(parseInt('abc', 10), 200)` dá NaN e vai direto para o LIMIT
  // (worker/routes/notifications.js:136,146-149) — não há queda para o valor por
  // omissão. O driver de SQLite recusa o NaN («datatype mismatch») e o pedido sai
  // com 500; no D1 o NaN vira null e o LIMIT desaparece, devolvendo o registo todo.
  it.fails('um limite não numérico cai no valor por omissão', async () => {
    const r = await nots('GET', '/api/notifications/log?limit=abc');
    expect(r.status).toBe(200);
    expect(Array.isArray((await json(r)).log)).toBe(true);
  });

  it('um limite negativo não devolve nada de errado', async () => {
    const r = await nots('GET', '/api/notifications/log?limit=-1');
    expect(r.status).toBe(200);
    expect(Array.isArray((await json(r)).log)).toBe(true);
  });

  it('mostra as linhas mesmo quando o cliente já não existe', async () => {
    // O LEFT JOIN protege o registo histórico; sem cliente o nome vem a null.
    env.DB.exec(`INSERT INTO clients (id, name, country) VALUES ('cli-3', 'Ana', 'PT')`);
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
                 VALUES ('i-3', 'cli-3', 1, 1, 50, '2026-09-01')`);
    env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status, sent_at)
                 VALUES ('n-9', 'i-3', 'cli-3', 'email', 'sent', '2026-08-09T10:00:00Z')`);
    env.DB.exec(`PRAGMA foreign_keys = OFF`);
    env.DB.exec(`DELETE FROM clients WHERE id = 'cli-3'`);
    env.DB.exec(`PRAGMA foreign_keys = ON`);
    const b = await json(await nots('GET', '/api/notifications/log'));
    expect(b.log[0]).toMatchObject({ id: 'n-9', client_name: null });
  });

  it('registo vazio devolve lista vazia', async () => {
    env.DB.exec('DELETE FROM notification_log');
    expect((await json(await nots('GET', '/api/notifications/log'))).log).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — alertas da Dra. (owner-prefs)
// ═════════════════════════════════════════════════════════════════════════════
describe('/api/notifications/owner-prefs', () => {
  it('devolve as preferências semeadas, o contacto e o histórico', async () => {
    const b = await json(await nots('GET', '/api/notifications/owner-prefs'));
    expect(b.prefs.map((p) => p.alert_type).sort())
      .toEqual(['em_atraso', 'pagamento_recebido', 'resumo_diario', 'vence_hoje']);
    expect(b.contacts.email).toBe('vyavena@gmail.com');
    expect(b.log).toEqual([]);
  });

  it('liga e desliga um tipo de alerta', async () => {
    const b = await json(await nots('PUT', '/api/notifications/owner-prefs', {
      prefs: [{ alert_type: 'resumo_diario', email_enabled: true, whatsapp_enabled: false }],
    }));
    expect(b.prefs.find((p) => p.alert_type === 'resumo_diario'))
      .toMatchObject({ email_enabled: 1, whatsapp_enabled: 0 });
  });

  it('recusa um tipo de alerta desconhecido', async () => {
    const r = await nots('PUT', '/api/notifications/owner-prefs', {
      prefs: [{ alert_type: 'inventado', email_enabled: true }],
    });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toContain('inventado');
  });

  it('para na primeira preferência inválida sem gravar as seguintes', async () => {
    await nots('PUT', '/api/notifications/owner-prefs', {
      prefs: [{ alert_type: 'inventado' }, { alert_type: 'resumo_diario', email_enabled: true }],
    });
    expect(env.DB.linha("SELECT email_enabled FROM owner_alert_prefs WHERE alert_type = 'resumo_diario'")
      .email_enabled).toBe(0);
  });

  it('atualiza os contactos de destino', async () => {
    const b = await json(await nots('PUT', '/api/notifications/owner-prefs', {
      contacts: { email: 'dra@vyavenaadv.com', whatsapp: '+351911222333' },
    }));
    expect(b.contacts).toEqual({ email: 'dra@vyavenaadv.com', whatsapp: '+351911222333' });
  });

  it('um contacto vazio fica a null', async () => {
    const b = await json(await nots('PUT', '/api/notifications/owner-prefs', {
      contacts: { email: '', whatsapp: '' },
    }));
    expect(b.contacts).toEqual({ email: null, whatsapp: null });
  });

  it('um PUT sem prefs nem contacts devolve o estado atual sem mudar nada', async () => {
    const antes = await json(await nots('GET', '/api/notifications/owner-prefs'));
    const depois = await json(await nots('PUT', '/api/notifications/owner-prefs', {}));
    expect(depois.prefs).toEqual(antes.prefs);
  });

  it('recusa JSON inválido', async () => {
    expect((await nots('PUT', '/api/notifications/owner-prefs', '{')).status).toBe(400);
  });

  it('o histórico de alertas vem do mais recente para o mais antigo e limitado a 20', async () => {
    for (let i = 1; i <= 25; i++) {
      env.DB.exec(`INSERT INTO owner_alert_log (id, alert_type, channel, status, sent_at, sent_date)
                   VALUES ('a-${i}', 'vence_hoje', 'email', 'sent', '2026-08-01T${String(i % 24).padStart(2, '0')}:00:00Z', '2026-08-01')`);
    }
    const b = await json(await nots('GET', '/api/notifications/owner-prefs'));
    expect(b.log).toHaveLength(20);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — rotas desconhecidas
// ═════════════════════════════════════════════════════════════════════════════
describe('notificações — rotas desconhecidas', () => {
  it.each([
    ['GET', '/api/notifications'],
    ['PUT', '/api/notifications/rules'],
    ['POST', '/api/notifications/templates'],
    ['DELETE', '/api/notifications/templates/t-1'],
    ['POST', '/api/notifications/log'],
    ['DELETE', '/api/notifications/owner-prefs'],
    ['GET', '/api/notifications/inventado'],
    ['GET', '/api/notifications/process-queue'],
  ])('%s %s devolve 404', async (metodo, caminho) => {
    const r = await nots(metodo, caminho, metodo === 'GET' || metodo === 'DELETE' ? undefined : {});
    expect(r.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — processamento da fila (cron)
// ═════════════════════════════════════════════════════════════════════════════
// O SQLite avalia date('now') com o relógio verdadeiro, por isso as datas semeadas
// são calculadas a partir da data real de hoje (UTC) em vez de um instante fixo.
describe('POST /api/notifications/process-queue', () => {
  const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeEach(async () => {
    env.DB.exec(`INSERT INTO clients (id, name, email, phone, country)
                 VALUES ('cli-1', 'Maria Silva', 'maria@exemplo.pt', '+351911111111', 'PT')`);
    // Só os alertas à Dra. desligados é que deixam o teste focado nas regras dos clientes.
    env.DB.exec(`UPDATE owner_alert_prefs SET email_enabled = 0, whatsapp_enabled = 0`);
  });

  const parcela = (id, dias, status = 'pending') => env.DB.exec(
    `INSERT INTO installments (id, client_id, installment_number, total_installments, amount, currency, due_date, status)
     VALUES ('${id}', 'cli-1', 1, 3, 150.5, 'EUR', '${dia(dias)}', '${status}')`);
  const regra = (extra = '') => env.DB.exec(
    `INSERT INTO notification_rules (id, client_id, channel, days_before, enabled)
     VALUES ('r1', 'cli-1', 'email', 3, 1)${extra}`);

  it('envia o lembrete da parcela que vence dentro de days_before dias', async () => {
    const f = mockFetch({ json: { id: 'email-1' } });
    vi.stubGlobal('fetch', f);
    parcela('i-1', 3);
    regra();
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBe(1);
    expect(f.chamadas.some((c) => c.url.includes('resend.com'))).toBe(true);
    expect(env.DB.linha("SELECT status, channel FROM notification_log WHERE installment_id = 'i-1'"))
      .toMatchObject({ status: 'sent', channel: 'email' });
  });

  it('ignora parcelas que vencem noutro dia', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    parcela('i-1', 5);
    regra();
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBe(0);
    expect(env.DB.conta('notification_log')).toBe(0);
  });

  it('não processa regras desativadas', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    parcela('i-1', 3);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel, days_before, enabled)
                 VALUES ('r1', 'cli-1', 'email', 3, 0)`);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBe(0);
    expect(f.chamadas).toHaveLength(0);
  });

  it('não repete o envio do mesmo canal para a mesma parcela no mesmo dia', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'x' } }));
    parcela('i-1', 3);
    regra();
    await nots('POST', '/api/notifications/process-queue');
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBe(0);
    expect(b.skipped).toBeGreaterThanOrEqual(1);
    expect(env.DB.conta('notification_log')).toBe(1);
  });

  it('um envio falhado fica registado como erro e não trava o cron', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'servidor em baixo' } }));
    parcela('i-1', 3);
    regra();
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.ok).toBe(true);
    expect(b.errors).toBeGreaterThanOrEqual(1);
    expect(env.DB.linha("SELECT status, error_message FROM notification_log WHERE installment_id = 'i-1'"))
      .toMatchObject({ status: 'error', error_message: 'servidor em baixo' });
  });

  it('uma falha de rede no envio também fica registada', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'rede em baixo' }));
    parcela('i-1', 3);
    regra();
    await nots('POST', '/api/notifications/process-queue');
    expect(env.DB.linha("SELECT status FROM notification_log WHERE installment_id = 'i-1'").status).toBe('error');
  });

  it('um envio falhado volta a ser tentado no disparo seguinte', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: {} }));
    parcela('i-1', 3);
    regra();
    await nots('POST', '/api/notifications/process-queue');
    // O dedupe é por (parcela, canal, dia) MAS só conta o que ficou 'sent'
    // (worker/cron.js:57) — senão uma falha passageira calava o lembrete para sempre.
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'ok' } }));
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBeGreaterThanOrEqual(1);
  });

  it('cliente sem e-mail: o envio é saltado e registado como skipped', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    env.DB.exec(`UPDATE clients SET email = NULL WHERE id = 'cli-1'`);
    parcela('i-1', 3);
    regra();
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.skipped).toBeGreaterThanOrEqual(1);
    expect(env.DB.linha("SELECT status FROM notification_log WHERE installment_id = 'i-1'").status).toBe('skipped');
    expect(f.chamadas).toHaveLength(0);
  });

  it('canal desconhecido é saltado com registo próprio', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    parcela('i-1', 3);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel, days_before, enabled)
                 VALUES ('r1', 'cli-1', 'pombo-correio', 3, 1)`);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.skipped).toBeGreaterThanOrEqual(1);
    expect(f.chamadas).toHaveLength(0);
  });

  it('whatsapp sem credenciais Z-API é saltado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    parcela('i-1', 3);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel, days_before, enabled)
                 VALUES ('r1', 'cli-1', 'whatsapp', 3, 1)`);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.skipped).toBeGreaterThanOrEqual(1);
    expect(env.DB.linha("SELECT status, channel FROM notification_log WHERE installment_id = 'i-1'"))
      .toMatchObject({ status: 'skipped', channel: 'whatsapp' });
  });

  it('usa o template da regra para compor a mensagem', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'x' } }));
    env.DB.exec(`INSERT INTO message_templates (id, name, channel, subject, body, is_default)
                 VALUES ('t-1', 'Aviso', 'email', 'Parcela de {{nome}}', 'Olá {{nome}}, {{valor}} a {{vencimento}}', 0)`);
    parcela('i-1', 3);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel, days_before, enabled, template_id)
                 VALUES ('r1', 'cli-1', 'email', 3, 1, 't-1')`);
    await nots('POST', '/api/notifications/process-queue');
    expect(env.DB.linha("SELECT message_preview FROM notification_log WHERE installment_id = 'i-1'").message_preview)
      .toContain('Olá Maria Silva, 150,50 €');
  });

  it('sem template usa a mensagem por omissão', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'x' } }));
    parcela('i-1', 3);
    regra();
    await nots('POST', '/api/notifications/process-queue');
    expect(env.DB.linha("SELECT message_preview FROM notification_log WHERE installment_id = 'i-1'").message_preview)
      .toContain('lembramos que a parcela 1/3');
  });

  it('atualiza os estados das parcelas antes de notificar', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    parcela('i-atrasada', -2);
    parcela('i-hoje', 0);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.updated_late).toBe(1);
    expect(b.updated_due_today).toBe(1);
    expect(env.DB.linha("SELECT status FROM installments WHERE id = 'i-atrasada'").status).toBe('late');
    expect(env.DB.linha("SELECT status FROM installments WHERE id = 'i-hoje'").status).toBe('due_today');
  });

  it('não notifica parcelas já pagas', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    parcela('i-1', 3, 'paid');
    regra();
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.notified).toBe(0);
    expect(f.chamadas).toHaveLength(0);
  });

  it('sem regras nem parcelas o resumo vem todo a zero', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b).toMatchObject({ ok: true, updated_late: 0, updated_due_today: 0, notified: 0, errors: 0 });
  });

  it('avisa a Dra. quando há parcelas a vencer hoje e o alerta está ligado', async () => {
    const f = mockFetch({ json: { id: 'x' } });
    vi.stubGlobal('fetch', f);
    env.DB.exec(`UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'vence_hoje'`);
    parcela('i-hoje', 0);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.owner_alerts.vence_hoje).toMatchObject({ email: 'sent' });
    expect(env.DB.conta('owner_alert_log', "alert_type = 'vence_hoje'")).toBe(1);
  });

  it('o alerta à Dra. não se repete no mesmo dia', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'x' } }));
    env.DB.exec(`UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'vence_hoje'`);
    parcela('i-hoje', 0);
    await nots('POST', '/api/notifications/process-queue');
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.owner_alerts.vence_hoje).toMatchObject({ email: 'dedupe' });
    expect(env.DB.conta('owner_alert_log')).toBe(1);
  });

  it('sem contacto configurado o alerta à Dra. não é enviado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    env.DB.exec(`UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'vence_hoje'`);
    env.DB.exec(`UPDATE owner_alert_contacts SET email = NULL WHERE id = 1`);
    parcela('i-hoje', 0);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.owner_alerts.vence_hoje).toMatchObject({ email: 'sem destino configurado' });
  });

  it('a falha do sync do Instagram não deita o cron abaixo', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.ok).toBe(true);
    expect(b.instagram).toHaveProperty('error');
  });

  it('limpa os hashes de visitantes com mais de 35 dias', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    const antigo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const recente = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    env.DB.exec(`INSERT INTO site_visitors_daily (day, visitor_hash) VALUES ('${antigo}', 'h1'), ('${recente}', 'h2')`);
    const b = await json(await nots('POST', '/api/notifications/process-queue'));
    expect(b.visitors_pruned).toBe(1);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
  });
});
