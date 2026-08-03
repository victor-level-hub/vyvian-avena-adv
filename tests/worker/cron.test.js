// tests/worker/cron.test.js
// A rotina diária agendada (Cloudflare Cron Trigger "0 7 * * *"):
// worker/cron.js (runDailyCron) e o handler `scheduled` de worker/index.js.
//
// O foco aqui é a ORQUESTRAÇÃO — o que o cron chama, por que ordem, e o que
// acontece quando uma das peças falha. Os blocos isolados (senders, Instagram,
// Banco de Palavras, alertas à Dra.) têm suíte própria; o que interessa neste
// ficheiro é que uma peça partida nunca leve as outras atrás.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDailyCron } from '../../worker/cron.js';
import worker from '../../worker/index.js';
import { signJWT } from '../../worker/lib/auth.js';
import { criarEnv, json, mockFetch } from '../helpers/env.js';

// O SQLite avalia date('now') com o relógio verdadeiro — o vi.setSystemTime não
// lhe chega. Todas as datas semeadas são relativas ao dia real, em UTC.
const dia = (n = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let env;
let fetchPadrao;
let logSpy;
let errSpy;

// ── semeadura ────────────────────────────────────────────────────────────────
const cliente = (id, nome = 'Maria Silva', extra = {}) =>
  env.DB.prepare('INSERT INTO clients (id, name, email, phone, country) VALUES (?, ?, ?, ?, ?)')
    .bind(id, nome, extra.email === undefined ? `${id}@exemplo.pt` : extra.email,
      extra.phone === undefined ? '351911111111' : extra.phone, extra.country || 'PT').run();

const parcela = (id, campos = {}) =>
  env.DB.prepare(`
    INSERT INTO installments (id, client_id, installment_number, total_installments, amount, currency, due_date, status, paid_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      campos.client_id ?? 'cli-1',
      campos.installment_number ?? 1,
      campos.total_installments ?? 3,
      campos.amount ?? 150.5,
      campos.currency ?? 'EUR',
      campos.due_date ?? dia(3),
      campos.status ?? 'pending',
      campos.paid_date ?? null,
    ).run();

const regra = (id, campos = {}) =>
  env.DB.prepare(`
    INSERT INTO notification_rules (id, client_id, channel, days_before, enabled, template_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      campos.client_id ?? 'cli-1',
      campos.channel ?? 'email',
      campos.days_before ?? 3,
      campos.enabled ?? 1,
      campos.template_id ?? null,
    ).run();

const template = (id, campos = {}) =>
  env.DB.prepare(`
    INSERT INTO message_templates (id, name, channel, subject, body, is_default)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      campos.name ?? 'Modelo',
      campos.channel ?? 'email',
      campos.subject ?? null,
      campos.body ?? 'Corpo',
      campos.is_default ?? 0,
    ).run();

// ── leitura ──────────────────────────────────────────────────────────────────
const logs = () => env.DB.linhas('SELECT * FROM notification_log ORDER BY rowid');
const estado = (id) => env.DB.linha('SELECT status FROM installments WHERE id = ?', id).status;
const corpoResend = (f, i = 0) => JSON.parse(f.chamadas.filter((c) => c.url.includes('resend'))[i].body);
const corpoZapi = (f, i = 0) => JSON.parse(f.chamadas.filter((c) => c.url.includes('z-api'))[i].body);
const ordemQuery = (fragmento) => env.DB.queries.findIndex((q) => q.sql.includes(fragmento));

// Faz uma consulta rebentar a meio do ciclo das regras (simula um D1 com soluços).
// `alvo` é comparado com o primeiro argumento ligado à consulta.
function partirConsulta(fragmentoSql, alvo) {
  const original = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const st = original(sql);
    if (!sql.includes(fragmentoSql)) return st;
    const bindOriginal = st.bind.bind(st);
    st.bind = (...args) => {
      if (alvo === undefined || args[0] === alvo) throw new Error('D1 indisponível');
      return bindOriginal(...args);
    };
    return st;
  };
}

// ctx do Worker: guarda as promessas de waitUntil para o teste as poder esperar.
function criarCtx() {
  const pendentes = [];
  return {
    pendentes,
    waitUntil: vi.fn((p) => pendentes.push(p)),
    passThroughOnException() {},
    esperar: () => Promise.all(pendentes),
  };
}

beforeEach(async () => {
  env = criarEnv();
  await cliente('cli-1', 'Maria Silva');
  // Os alertas à Dra. têm suíte própria (installments.test.js) e disparariam
  // e-mails a cada corrida — desligados por omissão para não poluir as contagens.
  env.DB.exec('UPDATE owner_alert_prefs SET email_enabled = 0, whatsapp_enabled = 0');
  fetchPadrao = mockFetch({ json: { id: 'email-1' } });
  vi.stubGlobal('fetch', fetchPadrao);
  // O cron faz console.error do Instagram (sem token) em todas as corridas.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. TRANSIÇÕES DE ESTADO DAS PARCELAS
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — transições de estado', () => {
  it('a parcela pendente que venceu ontem passa a late', async () => {
    await parcela('p1', { due_date: dia(-1), status: 'pending' });
    await runDailyCron(env);
    expect(estado('p1')).toBe('late');
  });

  it('o resumo conta a transição para late', async () => {
    await parcela('p1', { due_date: dia(-1), status: 'pending' });
    const s = await runDailyCron(env);
    expect(s.updated_late).toBe(1);
  });

  it('a parcela que estava marcada como due_today e venceu ontem também passa a late', async () => {
    await parcela('p1', { due_date: dia(-1), status: 'due_today' });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('late');
    expect(s.updated_late).toBe(1);
  });

  it('a parcela que vence hoje passa a due_today', async () => {
    await parcela('p1', { due_date: dia(0), status: 'pending' });
    await runDailyCron(env);
    expect(estado('p1')).toBe('due_today');
  });

  it('o resumo conta a transição para due_today', async () => {
    await parcela('p1', { due_date: dia(0), status: 'pending' });
    const s = await runDailyCron(env);
    expect(s.updated_due_today).toBe(1);
  });

  it('a parcela que vence hoje não é contada como atrasada', async () => {
    await parcela('p1', { due_date: dia(0), status: 'pending' });
    const s = await runDailyCron(env);
    expect(s.updated_late).toBe(0);
  });

  it('a parcela já paga que venceu ontem não muda de estado', async () => {
    await parcela('p1', { due_date: dia(-1), status: 'paid', paid_date: dia(-2) });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('paid');
    expect(s.updated_late).toBe(0);
  });

  it('a parcela já paga que vence hoje não passa a due_today', async () => {
    await parcela('p1', { due_date: dia(0), status: 'paid', paid_date: dia(0) });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('paid');
    expect(s.updated_due_today).toBe(0);
  });

  it('a parcela já em atraso continua late e não é recontada', async () => {
    await parcela('p1', { due_date: dia(-10), status: 'late' });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('late');
    expect(s.updated_late).toBe(0);
  });

  it('a parcela futura fica intacta', async () => {
    await parcela('p1', { due_date: dia(30), status: 'pending' });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('pending');
    expect(s).toMatchObject({ updated_late: 0, updated_due_today: 0 });
  });

  it('a parcela vencida há muito tempo também passa a late', async () => {
    await parcela('p1', { due_date: '2020-01-01', status: 'pending' });
    await runDailyCron(env);
    expect(estado('p1')).toBe('late');
  });

  it('tabela de parcelas vazia devolve zeros sem rebentar', async () => {
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ updated_late: 0, updated_due_today: 0 });
  });

  it('conta várias transições de uma vez', async () => {
    await parcela('a', { due_date: dia(-1) });
    await parcela('b', { due_date: dia(-5) });
    await parcela('c', { due_date: dia(-2), status: 'due_today' });
    await parcela('d', { due_date: dia(0) });
    await parcela('e', { due_date: dia(0) });
    const s = await runDailyCron(env);
    expect(s.updated_late).toBe(3);
    expect(s.updated_due_today).toBe(2);
  });

  it('um estado inventado não é tocado pelo cron', async () => {
    await parcela('p1', { due_date: dia(-1), status: 'banana' });
    await runDailyCron(env);
    expect(estado('p1')).toBe('banana');
  });

  it('a transição carimba o updated_at', async () => {
    await parcela('p1', { due_date: dia(-1) });
    env.DB.exec("UPDATE installments SET updated_at = '2000-01-01 00:00:00'");
    await runDailyCron(env);
    expect(env.DB.linha('SELECT updated_at FROM installments WHERE id = ?', 'p1').updated_at)
      .not.toBe('2000-01-01 00:00:00');
  });

  it('não mexe no updated_at de quem não transitou', async () => {
    await parcela('p1', { due_date: dia(30) });
    env.DB.exec("UPDATE installments SET updated_at = '2000-01-01 00:00:00'");
    await runDailyCron(env);
    expect(env.DB.linha('SELECT updated_at FROM installments WHERE id = ?', 'p1').updated_at)
      .toBe('2000-01-01 00:00:00');
  });

  it('uma data de vencimento inválida deixa a parcela presa em pending (date() dá NULL)', async () => {
    await parcela('p1', { due_date: 'amanhã' });
    const s = await runDailyCron(env);
    expect(estado('p1')).toBe('pending');
    expect(s).toMatchObject({ updated_late: 0, updated_due_today: 0 });
  });

  it('as parcelas de vários clientes transitam todas', async () => {
    await cliente('cli-2', 'João Santos');
    await parcela('p1', { client_id: 'cli-1', due_date: dia(-1) });
    await parcela('p2', { client_id: 'cli-2', due_date: dia(-1) });
    const s = await runDailyCron(env);
    expect(s.updated_late).toBe(2);
  });

  it('o resumo traz sempre as chaves de contagem, mesmo sem dados', async () => {
    const s = await runDailyCron(env);
    expect(Object.keys(s)).toEqual(expect.arrayContaining(
      ['updated_late', 'updated_due_today', 'notified', 'skipped', 'errors', 'details'],
    ));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. REGRAS DE NOTIFICAÇÃO — que parcelas são apanhadas
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — seleção pelas regras', () => {
  it('a regra ativa notifica a parcela que vence dentro de days_before dias', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(logs()).toHaveLength(1);
  });

  it('a regra desativada não notifica nada', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3, enabled: 0 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(0);
    expect(fetchPadrao.chamadas).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });

  it('enabled com um valor diferente de 1 é tratado como desativado', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3, enabled: 2 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('a véspera do dia da regra não é apanhada', async () => {
    await parcela('p1', { due_date: dia(2) });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('o dia seguinte ao da regra não é apanhado', async () => {
    await parcela('p1', { due_date: dia(4) });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('days_before = 0 apanha a parcela que vence hoje', async () => {
    await parcela('p1', { due_date: dia(0) });
    await regra('r1', { days_before: 0 });
    expect((await runDailyCron(env)).notified).toBe(1);
  });

  it('days_before = 30 apanha a parcela a 30 dias', async () => {
    await parcela('p1', { due_date: dia(30) });
    await regra('r1', { days_before: 30 });
    expect((await runDailyCron(env)).notified).toBe(1);
  });

  it('a parcela apanhada é exatamente a do dia certo, entre vizinhas', async () => {
    await parcela('antes', { due_date: dia(2) });
    await parcela('certa', { due_date: dia(3) });
    await parcela('depois', { due_date: dia(4) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs().map((l) => l.installment_id)).toEqual(['certa']);
  });

  it('duas regras do mesmo cliente em canais diferentes notificam nos dois', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    env.ZAPI_INSTANCE_TOKEN = 'tok';
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    await regra('r2', { channel: 'whatsapp', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(2);
    expect(logs().map((l) => l.channel).sort()).toEqual(['email', 'whatsapp']);
  });

  it('duas regras do mesmo cliente em dias diferentes apanham parcelas diferentes', async () => {
    await parcela('p3', { due_date: dia(3) });
    await parcela('p7', { due_date: dia(7) });
    await regra('r1', { days_before: 3 });
    await regra('r2', { days_before: 7 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(2);
    expect(logs().map((l) => l.installment_id).sort()).toEqual(['p3', 'p7']);
  });

  it('duas regras iguais no mesmo canal só enviam uma vez (a segunda faz dedupe)', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await regra('r2', { days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(s.skipped).toBe(1);
    expect(logs()).toHaveLength(1);
  });

  it('uma regra de cliente inexistente não envia nem conta erro', async () => {
    await regra('r1', { client_id: 'cli-1' });
    env.DB.exec('PRAGMA foreign_keys = OFF');
    env.DB.exec("UPDATE notification_rules SET client_id = 'fantasma' WHERE id = 'r1'");
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, errors: 0 });
    expect(s.details).toEqual([]);
  });

  it('várias parcelas do mesmo cliente no mesmo dia geram uma notificação cada', async () => {
    await parcela('p1', { due_date: dia(3), installment_number: 1 });
    await parcela('p2', { due_date: dia(3), installment_number: 2 });
    await regra('r1', { days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(2);
    expect(logs().map((l) => l.installment_id).sort()).toEqual(['p1', 'p2']);
  });

  it('a regra de um cliente não apanha parcelas de outro', async () => {
    await cliente('cli-2', 'João Santos');
    await parcela('p1', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-1', days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('cada cliente é notificado pela sua regra', async () => {
    await cliente('cli-2', 'João Santos');
    await parcela('p1', { client_id: 'cli-1', due_date: dia(3) });
    await parcela('p2', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-1', days_before: 3 });
    await regra('r2', { client_id: 'cli-2', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(2);
    expect(logs().map((l) => l.client_id).sort()).toEqual(['cli-1', 'cli-2']);
  });

  it('a parcela já paga não é notificada', async () => {
    await parcela('p1', { due_date: dia(3), status: 'paid', paid_date: dia(-1) });
    await regra('r1', { days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(0);
    expect(logs()).toHaveLength(0);
  });

  it('a parcela em atraso ainda entra nos lembretes', async () => {
    await parcela('p1', { due_date: dia(3), status: 'late' });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(1);
  });

  it('a parcela marcada como due_today entra nos lembretes', async () => {
    await parcela('p1', { due_date: dia(0), status: 'due_today' });
    await regra('r1', { days_before: 0 });
    expect((await runDailyCron(env)).notified).toBe(1);
  });

  it('um estado inventado fica de fora dos lembretes', async () => {
    await parcela('p1', { due_date: dia(3), status: 'cancelada' });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('sem regras nenhumas o cron não envia nada', async () => {
    await parcela('p1', { due_date: dia(3) });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 0, errors: 0 });
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('com regra mas sem parcelas não envia nada', async () => {
    await regra('r1');
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('uma parcela com data inválida nunca é apanhada por regra nenhuma', async () => {
    await parcela('p1', { due_date: '15/09/2026' });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).notified).toBe(0);
  });

  it('days_before não numérico desliga a regra em silêncio (documenta o estrago)', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 'abc' });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, errors: 0 });
  });

  // BUG: worker/cron.js:52 — days_before negativo produz o modificador
  // '+-3 days', inválido em SQLite, que devolve NULL: a regra deixa de apanhar
  // seja o que for, sem erro nenhum. A rota de criação (worker/routes/
  // notifications.js:62) aceita qualquer valor. Devia validar-se o campo ou,
  // pelo menos, o cron devia registar a regra como impossível.
  it.fails('days_before negativo não desaparece em silêncio', async () => {
    await parcela('p1', { due_date: dia(-3) });
    await regra('r1', { days_before: -3 });
    const s = await runDailyCron(env);
    expect(s.notified + s.errors).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. TEMPLATES E SUBSTITUIÇÃO DE VARIÁVEIS
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — templates', () => {
  const mensagem = () => logs()[0].message_preview;

  beforeEach(async () => {
    await parcela('p1', {
      due_date: dia(3), amount: 150.5, currency: 'EUR',
      installment_number: 2, total_installments: 6,
    });
  });

  it('usa o template indicado no template_id da regra', async () => {
    await template('t1', { body: 'Mensagem do modelo escolhido' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Mensagem do modelo escolhido');
  });

  it('substitui {{nome}} pelo nome do cliente', async () => {
    await template('t1', { body: 'Olá {{nome}}!' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Olá Maria Silva!');
  });

  it('substitui {{valor}} em euros com o símbolo à direita', async () => {
    await template('t1', { body: '{{valor}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('150,50 €');
  });

  it('substitui {{valor}} em reais com o símbolo à esquerda e milhares', async () => {
    env.DB.exec("UPDATE installments SET amount = 1234.56, currency = 'BRL' WHERE id = 'p1'");
    await template('t1', { body: '{{valor}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('R$ 1.234,56');
  });

  it('uma moeda desconhecida fica com o código à direita', async () => {
    env.DB.exec("UPDATE installments SET currency = 'USD' WHERE id = 'p1'");
    await template('t1', { body: '{{valor}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('150,50 USD');
  });

  it('substitui {{vencimento}} em formato português', async () => {
    await template('t1', { body: '{{vencimento}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    const [a, m, d] = dia(3).split('-');
    expect(mensagem()).toBe(`${d}/${m}/${a}`);
  });

  it('substitui {{parcela}} pelo número sobre o total', async () => {
    await template('t1', { body: '{{parcela}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('2/6');
  });

  it('substitui {{dias}} pelos dias de antecedência da regra', async () => {
    await template('t1', { body: 'faltam {{dias}} dias' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('faltam 3 dias');
  });

  it('substitui várias variáveis na mesma mensagem', async () => {
    await template('t1', { body: '{{nome}} — {{parcela}} — {{valor}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Maria Silva — 2/6 — 150,50 €');
  });

  it('aceita espaços dentro das chavetas', async () => {
    await template('t1', { body: 'Olá {{  nome  }}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Olá Maria Silva');
  });

  it('uma variável inexistente é substituída por vazio', async () => {
    await template('t1', { body: '[{{inexistente}}]' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('[]');
  });

  it('a mesma variável repetida é substituída em todas as ocorrências', async () => {
    await template('t1', { body: '{{nome}} {{nome}}' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Maria Silva Maria Silva');
  });

  it('um template_id que não existe cai no template por omissão do canal', async () => {
    await template('def', { channel: 'email', is_default: 1, body: 'Modelo por omissão' });
    await regra('r1', { days_before: 3, template_id: 'nao-existe' });
    await runDailyCron(env);
    expect(mensagem()).toBe('Modelo por omissão');
  });

  it('sem template_id usa o template por omissão do canal', async () => {
    await template('def', { channel: 'email', is_default: 1, body: 'Modelo por omissão' });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(mensagem()).toBe('Modelo por omissão');
  });

  it('o template por omissão de outro canal não é usado', async () => {
    await template('def', { channel: 'whatsapp', is_default: 1, body: 'Modelo de WhatsApp' });
    await regra('r1', { channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(mensagem()).toContain('lembramos que a parcela');
  });

  it('um template sem is_default não é escolhido como omissão', async () => {
    await template('t1', { channel: 'email', is_default: 0, body: 'Nunca escolhido' });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(mensagem()).not.toBe('Nunca escolhido');
  });

  it('sem template nenhum usa a mensagem embutida no cron', async () => {
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    const [a, m, d] = dia(3).split('-');
    expect(mensagem()).toBe(`Olá Maria Silva, lembramos que a parcela 2/6 no valor de 150,50 € vence a ${d}/${m}/${a}.`);
  });

  it('o assunto do template é renderizado com as variáveis', async () => {
    await template('t1', { subject: 'Parcela {{parcela}} de {{nome}}', body: 'x' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).subject).toBe('Parcela 2/6 de Maria Silva');
  });

  it('sem assunto no template usa o assunto por omissão', async () => {
    await template('t1', { subject: null, body: 'x' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).subject).toBe('Lembrete de pagamento — Vyvian Avena Advogada');
  });

  it('sem template nenhum o assunto é o por omissão', async () => {
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).subject).toBe('Lembrete de pagamento — Vyvian Avena Advogada');
  });

  it('o corpo renderizado é mesmo o que segue no e-mail', async () => {
    await template('t1', { body: 'Prezada {{nome}}, obrigada.' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).text).toBe('Prezada Maria Silva, obrigada.');
  });

  it('a pré-visualização guardada no log é cortada aos 140 caracteres', async () => {
    await template('t1', { body: 'x'.repeat(500) });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toHaveLength(140);
  });

  it('um template de corpo vazio produz uma mensagem vazia (não estoura)', async () => {
    await template('t1', { body: '' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(mensagem()).toBe('');
  });

  it('o template_id da regra manda mesmo havendo um por omissão', async () => {
    await template('def', { channel: 'email', is_default: 1, body: 'omissão' });
    await template('t1', { body: 'escolhido' });
    await regra('r1', { days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(mensagem()).toBe('escolhido');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. CANAIS DE ENVIO
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — canais', () => {
  const comZapi = () => { env.ZAPI_INSTANCE_ID = 'inst'; env.ZAPI_INSTANCE_TOKEN = 'tok'; };

  it('o canal email bate na API do Resend', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(fetchPadrao.chamadas.filter((c) => c.url.includes('api.resend.com'))).toHaveLength(1);
  });

  it('o e-mail vai para o endereço do cliente', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).to).toEqual(['cli-1@exemplo.pt']);
  });

  it('o canal whatsapp bate na Z-API', async () => {
    comZapi();
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3 });
    await runDailyCron(env);
    expect(fetchPadrao.chamadas.filter((c) => c.url.includes('z-api.io'))).toHaveLength(1);
  });

  it('o número de WhatsApp é limpo de caracteres não numéricos', async () => {
    comZapi();
    env.DB.exec("UPDATE clients SET phone = '+351 911 111 111' WHERE id = 'cli-1'");
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3 });
    await runDailyCron(env);
    expect(corpoZapi(fetchPadrao).phone).toBe('351911111111');
  });

  it('a mensagem de WhatsApp é o corpo renderizado', async () => {
    comZapi();
    await template('t1', { channel: 'whatsapp', body: 'Olá {{nome}}' });
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3, template_id: 't1' });
    await runDailyCron(env);
    expect(corpoZapi(fetchPadrao).message).toBe('Olá Maria Silva');
  });

  it('os dois canais juntos fazem uma chamada a cada', async () => {
    comZapi();
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    await regra('r2', { channel: 'whatsapp', days_before: 3 });
    await runDailyCron(env);
    expect(fetchPadrao.chamadas.filter((c) => c.url.includes('resend'))).toHaveLength(1);
    expect(fetchPadrao.chamadas.filter((c) => c.url.includes('z-api'))).toHaveLength(1);
  });

  it('cliente sem e-mail: o envio fica skipped', async () => {
    await cliente('cli-2', 'Sem Email', { email: null });
    await parcela('p1', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-2', channel: 'email', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 1, errors: 0 });
  });

  it('cliente sem e-mail: nada é enviado pela rede', async () => {
    await cliente('cli-2', 'Sem Email', { email: null });
    await parcela('p1', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-2', channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('cliente sem e-mail: fica na mesma uma linha no log com status skipped', async () => {
    await cliente('cli-2', 'Sem Email', { email: null });
    await parcela('p1', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-2', channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ status: 'skipped', channel: 'email' });
  });

  it('e-mail vazio conta como sem destinatário', async () => {
    env.DB.exec("UPDATE clients SET email = '' WHERE id = 'cli-1'");
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    expect((await runDailyCron(env)).skipped).toBe(1);
  });

  it('cliente sem telefone: o WhatsApp fica skipped', async () => {
    comZapi();
    await cliente('cli-2', 'Sem Telefone', { phone: null });
    await parcela('p1', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-2', channel: 'whatsapp', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s.skipped).toBe(1);
    expect(logs()[0]).toMatchObject({ status: 'skipped', channel: 'whatsapp' });
  });

  it('sem RESEND_API_KEY o e-mail fica skipped e não há rede', async () => {
    env.RESEND_API_KEY = '';
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 1 });
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('sem credenciais Z-API o WhatsApp fica skipped', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 1 });
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('com o instance id mas sem token a Z-API continua skipped', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3 });
    expect((await runDailyCron(env)).skipped).toBe(1);
  });

  // O sender devolve `reason` ("RESEND_API_KEY não definido", "sem destinatário"),
  // mas o cron só guarda `result.error` — que num skipped é undefined. O log fica
  // com status='skipped' e error_message NULL: a Dra. vê que não foi enviado, mas
  // não fica a saber porquê (falta de chave? cliente sem e-mail?).
  it('o motivo do skipped não chega ao log (error_message fica NULL)', async () => {
    env.RESEND_API_KEY = '';
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'email', days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0]).toMatchObject({ status: 'skipped', error_message: null });
  });

  it('um canal desconhecido fica skipped sem tocar na rede', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'pombo-correio', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 1, errors: 0 });
    expect(fetchPadrao.chamadas).toHaveLength(0);
  });

  it('o canal desconhecido fica registado no log com o nome que tinha', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'pombo-correio', days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0]).toMatchObject({ channel: 'pombo-correio', status: 'skipped' });
  });

  it('o id externo devolvido pelo Resend fica guardado no log', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0].external_id).toBe('email-1');
  });

  it('o messageId da Z-API fica guardado no log', async () => {
    comZapi();
    vi.stubGlobal('fetch', mockFetch({ json: { messageId: 'wa-99' } }));
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { channel: 'whatsapp', days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0].external_id).toBe('wa-99');
  });

  it('uma resposta sem id deixa o external_id a NULL', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0].external_id).toBe(null);
  });

  it('o e-mail leva também uma versão HTML do corpo', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(corpoResend(fetchPadrao).html).toContain('<p>');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. DEDUPE E IDEMPOTÊNCIA
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — dedupe e idempotência', () => {
  beforeEach(async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
  });

  it('correr duas vezes no mesmo dia não reenvia', async () => {
    await runDailyCron(env);
    const f = mockFetch({ json: { id: 'x' } });
    vi.stubGlobal('fetch', f);
    const s = await runDailyCron(env);
    expect(s.notified).toBe(0);
    expect(f.chamadas).toHaveLength(0);
  });

  it('a segunda corrida conta a parcela como skipped', async () => {
    await runDailyCron(env);
    expect((await runDailyCron(env)).skipped).toBe(1);
  });

  it('duas corridas deixam uma única linha no log', async () => {
    await runDailyCron(env);
    await runDailyCron(env);
    expect(logs()).toHaveLength(1);
  });

  it('cinco corridas seguidas continuam a deixar uma linha só', async () => {
    for (let i = 0; i < 5; i++) await runDailyCron(env);
    expect(logs()).toHaveLength(1);
    expect(fetchPadrao.chamadas.filter((c) => c.url.includes('resend'))).toHaveLength(1);
  });

  it('as transições de estado também são idempotentes', async () => {
    await parcela('p2', { due_date: dia(-1) });
    const primeira = await runDailyCron(env);
    const segunda = await runDailyCron(env);
    expect(primeira.updated_late).toBe(1);
    expect(segunda.updated_late).toBe(0);
  });

  it('um envio registado ontem não trava o de hoje', async () => {
    await runDailyCron(env);
    env.DB.exec(`UPDATE notification_log SET sent_at = '${dia(-1)} 07:00:00'`);
    const f = mockFetch({ json: { id: 'y' } });
    vi.stubGlobal('fetch', f);
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(f.chamadas.filter((c) => c.url.includes('resend'))).toHaveLength(1);
    expect(logs()).toHaveLength(2);
  });

  it('o dedupe é por canal: o WhatsApp passa com o e-mail já enviado', async () => {
    env.ZAPI_INSTANCE_ID = 'inst';
    env.ZAPI_INSTANCE_TOKEN = 'tok';
    await runDailyCron(env);
    await regra('r2', { channel: 'whatsapp', days_before: 3 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 1, skipped: 1 });
    expect(logs().map((l) => l.channel)).toEqual(['email', 'whatsapp']);
  });

  it('o dedupe é por parcela: outra parcela do mesmo cliente ainda é notificada', async () => {
    await runDailyCron(env);
    await parcela('p2', { due_date: dia(3), installment_number: 2 });
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 1, skipped: 1 });
  });

  it('o dedupe não olha ao estado do log: um skipped também bloqueia o dia', async () => {
    env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status)
                 VALUES ('antigo', 'p1', 'cli-1', 'email', 'skipped')`);
    const s = await runDailyCron(env);
    expect(s.notified).toBe(0);
    expect(s.skipped).toBe(1);
  });

  // BUG: worker/cron.js:57-60 — o dedupe só olha a (parcela, canal, dia) e ignora
  // o `status`. Um lembrete que falhou por um 500 transitório fica marcado como
  // "já tentado hoje" e, como o cron só corre uma vez por dia, o cliente nunca
  // chega a receber o aviso. O owner_alerts.js:27 faz o contrário — só faz dedupe
  // do que ficou 'sent'. Uma tentativa falhada devia poder ser repetida.
  it.fails('um envio falhado é retentado na corrida seguinte do mesmo dia', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'servidor em baixo' } }));
    await runDailyCron(env);
    const f = mockFetch({ json: { id: 'ok' } });
    vi.stubGlobal('fetch', f);
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
  });

  it('um envio falhado fica mesmo assim a bloquear o dia (documenta o efeito)', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'boom' } }));
    await runDailyCron(env);
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, skipped: 1, errors: 0 });
  });

  it('um log de outra parcela não bloqueia esta', async () => {
    await parcela('p2', { due_date: dia(3) });
    env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status)
                 VALUES ('outro', 'p2', 'cli-1', 'email', 'sent')`);
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 1, skipped: 1 });
  });

  it('um log de outro canal não bloqueia o e-mail', async () => {
    env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status)
                 VALUES ('wa', 'p1', 'cli-1', 'whatsapp', 'sent')`);
    expect((await runDailyCron(env)).notified).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. ISOLAMENTO DE ERROS — o mais importante
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — isolamento de erros entre regras', () => {
  beforeEach(async () => {
    await cliente('cli-2', 'João Santos');
    await parcela('p1', { client_id: 'cli-1', due_date: dia(3) });
    await parcela('p2', { client_id: 'cli-2', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-1', days_before: 3 });
    await regra('r2', { client_id: 'cli-2', days_before: 3 });
  });

  it('uma regra que rebenta não impede a seguinte', async () => {
    partirConsulta('FROM installments i JOIN clients c', 'cli-1');
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(logs().map((l) => l.client_id)).toEqual(['cli-2']);
  });

  it('a regra que rebenta é contada em errors', async () => {
    partirConsulta('FROM installments i JOIN clients c', 'cli-1');
    expect((await runDailyCron(env)).errors).toBe(1);
  });

  it('o detalhe do erro traz o id da regra e a mensagem', async () => {
    partirConsulta('FROM installments i JOIN clients c', 'cli-1');
    const s = await runDailyCron(env);
    expect(s.details).toEqual([{ rule: 'r1', error: 'D1 indisponível' }]);
  });

  it('todas as regras a rebentar dão errors = 2 e nenhum envio', async () => {
    partirConsulta('FROM installments i JOIN clients c');
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 0, errors: 2 });
    expect(logs()).toHaveLength(0);
  });

  it('o cron devolve o resumo mesmo com todas as regras partidas', async () => {
    partirConsulta('FROM installments i JOIN clients c');
    const s = await runDailyCron(env);
    expect(s.details.map((d) => d.rule).sort()).toEqual(['r1', 'r2']);
  });

  it('uma exceção a meio salta as parcelas seguintes da MESMA regra (documenta)', async () => {
    await parcela('p1b', { client_id: 'cli-1', due_date: dia(3), installment_number: 2 });
    await parcela('p1c', { client_id: 'cli-1', due_date: dia(3), installment_number: 3 });
    partirConsulta('FROM notification_log', 'p1b');
    const s = await runDailyCron(env);
    // p1 foi enviada; p1b rebentou e p1c nunca chegou a ser tentada.
    expect(logs().map((l) => l.installment_id)).toEqual(['p1', 'p2']);
    expect(s.errors).toBe(1);
  });

  it('um envio que falha fica registado como erro e o cron continua', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, json: { message: 'servidor em baixo' } }));
    const s = await runDailyCron(env);
    expect(s.errors).toBe(2);
    expect(logs()).toHaveLength(2);
    expect(logs()[0]).toMatchObject({ status: 'error', error_message: 'servidor em baixo' });
  });

  it('a rede em baixo fica registada como erro sem levantar exceção', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'ECONNRESET' }));
    const s = await runDailyCron(env);
    expect(s.errors).toBe(2);
    expect(logs().every((l) => l.status === 'error')).toBe(true);
  });

  it('uma falha só de um cliente deixa o outro ser notificado', async () => {
    vi.stubGlobal('fetch', mockFetch((url, init) => (
      String(init.body).includes('cli-1@exemplo.pt') ? { status: 500, json: { message: 'recusado' } } : { json: { id: 'ok' } }
    )));
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 1, errors: 1 });
  });

  it('a falha do INSERT no log não parte o cron nem a contagem', async () => {
    env.DB.exec(`CREATE TRIGGER bloqueia_log BEFORE INSERT ON notification_log
                 BEGIN SELECT RAISE(ABORT, 'log em baixo'); END`);
    const s = await runDailyCron(env);
    expect(s.notified).toBe(2);
    expect(logs()).toHaveLength(0);
  });
});

