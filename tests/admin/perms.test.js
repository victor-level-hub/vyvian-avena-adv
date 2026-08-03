// tests/admin/perms.test.js
// Sessão e permissões do lado do browser:
//   src/admin/auth.js   — login/logout/getSession/isAuthenticated (sessionStorage)
//   src/admin/perms.js  — podeAceder/primeiraRotaPermitida (abas visíveis)
// Sem jsdom: o sessionStorage é falsificado com vi.stubGlobal e o apiClient é
// substituído por um duplo — só a camada `auth` (rede) é que é mockada; as
// funções de token continuam a ser as verdadeiras, a escrever no armazenamento falso.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/admin/apiClient.js', async (original) => {
  const real = await original();
  return { ...real, auth: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } };
});

import { auth as apiAuth, getToken } from '../../src/admin/apiClient.js';
import { login, logout, getSession, isAuthenticated } from '../../src/admin/auth.js';
import { ROTA_PERM, podeAceder, primeiraRotaPermitida } from '../../src/admin/perms.js';

const TOKEN_KEY = 'vyvian_admin_token';
const USER_KEY = 'vyvian_admin_user';

const UTILIZADOR = {
  id: 'usr_dra',
  email: 'dra@exemplo.pt',
  name: 'Vyvian Avena',
  initials: 'VA',
  role: 'admin',
  permissions: ['*'],
};

// sessionStorage falso: guarda strings e sabe rebentar à ordem (quota cheia,
// modo privado, política do browser…).
class ArmazenamentoFalso {
  constructor() {
    this.dados = new Map();
    this.chaveQueFalhaAoGravar = null;
    this.falhaAoLer = false;
    this.falhaAoRemover = false;
  }
  getItem(k) {
    if (this.falhaAoLer) throw new Error('acesso ao armazenamento bloqueado');
    return this.dados.has(k) ? this.dados.get(k) : null;
  }
  setItem(k, v) {
    if (this.chaveQueFalhaAoGravar === k) throw new Error('QuotaExceededError');
    this.dados.set(k, String(v));
  }
  removeItem(k) {
    if (this.falhaAoRemover) throw new Error('acesso ao armazenamento bloqueado');
    this.dados.delete(k);
  }
}

let armazenamento;

// deixa o armazenamento no estado de "sessão iniciada"
function comSessao(user = UTILIZADOR, token = 'jwt-de-teste') {
  if (token !== null) armazenamento.dados.set(TOKEN_KEY, token);
  if (user !== null) armazenamento.dados.set(USER_KEY, typeof user === 'string' ? user : JSON.stringify(user));
}
const comPermissoes = (permissions) => comSessao({ ...UTILIZADOR, permissions });

