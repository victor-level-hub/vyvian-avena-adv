// tests/worker/rota-auth.test.js
// Porta de entrada da Área Privada — worker/routes/auth.js:
//   POST /api/auth/login  ·  POST /api/auth/logout  ·  GET /api/auth/me
// Aqui esfola-se tudo o que um anónimo pode enviar ao formulário de entrada.
// (O módulo criptográfico por baixo — PBKDF2/JWT/KV — está em lib-auth.test.js.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAuth } from '../../worker/routes/auth.js';
import { hashPassword, requireAuth, signJWT } from '../../worker/lib/auth.js';
import { criarEnv, req, json } from '../helpers/env.js';

// PBKDF2 com 100 000 iterações é lento; nos testes basta um valor baixo
// (verifyPassword lê as iterações do próprio registo).
const ITER = 1000;
const PASSWORD = 'Segredo123!';
const EMAIL = 'dra@exemplo.pt';

let env;

async function semear(u = {}) {
  const hash = u.password_hash ?? (await hashPassword(u.password ?? PASSWORD, ITER));
  await env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, name, initials, role, cargo, phone,
                       permissions, status, photo_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    u.id ?? 'usr_dra', u.email ?? EMAIL, hash, u.name ?? 'Vyvian Avena',
    u.initials ?? 'VA', u.role ?? 'admin', u.cargo ?? null, u.phone ?? null,
    u.permissions_raw ?? JSON.stringify(u.permissions ?? ['*']),
    u.status ?? 'ativo', u.photo_key ?? null,
  ).run();
  return u.id ?? 'usr_dra';
}

const rota = (metodo, caminho, opts) => handleAuth(req(metodo, caminho, opts), env, caminho);
const login = (body, opts = {}) => rota('POST', '/api/auth/login', { body, ...opts });
const comToken = (metodo, caminho, token) =>
  rota(metodo, caminho, token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } });

// entra com as credenciais boas e devolve { token, user, res }
async function entrar(credenciais = { email: EMAIL, password: PASSWORD }) {
  const res = await login(credenciais);
  const b = await json(res);
  return { ...b, res };
}

const descodificar = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

