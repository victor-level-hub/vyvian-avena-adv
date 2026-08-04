// tests/worker/apoio.test.js — Apoio Técnico (tickets)
//
// Suíte de "esfolamento" do handleApoio: caminho feliz, validações, limites,
// abusos e transições de estado. O D1 é SQLite a sério (tests/helpers/d1.js),
// por isso um NOT NULL violado ou uma PK repetida rebentam mesmo.
//
// Defeitos reais do código-fonte ficam marcados com `it.fails` + comentário BUG.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleApoio } from '../../worker/routes/apoio.js';
import { criarEnv, req, json, mockFetch, geminiJson, FakeAI } from '../helpers/env.js';

// ─── utilitários ─────────────────────────────────────────────────────────────

function agoraLisboa() {
  const f = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => f.find((p) => p.type === t)?.value || '';
  return { data: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour')}:${g('minute')}`, ano: g('year') };
}

const ANO = agoraLisboa().ano;
const T1 = `AT-${ANO}-001`;
const T2 = `AT-${ANO}-002`;

/** Invoca o handler tal como o worker/index.js faz (path = url.pathname). */
function chamar(env, metodo, caminho, opts = {}, session) {
  const pathname = caminho.split('?')[0];
  return handleApoio(req(metodo, caminho, opts), env, pathname, session);
}

async function semear(env, id, campos = {}) {
  const c = {
    titulo: `Ticket ${id}`, descricao: '', criado_por: 'Victor', status: 'aberto',
    urgencia: 'media', complexidade: null, complexidade_justificacao: null, plano_ia: null,
    impedimentos: null, resolucao: null, data_abertura: null, hora_abertura: null,
    data_prazo: null, created_at: null, ...campos,
  };
  await env.DB.prepare(`
    INSERT INTO tickets (id, titulo, descricao, criado_por, status, urgencia, complexidade,
      complexidade_justificacao, plano_ia, impedimentos, resolucao, data_abertura,
      hora_abertura, data_prazo, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))
  `).bind(
    id, c.titulo, c.descricao, c.criado_por, c.status, c.urgencia, c.complexidade,
    c.complexidade_justificacao, c.plano_ia, c.impedimentos, c.resolucao, c.data_abertura,
    c.hora_abertura, c.data_prazo, c.created_at,
  ).run();
  return id;
}

async function semearAnexo(env, ticketId, opts = {}) {
  const {
    tipo = 'anexo', nome = 'ficheiro.png', ct = 'image/png',
    bytes = new Uint8Array([1, 2, 3]), transcricao = null, created_at = null, semObjeto = false,
  } = opts;
  const r2key = opts.r2key || `apoio/${ticketId}/${Math.random().toString(36).slice(2)}-${nome}`;
  if (!semObjeto) await env.RECIBOS.put(r2key, bytes, { httpMetadata: { contentType: ct } });
  return env.DB.prepare(`
    INSERT INTO ticket_anexos (ticket_id, tipo, nome, content_type, size, r2_key, transcricao, created_at)
    VALUES (?,?,?,?,?,?,?, COALESCE(?, datetime('now'))) RETURNING *
  `).bind(ticketId, tipo, nome, ct, bytes ? bytes.byteLength : 0, r2key, transcricao, created_at).first();
}

const logs = (env, id) =>
  env.DB.linhas(`SELECT * FROM ticket_log WHERE ticket_id = ? ORDER BY id`, id);

const corpoResend = (fetchMock) => JSON.parse(fetchMock.chamadas.at(-1).init.body);

let env;
beforeEach(() => { env = criarEnv(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// ─── encaminhamento ──────────────────────────────────────────────────────────

describe('encaminhamento e 404s', () => {
  it('devolve 404 num caminho de apoio desconhecido', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/qualquer-coisa');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Not found');
  });

  it('devolve 404 na raiz /api/apoio', async () => {
    expect((await chamar(env, 'GET', '/api/apoio')).status).toBe(404);
  });

  it('devolve 404 para ticket inexistente', async () => {
    const r = await chamar(env, 'GET', `/api/apoio/tickets/${T1}`);
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Ticket não encontrado.');
  });

  it('rejeita ID com ano de 2 dígitos (AT-26-1)', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets/AT-26-1');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Not found');
  });

  // CORRIGIDO (era): a regex exigia exatamente 3 dígitos, por isso a partir do
  // 1000.º ticket do ano o ticket era criado mas ficava inacessível. Agora a rota
  // aceita 3 ou mais dígitos e devolve 404 só porque o ticket não existe.
  it('aceita ID com sequencial de 4 dígitos e devolve 404 se não existir', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets/AT-2026-1234');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Ticket não encontrado.');
  });

  it('rejeita ID em minúsculas (at-2026-001)', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets/at-2026-001');
    expect((await json(r)).error).toBe('Not found');
  });

  it('rejeita ID com sequencial de 2 dígitos (AT-2026-01)', async () => {
    expect((await json(await chamar(env, 'GET', '/api/apoio/tickets/AT-2026-01'))).error).toBe('Not found');
  });

  it('rejeita ID com prefixo errado (XX-2026-001)', async () => {
    expect((await json(await chamar(env, 'GET', '/api/apoio/tickets/XX-2026-001'))).error).toBe('Not found');
  });

  it('rejeita barra final depois do ID', async () => {
    await semear(env, T1);
    expect((await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}/`))).error).toBe('Not found');
  });

  it('rejeita sub-ação desconhecida', async () => {
    await semear(env, T1);
    expect((await json(await chamar(env, 'POST', `/api/apoio/tickets/${T1}/apagar`))).error).toBe('Not found');
  });

  it('rejeita ID de anexo não numérico', async () => {
    expect((await json(await chamar(env, 'GET', '/api/apoio/anexos/abc'))).error).toBe('Not found');
  });

  it('devolve 404 para anexo numérico inexistente', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/anexos/12345');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Anexo não encontrado.');
  });

  it('devolve 405 em método não suportado na coleção de tickets', async () => {
    const r = await chamar(env, 'PUT', '/api/apoio/tickets');
    expect(r.status).toBe(405);
    expect((await json(r)).error).toBe('Método não suportado.');
  });

  it('devolve 405 em DELETE na coleção de tickets', async () => {
    expect((await chamar(env, 'DELETE', '/api/apoio/tickets')).status).toBe(405);
  });

  it('devolve 405 em método não suportado sobre um anexo existente', async () => {
    await semear(env, T1);
    const a = await semearAnexo(env, T1);
    const r = await chamar(env, 'PUT', `/api/apoio/anexos/${a.id}`);
    expect(r.status).toBe(405);
  });

  it('DELETE de um ticket cai em 404 (não há rota de eliminação)', async () => {
    await semear(env, T1);
    const r = await chamar(env, 'DELETE', `/api/apoio/tickets/${T1}`);
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Not found');
  });

  it('GET em /transcrever cai em 404 (só aceita POST)', async () => {
    expect((await chamar(env, 'GET', '/api/apoio/transcrever')).status).toBe(404);
  });

  it('ações sobre ticket inexistente devolvem 404 antes de qualquer efeito', async () => {
    for (const acao of ['abrir', 'analisar', 'executar', 'aprovar', 'anexos']) {
      const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/${acao}`);
      expect(r.status, acao).toBe(404);
    }
    expect(env.DB.conta('ticket_log')).toBe(0);
  });
});

// ─── criação ─────────────────────────────────────────────────────────────────

