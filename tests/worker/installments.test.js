// tests/worker/installments.test.js
// Parcelas de honorários (worker/routes/installments.js) e os alertas que elas
// disparam para a Dra. (worker/lib/owner_alerts.js). É o dinheiro do escritório:
// valores, datas, estados e avisos têm de aguentar entradas torcidas.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleInstallments } from '../../worker/routes/installments.js';
import {
  loadOwnerAlertConfig,
  dispatchOwnerAlert,
  runOwnerDailyAlerts,
  ownerPaymentReceivedAlert,
} from '../../worker/lib/owner_alerts.js';
import { criarEnv, req, json, mockFetch } from '../helpers/env.js';

const SESSAO = { sub: 1, name: 'Victor', email: 'v@exemplo.pt', role: 'admin' };

// O SQLite usa o relógio real (date('now') não é afetado pelo vi.setSystemTime),
// por isso as datas relativas são calculadas a partir do agora verdadeiro, em UTC.
const dia = (n = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let env;
let fetchPadrao;

// Chama a rota. `caminho` pode trazer query string; o handler recebe só o pathname.
const rota = (metodo, caminho, opts = {}) =>
  handleInstallments(req(metodo, caminho, opts), env, caminho.split('?')[0], SESSAO);

const criarCliente = (id, nome, pais = 'PT', extra = {}) =>
  env.DB.prepare('INSERT INTO clients (id, name, email, phone, country) VALUES (?, ?, ?, ?, ?)')
    .bind(id, nome, extra.email ?? `${id}@exemplo.pt`, extra.phone ?? '351911111111', pais).run();

// Semeia diretamente na BD (sem passar pela validação da rota).
const semear = (id, campos = {}) =>
  env.DB.prepare(`
    INSERT INTO installments (id, client_id, installment_number, total_installments, amount, currency, due_date, status, paid_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      campos.client_id ?? 'cli-1',
      campos.installment_number ?? 1,
      campos.total_installments ?? 3,
      campos.amount ?? 100,
      campos.currency ?? 'EUR',
      campos.due_date ?? dia(7),
      campos.status ?? 'pending',
      campos.paid_date ?? null,
    ).run();

const corpoValido = (extra = {}) => ({
  id: 'par-1',
  client_id: 'cli-1',
  installment_number: 1,
  total_installments: 3,
  amount: 250,
  due_date: '2026-09-15',
  ...extra,
});

beforeEach(async () => {
  env = criarEnv();
  await criarCliente('cli-1', 'Maria Silva', 'PT');
  await criarCliente('cli-2', 'João Santos', 'BR', { email: null, phone: null });
  // Rede sempre controlada: nenhum teste pode escapar para a internet.
  fetchPadrao = mockFetch({ json: { id: 'email-1' } });
  vi.stubGlobal('fetch', fetchPadrao);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// ─── encaminhamento e métodos ────────────────────────────────────────────────
describe('handleInstallments — encaminhamento', () => {
  it('GET na coleção devolve a listagem', async () => {
    const r = await rota('GET', '/api/installments');
    expect(r.status).toBe(200);
    expect((await json(r)).installments).toEqual([]);
  });

  it('barra final continua a apontar para a coleção', async () => {
    const r = await rota('GET', '/api/installments/');
    expect((await json(r)).installments).toEqual([]);
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    '%s na coleção devolve 405', async (metodo) => {
      const r = await rota(metodo, '/api/installments');
      expect(r.status).toBe(405);
      expect((await json(r)).error).toBe('Method not allowed');
    });

  it.each(['PUT', 'POST', 'OPTIONS'])('%s numa parcela devolve 405', async (metodo) => {
    await semear('par-1');
    const r = await rota(metodo, '/api/installments/par-1', { body: {} });
    expect(r.status).toBe(405);
  });

  it('a resposta é JSON com os cabeçalhos CORS', async () => {
    const r = await rota('GET', '/api/installments');
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('o segmento "upcoming" ganha à leitura por id', async () => {
    await semear('upcoming', { due_date: dia(1) });
    const b = await json(await rota('GET', '/api/installments/upcoming'));
    expect(b.installments).toBeDefined();
    expect(b.installment).toBeUndefined();
  });
});

// ─── listagem e filtros ──────────────────────────────────────────────────────
describe('GET /api/installments — listagem e filtros', () => {
  beforeEach(async () => {
    await semear('a', { client_id: 'cli-1', due_date: '2026-01-10', status: 'paid', amount: 100 });
    await semear('b', { client_id: 'cli-1', due_date: '2026-08-05', status: 'pending', amount: 200 });
    await semear('c', { client_id: 'cli-2', due_date: '2026-08-20', status: 'late', amount: 300 });
    await semear('d', { client_id: 'cli-2', due_date: '2027-03-01', status: 'pending', amount: 400 });
  });

  it('devolve todas as parcelas quando não há filtros', async () => {
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments).toHaveLength(4);
  });

  it('ordena por data de vencimento crescente', async () => {
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('junta o nome, país e contactos do cliente a cada parcela', async () => {
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments[0]).toMatchObject({
      client_name: 'Maria Silva',
      client_country: 'PT',
      client_email: 'cli-1@exemplo.pt',
      client_phone: '351911111111',
    });
  });

  it('filtra por estado', async () => {
    const b = await json(await rota('GET', '/api/installments?status=pending'));
    expect(b.installments.map((p) => p.id)).toEqual(['b', 'd']);
  });

  it('filtra por cliente', async () => {
    const b = await json(await rota('GET', '/api/installments?client_id=cli-2'));
    expect(b.installments.map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('combina estado e cliente', async () => {
    const b = await json(await rota('GET', '/api/installments?client_id=cli-2&status=late'));
    expect(b.installments.map((p) => p.id)).toEqual(['c']);
  });

  it('filtra por mês (YYYY-MM)', async () => {
    const b = await json(await rota('GET', '/api/installments?month=2026-08'));
    expect(b.installments.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('filtra por ano', async () => {
    const b = await json(await rota('GET', '/api/installments?year=2026'));
    expect(b.installments).toHaveLength(3);
  });

  it('mês e ano contraditórios devolvem lista vazia', async () => {
    const b = await json(await rota('GET', '/api/installments?month=2026-08&year=2027'));
    expect(b.installments).toEqual([]);
  });

  it('cliente inexistente devolve lista vazia, não 404', async () => {
    const r = await rota('GET', '/api/installments?client_id=nao-existe');
    expect(r.status).toBe(200);
    expect((await json(r)).installments).toEqual([]);
  });

  it('estado inventado devolve lista vazia', async () => {
    expect((await json(await rota('GET', '/api/installments?status=banana'))).installments).toEqual([]);
  });

  it('mês em formato errado devolve lista vazia', async () => {
    expect((await json(await rota('GET', '/api/installments?month=agosto'))).installments).toEqual([]);
  });

  it('parâmetros vazios são ignorados (devolve tudo)', async () => {
    const b = await json(await rota('GET', '/api/installments?status=&client_id=&month=&year='));
    expect(b.installments).toHaveLength(4);
  });

  it('tabela vazia devolve um array vazio, nunca null', async () => {
    await env.DB.prepare('DELETE FROM installments').run();
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments).toEqual([]);
    expect(b.installments).not.toBe(null);
  });

  it('não devolve parcelas de clientes apagados (o JOIN exclui órfãs)', async () => {
    await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind('cli-2').run();
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('aspas simples no filtro não injetam SQL', async () => {
    const r = await rota('GET', "/api/installments?status=' OR 1=1 --");
    expect(r.status).toBe(200);
    expect((await json(r)).installments).toEqual([]);
    expect(env.DB.conta('installments')).toBe(4);
  });
});

// ─── agregações ──────────────────────────────────────────────────────────────
describe('Agregações sobre a listagem', () => {
  const soma = (linhas) => linhas.reduce((t, p) => t + Number(p.amount), 0);

  it('a soma com a tabela vazia é 0 e não NaN', async () => {
    const b = await json(await rota('GET', '/api/installments'));
    const total = soma(b.installments);
    expect(total).toBe(0);
    expect(Number.isNaN(total)).toBe(false);
  });

  it('soma os valores de um cliente', async () => {
    await semear('a', { client_id: 'cli-1', amount: 100.5 });
    await semear('b', { client_id: 'cli-1', amount: 200.25 });
    await semear('c', { client_id: 'cli-2', amount: 999 });
    const b = await json(await rota('GET', '/api/installments?client_id=cli-1'));
    expect(soma(b.installments)).toBeCloseTo(300.75, 2);
  });

  it('a soma de um cliente sem parcelas é 0', async () => {
    await semear('a', { client_id: 'cli-1', amount: 100 });
    const b = await json(await rota('GET', '/api/installments?client_id=cli-2'));
    expect(soma(b.installments)).toBe(0);
  });

  it('valores negativos entram na soma com o sinal (nota de crédito)', async () => {
    await semear('a', { client_id: 'cli-1', amount: 500 });
    await semear('b', { client_id: 'cli-1', amount: -200 });
    const b = await json(await rota('GET', '/api/installments?client_id=cli-1'));
    expect(soma(b.installments)).toBe(300);
  });

  it('o total por estado separa pago de pendente', async () => {
    await semear('a', { amount: 100, status: 'paid' });
    await semear('b', { amount: 250, status: 'pending' });
    const pagas = await json(await rota('GET', '/api/installments?status=paid'));
    const pendentes = await json(await rota('GET', '/api/installments?status=pending'));
    expect(soma(pagas.installments)).toBe(100);
    expect(soma(pendentes.installments)).toBe(250);
  });

  it('SUM de tabela vazia em SQL devolve NULL — o resumo tem de o tratar', async () => {
    const r = env.DB.linha("SELECT SUM(amount) AS t FROM installments WHERE status = 'pending'");
    expect(r.t).toBe(null);
  });
});

// ─── próximos vencimentos ────────────────────────────────────────────────────
describe('GET /api/installments/upcoming', () => {
  beforeEach(async () => {
    await semear('ontem', { due_date: dia(-1), status: 'late' });
    await semear('hoje', { due_date: dia(0), status: 'due_today' });
    await semear('daqui5', { due_date: dia(5), status: 'pending' });
    await semear('daqui40', { due_date: dia(40), status: 'pending' });
    await semear('paga', { due_date: dia(2), status: 'paid' });
  });

  it('sem parâmetro assume 30 dias', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming'));
    expect(b.installments.map((p) => p.id)).toEqual(['ontem', 'hoje', 'daqui5']);
  });

  it('respeita a janela de dias pedida', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=45'));
    expect(b.installments.map((p) => p.id)).toContain('daqui40');
  });

  it('days=0 ainda inclui o que vence hoje e o que está em atraso', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=0'));
    expect(b.installments.map((p) => p.id)).toEqual(['ontem', 'hoje']);
  });

  it('exclui parcelas já pagas', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=365'));
    expect(b.installments.map((p) => p.id)).not.toContain('paga');
  });

  it('inclui pendentes, a vencer hoje e em atraso', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=365'));
    expect(b.installments.map((p) => p.status).sort()).toEqual(['due_today', 'late', 'pending', 'pending']);
  });

  it('days decimal é truncado para inteiro', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=5.9'));
    expect(b.installments.map((p) => p.id)).toEqual(['ontem', 'hoje', 'daqui5']);
  });

  it('janela enorme devolve tudo o que está por pagar', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=999999'));
    expect(b.installments).toHaveLength(4);
  });

  it('traz os contactos do cliente para o lembrete', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming'));
    expect(b.installments[0].client_phone).toBe('351911111111');
  });

  it('ordena por vencimento crescente', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=365'));
    const datas = b.installments.map((p) => p.due_date);
    expect([...datas].sort()).toEqual(datas);
  });

  // CORRIGIDO (era): worker/routes/installments.js:58 — parseInt('abc') dá NaN, que é ligado ao
  // modificador `date('now','+' || ? || ' days')` e devolve NULL, logo a lista sai
  // VAZIA em silêncio. Um parâmetro inválido devia cair no default de 30 dias (ou
  // dar 400), nunca fingir que não há vencimentos.
  it('days não numérico volta ao default de 30 dias', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=abc'));
    expect(b.installments.map((p) => p.id)).toEqual(['ontem', 'hoje', 'daqui5']);
  });

  // CORRIGIDO (era): worker/routes/installments.js:58 — days negativo produz o modificador
  // '+-5 days', inválido em SQLite → NULL → lista vazia, sem erro nenhum.
  it('days negativo não engole silenciosamente os atrasos', async () => {
    const b = await json(await rota('GET', '/api/installments/upcoming?days=-5'));
    expect(b.installments.map((p) => p.id)).toContain('ontem');
  });

  it('sem parcelas devolve lista vazia', async () => {
    await env.DB.prepare('DELETE FROM installments').run();
    expect((await json(await rota('GET', '/api/installments/upcoming'))).installments).toEqual([]);
  });
});

// ─── leitura de uma parcela ──────────────────────────────────────────────────
describe('GET /api/installments/:id', () => {
  it('devolve a parcela com os dados do cliente', async () => {
    await semear('par-1', { amount: 123.45, currency: 'BRL' });
    const b = await json(await rota('GET', '/api/installments/par-1'));
    expect(b.installment).toMatchObject({
      id: 'par-1', amount: 123.45, currency: 'BRL', client_name: 'Maria Silva', client_country: 'PT',
    });
  });

  it('a resposta traz a parcela em `installment`, não em `installments`', async () => {
    await semear('par-1');
    const b = await json(await rota('GET', '/api/installments/par-1'));
    expect(Object.keys(b)).toEqual(['installment']);
  });

  it('404 para parcela inexistente', async () => {
    const r = await rota('GET', '/api/installments/nao-existe');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Parcela não encontrada');
  });

  it('404 quando o cliente da parcela já não existe', async () => {
    await semear('par-1');
    await env.DB.prepare('PRAGMA foreign_keys = OFF').run();
    await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind('cli-1').run();
    expect((await rota('GET', '/api/installments/par-1')).status).toBe(404);
  });

  it('id com caracteres estranhos não injeta SQL', async () => {
    await semear('par-1');
    const r = await rota('GET', "/api/installments/x' OR '1'='1");
    expect(r.status).toBe(404);
  });
});

// ─── criação ─────────────────────────────────────────────────────────────────
describe('POST /api/installments — criação', () => {
  it('cria a parcela e devolve 201', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido() });
    expect(r.status).toBe(201);
    expect(await json(r)).toEqual({ ok: true, id: 'par-1' });
  });

  it('a parcela nasce pendente', async () => {
    await rota('POST', '/api/installments', { body: corpoValido() });
    expect(env.DB.linha('SELECT status FROM installments WHERE id = ?', 'par-1').status).toBe('pending');
  });

  it('a moeda por omissão é EUR', async () => {
    await rota('POST', '/api/installments', { body: corpoValido() });
    expect(env.DB.linha('SELECT currency FROM installments WHERE id = ?', 'par-1').currency).toBe('EUR');
  });

  it('aceita outra moeda', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ currency: 'BRL' }) });
    expect(env.DB.linha('SELECT currency FROM installments WHERE id = ?', 'par-1').currency).toBe('BRL');
  });

  it('moeda vazia cai no default EUR', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ currency: '' }) });
    expect(env.DB.linha('SELECT currency FROM installments WHERE id = ?', 'par-1').currency).toBe('EUR');
  });

  it('guarda as notas', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ notes: 'Entrada do contrato' }) });
    expect(env.DB.linha('SELECT notes FROM installments WHERE id = ?', 'par-1').notes).toBe('Entrada do contrato');
  });

  it('sem notas fica NULL', async () => {
    await rota('POST', '/api/installments', { body: corpoValido() });
    expect(env.DB.linha('SELECT notes FROM installments WHERE id = ?', 'par-1').notes).toBe(null);
  });

  it('a parcela criada aparece imediatamente na listagem', async () => {
    await rota('POST', '/api/installments', { body: corpoValido() });
    const b = await json(await rota('GET', '/api/installments'));
    expect(b.installments).toHaveLength(1);
  });

  it.each(['id', 'client_id', 'installment_number', 'total_installments', 'amount', 'due_date'])(
    'recusa sem %s com 400', async (campo) => {
      const corpo = corpoValido();
      delete corpo[campo];
      const r = await rota('POST', '/api/installments', { body: corpo });
      expect(r.status).toBe(400);
      expect((await json(r)).error).toBe('Campos obrigatórios em falta');
      expect(env.DB.conta('installments')).toBe(0);
    });

  it.each(['id', 'client_id', 'due_date'])('recusa %s vazio', async (campo) => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ [campo]: '' }) });
    expect(r.status).toBe(400);
  });

  it.each(['id', 'client_id', 'amount', 'due_date'])('recusa %s a null', async (campo) => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ [campo]: null }) });
    expect(r.status).toBe(400);
  });

  it('recusa JSON inválido com 400', async () => {
    const r = await rota('POST', '/api/installments', {
      body: '{isto não é json', headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Invalid JSON');
  });

  it('recusa pedido sem corpo nenhum com 400', async () => {
    const r = await handleInstallments(req('POST', '/api/installments'), env, '/api/installments', SESSAO);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Invalid JSON');
  });

  it('corpo JSON `null` é tratado como campos em falta', async () => {
    const r = await rota('POST', '/api/installments', { body: 'null' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Campos obrigatórios em falta');
  });

  it('corpo que é um array devolve 400', async () => {
    const r = await rota('POST', '/api/installments', { body: '[1,2,3]' });
    expect(r.status).toBe(400);
  });

  it('campos desconhecidos são ignorados', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ status: 'paid', hacker: 1 }) });
    expect(r.status).toBe(201);
    expect(env.DB.linha('SELECT status FROM installments WHERE id = ?', 'par-1').status).toBe('pending');
  });

  it('aceita número de parcela maior que o total (não valida coerência)', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ installment_number: 9, total_installments: 3 }) });
    expect(r.status).toBe(201);
  });

  // CORRIGIDO (era): worker/routes/installments.js:92-95 — não há verificação de que o cliente
  // existe; o INSERT rebenta com "FOREIGN KEY constraint failed" e a exceção sobe
  // pela rota acima (500 genérico) em vez de um 400/404 explicável à Dra.
  it('cliente inexistente devolve erro tratado, não uma exceção', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ client_id: 'nao-existe' }) });
    expect([400, 404]).toContain(r.status);
  });

  // CORRIGIDO (era): worker/routes/installments.js:92-95 — id repetido rebenta com
  // "UNIQUE constraint failed"; devia devolver 409 (ou 400).
  it('id repetido devolve conflito em vez de exceção', async () => {
    await rota('POST', '/api/installments', { body: corpoValido() });
    const r = await rota('POST', '/api/installments', { body: corpoValido() });
    expect([400, 409]).toContain(r.status);
  });
});

// ─── valores monetários ──────────────────────────────────────────────────────
describe('POST /api/installments — valores monetários', () => {
  const valorGuardado = () => env.DB.linha('SELECT amount, typeof(amount) AS t FROM installments WHERE id = ?', 'par-1');

  it('guarda cêntimos sem os perder', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: 1234.56 }) });
    expect(valorGuardado().amount).toBe(1234.56);
  });

  it('guarda um valor com muitas casas decimais tal e qual (não arredonda a 2)', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: 0.1 + 0.2 }) });
    expect(valorGuardado().amount).toBeCloseTo(0.30000000000000004, 15);
  });

  it('aceita o valor como string numérica e converte para número', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: '250.75' }) });
    expect(valorGuardado()).toEqual({ amount: 250.75, t: 'real' });
  });

  it('aceita valores negativos (acerto de conta)', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ amount: -150.5 }) });
    expect(r.status).toBe(201);
    expect(valorGuardado().amount).toBe(-150.5);
  });

  it('aceita um valor enorme sem estourar', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: 1e21 }) });
    expect(valorGuardado().amount).toBe(1e21);
  });

  it('aceita o maior inteiro seguro', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: Number.MAX_SAFE_INTEGER }) });
    expect(valorGuardado().amount).toBe(Number.MAX_SAFE_INTEGER);
  });

  // CORRIGIDO (era): o `!amount` recusava o número 0 como "campo em falta" mas
  // deixava passar a string '0' — o mesmo valor com resultados opostos. Agora zero
  // é um valor legítimo (uma parcela de cortesia dentro de um plano), venha como vier.
  it('aceita valor zero, venha como número ou como texto', async () => {
    let n = 0;
    for (const v of [0, '0']) {
      n += 1;
      const r = await rota('POST', '/api/installments', { body: corpoValido({ id: `p-zero-${n}`, amount: v }) });
      expect(r.status).toBe(201);
      expect(env.DB.linha('SELECT amount FROM installments WHERE id = ?', `p-zero-${n}`).amount).toBe(0);
    }
  });

  it('aceita "0" em string, porque a string é truthy', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ amount: '0' }) });
    expect(r.status).toBe(201);
    expect(valorGuardado().amount).toBe(0);
  });

  // CORRIGIDO (era): worker/routes/installments.js:88 — a validação é `!amount`, por isso o
  // número 0 é recusado mas a string '0' passa e grava uma parcela de valor zero.
  // O mesmo valor devia dar o mesmo resultado, venha ele como for.
  it('trata o zero da mesma maneira em número e em string', async () => {
    const comNumero = await rota('POST', '/api/installments', { body: corpoValido({ id: 'p-num', amount: 0 }) });
    const comString = await rota('POST', '/api/installments', { body: corpoValido({ id: 'p-str', amount: '0' }) });
    expect(comNumero.status).toBe(comString.status);
  });

  // CORRIGIDO (era): worker/routes/installments.js:87-95 — nenhum campo é validado como número;
  // 'abc' é gravado como TEXTO numa coluna REAL e depois o fmtMoney dos alertas
  // produz "NaN". Devia devolver 400.
  it('recusa um valor que não é número', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ amount: 'trezentos' }) });
    expect(r.status).toBe(400);
  });

  it('um valor não numérico é recusado antes de chegar à coluna REAL', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ amount: 'trezentos' }) });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/número/i);
    expect(env.DB.linha('SELECT COUNT(*) AS n FROM installments').n).toBe(0);
  });

  // CORRIGIDO (era): worker/routes/installments.js:92-95 — um objeto no campo amount não é
  // rejeitado; chega ao bind e rebenta ("cannot be bound to SQLite parameter").
  it('recusa um objeto no campo do valor sem rebentar', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ amount: { valor: 10 } }) });
    expect(r.status).toBe(400);
  });

  it('o valor devolvido na leitura é o mesmo que foi gravado', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ amount: 99.99 }) });
    const b = await json(await rota('GET', '/api/installments/par-1'));
    expect(b.installment.amount).toBe(99.99);
  });
});

// ─── datas de vencimento ─────────────────────────────────────────────────────
describe('POST /api/installments — datas de vencimento', () => {
  const dataGuardada = () => env.DB.linha('SELECT due_date FROM installments WHERE id = ?', 'par-1').due_date;

  it('aceita uma data futura', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: dia(90) }) });
    expect(r.status).toBe(201);
  });

  it('aceita uma data no passado (parcela lançada em atraso)', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2020-01-15' }) });
    expect(r.status).toBe(201);
    expect(dataGuardada()).toBe('2020-01-15');
  });

  it('aceita o último dia de um mês de 31', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2026-08-31' }) });
    const b = await json(await rota('GET', '/api/installments?month=2026-08'));
    expect(b.installments).toHaveLength(1);
  });

  it('aceita 29 de fevereiro num ano bissexto', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2028-02-29' }) });
    const b = await json(await rota('GET', '/api/installments?month=2028-02'));
    expect(b.installments.map((p) => p.id)).toEqual(['par-1']);
  });

  it('29 de fevereiro num ano não bissexto é recusado', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2027-02-29' }) });
    expect(r.status).toBe(400);
    expect(env.DB.linha('SELECT COUNT(*) AS n FROM installments').n).toBe(0);
  });

  it('31 de dezembro conta para o ano certo', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2026-12-31' }) });
    expect((await json(await rota('GET', '/api/installments?year=2026'))).installments).toHaveLength(1);
  });

  it('uma data com hora fica fora do filtro por mês exato', async () => {
    await rota('POST', '/api/installments', { body: corpoValido({ due_date: '2026-09-15T10:00:00Z' }) });
    expect(dataGuardada()).toBe('2026-09-15T10:00:00Z');
  });

  // CORRIGIDO (era): worker/routes/installments.js:87-95 — o due_date não é validado; "amanhã"
  // entra na base e todas as consultas com date()/strftime() passam a devolver NULL
  // para essa linha (a parcela desaparece de upcoming e dos alertas, sem erro).
  it('recusa uma data que não é data', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: 'amanhã' }) });
    expect(r.status).toBe(400);
  });

  it('uma data inválida é recusada em vez de sumir das listagens', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: 'amanhã' }) });
    expect(r.status).toBe(400);
    expect((await json(await rota('GET', '/api/installments'))).installments).toEqual([]);
  });

  it('data em formato português é recusada com uma mensagem clara', async () => {
    const r = await rota('POST', '/api/installments', { body: corpoValido({ due_date: '15/09/2026' }) });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/aaaa-mm-dd/);
  });
});

// ─── atualização genérica ────────────────────────────────────────────────────
describe('PATCH /api/installments/:id', () => {
  beforeEach(async () => { await semear('par-1', { amount: 100, notes: null }); });

  const patch = (body) => rota('PATCH', '/api/installments/par-1', { body });

  it('atualiza as notas', async () => {
    const r = await patch({ notes: 'Cliente pediu adiamento' });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true });
    expect(env.DB.linha('SELECT notes FROM installments WHERE id = ?', 'par-1').notes).toBe('Cliente pediu adiamento');
  });

  it.each([
    ['amount', 555.5],
    ['due_date', '2027-01-31'],
    ['payment_method', 'transferência'],
    ['receipt_path', 'recibos/par-1.pdf'],
    ['wa_sent_at', '2026-08-01T10:00:00Z'],
    ['installment_number', 2],
    ['total_installments', 6],
  ])('atualiza o campo %s', async (campo, valor) => {
    const r = await patch({ [campo]: valor });
    expect(r.status).toBe(200);
    expect(env.DB.linha(`SELECT ${campo} AS v FROM installments WHERE id = ?`, 'par-1').v).toBe(valor);
  });

  it('atualiza vários campos de uma vez', async () => {
    await patch({ amount: 300, notes: 'renegociado', due_date: '2026-10-10' });
    const l = env.DB.linha('SELECT amount, notes, due_date FROM installments WHERE id = ?', 'par-1');
    expect(l).toEqual({ amount: 300, notes: 'renegociado', due_date: '2026-10-10' });
  });

  it('põe um campo a null quando o pedido traz null explícito', async () => {
    await patch({ notes: 'algo' });
    await patch({ notes: null });
    expect(env.DB.linha('SELECT notes FROM installments WHERE id = ?', 'par-1').notes).toBe(null);
  });

  it('ignora campos não permitidos e devolve 400 se não sobrar nada', async () => {
    const r = await patch({ client_id: 'cli-2', created_at: '1999-01-01' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Nenhum campo para atualizar');
    expect(env.DB.linha('SELECT client_id FROM installments WHERE id = ?', 'par-1').client_id).toBe('cli-1');
  });

  it('corpo vazio devolve 400', async () => {
    expect((await patch({})).status).toBe(400);
  });

  it('recusa JSON inválido com 400', async () => {
    const r = await rota('PATCH', '/api/installments/par-1', {
      body: 'nao é json', headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Invalid JSON');
  });

  it('404 para parcela inexistente', async () => {
    const r = await rota('PATCH', '/api/installments/nao-existe', { body: { notes: 'x' } });
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Parcela não encontrada');
  });

  it('mexe apenas na parcela indicada', async () => {
    await semear('par-2', { amount: 999 });
    await patch({ amount: 1 });
    expect(env.DB.linha('SELECT amount FROM installments WHERE id = ?', 'par-2').amount).toBe(999);
  });

  it('carimba o updated_at', async () => {
    await env.DB.prepare("UPDATE installments SET updated_at = '2000-01-01 00:00:00' WHERE id = 'par-1'").run();
    await patch({ notes: 'x' });
    expect(env.DB.linha('SELECT updated_at FROM installments WHERE id = ?', 'par-1').updated_at)
      .not.toBe('2000-01-01 00:00:00');
  });

  it('nomes de campo maliciosos não passam pela lista branca', async () => {
    const r = await patch({ "amount = 0, notes = 'hack'": 1 });
    expect(r.status).toBe(400);
    expect(env.DB.linha('SELECT amount FROM installments WHERE id = ?', 'par-1').amount).toBe(100);
  });

  // CORRIGIDO (era): worker/routes/installments.js:109 — ao contrário do createInstallment
  // (que faz `body || {}`), aqui lê-se `body.action` diretamente; com o corpo JSON
  // `null` rebenta com TypeError e a rota devolve 500 em vez de 400.
  it('corpo JSON `null` devolve 400 em vez de rebentar', async () => {
    const r = await patch('null'); // corpo literal `null`
    expect(r.status).toBe(400);
  });

  it('corpo JSON com uma string simples devolve 400', async () => {
    const r = await rota('PATCH', '/api/installments/par-1', { body: '"abc"' });
    expect(r.status).toBe(400);
  });
});

// ─── estados e mark_paid ─────────────────────────────────────────────────────
describe('PATCH — estados da parcela', () => {
  beforeEach(async () => { await semear('par-1', { status: 'pending', amount: 400 }); });
  const patch = (body) => rota('PATCH', '/api/installments/par-1', { body });
  const linha = () => env.DB.linha('SELECT status, paid_date, payment_method FROM installments WHERE id = ?', 'par-1');

  it('marca como paga com a data de hoje', async () => {
    const r = await patch({ action: 'mark_paid' });
    expect(r.status).toBe(200);
    expect(linha().status).toBe('paid');
    expect(linha().paid_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('aceita uma data de pagamento explícita', async () => {
    await patch({ action: 'mark_paid', paid_date: '2026-07-01' });
    expect(linha().paid_date).toBe('2026-07-01');
  });

  it('guarda o método de pagamento', async () => {
    await patch({ action: 'mark_paid', payment_method: 'MB Way' });
    expect(linha().payment_method).toBe('MB Way');
  });

  it('sem método de pagamento o campo fica como estava', async () => {
    await patch({ action: 'mark_paid' });
    expect(linha().payment_method).toBe(null);
  });

  it('marcar como paga duas vezes é idempotente no estado', async () => {
    await patch({ action: 'mark_paid', paid_date: '2026-07-01' });
    await patch({ action: 'mark_paid', paid_date: '2026-07-01' });
    expect(linha()).toEqual({ status: 'paid', paid_date: '2026-07-01', payment_method: null });
  });

  it('a segunda marcação sobrepõe a data e o método', async () => {
    await patch({ action: 'mark_paid', paid_date: '2026-07-01', payment_method: 'numerário' });
    await patch({ action: 'mark_paid', paid_date: '2026-07-05', payment_method: 'transferência' });
    expect(linha()).toEqual({ status: 'paid', paid_date: '2026-07-05', payment_method: 'transferência' });
  });

  it('a acção mark_paid ignora os outros campos enviados no mesmo pedido', async () => {
    await patch({ action: 'mark_paid', amount: 1, notes: 'não deve entrar' });
    const l = env.DB.linha('SELECT amount, notes FROM installments WHERE id = ?', 'par-1');
    expect(l).toEqual({ amount: 400, notes: null });
  });

  it('desmarcar o pagamento repõe pendente e limpa a data', async () => {
    await patch({ action: 'mark_paid' });
    await patch({ status: 'pending', paid_date: null });
    expect(linha()).toEqual({ status: 'pending', paid_date: null, payment_method: null });
  });

  it.each(['pending', 'due_today', 'late', 'paid'])('aceita a transição para %s', async (estado) => {
    const r = await patch({ status: estado });
    expect(r.status).toBe(200);
    expect(linha().status).toBe(estado);
  });

  it('aceita um estado inventado (a base de dados não tem CHECK)', async () => {
    const r = await patch({ status: 'banana' });
    expect(r.status).toBe(200);
    expect(linha().status).toBe('banana');
  });

  it('deixa passar paid sem data de pagamento (estado incoerente)', async () => {
    await patch({ status: 'paid' });
    expect(linha()).toMatchObject({ status: 'paid', paid_date: null });
  });

  it('deixa passar pendente com data de pagamento preenchida', async () => {
    await patch({ action: 'mark_paid' });
    await patch({ status: 'pending' });
    expect(linha().paid_date).not.toBe(null);
  });

  it('uma acção desconhecida cai no caminho normal e devolve 400', async () => {
    const r = await patch({ action: 'mark_unpaid' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Nenhum campo para atualizar');
  });

  it('mark_paid numa parcela inexistente devolve 404', async () => {
    const r = await rota('PATCH', '/api/installments/nada', { body: { action: 'mark_paid' } });
    expect(r.status).toBe(404);
  });

  it('a parcela paga sai da lista de próximos vencimentos', async () => {
    await env.DB.prepare("UPDATE installments SET due_date = ? WHERE id = 'par-1'").bind(dia(3)).run();
    expect((await json(await rota('GET', '/api/installments/upcoming'))).installments).toHaveLength(1);
    await patch({ action: 'mark_paid' });
    expect((await json(await rota('GET', '/api/installments/upcoming'))).installments).toEqual([]);
  });
});

// ─── remoção ─────────────────────────────────────────────────────────────────
describe('DELETE /api/installments/:id', () => {
  it('apaga a parcela', async () => {
    await semear('par-1');
    const r = await rota('DELETE', '/api/installments/par-1');
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true });
    expect(env.DB.conta('installments')).toBe(0);
  });

  it('apagar duas vezes devolve 404 à segunda', async () => {
    await semear('par-1');
    await rota('DELETE', '/api/installments/par-1');
    expect((await rota('DELETE', '/api/installments/par-1')).status).toBe(404);
  });

  it('404 para parcela inexistente', async () => {
    expect((await rota('DELETE', '/api/installments/nada')).status).toBe(404);
  });

  it('não toca nas outras parcelas', async () => {
    await semear('par-1');
    await semear('par-2');
    await rota('DELETE', '/api/installments/par-1');
    expect(env.DB.conta('installments')).toBe(1);
  });

  it('apagar o cliente arrasta as parcelas (ON DELETE CASCADE)', async () => {
    await semear('par-1');
    await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind('cli-1').run();
    expect(env.DB.conta('installments')).toBe(0);
  });
});

// ─── configuração dos alertas ────────────────────────────────────────────────
describe('loadOwnerAlertConfig', () => {
  it('devolve as quatro preferências da migração', async () => {
    const cfg = await loadOwnerAlertConfig(env);
    expect(Object.keys(cfg.prefs).sort())
      .toEqual(['em_atraso', 'pagamento_recebido', 'resumo_diario', 'vence_hoje']);
  });

  it('por omissão só vence_hoje e em_atraso têm e-mail ligado', async () => {
    const cfg = await loadOwnerAlertConfig(env);
    expect(cfg.prefs.vence_hoje.email_enabled).toBe(1);
    expect(cfg.prefs.em_atraso.email_enabled).toBe(1);
    expect(cfg.prefs.resumo_diario.email_enabled).toBe(0);
    expect(cfg.prefs.pagamento_recebido.email_enabled).toBe(0);
  });

  it('nenhum canal de WhatsApp vem ligado de origem', async () => {
    const cfg = await loadOwnerAlertConfig(env);
    expect(Object.values(cfg.prefs).every((p) => p.whatsapp_enabled === 0)).toBe(true);
  });

  it('lê o contacto único (id = 1)', async () => {
    const cfg = await loadOwnerAlertConfig(env);
    expect(cfg.contacts.email).toBe('vyavena@gmail.com');
  });

  it('sem linha de contactos devolve um objeto com os campos a null', async () => {
    await env.DB.prepare('DELETE FROM owner_alert_contacts').run();
    const cfg = await loadOwnerAlertConfig(env);
    expect(cfg.contacts).toEqual({ email: null, whatsapp: null });
  });

  it('sem preferências devolve um mapa vazio', async () => {
    await env.DB.prepare('DELETE FROM owner_alert_prefs').run();
    const cfg = await loadOwnerAlertConfig(env);
    expect(cfg.prefs).toEqual({});
  });
});

// ─── despacho de alertas ─────────────────────────────────────────────────────
describe('dispatchOwnerAlert', () => {
  const ALERTA = { subject: 'Assunto', text: 'Corpo do aviso' };
  const cfg = () => loadOwnerAlertConfig(env);
  const logs = () => env.DB.linhas('SELECT alert_type, channel, status, message_preview, error_message, sent_date FROM owner_alert_log');

  it('envia por e-mail e regista como enviado', async () => {
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sent' });
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ alert_type: 'vence_hoje', channel: 'email', status: 'sent' });
  });

  it('chama mesmo a API do Resend', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(fetchPadrao.chamadas).toHaveLength(1);
    expect(fetchPadrao.chamadas[0].url).toContain('api.resend.com');
  });

  it('o destinatário é o contacto configurado', async () => {
    await env.DB.prepare("UPDATE owner_alert_contacts SET email = 'dra@escritorio.pt' WHERE id = 1").run();
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(JSON.parse(fetchPadrao.chamadas[0].body).to).toEqual(['dra@escritorio.pt']);
  });

  it('guarda uma pré-visualização da mensagem', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(logs()[0].message_preview).toBe('Corpo do aviso');
  });

  it('a pré-visualização é cortada aos 200 caracteres', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', { subject: 's', text: 'x'.repeat(500) });
    expect(logs()[0].message_preview).toHaveLength(200);
  });

  it('regista o dia do envio para o dedupe', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(logs()[0].sent_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('tipo de alerta sem preferência é ignorado', async () => {
    const out = await dispatchOwnerAlert(env, await cfg(), 'tipo_que_nao_existe', ALERTA);
    expect(out).toEqual({ skipped: 'sem preferencia' });
    expect(logs()).toHaveLength(0);
  });

  it('canal desligado nas preferências não envia nada', async () => {
    const out = await dispatchOwnerAlert(env, await cfg(), 'resumo_diario', ALERTA);
    expect(out).toEqual({});
    expect(fetchPadrao.chamadas).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });

  it('desligar o e-mail de um tipo cala esse tipo', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 0 WHERE alert_type = 'vence_hoje'").run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({});
  });

  it('sem contacto de e-mail não envia nem regista', async () => {
    await env.DB.prepare('UPDATE owner_alert_contacts SET email = NULL WHERE id = 1').run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sem destino configurado' });
    expect(logs()).toHaveLength(0);
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('contacto de e-mail vazio conta como não configurado', async () => {
    await env.DB.prepare("UPDATE owner_alert_contacts SET email = '' WHERE id = 1").run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sem destino configurado' });
  });

  it('envia por WhatsApp quando o canal está ligado e há credenciais', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    env.ZAPI_INSTANCE_TOKEN = 'tok';
    await env.DB.prepare("UPDATE owner_alert_prefs SET whatsapp_enabled = 1 WHERE alert_type = 'vence_hoje'").run();
    await env.DB.prepare("UPDATE owner_alert_contacts SET whatsapp = '351911111111' WHERE id = 1").run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sent', whatsapp: 'sent' });
    expect(fetchPadrao.chamadas.some((c) => c.url.includes('z-api.io'))).toBe(true);
  });

  it('a mensagem de WhatsApp junta assunto e corpo', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    env.ZAPI_INSTANCE_TOKEN = 'tok';
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 0, whatsapp_enabled = 1 WHERE alert_type = 'vence_hoje'").run();
    await env.DB.prepare("UPDATE owner_alert_contacts SET whatsapp = '351911111111' WHERE id = 1").run();
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(JSON.parse(fetchPadrao.chamadas[0].body).message).toBe('Assunto\n\nCorpo do aviso');
  });

  it('sem número de WhatsApp o canal fica sem destino', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET whatsapp_enabled = 1 WHERE alert_type = 'vence_hoje'").run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out.whatsapp).toBe('sem destino configurado');
  });

  it('um envio que falha fica registado como erro', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'servidor em baixo' } }));
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'error' });
    expect(logs()[0]).toMatchObject({ status: 'error' });
    expect(logs()[0].error_message).toContain('servidor em baixo');
  });

  it('a rede em baixo também fica registada como erro', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'ECONNRESET' }));
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'error' });
    expect(logs()[0].status).toBe('error');
  });

  it('um envio falhado não faz dedupe: a tentativa seguinte volta a enviar', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: {} }));
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    await new Promise((r) => setTimeout(r, 2)); // o id do log é `..._${Date.now()}`: sem isto colide
    const f = mockFetch({ json: { id: 'ok' } });
    vi.stubGlobal('fetch', f);
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sent' });
    expect(f.chamadas).toHaveLength(1);
  });

  it('dois disparos no mesmo dia só enviam uma vez', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'dedupe' });
    expect(fetchPadrao.chamadas).toHaveLength(1);
    expect(logs()).toHaveLength(1);
  });

  it('o dedupe é por tipo: outro tipo de alerta passa no mesmo dia', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    const out = await dispatchOwnerAlert(env, await cfg(), 'em_atraso', ALERTA);
    expect(out).toEqual({ email: 'sent' });
    expect(fetchPadrao.chamadas).toHaveLength(2);
  });

  it('o dedupe é por canal: o WhatsApp passa mesmo com o e-mail já enviado', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    env.ZAPI_INSTANCE_TOKEN = 'tok';
    await env.DB.prepare("UPDATE owner_alert_contacts SET whatsapp = '351911111111' WHERE id = 1").run();
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    await env.DB.prepare("UPDATE owner_alert_prefs SET whatsapp_enabled = 1 WHERE alert_type = 'vence_hoje'").run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'dedupe', whatsapp: 'sent' });
  });

  it('o dedupe é por dia: um envio de ontem não trava o de hoje', async () => {
    await env.DB.prepare(`
      INSERT INTO owner_alert_log (id, alert_type, channel, status, sent_date)
      VALUES ('antigo', 'vence_hoje', 'email', 'sent', ?)`).bind(dia(-1)).run();
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out).toEqual({ email: 'sent' });
  });

  it('com dedupe=false envia sempre, mesmo repetido no mesmo dia', async () => {
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', { ...ALERTA, dedupe: false });
    await new Promise((r) => setTimeout(r, 2));
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', { ...ALERTA, dedupe: false });
    expect(out).toEqual({ email: 'sent' });
    expect(fetchPadrao.chamadas).toHaveLength(2);
  });

  // CORRIGIDO (era): worker/lib/owner_alerts.js:64 — `r.ok === undefined ? true : r.ok` trata um
  // envio SALTADO (sendEmail devolve { skipped: true } quando falta a RESEND_API_KEY)
  // como sucesso: fica gravado 'sent' no log e o dedupe cala o alerta o resto do dia.
  // A Dra. nunca recebe nada e o painel diz que foi enviado.
  it('sem RESEND_API_KEY o envio saltado não é dado como enviado', async () => {
    env.RESEND_API_KEY = '';
    const out = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(out.email).not.toBe('sent');
  });

  it('sem RESEND_API_KEY não há chamada de rede e o log diz «skipped»', async () => {
    env.RESEND_API_KEY = '';
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(fetchPadrao.chamadas).toHaveLength(0);
    expect(logs()[0].status).toBe('skipped');
  });

  it('o motivo do envio saltado fica registado', async () => {
    env.RESEND_API_KEY = '';
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(String(logs()[0].error_message || '')).toMatch(/RESEND_API_KEY|saltado/i);
  });

  it('um envio saltado não bloqueia a tentativa seguinte (o dedupe só conta os enviados)', async () => {
    env.RESEND_API_KEY = '';
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    // repõe a chave E o mock de rede — não depender do fetch ambiente evita que
    // este teste passe ou falhe consoante o ficheiro que correu antes
    env.RESEND_API_KEY = 'chave';
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'email-2' } }));
    const r = await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', ALERTA);
    expect(r.email).toBe('sent');
  });

  // CORRIGIDO (era): worker/lib/owner_alerts.js:37 — o id do log é
  // `oal_${tipo}_${canal}_${Date.now()}`, com resolução de milissegundo. Dois alertas
  // do mesmo tipo/canal no mesmo milissegundo (caso normal do pagamento_recebido, que
  // usa dedupe=false) colidem na PRIMARY KEY e o segundo registo perde-se.
  it('dois alertas no mesmo milissegundo geram dois registos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-03T10:00:00Z'));
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', { ...ALERTA, dedupe: false });
    await dispatchOwnerAlert(env, await cfg(), 'vence_hoje', { ...ALERTA, dedupe: false });
    expect(env.DB.conta('owner_alert_log')).toBe(2);
  });
});

// ─── bloco diário ────────────────────────────────────────────────────────────
describe('runOwnerDailyAlerts', () => {
  const logs = () => env.DB.linhas('SELECT alert_type, channel, status, message_preview FROM owner_alert_log');
  const ligarTudo = () => env.DB.prepare('UPDATE owner_alert_prefs SET email_enabled = 1').run();

  it('com a tabela vazia não envia nada', async () => {
    const out = await runOwnerDailyAlerts(env);
    expect(out).toEqual({});
    expect(fetchPadrao.chamadas).toHaveLength(0);
    expect(env.DB.conta('owner_alert_log')).toBe(0);
  });

  it('o resumo com zero itens não é enviado (nem manda NaN)', async () => {
    await ligarTudo();
    await semear('paga', { due_date: dia(0), status: 'paid' });
    const out = await runOwnerDailyAlerts(env);
    expect(out.resumo_diario).toBeUndefined();
    expect(JSON.stringify(logs())).not.toContain('NaN');
  });

  it('avisa o que vence hoje', async () => {
    await semear('hoje', { due_date: dia(0), amount: 250 });
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toEqual({ email: 'sent' });
    expect(logs()[0].message_preview).toContain('Maria Silva');
  });

  it('o aviso de hoje traz o valor formatado em euros', async () => {
    await semear('hoje', { due_date: dia(0), amount: 1234.5, currency: 'EUR' });
    await runOwnerDailyAlerts(env);
    expect(logs()[0].message_preview).toContain('1234,50');
  });

  it('o valor em reais é formatado em pt-BR', async () => {
    await semear('hoje', { client_id: 'cli-2', due_date: dia(0), amount: 1234.5, currency: 'BRL' });
    await runOwnerDailyAlerts(env);
    expect(logs()[0].message_preview).toContain('R$');
  });

  it('junta vários clientes num só aviso, por ordem de nome', async () => {
    await semear('h1', { client_id: 'cli-1', due_date: dia(0) });
    await semear('h2', { client_id: 'cli-2', due_date: dia(0) });
    await runOwnerDailyAlerts(env);
    expect(logs()).toHaveLength(1);
    const p = logs()[0].message_preview;
    expect(p).toContain('Maria Silva');
    expect(p).toContain('João Santos');
    expect(p.indexOf('João Santos')).toBeLessThan(p.indexOf('Maria Silva'));
  });

  it('o assunto do e-mail conta quantos pagamentos vencem hoje', async () => {
    await semear('h1', { client_id: 'cli-1', due_date: dia(0) });
    await semear('h2', { client_id: 'cli-2', due_date: dia(0) });
    await runOwnerDailyAlerts(env);
    expect(JSON.parse(fetchPadrao.chamadas[0].body).subject).toBe('Vencem hoje: 2 pagamento(s)');
  });

  it('não avisa por parcelas já pagas que venciam hoje', async () => {
    await semear('hoje', { due_date: dia(0), status: 'paid' });
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toBeUndefined();
  });

  it('avisa o que ficou em atraso ontem', async () => {
    await semear('ontem', { due_date: dia(-1) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.em_atraso).toEqual({ email: 'sent' });
    expect(logs()[0].message_preview).toContain('venceu ontem');
  });

  it('não avisa de atraso o que venceu há uma semana', async () => {
    await semear('antiga', { due_date: dia(-7), status: 'late' });
    const out = await runOwnerDailyAlerts(env);
    expect(out.em_atraso).toBeUndefined();
  });

  it('envia os dois avisos quando há vencimentos de hoje e de ontem', async () => {
    await semear('hoje', { due_date: dia(0) });
    await semear('ontem', { due_date: dia(-1) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toEqual({ email: 'sent' });
    expect(out.em_atraso).toEqual({ email: 'sent' });
    expect(env.DB.conta('owner_alert_log')).toBe(2);
  });

  it('o resumo diário conta hoje, próximos 7 dias e atrasos', async () => {
    await ligarTudo();
    await semear('hoje', { due_date: dia(0) });
    await semear('semana', { due_date: dia(3) });
    await semear('atrasada', { due_date: dia(-30), status: 'late' });
    await semear('longe', { due_date: dia(60) });
    await runOwnerDailyAlerts(env);
    const p = env.DB.linha("SELECT message_preview AS v FROM owner_alert_log WHERE alert_type = 'resumo_diario'").v;
    expect(p).toContain('Vencem hoje: 1');
    expect(p).toContain('Próximos 7 dias: 1');
    expect(p).toContain('Em atraso: 1');
  });

  it('o resumo diário não sai se a preferência estiver desligada', async () => {
    await semear('hoje', { due_date: dia(0) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.resumo_diario).toEqual({});
  });

  it('só há parcelas longínquas: nenhum resumo é enviado', async () => {
    await ligarTudo();
    await semear('longe', { due_date: dia(60) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.resumo_diario).toBeUndefined();
  });

  it('correr duas vezes no mesmo dia só envia uma vez', async () => {
    await semear('hoje', { due_date: dia(0) });
    await runOwnerDailyAlerts(env);
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toEqual({ email: 'dedupe' });
    expect(fetchPadrao.chamadas).toHaveLength(1);
  });

  it('sem contacto configurado corre sem rebentar e não regista nada', async () => {
    await env.DB.prepare('UPDATE owner_alert_contacts SET email = NULL WHERE id = 1').run();
    await semear('hoje', { due_date: dia(0) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toEqual({ email: 'sem destino configurado' });
    expect(env.DB.conta('owner_alert_log')).toBe(0);
  });

  it('uma falha de envio não impede os alertas seguintes', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 500, json: {} }, { json: { id: 'ok' } }]));
    await semear('hoje', { due_date: dia(0) });
    await semear('ontem', { due_date: dia(-1) });
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toEqual({ email: 'error' });
    expect(out.em_atraso).toEqual({ email: 'sent' });
  });

  it('parcelas com data inválida não entram em nenhum aviso', async () => {
    await ligarTudo();
    await semear('lixo', { due_date: 'amanhã' });
    const out = await runOwnerDailyAlerts(env);
    expect(out).toEqual({});
  });

  it('a ligação ao cliente é obrigatória: parcela órfã não gera aviso', async () => {
    await semear('hoje', { due_date: dia(0) });
    await env.DB.prepare('PRAGMA foreign_keys = OFF').run();
    await env.DB.prepare('DELETE FROM clients').run();
    const out = await runOwnerDailyAlerts(env);
    expect(out.vence_hoje).toBeUndefined();
  });
});

// ─── alerta de pagamento recebido ────────────────────────────────────────────
describe('ownerPaymentReceivedAlert', () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    await semear('par-1', { amount: 500, status: 'paid', paid_date: '2026-08-01' });
  });

  it('avisa a Dra. com o cliente e o valor', async () => {
    await ownerPaymentReceivedAlert(env, 'par-1');
    const l = env.DB.linha("SELECT message_preview AS v FROM owner_alert_log WHERE alert_type = 'pagamento_recebido'");
    expect(l.v).toContain('Maria Silva');
    expect(l.v).toContain('500,00');
  });

  it('inclui a data do pagamento', async () => {
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v).toContain('2026-08-01');
  });

  it('inclui o método quando existe', async () => {
    await env.DB.prepare("UPDATE installments SET payment_method = 'MB Way' WHERE id = 'par-1'").run();
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v).toContain('MB Way');
  });

  it('sem método não escreve a linha do método', async () => {
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v).not.toContain('Método');
  });

  it('sem data de pagamento usa a data de hoje', async () => {
    await env.DB.prepare("UPDATE installments SET paid_date = NULL WHERE id = 'par-1'").run();
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v)
      .toContain(new Date().toISOString().slice(0, 10));
  });

  it('com a preferência desligada não envia nada', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 0 WHERE alert_type = 'pagamento_recebido'").run();
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.conta('owner_alert_log')).toBe(0);
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('parcela inexistente não gera alerta nem exceção', async () => {
    await expect(ownerPaymentReceivedAlert(env, 'nao-existe')).resolves.toBeUndefined();
    expect(env.DB.conta('owner_alert_log')).toBe(0);
  });

  it('uma falha de rede é engolida e não propaga', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'sem rede' }));
    await expect(ownerPaymentReceivedAlert(env, 'par-1')).resolves.toBeUndefined();
    expect(env.DB.linha('SELECT status AS v FROM owner_alert_log').v).toBe('error');
  });

  it('uma base de dados partida não propaga a exceção', async () => {
    env.DB = { prepare: () => { throw new Error('D1 em baixo'); } };
    await expect(ownerPaymentReceivedAlert(env, 'par-1')).resolves.toBeUndefined();
  });

  it('não faz dedupe diário: dois pagamentos avisam duas vezes', async () => {
    await semear('par-2', { amount: 60, status: 'paid', paid_date: '2026-08-01' });
    await ownerPaymentReceivedAlert(env, 'par-1');
    await new Promise((r) => setTimeout(r, 2));
    await ownerPaymentReceivedAlert(env, 'par-2');
    expect(fetchPadrao.chamadas).toHaveLength(2);
    expect(env.DB.conta('owner_alert_log')).toBe(2);
  });

  it('um valor gravado como texto sai como NaN na mensagem', async () => {
    await env.DB.prepare("UPDATE installments SET amount = 'trezentos' WHERE id = 'par-1'").run();
    await ownerPaymentReceivedAlert(env, 'par-1');
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v).toContain('NaN');
  });
});

// ─── integração: marcar como paga dispara o alerta ───────────────────────────
describe('PATCH mark_paid + alerta à Dra.', () => {
  beforeEach(async () => { await semear('par-1', { amount: 750 }); });
  const marcar = (extra = {}) => rota('PATCH', '/api/installments/par-1', { body: { action: 'mark_paid', ...extra } });

  it('com a preferência ligada, marcar como paga envia o aviso', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    const r = await marcar();
    expect(r.status).toBe(200);
    expect(env.DB.conta('owner_alert_log', "alert_type = 'pagamento_recebido'")).toBe(1);
  });

  it('o aviso leva o valor da parcela', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    await marcar({ payment_method: 'transferência' });
    expect(env.DB.linha('SELECT message_preview AS v FROM owner_alert_log').v).toContain('750,00');
  });

  it('com a preferência desligada não sai nenhum aviso', async () => {
    await marcar();
    expect(env.DB.conta('owner_alert_log')).toBe(0);
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('uma atualização normal (sem mark_paid) não dispara aviso', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    await rota('PATCH', '/api/installments/par-1', { body: { status: 'paid' } });
    expect(env.DB.conta('owner_alert_log')).toBe(0);
  });

  it('a falha do aviso não estraga o registo do pagamento', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    vi.stubGlobal('fetch', mockFetch({ erro: 'rede em baixo' }));
    const r = await marcar();
    expect(r.status).toBe(200);
    expect(env.DB.linha('SELECT status AS v FROM installments WHERE id = ?', 'par-1').v).toBe('paid');
  });

  it('marcar uma parcela inexistente não chega a disparar o aviso', async () => {
    await env.DB.prepare("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'pagamento_recebido'").run();
    await rota('PATCH', '/api/installments/nada', { body: { action: 'mark_paid' } });
    expect(env.DB.conta('owner_alert_log')).toBe(0);
  });
});