beforeEach(() => { env = criarEnv(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — entrada com credenciais válidas', () => {
  beforeEach(() => semear({ cargo: 'Advogada', phone: '+351 900 000 000' }));

  it('devolve 200 com token e utilizador', async () => {
    const { res, token, user } = await entrar();
    expect(res.status).toBe(200);
    expect(typeof token).toBe('string');
    expect(user.email).toBe(EMAIL);
  });

  it('devolve o perfil completo da utilizadora', async () => {
    const { user } = await entrar();
    expect(user).toEqual({
      id: 'usr_dra',
      email: EMAIL,
      name: 'Vyvian Avena',
      initials: 'VA',
      role: 'admin',
      cargo: 'Advogada',
      phone: '+351 900 000 000',
      permissions: ['*'],
      has_photo: false,
    });
  });

  it('nunca devolve a password nem o hash guardado', async () => {
    const guardado = env.DB.linha('SELECT password_hash FROM users').password_hash;
    const corpo = await (await login({ email: EMAIL, password: PASSWORD })).text();
    expect(corpo).not.toContain(guardado);
    expect(corpo).not.toContain(PASSWORD);
    expect(corpo).not.toContain('password_hash');
  });

  it('o payload do token traz sub, email, name, initials, role e jti — e nada de password', async () => {
    const { token } = await entrar();
    const p = descodificar(token);
    expect(p).toMatchObject({ sub: 'usr_dra', email: EMAIL, name: 'Vyvian Avena', initials: 'VA', role: 'admin' });
    expect(typeof p.jti).toBe('string');
    expect(p).not.toHaveProperty('password');
    expect(p).not.toHaveProperty('password_hash');
    expect(p).not.toHaveProperty('permissions');
  });

  it('o token vale 7 dias', async () => {
    const p = descodificar((await entrar()).token);
    expect(p.exp - p.iat).toBe(60 * 60 * 24 * 7);
  });

  it('o token devolvido é aceite pelo requireAuth', async () => {
    const { token } = await entrar();
    const sessao = await requireAuth(req('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }), env);
    expect(sessao).toMatchObject({ sub: 'usr_dra', email: EMAIL });
  });

  it('cria a sessão no KV com a chave igual ao jti do token', async () => {
    const { token } = await entrar();
    const { jti } = descodificar(token);
    expect(await env.SESSIONS.get(jti, 'json')).toMatchObject({ userId: 'usr_dra', email: EMAIL });
  });

  it('a sessão em KV regista a hora de entrada e expira em 7 dias', async () => {
    await entrar();
    const [put] = env.SESSIONS.puts;
    expect(put.opts.expirationTtl).toBe(60 * 60 * 24 * 7);
    expect(JSON.parse(put.value).loggedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('guarda o User-Agent de quem entrou', async () => {
    await login({ email: EMAIL, password: PASSWORD }, { headers: { 'User-Agent': 'Firefox/141.0' } });
    expect(JSON.parse(env.SESSIONS.puts[0].value).userAgent).toBe('Firefox/141.0');
  });

  it('sem User-Agent guarda string vazia em vez de rebentar', async () => {
    await entrar();
    expect(JSON.parse(env.SESSIONS.puts[0].value).userAgent).toBe('');
  });

  it('duas entradas geram dois tokens e duas sessões independentes', async () => {
    const a = await entrar();
    const b = await entrar();
    expect(a.token).not.toBe(b.token);
    expect(descodificar(a.token).jti).not.toBe(descodificar(b.token).jti);
    expect(env.SESSIONS.puts).toHaveLength(2);
  });

  it('has_photo fica a true quando o utilizador tem fotografia', async () => {
    await env.DB.prepare(`UPDATE users SET photo_key = 'fotos/usr_dra.jpg'`).run();
    expect((await entrar()).user.has_photo).toBe(true);
  });

  it('cargo e telefone vazios saem como null', async () => {
    await env.DB.prepare(`UPDATE users SET cargo = '', phone = ''`).run();
    const { user } = await entrar();
    expect(user.cargo).toBe(null);
    expect(user.phone).toBe(null);
  });

  it('responde em JSON com CORS', async () => {
    const { res } = await entrar();
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — permissões devolvidas', () => {
  it.each([
    ['["*"]', ['*']],
    ['["painel","clientes"]', ['painel', 'clientes']],
    ['[]', []],
  ])('permissions %s chega ao cliente como %j', async (raw, esperado) => {
    await semear({ permissions_raw: raw });
    expect((await entrar()).user.permissions).toEqual(esperado);
  });

  // Documenta o fail-open: qualquer coisa que não seja um array JSON vira acesso
  // total. Hoje só a própria BD escreve esta coluna (worker/routes/config.js:143
  // grava sempre um array), por isso não é explorável de fora — mas um registo
  // corrompido promove o utilizador a acesso total em vez de o bloquear.
  it.each([
    ['null', 'JSON null'],
    ['{"painel":true}', 'objeto'],
    ['"painel"', 'string JSON'],
    ['isto não é json', 'lixo'],
    ['', 'coluna vazia'],
  ])('permissions inválidas (%s — %s) caem em acesso total', async (raw) => {
    await semear({ permissions_raw: raw });
    expect((await entrar()).user.permissions).toEqual(['*']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — credenciais recusadas', () => {
  beforeEach(() => semear());

  it('recusa a password errada com 401', async () => {
    const res = await login({ email: EMAIL, password: 'Segredo123?' });
    expect(res.status).toBe(401);
    expect((await json(res)).token).toBeUndefined();
  });

  it('recusa um e-mail que não existe com 401', async () => {
    const res = await login({ email: 'ninguem@exemplo.pt', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('a mensagem de erro é idêntica nos dois casos (não revela se o e-mail existe)', async () => {
    const inexistente = await login({ email: 'ninguem@exemplo.pt', password: PASSWORD });
    const passwordErrada = await login({ email: EMAIL, password: 'errada' });
    const [a, b] = [await json(inexistente), await json(passwordErrada)];
    expect(inexistente.status).toBe(passwordErrada.status);
    expect(a).toEqual(b);
    expect(b.error).toBe('Credenciais inválidas.');
  });

  it('a resposta de erro não traz pistas sobre o utilizador', async () => {
    const corpo = await (await login({ email: EMAIL, password: 'errada' })).text();
    expect(corpo).not.toContain('Vyvian');
    expect(corpo).not.toContain('usr_dra');
  });

  it('não cria sessão no KV quando a password está errada', async () => {
    await login({ email: EMAIL, password: 'errada' });
    expect(env.SESSIONS.puts).toHaveLength(0);
  });

  it('não cria sessão no KV quando o e-mail não existe', async () => {
    await login({ email: 'ninguem@exemplo.pt', password: PASSWORD });
    expect(env.SESSIONS.puts).toHaveLength(0);
  });

  it('distingue maiúsculas na password', async () => {
    expect((await login({ email: EMAIL, password: 'segredo123!' })).status).toBe(401);
  });

  it('não ignora espaços à volta da password', async () => {
    expect((await login({ email: EMAIL, password: ` ${PASSWORD} ` })).status).toBe(401);
  });

  it('a password é comparada byte a byte, sem truncar (sufixo extra é recusado)', async () => {
    expect((await login({ email: EMAIL, password: PASSWORD + 'x' })).status).toBe(401);
  });

  it('não deixa entrar com o hash guardado em vez da password', async () => {
    const guardado = env.DB.linha('SELECT password_hash FROM users').password_hash;
    expect((await login({ email: EMAIL, password: guardado })).status).toBe(401);
  });

  it.each([
    ["' OR 1=1 --", 'injeção clássica'],
    ["dra@exemplo.pt' --", 'comentário SQL'],
    ['%', 'wildcard LIKE'],
    ['dra@exemplo.p_', 'wildcard de um caractere'],
  ])('não se deixa enganar por %s (%s)', async (email) => {
    expect((await login({ email, password: PASSWORD })).status).toBe(401);
  });

  it('sobrevive a um e-mail gigantesco (10 000 caracteres)', async () => {
    expect((await login({ email: 'a'.repeat(10000) + '@exemplo.pt', password: PASSWORD })).status).toBe(401);
  });

  // BUG (enumeração de utilizadores por tempo de resposta): com e-mail inexistente
  // a rota devolve 401 imediatamente (worker/routes/auth.js:39-41), sem correr o
  // PBKDF2 de 100 000 iterações que corre quando o e-mail existe. A diferença de
  // dezenas de milissegundos permite descobrir que contas existem no escritório.
  // Corrige-se verificando a password contra um hash-isco antes de responder.
  it.fails('devia gastar o mesmo trabalho criptográfico com um e-mail inexistente', async () => {
    const espia = vi.spyOn(crypto.subtle, 'deriveBits');
    await login({ email: 'ninguem@exemplo.pt', password: PASSWORD });
    expect(espia).toHaveBeenCalled();
  });

  // Contraprova do teste acima: com um e-mail existente o PBKDF2 corre mesmo,
  // logo a espia funciona e a falha anterior é o defeito, não o instrumento.
  it('com um e-mail existente corre mesmo o PBKDF2 antes de recusar', async () => {
    const espia = vi.spyOn(crypto.subtle, 'deriveBits');
    await login({ email: EMAIL, password: 'errada' });
    expect(espia).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — normalização do e-mail', () => {
  beforeEach(() => semear());

  it('o e-mail exatamente como está na BD entra', async () => {
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  // BUG: a consulta é `WHERE email = ?` com o valor cru (worker/routes/auth.js:34-36),
  // mas a criação de utilizadores normaliza sempre para minúsculas
  // (worker/routes/config.js:130). Quem escreva a primeira letra em maiúscula —
  // o que o teclado do telemóvel faz sozinho — leva "Credenciais inválidas."
  // Devia ser `WHERE email = lower(trim(?))` ou normalizar antes do bind.
  it.fails('devia aceitar o e-mail escrito com maiúsculas', async () => {
    expect((await login({ email: 'Dra@Exemplo.pt', password: PASSWORD })).status).toBe(200);
  });

  it.fails('devia aceitar o e-mail todo em maiúsculas', async () => {
    expect((await login({ email: EMAIL.toUpperCase(), password: PASSWORD })).status).toBe(200);
  });

  // BUG: mesma origem — o e-mail nunca é aparado. Colar o endereço com um espaço
  // à frente ou atrás (o autocompletar do telemóvel acrescenta-o) impede a entrada.
  it.fails('devia aceitar o e-mail com espaços à volta', async () => {
    expect((await login({ email: `  ${EMAIL}  `, password: PASSWORD })).status).toBe(200);
  });

  it('e-mail com espaço à volta devolve o mesmo 401 genérico (comportamento atual)', async () => {
    const res = await login({ email: ` ${EMAIL}`, password: PASSWORD });
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('Credenciais inválidas.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — corpo do pedido inválido', () => {
  beforeEach(() => semear());

  it('sem corpo nenhum devolve 400 Invalid JSON', async () => {
    const res = await rota('POST', '/api/auth/login');
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Invalid JSON');
  });

  it('com JSON malformado devolve 400 Invalid JSON', async () => {
    const res = await login('{email: dra}', { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Invalid JSON');
  });

  it('com corpo vazio devolve 400', async () => {
    expect((await login('', { headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
  });

  it.each([
    ['objeto vazio', {}],
    ['só e-mail', { email: EMAIL }],
    ['só password', { password: PASSWORD }],
    ['e-mail vazio', { email: '', password: PASSWORD }],
    ['password vazia', { email: EMAIL, password: '' }],
    ['ambos vazios', { email: '', password: '' }],
    ['e-mail null', { email: null, password: PASSWORD }],
    ['password null', { email: EMAIL, password: null }],
    ['e-mail false', { email: false, password: PASSWORD }],
    ['password zero', { email: EMAIL, password: 0 }],
  ])('%s devolve 400 a pedir os dois campos', async (_nome, corpo) => {
    const res = await login(corpo);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Preencha e-mail e palavra-passe.');
  });

  it.each([
    ['null', 'null'],
    ['número', '42'],
    ['string', '"dra@exemplo.pt"'],
    ['array', '[]'],
    ['booleano', 'true'],
  ])('corpo JSON que é apenas um %s devolve 400', async (_nome, cru) => {
    const res = await login(cru, { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Preencha e-mail e palavra-passe.');
  });

  it('campos a mais no corpo são ignorados', async () => {
    const res = await login({ email: EMAIL, password: PASSWORD, role: 'admin', permissions: ['*'], id: 'usr_x' });
    expect(res.status).toBe(200);
    expect((await json(res)).user.id).toBe('usr_dra');
  });

  it('não deixa forjar o papel (role) pelo corpo do pedido', async () => {
    await env.DB.prepare(`UPDATE users SET role = 'user'`).run();
    const { user, token } = await entrar({ email: EMAIL, password: PASSWORD, role: 'admin' });
    expect(user.role).toBe('user');
    expect(descodificar(token).role).toBe('user');
  });

  it('a password é coagida a texto: 12345 numérico valida o hash de "12345"', async () => {
    await env.DB.prepare(`UPDATE users SET password_hash = ?`).bind(await hashPassword('12345', ITER)).run();
    expect((await login({ email: EMAIL, password: 12345 })).status).toBe(200);
  });

  // BUG (robustez): o e-mail vai direto para o `.bind()` sem validação de tipo
  // (worker/routes/auth.js:36). Um objeto ou um array não é ligável a um
  // parâmetro SQL — o D1 lança, o erro sobe ao catch global do worker/index.js
  // e um anónimo recebe 500 (com detalhe interno) em vez de 400/401.
  it.fails('devia responder 400/401 a um e-mail que é um objeto, não rebentar', async () => {
    const res = await login({ email: { $ne: null }, password: PASSWORD });
    expect([400, 401]).toContain(res.status);
  });

  it.fails('devia responder 400/401 a um e-mail que é um array, não rebentar', async () => {
    const res = await login({ email: [EMAIL], password: PASSWORD });
    expect([400, 401]).toContain(res.status);
  });

  it('confirma que o e-mail não-textual rebenta mesmo (documenta o defeito acima)', async () => {
    await expect(login({ email: { $ne: null }, password: PASSWORD })).rejects.toThrow();
  });

  // O registo vem da própria BD, logo não é alcançável por um anónimo; fica
  // documentado para quem editar hashes à mão numa migração.
  it('um hash guardado com formato inválido rebenta em vez de dar 401', async () => {
    await env.DB.prepare(`UPDATE users SET password_hash = 'lixo'`).run();
    await expect(login({ email: EMAIL, password: PASSWORD })).rejects.toThrow('Invalid password hash format');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — estado da conta', () => {
  // O login lê a coluna `status` na consulta (worker/routes/auth.js:35) mas nunca
  // a verifica. Hoje só existem 'ativo' e 'convidado' (migrations/0026) e o
  // convidado tem uma password aleatória inutilizável, por isso não é explorável;
  // fica documentado porque é o que impede suspender uma conta sem a apagar.
  it('deixa entrar um utilizador ainda por convidar, se a password bater certo', async () => {
    await semear({ status: 'convidado' });
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('deixa entrar um utilizador com um status desconhecido (o campo nunca é verificado)', async () => {
    await semear({ status: 'suspenso' });
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('um utilizador sem permissões nenhumas continua a poder entrar (o corte é no frontend)', async () => {
    await semear({ permissions: [] });
    const { res, user } = await entrar();
    expect(res.status).toBe(200);
    expect(user.permissions).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {
  beforeEach(() => semear());

  it('apaga a sessão do KV', async () => {
    const { token } = await entrar();
    const { jti } = descodificar(token);
    expect(await env.SESSIONS.get(jti)).not.toBe(null);
    const res = await comToken('POST', '/api/auth/logout', token);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(await env.SESSIONS.get(jti)).toBe(null);
  });

  it('invalida o token: depois da saída o /me devolve 401', async () => {
    const { token } = await entrar();
    await comToken('POST', '/api/auth/logout', token);
    expect((await comToken('GET', '/api/auth/me', token)).status).toBe(401);
  });

  it('invalida o token também para o requireAuth', async () => {
    const { token } = await entrar();
    await comToken('POST', '/api/auth/logout', token);
    expect(await requireAuth(req('GET', '/x', { headers: { Authorization: `Bearer ${token}` } }), env)).toBe(null);
  });

  it('sair duas vezes: a segunda já devolve 401', async () => {
    const { token } = await entrar();
    expect((await comToken('POST', '/api/auth/logout', token)).status).toBe(200);
    expect((await comToken('POST', '/api/auth/logout', token)).status).toBe(401);
  });

  it('sem token devolve 401', async () => {
    const res = await rota('POST', '/api/auth/logout');
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('Unauthorized');
  });

  it.each([
    ['token inventado', 'isto-nao-e-um-jwt'],
    ['token vazio', ''],
  ])('%s devolve 401', async (_nome, token) => {
    expect((await comToken('POST', '/api/auth/logout', token)).status).toBe(401);
  });

  it('token assinado com outro segredo devolve 401 e não toca no KV', async () => {
    const { token } = await entrar();
    const { jti } = descodificar(token);
    const forjado = await signJWT({ sub: 'usr_dra', jti }, 'segredo-do-atacante', 3600);
    expect((await comToken('POST', '/api/auth/logout', forjado)).status).toBe(401);
    expect(await env.SESSIONS.get(jti)).not.toBe(null);
  });

  it('sair de um dispositivo não fecha a sessão do outro', async () => {
    const a = await entrar();
    const b = await entrar();
    await comToken('POST', '/api/auth/logout', a.token);
    expect((await comToken('GET', '/api/auth/me', a.token)).status).toBe(401);
    expect((await comToken('GET', '/api/auth/me', b.token)).status).toBe(200);
  });

  it('não apaga sessões alheias quando o jti do token não existe no KV', async () => {
    const { token } = await entrar();
    const orfao = await signJWT({ sub: 'usr_dra' }, env.JWT_SECRET, 3600); // sem jti: requireAuth não consulta o KV
    expect((await comToken('POST', '/api/auth/logout', orfao)).status).toBe(200);
    expect(await env.SESSIONS.get(descodificar(token).jti)).not.toBe(null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/me', () => {
  beforeEach(() => semear({ cargo: 'Advogada', phone: '911', permissions: ['painel', 'clientes'] }));

  it('devolve o utilizador da sessão', async () => {
    const { token } = await entrar();
    const res = await comToken('GET', '/api/auth/me', token);
    expect(res.status).toBe(200);
    expect((await json(res)).user).toEqual({
      id: 'usr_dra', email: EMAIL, name: 'Vyvian Avena', initials: 'VA', role: 'admin',
      cargo: 'Advogada', phone: '911', permissions: ['painel', 'clientes'], has_photo: false,
    });
  });

  it('não devolve token novo nem o hash da password', async () => {
    const { token } = await entrar();
    const corpo = await (await comToken('GET', '/api/auth/me', token)).text();
    expect(corpo).not.toContain('token');
    expect(corpo).not.toContain('pbkdf2');
  });

  it('lê as permissões frescas da BD, não as do momento do login', async () => {
    const { token } = await entrar();
    await env.DB.prepare(`UPDATE users SET permissions = '["painel"]'`).run();
    const b = await json(await comToken('GET', '/api/auth/me', token));
    expect(b.user.permissions).toEqual(['painel']);
  });

  it('reflete a mudança de nome sem obrigar a entrar de novo', async () => {
    const { token } = await entrar();
    await env.DB.prepare(`UPDATE users SET name = 'Vyvian A. Avena'`).run();
    expect((await json(await comToken('GET', '/api/auth/me', token))).user.name).toBe('Vyvian A. Avena');
  });

  it('sem cabeçalho Authorization devolve 401', async () => {
    const res = await rota('GET', '/api/auth/me');
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('Unauthorized');
  });

  it.each([
    ['token inventado', 'Bearer nao-e-jwt'],
    ['esquema Basic', 'Basic ZHJhOnNlZ3JlZG8='],
    ['token sem esquema', 'abc.def.ghi'],
    ['Bearer sem token', 'Bearer '],
  ])('%s devolve 401', async (_nome, cabecalho) => {
    const res = await rota('GET', '/api/auth/me', { headers: { Authorization: cabecalho } });
    expect(res.status).toBe(401);
  });

  it('token revogado (sessão apagada do KV) devolve 401', async () => {
    const { token } = await entrar();
    await env.SESSIONS.delete(descodificar(token).jti);
    expect((await comToken('GET', '/api/auth/me', token)).status).toBe(401);
  });

  it('token expirado devolve 401 mesmo com a sessão viva no KV', async () => {
    const { token } = await entrar();
    const { jti } = descodificar(token);
    const velho = await signJWT({ sub: 'usr_dra', jti }, env.JWT_SECRET, -10);
    expect((await comToken('GET', '/api/auth/me', velho)).status).toBe(401);
  });

  it('token válido de um utilizador entretanto apagado devolve 401', async () => {
    const { token } = await entrar();
    await env.DB.prepare(`DELETE FROM users WHERE id = 'usr_dra'`).run();
    expect((await comToken('GET', '/api/auth/me', token)).status).toBe(401);
  });

  it('token forjado com outro segredo devolve 401', async () => {
    const forjado = await signJWT({ sub: 'usr_dra', role: 'admin' }, 'segredo-do-atacante', 3600);
    expect((await comToken('GET', '/api/auth/me', forjado)).status).toBe(401);
  });

  it('não deixa personificar outro utilizador trocando o sub sem assinar', async () => {
    await semear({ id: 'usr_outro', email: 'outro@exemplo.pt' });
    const { token } = await entrar();
    const [h, , s] = token.split('.');
    const p = Buffer.from(JSON.stringify({ ...descodificar(token), sub: 'usr_outro' })).toString('base64url');
    expect((await comToken('GET', '/api/auth/me', `${h}.${p}.${s}`)).status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('handleAuth — métodos e rotas', () => {
  beforeEach(() => semear());

  // Nota: o OPTIONS real nunca chega aqui — o worker/index.js:63 responde ao
  // pre-flight antes de encaminhar. O que se documenta é o handler em si.

  it.each([
    ['GET', '/api/auth/login'],
    ['PUT', '/api/auth/login'],
    ['DELETE', '/api/auth/login'],
    ['PATCH', '/api/auth/login'],
    ['OPTIONS', '/api/auth/login'],
    ['GET', '/api/auth/logout'],
    ['DELETE', '/api/auth/logout'],
    ['POST', '/api/auth/me'],
    ['DELETE', '/api/auth/me'],
  ])('%s %s devolve 404 Not found', async (metodo, caminho) => {
    const res = await rota(metodo, caminho);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Not found');
  });

  it.each([
    '/api/auth/',
    '/api/auth/registar',
    '/api/auth/users',
    '/api/auth/login/',
    '/api/auth/login/extra',
    '/api/auth/LOGIN',
    '/api/auth/me/../login',
  ])('a rota desconhecida %s devolve 404', async (caminho) => {
    expect((await rota('POST', caminho, { body: { email: EMAIL, password: PASSWORD } })).status).toBe(404);
  });

  it('a rota desconhecida não cria sessão nenhuma', async () => {
    await rota('POST', '/api/auth/registar', { body: { email: EMAIL, password: PASSWORD } });
    expect(env.SESSIONS.puts).toHaveLength(0);
  });

  it('o 404 responde em JSON com CORS', async () => {
    const res = await rota('GET', '/api/auth/desconhecida');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
