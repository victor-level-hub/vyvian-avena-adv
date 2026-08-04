// @vitest-environment jsdom
// tests/admin/login-ui.test.jsx
// O ecrã de entrada da Área Privada (src/admin/pages/Login.jsx) — a única porta
// da aplicação. Aqui testa-se o que a Dra. vê e faz: escrever, submeter, receber
// a mensagem certa quando corre mal, e não ficar a olhar para um botão morto.
//
// A lógica pura de `auth.login` já está coberta em tests/admin/perms.test.js;
// o que se testa aqui é a LIGAÇÃO: o formulário chega mesmo à API, a sessão
// fica mesmo guardada, o erro aparece mesmo no ecrã.
//
// Rede: só o objeto `auth` do apiClient é substituído — as funções de token
// continuam a ser as verdadeiras, a escrever no sessionStorage do jsdom. Nenhum
// teste chega ao fetch (tests/setup.js rebentaria).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderizar, screen, act, fireEvent, waitFor } from '../helpers/dom.jsx';

const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));

vi.mock('react-router-dom', async (original) => {
  const real = await original();
  return { ...real, useNavigate: () => navegou };
});

vi.mock('../../src/admin/apiClient.js', async (original) => {
  const real = await original();
  return { ...real, auth: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } };
});

import { auth as apiAuth } from '../../src/admin/apiClient.js';
import Login from '../../src/admin/pages/Login.jsx';

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
const RESPOSTA_BOA = { token: 'jwt-novo', user: UTILIZADOR };

beforeEach(() => {
  sessionStorage.clear();
  navegou.mockReset();
  apiAuth.login.mockReset();
  apiAuth.logout.mockReset();
});

// ── utilitários ──────────────────────────────────────────────────────────────
// Os campos não têm etiqueta ligada (ver o BUG mais abaixo), por isso as
// consultas vão pelo `autocomplete`, que é estável e não depende de CSS.
function montar() {
  const vista = renderizar(<Login />);
  const email = () => vista.container.querySelector('input[autocomplete="email"]');
  const palavraPasse = () => vista.container.querySelector('input[autocomplete="current-password"]');
  const botao = () => screen.getByRole('button', { name: /^(Entrar|A entrar\.\.\.)$/ });
  const erro = () => vista.container.querySelector('.adm-login-error');
  return { ...vista, email, palavraPasse, botao, erro };
}

// Preenche o formulário e submete pelo botão.
async function entrar(v, { email = 'dra@exemplo.pt', password = 'Segredo123!' } = {}) {
  await v.utilizador.clear(v.email());
  if (email) await v.utilizador.type(v.email(), email);
  if (password) await v.utilizador.type(v.palavraPasse(), password);
  await v.utilizador.click(v.botao());
}

