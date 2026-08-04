// @vitest-environment jsdom
// tests/admin/configuracoes.test.jsx
//
// Configurações → Gestão de utilizadores (src/admin/pages/Configuracoes.jsx) e o
// Registo por convite (src/admin/pages/Convite.jsx).
//
// É AQUI que se decide quem entra na Área Privada e quem vê o quê. Um botão que
// não aparece, uma caixa que fica marcada por engano ou um erro que passa em
// silêncio traduzem-se em acesso a mais (ou a menos) do que a Dra. quis dar —
// por isso o ecrã é tratado como sensível: testa-se o que se VÊ e o que fica
// mesmo GRAVADO (o corpo exato que vai para a API).
//
// Os diálogos (admAlert/admConfirm) e os toasts são montados a sério ao lado da
// página: uma mensagem de erro só passa no teste se aparecer mesmo no ecrã.
//
// Fora do âmbito por já estar coberto noutro sítio:
//   · regras de permissões do lado do browser  → tests/admin/perms.test.js
//   · regras do servidor (409, 403, tokens…)   → tests/worker/config.test.js
// Aqui testa-se a LIGAÇÃO: o que a interface manda e o que mostra de volta.
//
// Defeitos reais ficam marcados com `it.fails` + comentário BUG.
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderizar, screen, within, waitFor, fireEvent, configure } from '../helpers/dom.jsx';

// a suíte corre com dezenas de ficheiros do worker ao lado; o jsdom fica lento
// sob carga e 1 s por omissão no findBy/waitFor não chega
configure({ asyncUtilTimeout: 3000 });

// ─── espia da navegação (o Convite reencaminha para o login no fim) ──────────
const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));
vi.mock('react-router-dom', async (original) => {
  const real = await original();
  return { ...real, useNavigate: () => navegou };
});

// ─── API mockada (a rede está fechada em tests/setup.js) ─────────────────────
// Só `config` e `convite` são substituídos: as funções do token continuam a ser
// as verdadeiras, a escrever no sessionStorage do jsdom — é assim que o
// getSession() (badge «VOCÊ», botão de apagar) vê a sessão da Dra.
vi.mock('../../src/admin/apiClient.js', async (original) => {
  const real = await original();
  return {
    ...real,
    config: {
      listUsers: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(),
      reenviarConvite: vi.fn(), uploadFoto: vi.fn(), deleteFoto: vi.fn(), fotoObjectUrl: vi.fn(),
    },
    convite: { info: vi.fn(), concluir: vi.fn(), uploadFoto: vi.fn() },
  };
});

import { config as configApi, convite as conviteApi } from '../../src/admin/apiClient.js';
import Configuracoes from '../../src/admin/pages/Configuracoes.jsx';
import Convite from '../../src/admin/pages/Convite.jsx';
import { DialogHost } from '../../src/admin/dialogs.jsx';
import { ToastHost } from '../../src/admin/toasts.jsx';
import { podeAceder } from '../../src/admin/perms.js';

/* ───────────────────────── ambiente que o jsdom não tem ───────────────────── */

class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ isIntersecting: true }]); }   // revela já (Reveal/RsShell)
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeAll(() => {
  // atribuição direta (e não vi.stubGlobal): o afterEach faz unstubAllGlobals e
  // arrancaria o IntersectionObserver a meio da suíte
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  URL.createObjectURL = () => 'blob:falso';
  URL.revokeObjectURL = () => {};
});

/* ───────────────────────────────── fixtures ───────────────────────────────── */

const TOKEN_KEY = 'vyvian_admin_token';
const USER_KEY = 'vyvian_admin_user';

const EU = {
  id: 'usr_dra', name: 'Vyvian Avena', email: 'dra@exemplo.pt', initials: 'VA',
  cargo: 'Advogada', phone: '+351 900 000 000', status: 'ativo',
  permissions: ['*'], created_at: '2026-07-01 12:00:00', has_photo: false,
};

const utilizador = (over = {}) => ({
  id: 'usr_ana', name: 'Ana Lima', email: 'ana@exemplo.pt', initials: 'AL',
  cargo: 'Assistente jurídica', phone: '+351 911 222 333', status: 'ativo',
  permissions: ['painel', 'clientes'], created_at: '2026-08-01 12:00:00',
  has_photo: false, ...over,
});

function entrarComo(user = EU) {
  sessionStorage.setItem(TOKEN_KEY, 'jwt-de-teste');
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function adiar() {
  let resolver, rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

const ficheiro = (nome, tipo) => new File(['xxxx'], nome, { type: tipo });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  configApi.listUsers.mockResolvedValue({ users: [] });
  configApi.createUser.mockResolvedValue({ ok: true, convite_enviado: true, user: { id: 'usr_novo' } });
  configApi.updateUser.mockResolvedValue({ ok: true });
  configApi.deleteUser.mockResolvedValue({ ok: true });
  configApi.reenviarConvite.mockResolvedValue({ ok: true });
  configApi.uploadFoto.mockResolvedValue({ ok: true });
  configApi.fotoObjectUrl.mockResolvedValue(null);
  conviteApi.info.mockResolvedValue({
    name: 'Ana Lima', email: 'ana@exemplo.pt', cargo: 'Assistente jurídica',
    phone: '+351 911 222 333', has_photo: false,
  });
  conviteApi.concluir.mockResolvedValue({ ok: true });
  conviteApi.uploadFoto.mockResolvedValue({ ok: true });
  entrarComo(EU);
});


/* ────────────────────────────── montagem/atalhos ──────────────────────────── */

async function montar(users = [utilizador()]) {
  configApi.listUsers.mockResolvedValue({ users });
  const vista = renderizar(<><Configuracoes /><DialogHost /><ToastHost /></>);
  await screen.findByRole('button', { name: 'Novo utilizador' });
  return vista;
}

// A linha do utilizador não tem papel próprio (é um <div>); ancora-se no nome
// visível e sobe até ao bloco que tem os botões de ação.
function linhaDe(nome) {
  let el = screen.getByText(nome, { selector: 'strong' });
  while (el && !(el.querySelector && el.querySelector('button[data-tip="Editar utilizador"]'))) el = el.parentElement;
  if (!el) throw new Error(`linha de «${nome}» não encontrada`);
  return el;
}
const blocoDe = (nome) => linhaDe(nome).parentElement;
// Os botões de ícone não têm nome acessível (ver o BUG mais abaixo); o que os
// identifica para a utilizadora é o texto do tooltip (data-tip).
function btnAcao(nome, tip) {
  const b = linhaDe(nome).querySelector(`button[data-tip="${tip}"]`);
  if (!b) throw new Error(`botão «${tip}» não existe na linha de ${nome}`);
  return b;
}
const temAcao = (nome, tip) => !!linhaDe(nome).querySelector(`button[data-tip="${tip}"]`);
const btnExpandir = (nome) => linhaDe(nome).querySelector('button[aria-expanded]');

const dlg = () => screen.getByRole('dialog');
const semDlg = () => screen.queryByRole('dialog');

// Os rótulos do modal são <span> (não <label>): ancora-se no texto visível e
// apanha-se o campo que lhe está debaixo.
function campo(rotulo) {
  const span = within(dlg()).getAllByText(new RegExp('^' + rotulo), { selector: 'span' })
    .find((s) => s.parentElement && s.parentElement.querySelector('input'));
  if (!span) throw new Error(`campo «${rotulo}» não encontrado no modal`);
  return span.parentElement.querySelector('input');
}

const btnGuardar = () => within(dlg()).getByRole('button', { name: /Criar e enviar convite|Guardar alterações|A guardar…/ });
const btnCancelar = () => within(dlg()).getByRole('button', { name: 'Cancelar' });
const caixa = (rotulo) => within(dlg()).getByLabelText(rotulo);
const semCaixa = (rotulo) => within(dlg()).queryByLabelText(rotulo);

async function abrirNovo(u) {
  await u.click(screen.getByRole('button', { name: 'Novo utilizador' }));
  return screen.findByRole('dialog');
}
async function abrirEditar(u, nome) {
  await u.click(btnAcao(nome, 'Editar utilizador'));
  return screen.findByRole('dialog');
}

// Preenche o mínimo aceite pela validação do modal de criação.
async function preencherMinimo(u, { nome = 'Bruno Costa', email = 'bruno@exemplo.pt' } = {}) {
  await u.type(campo('Nome'), nome);
  await u.type(campo('E-mail'), email);
}