beforeEach(() => {
  armazenamento = new ArmazenamentoFalso();
  vi.stubGlobal('sessionStorage', armazenamento);
  apiAuth.login.mockReset();
  apiAuth.logout.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => { vi.unstubAllGlobals(); });

// ══════════════════════════════════════════════════════════════════════════════
describe('ROTA_PERM — mapa das abas', () => {
  it('cobre as oito abas da Área Privada', () => {
    expect(Object.keys(ROTA_PERM)).toHaveLength(8);
  });

  it('todas as rotas vivem sob /admin/', () => {
    expect(Object.keys(ROTA_PERM).every((r) => r.startsWith('/admin/'))).toBe(true);
  });

  it('a primeira aba da ordem é o painel', () => {
    expect(Object.entries(ROTA_PERM)[0]).toEqual(['/admin/painel', 'painel']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('podeAceder — sessões antigas e acesso total', () => {
  // Fail-open deliberado (documentado em src/admin/perms.js:2): sem `permissions`
  // reconhecíveis mostra-se tudo, para não trancar quem tinha sessão aberta antes
  // da funcionalidade existir. Quem barra o anónimo é o isAuthenticated do
  // AdminApp.jsx:27, não esta função.
  it('sem sessão nenhuma responde que sim (retrocompatibilidade)', () => {
    expect(podeAceder('clientes')).toBe(true);
  });

  it('com sessão sem o campo permissions responde que sim', () => {
    comSessao({ id: 'usr_antigo', name: 'Sessão antiga' });
    expect(podeAceder('configuracoes')).toBe(true);
  });

  it.each(Object.values(ROTA_PERM))('com ["*"] entra em %s', (chave) => {
    comPermissoes(['*']);
    expect(podeAceder(chave)).toBe(true);
  });

  it('o curinga funciona no meio de uma lista', () => {
    comPermissoes(['apoio', '*']);
    expect(podeAceder('configuracoes')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('podeAceder — listas específicas', () => {
  it('deixa entrar na aba que consta da lista', () => {
    comPermissoes(['clientes', 'parcelas']);
    expect(podeAceder('clientes')).toBe(true);
    expect(podeAceder('parcelas')).toBe(true);
  });

  it('barra as abas que não constam da lista', () => {
    comPermissoes(['clientes', 'parcelas']);
    expect(podeAceder('configuracoes')).toBe(false);
    expect(podeAceder('estatisticas')).toBe(false);
  });

  it('lista vazia não dá acesso a nada', () => {
    comPermissoes([]);
    expect(Object.values(ROTA_PERM).some((k) => podeAceder(k))).toBe(false);
  });

  it('distingue maiúsculas na chave da permissão', () => {
    comPermissoes(['Clientes']);
    expect(podeAceder('clientes')).toBe(false);
  });

  it('não faz correspondência parcial ("client" não abre "clientes")', () => {
    comPermissoes(['client']);
    expect(podeAceder('clientes')).toBe(false);
  });

  it('aceita permissões especiais fora do mapa das abas', () => {
    comPermissoes(['gerir_utilizadores']);
    expect(podeAceder('gerir_utilizadores')).toBe(true);
    expect(podeAceder('painel')).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string vazia', ''],
  ])('chave %s não abre nada numa lista específica', (_nome, chave) => {
    comPermissoes(['clientes']);
    expect(podeAceder(chave)).toBe(false);
  });

  it('relê a sessão a cada chamada (uma mudança de permissões nota-se logo)', () => {
    comPermissoes(['clientes']);
    expect(podeAceder('apoio')).toBe(false);
    comPermissoes(['clientes', 'apoio']);
    expect(podeAceder('apoio')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('podeAceder — permissions com o tipo errado', () => {
  // O teste é `Array.isArray(perms)`: tudo o que não seja array cai na
  // retrocompatibilidade e vê tudo. O worker já garante um array
  // (worker/routes/auth.js:76-77), por isso não é alcançável a partir da API.
  it.each([
    ['string', 'clientes'],
    ['objeto', { clientes: true }],
    ['null', null],
    ['número', 3],
    ['booleano', true],
    ['string vazia', ''],
  ])('permissions do tipo %s cai no acesso total', (_nome, permissions) => {
    comSessao({ ...UTILIZADOR, permissions });
    expect(podeAceder('configuracoes')).toBe(true);
  });

  it('sessão corrompida no sessionStorage também cai no acesso total', () => {
    comSessao('{isto não é json');
    expect(podeAceder('configuracoes')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('primeiraRotaPermitida', () => {
  it('com acesso total abre no painel', () => {
    comPermissoes(['*']);
    expect(primeiraRotaPermitida()).toBe('/admin/painel');
  });

  it.each([
    [['painel'], '/admin/painel'],
    [['clientes'], '/admin/clientes'],
    [['parcelas'], '/admin/parcelas'],
    [['calendario'], '/admin/calendario'],
    [['notificacoes'], '/admin/notificacoes'],
    [['estatisticas'], '/admin/estatisticas'],
    [['apoio'], '/admin/apoio'],
    [['configuracoes'], '/admin/configuracoes'],
  ])('com %j abre em %s', (permissions, rota) => {
    comPermissoes(permissions);
    expect(primeiraRotaPermitida()).toBe(rota);
  });

  it('segue a ordem do mapa, não a ordem da lista de permissões', () => {
    comPermissoes(['configuracoes', 'apoio', 'clientes']);
    expect(primeiraRotaPermitida()).toBe('/admin/clientes');
  });

  it('sem permissão para nada manda para o login', () => {
    comPermissoes([]);
    expect(primeiraRotaPermitida()).toBe('/admin/login');
  });

  it('com permissões que não correspondem a aba nenhuma manda para o login', () => {
    comPermissoes(['gerir_utilizadores']);
    expect(primeiraRotaPermitida()).toBe('/admin/login');
  });

  it('sem sessão devolve o painel (mesma retrocompatibilidade do podeAceder)', () => {
    expect(primeiraRotaPermitida()).toBe('/admin/painel');
  });

  it('devolve sempre uma rota conhecida ou o login', () => {
    comPermissoes(['apoio']);
    const r = primeiraRotaPermitida();
    expect([...Object.keys(ROTA_PERM), '/admin/login']).toContain(r);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('login', () => {
  const respostaBoa = { token: 'jwt-novo', user: UTILIZADOR };

  it('entra e guarda o token e o utilizador no sessionStorage', async () => {
    apiAuth.login.mockResolvedValue(respostaBoa);
    const r = await login('dra@exemplo.pt', 'Segredo123!');
    expect(r).toEqual({ ok: true, session: UTILIZADOR });
    expect(armazenamento.dados.get(TOKEN_KEY)).toBe('jwt-novo');
    expect(JSON.parse(armazenamento.dados.get(USER_KEY))).toEqual(UTILIZADOR);
  });

  it('guarda as permissões que vieram da API', async () => {
    apiAuth.login.mockResolvedValue({ token: 't', user: { ...UTILIZADOR, permissions: ['painel', 'apoio'] } });
    await login('dra@exemplo.pt', 'x');
    expect(getSession().permissions).toEqual(['painel', 'apoio']);
    expect(podeAceder('apoio')).toBe(true);
    expect(podeAceder('clientes')).toBe(false);
  });

  it('depois de entrar fica autenticada', async () => {
    apiAuth.login.mockResolvedValue(respostaBoa);
    await login('dra@exemplo.pt', 'Segredo123!');
    expect(isAuthenticated()).toBe(true);
  });

  it('nunca guarda a password no armazenamento', async () => {
    apiAuth.login.mockResolvedValue(respostaBoa);
    await login('dra@exemplo.pt', 'Segredo123!');
    expect(JSON.stringify([...armazenamento.dados])).not.toContain('Segredo123!');
  });

  it.each([
    ['e-mail vazio', '', 'x'],
    ['password vazia', 'dra@exemplo.pt', ''],
    ['ambos vazios', '', ''],
    ['e-mail undefined', undefined, 'x'],
    ['password undefined', 'dra@exemplo.pt', undefined],
    ['e-mail null', null, 'x'],
    ['password null', 'dra@exemplo.pt', null],
  ])('%s devolve erro sem chamar a API', async (_nome, email, password) => {
    const r = await login(email, password);
    expect(r).toEqual({ ok: false, error: 'Preencha e-mail e palavra-passe.' });
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  it('campos em falta não tocam no que já estava guardado', async () => {
    comSessao();
    await login('', '');
    expect(armazenamento.dados.get(TOKEN_KEY)).toBe('jwt-de-teste');
  });

  it.each([
    ['resposta sem token', { user: UTILIZADOR }],
    ['resposta sem user', { token: 'jwt-novo' }],
    ['resposta vazia', {}],
    ['token vazio', { token: '', user: UTILIZADOR }],
    ['user null', { token: 'jwt-novo', user: null }],
  ])('%s devolve "Resposta inválida do servidor."', async (_nome, resposta) => {
    apiAuth.login.mockResolvedValue(resposta);
    expect(await login('dra@exemplo.pt', 'x')).toEqual({ ok: false, error: 'Resposta inválida do servidor.' });
  });

  it('uma resposta inválida não deixa nada guardado', async () => {
    apiAuth.login.mockResolvedValue({ user: UTILIZADOR });
    await login('dra@exemplo.pt', 'x');
    expect(armazenamento.dados.size).toBe(0);
    expect(isAuthenticated()).toBe(false);
  });

  it('propaga a mensagem de credenciais recusadas vinda da API', async () => {
    apiAuth.login.mockRejectedValue(Object.assign(new Error('Credenciais inválidas.'), { status: 401 }));
    expect(await login('dra@exemplo.pt', 'errada')).toEqual({ ok: false, error: 'Credenciais inválidas.' });
  });

  it('erro de rede devolve a mensagem do erro sem rebentar', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await login('dra@exemplo.pt', 'x')).toEqual({ ok: false, error: 'Failed to fetch' });
  });

  it.each([
    ['erro sem mensagem', new Error('')],
    ['objeto lançado em vez de erro', { status: 500 }],
  ])('%s cai na mensagem genérica', async (_nome, falha) => {
    apiAuth.login.mockRejectedValue(falha);
    expect(await login('dra@exemplo.pt', 'x')).toEqual({ ok: false, error: 'Erro de comunicação.' });
  });

  it('erro de rede não deixa sessão pendurada', async () => {
    apiAuth.login.mockRejectedValue(new Error('rede em baixo'));
    await login('dra@exemplo.pt', 'x');
    expect(isAuthenticated()).toBe(false);
  });

  it('uma resposta nula não rebenta a aplicação, só falha o login', async () => {
    apiAuth.login.mockResolvedValue(null);
    expect((await login('dra@exemplo.pt', 'x')).ok).toBe(false);
  });

  // O e-mail segue tal e qual para a API — nem o browser nem o worker o aparam
  // ou passam a minúsculas (ver o BUG documentado em tests/worker/rota-auth.test.js,
  // "normalização do e-mail"). Aqui fica registado o lado do browser.
  it('envia o e-mail exatamente como foi escrito, sem aparar nem baixar as maiúsculas', async () => {
    apiAuth.login.mockResolvedValue(respostaBoa);
    await login('  Dra@Exemplo.pt  ', 'Segredo123!');
    expect(apiAuth.login).toHaveBeenCalledWith('  Dra@Exemplo.pt  ', 'Segredo123!');
  });

  it('chama a API uma única vez', async () => {
    apiAuth.login.mockResolvedValue(respostaBoa);
    await login('dra@exemplo.pt', 'x');
    expect(apiAuth.login).toHaveBeenCalledTimes(1);
  });

  it('substitui a sessão anterior ao entrar com outra conta', async () => {
    comSessao();
    const outro = { ...UTILIZADOR, id: 'usr_outro', email: 'outro@exemplo.pt', permissions: ['painel'] };
    apiAuth.login.mockResolvedValue({ token: 'jwt-outro', user: outro });
    await login('outro@exemplo.pt', 'x');
    expect(getSession()).toEqual(outro);
    expect(getToken()).toBe('jwt-outro');
  });

  // Documenta um estado intermédio: o token é gravado antes do utilizador; se a
  // gravação do utilizador falhar (quota/modo privado), o login devolve erro mas
  // o token fica no armazenamento. Não abre a Área Privada — o isAuthenticated
  // exige token E sessão — mas convém saber que o resíduo existe.
  it('se a gravação do utilizador falhar, o login falha e o token fica pendurado', async () => {
    armazenamento.chaveQueFalhaAoGravar = USER_KEY;
    apiAuth.login.mockResolvedValue(respostaBoa);
    const r = await login('dra@exemplo.pt', 'x');
    expect(r.ok).toBe(false);
    expect(armazenamento.dados.get(TOKEN_KEY)).toBe('jwt-novo');
    expect(isAuthenticated()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('logout', () => {
  beforeEach(() => comSessao());

  it('limpa o token e o utilizador', async () => {
    await logout();
    expect(armazenamento.dados.has(TOKEN_KEY)).toBe(false);
    expect(armazenamento.dados.has(USER_KEY)).toBe(false);
  });

  it('avisa o servidor para revogar a sessão', async () => {
    await logout();
    expect(apiAuth.logout).toHaveBeenCalledTimes(1);
  });

  it('limpa tudo mesmo quando a API rebenta', async () => {
    apiAuth.logout.mockRejectedValue(new Error('500 no servidor'));
    await expect(logout()).resolves.toBeUndefined();
    expect(armazenamento.dados.size).toBe(0);
    expect(isAuthenticated()).toBe(false);
  });

  it('limpa tudo mesmo sem rede nenhuma', async () => {
    apiAuth.logout.mockRejectedValue(new TypeError('Failed to fetch'));
    await logout();
    expect(getSession()).toBe(null);
  });

  it('não rebenta quando o armazenamento recusa apagar', async () => {
    armazenamento.falhaAoRemover = true;
    await expect(logout()).resolves.toBeUndefined();
  });

  it('sair sem sessão nenhuma não rebenta', async () => {
    armazenamento.dados.clear();
    await expect(logout()).resolves.toBeUndefined();
  });

  it('sair duas vezes é idempotente', async () => {
    await logout();
    await expect(logout()).resolves.toBeUndefined();
    expect(armazenamento.dados.size).toBe(0);
  });

  it('depois de sair deixa de estar autenticada', async () => {
    expect(isAuthenticated()).toBe(true);
    await logout();
    expect(isAuthenticated()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('getSession', () => {
  it('devolve o utilizador guardado', () => {
    comSessao();
    expect(getSession()).toEqual(UTILIZADOR);
  });

  it('sem token devolve null, mesmo com o utilizador guardado', () => {
    comSessao(UTILIZADOR, null);
    expect(getSession()).toBe(null);
  });

  it('com token vazio devolve null', () => {
    comSessao(UTILIZADOR, '');
    expect(getSession()).toBe(null);
  });

  it('com token mas sem utilizador guardado devolve null', () => {
    comSessao(null, 'jwt-de-teste');
    expect(getSession()).toBe(null);
  });

  it.each([
    ['JSON truncado', '{"id":"usr_dra"'],
    ['texto solto', 'sessão'],
    ['JSON com aspas erradas', "{'id':'usr_dra'}"],
    ['string vazia', ''],
  ])('com o utilizador corrompido (%s) devolve null em vez de rebentar', (_nome, cru) => {
    comSessao(cru);
    expect(() => getSession()).not.toThrow();
    expect(getSession()).toBe(null);
  });

  it('com o utilizador gravado como "null" devolve null', () => {
    comSessao('null');
    expect(getSession()).toBe(null);
  });

  it('quando o armazenamento recusa ler devolve null', () => {
    comSessao();
    armazenamento.falhaAoLer = true;
    expect(getSession()).toBe(null);
  });

  it('sem sessionStorage nenhum (render no servidor) devolve null', () => {
    vi.unstubAllGlobals();
    expect(getSession()).toBe(null);
  });

  it('não valida o formato: devolve o que estiver lá guardado', () => {
    comSessao('[1,2,3]');
    expect(getSession()).toEqual([1, 2, 3]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('isAuthenticated', () => {
  it.each([
    ['token e sessão válidos', 'jwt-de-teste', JSON.stringify(UTILIZADOR), true],
    ['token sem sessão', 'jwt-de-teste', null, false],
    ['sessão sem token', null, JSON.stringify(UTILIZADOR), false],
    ['nem token nem sessão', null, null, false],
    ['token vazio com sessão', '', JSON.stringify(UTILIZADOR), false],
    ['token válido com sessão corrompida', 'jwt-de-teste', '{corrompido', false],
    ['token válido com sessão "null"', 'jwt-de-teste', 'null', false],
  ])('%s → %s', (_nome, token, user, esperado) => {
    if (token !== null) armazenamento.dados.set(TOKEN_KEY, token);
    if (user !== null) armazenamento.dados.set(USER_KEY, user);
    expect(isAuthenticated()).toBe(esperado);
  });

  it('sem armazenamento nenhum devolve false', () => {
    vi.unstubAllGlobals();
    expect(isAuthenticated()).toBe(false);
  });

  it('quando o armazenamento recusa ler devolve false', () => {
    comSessao();
    armazenamento.falhaAoLer = true;
    expect(isAuthenticated()).toBe(false);
  });

  // Não valida o JWT — só confirma que lá está alguma coisa. A validação a sério
  // é do worker (requireAuth), que devolve 401 a qualquer token inventado.
  it('um token inventado à mão passa esta verificação (a validação é do servidor)', () => {
    comSessao(UTILIZADOR, 'nem-sequer-e-um-jwt');
    expect(isAuthenticated()).toBe(true);
  });
});
