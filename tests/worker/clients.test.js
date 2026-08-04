// tests/worker/clients.test.js — /api/clients
// CRUD do núcleo do escritório: criação, listagem, filtros, pesquisa, edição,
// pessoas adicionais (clientes conjuntos), apagar em cascata e logo em R2.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleClients } from '../../worker/routes/clients.js';
import { criarEnv, req, json } from '../helpers/env.js';

// A rota recebe a sessão mas não a usa; passa-se um objeto realista à mesma.
const SESSAO = { user_id: 'u1', email: 'dra@exemplo.pt', role: 'admin' };

// ── ESQUEMA ─────────────────────────────────────────────────────────────────
// A rota escreve em colunas pessoais de `clients` (address, nationality, rg,
// birth_date, niss, filiation, doc_*) que NENHUMA migração de migrations/ cria
// — foram acrescentadas à mão no D1 de produção. Ver o BUG documentado no fim
// do ficheiro. Aqui repõem-se para poder exercitar a rota a sério.
const COLUNAS_EM_FALTA = [
  'address', 'nationality', 'marital_status', 'rg', 'birth_date', 'birth_place',
  'doc_type', 'doc_number', 'doc_validity', 'niss', 'filiation',
];

function envCompleto(extra) {
  const env = criarEnv(extra);
  for (const c of COLUNAS_EM_FALTA) env.DB.exec(`ALTER TABLE clients ADD COLUMN ${c} TEXT`);
  return env;
}

function chamar(env, metodo, caminho, opts) {
  const pedido = req(metodo, caminho, opts);
  return handleClients(pedido, env, new URL(pedido.url).pathname, SESSAO);
}