describe('POST /api/apoio/tickets (criação)', () => {
  it('cria um rascunho e devolve 201 com o ticket', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'Erro no recibo' } });
    expect(r.status).toBe(201);
    const { ok, ticket } = await json(r);
    expect(ok).toBe(true);
    expect(ticket).toMatchObject({ id: T1, titulo: 'Erro no recibo', status: 'rascunho', urgencia: 'media' });
  });

  it('grava mesmo o ticket na base de dados', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'Erro' } });
    expect(env.DB.conta('tickets')).toBe(1);
  });

  it('apara espaços do título', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: '   Título com margens   ' } });
    expect((await json(r)).ticket.titulo).toBe('Título com margens');
  });

  it('recusa ticket sem título', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { descricao: 'só descrição' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Título obrigatório.');
  });

  it('recusa título vazio', async () => {
    expect((await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: '' } })).status).toBe(400);
  });

  it('recusa título só com espaços e tabulações', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: '  \t\n  ' } });
    expect(r.status).toBe(400);
    expect(env.DB.conta('tickets')).toBe(0);
  });

  it('recusa corpo JSON inválido', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: '{isto não é json', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Título obrigatório.');
  });

  it('recusa corpo vazio', async () => {
    expect((await chamar(env, 'POST', '/api/apoio/tickets')).status).toBe(400);
  });

  it('recusa corpo que é um array', async () => {
    expect((await chamar(env, 'POST', '/api/apoio/tickets', { body: [1, 2, 3] })).status).toBe(400);
  });

  it('recusa corpo que é um número', async () => {
    expect((await chamar(env, 'POST', '/api/apoio/tickets', { body: '123', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
  });

  // CORRIGIDO (era): request.json() devolve null para o corpo literal "null"; o .catch() não
  // dispara e `body.titulo` rebenta com TypeError (500 no worker) em vez de 400.
  // worker/routes/apoio.js:137-138
  it('devolve 400 (e não uma exceção) para o corpo literal null', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: 'null', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(400);
  });

  it('aceita título gigante — não há limite de comprimento definido', async () => {
    const gigante = 'A'.repeat(10_000);
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: gigante } });
    expect(r.status).toBe(201);
    expect((await json(r)).ticket.titulo).toHaveLength(10_000);
  });

  it('guarda o título com aspas e sinais de menor sem os interpretar', async () => {
    const t = `Erro no <b>"recibo"</b> & anexos`;
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: t } });
    expect((await json(r)).ticket.titulo).toBe(t);
  });

  it('descrição por omissão é string vazia', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'x' } });
    expect((await json(r)).ticket.descricao).toBe('');
  });

  it('urgência válida é respeitada', async () => {
    for (const u of ['baixa', 'media', 'alta', 'critica']) {
      const e = criarEnv();
      const r = await chamar(e, 'POST', '/api/apoio/tickets', { body: { titulo: 't', urgencia: u } });
      expect((await json(r)).ticket.urgencia).toBe(u);
    }
  });

  it('urgência inválida cai silenciosamente para média (não é erro na criação)', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', urgencia: 'urgentíssima' } });
    expect(r.status).toBe(201);
    expect((await json(r)).ticket.urgencia).toBe('media');
  });

  it('status "aberto" no corpo abre logo o ticket com data e hora', async () => {
    const { data, hora } = agoraLisboa();
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', status: 'aberto' } });
    const { ticket } = await json(r);
    expect(ticket.status).toBe('aberto');
    expect(ticket.data_abertura).toBe(data);
    expect(ticket.hora_abertura).toMatch(/^\d{2}:\d{2}$/);
    expect(ticket.hora_abertura.slice(0, 2)).toBe(hora.slice(0, 2));
  });

  it('qualquer outro status no corpo é ignorado e o ticket nasce rascunho', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', status: 'resolvido' } });
    const { ticket } = await json(r);
    expect(ticket.status).toBe('rascunho');
    expect(ticket.data_abertura).toBe(null);
  });

  it('rascunho não recebe data nem hora de abertura', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    const { ticket } = await json(r);
    expect(ticket.data_abertura).toBe(null);
    expect(ticket.hora_abertura).toBe(null);
  });

  it('regista no log o evento "criado" para um rascunho', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    const [l] = logs(env, T1);
    expect(l).toMatchObject({ evento: 'criado', detalhe: 'Guardado como rascunho', autor: 'Victor' });
  });

  it('regista no log o evento "aberto" quando nasce aberto', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', status: 'aberto' } });
    const [l] = logs(env, T1);
    expect(l.evento).toBe('aberto');
    expect(l.detalhe).toMatch(/^Ticket aberto às \d{2}:\d{2}$/);
  });

  it('usa o nome da sessão como autor', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } }, { name: 'Dra. Vyvian' });
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
    expect(env.DB.linha('SELECT criado_por FROM tickets WHERE id = ?', T1).criado_por).toBe('Dra. Vyvian');
  });

  it('sem sessão o autor é "Victor"', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    expect(logs(env, T1)[0].autor).toBe('Victor');
  });

  it('sessão sem nome cai igualmente para "Victor"', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } }, { email: 'x@y.pt' });
    expect(logs(env, T1)[0].autor).toBe('Victor');
  });

  it('criado_por explícito no corpo ganha à sessão', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', criado_por: 'Dra. Vyvian' } }, { name: 'Victor' });
    expect(env.DB.linha('SELECT criado_por FROM tickets WHERE id = ?', T1).criado_por).toBe('Dra. Vyvian');
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
  });

  it('guarda a data de prazo tal como vem', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', data_prazo: '2026-12-25' } });
    expect((await json(r)).ticket.data_prazo).toBe('2026-12-25');
  });

  it('sem prazo grava NULL', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    expect((await json(r)).ticket.data_prazo).toBe(null);
  });

  it('ignora campos desconhecidos no corpo', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', id: 'AT-1900-999', foo: 'bar' } });
    expect((await json(r)).ticket.id).toBe(T1);
  });
});

// ─── geração de ID ───────────────────────────────────────────────────────────

describe('geração do ID AT-AAAA-NNN', () => {
  it('o primeiro ticket do ano é o 001', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect((await json(r)).ticket.id).toBe(`AT-${ANO}-001`);
  });

  it('numera sequencialmente com zeros à esquerda', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
      ids.push((await json(r)).ticket.id);
    }
    expect(ids).toEqual([`AT-${ANO}-001`, `AT-${ANO}-002`, `AT-${ANO}-003`]);
  });

  it('o décimo ticket é o 010', async () => {
    for (let i = 1; i <= 9; i++) await semear(env, `AT-${ANO}-${String(i).padStart(3, '0')}`);
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect((await json(r)).ticket.id).toBe(`AT-${ANO}-010`);
  });

  it('o centésimo ticket é o 100', async () => {
    env.DB.exec(`INSERT INTO tickets (id, titulo, criado_por)
      SELECT 'AT-${ANO}-' || printf('%03d', n), 'x', 'Victor'
      FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 99) SELECT n FROM c)`);
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect((await json(r)).ticket.id).toBe(`AT-${ANO}-100`);
  });

  it('tickets de outros anos não contam para a sequência', async () => {
    await semear(env, 'AT-2024-001');
    await semear(env, 'AT-2025-001');
    await semear(env, 'AT-2025-002');
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect((await json(r)).ticket.id).toBe(`AT-${ANO}-001`);
  });

  it('conta apenas os tickets do ano corrente quando há mistura', async () => {
    await semear(env, 'AT-2025-001');
    await semear(env, `AT-${ANO}-001`);
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect((await json(r)).ticket.id).toBe(`AT-${ANO}-002`);
  });

  // CORRIGIDO (era): o ID vem de COUNT(*)+1. Se um ticket intermédio for apagado, o próximo
  // ID repete um já existente e o INSERT rebenta com UNIQUE constraint (500).
  // worker/routes/apoio.js:51-56
  it('não repete IDs quando um ticket intermédio foi apagado', async () => {
    await semear(env, `AT-${ANO}-001`);
    await semear(env, `AT-${ANO}-002`);
    env.DB.exec(`DELETE FROM tickets WHERE id = 'AT-${ANO}-001'`);
    const r = await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } });
    expect(r.status).toBe(201);
  });

  // CORRIGIDO (era): a partir do 1000.º ticket do ano o ID passa a ter 4 dígitos
  // (AT-AAAA-1000) e deixa de casar com a regex das rotas por ticket — o ticket
  // é criado mas fica inacessível (404 em GET/PATCH/ações).
  // worker/routes/apoio.js:55 vs :160
  it('mantém o ticket acessível a partir do 1000.º do ano', async () => {
    env.DB.exec(`INSERT INTO tickets (id, titulo, criado_por)
      SELECT 'AT-${ANO}-' || printf('%03d', n), 'x', 'Victor'
      FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 999) SELECT n FROM c)`);
    const criado = (await json(await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'a' } }))).ticket;
    expect(criado.id).toBe(`AT-${ANO}-1000`);
    const r = await chamar(env, 'GET', `/api/apoio/tickets/${criado.id}`);
    expect(r.status).toBe(200);
  });
});

// ─── lista ───────────────────────────────────────────────────────────────────