// Promessa que fica pendente até o teste mandar — para observar o "A entrar...".
function promessaPendente() {
  let resolver, rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('o formulário que a Dra. vê', () => {
  it('mostra o logótipo do escritório', () => {
    montar();
    expect(screen.getByAltText('Vyvian Avena Advogada')).toBeInTheDocument();
  });

  it('mostra a etiqueta do e-mail', () => {
    montar();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
  });

  it('mostra a etiqueta da palavra-passe', () => {
    montar();
    expect(screen.getByText('Palavra-passe')).toBeInTheDocument();
  });

  it('tem um campo de e-mail (teclado de e-mail no telemóvel)', () => {
    const v = montar();
    expect(v.email()).toHaveAttribute('type', 'email');
  });

  it('tem um campo de palavra-passe escondido', () => {
    const v = montar();
    expect(v.palavraPasse()).toHaveAttribute('type', 'password');
  });

  it('o e-mail é de preenchimento obrigatório', () => {
    const v = montar();
    expect(v.email()).toBeRequired();
  });

  it('a palavra-passe é de preenchimento obrigatório', () => {
    const v = montar();
    expect(v.palavraPasse()).toBeRequired();
  });

  it('deixa o gestor de palavras-passe preencher (autocomplete)', () => {
    const v = montar();
    expect(v.email()).toHaveAttribute('autocomplete', 'email');
    expect(v.palavraPasse()).toHaveAttribute('autocomplete', 'current-password');
  });

  it('o botão diz «Entrar»', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('o botão submete o formulário', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveAttribute('type', 'submit');
  });

  it('há exatamente um formulário no ecrã', () => {
    const v = montar();
    expect(v.container.querySelectorAll('form')).toHaveLength(1);
  });

  it('vem pré-preenchido com o e-mail da titular (poupa-lhe a escrita)', () => {
    const v = montar();
    expect(v.email()).toHaveValue('vyvian@vyvianavena.com');
  });

  it('a palavra-passe começa sempre vazia', () => {
    const v = montar();
    expect(v.palavraPasse()).toHaveValue('');
  });

  it('não mostra mensagem de erro ao abrir', () => {
    const v = montar();
    expect(v.erro()).toBe(null);
  });

  it('mostra o aviso de acesso restrito', () => {
    montar();
    expect(screen.getByText(/Acesso restrito/)).toBeInTheDocument();
  });

  it('nada no ecrã está desativado antes de submeter', () => {
    const v = montar();
    expect(v.email()).toBeEnabled();
    expect(v.palavraPasse()).toBeEnabled();
    expect(v.botao()).toBeEnabled();
  });

  // CORRIGIDO (era, acessibilidade) — src/admin/pages/Login.jsx:51 e :62: os <label> não têm
  // `htmlFor` e não envolvem o campo, por isso não estão ligados a nada. Um leitor
  // de ecrã anuncia "campo de edição" sem dizer qual, e clicar na etiqueta não
  // foca o campo. Devia ser <label htmlFor="email"> + <input id="email">.
  it('as etiquetas deviam estar ligadas aos campos', () => {
    montar();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Palavra-passe')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('entrar com as credenciais certas', () => {
  beforeEach(() => { apiAuth.login.mockResolvedValue(RESPOSTA_BOA); });

  it('envia à API o que foi escrito', async () => {
    const v = montar();
    await entrar(v, { email: 'dra@exemplo.pt', password: 'Segredo123!' });
    expect(apiAuth.login).toHaveBeenCalledWith('dra@exemplo.pt', 'Segredo123!');
  });

  it('chama a API uma única vez', async () => {
    const v = montar();
    await entrar(v);
    expect(apiAuth.login).toHaveBeenCalledTimes(1);
  });

  it('guarda o token da sessão', async () => {
    const v = montar();
    await entrar(v);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('jwt-novo');
  });

  it('guarda o utilizador da sessão', async () => {
    const v = montar();
    await entrar(v);
    expect(JSON.parse(sessionStorage.getItem(USER_KEY))).toEqual(UTILIZADOR);
  });

  it('guarda as permissões que vieram da API', async () => {
    apiAuth.login.mockResolvedValue({ token: 't', user: { ...UTILIZADOR, permissions: ['apoio'] } });
    const v = montar();
    await entrar(v);
    expect(JSON.parse(sessionStorage.getItem(USER_KEY)).permissions).toEqual(['apoio']);
  });

  it('sai do login e entra na Área Privada', async () => {
    const v = montar();
    await entrar(v);
    expect(navegou).toHaveBeenCalledWith('/admin/painel');
  });

  it('navega uma só vez', async () => {
    const v = montar();
    await entrar(v);
    expect(navegou).toHaveBeenCalledTimes(1);
  });

  it('não mostra erro nenhum', async () => {
    const v = montar();
    await entrar(v);
    expect(v.erro()).toBe(null);
  });

  it('nunca guarda a palavra-passe no armazenamento', async () => {
    const v = montar();
    await entrar(v, { password: 'Segredo123!' });
    const tudo = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join('|');
    expect(tudo).not.toContain('Segredo123!');
  });

  it('substitui o e-mail pré-preenchido pelo que a Dra. escrever', async () => {
    const v = montar();
    await entrar(v, { email: 'outra@exemplo.pt' });
    expect(apiAuth.login).toHaveBeenCalledWith('outra@exemplo.pt', 'Segredo123!');
  });

  it('aceita o e-mail pré-preenchido sem lhe tocar', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).toHaveBeenCalledWith('vyvian@vyvianavena.com', 'Segredo123!');
  });

  it('Enter no campo do e-mail submete o formulário', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.type(v.email(), '{Enter}');
    await waitFor(() => expect(apiAuth.login).toHaveBeenCalledTimes(1));
  });

  it('Enter no campo da palavra-passe submete o formulário', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!{Enter}');
    await waitFor(() => expect(apiAuth.login).toHaveBeenCalledTimes(1));
  });

  it('Enter chega a navegar para a Área Privada', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!{Enter}');
    await waitFor(() => expect(navegou).toHaveBeenCalledWith('/admin/painel'));
  });

  // CORRIGIDO (era) — src/admin/pages/Login.jsx:21: o destino está fixo em '/admin/painel'
  // em vez de `primeiraRotaPermitida()` (src/admin/perms.js:23). Quem não tem a
  // aba «Painel» aterra numa rota proibida e só não fica preso porque o PermGate
  // (AdminApp.jsx:35) o atira logo para outro lado — e quem não tem aba nenhuma
  // é devolvido ao ecrã de login já autenticado.
  it('abre na primeira aba permitida, não sempre no painel', async () => {
    apiAuth.login.mockResolvedValue({ token: 't', user: { ...UTILIZADOR, permissions: ['apoio'] } });
    const v = montar();
    await entrar(v);
    expect(navegou).toHaveBeenCalledWith('/admin/apoio');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('credenciais recusadas', () => {
  const recusar = (mensagem = 'Credenciais inválidas.') =>
    apiAuth.login.mockRejectedValue(Object.assign(new Error(mensagem), { status: 401 }));

  it('mostra a mensagem que veio do servidor', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(await screen.findByText('Credenciais inválidas.')).toBeInTheDocument();
  });

  it('não deixa entrar na Área Privada', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(navegou).not.toHaveBeenCalled();
  });

  it('não guarda sessão nenhuma', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(null);
    expect(sessionStorage.getItem(USER_KEY)).toBe(null);
  });

  it('mantém o e-mail escrito para a Dra. só corrigir a palavra-passe', async () => {
    recusar();
    const v = montar();
    await entrar(v, { email: 'dra@exemplo.pt', password: 'errada' });
    expect(v.email()).toHaveValue('dra@exemplo.pt');
  });

  it('devolve o botão ao estado normal para tentar de novo', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('reativa os campos para os poder corrigir', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    await waitFor(() => expect(v.palavraPasse()).toBeEnabled());
    expect(v.email()).toBeEnabled();
  });

  it('a segunda tentativa, certa, apaga a mensagem de erro', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(await screen.findByText('Credenciais inválidas.')).toBeInTheDocument();
    apiAuth.login.mockReset().mockResolvedValue(RESPOSTA_BOA);
    await v.utilizador.type(v.palavraPasse(), 'certa');
    await v.utilizador.click(v.botao());
    await waitFor(() => expect(v.erro()).toBe(null));
  });

  it('a segunda tentativa, certa, entra mesmo', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    apiAuth.login.mockReset().mockResolvedValue(RESPOSTA_BOA);
    await v.utilizador.type(v.palavraPasse(), 'certa');
    await v.utilizador.click(v.botao());
    await waitFor(() => expect(navegou).toHaveBeenCalledWith('/admin/painel'));
  });

  it('um erro atrás do outro mostra sempre a mensagem mais recente', async () => {
    recusar('Credenciais inválidas.');
    const v = montar();
    await entrar(v, { password: 'errada' });
    expect(await screen.findByText('Credenciais inválidas.')).toBeInTheDocument();
    apiAuth.login.mockReset().mockRejectedValue(Object.assign(new Error('Conta bloqueada.'), { status: 423 }));
    await v.utilizador.type(v.palavraPasse(), 'x');
    await v.utilizador.click(v.botao());
    expect(await screen.findByText('Conta bloqueada.')).toBeInTheDocument();
    expect(screen.queryByText('Credenciais inválidas.')).not.toBeInTheDocument();
  });

  it.each([
    ['resposta sem token', { user: UTILIZADOR }],
    ['resposta sem utilizador', { token: 'jwt-novo' }],
    ['resposta vazia', {}],
    ['token vazio', { token: '', user: UTILIZADOR }],
  ])('%s mostra «Resposta inválida do servidor.»', async (_nome, resposta) => {
    apiAuth.login.mockResolvedValue(resposta);
    const v = montar();
    await entrar(v);
    expect(await screen.findByText('Resposta inválida do servidor.')).toBeInTheDocument();
    expect(navegou).not.toHaveBeenCalled();
  });

  it('mostra a mensagem de conta desativada vinda do worker (403)', async () => {
    apiAuth.login.mockRejectedValue(Object.assign(new Error('Conta desativada.'), { status: 403 }));
    const v = montar();
    await entrar(v);
    expect(await screen.findByText('Conta desativada.')).toBeInTheDocument();
  });

  it('só há uma caixa de erro no ecrã', async () => {
    recusar();
    const v = montar();
    await entrar(v, { password: 'errada' });
    await screen.findByText('Credenciais inválidas.');
    expect(v.container.querySelectorAll('.adm-login-error')).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('quando a rede falha', () => {
  it('mostra uma mensagem em vez de ficar calado', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    expect(v.erro().textContent.trim()).not.toBe('');
  });

  it('a mensagem não é «undefined»', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    expect(v.erro().textContent).not.toMatch(/undefined|null|\[object/i);
  });

  it('a mensagem não despeja o rasto da pilha', async () => {
    const falha = new TypeError('Failed to fetch');
    falha.stack = 'TypeError: Failed to fetch\n    at request (apiClient.js:26:15)';
    apiAuth.login.mockRejectedValue(falha);
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    expect(v.erro().textContent).not.toMatch(/\bat .+\.js:\d+/);
  });

  it.each([
    ['erro sem mensagem', new Error('')],
    ['objeto lançado em vez de erro', { status: 500 }],
    ['string lançada', 'rebentou'],
  ])('%s cai na mensagem genérica «Erro de comunicação.»', async (_nome, falha) => {
    apiAuth.login.mockRejectedValue(falha);
    const v = montar();
    await entrar(v);
    expect(await screen.findByText('Erro de comunicação.')).toBeInTheDocument();
  });

  it('erro do servidor (500) mostra o que o worker disse', async () => {
    apiAuth.login.mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500 }));
    const v = montar();
    await entrar(v);
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
  });

  it('não deixa sessão pendurada', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    expect(sessionStorage.length).toBe(0);
  });

  it('não navega para lado nenhum', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    expect(navegou).not.toHaveBeenCalled();
  });

  it('deixa tentar outra vez quando a rede voltar', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    await waitFor(() => expect(v.erro()).not.toBe(null));
    apiAuth.login.mockReset().mockResolvedValue(RESPOSTA_BOA);
    await v.utilizador.click(v.botao());
    await waitFor(() => expect(navegou).toHaveBeenCalledWith('/admin/painel'));
  });

  // Comportamento documentado (não é ideal, mas também não é falso): a mensagem
  // do browser vai tal e qual para o ecrã. Numa falha de rede a Dra. lê o
  // "Failed to fetch" do Chrome, em inglês. Fica registado para quando se quiser
  // traduzir em src/admin/auth.js:22.
  it('a mensagem técnica do browser chega tal e qual à Dra.', async () => {
    apiAuth.login.mockRejectedValue(new TypeError('Failed to fetch'));
    const v = montar();
    await entrar(v);
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('enquanto está a entrar', () => {
  it('o botão passa a dizer «A entrar...»', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    expect(screen.getByRole('button', { name: 'A entrar...' })).toBeInTheDocument();
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('o botão fica desativado', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    expect(v.botao()).toBeDisabled();
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('os campos ficam desativados (não se muda o e-mail a meio)', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    expect(v.email()).toBeDisabled();
    expect(v.palavraPasse()).toBeDisabled();
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('clicar duas vezes seguidas não faz dois pedidos', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    await v.utilizador.click(v.botao());
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).toHaveBeenCalledTimes(1);
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('carregar em Enter a meio da submissão também não repete o pedido', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    await v.utilizador.keyboard('{Enter}');
    expect(apiAuth.login).toHaveBeenCalledTimes(1);
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('não navega antes de a API responder', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    expect(navegou).not.toHaveBeenCalled();
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  it('quando corre bem, o botão volta a «Entrar»', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    await act(async () => { resolver(RESPOSTA_BOA); });
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('quando corre mal, o botão volta a «Entrar» e reativa', async () => {
    const { promessa, rejeitar } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    expect(v.botao()).toBeDisabled();
    await act(async () => { rejeitar(new Error('Credenciais inválidas.')); });
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('a mensagem de erro anterior desaparece assim que se volta a submeter', async () => {
    apiAuth.login.mockRejectedValue(new Error('Credenciais inválidas.'));
    const v = montar();
    await entrar(v, { password: 'errada' });
    await screen.findByText('Credenciais inválidas.');
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReset().mockReturnValue(promessa);
    await v.utilizador.click(v.botao());
    expect(v.erro()).toBe(null);
    await act(async () => { resolver(RESPOSTA_BOA); });
  });

  // Comportamento documentado: quem trava a segunda submissão é o `disabled` dos
  // campos e do botão — o `handleSubmit` (src/admin/pages/Login.jsx:14) não olha
  // ao `loading`. Um submit disparado por código (extensão, script) passa ao lado.
  // Pelo rato e pelo teclado não é alcançável, por isso fica registado e não
  // marcado como defeito.
  it('um submit disparado por código durante a espera passa ao lado do bloqueio', async () => {
    const { promessa, resolver } = promessaPendente();
    apiAuth.login.mockReturnValue(promessa);
    const v = montar();
    await entrar(v);
    await act(async () => { fireEvent.submit(v.container.querySelector('form')); });
    expect(apiAuth.login).toHaveBeenCalledTimes(2);
    await act(async () => { resolver(RESPOSTA_BOA); });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('a palavra-passe não fica à vista', () => {
  it('está escondida por omissão', () => {
    const v = montar();
    expect(v.palavraPasse()).toHaveAttribute('type', 'password');
  });

  it('o que se escreve não aparece fora do próprio campo', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    const html = v.container.innerHTML.replace(/<input[^>]*type="password"[^>]*>/g, '');
    expect(html).not.toContain('Segredo123!');
  });

  // Achado a registar (não é defeito deste código, é como o React trata campos
  // controlados): o valor escrito também fica no atributo `value=` do HTML, não
  // só na propriedade. O campo continua mascarado no ecrã, mas qualquer coisa
  // que serialize o DOM — gravação de sessão, relatório de erro com HTML,
  // extensão do browser — leva a palavra-passe em claro. Se um dia se juntar
  // analítica de sessão à Área Privada, este é o sítio a rever.
  it('o valor escrito fica no atributo value do campo (relevante para gravações de sessão)', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    expect(v.palavraPasse().getAttribute('value')).toBe('Segredo123!');
    expect(v.palavraPasse()).toHaveAttribute('type', 'password');
  });

  it('o que se escreve não aparece como texto visível', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    expect(screen.queryByText('Segredo123!')).not.toBeInTheDocument();
  });

  it('o olho revela a palavra-passe quando a Dra. quer conferir', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(screen.getByRole('button', { name: 'Mostrar palavra-passe' }));
    expect(v.palavraPasse()).toHaveAttribute('type', 'text');
  });

  it('o olho volta a escondê-la', async () => {
    const v = montar();
    await v.utilizador.click(screen.getByRole('button', { name: 'Mostrar palavra-passe' }));
    await v.utilizador.click(screen.getByRole('button', { name: 'Ocultar palavra-passe' }));
    expect(v.palavraPasse()).toHaveAttribute('type', 'password');
  });

  it('o olho não submete o formulário sem querer', async () => {
    apiAuth.login.mockResolvedValue(RESPOSTA_BOA);
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(screen.getByRole('button', { name: 'Mostrar palavra-passe' }));
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  it('o olho fica fora da navegação por Tab', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Mostrar palavra-passe' })).toHaveAttribute('tabIndex', '-1');
  });

  it('depois de entrar continua escondida (nada a revela)', async () => {
    apiAuth.login.mockResolvedValue(RESPOSTA_BOA);
    const v = montar();
    await entrar(v);
    expect(v.palavraPasse()).toHaveAttribute('type', 'password');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('espaços e maiúsculas no e-mail', () => {
  beforeEach(() => { apiAuth.login.mockResolvedValue(RESPOSTA_BOA); });

  // O campo `type="email"` do browser apara sozinho os espaços à volta (regra de
  // saneamento do HTML), por isso um endereço colado com espaços chega limpo à
  // API. É a interface a tapar o buraco do worker (ver o BUG da normalização em
  // tests/worker/rota-auth.test.js).
  it('o campo apara os espaços à volta do que é escrito', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.type(v.email(), '  dra@exemplo.pt  ');
    expect(v.email()).toHaveValue('dra@exemplo.pt');
  });

  it('a API recebe o e-mail sem os espaços colados', async () => {
    const v = montar();
    await entrar(v, { email: '  dra@exemplo.pt  ' });
    expect(apiAuth.login).toHaveBeenCalledWith('dra@exemplo.pt', 'Segredo123!');
  });

  it('um e-mail só com espaços deixa o campo vazio e o browser barra a submissão', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.type(v.email(), '     ');
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(v.botao());
    expect(v.email()).toHaveValue('');
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  // As maiúsculas, essas, seguem tal e qual — e do outro lado a consulta é
  // `WHERE email = ?` com o valor cru (worker/routes/auth.js:34-36), enquanto os
  // utilizadores são criados sempre em minúsculas (worker/routes/config.js:130).
  // Escrever «Dra@…» com maiúscula dá "credenciais inválidas". O defeito está
  // registado (e marcado it.fails) em tests/worker/rota-auth.test.js; aqui fica
  // provado que a interface também não o corrige.
  it('as maiúsculas seguem tal e qual para a API', async () => {
    const v = montar();
    await entrar(v, { email: 'Dra@Exemplo.pt' });
    expect(apiAuth.login).toHaveBeenCalledWith('Dra@Exemplo.pt', 'Segredo123!');
  });

  it('espaços à volta da palavra-passe seguem tal e qual (podem ser propositados)', async () => {
    const v = montar();
    await entrar(v, { password: ' Segredo123! ' });
    expect(apiAuth.login).toHaveBeenCalledWith('dra@exemplo.pt', ' Segredo123! ');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('campos por preencher', () => {
  beforeEach(() => { apiAuth.login.mockResolvedValue(RESPOSTA_BOA); });

  it('sem e-mail não chega a haver pedido à API', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  it('sem palavra-passe não chega a haver pedido à API', async () => {
    const v = montar();
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  it('com os dois campos vazios não há pedido nem navegação', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).not.toHaveBeenCalled();
    expect(navegou).not.toHaveBeenCalled();
  });

  it('um e-mail malformado não chega à API', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.type(v.email(), 'isto-não-é-um-email');
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    await v.utilizador.click(v.botao());
    expect(apiAuth.login).not.toHaveBeenCalled();
  });

  // Documentado: quem barra os campos vazios é a validação nativa do browser
  // (`required`), não o código. A mensagem "Preencha e-mail e palavra-passe."
  // de src/admin/auth.js:11 existe mas nunca chega a aparecer neste ecrã — quem
  // a Dra. vê é o balão do próprio browser.
  it('não aparece a mensagem «Preencha e-mail e palavra-passe.» — quem avisa é o browser', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    await v.utilizador.click(v.botao());
    expect(screen.queryByText('Preencha e-mail e palavra-passe.')).not.toBeInTheDocument();
    expect(v.erro()).toBe(null);
  });

  it('o campo por preencher é assinalado como inválido', async () => {
    const v = montar();
    await v.utilizador.clear(v.email());
    expect(v.email().checkValidity()).toBe(false);
  });

  it('com os dois campos preenchidos o formulário passa a válido', async () => {
    const v = montar();
    await v.utilizador.type(v.palavraPasse(), 'Segredo123!');
    expect(v.container.querySelector('form').checkValidity()).toBe(true);
  });
});