const lit = (v) => (v === null || v === undefined
  ? 'NULL'
  : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function semearCliente(env, campos = {}) {
  const c = { id: 'C1', name: 'Ana Silva', country: 'PT', ...campos };
  const cols = Object.keys(c);
  env.DB.exec(`INSERT INTO clients (${cols.join(',')}) VALUES (${cols.map((k) => lit(c[k])).join(',')})`);
  return c.id;
}

const CRIAR_MINIMO = { id: 'C1', name: 'Ana Silva', country: 'PT' };

afterEach(() => vi.unstubAllGlobals());

// ═══════════════════════════════════════════════════════════════════════════
describe('handleClients — encaminhamento', () => {
  it('recusa métodos não suportados na coleção com 405', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'PATCH', '/api/clients');
    expect(res.status).toBe(405);
    expect((await json(res)).error).toBe('Method not allowed');
  });

  it.each(['PATCH', 'HEAD', 'OPTIONS'])('recusa %s num cliente concreto com 405', async (m) => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, m, '/api/clients/C1');
    expect(res.status).toBe(405);
  });

  it('barra final trata /api/clients/ como a coleção', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'GET', '/api/clients/');
    expect((await json(res)).clients).toHaveLength(1);
  });

  it('segmento extra desconhecido cai no GET do cliente (não dá 404)', async () => {
    // /api/clients/C1/seja-o-que-for só é tratado à parte quando é "logo".
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'GET', '/api/clients/C1/seja-o-que-for');
    expect(res.status).toBe(200);
    expect((await json(res)).client.id).toBe('C1');
  });

  it('ID percent-encoded não é descodificado — cliente não é encontrado', async () => {
    // O path vem do url.pathname (codificado) e a rota não faz decodeURIComponent.
    const env = envCompleto();
    semearCliente(env, { id: 'C 1' });
    const res = await chamar(env, 'GET', '/api/clients/C%201');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/clients — criação', () => {
  it('cria o cliente mínimo e devolve 201 com o id', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ ok: true, id: 'C1' });
    expect(env.DB.conta('clients')).toBe(1);
  });

  it('nasce com status active', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(env.DB.linha('SELECT status FROM clients').status).toBe('active');
  });

  it('guarda todos os campos pessoais enviados', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: {
        ...CRIAR_MINIMO, email: 'ana@exemplo.pt', phone: '+351912345678',
        identification: '123456789', practice_area: 'Nacionalidade',
        address: 'Rua A, 1', nationality: 'portuguesa', marital_status: 'casada',
        birth_date: '1980-01-31', niss: '11223344556', rg: null,
      },
    });
    const c = env.DB.linha('SELECT * FROM clients');
    expect(c).toMatchObject({
      email: 'ana@exemplo.pt', phone: '+351912345678', identification: '123456789',
      address: 'Rua A, 1', nationality: 'portuguesa', birth_date: '1980-01-31',
    });
  });

  it.each([
    ['sem id', { name: 'A', country: 'PT' }],
    ['sem name', { id: 'C1', country: 'PT' }],
    ['sem country', { id: 'C1', name: 'A' }],
    ['tudo em falta', {}],
  ])('recusa criação %s com 400', async (_rot, body) => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/obrigatórios/);
    expect(env.DB.conta('clients')).toBe(0);
  });

  it('string vazia nos obrigatórios conta como ausente', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { id: '', name: '', country: '' } });
    expect(res.status).toBe(400);
  });

  it('nome só com espaços é aceite (não há trim nos obrigatórios)', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, name: '   ' } });
    expect(res.status).toBe(201);
    expect(env.DB.linha('SELECT name FROM clients').name).toBe('   ');
  });

  it('recusa corpo JSON inválido com 400', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: '{ isto não é json' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Invalid JSON');
  });

  it('recusa corpo vazio com 400', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: '' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Invalid JSON');
  });

  it('corpo JSON "null" cai na validação de obrigatórios', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: 'null' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/obrigatórios/);
  });

  it('devolve 409 quando o id já existe', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/Já existe cliente/);
    expect(env.DB.conta('clients')).toBe(1);
  });

  it('normaliza plan_type desconhecido para installment', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, plan_type: 'vitalicio' } });
    expect(env.DB.linha('SELECT plan_type FROM clients').plan_type).toBe('installment');
  });

  it.each(['installment', 'monthly', 'oficioso', 'probono'])('aceita o plan_type %s', async (p) => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, plan_type: p } });
    expect(env.DB.linha('SELECT plan_type FROM clients').plan_type).toBe(p);
  });

  it('person_type diferente de coletiva vira singular', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, person_type: 'COLETIVA' } });
    expect(env.DB.linha('SELECT person_type FROM clients').person_type).toBe('singular');
  });

  it('aceita pessoa coletiva com representante e DUNS', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: { ...CRIAR_MINIMO, person_type: 'coletiva', rep_name: 'Ana', rep_role: 'gerente', duns: '123456789' },
    });
    expect(env.DB.linha('SELECT * FROM clients')).toMatchObject({
      person_type: 'coletiva', rep_name: 'Ana', rep_role: 'gerente', duns: '123456789',
    });
  });

  it('notes em falta ficam string vazia, não NULL', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(env.DB.linha('SELECT notes FROM clients').notes).toBe('');
  });

  it('honorários em falta ficam a 0 (total e parcelas)', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(env.DB.linha('SELECT honorarios_total h, honorarios_parcelas p FROM clients')).toEqual({ h: 0, p: 0 });
  });

  it('honorarios_total = 0 é guardado como 0 (o || 0 não o altera)', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, honorarios_total: 0 } });
    expect(env.DB.linha('SELECT honorarios_total h FROM clients').h).toBe(0);
  });

  it('guarda cêntimos sem perder precisão', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, honorarios_total: 1234.56 } });
    expect(env.DB.linha('SELECT honorarios_total h FROM clients').h).toBeCloseTo(1234.56, 2);
  });

  it('aceita honorários negativos sem validar (lacuna documentada)', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, honorarios_total: -500 } });
    expect(res.status).toBe(201);
    expect(env.DB.linha('SELECT honorarios_total h FROM clients').h).toBe(-500);
  });

  it('honorários enviados como string numérica são convertidos pela coluna REAL', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, honorarios_total: '1500.75' } });
    const r = env.DB.linha('SELECT honorarios_total h, typeof(honorarios_total) t FROM clients');
    expect(r.t).toBe('real');
    expect(r.h).toBeCloseTo(1500.75, 2);
  });

  it('honorários com texto não numérico ficam guardados como texto (não valida)', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, honorarios_total: 'mil euros' } });
    expect(env.DB.linha('SELECT typeof(honorarios_total) t FROM clients').t).toBe('text');
  });

  it('não valida o formato do e-mail', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, email: 'isto-nao-e-email' } });
    expect(res.status).toBe(201);
    expect(env.DB.linha('SELECT email FROM clients').email).toBe('isto-nao-e-email');
  });

  it('não valida o formato do NIF/identificação', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, identification: 'abc' } });
    expect(env.DB.linha('SELECT identification FROM clients').identification).toBe('abc');
  });

  it('não valida o formato do telefone', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, phone: 'liga-me' } });
    expect(env.DB.linha('SELECT phone FROM clients').phone).toBe('liga-me');
  });

  it.each(['31/12/2026', '2026-13-45', 'ontem'])('não valida a data %s (aceita qualquer texto)', async (d) => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, contract_start_date: d } });
    expect(res.status).toBe(201);
    expect(env.DB.linha('SELECT contract_start_date d FROM clients').d).toBe(d);
  });

  it('e-mail em string vazia é guardado como NULL', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, email: '', phone: '' } });
    expect(env.DB.linha('SELECT email, phone FROM clients')).toEqual({ email: null, phone: null });
  });

  it('aceita um nome absurdamente longo (não há limite de comprimento)', async () => {
    const env = envCompleto();
    const nome = 'Ana '.repeat(5000);
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, name: nome } });
    expect(res.status).toBe(201);
    expect(env.DB.linha('SELECT length(name) n FROM clients').n).toBe(nome.length);
  });

  it('preserva acentos e caracteres especiais no nome', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, name: "Conceição d'Ávila & Filhos — Lda." } });
    expect(env.DB.linha('SELECT name FROM clients').name).toBe("Conceição d'Ávila & Filhos — Lda.");
  });

  it('campos desconhecidos no corpo são ignorados', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, saldo_secreto: 999, id_falso: 'x' } });
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/clients — serialização dos contactos múltiplos', () => {
  it('serializa emails/phones em JSON', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: { ...CRIAR_MINIMO, emails: [{ label: 'Pessoal', value: 'a@x.pt' }], phones: [{ label: 'Tlm', value: '912' }] },
    });
    const c = env.DB.linha('SELECT emails, phones FROM clients');
    expect(JSON.parse(c.emails)).toEqual([{ label: 'Pessoal', value: 'a@x.pt' }]);
    expect(JSON.parse(c.phones)).toEqual([{ label: 'Tlm', value: '912' }]);
  });

  it('lista vazia é serializada como "[]" e não NULL', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, emails: [] } });
    expect(env.DB.linha('SELECT emails FROM clients').emails).toBe('[]');
  });

  it('string já serializada passa intacta', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, emails: '[{"value":"a@x.pt"}]' } });
    expect(env.DB.linha('SELECT emails FROM clients').emails).toBe('[{"value":"a@x.pt"}]');
  });

  it('string vazia e null viram NULL', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, emails: '', phones: null } });
    expect(env.DB.linha('SELECT emails, phones FROM clients')).toEqual({ emails: null, phones: null });
  });

  it('serializa nationalities, documents e processes', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: {
        ...CRIAR_MINIMO,
        nationalities: ['portuguesa', 'brasileira'],
        documents: [{ docType: 'CC', docNumber: '1' }],
        processes: [{ ref: 'P-1', area: 'Nacionalidade' }],
      },
    });
    const c = env.DB.linha('SELECT nationalities, documents, processes FROM clients');
    expect(JSON.parse(c.nationalities)).toEqual(['portuguesa', 'brasileira']);
    expect(JSON.parse(c.documents)).toHaveLength(1);
    expect(JSON.parse(c.processes)[0].ref).toBe('P-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/clients — pessoas adicionais (cliente conjunto)', () => {
  it('grava as pessoas adicionais a partir da posição 2', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: { ...CRIAR_MINIMO, people: [{ name: 'Bruno Costa' }, { name: 'Carla Dias' }] },
    });
    const p = env.DB.linhas('SELECT name, position FROM client_people ORDER BY position');
    expect(p).toEqual([
      { name: 'Bruno Costa', position: 2 },
      { name: 'Carla Dias', position: 3 },
    ]);
  });

  it('ignora pessoas sem nome ou com nome em branco', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: { ...CRIAR_MINIMO, people: [{ name: '  ' }, null, { identification: '1' }, { name: 'Bruno' }] },
    });
    expect(env.DB.conta('client_people')).toBe(1);
    expect(env.DB.linha('SELECT name FROM client_people').name).toBe('Bruno');
  });

  it('faz trim ao nome da pessoa adicional', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [{ name: '  Bruno  ' }] } });
    expect(env.DB.linha('SELECT name FROM client_people').name).toBe('Bruno');
  });

  it('respeita o id enviado quando tem o prefixo do cliente', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [{ id: 'C1-pes2-abcd', name: 'Bruno' }] } });
    expect(env.DB.linha('SELECT id FROM client_people').id).toBe('C1-pes2-abcd');
  });

  it('gera id próprio quando o enviado não tem o prefixo do cliente', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [{ id: 'hacker', name: 'Bruno' }] } });
    expect(env.DB.linha('SELECT id FROM client_people').id).toMatch(/^C1-pes2-/);
  });

  it('deriva a filiação dos nomes dos pais quando não vem preenchida', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', {
      body: { ...CRIAR_MINIMO, people: [{ name: 'Bruno', father_name: 'José', mother_name: 'Maria' }] },
    });
    expect(env.DB.linha('SELECT filiation FROM client_people').filiation).toBe('José e Maria');
  });

  it('filiação fica NULL quando não há nomes dos pais', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [{ name: 'Bruno' }] } });
    expect(env.DB.linha('SELECT filiation FROM client_people').filiation).toBe(null);
  });

  it('people vazio ou não-array não cria linhas nem rebenta', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [] } });
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, id: 'C2', people: 'não é array' } });
    expect(env.DB.conta('client_people')).toBe(0);
    expect(env.DB.conta('clients')).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/clients — listagem, filtros e pesquisa', () => {
  function semearTres(env) {
    semearCliente(env, { id: 'C1', name: 'Ana Silva', country: 'PT', status: 'active', email: 'ana@x.pt', identification: '111' });
    semearCliente(env, { id: 'C2', name: 'Bruno Costa', country: 'BR', status: 'inactive', email: 'bruno@y.br', identification: '222' });
    semearCliente(env, { id: 'C3', name: 'Zé Ávila', country: 'PT', status: 'active', email: 'ze@x.pt', identification: '333' });
  }

  it('lista vazia devolve array vazio, não null', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'GET', '/api/clients');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ clients: [] });
  });

  it('devolve todos os clientes ordenados por nome', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients'));
    expect(clients.map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
  });

  it('ordena com collation binária (maiúsculas antes de minúsculas)', async () => {
    const env = envCompleto();
    semearCliente(env, { id: 'A', name: 'Ana' });
    semearCliente(env, { id: 'B', name: 'ana' });
    semearCliente(env, { id: 'C', name: 'Zé' });
    const { clients } = await json(await chamar(env, 'GET', '/api/clients'));
    expect(clients.map((c) => c.name)).toEqual(['Ana', 'Zé', 'ana']);
  });

  it('filtra por país', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?country=BR'));
    expect(clients.map((c) => c.id)).toEqual(['C2']);
  });

  it('filtra por estado', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?status=inactive'));
    expect(clients.map((c) => c.id)).toEqual(['C2']);
  });

  it('combina país e estado', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?country=PT&status=active'));
    expect(clients.map((c) => c.id)).toEqual(['C1', 'C3']);
  });

  it('filtro inexistente devolve lista vazia em vez de erro', async () => {
    const env = envCompleto();
    semearTres(env);
    const res = await chamar(env, 'GET', '/api/clients?country=XX');
    expect(res.status).toBe(200);
    expect((await json(res)).clients).toEqual([]);
  });

  it('parâmetro desconhecido é ignorado', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?ordenar=salario&limite=1&pagina=2'));
    expect(clients).toHaveLength(3);
  });

  it('não há paginação — devolve tudo de uma vez', async () => {
    const env = envCompleto();
    for (let i = 0; i < 120; i++) semearCliente(env, { id: `C${i}`, name: `Cliente ${String(i).padStart(3, '0')}` });
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?limit=10'));
    expect(clients).toHaveLength(120);
  });

  it('pesquisa por parte do nome', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?search=Costa'));
    expect(clients.map((c) => c.id)).toEqual(['C2']);
  });

  it('pesquisa também por e-mail e por identificação', async () => {
    const env = envCompleto();
    semearTres(env);
    expect((await json(await chamar(env, 'GET', '/api/clients?search=bruno@y'))).clients).toHaveLength(1);
    expect((await json(await chamar(env, 'GET', '/api/clients?search=333'))).clients).toHaveLength(1);
  });

  it('pesquisa ignora maiúsculas em ASCII', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?search=ANA'));
    expect(clients.map((c) => c.id)).toEqual(['C1']);
  });

  it('pesquisa NÃO ignora maiúsculas em letras acentuadas (limitação do LIKE)', async () => {
    const env = envCompleto();
    semearTres(env);
    expect((await json(await chamar(env, 'GET', '/api/clients?search=Ávila'))).clients).toHaveLength(1);
    expect((await json(await chamar(env, 'GET', '/api/clients?search=ávila'))).clients).toHaveLength(0);
  });

  it('pesquisar por "%" devolve tudo (o LIKE não escapa jokers)', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?search=%25'));
    expect(clients).toHaveLength(3);
  });

  it('pesquisar por "_" também funciona como joker', async () => {
    const env = envCompleto();
    semearTres(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients?search=_'));
    expect(clients).toHaveLength(3);
  });

  it('aspas e plicas na pesquisa não partem o SQL (bind parametrizado)', async () => {
    const env = envCompleto();
    semearCliente(env, { id: 'C1', name: "O'Neill \"Zé\"" });
    const res = await chamar(env, 'GET', `/api/clients?search=${encodeURIComponent(`O'Neill`)}`);
    expect(res.status).toBe(200);
    expect((await json(res)).clients).toHaveLength(1);
  });

  it('tentativa de injeção SQL na pesquisa não apaga nada', async () => {
    const env = envCompleto();
    semearTres(env);
    const res = await chamar(env, 'GET', `/api/clients?search=${encodeURIComponent("'; DROP TABLE clients; --")}`);
    expect(res.status).toBe(200);
    expect((await json(res)).clients).toEqual([]);
    expect(env.DB.conta('clients')).toBe(3);
  });

  it('pesquisa vazia (?search=) é tratada como ausente', async () => {
    const env = envCompleto();
    semearTres(env);
    expect((await json(await chamar(env, 'GET', '/api/clients?search='))).clients).toHaveLength(3);
  });

  it('conta e concatena as pessoas adicionais de cada cliente', async () => {
    const env = envCompleto();
    await chamar(env, 'POST', '/api/clients', { body: { ...CRIAR_MINIMO, people: [{ name: 'Bruno' }, { name: 'Carla' }] } });
    const { clients } = await json(await chamar(env, 'GET', '/api/clients'));
    expect(clients[0].extra_people).toBe(2);
    expect(clients[0].extra_names).toBe('Bruno · Carla');
  });

  it('cliente sem pessoas adicionais traz contador 0 e nomes NULL', async () => {
    const env = envCompleto();
    semearCliente(env);
    const { clients } = await json(await chamar(env, 'GET', '/api/clients'));
    expect(clients[0].extra_people).toBe(0);
    expect(clients[0].extra_names).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/clients/:id — ficha completa', () => {
  it('devolve 404 para id inexistente', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'GET', '/api/clients/NAO-EXISTE');
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Cliente não encontrado');
  });

  it('devolve cliente, parcelas, regras e pessoas', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
                 VALUES ('P1','C1',1,2,100,'2026-09-10'), ('P2','C1',2,2,100,'2026-08-10')`);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel) VALUES ('R1','C1','email')`);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES ('C1-pes2-a', 'C1', 2, 'Bruno')`);
    const body = await json(await chamar(env, 'GET', '/api/clients/C1'));
    expect(body.client.id).toBe('C1');
    expect(body.installments.map((i) => i.id)).toEqual(['P2', 'P1']); // ordenadas por vencimento
    expect(body.rules).toHaveLength(1);
    expect(body.people).toHaveLength(1);
  });

  it('cliente sem relações devolve listas vazias', async () => {
    const env = envCompleto();
    semearCliente(env);
    const body = await json(await chamar(env, 'GET', '/api/clients/C1'));
    expect(body).toMatchObject({ installments: [], rules: [], people: [] });
  });

  it('ordena as pessoas adicionais por posição', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES
      ('p3','C1',3,'Carla'), ('p2','C1',2,'Bruno')`);
    const body = await json(await chamar(env, 'GET', '/api/clients/C1'));
    expect(body.people.map((p) => p.name)).toEqual(['Bruno', 'Carla']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /api/clients/:id — edição', () => {
  it('atualiza campos permitidos e carimba updated_at', async () => {
    const env = envCompleto();
    semearCliente(env, { updated_at: '2000-01-01 00:00:00' });
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { name: 'Ana Maria Silva', status: 'inactive' } });
    expect(res.status).toBe(200);
    const c = env.DB.linha('SELECT * FROM clients');
    expect(c.name).toBe('Ana Maria Silva');
    expect(c.status).toBe('inactive');
    expect(c.updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('devolve 404 quando o cliente não existe', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'PUT', '/api/clients/NAO-EXISTE', { body: { name: 'X' } });
    expect(res.status).toBe(404);
  });

  it('devolve 404 quando só vem people e o cliente não existe', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'PUT', '/api/clients/NAO-EXISTE', { body: { people: [] } });
    expect(res.status).toBe(404);
  });

  it('recusa corpo sem nenhum campo conhecido com 400', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { campo_inventado: 'x' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Nenhum campo para atualizar');
  });

  it('recusa corpo JSON inválido com 400', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: '{{' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Invalid JSON');
  });

  it('não deixa mudar o id do cliente', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { id: 'OUTRO', name: 'Ana' } });
    expect(res.status).toBe(200);
    expect(env.DB.linha('SELECT id FROM clients').id).toBe('C1');
  });

  it('não deixa mexer no logo_key por PUT', async () => {
    const env = envCompleto();
    semearCliente(env, { logo_key: 'logos/C1' });
    await chamar(env, 'PUT', '/api/clients/C1', { body: { logo_key: 'logos/OUTRO', name: 'Ana' } });
    expect(env.DB.linha('SELECT logo_key FROM clients').logo_key).toBe('logos/C1');
  });

  it('null explícito limpa o campo', async () => {
    const env = envCompleto();
    semearCliente(env, { email: 'ana@x.pt' });
    await chamar(env, 'PUT', '/api/clients/C1', { body: { email: null } });
    expect(env.DB.linha('SELECT email FROM clients').email).toBe(null);
  });

  it('string vazia é guardada como string vazia (não vira NULL, ao contrário do POST)', async () => {
    const env = envCompleto();
    semearCliente(env, { email: 'ana@x.pt' });
    await chamar(env, 'PUT', '/api/clients/C1', { body: { email: '' } });
    expect(env.DB.linha('SELECT email FROM clients').email).toBe('');
  });

  it('pôr o nome a null viola o NOT NULL e propaga o erro', async () => {
    const env = envCompleto();
    semearCliente(env);
    await expect(chamar(env, 'PUT', '/api/clients/C1', { body: { name: null } })).rejects.toThrow(/NOT NULL/i);
  });

  it('atualiza honorários com decimais', async () => {
    const env = envCompleto();
    semearCliente(env, { honorarios_total: 1000 });
    await chamar(env, 'PUT', '/api/clients/C1', { body: { honorarios_total: 1500.05 } });
    expect(env.DB.linha('SELECT honorarios_total h FROM clients').h).toBeCloseTo(1500.05, 2);
  });

  it('reserializa emails/phones enviados como array', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'PUT', '/api/clients/C1', { body: { emails: [{ label: 'Novo', value: 'b@x.pt' }] } });
    expect(JSON.parse(env.DB.linha('SELECT emails FROM clients').emails)).toEqual([{ label: 'Novo', value: 'b@x.pt' }]);
  });

  it('atualizar só um campo não apaga os restantes', async () => {
    const env = envCompleto();
    semearCliente(env, { email: 'ana@x.pt', phone: '912', notes: 'nota' });
    await chamar(env, 'PUT', '/api/clients/C1', { body: { phone: '999' } });
    expect(env.DB.linha('SELECT email, phone, notes FROM clients')).toEqual({ email: 'ana@x.pt', phone: '999', notes: 'nota' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /api/clients/:id — sincronização das pessoas adicionais', () => {
  it('people substitui integralmente as linhas existentes', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES ('p2','C1',2,'Antigo')`);
    await chamar(env, 'PUT', '/api/clients/C1', { body: { people: [{ name: 'Novo' }] } });
    const p = env.DB.linhas('SELECT name FROM client_people');
    expect(p).toEqual([{ name: 'Novo' }]);
  });

  it('people vazio apaga todas as pessoas adicionais', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES ('p2','C1',2,'Antigo')`);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { people: [] } });
    expect(res.status).toBe(200);
    expect(env.DB.conta('client_people')).toBe(0);
  });

  it('renumera as posições a partir de 2', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'PUT', '/api/clients/C1', { body: { people: [{ name: 'B' }, { name: 'C' }, { name: 'D' }] } });
    expect(env.DB.linhas('SELECT position FROM client_people ORDER BY position').map((r) => r.position)).toEqual([2, 3, 4]);
  });

  it('atualiza campos e pessoas no mesmo pedido', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'PUT', '/api/clients/C1', { body: { name: 'Ana M.', people: [{ name: 'Bruno' }] } });
    expect(env.DB.linha('SELECT name FROM clients').name).toBe('Ana M.');
    expect(env.DB.conta('client_people')).toBe(1);
  });

  it('só people (sem campos) é um pedido válido e não dá 400', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { people: [{ name: 'Bruno' }] } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });

  it('ids duplicados nas pessoas fazem o batch reverter em bloco', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES ('p2','C1',2,'Antigo')`);
    await expect(chamar(env, 'PUT', '/api/clients/C1', {
      body: { people: [{ id: 'C1-pes2-aaaa', name: 'B' }, { id: 'C1-pes2-aaaa', name: 'C' }] },
    })).rejects.toThrow();
    // a transação reverteu: a pessoa antiga continua lá
    expect(env.DB.linha('SELECT name FROM client_people').name).toBe('Antigo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('DELETE /api/clients/:id — apagar e cascata', () => {
  it('apaga o cliente e devolve ok', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'DELETE', '/api/clients/C1');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(env.DB.conta('clients')).toBe(0);
  });

  it('devolve 404 quando o cliente não existe', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'DELETE', '/api/clients/NAO-EXISTE');
    expect(res.status).toBe(404);
  });

  it('apagar duas vezes dá 404 na segunda', async () => {
    const env = envCompleto();
    semearCliente(env);
    expect((await chamar(env, 'DELETE', '/api/clients/C1')).status).toBe(200);
    expect((await chamar(env, 'DELETE', '/api/clients/C1')).status).toBe(404);
  });

  it('cascata apaga parcelas, regras, log e pessoas', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
                 VALUES ('P1','C1',1,1,100,'2026-09-10')`);
    env.DB.exec(`INSERT INTO notification_rules (id, client_id, channel) VALUES ('R1','C1','email')`);
    env.DB.exec(`INSERT INTO notification_log (id, installment_id, client_id, channel, status) VALUES ('L1','P1','C1','email','sent')`);
    env.DB.exec(`INSERT INTO client_people (id, client_id, position, name) VALUES ('p2','C1',2,'Bruno')`);
    await chamar(env, 'DELETE', '/api/clients/C1');
    expect(env.DB.conta('installments')).toBe(0);
    expect(env.DB.conta('notification_rules')).toBe(0);
    expect(env.DB.conta('notification_log')).toBe(0);
    expect(env.DB.conta('client_people')).toBe(0);
  });

  it('não toca noutros clientes', async () => {
    const env = envCompleto();
    semearCliente(env, { id: 'C1' });
    semearCliente(env, { id: 'C2', name: 'Bruno' });
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
                 VALUES ('P2','C2',1,1,50,'2026-09-10')`);
    await chamar(env, 'DELETE', '/api/clients/C1');
    expect(env.DB.conta('clients')).toBe(1);
    expect(env.DB.conta('installments')).toBe(1);
  });

  it('falha na limpeza do R2 não impede o apagar (best-effort)', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.RECIBOS.list = async () => { throw new Error('R2 em baixo'); };
    const res = await chamar(env, 'DELETE', '/api/clients/C1');
    expect(res.status).toBe(200);
    expect(env.DB.conta('clients')).toBe(0);
  });

  it('pede ao R2 os prefixos de recibos e documentos do cliente', async () => {
    const env = envCompleto();
    semearCliente(env);
    const prefixos = [];
    env.RECIBOS.list = async ({ prefix }) => { prefixos.push(prefix); return { objects: [] }; };
    await chamar(env, 'DELETE', '/api/clients/C1');
    expect(prefixos).toEqual(['recibos/C1/', 'documentos/C1/']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('/api/clients/:id/logo', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

  it('devolve 404 quando o cliente não existe (antes de olhar ao método)', async () => {
    const env = envCompleto();
    const res = await chamar(env, 'POST', '/api/clients/NAO-EXISTE/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Cliente não encontrado');
  });

  it('guarda o logo no R2 e regista a chave e o tipo', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } });
    expect(res.status).toBe(200);
    expect(env.DB.linha('SELECT logo_key, logo_type FROM clients')).toEqual({ logo_key: 'logos/C1', logo_type: 'image/png' });
    expect(env.RECIBOS.store.get('logos/C1').bytes).toEqual(PNG);
  });

  it('PUT no logo funciona como POST', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/webp' } });
    expect(res.status).toBe(200);
    expect(env.DB.linha('SELECT logo_type FROM clients').logo_type).toBe('image/webp');
  });

  it('aceita o content-type com parâmetros e maiúsculas', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'IMAGE/PNG; charset=binary' } });
    expect(res.status).toBe(200);
    expect(env.DB.linha('SELECT logo_type FROM clients').logo_type).toBe('image/png');
  });

  it.each(['application/pdf', 'text/html', 'image/gif', 'application/octet-stream'])
    ('recusa o tipo %s com 415', async (ct) => {
      const env = envCompleto();
      semearCliente(env);
      const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': ct } });
      expect(res.status).toBe(415);
    });

  it('recusa ficheiro vazio com 400', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: new Uint8Array(0), headers: { 'Content-Type': 'image/png' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/vazio/);
  });

  it('recusa ficheiro acima de 2 MB com 413', async () => {
    const env = envCompleto();
    semearCliente(env);
    const grande = new Uint8Array(2 * 1024 * 1024 + 1);
    const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: grande, headers: { 'Content-Type': 'image/jpeg' } });
    expect(res.status).toBe(413);
    expect(env.RECIBOS.store.has('logos/C1')).toBe(false);
  });

  it('aceita exatamente 2 MB', async () => {
    const env = envCompleto();
    semearCliente(env);
    const limite = new Uint8Array(2 * 1024 * 1024);
    const res = await chamar(env, 'POST', '/api/clients/C1/logo', { binario: limite, headers: { 'Content-Type': 'image/jpeg' } });
    expect(res.status).toBe(200);
  });

  it('substituir o logo sobrepõe o anterior na mesma chave', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } });
    await chamar(env, 'POST', '/api/clients/C1/logo', { binario: new Uint8Array([9, 9]), headers: { 'Content-Type': 'image/svg+xml' } });
    expect(env.RECIBOS.store.size).toBe(1);
    expect(env.DB.linha('SELECT logo_type FROM clients').logo_type).toBe('image/svg+xml');
  });

  it('GET devolve a imagem com o content-type guardado', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } });
    const res = await chamar(env, 'GET', '/api/clients/C1/logo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('GET sem logo devolve 404', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'GET', '/api/clients/C1/logo');
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Sem logo');
  });

  it('GET com chave registada mas objeto ausente no R2 devolve 404', async () => {
    const env = envCompleto();
    semearCliente(env, { logo_key: 'logos/C1', logo_type: 'image/png' });
    const res = await chamar(env, 'GET', '/api/clients/C1/logo');
    expect(res.status).toBe(404);
  });

  it('DELETE remove do R2 e limpa as colunas', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } });
    const res = await chamar(env, 'DELETE', '/api/clients/C1/logo');
    expect(res.status).toBe(200);
    expect(env.DB.linha('SELECT logo_key, logo_type FROM clients')).toEqual({ logo_key: null, logo_type: null });
    expect(env.RECIBOS.store.has('logos/C1')).toBe(false);
  });

  it('DELETE sem logo é idempotente', async () => {
    const env = envCompleto();
    semearCliente(env);
    expect((await chamar(env, 'DELETE', '/api/clients/C1/logo')).status).toBe(200);
    expect((await chamar(env, 'DELETE', '/api/clients/C1/logo')).status).toBe(200);
  });

  it('método não suportado no logo devolve 405', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PATCH', '/api/clients/C1/logo');
    expect(res.status).toBe(405);
  });

  it('falha no R2 ao guardar propaga o erro (não é engolida)', async () => {
    const env = envCompleto();
    semearCliente(env);
    env.RECIBOS.falhaNoPut = 'R2 indisponível';
    await expect(chamar(env, 'POST', '/api/clients/C1/logo', { binario: PNG, headers: { 'Content-Type': 'image/png' } }))
      .rejects.toThrow('R2 indisponível');
    expect(env.DB.linha('SELECT logo_key FROM clients').logo_key).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('defeitos conhecidos (marcados com it.fails)', () => {
  // BUG: falta uma migração. worker/routes/clients.js:102 escreve em address,
  // nationality, marital_status, rg, birth_date, birth_place, doc_type,
  // doc_number, doc_validity, niss e filiation, mas nenhum ficheiro de
  // migrations/ cria essas colunas em `clients` (só existem em client_people,
  // migrations/0010). Contra o esquema reconstruído a partir de migrations/,
  // CRIAR UM CLIENTE É IMPOSSÍVEL. Em produção as colunas foram acrescentadas à
  // mão; qualquer reconstrução da BD a partir do repositório fica partida.
  it.fails('criar cliente com o esquema das migrações (BUG: colunas em falta)', async () => {
    const env = criarEnv(); // sem o remendo de colunas
    const res = await chamar(env, 'POST', '/api/clients', { body: CRIAR_MINIMO });
    expect(res.status).toBe(201);
  });

  // CORRIGIDO (era): worker/routes/clients.js:159 — o PUT inclui plan_type na lista de
  // campos permitidos sem repetir a validação que o POST faz (linhas 97-98).
  // Um valor fora de ['installment','monthly','oficioso','probono'] entra na BD
  // e a UI deixa de saber classificar o plano.
  it('PUT recusa plan_type fora da lista', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { plan_type: 'vitalicio' } });
    expect(res.status).toBe(400);
  });

  // CORRIGIDO (era): mesma lacuna para person_type — o POST normaliza (linha 110), o PUT não.
  it('PUT normaliza person_type', async () => {
    const env = envCompleto();
    semearCliente(env);
    await chamar(env, 'PUT', '/api/clients/C1', { body: { person_type: 'alienigena' } });
    expect(env.DB.linha('SELECT person_type FROM clients').person_type).toBe('singular');
  });

  // CORRIGIDO (era): worker/routes/clients.js:159 — status também não é validado no PUT.
  // Os filtros e o dashboard só conhecem 'active'/'inactive'.
  it('PUT recusa status desconhecido', async () => {
    const env = envCompleto();
    semearCliente(env);
    const res = await chamar(env, 'PUT', '/api/clients/C1', { body: { status: 'em-ferias' } });
    expect(res.status).toBe(400);
  });
});