describe('GET /api/apoio/tickets (lista)', () => {
  beforeEach(async () => {
    await semear(env, `AT-${ANO}-001`, { titulo: 'Recibo não gera PDF', descricao: 'rebenta ao carregar', status: 'aberto', urgencia: 'alta', created_at: '2026-01-01 10:00:00' });
    await semear(env, `AT-${ANO}-002`, { titulo: 'Melhorar o calendário', descricao: 'cores por tipo', status: 'rascunho', urgencia: 'baixa', created_at: '2026-01-02 10:00:00' });
    await semear(env, `AT-${ANO}-003`, { titulo: 'WhatsApp em duplicado', descricao: 'envia 2x', status: 'resolvido', urgencia: 'critica', created_at: '2026-01-03 10:00:00' });
  });

  it('lista todos os tickets', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets'));
    expect(tickets).toHaveLength(3);
  });

  it('ordena do mais recente para o mais antigo', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets'));
    expect(tickets.map((t) => t.id)).toEqual([`AT-${ANO}-003`, `AT-${ANO}-002`, `AT-${ANO}-001`]);
  });

  it('devolve lista vazia quando não há tickets', async () => {
    const vazio = criarEnv();
    const { tickets } = await json(await chamar(vazio, 'GET', '/api/apoio/tickets'));
    expect(tickets).toEqual([]);
  });

  it('filtra por status', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?status=aberto'));
    expect(tickets.map((t) => t.id)).toEqual([`AT-${ANO}-001`]);
  });

  it('filtra por urgência', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?urgencia=critica'));
    expect(tickets.map((t) => t.id)).toEqual([`AT-${ANO}-003`]);
  });

  it('combina status e urgência', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?status=aberto&urgencia=alta'));
    expect(tickets).toHaveLength(1);
  });

  it('combinação sem correspondência devolve vazio', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?status=aberto&urgencia=baixa'));
    expect(tickets).toEqual([]);
  });

  it('ignora status inválido em vez de rebentar', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets?status=inventado');
    expect(r.status).toBe(200);
    expect((await json(r)).tickets).toHaveLength(3);
  });

  it('ignora urgência inválida em vez de rebentar', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets?urgencia=urgentissima');
    expect((await json(r)).tickets).toHaveLength(3);
  });

  it('ignora status vazio', async () => {
    expect((await json(await chamar(env, 'GET', '/api/apoio/tickets?status='))).tickets).toHaveLength(3);
  });

  it('ignora tentativa de injeção SQL no filtro de status', async () => {
    const r = await chamar(env, 'GET', "/api/apoio/tickets?status=aberto'%20OR%20'1'='1");
    expect(r.status).toBe(200);
    expect((await json(r)).tickets).toHaveLength(3);
  });

  it('pesquisa pelo título', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=calend'));
    expect(tickets.map((t) => t.id)).toEqual([`AT-${ANO}-002`]);
  });

  it('pesquisa pela descrição', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=duplicado'));
    expect(tickets).toHaveLength(1);
  });

  it('pesquisa pelo ID', async () => {
    const { tickets } = await json(await chamar(env, 'GET', `/api/apoio/tickets?q=${ANO}-003`));
    expect(tickets.map((t) => t.id)).toEqual([`AT-${ANO}-003`]);
  });

  it('pesquisa apara espaços à volta do termo', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=%20%20calend%20%20'));
    expect(tickets).toHaveLength(1);
  });

  it('pesquisa só com espaços é ignorada', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=%20%20%20'));
    expect(tickets).toHaveLength(3);
  });

  it('pesquisa sem correspondência devolve vazio', async () => {
    expect((await json(await chamar(env, 'GET', '/api/apoio/tickets?q=zzz-inexistente'))).tickets).toEqual([]);
  });

  it('pesquisa é insensível a maiúsculas em ASCII', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=RECIBO'));
    expect(tickets).toHaveLength(1);
  });

  it('aspas simples na pesquisa não partem a query (parâmetros ligados)', async () => {
    const r = await chamar(env, 'GET', "/api/apoio/tickets?q=%27%20OR%201%3D1%20--");
    expect(r.status).toBe(200);
    expect((await json(r)).tickets).toEqual([]);
  });

  it('aspas duplas na pesquisa não partem a query', async () => {
    const r = await chamar(env, 'GET', '/api/apoio/tickets?q=%22recibo%22');
    expect(r.status).toBe(200);
    expect((await json(r)).tickets).toEqual([]);
  });

  // Comportamento documentado: o `q` entra cru no LIKE, por isso os curingas do
  // SQL (% e _) funcionam como pesquisa avançada em vez de texto literal.
  it('o curinga % na pesquisa devolve tudo (LIKE sem escape)', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=%25'));
    expect(tickets).toHaveLength(3);
  });

  it('o curinga _ na pesquisa casa qualquer caractere', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets?q=Reci_o'));
    expect(tickets).toHaveLength(1);
  });

  it('conta os anexos de cada ticket em n_anexos', async () => {
    await semearAnexo(env, `AT-${ANO}-001`);
    await semearAnexo(env, `AT-${ANO}-001`, { tipo: 'print_conclusao' });
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets'));
    const porId = Object.fromEntries(tickets.map((t) => [t.id, t.n_anexos]));
    expect(porId[`AT-${ANO}-001`]).toBe(2);
    expect(porId[`AT-${ANO}-002`]).toBe(0);
  });

  it('devolve todas as colunas do ticket na lista', async () => {
    const { tickets } = await json(await chamar(env, 'GET', '/api/apoio/tickets'));
    expect(Object.keys(tickets[0])).toEqual(expect.arrayContaining([
      'id', 'titulo', 'descricao', 'criado_por', 'status', 'urgencia', 'complexidade',
      'plano_ia', 'impedimentos', 'resolucao', 'data_prazo', 'created_at', 'updated_at', 'n_anexos',
    ]));
  });
});

// ─── detalhe ─────────────────────────────────────────────────────────────────

describe('GET /api/apoio/tickets/:id (detalhe)', () => {
  it('devolve o ticket, os anexos e o log', async () => {
    await semear(env, T1);
    await semearAnexo(env, T1, { nome: 'print.png' });
    const r = await chamar(env, 'GET', `/api/apoio/tickets/${T1}`);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.ticket.id).toBe(T1);
    expect(b.anexos).toHaveLength(1);
    expect(Array.isArray(b.log)).toBe(true);
  });

  it('devolve listas vazias quando não há anexos nem eventos', async () => {
    await semear(env, T1);
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.anexos).toEqual([]);
    expect(b.log).toEqual([]);
  });

  it('não expõe a chave R2 dos anexos', async () => {
    await semear(env, T1);
    await semearAnexo(env, T1);
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.anexos[0]).not.toHaveProperty('r2_key');
    expect(b.anexos[0]).toHaveProperty('transcricao');
  });

  it('mostra apenas os anexos e eventos do próprio ticket', async () => {
    await semear(env, T1);
    await semear(env, T2);
    await semearAnexo(env, T1);
    await semearAnexo(env, T2);
    await semearAnexo(env, T2);
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T2}`));
    expect(b.anexos).toHaveLength(2);
  });

  it('ordena os anexos do mais antigo para o mais recente', async () => {
    await semear(env, T1);
    await semearAnexo(env, T1, { nome: 'velho.png', created_at: '2026-01-01 08:00:00' });
    await semearAnexo(env, T1, { nome: 'novo.png', created_at: '2026-02-01 08:00:00' });
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.anexos.map((a) => a.nome)).toEqual(['velho.png', 'novo.png']);
  });

  it('mostra o evento mais recente do log em primeiro lugar', async () => {
    await semear(env, T1);
    await env.DB.prepare(`INSERT INTO ticket_log (ticket_id, evento, detalhe, created_at) VALUES (?,?,?,?)`).bind(T1, 'criado', 'a', '2026-01-01 08:00:00').run();
    await env.DB.prepare(`INSERT INTO ticket_log (ticket_id, evento, detalhe, created_at) VALUES (?,?,?,?)`).bind(T1, 'aberto', 'b', '2026-01-02 08:00:00').run();
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.log.map((l) => l.evento)).toEqual(['aberto', 'criado']);
  });

  // BUG: created_at tem resolução ao segundo e a ordenação é só por created_at.
  // Dois eventos no mesmo segundo (criar + abrir, o fluxo normal do ecrã) saem
  // pela ordem de inserção, ou seja o mais antigo aparece em primeiro lugar.
  // worker/routes/apoio.js:173
  it.fails('mostra o evento mais recente primeiro mesmo dentro do mesmo segundo', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.log[0].evento).toBe('aberto');
  });

  it('o log do detalhe traz evento, detalhe, autor e data', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't' } });
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(Object.keys(b.log[0]).sort()).toEqual(['autor', 'created_at', 'detalhe', 'evento']);
  });
});

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /api/apoio/tickets/:id (edição)', () => {
  beforeEach(async () => { await semear(env, T1, { titulo: 'Original', descricao: 'desc', status: 'aberto', urgencia: 'media' }); });

  it('edita o título e devolve o ticket atualizado', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo título' } });
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.titulo).toBe('Novo título');
  });

  it('edita vários campos de uma vez', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, {
      body: { titulo: 'A', descricao: 'B', urgencia: 'alta', resolucao: 'feito' },
    });
    expect((await json(r)).ticket).toMatchObject({ titulo: 'A', descricao: 'B', urgencia: 'alta', resolucao: 'feito' });
  });

  it('atualiza o updated_at', async () => {
    env.DB.exec(`UPDATE tickets SET updated_at = '2000-01-01 00:00:00'`);
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo' } });
    expect(env.DB.linha('SELECT updated_at FROM tickets WHERE id = ?', T1).updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('regista o evento "editado" com os campos alterados', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'A', descricao: 'B' } });
    const [l] = logs(env, T1);
    expect(l.evento).toBe('editado');
    expect(l.detalhe).toBe('titulo; descricao');
  });

  it('ignora campos não editáveis como id e created_at', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, {
      body: { id: 'AT-1900-001', created_at: '1900-01-01', updated_at: '1900-01-01', n_anexos: 99 },
    });
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.id).toBe(T1);
    expect(env.DB.linha('SELECT created_at FROM tickets WHERE id = ?', T1).created_at).not.toBe('1900-01-01');
  });

  it('PATCH sem campos válidos devolve o ticket sem tocar na base de dados', async () => {
    const antes = env.DB.linha('SELECT * FROM tickets WHERE id = ?', T1);
    const nQueries = env.DB.queries.length;
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { foo: 'bar' } });
    expect(r.status).toBe(200);
    expect((await json(r)).ticket).toMatchObject({ updated_at: antes.updated_at });
    expect(env.DB.queries.slice(nQueries).some((q) => /UPDATE tickets/i.test(q.sql))).toBe(false);
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('PATCH com corpo vazio devolve o ticket intacto', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`);
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.titulo).toBe('Original');
  });

  it('PATCH com JSON inválido devolve o ticket intacto', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: '<<<', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.titulo).toBe('Original');
  });

  it('string vazia num campo opcional passa a NULL', async () => {
    env.DB.exec(`UPDATE tickets SET resolucao = 'algo'`);
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { resolucao: '' } });
    expect(env.DB.linha('SELECT resolucao FROM tickets WHERE id = ?', T1).resolucao).toBe(null);
  });

  it('descrição vazia passa a NULL', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { descricao: '' } });
    expect(env.DB.linha('SELECT descricao FROM tickets WHERE id = ?', T1).descricao).toBe(null);
  });

  it('não regista alteração quando o valor enviado é igual ao atual', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Original' } });
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('grava mesmo assim o updated_at quando o valor é igual', async () => {
    env.DB.exec(`UPDATE tickets SET updated_at = '2000-01-01 00:00:00'`);
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Original' } });
    expect(env.DB.linha('SELECT updated_at FROM tickets WHERE id = ?', T1).updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('recusa status inválido', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: 'inventado' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Status inválido.');
  });

  it('não altera nada quando o status é inválido', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo', status: 'xpto' } });
    expect(env.DB.linha('SELECT titulo, status FROM tickets WHERE id = ?', T1)).toMatchObject({ titulo: 'Original', status: 'aberto' });
  });

  it('recusa urgência inválida', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { urgencia: 'urgentissima' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Urgência inválida.');
  });

  it('não altera nada quando a urgência é inválida', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo', urgencia: 'zzz' } });
    expect(env.DB.linha('SELECT titulo FROM tickets WHERE id = ?', T1).titulo).toBe('Original');
  });

  it('recusa urgência vazia', async () => {
    expect((await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { urgencia: '' } })).status).toBe(400);
  });

  it('recusa status vazio', async () => {
    expect((await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: '' } })).status).toBe(400);
  });

  it.each(['rascunho', 'aberto', 'em_analise', 'em_execucao', 'em_aprovacao', 'impedimento', 'resolvido', 'cancelado'])(
    'aceita o status %s', async (s) => {
      const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: s } });
      expect(r.status).toBe(200);
      expect((await json(r)).ticket.status).toBe(s);
    });

  it('mudança de status regista o evento "status" e não "editado"', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: 'resolvido' } });
    const [l] = logs(env, T1);
    expect(l.evento).toBe('status');
    expect(l.detalhe).toBe('status: aberto → resolvido');
  });

  it('mudança de status junta os outros campos no mesmo evento "status"', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo', status: 'resolvido' } });
    const [l] = logs(env, T1);
    expect(l.evento).toBe('status');
    expect(l.detalhe).toBe('titulo; status: aberto → resolvido');
  });

  it('status igual ao atual não gera evento', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: 'aberto' } });
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('mudar para "aberto" a partir de rascunho preenche data e hora', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'rascunho', data_abertura = NULL, hora_abertura = NULL`);
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: 'aberto' } });
    const { ticket } = await json(r);
    expect(ticket.data_abertura).toBe(agoraLisboa().data);
    expect(ticket.hora_abertura).toMatch(/^\d{2}:\d{2}$/);
  });

  it('não sobrescreve a data de abertura já existente', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'resolvido', data_abertura = '2020-05-05', hora_abertura = '09:30'`);
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { status: 'aberto' } });
    expect((await json(r)).ticket).toMatchObject({ data_abertura: '2020-05-05', hora_abertura: '09:30' });
  });

  it('usa o _autor do corpo como autor do evento', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo', _autor: 'Claude' } });
    expect(logs(env, T1)[0].autor).toBe('Claude');
  });

  it('sem _autor usa o nome da sessão', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo' } }, { name: 'Dra. Vyvian' });
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
  });

  it('sem _autor nem sessão usa "Victor"', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo' } });
    expect(logs(env, T1)[0].autor).toBe('Victor');
  });

  it('_autor não é gravado como campo do ticket', async () => {
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: 'Novo', _autor: 'Claude' } });
    expect(env.DB.linha('SELECT criado_por FROM tickets WHERE id = ?', T1).criado_por).toBe('Victor');
  });

  it('guarda impedimentos e resolução com quebras de linha', async () => {
    const txt = 'linha 1\nlinha 2';
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { impedimentos: txt, resolucao: txt } });
    expect((await json(r)).ticket.impedimentos).toBe(txt);
  });

  it('guarda a complexidade sem validar o valor', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { complexidade: 'astronómica' } });
    expect((await json(r)).ticket.complexidade).toBe('astronómica');
  });

  it('altera o prazo', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { data_prazo: '2026-11-30' } });
    expect((await json(r)).ticket.data_prazo).toBe('2026-11-30');
  });

  it('limpar o prazo com string vazia grava NULL', async () => {
    env.DB.exec(`UPDATE tickets SET data_prazo = '2026-01-01'`);
    await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { data_prazo: '' } });
    expect(env.DB.linha('SELECT data_prazo FROM tickets WHERE id = ?', T1).data_prazo).toBe(null);
  });

  it('PATCH de ticket inexistente devolve 404', async () => {
    expect((await chamar(env, 'PATCH', `/api/apoio/tickets/${T2}`, { body: { titulo: 'x' } })).status).toBe(404);
  });

  // CORRIGIDO (era): `titulo` é NOT NULL na tabela, mas o PATCH converte "" em NULL sem
  // validar — o UPDATE rebenta com NOT NULL constraint (500) em vez de 400.
  // worker/routes/apoio.js:201
  it('recusa apagar o título com string vazia', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { titulo: '' } });
    expect(r.status).toBe(400);
  });

  // CORRIGIDO (era): mesmo problema em `criado_por` (NOT NULL).
  // worker/routes/apoio.js:201
  it('recusa apagar o criado_por com string vazia', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: { criado_por: '' } });
    expect(r.status).toBe(400);
  });

  // CORRIGIDO (era): corpo literal "null" faz `c in body` rebentar com TypeError (500).
  // worker/routes/apoio.js:180-185
  it('trata o corpo literal null sem rebentar', async () => {
    const r = await chamar(env, 'PATCH', `/api/apoio/tickets/${T1}`, { body: 'null', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(200);
  });
});