const corpoCriado = () => configApi.createUser.mock.calls.at(-1)[0];
const corpoEditado = () => configApi.updateUser.mock.calls.at(-1)[1];

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES — carregar, vazio e erro
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Configurações — estados de carregamento, vazio e erro', () => {
  it('mostra o esqueleto enquanto a lista não chega', async () => {
    const { promessa, resolver } = adiar();
    configApi.listUsers.mockReturnValue(promessa);
    renderizar(<Configuracoes />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
    resolver({ users: [] });
    await screen.findByRole('button', { name: 'Novo utilizador' });
  });

  it('enquanto carrega não mostra ainda o botão de criar', async () => {
    const { promessa, resolver } = adiar();
    configApi.listUsers.mockReturnValue(promessa);
    renderizar(<Configuracoes />);
    expect(screen.queryByRole('button', { name: 'Novo utilizador' })).not.toBeInTheDocument();
    resolver({ users: [] });
    await screen.findByRole('button', { name: 'Novo utilizador' });
  });

  it('depois de carregar o esqueleto desaparece', async () => {
    await montar([]);
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('pede a lista à API uma única vez ao abrir', async () => {
    await montar([]);
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  it('mostra o título da página', async () => {
    await montar([]);
    expect(screen.getByRole('heading', { name: 'Configurações', level: 1 })).toBeInTheDocument();
  });

  it('mostra o rasto de navegação da área privada', async () => {
    await montar([]);
    expect(screen.getByText('Área privada · Configurações')).toBeInTheDocument();
  });

  it('sem utilizadores nenhum diz «0 utilizadores»', async () => {
    await montar([]);
    expect(screen.getByText('0 utilizadores com acesso à Área Privada')).toBeInTheDocument();
  });

  it('com um utilizador usa o singular', async () => {
    await montar([utilizador()]);
    expect(screen.getByText('1 utilizador com acesso à Área Privada')).toBeInTheDocument();
  });

  it('com vários utilizadores usa o plural', async () => {
    await montar([utilizador(), utilizador({ id: 'usr_b', name: 'Bruno Costa', email: 'bruno@exemplo.pt' })]);
    expect(screen.getByText('2 utilizadores com acesso à Área Privada')).toBeInTheDocument();
  });

  // Estado vazio "mudo": não há mensagem a explicar que a lista está vazia, só
  // o contador a zero. Fica registado o comportamento atual.
  it('lista vazia não mostra linha nenhuma de utilizador', async () => {
    await montar([]);
    expect(document.querySelectorAll('button[data-tip="Editar utilizador"]')).toHaveLength(0);
  });

  it('lista vazia continua a deixar criar o primeiro utilizador', async () => {
    await montar([]);
    expect(screen.getByRole('button', { name: 'Novo utilizador' })).toBeEnabled();
  });

  it('resposta sem a chave «users» não rebenta o ecrã', async () => {
    configApi.listUsers.mockResolvedValue({});
    renderizar(<Configuracoes />);
    expect(await screen.findByText('0 utilizadores com acesso à Área Privada')).toBeInTheDocument();
  });

  it('resposta com users nulo não rebenta o ecrã', async () => {
    configApi.listUsers.mockResolvedValue({ users: null });
    renderizar(<Configuracoes />);
    expect(await screen.findByText('0 utilizadores com acesso à Área Privada')).toBeInTheDocument();
  });

  it('falha ao listar mostra a mensagem do servidor no ecrã', async () => {
    configApi.listUsers.mockRejectedValue(new Error('Sem permissão para gerir utilizadores.'));
    renderizar(<Configuracoes />);
    expect(await screen.findByText('Sem permissão para gerir utilizadores.')).toBeInTheDocument();
  });

  it('falha de rede mostra a mensagem em vez do esqueleto eterno', async () => {
    configApi.listUsers.mockRejectedValue(new TypeError('Failed to fetch'));
    renderizar(<Configuracoes />);
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  // Comportamento atual: o erro substitui a página inteira — sem cabeçalho e
  // sem forma de tentar outra vez sem recarregar o browser.
  it('com erro a página inteira é substituída pela mensagem', async () => {
    configApi.listUsers.mockRejectedValue(new Error('HTTP 500'));
    renderizar(<Configuracoes />);
    await screen.findByText('HTTP 500');
    expect(screen.queryByRole('button', { name: 'Novo utilizador' })).not.toBeInTheDocument();
  });

  it('o erro não deixa nenhuma linha de utilizador para trás', async () => {
    configApi.listUsers.mockRejectedValue(new Error('HTTP 403'));
    renderizar(<Configuracoes />);
    await screen.findByText('HTTP 403');
    expect(screen.queryByText('Ana Lima')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES — a lista de utilizadores
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Configurações — lista de utilizadores', () => {
  it('mostra o nome', async () => {
    await montar();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });

  it('mostra o cargo ao lado do nome', async () => {
    await montar();
    expect(within(linhaDe('Ana Lima')).getByText('Assistente jurídica')).toBeInTheDocument();
  });

  it('sem cargo não inventa nada', async () => {
    await montar([utilizador({ cargo: null })]);
    expect(within(linhaDe('Ana Lima')).queryByText('Assistente jurídica')).not.toBeInTheDocument();
  });

  it('mostra o e-mail e o telefone', async () => {
    await montar();
    expect(within(linhaDe('Ana Lima')).getByText(/ana@exemplo\.pt · \+351 911 222 333/)).toBeInTheDocument();
  });

  it('sem telefone não deixa o separador pendurado', async () => {
    await montar([utilizador({ phone: null })]);
    expect(within(linhaDe('Ana Lima')).getByText(/^ana@exemplo\.pt · criado a/)).toBeInTheDocument();
  });

  it('mostra a data de criação em português', async () => {
    await montar();
    expect(within(linhaDe('Ana Lima')).getByText(/criado a 01\/08\/2026 às \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('sem data de criação mostra um travessão', async () => {
    await montar([utilizador({ created_at: null })]);
    expect(within(linhaDe('Ana Lima')).getByText(/criado a —$/)).toBeInTheDocument();
  });

  it('mostra as iniciais quando não há foto', async () => {
    await montar();
    expect(within(linhaDe('Ana Lima')).getByText('AL')).toBeInTheDocument();
  });

  it('sem foto não vai buscar imagem nenhuma à API', async () => {
    await montar();
    expect(configApi.fotoObjectUrl).not.toHaveBeenCalled();
  });

  it('com foto vai buscá-la e mostra-a', async () => {
    configApi.fotoObjectUrl.mockResolvedValue('blob:foto');
    await montar([utilizador({ has_photo: true })]);
    expect(await screen.findByRole('img', { name: 'Ana Lima' })).toBeInTheDocument();
  });

  it('foto que a API não devolve mantém as iniciais', async () => {
    configApi.fotoObjectUrl.mockResolvedValue(null);
    await montar([utilizador({ has_photo: true })]);
    await waitFor(() => expect(configApi.fotoObjectUrl).toHaveBeenCalledWith('usr_ana'));
    expect(within(linhaDe('Ana Lima')).getByText('AL')).toBeInTheDocument();
  });

  it('mostra todos os utilizadores devolvidos', async () => {
    await montar([
      utilizador(),
      utilizador({ id: 'usr_b', name: 'Bruno Costa', email: 'bruno@exemplo.pt', initials: 'BC' }),
      EU,
    ]);
    for (const n of ['Ana Lima', 'Bruno Costa', 'Vyvian Avena']) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  it('respeita a ordem em que a API os devolveu', async () => {
    await montar([utilizador({ id: 'usr_b', name: 'Bruno Costa' }), utilizador()]);
    const nomes = [...document.querySelectorAll('strong')].map((s) => s.textContent);
    expect(nomes.indexOf('Bruno Costa')).toBeLessThan(nomes.indexOf('Ana Lima'));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES — quem sou eu, convites pendentes e botões por linha
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Configurações — o próprio utilizador e o estado do convite', () => {
  it('marca a própria linha com «VOCÊ»', async () => {
    await montar([EU, utilizador()]);
    expect(within(linhaDe('Vyvian Avena')).getByText('VOCÊ')).toBeInTheDocument();
  });

  it('não marca as linhas dos outros', async () => {
    await montar([EU, utilizador()]);
    expect(within(linhaDe('Ana Lima')).queryByText('VOCÊ')).not.toBeInTheDocument();
  });

  it('sem sessão guardada ninguém leva o «VOCÊ»', async () => {
    sessionStorage.clear();
    await montar([EU, utilizador()]);
    expect(screen.queryByText('VOCÊ')).not.toBeInTheDocument();
  });

  it('o próprio utilizador NÃO pode ser apagado (o botão nem aparece)', async () => {
    await montar([EU, utilizador()]);
    expect(temAcao('Vyvian Avena', 'Apagar utilizador')).toBe(false);
  });

  it('os outros utilizadores podem ser apagados', async () => {
    await montar([EU, utilizador()]);
    expect(temAcao('Ana Lima', 'Apagar utilizador')).toBe(true);
  });

  it('sendo a única com acesso total continua sem se poder apagar', async () => {
    await montar([EU]);
    expect(temAcao('Vyvian Avena', 'Apagar utilizador')).toBe(false);
  });

  it('o próprio utilizador pode editar-se a si mesmo', async () => {
    await montar([EU]);
    expect(temAcao('Vyvian Avena', 'Editar utilizador')).toBe(true);
  });

  it('quem já concluiu o registo não mostra convite pendente', async () => {
    await montar([utilizador({ status: 'ativo' })]);
    expect(screen.queryByText('CONVITE PENDENTE')).not.toBeInTheDocument();
  });

  it('quem ainda não concluiu mostra «CONVITE PENDENTE»', async () => {
    await montar([utilizador({ status: 'convidado' })]);
    expect(screen.getByText('CONVITE PENDENTE')).toBeInTheDocument();
  });

  it('só quem está convidado tem o botão de reenviar', async () => {
    await montar([utilizador({ status: 'convidado' }), utilizador({ id: 'usr_b', name: 'Bruno Costa', status: 'ativo' })]);
    expect(within(linhaDe('Ana Lima')).getByRole('button', { name: /Reenviar convite/ })).toBeInTheDocument();
    expect(within(linhaDe('Bruno Costa')).queryByRole('button', { name: /Reenviar convite/ })).not.toBeInTheDocument();
  });

  it('o tooltip do convite diz quando expira', async () => {
    const { utilizador: u } = await montar([utilizador({ status: 'convidado', invite_expires: '2026-08-08 12:00:00' })]);
    await u.hover(screen.getByText('CONVITE PENDENTE'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Convite por concluir · expira 08\/08\/2026/);
  });

  it('sem data de expiração o tooltip diz só que está por concluir', async () => {
    const { utilizador: u } = await montar([utilizador({ status: 'convidado' })]);
    await u.hover(screen.getByText('CONVITE PENDENTE'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Convite por concluir');
  });

  // CORRIGIDO (era): Configuracoes.jsx:270-282 — os botões de editar, apagar e expandir só
  // têm ícone (aria-hidden) e um data-tip; não têm aria-label nem texto. Para um
  // leitor de ecrã são três botões sem nome — num ecrã onde um deles apaga um
  // utilizador. O ModalClose do mesmo projeto já usa aria-label, por isso é
  // esquecimento, não convenção.
  it('o botão de apagar devia ter nome acessível', async () => {
    await montar([utilizador()]);
    expect(screen.getByRole('button', { name: /apagar/i })).toBeInTheDocument();
  });

  it('o botão de editar devia ter nome acessível', async () => {
    await montar([utilizador()]);
    expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES — expansor: a que abas cada pessoa tem acesso
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Configurações — ver a que abas cada utilizador tem acesso', () => {
  it('começa fechado', async () => {
    await montar();
    expect(btnExpandir('Ana Lima')).toHaveAttribute('aria-expanded', 'false');
  });

  it('as permissões não estão no ecrã antes de expandir', async () => {
    await montar();
    expect(within(blocoDe('Ana Lima')).queryByText('Clientes')).not.toBeInTheDocument();
  });

  it('expandir marca o botão como aberto', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnExpandir('Ana Lima'));
    expect(btnExpandir('Ana Lima')).toHaveAttribute('aria-expanded', 'true');
  });

  it('expandir mostra as abas a que tem acesso', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('Painel')).toBeInTheDocument();
    expect(within(blocoDe('Ana Lima')).getByText('Clientes')).toBeInTheDocument();
  });

  it('não mostra abas a que não tem acesso', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).queryByText('Parcelas')).not.toBeInTheDocument();
  });

  it('volta a fechar ao segundo clique', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnExpandir('Ana Lima'));
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).queryByText('Clientes')).not.toBeInTheDocument();
  });

  it('expandir um utilizador não expande o outro', async () => {
    const { utilizador: u } = await montar([utilizador(), utilizador({ id: 'usr_b', name: 'Bruno Costa', permissions: ['apoio'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Bruno Costa')).queryByText('Apoio Técnico')).not.toBeInTheDocument();
  });

  it('a chave «estatisticas» aparece como «Redes Sociais»', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['estatisticas'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('Redes Sociais')).toBeInTheDocument();
  });

  it('a chave «apoio» aparece como «Apoio Técnico»', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['apoio'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('Apoio Técnico')).toBeInTheDocument();
  });

  it('a permissão de gestão aparece como «Gerir utilizadores»', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['gerir_utilizadores'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('Gerir utilizadores')).toBeInTheDocument();
  });

  it('acesso total mostra a etiqueta dourada «Acesso total»', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['*'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('Acesso total')).toBeInTheDocument();
  });

  it('acesso total lista as oito abas e a gestão de utilizadores', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['*'] })]);
    await u.click(btnExpandir('Ana Lima'));
    const bloco = within(blocoDe('Ana Lima'));
    for (const l of ['Painel', 'Clientes', 'Parcelas', 'Calendário', 'Notificações',
                     'Redes Sociais', 'Apoio Técnico', 'Configurações', 'Gerir utilizadores']) {
      expect(bloco.getByText(l)).toBeInTheDocument();
    }
  });

  it('uma permissão desconhecida mostra a chave tal como veio', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['coisa_nova'] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).getByText('coisa_nova')).toBeInTheDocument();
  });

  it('lista de permissões vazia não mostra etiqueta nenhuma', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: [] })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(within(blocoDe('Ana Lima')).queryByText('Painel')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES — o que NUNCA pode aparecer no ecrã
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Configurações — segredos que não podem chegar ao ecrã', () => {
  const SEGREDOS = {
    password_hash: '$argon2id$v=19$m=65536,segredo',
    invite_token: 'f'.repeat(48),
    api_key: 'sk-live-CHAVE-SECRETA-123',
    resend_key: 're_CHAVE_DO_RESEND',
  };

  it('a hash da palavra-passe não aparece no texto do ecrã', async () => {
    await montar([utilizador(SEGREDOS)]);
    expect(document.body.textContent).not.toContain(SEGREDOS.password_hash);
  });

  it('a hash da palavra-passe não aparece no DOM (nem em atributos)', async () => {
    await montar([utilizador(SEGREDOS)]);
    expect(document.body.innerHTML).not.toContain(SEGREDOS.password_hash);
  });

  it('o token do convite não aparece no ecrã', async () => {
    await montar([utilizador({ ...SEGREDOS, status: 'convidado' })]);
    expect(document.body.innerHTML).not.toContain(SEGREDOS.invite_token);
  });

  it('o token do convite continua escondido com a linha expandida', async () => {
    const { utilizador: u } = await montar([utilizador({ ...SEGREDOS, status: 'convidado' })]);
    await u.click(btnExpandir('Ana Lima'));
    expect(document.body.innerHTML).not.toContain(SEGREDOS.invite_token);
  });

  it('chaves de API que venham na resposta não são desenhadas', async () => {
    await montar([utilizador(SEGREDOS)]);
    expect(document.body.innerHTML).not.toContain(SEGREDOS.api_key);
    expect(document.body.innerHTML).not.toContain(SEGREDOS.resend_key);
  });

  it('os segredos também não passam para o modal de edição', async () => {
    const { utilizador: u } = await montar([utilizador(SEGREDOS)]);
    await abrirEditar(u, 'Ana Lima');
    expect(document.body.innerHTML).not.toContain(SEGREDOS.api_key);
    expect(document.body.innerHTML).not.toContain(SEGREDOS.password_hash);
  });

  it('o modal não envia de volta campos que não são do formulário', async () => {
    const { utilizador: u } = await montar([utilizador(SEGREDOS)]);
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(Object.keys(corpoEditado()).sort()).toEqual(['cargo', 'email', 'name', 'permissions', 'phone']);
  });

  it('o token da sessão não é escrito no ecrã', async () => {
    await montar([EU]);
    expect(document.body.innerHTML).not.toContain('jwt-de-teste');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — abrir e fechar
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Modal de utilizador — abrir e fechar', () => {
  it('não está aberto ao entrar na página', async () => {
    await montar();
    expect(semDlg()).toBeNull();
  });

  it('«Novo utilizador» abre o modal de criação', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByRole('heading', { name: 'Novo utilizador' })).toBeInTheDocument();
  });

  it('o modal declara-se modal para a acessibilidade', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(dlg()).toHaveAttribute('aria-modal', 'true');
  });

  it('editar abre o modal de edição', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    expect(within(dlg()).getByRole('heading', { name: 'Editar utilizador' })).toBeInTheDocument();
  });

  it('o modal identifica-se como sendo dos utilizadores', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('Configurações · Utilizadores')).toBeInTheDocument();
  });

  it('«Cancelar» fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(btnCancelar());
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('o ✕ fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(within(dlg()).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('a tecla Esc fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.keyboard('{Escape}');
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('clicar fora do cartão fecha o modal', async () => {
    const { utilizador: u } = await montar();
    const d = await abrirNovo(u);
    fireEvent.mouseDown(d);
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('clicar dentro do cartão não fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    fireEvent.mouseDown(within(dlg()).getByRole('heading', { name: 'Novo utilizador' }));
    expect(semDlg()).not.toBeNull();
  });

  it('fechar sem guardar não chama a API', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno');
    await u.click(btnCancelar());
    expect(configApi.createUser).not.toHaveBeenCalled();
  });

  it('fechar sem guardar não recarrega a lista', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(btnCancelar());
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  it('reabrir o modal de criação começa outra vez em branco', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno');
    await u.click(btnCancelar());
    await waitFor(() => expect(semDlg()).toBeNull());
    await abrirNovo(u);
    expect(campo('Nome')).toHaveValue('');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — campos e validação
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Modal de utilizador — campos obrigatórios e validação', () => {
  it('o novo utilizador começa com os campos vazios', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    for (const c of ['Nome', 'Cargo', 'E-mail', 'Telefone']) expect(campo(c)).toHaveValue('');
  });

  it('marca o nome e o e-mail como obrigatórios', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('Nome *')).toBeInTheDocument();
    expect(within(dlg()).getByText(/^E-mail \*/)).toBeInTheDocument();
  });

  it('avisa que é o e-mail que recebe o convite', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('(recebe o convite)')).toBeInTheDocument();
  });

  it('a edição já não fala em convite (o e-mail não o reenvia)', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    expect(within(dlg()).queryByText('(recebe o convite)')).not.toBeInTheDocument();
  });

  it('sem nome recusa e explica porquê', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique o nome.')).toBeInTheDocument();
  });

  it('sem nome não chega a chamar a API', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(btnGuardar());
    await screen.findByText('Indique o nome.');
    expect(configApi.createUser).not.toHaveBeenCalled();
  });

  it('nome só com espaços conta como vazio', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), '   ');
    await u.type(campo('E-mail'), 'bruno@exemplo.pt');
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique o nome.')).toBeInTheDocument();
  });

  it('com nome mas sem e-mail pede um e-mail válido', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique um e-mail válido.')).toBeInTheDocument();
  });

  it.each([
    ['sem arroba', 'brunoexemplo.pt'],
    ['sem domínio', 'bruno@'],
    ['sem ponto no domínio', 'bruno@exemplo'],
    ['sem parte local', '@exemplo.pt'],
    ['com espaço no meio', 'bru no@exemplo.pt'],
    ['dois arrobas', 'bruno@@exemplo.pt'],
    ['só espaços', '   '],
    ['só um ponto', '.'],
  ])('e-mail %s é recusado', async (_nome, email) => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.type(campo('E-mail'), email);
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique um e-mail válido.')).toBeInTheDocument();
    expect(configApi.createUser).not.toHaveBeenCalled();
  });

  it.each([
    ['simples', 'bruno@exemplo.pt'],
    ['com ponto no nome', 'bruno.costa@exemplo.pt'],
    ['com + de etiqueta', 'bruno+admin@exemplo.pt'],
    ['subdomínio', 'bruno@mail.exemplo.pt'],
    ['maiúsculas', 'Bruno@Exemplo.PT'],
  ])('e-mail %s é aceite', async (_nome, email) => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.type(campo('E-mail'), email);
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
  });

  it('e-mail com espaços à volta passa na validação', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.type(campo('E-mail'), '  bruno@exemplo.pt  ');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
  });

  // O browser valida com `.trim()` mas envia o valor cru — quem apara e passa a
  // minúsculas é o worker (worker/routes/config.js:126-127). O campo do e-mail
  // é `type="email"`, por isso é o próprio browser que lhe come os espaços.
  it('o nome vai para a API tal como foi escrito, com espaços e tudo', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), '  Bruno Costa  ');
    await u.type(campo('E-mail'), 'bruno@exemplo.pt');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().name).toBe('  Bruno Costa  ');
  });

  it('as maiúsculas do e-mail seguem intactas (quem as baixa é o worker)', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.type(campo('E-mail'), '  Bruno@Exemplo.PT  ');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().email).toContain('Bruno@Exemplo.PT');
  });

  it('sem acesso nenhum marcado recusa e explica', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Painel'));               // deixa a lista vazia
    await u.click(btnGuardar());
    expect(await screen.findByText('Escolha pelo menos uma aba de acesso.')).toBeInTheDocument();
  });

  it('sem acesso nenhum não chama a API', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Painel'));
    await u.click(btnGuardar());
    await screen.findByText('Escolha pelo menos uma aba de acesso.');
    expect(configApi.createUser).not.toHaveBeenCalled();
  });

  it('uma validação falhada não fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(btnGuardar());
    await screen.findByText('Indique o nome.');
    expect(semDlg()).not.toBeNull();
  });

  it('uma validação falhada não apaga o que já estava escrito', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.click(btnGuardar());
    await screen.findByText('Indique um e-mail válido.');
    expect(campo('Nome')).toHaveValue('Bruno Costa');
  });

  it('só a gestão de utilizadores (sem aba nenhuma) é aceite pelo browser', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Painel'));
    await u.click(caixa(/^Gerir utilizadores/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().permissions).toEqual(['gerir_utilizadores']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — atribuição de permissões
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Modal de utilizador — permissões por aba', () => {
  const ABAS = ['Painel', 'Clientes', 'Parcelas', 'Calendário', 'Notificações',
                'Redes Sociais', 'Apoio Técnico', 'Configurações'];

  it('mostra as oito abas da Área Privada', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    for (const a of ABAS) expect(caixa(a)).toBeInTheDocument();
  });

  it('mostra a permissão especial de gerir utilizadores', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(caixa(/^Gerir utilizadores/)).toBeInTheDocument();
  });

  it('explica o que a gestão de utilizadores permite', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('— Criar, editar e apagar utilizadores')).toBeInTheDocument();
  });

  it('o novo utilizador nasce só com o Painel', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(caixa('Painel')).toBeChecked();
    for (const a of ABAS.slice(1)) expect(caixa(a)).not.toBeChecked();
  });

  it('o novo utilizador não nasce com acesso total', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(caixa(/^Acesso total/)).not.toBeChecked();
  });

  it('o novo utilizador não nasce a gerir utilizadores', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(caixa(/^Gerir utilizadores/)).not.toBeChecked();
  });

  it('marcar uma aba acrescenta-a ao que fica gravado', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Parcelas'));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().permissions).toEqual(['painel', 'parcelas']);
  });

  it('desmarcar uma aba tira-a do que fica gravado', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Parcelas'));
    await u.click(caixa('Painel'));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().permissions).toEqual(['parcelas']);
  });

  it('marcar e desmarcar a mesma aba deixa tudo como estava', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa('Apoio Técnico'));
    await u.click(caixa('Apoio Técnico'));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().permissions).toEqual(['painel']);
  });

  it('a caixa reflete o clique de imediato', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(caixa('Clientes'));
    expect(caixa('Clientes')).toBeChecked();
  });

  it.each(['Painel', 'Clientes', 'Parcelas', 'Calendário', 'Notificações', 'Redes Sociais', 'Apoio Técnico', 'Configurações'])(
    'a aba %s grava a chave certa', async (rotulo) => {
      const chaves = {
        Painel: 'painel', Clientes: 'clientes', Parcelas: 'parcelas', Calendário: 'calendario',
        Notificações: 'notificacoes', 'Redes Sociais': 'estatisticas', 'Apoio Técnico': 'apoio',
        Configurações: 'configuracoes',
      };
      const { utilizador: u } = await montar();
      await abrirNovo(u);
      await preencherMinimo(u);
      if (rotulo !== 'Painel') { await u.click(caixa('Painel')); await u.click(caixa(rotulo)); }
      await u.click(btnGuardar());
      await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
      expect(corpoCriado().permissions).toEqual([chaves[rotulo]]);
    });

  // «Acesso total» é o único atalho que existe para marcar tudo de uma vez —
  // não há botão «marcar/desmarcar todas» por aba.
  it('«Acesso total» esconde as caixas por aba', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(caixa(/^Acesso total/));
    for (const a of ABAS) expect(semCaixa(a)).toBeNull();
  });

  it('«Acesso total» esconde também a gestão de utilizadores', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(caixa(/^Acesso total/));
    expect(semCaixa(/^Gerir utilizadores/)).toBeNull();
  });

  it('«Acesso total» explica o que abrange', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('— todas as abas + gestão de utilizadores')).toBeInTheDocument();
  });

  it('«Acesso total» grava o curinga «*» e mais nada', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().permissions).toEqual(['*']);
  });

  it('desligar o acesso total devolve as caixas por aba', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.click(caixa(/^Acesso total/));
    await u.click(caixa(/^Acesso total/));
    expect(caixa('Painel')).toBeInTheDocument();
  });

  // Cuidado documentado: passar por «Acesso total» apaga a escolha anterior —
  // ao desligar fica só o Painel, não a lista que lá estava.
  it('desligar o acesso total deixa apenas o Painel marcado', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['clientes', 'parcelas'] })]);
    await abrirEditar(u, 'Ana Lima');
    await u.click(caixa(/^Acesso total/));
    await u.click(caixa(/^Acesso total/));
    expect(caixa('Painel')).toBeChecked();
    expect(caixa('Clientes')).not.toBeChecked();
    expect(caixa('Parcelas')).not.toBeChecked();
  });

  it('editar traz as permissões que a pessoa já tinha', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['clientes', 'apoio'] })]);
    await abrirEditar(u, 'Ana Lima');
    expect(caixa('Clientes')).toBeChecked();
    expect(caixa('Apoio Técnico')).toBeChecked();
    expect(caixa('Painel')).not.toBeChecked();
  });

  it('editar quem tem acesso total mostra a caixa do acesso total marcada', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['*'] })]);
    await abrirEditar(u, 'Ana Lima');
    expect(caixa(/^Acesso total/)).toBeChecked();
    expect(semCaixa('Painel')).toBeNull();
  });

  it('editar quem gere utilizadores mostra essa caixa marcada', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['painel', 'gerir_utilizadores'] })]);
    await abrirEditar(u, 'Ana Lima');
    expect(caixa(/^Gerir utilizadores/)).toBeChecked();
  });

  it('promover alguém a acesso total grava só o curinga', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['clientes'] })]);
    await abrirEditar(u, 'Ana Lima');
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().permissions).toEqual(['*']);
  });

  it('tirar a gestão de utilizadores a alguém grava a lista sem ela', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['painel', 'gerir_utilizadores'] })]);
    await abrirEditar(u, 'Ana Lima');
    await u.click(caixa(/^Gerir utilizadores/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().permissions).toEqual(['painel']);
  });

  it('as permissões desconhecidas vindas do servidor não somem ao guardar', async () => {
    const { utilizador: u } = await montar([utilizador({ permissions: ['painel', 'coisa_nova'] })]);
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().permissions).toEqual(['painel', 'coisa_nova']);
  });

  it('mexer nas permissões de um utilizador não mexe nas do outro', async () => {
    const { utilizador: u } = await montar([
      utilizador({ permissions: ['painel'] }),
      utilizador({ id: 'usr_b', name: 'Bruno Costa', permissions: ['apoio'] }),
    ]);
    await abrirEditar(u, 'Bruno Costa');
    expect(caixa('Apoio Técnico')).toBeChecked();
    expect(caixa('Painel')).not.toBeChecked();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — criar utilizador (convite por e-mail)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Criar utilizador — convite por e-mail', () => {
  it('o botão diz que cria e envia o convite', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByRole('button', { name: /Criar e enviar convite/ })).toBeInTheDocument();
  });

  it('envia à API exatamente o que foi preenchido', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await u.type(campo('Nome'), 'Bruno Costa');
    await u.type(campo('E-mail'), 'bruno@exemplo.pt');
    await u.type(campo('Cargo'), 'Estagiário');
    await u.type(campo('Telefone'), '+351 933 111 222');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado()).toEqual({
      name: 'Bruno Costa', email: 'bruno@exemplo.pt', cargo: 'Estagiário',
      phone: '+351 933 111 222', permissions: ['painel'],
    });
  });

  it('confirma no ecrã que o convite seguiu para o e-mail certo', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Utilizador criado — convite enviado para bruno@exemplo.pt.')).toBeInTheDocument();
  });

  it('avisa quando o utilizador foi criado mas o e-mail falhou', async () => {
    configApi.createUser.mockResolvedValue({ ok: true, convite_enviado: false, user: { id: 'usr_novo' } });
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Utilizador criado, mas o envio do e-mail falhou. Use «Reenviar convite».')).toBeInTheDocument();
  });

  it('depois de criar fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('depois de criar recarrega a lista', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.listUsers).toHaveBeenCalledTimes(2));
  });

  it('o utilizador novo aparece na lista recarregada', async () => {
    const { utilizador: u } = await montar();
    configApi.listUsers.mockResolvedValue({ users: [utilizador(), utilizador({ id: 'usr_novo', name: 'Bruno Costa', status: 'convidado' })] });
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
  });

  it('enquanto grava o botão avisa que está a guardar', async () => {
    const { promessa, resolver } = adiar();
    configApi.createUser.mockReturnValue(promessa);
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await within(dlg()).findByRole('button', { name: /A guardar…/ })).toBeInTheDocument();
    resolver({ ok: true, convite_enviado: true, user: { id: 'x' } });
  });

  it('enquanto grava os campos ficam bloqueados', async () => {
    const { promessa, resolver } = adiar();
    configApi.createUser.mockReturnValue(promessa);
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await waitFor(() => expect(campo('Nome')).toBeDisabled());
    expect(campo('E-mail')).toBeDisabled();
    resolver({ ok: true, convite_enviado: true, user: { id: 'x' } });
  });

  it('enquanto grava não se pode cancelar a meio', async () => {
    const { promessa, resolver } = adiar();
    configApi.createUser.mockReturnValue(promessa);
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await waitFor(() => expect(btnCancelar()).toBeDisabled());
    resolver({ ok: true, convite_enviado: true, user: { id: 'x' } });
  });

  it('e-mail duplicado mostra a mensagem do servidor', async () => {
    configApi.createUser.mockRejectedValue(new Error('Já existe um utilizador com esse e-mail.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Erro: Já existe um utilizador com esse e-mail.')).toBeInTheDocument();
  });

  it('e-mail duplicado não fecha o modal (dá para corrigir)', async () => {
    configApi.createUser.mockRejectedValue(new Error('Já existe um utilizador com esse e-mail.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await screen.findByText('Erro: Já existe um utilizador com esse e-mail.');
    expect(semDlg()).not.toBeNull();
  });

  it('e-mail duplicado não recarrega a lista', async () => {
    configApi.createUser.mockRejectedValue(new Error('Já existe um utilizador com esse e-mail.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await screen.findByText('Erro: Já existe um utilizador com esse e-mail.');
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  // Não há verificação de duplicados no browser: o e-mail repetido é enviado à
  // API e é a resposta 409 dela que aparece no ecrã.
  it('um e-mail que já está na lista é mesmo assim enviado à API', async () => {
    configApi.createUser.mockRejectedValue(new Error('Já existe um utilizador com esse e-mail.'));
    const { utilizador: u } = await montar([utilizador()]);
    await abrirNovo(u);
    await preencherMinimo(u, { email: 'ana@exemplo.pt' });
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(corpoCriado().email).toBe('ana@exemplo.pt');
  });

  it('depois de um erro dá para corrigir e voltar a tentar', async () => {
    configApi.createUser.mockRejectedValueOnce(new Error('Já existe um utilizador com esse e-mail.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u, { email: 'ana@exemplo.pt' });
    await u.click(btnGuardar());
    await screen.findByText('Erro: Já existe um utilizador com esse e-mail.');
    await u.click(screen.getByRole('button', { name: 'OK' }));
    await u.clear(campo('E-mail'));
    await u.type(campo('E-mail'), 'bruno@exemplo.pt');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalledTimes(2));
  });

  it('falha de rede a criar mostra a mensagem sem partir o ecrã', async () => {
    configApi.createUser.mockRejectedValue(new TypeError('Failed to fetch'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    expect(await screen.findByText('Erro: Failed to fetch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo utilizador' })).toBeInTheDocument();
  });

  it('depois de falhar o botão volta a estar disponível', async () => {
    configApi.createUser.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await screen.findByText('Erro: boom');
    expect(within(dlg()).getByRole('button', { name: /Criar e enviar convite/ })).toBeEnabled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — editar utilizador
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Editar utilizador', () => {
  it('traz o nome, o cargo, o e-mail e o telefone já preenchidos', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    expect(campo('Nome')).toHaveValue('Ana Lima');
    expect(campo('Cargo')).toHaveValue('Assistente jurídica');
    expect(campo('E-mail')).toHaveValue('ana@exemplo.pt');
    expect(campo('Telefone')).toHaveValue('+351 911 222 333');
  });

  it('cargo e telefone em falta ficam vazios em vez de "null"', async () => {
    const { utilizador: u } = await montar([utilizador({ cargo: null, phone: null })]);
    await abrirEditar(u, 'Ana Lima');
    expect(campo('Cargo')).toHaveValue('');
    expect(campo('Telefone')).toHaveValue('');
  });

  it('o botão diz «Guardar alterações»', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    expect(within(dlg()).getByRole('button', { name: /Guardar alterações/ })).toBeInTheDocument();
  });

  it('guarda com o id do utilizador certo', async () => {
    const { utilizador: u } = await montar([utilizador(), utilizador({ id: 'usr_b', name: 'Bruno Costa' })]);
    await abrirEditar(u, 'Bruno Costa');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalledWith('usr_b', expect.anything()));
  });

  it('grava o nome alterado', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.clear(campo('Nome'));
    await u.type(campo('Nome'), 'Ana Lima Ferreira');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().name).toBe('Ana Lima Ferreira');
  });

  it('grava o e-mail alterado', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.clear(campo('E-mail'));
    await u.type(campo('E-mail'), 'ana.lima@exemplo.pt');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().email).toBe('ana.lima@exemplo.pt');
  });

  it('limpar o cargo envia o campo vazio', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.clear(campo('Cargo'));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().cargo).toBe('');
  });

  it('confirma no ecrã que ficou gravado', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    expect(await screen.findByText('Utilizador atualizado.')).toBeInTheDocument();
  });

  it('depois de guardar fecha o modal', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await waitFor(() => expect(semDlg()).toBeNull());
  });

  it('depois de guardar recarrega a lista', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.listUsers).toHaveBeenCalledTimes(2));
  });

  it('editar sem nome é recusado na mesma', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.clear(campo('Nome'));
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique o nome.')).toBeInTheDocument();
    expect(configApi.updateUser).not.toHaveBeenCalled();
  });

  it('editar com e-mail inválido é recusado na mesma', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.clear(campo('E-mail'));
    await u.type(campo('E-mail'), 'ana@');
    await u.click(btnGuardar());
    expect(await screen.findByText('Indique um e-mail válido.')).toBeInTheDocument();
  });

  it('e-mail já usado por outra pessoa mostra o erro do servidor', async () => {
    configApi.updateUser.mockRejectedValue(new Error('Esse e-mail já está em uso.'));
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    expect(await screen.findByText('Erro: Esse e-mail já está em uso.')).toBeInTheDocument();
  });

  it('erro ao guardar mantém o modal aberto', async () => {
    configApi.updateUser.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await screen.findByText('Erro: boom');
    expect(semDlg()).not.toBeNull();
  });

  it('erro ao guardar não recarrega a lista', async () => {
    configApi.updateUser.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    await screen.findByText('Erro: boom');
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  it('enquanto guarda mostra «A guardar…»', async () => {
    const { promessa, resolver } = adiar();
    configApi.updateUser.mockReturnValue(promessa);
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    await u.click(btnGuardar());
    expect(await within(dlg()).findByRole('button', { name: /A guardar…/ })).toBeInTheDocument();
    resolver({ ok: true });
  });

  // A guarda do "último gestor" vive no worker (worker/routes/config.js) — o
  // browser deixa tentar e mostra a recusa.
  it('despromover-se a si própria é enviado à API sem aviso prévio', async () => {
    const { utilizador: u } = await montar([EU]);
    await abrirEditar(u, 'Vyvian Avena');
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(corpoEditado().permissions).toEqual(['painel']);
  });

  it('a recusa do servidor («último gestor») aparece no ecrã', async () => {
    configApi.updateUser.mockRejectedValue(new Error('Tem de existir sempre um utilizador que possa gerir utilizadores.'));
    const { utilizador: u } = await montar([EU]);
    await abrirEditar(u, 'Vyvian Avena');
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    expect(await screen.findByText('Erro: Tem de existir sempre um utilizador que possa gerir utilizadores.')).toBeInTheDocument();
  });

  it('recusada a despromoção, o modal fica aberto com o acesso total ainda desmarcado', async () => {
    configApi.updateUser.mockRejectedValue(new Error('Não é possível.'));
    const { utilizador: u } = await montar([EU]);
    await abrirEditar(u, 'Vyvian Avena');
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    await screen.findByText('Erro: Não é possível.');
    expect(caixa(/^Acesso total/)).not.toBeChecked();
  });

  // BUG: Configuracoes.jsx:89-101 — depois de mudar as SUAS PRÓPRIAS permissões,
  // nada atualiza a sessão guardada no sessionStorage. A pessoa continua a ver
  // (e a navegar) as abas que acabou de tirar a si mesma até sair e voltar a
  // entrar. O servidor recusa os pedidos, mas o menu mente. Devia recarregar a
  // sessão (auth.me) ou forçar novo login.
  it.fails('despromover-se a si própria devia refletir-se logo na sessão local', async () => {
    const { utilizador: u } = await montar([EU]);
    await abrirEditar(u, 'Vyvian Avena');
    await u.click(caixa(/^Acesso total/));
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.updateUser).toHaveBeenCalled());
    expect(podeAceder('configuracoes')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL — foto de perfil
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Foto de perfil no modal', () => {
  const inputFoto = () => dlg().querySelector('input[type="file"]');

  it('começa a pedir para carregar uma foto', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    expect(within(dlg()).getByText('Carregar foto')).toBeInTheDocument();
  });

  it('quem já tem foto vê «Trocar foto»', async () => {
    configApi.fotoObjectUrl.mockResolvedValue('blob:foto');
    const { utilizador: u } = await montar([utilizador({ has_photo: true })]);
    await abrirEditar(u, 'Ana Lima');
    expect(within(dlg()).getByText('Trocar foto')).toBeInTheDocument();
  });

  it('um ficheiro que não é imagem é recusado com mensagem', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('contrato.pdf', 'application/pdf')] } });
    expect(await screen.findByText('Escolha uma imagem.')).toBeInTheDocument();
  });

  it('escolher uma imagem mostra a pré-visualização', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await waitFor(() => expect(within(dlg()).getByText('Trocar foto')).toBeInTheDocument());
  });

  it('sem foto escolhida não se chama o upload', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.createUser).toHaveBeenCalled());
    expect(configApi.uploadFoto).not.toHaveBeenCalled();
  });

  it('a foto é enviada para o utilizador acabado de criar', async () => {
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.uploadFoto).toHaveBeenCalledWith('usr_novo', expect.any(File)));
  });

  it('a foto é enviada para o utilizador que se está a editar', async () => {
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await u.click(btnGuardar());
    await waitFor(() => expect(configApi.uploadFoto).toHaveBeenCalledWith('usr_ana', expect.any(File)));
  });

  it('sem id devolvido pela API a foto não é enviada às cegas', async () => {
    configApi.createUser.mockResolvedValue({ ok: true, convite_enviado: true });
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await u.click(btnGuardar());
    await waitFor(() => expect(semDlg()).toBeNull());
    expect(configApi.uploadFoto).not.toHaveBeenCalled();
  });

  it('a foto que falha mostra a mensagem de erro', async () => {
    configApi.uploadFoto.mockRejectedValue(new Error('Imagem vazia ou acima de 5 MB.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('enorme.png', 'image/png')] } });
    await u.click(btnGuardar());
    expect(await screen.findByText('Erro: Imagem vazia ou acima de 5 MB.')).toBeInTheDocument();
  });

  // BUG: Configuracoes.jsx:94-95 — o upload da foto corre DENTRO do mesmo try do
  // createUser. Se a foto falhar, o utilizador já foi criado (e o convite já
  // seguiu) mas o ecrã só diz «Erro:», não fecha o modal nem recarrega a lista.
  // A Dra. carrega outra vez em «Criar» e leva um "e-mail duplicado" sem
  // perceber porquê. A falha da foto não devia esconder que a conta foi criada.
  it.fails('foto falhada não devia esconder que o utilizador foi criado', async () => {
    configApi.uploadFoto.mockRejectedValue(new Error('Imagem acima de 5 MB.'));
    const { utilizador: u } = await montar();
    await abrirNovo(u);
    await preencherMinimo(u);
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('enorme.png', 'image/png')] } });
    await u.click(btnGuardar());
    await screen.findByText('Erro: Imagem acima de 5 MB.');
    expect(configApi.listUsers).toHaveBeenCalledTimes(2);
  });

  it.fails('foto falhada na edição não devia esconder que a alteração foi gravada', async () => {
    configApi.uploadFoto.mockRejectedValue(new Error('Imagem acima de 5 MB.'));
    const { utilizador: u } = await montar();
    await abrirEditar(u, 'Ana Lima');
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('enorme.png', 'image/png')] } });
    await u.click(btnGuardar());
    await screen.findByText('Erro: Imagem acima de 5 MB.');
    expect(configApi.listUsers).toHaveBeenCalledTimes(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   APAGAR UTILIZADOR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Apagar utilizador', () => {
  const confirmar = (u) => u.click(screen.getByRole('button', { name: 'OK' }));
  const cancelarDialogo = (u) => u.click(screen.getByRole('button', { name: 'Cancelar' }));

  it('pede confirmação com o nome e o e-mail', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    expect(await screen.findByText(/Apagar o utilizador «Ana Lima» \(ana@exemplo\.pt\)\?/)).toBeInTheDocument();
  });

  it('avisa que a ação não se desfaz', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    expect(await screen.findByText(/Esta ação não pode ser anulada\./)).toBeInTheDocument();
  });

  it('cancelar não apaga nada', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await cancelarDialogo(u);
    expect(configApi.deleteUser).not.toHaveBeenCalled();
  });

  it('cancelar deixa o utilizador na lista', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await cancelarDialogo(u);
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });

  it('confirmar apaga o utilizador certo', async () => {
    const { utilizador: u } = await montar([utilizador(), utilizador({ id: 'usr_b', name: 'Bruno Costa' })]);
    await u.click(btnAcao('Bruno Costa', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    await waitFor(() => expect(configApi.deleteUser).toHaveBeenCalledWith('usr_b'));
  });

  it('confirma no ecrã que foi apagado', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    expect(await screen.findByText('Utilizador apagado.')).toBeInTheDocument();
  });

  it('depois de apagar recarrega a lista', async () => {
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    await waitFor(() => expect(configApi.listUsers).toHaveBeenCalledTimes(2));
  });

  it('o utilizador apagado desaparece da lista', async () => {
    const { utilizador: u } = await montar();
    configApi.listUsers.mockResolvedValue({ users: [] });
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    await waitFor(() => expect(screen.queryByText('Ana Lima')).not.toBeInTheDocument());
  });

  it('a recusa do servidor aparece no ecrã', async () => {
    configApi.deleteUser.mockRejectedValue(new Error('Não pode apagar o último utilizador com gestão.'));
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    expect(await screen.findByText('Erro: Não pode apagar o último utilizador com gestão.')).toBeInTheDocument();
  });

  it('falhar a apagar não recarrega a lista', async () => {
    configApi.deleteUser.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    await screen.findByText('Erro: boom');
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  it('falhar a apagar deixa o ecrã inteiro de pé', async () => {
    configApi.deleteUser.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar();
    await u.click(btnAcao('Ana Lima', 'Apagar utilizador'));
    await screen.findByText(/Apagar o utilizador/);
    await confirmar(u);
    await screen.findByText('Erro: boom');
    expect(screen.getByRole('button', { name: 'Novo utilizador' })).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   REENVIAR CONVITE
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Reenviar convite', () => {
  const convidada = () => [utilizador({ status: 'convidado' })];
  const btnReenviar = () => screen.getByRole('button', { name: /Reenviar convite/ });

  it('reenvia para o utilizador certo', async () => {
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    await waitFor(() => expect(configApi.reenviarConvite).toHaveBeenCalledWith('usr_ana'));
  });

  it('confirma no ecrã para que e-mail seguiu', async () => {
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    expect(await screen.findByText('Convite reenviado para ana@exemplo.pt.')).toBeInTheDocument();
  });

  it('avisa quando o envio do e-mail falhou', async () => {
    configApi.reenviarConvite.mockResolvedValue({ ok: false, envio: { error: 'domínio não verificado' } });
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    expect(await screen.findByText('O envio do e-mail falhou: domínio não verificado')).toBeInTheDocument();
  });

  it('envio falhado sem detalhe também avisa', async () => {
    configApi.reenviarConvite.mockResolvedValue({ ok: false });
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    expect(await screen.findByText('O envio do e-mail falhou:')).toBeInTheDocument();
  });

  it('erro da API aparece como mensagem', async () => {
    configApi.reenviarConvite.mockRejectedValue(new Error('Este utilizador já concluiu o registo.'));
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    expect(await screen.findByText('Erro: Este utilizador já concluiu o registo.')).toBeInTheDocument();
  });

  it('erro a reenviar não parte o ecrã', async () => {
    configApi.reenviarConvite.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    await screen.findByText('Erro: boom');
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });

  // Reenviar gera um token novo no servidor e invalida o anterior; a lista não é
  // recarregada, por isso a data de expiração no ecrã fica a antiga.
  it('reenviar não recarrega a lista (a data de expiração no ecrã fica velha)', async () => {
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    await screen.findByText('Convite reenviado para ana@exemplo.pt.');
    expect(configApi.listUsers).toHaveBeenCalledTimes(1);
  });

  // BUG: Configuracoes.jsx:219-224 — o botão «Reenviar convite» não tem estado
  // ocupado nem fica desativado enquanto o pedido corre. Dois cliques seguidos
  // geram DOIS tokens; o link do primeiro e-mail (que a pessoa pode já ter
  // aberto) morre em silêncio. Devia bloquear-se enquanto envia.
  it.fails('clicar duas vezes devia enviar um convite só', async () => {
    const { promessa, resolver } = adiar();
    configApi.reenviarConvite.mockReturnValue(promessa);
    const { utilizador: u } = await montar(convidada());
    await u.click(btnReenviar());
    await u.click(btnReenviar());
    resolver({ ok: true });
    expect(configApi.reenviarConvite).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONVITE — validação do link recebido por e-mail
   ═══════════════════════════════════════════════════════════════════════════ */
const TOKEN = 'a1b2c3'.repeat(8);   // 48 hex, como o do worker

function montarConvite(token = TOKEN) {
  return renderizar(<><Convite /><DialogHost /><ToastHost /></>, {
    caminho: `/admin/convite/${token}`, rota: '/admin/convite/:token',
  });
}
const campoConvite = (rotulo) => screen.getByText(rotulo, { selector: 'label' }).parentElement.querySelector('input');
const btnConcluir = () => screen.getByRole('button', { name: /Concluir registo|A concluir…/ });

async function conviteAberto() {
  const vista = montarConvite();
  await screen.findByText(/Bem-vindo\(a\)/);
  return vista;
}

describe('Convite — abrir o link recebido por e-mail', () => {
  it('valida o token que vem no endereço', async () => {
    montarConvite();
    await waitFor(() => expect(conviteApi.info).toHaveBeenCalledWith(TOKEN));
  });

  it('enquanto valida diz que está a validar', async () => {
    const { promessa, resolver } = adiar();
    conviteApi.info.mockReturnValue(promessa);
    montarConvite();
    expect(screen.getByText('A validar o convite…')).toBeInTheDocument();
    resolver({ name: 'Ana', email: 'ana@exemplo.pt' });
    await screen.findByText(/Bem-vindo\(a\)/);
  });

  it('enquanto valida não mostra o formulário', async () => {
    const { promessa, resolver } = adiar();
    conviteApi.info.mockReturnValue(promessa);
    montarConvite();
    expect(screen.queryByRole('button', { name: /Concluir registo/ })).not.toBeInTheDocument();
    resolver({ name: 'Ana', email: 'ana@exemplo.pt' });
    await screen.findByText(/Bem-vindo\(a\)/);
  });

  it('token inválido mostra a mensagem do servidor', async () => {
    conviteApi.info.mockRejectedValue(new Error('Convite inválido ou já utilizado.'));
    montarConvite('naoexiste');
    expect(await screen.findByText('Convite inválido ou já utilizado.')).toBeInTheDocument();
  });

  it('token expirado explica que expirou', async () => {
    conviteApi.info.mockRejectedValue(new Error('Este convite expirou. Peça um novo convite.'));
    montarConvite();
    expect(await screen.findByText('Este convite expirou. Peça um novo convite.')).toBeInTheDocument();
  });

  it('token inválido não mostra o formulário', async () => {
    conviteApi.info.mockRejectedValue(new Error('Convite inválido ou já utilizado.'));
    montarConvite();
    await screen.findByText('Convite inválido ou já utilizado.');
    expect(screen.queryByRole('button', { name: /Concluir registo/ })).not.toBeInTheDocument();
  });

  it('token inválido não deixa definir palavra-passe nenhuma', async () => {
    conviteApi.info.mockRejectedValue(new Error('Convite inválido ou já utilizado.'));
    montarConvite();
    await screen.findByText('Convite inválido ou já utilizado.');
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it('falha de rede a validar também aparece no ecrã', async () => {
    conviteApi.info.mockRejectedValue(new TypeError('Failed to fetch'));
    montarConvite();
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });

  it('token válido dá as boas-vindas pelo nome', async () => {
    await conviteAberto();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });

  it('token válido mostra o e-mail do convite', async () => {
    await conviteAberto();
    expect(screen.getByText(/Complete o seu registo na Área Privada · ana@exemplo\.pt/)).toBeInTheDocument();
  });

  it('pré-preenche o nome, o cargo e o telefone que vieram do convite', async () => {
    await conviteAberto();
    expect(campoConvite('Nome')).toHaveValue('Ana Lima');
    expect(campoConvite('Cargo')).toHaveValue('Assistente jurídica');
    expect(campoConvite('Telefone')).toHaveValue('+351 911 222 333');
  });

  it('campos em falta no convite ficam vazios em vez de "null"', async () => {
    conviteApi.info.mockResolvedValue({ name: 'Ana Lima', email: 'ana@exemplo.pt', cargo: null, phone: null });
    montarConvite();
    await screen.findByText(/Bem-vindo\(a\)/);
    expect(campoConvite('Cargo')).toHaveValue('');
    expect(campoConvite('Telefone')).toHaveValue('');
  });

  it('mostra os dois campos de palavra-passe', async () => {
    await conviteAberto();
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toBeInTheDocument();
    expect(campoConvite('Confirmar palavra-passe')).toBeInTheDocument();
  });

  it('as palavras-passe começam escondidas', async () => {
    await conviteAberto();
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toHaveAttribute('type', 'password');
    expect(campoConvite('Confirmar palavra-passe')).toHaveAttribute('type', 'password');
  });

  it('o token não é escrito em lado nenhum do ecrã', async () => {
    await conviteAberto();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONVITE — definir a palavra-passe
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Convite — definir a palavra-passe', () => {
  const escrever = async (u, pass, conf = pass) => {
    await u.type(campoConvite('Palavra-passe (mín. 8 caracteres)'), pass);
    await u.type(campoConvite('Confirmar palavra-passe'), conf);
  };

  it.each([
    ['1 caracter', 'x'],
    ['3 caracteres', 'abc'],
    ['7 caracteres', 'abc1234'],
  ])('palavra-passe com %s é recusada', async (_nome, pass) => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, pass);
    await u.click(btnConcluir());
    expect(await screen.findByText('A palavra-passe deve ter pelo menos 8 caracteres.')).toBeInTheDocument();
  });

  it('os dois campos de palavra-passe são obrigatórios', async () => {
    await conviteAberto();
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toBeRequired();
    expect(campoConvite('Confirmar palavra-passe')).toBeRequired();
  });

  it('submeter com as palavras-passe em branco não chama a API', async () => {
    const { utilizador: u } = await conviteAberto();
    await u.click(btnConcluir());
    expect(conviteApi.concluir).not.toHaveBeenCalled();
  });

  it('palavra-passe curta não chega a chamar a API', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'abc1234');
    await u.click(btnConcluir());
    await screen.findByText('A palavra-passe deve ter pelo menos 8 caracteres.');
    expect(conviteApi.concluir).not.toHaveBeenCalled();
  });

  it('exatamente 8 caracteres é aceite', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'abcd1234');
    await u.click(btnConcluir());
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalled());
  });

  it('palavras-passe diferentes são recusadas', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!', 'Segredo123?');
    await u.click(btnConcluir());
    expect(await screen.findByText('As palavras-passe não coincidem.')).toBeInTheDocument();
  });

  it('palavras-passe diferentes não chamam a API', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!', 'Segredo123?');
    await u.click(btnConcluir());
    await screen.findByText('As palavras-passe não coincidem.');
    expect(conviteApi.concluir).not.toHaveBeenCalled();
  });

  it('um espaço a mais na confirmação já não coincide', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!', 'Segredo123! ');
    await u.click(btnConcluir());
    expect(await screen.findByText('As palavras-passe não coincidem.')).toBeInTheDocument();
  });

  it('a diferença nas maiúsculas conta como não coincidente', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123', 'segredo123');
    await u.click(btnConcluir());
    expect(await screen.findByText('As palavras-passe não coincidem.')).toBeInTheDocument();
  });

  it('corrigir a confirmação limpa o aviso anterior', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!', 'Segredo123?');
    await u.click(btnConcluir());
    await screen.findByText('As palavras-passe não coincidem.');
    await u.clear(campoConvite('Confirmar palavra-passe'));
    await u.type(campoConvite('Confirmar palavra-passe'), 'Segredo123!');
    await u.click(btnConcluir());
    await waitFor(() => expect(screen.queryByText('As palavras-passe não coincidem.')).not.toBeInTheDocument());
  });

  // A única regra de força é o comprimento — igual à do worker
  // (worker/routes/config.js:99). Não há exigência de maiúsculas, dígitos ou
  // símbolos, nem lista de palavras-passe comuns.
  it('«12345678» é aceite — a única regra de força é o comprimento', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, '12345678');
    await u.click(btnConcluir());
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalled());
  });

  it('oito espaços contam como palavra-passe válida', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, '        ');
    await u.click(btnConcluir());
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalled());
  });

  it('o olho mostra a palavra-passe', async () => {
    const { utilizador: u } = await conviteAberto();
    await u.click(screen.getAllByRole('button', { name: 'Mostrar palavra-passe' })[0]);
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toHaveAttribute('type', 'text');
  });

  it('o olho de um campo não descobre o outro', async () => {
    const { utilizador: u } = await conviteAberto();
    await u.click(screen.getAllByRole('button', { name: 'Mostrar palavra-passe' })[0]);
    expect(campoConvite('Confirmar palavra-passe')).toHaveAttribute('type', 'password');
  });

  it('voltar a clicar no olho esconde outra vez', async () => {
    const { utilizador: u } = await conviteAberto();
    await u.click(screen.getAllByRole('button', { name: 'Mostrar palavra-passe' })[0]);
    await u.click(screen.getByRole('button', { name: 'Ocultar palavra-passe' }));
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toHaveAttribute('type', 'password');
  });

  it('a palavra-passe escrita nunca é desenhada como texto no ecrã', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!');
    expect(document.body.textContent).not.toContain('Segredo123!');
  });

  it('mostrar a palavra-passe não a escreve fora do campo', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!');
    await u.click(screen.getAllByRole('button', { name: 'Mostrar palavra-passe' })[0]);
    expect(document.body.textContent).not.toContain('Segredo123!');
  });

  it('a palavra-passe não é guardada no armazenamento do browser', async () => {
    const { utilizador: u } = await conviteAberto();
    await escrever(u, 'Segredo123!');
    expect(sessionStorage.getItem('vyvian_admin_user')).not.toContain('Segredo123!');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('Segredo123!');
  });

  it('os campos pedem ao browser uma palavra-passe nova (não a guardada)', async () => {
    await conviteAberto();
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toHaveAttribute('autocomplete', 'new-password');
    expect(campoConvite('Confirmar palavra-passe')).toHaveAttribute('autocomplete', 'new-password');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONVITE — concluir o registo
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Convite — concluir o registo', () => {
  async function concluir(u, pass = 'Segredo123!') {
    await u.type(campoConvite('Palavra-passe (mín. 8 caracteres)'), pass);
    await u.type(campoConvite('Confirmar palavra-passe'), pass);
    await u.click(btnConcluir());
  }

  it('envia o token e os dados do registo', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalledWith(TOKEN, {
      password: 'Segredo123!', name: 'Ana Lima', cargo: 'Assistente jurídica', phone: '+351 911 222 333',
    }));
  });

  it('envia o nome corrigido pela pessoa', async () => {
    const { utilizador: u } = await conviteAberto();
    await u.clear(campoConvite('Nome'));
    await u.type(campoConvite('Nome'), 'Ana Lima Ferreira');
    await concluir(u);
    await waitFor(() => expect(conviteApi.concluir.mock.calls.at(-1)[1].name).toBe('Ana Lima Ferreira'));
  });

  it('envia o cargo escrito na hora', async () => {
    conviteApi.info.mockResolvedValue({ name: 'Ana Lima', email: 'ana@exemplo.pt', cargo: '', phone: '' });
    const vista = montarConvite();
    await screen.findByText(/Bem-vindo\(a\)/);
    await vista.utilizador.type(campoConvite('Cargo'), 'Advogada estagiária');
    await concluir(vista.utilizador);
    await waitFor(() => expect(conviteApi.concluir.mock.calls.at(-1)[1].cargo).toBe('Advogada estagiária'));
  });

  it('anuncia que o registo ficou concluído', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByRole('heading', { name: /Registo concluído/ })).toBeInTheDocument();
  });

  it('avisa que vai encaminhar para o início de sessão', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByText(/A redirecionar para o início de sessão/)).toBeInTheDocument();
  });

  it('o formulário desaparece depois de concluído', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await screen.findByRole('heading', { name: /Registo concluído/ });
    expect(screen.queryByRole('button', { name: /Concluir registo/ })).not.toBeInTheDocument();
  });

  it('encaminha mesmo para o início de sessão', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await screen.findByRole('heading', { name: /Registo concluído/ });
    await waitFor(() => expect(navegou).toHaveBeenCalledWith('/admin/login'), { timeout: 5000 });
  }, 10000);

  it('enquanto conclui o botão avisa', async () => {
    const { promessa, resolver } = adiar();
    conviteApi.concluir.mockReturnValue(promessa);
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByRole('button', { name: 'A concluir…' })).toBeInTheDocument();
    resolver({ ok: true });
  });

  it('enquanto conclui os campos ficam bloqueados', async () => {
    const { promessa, resolver } = adiar();
    conviteApi.concluir.mockReturnValue(promessa);
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await waitFor(() => expect(campoConvite('Nome')).toBeDisabled());
    resolver({ ok: true });
  });

  it('convite que expirou entretanto mostra o erro sem perder o formulário', async () => {
    conviteApi.concluir.mockRejectedValue(new Error('Este convite expirou. Peça um novo convite.'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByText('Este convite expirou. Peça um novo convite.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir registo' })).toBeInTheDocument();
  });

  it('convite já usado mostra o erro do servidor', async () => {
    conviteApi.concluir.mockRejectedValue(new Error('Convite inválido ou já utilizado.'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByText('Convite inválido ou já utilizado.')).toBeInTheDocument();
  });

  it('erro ao concluir não dá o registo por feito', async () => {
    conviteApi.concluir.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await screen.findByText('boom');
    expect(screen.queryByRole('heading', { name: /Registo concluído/ })).not.toBeInTheDocument();
  });

  it('erro ao concluir mantém os campos preenchidos', async () => {
    conviteApi.concluir.mockRejectedValue(new Error('boom'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await screen.findByText('boom');
    expect(campoConvite('Nome')).toHaveValue('Ana Lima');
    expect(campoConvite('Palavra-passe (mín. 8 caracteres)')).toHaveValue('Segredo123!');
  });

  it('depois de falhar dá para tentar outra vez', async () => {
    conviteApi.concluir.mockRejectedValueOnce(new Error('boom'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await screen.findByText('boom');
    await u.click(btnConcluir());
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalledTimes(2));
  });

  it('falha de rede a concluir aparece no ecrã', async () => {
    conviteApi.concluir.mockRejectedValue(new TypeError('Failed to fetch'));
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONVITE — foto de perfil
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Convite — foto de perfil', () => {
  const inputFoto = () => document.querySelector('input[type="file"]');
  async function concluir(u, pass = 'Segredo123!') {
    await u.type(campoConvite('Palavra-passe (mín. 8 caracteres)'), pass);
    await u.type(campoConvite('Confirmar palavra-passe'), pass);
    await u.click(btnConcluir());
  }

  it('convida a juntar uma foto', async () => {
    await conviteAberto();
    expect(screen.getByText('+ foto')).toBeInTheDocument();
  });

  it('escolher uma imagem mostra a pré-visualização', async () => {
    await conviteAberto();
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await waitFor(() => expect(screen.queryByText('+ foto')).not.toBeInTheDocument());
  });

  // Ao contrário do modal das Configurações, aqui um ficheiro errado é ignorado
  // sem dizer nada — a pessoa fica sem saber porque é que a foto não apareceu.
  it('um ficheiro que não é imagem é ignorado em silêncio', async () => {
    await conviteAberto();
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('contrato.pdf', 'application/pdf')] } });
    expect(screen.getByText('+ foto')).toBeInTheDocument();
  });

  it('sem foto não se chama o upload', async () => {
    const { utilizador: u } = await conviteAberto();
    await concluir(u);
    await waitFor(() => expect(conviteApi.concluir).toHaveBeenCalled());
    expect(conviteApi.uploadFoto).not.toHaveBeenCalled();
  });

  it('a foto é enviada com o token do convite', async () => {
    const { utilizador: u } = await conviteAberto();
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('retrato.png', 'image/png')] } });
    await concluir(u);
    await waitFor(() => expect(conviteApi.uploadFoto).toHaveBeenCalledWith(TOKEN, expect.any(File)));
  });

  // Decisão deliberada do ecrã: a foto não pode travar o registo. O senão é que
  // a falha é totalmente silenciosa — a pessoa fica convencida de que ficou.
  it('a foto que falha não impede o registo', async () => {
    conviteApi.uploadFoto.mockRejectedValue(new Error('Imagem acima de 5 MB.'));
    const { utilizador: u } = await conviteAberto();
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('enorme.png', 'image/png')] } });
    await concluir(u);
    expect(await screen.findByRole('heading', { name: /Registo concluído/ })).toBeInTheDocument();
  });

  it('a foto que falha não mostra aviso nenhum', async () => {
    conviteApi.uploadFoto.mockRejectedValue(new Error('Imagem acima de 5 MB.'));
    const { utilizador: u } = await conviteAberto();
    fireEvent.change(inputFoto(), { target: { files: [ficheiro('enorme.png', 'image/png')] } });
    await concluir(u);
    await screen.findByRole('heading', { name: /Registo concluído/ });
    expect(screen.queryByText(/Imagem acima de 5 MB/)).not.toBeInTheDocument();
  });
});