describe('runDailyCron — isolamento dos blocos auxiliares', () => {
  beforeEach(async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
  });

  it('o Instagram em baixo não impede as notificações', async () => {
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(s.instagram).toHaveProperty('error');
  });

  it('o erro do Instagram vem com a razão legível', async () => {
    const s = await runDailyCron(env);
    expect(s.instagram.error).toContain('token do Instagram');
  });

  it('o erro do Instagram não conta para summary.errors (só as regras contam)', async () => {
    const s = await runDailyCron(env);
    expect(s.errors).toBe(0);
  });

  it('o updateKeywordMetrics a falhar não impede o resto', async () => {
    env.DB.exec('DROP TABLE keyword_bank');
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(s.palavras).toHaveProperty('error');
  });

  it('o Banco de Palavras vazio devolve zero termos sem erro', async () => {
    const s = await runDailyCron(env);
    expect(s.palavras).toEqual({ termos: 0 });
  });

  it('com termos no banco o cron recalcula as métricas', async () => {
    env.DB.exec("INSERT INTO keyword_bank (termo, tipo, score) VALUES ('divorcio em portugal', 'conjunto', 80)");
    const s = await runDailyCron(env);
    expect(s.palavras).toEqual({ termos: 1 });
  });

  it('os alertas à Dra. a falhar não impedem as notificações aos clientes', async () => {
    env.DB.exec('DROP TABLE owner_alert_prefs');
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(s.owner_alerts).toHaveProperty('error');
  });

  it('o erro dos alertas à Dra. é escrito na consola', async () => {
    env.DB.exec('DROP TABLE owner_alert_prefs');
    await runDailyCron(env);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('owner alerts'))).toBe(true);
  });

  it('a limpeza de visitantes a falhar deixa a contagem a zero sem parar o cron', async () => {
    env.DB.exec('DROP TABLE site_visitors_daily');
    const s = await runDailyCron(env);
    expect(s.visitors_pruned).toBe(0);
    expect(s.notified).toBe(1);
  });

  it('as notificações partidas não impedem a limpeza de visitantes', async () => {
    env.DB.exec(`INSERT INTO site_visitors_daily (day, visitor_hash) VALUES ('${dia(-40)}', 'h1')`);
    partirConsulta('FROM installments i JOIN clients c');
    const s = await runDailyCron(env);
    expect(s.errors).toBe(1);
    expect(s.visitors_pruned).toBe(1);
  });

  it('as notificações partidas não impedem o Banco de Palavras', async () => {
    partirConsulta('FROM installments i JOIN clients c');
    const s = await runDailyCron(env);
    expect(s.palavras).toEqual({ termos: 0 });
  });

  it('o resumo é devolvido mesmo com todos os blocos auxiliares partidos', async () => {
    env.DB.exec('DROP TABLE owner_alert_prefs');
    env.DB.exec('DROP TABLE site_visitors_daily');
    env.DB.exec('DROP TABLE keyword_bank');
    const s = await runDailyCron(env);
    expect(s.notified).toBe(1);
    expect(s.owner_alerts).toHaveProperty('error');
    expect(s.instagram).toHaveProperty('error');
    expect(s.palavras).toHaveProperty('error');
    expect(s.visitors_pruned).toBe(0);
  });

  it('nenhum bloco auxiliar deixa a promessa do cron rejeitada', async () => {
    env.DB.exec('DROP TABLE owner_alert_prefs');
    env.DB.exec('DROP TABLE keyword_bank');
    await expect(runDailyCron(env)).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. RESUMO, LOG E ORDEM DAS TAREFAS
// ═════════════════════════════════════════════════════════════════════════════
describe('runDailyCron — resumo e efeitos', () => {
  it('o resumo soma notified, skipped e errors das várias regras', async () => {
    await cliente('cli-2', 'Sem Email', { email: null });
    await cliente('cli-3', 'Falhada');
    await parcela('p1', { client_id: 'cli-1', due_date: dia(3) });
    await parcela('p2', { client_id: 'cli-2', due_date: dia(3) });
    await parcela('p3', { client_id: 'cli-3', due_date: dia(3) });
    await regra('r1', { client_id: 'cli-1', days_before: 3 });
    await regra('r2', { client_id: 'cli-2', days_before: 3 });
    await regra('r3', { client_id: 'cli-3', days_before: 3 });
    vi.stubGlobal('fetch', mockFetch((url, init) => (
      String(init.body).includes('cli-3@exemplo.pt') ? { status: 500, json: { message: 'não' } } : { json: { id: 'ok' } }
    )));
    const s = await runDailyCron(env);
    expect(s).toMatchObject({ notified: 1, skipped: 1, errors: 1 });
  });

  it('há uma linha de log por tentativa', async () => {
    await parcela('p1', { due_date: dia(3) });
    await parcela('p2', { due_date: dia(3), installment_number: 2 });
    await parcela('p3', { due_date: dia(3), installment_number: 3 });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs()).toHaveLength(3);
  });

  it('o log guarda a parcela e o cliente certos', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0]).toMatchObject({ installment_id: 'p1', client_id: 'cli-1', channel: 'email', status: 'sent' });
  });

  it('cada linha do log tem um id próprio', async () => {
    await parcela('p1', { due_date: dia(3) });
    await parcela('p2', { due_date: dia(3), installment_number: 2 });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    const ids = logs().map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((i) => typeof i === 'string' && i.length > 10)).toBe(true);
  });

  it('o sent_at é preenchido com a data de hoje', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    expect(logs()[0].sent_at.slice(0, 10)).toBe(dia(0));
  });

  it('details fica vazio quando corre tudo bem', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    expect((await runDailyCron(env)).details).toEqual([]);
  });

  it('a limpeza de privacidade apaga hashes com mais de 35 dias', async () => {
    env.DB.exec(`INSERT INTO site_visitors_daily (day, visitor_hash) VALUES ('${dia(-40)}', 'h1')`);
    const s = await runDailyCron(env);
    expect(s.visitors_pruned).toBe(1);
    expect(env.DB.conta('site_visitors_daily')).toBe(0);
  });

  it('a limpeza de privacidade poupa os hashes recentes', async () => {
    env.DB.exec(`INSERT INTO site_visitors_daily (day, visitor_hash) VALUES ('${dia(-40)}', 'h1'), ('${dia(-2)}', 'h2')`);
    const s = await runDailyCron(env);
    expect(s.visitors_pruned).toBe(1);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
  });

  it('sem visitantes a limpeza devolve zero', async () => {
    expect((await runDailyCron(env)).visitors_pruned).toBe(0);
  });

  it('o sync do Instagram grava a fotografia do dia quando há token', async () => {
    await env.SESSIONS.put('ig:token', JSON.stringify({
      access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 60 * 86400,
    }));
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (url.includes('/me?fields=')) return { json: { followers_count: 42, media_count: 3 } };
      return { json: { data: [] } };
    }));
    const s = await runDailyCron(env);
    expect(s.instagram.followers).toBe(42);
    expect(env.DB.linha('SELECT followers_count FROM ig_snapshots WHERE day = ?', dia(0)).followers_count).toBe(42);
  });

  it('as parcelas são atualizadas ANTES das notificações (a de hoje já entra como due_today)', async () => {
    await parcela('p1', { due_date: dia(0), status: 'pending' });
    await regra('r1', { days_before: 0 });
    const s = await runDailyCron(env);
    expect(s.updated_due_today).toBe(1);
    expect(s.notified).toBe(1);
    expect(estado('p1')).toBe('due_today');
  });

  it('a ordem das tarefas é: estados, regras, alertas à Dra., privacidade, palavras', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await runDailyCron(env);
    const estados = ordemQuery("SET status = 'late'");
    const regras = ordemQuery('FROM notification_rules');
    const dona = ordemQuery('FROM owner_alert_prefs');
    const privacidade = ordemQuery('DELETE FROM site_visitors_daily');
    const palavras = ordemQuery('FROM keyword_bank');
    expect(estados).toBeGreaterThanOrEqual(0);
    expect(regras).toBeGreaterThan(estados);
    expect(dona).toBeGreaterThan(regras);
    expect(privacidade).toBeGreaterThan(dona);
    expect(palavras).toBeGreaterThan(privacidade);
  });

  it('os alertas à Dra. correm dentro do cron e aparecem no resumo', async () => {
    env.DB.exec("UPDATE owner_alert_prefs SET email_enabled = 1 WHERE alert_type = 'vence_hoje'");
    await parcela('p1', { due_date: dia(0) });
    const s = await runDailyCron(env);
    expect(s.owner_alerts.vence_hoje).toEqual({ email: 'sent' });
  });

  it('sem nada para avisar o bloco de alertas à Dra. devolve um objeto vazio', async () => {
    const s = await runDailyCron(env);
    expect(s.owner_alerts).toEqual({});
  });

  it('o cron corre de ponta a ponta com a base de dados vazia', async () => {
    env.DB.exec('DELETE FROM clients');
    const s = await runDailyCron(env);
    expect(s).toMatchObject({
      updated_late: 0, updated_due_today: 0, notified: 0, skipped: 0, errors: 0, visitors_pruned: 0,
    });
  });

  it('o resumo é serializável para JSON (vai para os logs do Worker)', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    const s = await runDailyCron(env);
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(JSON.parse(JSON.stringify(s)).notified).toBe(1);
  });

  it('o segundo argumento (ctx) não é obrigatório', async () => {
    await parcela('p1', { due_date: dia(-1) });
    await expect(runDailyCron(env)).resolves.toBeDefined();
    expect(estado('p1')).toBe('late');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. O HANDLER `scheduled` (Cron Trigger "0 7 * * *")
// ═════════════════════════════════════════════════════════════════════════════
describe('worker.scheduled — gatilho agendado', () => {
  const evento = { cron: '0 7 * * *', scheduledTime: Date.now() };

  it('entrega o trabalho ao ctx.waitUntil uma única vez', async () => {
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(ctx.pendentes[0]).toBeInstanceOf(Promise);
    await ctx.esperar();
  });

  it('não devolve o resumo — é fire-and-forget', async () => {
    const ctx = criarCtx();
    await expect(worker.scheduled(evento, env, ctx)).resolves.toBeUndefined();
    await ctx.esperar();
  });

  it('o cron corre mesmo: a parcela vencida passa a late', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    expect(estado('p1')).toBe('late');
  });

  it('envia as notificações devidas', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    expect(logs()).toHaveLength(1);
  });

  it('regista o resumo na consola em caso de sucesso', async () => {
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('cron diário OK'))).toBe(true);
  });

  it('o resumo registado vai em JSON e traz as contagens', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    const linha = logSpy.mock.calls.find((c) => String(c[0]).includes('cron diário OK'));
    expect(JSON.parse(linha[1]).updated_late).toBe(1);
  });

  it('uma exceção dentro do cron não fica por apanhar', async () => {
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const ctx = criarCtx();
    await expect(worker.scheduled(evento, env, ctx)).resolves.toBeUndefined();
    await expect(ctx.esperar()).resolves.toBeDefined();
  });

  it('a promessa entregue ao waitUntil resolve mesmo com o cron partido', async () => {
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await expect(ctx.pendentes[0]).resolves.toBeUndefined();
  });

  it('a falha do cron é registada na consola', async () => {
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('cron diário falhou'))).toBe(true);
  });

  it('a falha do cron não escreve o log de sucesso', async () => {
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('cron diário OK'))).toBe(false);
  });

  it('o handler não depende do conteúdo do evento', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const ctx = criarCtx();
    await worker.scheduled({}, env, ctx);
    await ctx.esperar();
    expect(estado('p1')).toBe('late');
  });

  it('duas execuções agendadas no mesmo dia não duplicam envios', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    const ctx = criarCtx();
    await worker.scheduled(evento, env, ctx);
    await ctx.esperar();
    const ctx2 = criarCtx();
    await worker.scheduled(evento, env, ctx2);
    await ctx2.esperar();
    expect(logs()).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. DISPARO MANUAL — POST /api/cron/run
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/cron/run — disparo manual', () => {
  async function autenticado() {
    const jti = 'sessao-cron';
    const token = await signJWT({ sub: 1, name: 'Victor', email: 'v@exemplo.pt', jti }, env.JWT_SECRET);
    await env.SESSIONS.put(jti, JSON.stringify({ criada: true }));
    return { Authorization: `Bearer ${token}` };
  }
  const disparar = async (headers) => worker.fetch(
    new Request('https://vyavenaadv.com/api/cron/run', { method: 'POST', headers }), env, criarCtx(),
  );

  it('devolve ok e o resumo do cron', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const b = await json(await disparar(await autenticado()));
    expect(b).toMatchObject({ ok: true, updated_late: 1 });
  });

  it('produz os mesmos efeitos que o gatilho agendado', async () => {
    await parcela('p1', { due_date: dia(3) });
    await regra('r1', { days_before: 3 });
    await disparar(await autenticado());
    expect(logs()).toHaveLength(1);
  });

  it('sem sessão devolve 401 e não corre o cron', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const r = await disparar({});
    expect(r.status).toBe(401);
    expect(estado('p1')).toBe('pending');
  });

  it('GET no mesmo caminho não corre o cron', async () => {
    await parcela('p1', { due_date: dia(-1) });
    const r = await worker.fetch(
      new Request('https://vyavenaadv.com/api/cron/run', { headers: await autenticado() }), env, criarCtx(),
    );
    expect(r.status).toBe(404);
    expect(estado('p1')).toBe('pending');
  });

  it('um cron partido devolve 500 tratado em vez de rebentar', async () => {
    const headers = await autenticado();
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const r = await disparar(headers);
    expect(r.status).toBe(500);
  });
});