// ─── abrir ───────────────────────────────────────────────────────────────────

describe('POST /api/apoio/tickets/:id/abrir', () => {
  it('passa o rascunho a aberto com data e hora', async () => {
    await semear(env, T1, { status: 'rascunho' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    expect(r.status).toBe(200);
    const { ticket } = await json(r);
    expect(ticket.status).toBe('aberto');
    expect(ticket.data_abertura).toBe(agoraLisboa().data);
    expect(ticket.hora_abertura).toMatch(/^\d{2}:\d{2}$/);
  });

  it('regista o evento "aberto" no log', async () => {
    await semear(env, T1, { status: 'rascunho' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    const [l] = logs(env, T1);
    expect(l.evento).toBe('aberto');
    expect(l.detalhe).toMatch(/^Ticket aberto às \d{2}:\d{2}$/);
  });

  it('usa o autor da sessão no log', async () => {
    await semear(env, T1, { status: 'rascunho' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`, {}, { name: 'Dra. Vyvian' });
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
  });

  it('abrir duas vezes não sobrescreve a data e a hora originais (COALESCE)', async () => {
    await semear(env, T1, { status: 'rascunho', data_abertura: '2020-01-02', hora_abertura: '07:07' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    expect((await json(r)).ticket).toMatchObject({ data_abertura: '2020-01-02', hora_abertura: '07:07' });
  });

  it('abrir duas vezes regista dois eventos', async () => {
    await semear(env, T1, { status: 'rascunho' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    expect(logs(env, T1)).toHaveLength(2);
  });

  it('atualiza o updated_at', async () => {
    await semear(env, T1, { status: 'rascunho' });
    env.DB.exec(`UPDATE tickets SET updated_at = '2000-01-01 00:00:00'`);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    expect(env.DB.linha('SELECT updated_at FROM tickets WHERE id = ?', T1).updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('reabre um ticket resolvido (a rota não valida o estado de origem)', async () => {
    await semear(env, T1, { status: 'resolvido' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    expect((await json(r)).ticket.status).toBe('aberto');
  });

  it('GET em /abrir cai em 404', async () => {
    await semear(env, T1);
    expect((await chamar(env, 'GET', `/api/apoio/tickets/${T1}/abrir`)).status).toBe(404);
  });

  it('abrir ticket inexistente devolve 404', async () => {
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`)).status).toBe(404);
  });
});

// ─── executar ────────────────────────────────────────────────────────────────

describe('POST /api/apoio/tickets/:id/executar', () => {
  it('põe o ticket em execução', async () => {
    await semear(env, T1, { status: 'aberto' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.status).toBe('em_execucao');
  });

  it('regista o evento "execucao" com instruções legíveis e o ID do ticket', async () => {
    await semear(env, T1, { status: 'aberto' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    const [l] = logs(env, T1);
    expect(l.evento).toBe('execucao');
    expect(l.detalhe).toContain(`«resolver ticket ${T1}»`);
    expect(l.detalhe).toContain('Impedimento');
  });

  it('recusa executar um ticket resolvido', async () => {
    await semear(env, T1, { status: 'resolvido' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Ticket já fechado.');
  });

  it('recusa executar um ticket cancelado', async () => {
    await semear(env, T1, { status: 'cancelado' });
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`)).status).toBe(400);
  });

  it('ticket fechado não muda de estado nem gera log', async () => {
    await semear(env, T1, { status: 'resolvido' });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    expect(env.DB.linha('SELECT status FROM tickets WHERE id = ?', T1).status).toBe('resolvido');
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('deixa executar a partir de rascunho (a rota só barra fechados)', async () => {
    await semear(env, T1, { status: 'rascunho' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    expect((await json(r)).ticket.status).toBe('em_execucao');
  });

  it('deixa executar a partir de impedimento', async () => {
    await semear(env, T1, { status: 'impedimento' });
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    expect((await json(r)).ticket.status).toBe('em_execucao');
  });

  it('usa o autor da sessão no log', async () => {
    await semear(env, T1);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`, {}, { name: 'Dra. Vyvian' });
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
  });

  it('GET em /executar cai em 404', async () => {
    await semear(env, T1);
    expect((await chamar(env, 'GET', `/api/apoio/tickets/${T1}/executar`)).status).toBe(404);
  });
});

// ─── analisar (Gemini) ───────────────────────────────────────────────────────

describe('POST /api/apoio/tickets/:id/analisar', () => {
  beforeEach(async () => { await semear(env, T1, { titulo: 'Recibo rebenta', descricao: 'ao carregar', urgencia: 'alta' }); });

  it('guarda complexidade, justificação e plano devolvidos pela IA', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'alta', justificacao: 'toca no PDF', plano: '1. x\n2. y' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(200);
    expect((await json(r)).ticket).toMatchObject({
      complexidade: 'alta', complexidade_justificacao: 'toca no PDF', plano_ia: '1. x\n2. y',
    });
  });

  it('regista o evento analise_ia com autor "IA"', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'baixa', justificacao: 'j', plano: 'p' })));
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    const [l] = logs(env, T1);
    expect(l).toMatchObject({ evento: 'analise_ia', detalhe: 'Complexidade: baixa', autor: 'IA' });
  });

  it('envia o título, a urgência e a descrição no prompt', async () => {
    const f = mockFetch(geminiJson({ complexidade: 'media', justificacao: 'j', plano: 'p' }));
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    const enviado = JSON.parse(f.chamadas[0].init.body).contents[0].parts[0].text;
    expect(enviado).toContain('Recibo rebenta');
    expect(enviado).toContain('Urgência: alta');
    expect(enviado).toContain('ao carregar');
  });

  it('usa a chave Gemini no cabeçalho', async () => {
    const f = mockFetch(geminiJson({ complexidade: 'media' }));
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(f.chamadas[0].init.headers['x-goog-api-key']).toBe('chave-gemini-de-teste');
    expect(f.chamadas[0].url).toContain('generativelanguage.googleapis.com');
  });

  it('escreve "(sem descrição)" no prompt quando não há descrição', async () => {
    env.DB.exec(`UPDATE tickets SET descricao = ''`);
    const f = mockFetch(geminiJson({ complexidade: 'baixa' }));
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(JSON.parse(f.chamadas[0].init.body).contents[0].parts[0].text).toContain('(sem descrição)');
  });

  it('devolve 503 sem GEMINI_API_KEY', async () => {
    const e = criarEnv({ GEMINI_API_KEY: '' });
    await semear(e, T1);
    const r = await chamar(e, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(503);
    expect((await json(r)).error).toBe('Serviço de IA não configurado.');
  });

  it('devolve 503 quando a chave Gemini nem sequer está definida', async () => {
    const e = criarEnv({ GEMINI_API_KEY: undefined });
    await semear(e, T1);
    expect((await chamar(e, 'POST', `/api/apoio/tickets/${T1}/analisar`)).status).toBe(503);
  });

  it('não chama a API quando não há chave', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    const e = criarEnv({ GEMINI_API_KEY: '' });
    await semear(e, T1);
    await chamar(e, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(f.chamadas).toHaveLength(0);
  });

  it('devolve 502 quando a Gemini responde com erro', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, texto: 'internal error' }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(502);
    expect((await json(r)).error).toContain('API Gemini: 500');
    expect((await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`))).ticket.complexidade).toBe(null);
  });

  it('trunca o corpo do erro da Gemini a 200 caracteres', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 400, texto: 'x'.repeat(500) }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).error.length).toBeLessThan(230);
  });

  it('devolve 502 quando a resposta não é JSON interpretável', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: [{ text: 'desculpe, não consigo' }] } }] } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(502);
    expect((await json(r)).error).toBe('Resposta da IA não pôde ser interpretada.');
  });

  it('devolve 502 quando a Gemini devolve candidates vazio', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [] } }));
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`)).status).toBe(502);
  });

  it('devolve 502 quando a resposta não traz candidates', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`)).status).toBe(502);
  });

  it('aceita JSON embrulhado em ```json', async () => {
    const bruto = '```json\n{"complexidade":"media","justificacao":"j","plano":"p"}\n```';
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: [{ text: bruto }] } }] } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.complexidade).toBe('media');
  });

  it('aceita JSON embrulhado em ``` sem a etiqueta json', async () => {
    const bruto = '```\n{"complexidade":"baixa"}\n```';
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: [{ text: bruto }] } }] } }));
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`)).status).toBe(200);
  });

  it('junta as várias partes da resposta antes de interpretar', async () => {
    const partes = [{ text: '{"complexidade":"alta",' }, { text: '"plano":"p"}' }];
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: partes } }] } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.complexidade).toBe('alta');
  });

  it('normaliza um plano devolvido como array para texto com quebras de linha', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'media', plano: ['1. um', '2. dois'] })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.plano_ia).toBe('1. um\n2. dois');
  });

  it('normaliza uma justificação devolvida como array', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'media', justificacao: ['a', 'b'] })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.complexidade_justificacao).toBe('a\nb');
  });

  it('serializa um plano devolvido como objeto', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'media', plano: { passo1: 'x' } })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.plano_ia).toBe('{"passo1":"x"}');
  });

  it('passa a complexidade a minúsculas', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'ALTA', justificacao: 'j', plano: 'p' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.complexidade).toBe('alta');
  });

  it('guarda NULL quando a complexidade não é texto', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 3, plano: 'p' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.complexidade).toBe(null);
  });

  it('guarda NULL nos campos em falta', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'baixa' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket).toMatchObject({ complexidade_justificacao: null, plano_ia: null });
  });

  it('substitui uma análise anterior', async () => {
    env.DB.exec(`UPDATE tickets SET complexidade = 'baixa', plano_ia = 'antigo'`);
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'alta', plano: 'novo' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket).toMatchObject({ complexidade: 'alta', plano_ia: 'novo' });
  });

  it('não altera o status do ticket', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson({ complexidade: 'alta' })));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect((await json(r)).ticket.status).toBe('aberto');
  });

  // CORRIGIDO (era): se o modelo devolver JSON válido que não é um objeto (ex.: uma string
  // ou null), `out.plano = ...` rebenta com TypeError em vez de 502.
  // worker/routes/apoio.js:254-258
  it('devolve 502 quando a IA devolve uma string JSON em vez de um objeto', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: [{ text: '"não sei"' }] } }] } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(502);
  });

  // CORRIGIDO (era): idem para o literal null.
  // worker/routes/apoio.js:254-258
  it('devolve 502 quando a IA devolve null', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ content: { parts: [{ text: 'null' }] } }] } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/analisar`);
    expect(r.status).toBe(502);
  });

  it('analisar ticket inexistente devolve 404 sem chamar a IA', async () => {
    const f = mockFetch(geminiJson({ complexidade: 'alta' }));
    vi.stubGlobal('fetch', f);
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T2}/analisar`)).status).toBe(404);
    expect(f.chamadas).toHaveLength(0);
  });
});

// ─── aprovar ─────────────────────────────────────────────────────────────────

describe('POST /api/apoio/tickets/:id/aprovar', () => {
  beforeEach(async () => {
    await semear(env, T1, {
      titulo: 'Recibo corrigido', descricao: 'O PDF já sai certo.', status: 'em_execucao',
      urgencia: 'alta', resolucao: 'Corrigido o cálculo do IVA.',
    });
  });

  it('envia o e-mail e passa o ticket a em_aprovacao', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'msg-1' } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(200);
    expect((await json(r)).ticket.status).toBe('em_aprovacao');
  });

  it('regista o evento "aprovacao" com o destinatário', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const [l] = logs(env, T1);
    expect(l.evento).toBe('aprovacao');
    expect(l.detalhe).toContain('vyavena@gmail.com');
  });

  it('prefere o contacto de owner_alert_contacts ao ADMIN_EMAIL', async () => {
    env.DB.exec(`UPDATE owner_alert_contacts SET email = 'dra.alertas@exemplo.pt' WHERE id = 1`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).to).toEqual(['dra.alertas@exemplo.pt']);
  });

  it('cai no ADMIN_EMAIL quando o contacto está vazio', async () => {
    env.DB.exec(`UPDATE owner_alert_contacts SET email = NULL WHERE id = 1`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).to).toEqual(['dra@exemplo.pt']);
  });

  it('cai no ADMIN_EMAIL quando não há linha de contactos', async () => {
    env.DB.exec(`DELETE FROM owner_alert_contacts`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).to).toEqual(['dra@exemplo.pt']);
  });

  it('devolve 503 quando não há e-mail nenhum configurado', async () => {
    const e = criarEnv({ ADMIN_EMAIL: '' });
    e.DB.exec(`UPDATE owner_alert_contacts SET email = NULL WHERE id = 1`);
    await semear(e, T1, { status: 'aberto' });
    const r = await chamar(e, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(503);
    expect((await json(r)).error).toContain('Sem e-mail da Dra. configurado');
  });

  it('recusa aprovar um rascunho', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'rascunho'`);
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Abra o ticket antes de o enviar para aprovação.');
  });

  it('recusa aprovar um ticket cancelado', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'cancelado'`);
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`)).status).toBe(400);
  });

  it('não envia e-mail quando o ticket é rascunho', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'rascunho'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(f.chamadas).toHaveLength(0);
  });

  it('deixa aprovar a partir de resolvido', async () => {
    env.DB.exec(`UPDATE tickets SET status = 'resolvido'`);
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(200);
  });

  it('devolve 502 e NÃO muda o status quando o envio falha', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 422, json: { message: 'domínio não verificado' } }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(502);
    expect((await json(r)).error).toContain('domínio não verificado');
    expect(env.DB.linha('SELECT status FROM tickets WHERE id = ?', T1).status).toBe('em_execucao');
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('devolve 502 quando o fetch para o Resend rebenta', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'rede em baixo' }));
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(502);
    expect(env.DB.linha('SELECT status FROM tickets WHERE id = ?', T1).status).toBe('em_execucao');
  });

  it('devolve 502 quando falta a RESEND_API_KEY (envio saltado)', async () => {
    const e = criarEnv({ RESEND_API_KEY: '' });
    await semear(e, T1, { status: 'aberto' });
    const r = await chamar(e, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(502);
    expect((await json(r)).error).toContain('RESEND_API_KEY');
    expect(e.DB.linha('SELECT status FROM tickets WHERE id = ?', T1).status).toBe('aberto');
  });

  it('o assunto traz o ID e o título', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).subject).toBe(`Ticket ${T1} para aprovação — Recibo corrigido`);
  });

  it('o corpo traz a descrição, a resolução e a urgência por extenso', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const { html, text } = corpoResend(f);
    expect(html).toContain('O PDF já sai certo.');
    expect(html).toContain('Corrigido o cálculo do IVA.');
    expect(html).toContain('Urgência: <strong>Alta</strong>');
    expect(text).toContain('COMO FOI EFETUADA A RESOLUÇÃO');
  });

  it('omite as secções sem conteúdo', async () => {
    env.DB.exec(`UPDATE tickets SET descricao = '', resolucao = NULL, impedimentos = NULL`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const { html, text } = corpoResend(f);
    expect(html).not.toContain('Descrição');
    expect(html).not.toContain('Impedimentos');
    expect(text).not.toContain('IMPEDIMENTOS');
  });

  it('inclui os impedimentos quando existem', async () => {
    env.DB.exec(`UPDATE tickets SET impedimentos = 'falta acesso ao R2'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('falta acesso ao R2');
  });

  it('junta complexidade e plano na secção de análise da IA', async () => {
    env.DB.exec(`UPDATE tickets SET complexidade = 'alta', complexidade_justificacao = 'toca no PDF', plano_ia = '1. corrigir'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const { html } = corpoResend(f);
    expect(html).toContain('Complexidade alta — toca no PDF');
    expect(html).toContain('1. corrigir');
  });

  it('mostra a complexidade sem justificação quando não há justificação', async () => {
    env.DB.exec(`UPDATE tickets SET complexidade = 'baixa', complexidade_justificacao = NULL, plano_ia = NULL`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('Complexidade baixa</p>');
  });

  it('converte o prazo de YYYY-MM-DD para DD/MM/AAAA', async () => {
    env.DB.exec(`UPDATE tickets SET data_prazo = '2026-12-25'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('Prazo: <strong>25/12/2026</strong>');
  });

  it('não menciona prazo quando não há', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).not.toContain('Prazo:');
  });

  it('traduz a urgência para o rótulo em português', async () => {
    for (const [u, label] of [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta'], ['critica', 'Crítica']]) {
      const e = criarEnv();
      await semear(e, T1, { status: 'aberto', urgencia: u });
      const f = mockFetch({ json: {} });
      vi.stubGlobal('fetch', f);
      await chamar(e, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
      expect(corpoResend(f).html).toContain(`Urgência: <strong>${label}</strong>`);
    }
  });

  it('usa "Média" quando a urgência guardada é desconhecida', async () => {
    env.DB.exec(`UPDATE tickets SET urgencia = 'zzz'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('Urgência: <strong>Média</strong>');
  });

  it('escapa HTML no título e na descrição', async () => {
    env.DB.exec(`UPDATE tickets SET titulo = '<script>alert(1)</script> & cia', descricao = 'a < b & c > d'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const { html } = corpoResend(f);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; cia');
    expect(html).not.toContain('<script>');
    expect(html).toContain('a &lt; b &amp; c &gt; d');
  });

  it('converte as quebras de linha da descrição em <br>', async () => {
    env.DB.exec(`UPDATE tickets SET descricao = 'linha 1\nlinha 2'`);
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('linha 1<br>linha 2');
  });

  it('anexa os prints de conclusão', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao', nome: 'antes.png', bytes: new Uint8Array([1, 2, 3, 4]) });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    const { attachments } = corpoResend(f);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('antes.png');
    expect(attachments[0].content).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
  });

  it('só anexa prints de conclusão (ignora anexos, prints de abertura e áudio)', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao', nome: 'ok.png' });
    await semearAnexo(env, T1, { tipo: 'print_abertura', nome: 'nao.png' });
    await semearAnexo(env, T1, { tipo: 'anexo', nome: 'doc.pdf' });
    await semearAnexo(env, T1, { tipo: 'audio', nome: 'voz.webm' });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).attachments.map((a) => a.filename)).toEqual(['ok.png']);
  });

  it('ignora prints de outros tickets', async () => {
    await semear(env, T2, { status: 'aberto' });
    await semearAnexo(env, T2, { tipo: 'print_conclusao', nome: 'outro.png' });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).attachments).toBeUndefined();
  });

  it('salta prints cujo objeto desapareceu do R2', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao', nome: 'existe.png' });
    await semearAnexo(env, T1, { tipo: 'print_conclusao', nome: 'fantasma.png', semObjeto: true });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(r.status).toBe(200);
    expect(corpoResend(f).attachments.map((a) => a.filename)).toEqual(['existe.png']);
  });

  it('usa "print" no singular com um print', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao' });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('1 print de evidência');
    expect(logs(env, T1)[0].detalhe).toContain('1 print de evidência');
  });

  it('usa "prints" no plural com dois prints', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao' });
    await semearAnexo(env, T1, { tipo: 'print_conclusao' });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain('2 prints de evidência');
    expect(logs(env, T1)[0].detalhe).toContain('2 prints de evidência');
  });

  it('não fala de prints quando não há nenhum', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).not.toContain('evidência');
    expect(logs(env, T1)[0].detalhe).not.toContain('evidência');
  });

  it('usa o nome por omissão quando o print não tem nome', async () => {
    await semearAnexo(env, T1, { tipo: 'print_conclusao', nome: null });
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).attachments[0].filename).toBe('print.png');
  });

  it('o rodapé remete para o ticket na Área Privada', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/aprovar`);
    expect(corpoResend(f).html).toContain(`Apoio Técnico → ${T1}`);
  });

  it('aprovar ticket inexistente devolve 404 sem enviar e-mail', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T2}/aprovar`)).status).toBe(404);
    expect(f.chamadas).toHaveLength(0);
  });

  it('GET em /aprovar cai em 404', async () => {
    expect((await chamar(env, 'GET', `/api/apoio/tickets/${T1}/aprovar`)).status).toBe(404);
  });
});

// ─── upload de anexos ────────────────────────────────────────────────────────

describe('POST /api/apoio/tickets/:id/anexos (upload)', () => {
  beforeEach(async () => { await semear(env, T1); });

  const bytes = (n, v = 65) => new Uint8Array(n).fill(v);

  it('grava o ficheiro no R2 e a linha na base de dados', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=anexo&nome=doc.pdf`, {
      binario: bytes(10), headers: { 'Content-Type': 'application/pdf' },
    });
    expect(r.status).toBe(201);
    const { anexo } = await json(r);
    expect(anexo).toMatchObject({ ticket_id: T1, tipo: 'anexo', nome: 'doc.pdf', content_type: 'application/pdf', size: 10 });
    expect(env.RECIBOS.store.has(anexo.r2_key)).toBe(true);
  });

  it('guarda os bytes exatos no R2', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.bin`, { binario: new Uint8Array([9, 8, 7]) });
    const { anexo } = await json(r);
    expect([...env.RECIBOS.store.get(anexo.r2_key).bytes]).toEqual([9, 8, 7]);
  });

  it('guarda o content-type também no R2', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`, {
      binario: bytes(4), headers: { 'Content-Type': 'image/png' },
    });
    const { anexo } = await json(r);
    expect(env.RECIBOS.store.get(anexo.r2_key).contentType).toBe('image/png');
  });

  it('a chave R2 fica sob apoio/<ticket>/', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`, { binario: bytes(4) });
    expect((await json(r)).anexo.r2_key).toMatch(new RegExp(`^apoio/${T1}/\\d+-[0-9a-f]{8}-a\\.png$`));
  });

  it('usa application/octet-stream quando não há Content-Type útil', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.bin`, { binario: bytes(4) });
    expect((await json(r)).anexo.content_type).toBe('application/octet-stream');
  });

  it('regista o evento "anexo" com o tipo, o nome e o tamanho em KB', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=print_abertura&nome=erro.png`, { binario: bytes(2048) });
    const [l] = logs(env, T1);
    expect(l.evento).toBe('anexo');
    expect(l.detalhe).toBe('print_abertura: erro.png (2 KB)');
  });

  it('arredonda o tamanho para 0 KB em ficheiros minúsculos', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.txt`, { binario: bytes(10) });
    expect(logs(env, T1)[0].detalhe).toContain('(0 KB)');
  });

  it.each(['anexo', 'print_abertura', 'print_conclusao', 'audio'])('aceita o tipo %s', async (tipo) => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=${tipo}&nome=f.bin`, { binario: bytes(4) });
    expect(r.status).toBe(201);
    expect((await json(r)).anexo.tipo).toBe(tipo);
  });

  it('recusa tipo de anexo inválido', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=video&nome=f.bin`, { binario: bytes(4) });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Tipo de anexo inválido.');
  });

  it('recusa tipo inválido antes de ler o corpo (nada vai para o R2)', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=exe`, { binario: bytes(4) });
    expect(env.RECIBOS.store.size).toBe(0);
    expect(env.DB.conta('ticket_anexos')).toBe(0);
  });

  it('sem tipo assume "anexo"', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=f.bin`, { binario: bytes(4) });
    expect((await json(r)).anexo.tipo).toBe('anexo');
  });

  it('tipo vazio assume "anexo"', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=&nome=f.bin`, { binario: bytes(4) });
    expect((await json(r)).anexo.tipo).toBe('anexo');
  });

  it('sem nome usa gravacao.webm para áudio', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=audio`, { binario: bytes(4) });
    expect((await json(r)).anexo.nome).toBe('gravacao.webm');
  });

  it('sem nome usa print.png para prints', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?tipo=print_conclusao`, { binario: bytes(4) });
    expect((await json(r)).anexo.nome).toBe('print.png');
  });

  it('sem nome usa "anexo" para o tipo genérico', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos`, { binario: bytes(4) });
    expect((await json(r)).anexo.nome).toBe('anexo');
  });

  it('recusa ficheiro vazio', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`, { binario: new Uint8Array(0) });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Ficheiro vazio.');
  });

  it('recusa pedido sem corpo nenhum', async () => {
    expect((await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`)).status).toBe(400);
  });

  it('não grava nada quando o ficheiro é vazio', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`, { binario: new Uint8Array(0) });
    expect(env.RECIBOS.store.size).toBe(0);
    expect(env.DB.conta('ticket_anexos')).toBe(0);
  });

  it('aceita um ficheiro exatamente no limite de 20 MB', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=grande.bin`, { binario: new Uint8Array(20 * 1024 * 1024) });
    expect(r.status).toBe(201);
    expect((await json(r)).anexo.size).toBe(20 * 1024 * 1024);
  });

  it('recusa um ficheiro 1 byte acima dos 20 MB', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=grande.bin`, { binario: new Uint8Array(20 * 1024 * 1024 + 1) });
    expect(r.status).toBe(413);
    expect((await json(r)).error).toBe('Ficheiro demasiado grande (máx. 20 MB).');
  });

  it('nada é gravado quando o ficheiro excede o limite', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=g.bin`, { binario: new Uint8Array(20 * 1024 * 1024 + 1) });
    expect(env.DB.conta('ticket_anexos')).toBe(0);
    expect(env.RECIBOS.store.size).toBe(0);
  });

  it('sanitiza acentos e espaços na chave R2 mas guarda o nome original', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=${encodeURIComponent('relatório final.pdf')}`, { binario: bytes(4) });
    const { anexo } = await json(r);
    expect(anexo.nome).toBe('relatório final.pdf');
    expect(anexo.r2_key).toMatch(/relat_rio_final\.pdf$/);
  });

  it('neutraliza travessias de diretório na chave R2', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=${encodeURIComponent('../../etc/passwd')}`, { binario: bytes(4) });
    const { anexo } = await json(r);
    expect(anexo.r2_key).toMatch(new RegExp(`^apoio/${T1}/\\d+-[0-9a-f]{8}-\\.\\._\\.\\._etc_passwd$`));
    expect(anexo.r2_key).not.toContain('/etc/');
  });

  it('remove aspas e sinais estranhos da chave R2', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=${encodeURIComponent('re"cibo\'; DROP TABLE.pdf')}`, { binario: bytes(4) });
    const chave = (await json(r)).anexo.r2_key.split('-').pop();
    expect(chave).toMatch(/^[\w.\-]+$/);
  });

  it('corta o nome sanitizado aos 80 caracteres', async () => {
    const nome = 'a'.repeat(200) + '.pdf';
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=${nome}`, { binario: bytes(4) });
    const { anexo } = await json(r);
    expect(anexo.nome).toHaveLength(204);
    expect(anexo.r2_key.split('/').pop().split('-').slice(2).join('-')).toHaveLength(80);
  });

  it('mantém pontos, hífens e underscores no nome sanitizado', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=um_nome-com.pontos.png`, { binario: bytes(4) });
    expect((await json(r)).anexo.r2_key).toMatch(/um_nome-com\.pontos\.png$/);
  });

  it('reduz uma sequência de caracteres inválidos a um único underscore', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=${encodeURIComponent('a   @@@ b.png')}`, { binario: bytes(4) });
    expect((await json(r)).anexo.r2_key).toMatch(/a_b\.png$/);
  });

  it('upload para ticket inexistente devolve 404', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T2}/anexos?nome=a.png`, { binario: bytes(4) });
    expect(r.status).toBe(404);
    expect(env.RECIBOS.store.size).toBe(0);
  });

  it('GET em /anexos cai em 404', async () => {
    expect((await chamar(env, 'GET', `/api/apoio/tickets/${T1}/anexos`)).status).toBe(404);
  });

  it('propaga a falha do R2 (o put não é silenciado)', async () => {
    env.RECIBOS.falhaNoPut = 'R2 em baixo';
    await expect(chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=a.png`, { binario: bytes(4) })).rejects.toThrow('R2 em baixo');
    expect(env.DB.conta('ticket_anexos')).toBe(0);
  });

  // CORRIGIDO (era): decodeURIComponent sem try/catch — um `nome` com uma sequência de
  // percentagem inválida (ex.: 100%25.pdf mal codificado, «%zz») rebenta com
  // URIError e devolve 500 em vez de 400.
  // worker/routes/apoio.js:368
  it('não rebenta com um nome de ficheiro com percentagem inválida', async () => {
    const r = await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=100%zz.pdf`, { binario: bytes(4) });
    expect(r.status).toBe(201);
  });

  // CORRIGIDO (era): a chave R2 é `Date.now()-nome`; dois uploads do mesmo nome no mesmo
  // milissegundo geram a mesma chave, o segundo sobrepõe o primeiro no R2 e as
  // duas linhas passam a apontar para o mesmo objeto (apagar uma apaga as duas).
  // worker/routes/apoio.js:375
  it('gera chaves R2 distintas para dois uploads no mesmo milissegundo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00Z'));
    const a = (await json(await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=p.png`, { binario: bytes(4, 1) }))).anexo;
    const b = (await json(await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=p.png`, { binario: bytes(4, 2) }))).anexo;
    expect(a.r2_key).not.toBe(b.r2_key);
  });
});

// ─── servir / apagar / transcrever anexo ─────────────────────────────────────

describe('GET /api/apoio/anexos/:id (descarregar)', () => {
  beforeEach(async () => { await semear(env, T1); });

  it('devolve o ficheiro com o content-type guardado', async () => {
    const a = await semearAnexo(env, T1, { nome: 'foto.png', ct: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('serve com Content-Disposition inline e o nome do ficheiro', async () => {
    const a = await semearAnexo(env, T1, { nome: 'foto.png' });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.headers.get('Content-Disposition')).toBe('inline; filename="foto.png"');
  });

  it('remove as aspas do nome no Content-Disposition', async () => {
    const a = await semearAnexo(env, T1, { nome: 're"cibo".png' });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.headers.get('Content-Disposition')).toBe('inline; filename="recibo.png"');
  });

  it('usa "anexo" quando o nome está vazio', async () => {
    const a = await semearAnexo(env, T1, { nome: null });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.headers.get('Content-Disposition')).toBe('inline; filename="anexo"');
  });

  it('usa application/octet-stream quando não há content-type guardado', async () => {
    const a = await semearAnexo(env, T1, { ct: null });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('marca a cache como privada', async () => {
    const a = await semearAnexo(env, T1);
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=300');
  });

  it('devolve 404 quando o objeto desapareceu do R2', async () => {
    const a = await semearAnexo(env, T1, { semObjeto: true });
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${a.id}`);
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe('Ficheiro não encontrado no armazenamento.');
  });

  it('serve corretamente um anexo enviado pela própria API', async () => {
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/anexos?nome=p.png`, {
      binario: new Uint8Array([5, 6]), headers: { 'Content-Type': 'image/png' },
    });
    const id = env.DB.linha('SELECT id FROM ticket_anexos').id;
    const r = await chamar(env, 'GET', `/api/apoio/anexos/${id}`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([5, 6]));
  });
});

describe('DELETE /api/apoio/anexos/:id', () => {
  beforeEach(async () => { await semear(env, T1); });

  it('apaga o anexo do R2 e da base de dados', async () => {
    const a = await semearAnexo(env, T1, { nome: 'x.png' });
    const r = await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true });
    expect(env.DB.conta('ticket_anexos')).toBe(0);
    expect(env.RECIBOS.store.size).toBe(0);
  });

  it('regista a remoção no log com o nome do ficheiro', async () => {
    const a = await semearAnexo(env, T1, { nome: 'x.png' });
    await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    const [l] = logs(env, T1);
    expect(l).toMatchObject({ evento: 'anexo', detalhe: 'Removido: x.png', autor: 'Victor' });
  });

  it('usa a chave R2 no log quando o anexo não tem nome', async () => {
    const a = await semearAnexo(env, T1, { nome: null });
    await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    expect(logs(env, T1)[0].detalhe).toBe(`Removido: ${a.r2_key}`);
  });

  it('regista o autor da sessão', async () => {
    const a = await semearAnexo(env, T1);
    await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`, {}, { name: 'Dra. Vyvian' });
    expect(logs(env, T1)[0].autor).toBe('Dra. Vyvian');
  });

  it('não toca nos outros anexos do ticket', async () => {
    const a = await semearAnexo(env, T1, { nome: 'a.png' });
    await semearAnexo(env, T1, { nome: 'b.png' });
    await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    expect(env.DB.conta('ticket_anexos')).toBe(1);
    expect(env.RECIBOS.store.size).toBe(1);
  });

  it('apaga a linha mesmo quando o objeto já não existe no R2', async () => {
    const a = await semearAnexo(env, T1, { semObjeto: true });
    const r = await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    expect(r.status).toBe(200);
    expect(env.DB.conta('ticket_anexos')).toBe(0);
  });

  it('apagar duas vezes devolve 404 à segunda', async () => {
    const a = await semearAnexo(env, T1);
    await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`);
    expect((await chamar(env, 'DELETE', `/api/apoio/anexos/${a.id}`)).status).toBe(404);
  });

  it('apagar o ticket leva os anexos e o log atrás (ON DELETE CASCADE)', async () => {
    await semearAnexo(env, T1);
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/abrir`);
    env.DB.exec(`DELETE FROM tickets WHERE id = '${T1}'`);
    expect(env.DB.conta('ticket_anexos')).toBe(0);
    expect(env.DB.conta('ticket_log')).toBe(0);
  });
});

describe('PATCH /api/apoio/anexos/:id (transcrição)', () => {
  beforeEach(async () => { await semear(env, T1); });

  it('guarda a transcrição do áudio', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio', nome: 'voz.webm' });
    const r = await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: 'olá doutora' } });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true });
    expect(env.DB.linha('SELECT transcricao FROM ticket_anexos WHERE id = ?', a.id).transcricao).toBe('olá doutora');
  });

  it('substitui uma transcrição anterior', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio', transcricao: 'antiga' });
    await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: 'nova' } });
    expect(env.DB.linha('SELECT transcricao FROM ticket_anexos WHERE id = ?', a.id).transcricao).toBe('nova');
  });

  it('aceita transcrição vazia (limpar)', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio', transcricao: 'antiga' });
    const r = await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: '' } });
    expect(r.status).toBe(200);
    expect(env.DB.linha('SELECT transcricao FROM ticket_anexos WHERE id = ?', a.id).transcricao).toBe('');
  });

  it('recusa pedido sem o campo transcricao', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    const r = await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { outro: 'x' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Campo transcricao em falta.');
  });

  it('recusa transcrição que não é texto', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    const r = await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: 42 } });
    expect(r.status).toBe(400);
  });

  it('recusa transcrição nula', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    expect((await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: null } })).status).toBe(400);
  });

  it('recusa corpo JSON inválido', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    const r = await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: '{{{', headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(400);
  });

  it('recusa corpo vazio', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    expect((await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`)).status).toBe(400);
  });

  it('não regista evento no log ao transcrever', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'audio' });
    await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: 'x' } });
    expect(env.DB.conta('ticket_log')).toBe(0);
  });

  it('deixa transcrever um anexo que não é áudio (sem validação de tipo)', async () => {
    const a = await semearAnexo(env, T1, { tipo: 'anexo' });
    expect((await chamar(env, 'PATCH', `/api/apoio/anexos/${a.id}`, { body: { transcricao: 'x' } })).status).toBe(200);
  });

  it('PATCH de anexo inexistente devolve 404', async () => {
    expect((await chamar(env, 'PATCH', '/api/apoio/anexos/999', { body: { transcricao: 'x' } })).status).toBe(404);
  });
});

// ─── transcrever ─────────────────────────────────────────────────────────────

describe('POST /api/apoio/transcrever', () => {
  it('devolve o texto transcrito pelo Whisper', async () => {
    env.AI = new FakeAI({ text: 'bom dia doutora' });
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1, 2, 3]) });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true, text: 'bom dia doutora' });
  });

  it('apara espaços e quebras de linha da transcrição', async () => {
    env.AI = new FakeAI({ text: '  \n olá  \n ' });
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect((await json(r)).text).toBe('olá');
  });

  it('devolve texto vazio quando o modelo não devolve nada', async () => {
    env.AI = new FakeAI({});
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect((await json(r)).text).toBe('');
  });

  it('devolve texto vazio quando o modelo devolve null', async () => {
    env.AI = new FakeAI(null);
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect((await json(r)).text).toBe('');
  });

  it('usa o modelo whisper-large-v3-turbo em português', async () => {
    const ai = new FakeAI({ text: 'x' });
    env.AI = ai;
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1, 2]) });
    expect(ai.chamadas[0].modelo).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(ai.chamadas[0].args.language).toBe('pt');
  });

  it('envia o áudio em base64', async () => {
    const ai = new FakeAI({ text: 'x' });
    env.AI = ai;
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1, 2, 3]) });
    expect(ai.chamadas[0].args.audio).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('codifica corretamente áudio com bytes acima de 127', async () => {
    const ai = new FakeAI({ text: 'x' });
    env.AI = ai;
    const dados = new Uint8Array([0, 127, 128, 255]);
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: dados });
    expect(ai.chamadas[0].args.audio).toBe(Buffer.from(dados).toString('base64'));
  });

  it('codifica áudio maior do que o bloco de 32 KB', async () => {
    const ai = new FakeAI({ text: 'x' });
    env.AI = ai;
    const dados = new Uint8Array(0x8000 * 2 + 5).fill(7);
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: dados });
    expect(ai.chamadas[0].args.audio).toBe(Buffer.from(dados).toString('base64'));
  });

  it('devolve 503 sem o binding AI', async () => {
    const e = criarEnv({ AI: undefined });
    const r = await chamar(e, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect(r.status).toBe(503);
    expect((await json(r)).error).toContain('Workers AI indisponível');
  });

  it('recusa áudio vazio', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array(0) });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Áudio vazio.');
  });

  it('recusa pedido sem corpo', async () => {
    expect((await chamar(env, 'POST', '/api/apoio/transcrever')).status).toBe(400);
  });

  it('não chama a IA com áudio vazio', async () => {
    const ai = new FakeAI({ text: 'x' });
    env.AI = ai;
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array(0) });
    expect(ai.chamadas).toHaveLength(0);
  });

  it('aceita áudio exatamente no limite de 15 MB', async () => {
    const ai = new FakeAI({ text: 'ok' });
    env.AI = ai;
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array(15 * 1024 * 1024) });
    expect(r.status).toBe(200);
  });

  it('recusa áudio 1 byte acima dos 15 MB', async () => {
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array(15 * 1024 * 1024 + 1) });
    expect(r.status).toBe(413);
    expect((await json(r)).error).toBe('Áudio demasiado longo (máx. 15 MB).');
  });

  it('devolve 502 quando a IA rebenta', async () => {
    env.AI = new FakeAI(new Error('modelo indisponível'));
    const r = await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect(r.status).toBe(502);
    expect((await json(r)).error).toBe('Falha na transcrição: modelo indisponível');
  });

  it('não grava nada na base de dados', async () => {
    env.AI = new FakeAI({ text: 'x' });
    await chamar(env, 'POST', '/api/apoio/transcrever', { binario: new Uint8Array([1]) });
    expect(env.DB.conta('ticket_anexos')).toBe(0);
    expect(env.DB.conta('ticket_log')).toBe(0);
  });
});

// ─── fluxo completo ──────────────────────────────────────────────────────────

describe('fluxo completo do ticket', () => {
  it('rascunho → aberto → análise → execução → resolução → aprovação', async () => {
    vi.stubGlobal('fetch', mockFetch((url) => url.includes('resend')
      ? { json: { id: 'msg-1' } }
      : geminiJson({ complexidade: 'media', justificacao: 'j', plano: ['1. um', '2. dois'] })));

    const criado = (await json(await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 'Erro no recibo', descricao: 'não gera' } }))).ticket;
    expect(criado.status).toBe('rascunho');

    await chamar(env, 'POST', `/api/apoio/tickets/${criado.id}/abrir`);
    await chamar(env, 'POST', `/api/apoio/tickets/${criado.id}/analisar`);
    await chamar(env, 'POST', `/api/apoio/tickets/${criado.id}/executar`);
    await chamar(env, 'POST', `/api/apoio/tickets/${criado.id}/anexos?tipo=print_conclusao&nome=fim.png`, { binario: new Uint8Array([1, 2]) });
    await chamar(env, 'PATCH', `/api/apoio/tickets/${criado.id}`, { body: { resolucao: 'Corrigido.', _autor: 'Claude' } });
    const fim = (await json(await chamar(env, 'POST', `/api/apoio/tickets/${criado.id}/aprovar`))).ticket;

    expect(fim.status).toBe('em_aprovacao');
    expect(fim.plano_ia).toBe('1. um\n2. dois');
    expect(logs(env, criado.id).map((l) => l.evento)).toEqual([
      'criado', 'aberto', 'analise_ia', 'execucao', 'anexo', 'editado', 'aprovacao',
    ]);
  });

  it('o detalhe reflete todo o histórico no fim do fluxo', async () => {
    await chamar(env, 'POST', '/api/apoio/tickets', { body: { titulo: 't', status: 'aberto' } });
    await chamar(env, 'POST', `/api/apoio/tickets/${T1}/executar`);
    const b = await json(await chamar(env, 'GET', `/api/apoio/tickets/${T1}`));
    expect(b.ticket.status).toBe('em_execucao');
    expect(b.log).toHaveLength(2);
  });
});
