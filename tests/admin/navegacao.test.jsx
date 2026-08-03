// @vitest-environment jsdom
// tests/admin/navegacao.test.jsx
// Guardas de rota (src/admin/AdminApp.jsx) e menu lateral (src/admin/Sidebar.jsx).
//
// tests/admin/perms.test.js já prova que `podeAceder` devolve true/false nos
// sítios certos. O que se prova aqui é a LIGAÇÃO à interface:
//   · quem não tem sessão vê o login e não vê o conteúdo, em qualquer rota;
//   · o menu esconde mesmo a aba que a utilizadora não pode ver;
//   · escrever o endereço à mão não passa ao lado do gate;
//   · terminar sessão limpa tudo e devolve ao login.
//
// As páginas são substituídas por marcadores: o que interessa é qual delas
// aparece, não o que cada uma faz (e assim nenhuma tenta ir à rede).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderizar, screen, waitFor } from '../helpers/dom.jsx';

vi.mock('../../src/admin/apiClient.js', async (original) => {
  const real = await original();
  return { ...real, auth: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } };
});

// ── páginas substituídas por marcadores ──────────────────────────────────────
vi.mock('../../src/admin/pages/Dashboard.jsx', () => ({ default: () => <div>PÁGINA Painel</div> }));
vi.mock('../../src/admin/pages/Clients.jsx', () => ({ default: () => <div>PÁGINA Clientes</div> }));
vi.mock('../../src/admin/pages/ClientDetail.jsx', () => ({ default: () => <div>PÁGINA Ficha do cliente</div> }));
vi.mock('../../src/admin/pages/NewClient.jsx', () => ({ default: () => <div>PÁGINA Novo cliente</div> }));
vi.mock('../../src/admin/pages/Calendar.jsx', () => ({ default: () => <div>PÁGINA Calendário</div> }));
vi.mock('../../src/admin/pages/Installments.jsx', () => ({ default: () => <div>PÁGINA Parcelas</div> }));
vi.mock('../../src/admin/pages/Notifications.jsx', () => ({ default: () => <div>PÁGINA Notificações</div> }));
vi.mock('../../src/admin/pages/Statistics.jsx', () => ({ default: () => <div>PÁGINA Redes Sociais</div> }));
vi.mock('../../src/admin/pages/Apoio.jsx', () => ({ default: () => <div>PÁGINA Apoio Técnico</div> }));
vi.mock('../../src/admin/pages/Configuracoes.jsx', () => ({ default: () => <div>PÁGINA Configurações</div> }));
vi.mock('../../src/admin/pages/Convite.jsx', () => ({ default: () => <div>PÁGINA Convite</div> }));
vi.mock('../../src/admin/cmdk.jsx', () => ({ default: () => null }));
vi.mock('../../src/admin/dialogs.jsx', () => ({ DialogHost: () => null }));
vi.mock('../../src/admin/toasts.jsx', () => ({ ToastHost: () => null }));

import { auth as apiAuth } from '../../src/admin/apiClient.js';
import AdminApp from '../../src/admin/AdminApp.jsx';
import Sidebar from '../../src/admin/Sidebar.jsx';

const TOKEN_KEY = 'vyvian_admin_token';
const USER_KEY = 'vyvian_admin_user';

// Todas as rotas privadas: [endereço, marcador da página, permissão exigida]
const ROTAS = [
  ['/admin/painel', 'PÁGINA Painel', 'painel'],
  ['/admin/clientes', 'PÁGINA Clientes', 'clientes'],
  ['/admin/clientes/novo', 'PÁGINA Novo cliente', 'clientes'],
  ['/admin/clientes/cli_123', 'PÁGINA Ficha do cliente', 'clientes'],
  ['/admin/parcelas', 'PÁGINA Parcelas', 'parcelas'],
  ['/admin/calendario', 'PÁGINA Calendário', 'calendario'],
  ['/admin/notificacoes', 'PÁGINA Notificações', 'notificacoes'],
  ['/admin/estatisticas', 'PÁGINA Redes Sociais', 'estatisticas'],
  ['/admin/apoio', 'PÁGINA Apoio Técnico', 'apoio'],
  ['/admin/configuracoes', 'PÁGINA Configurações', 'configuracoes'],
];

const ABAS_DO_MENU = [
  'Painel', 'Clientes', 'Parcelas', 'Calendário',
  'Notificações', 'Redes Sociais', 'Apoio Técnico', 'Configurações',
];

const UTILIZADOR = { id: 'usr_dra', email: 'dra@exemplo.pt', name: 'Vyvian Avena', role: 'admin' };

// ── utilitários ──────────────────────────────────────────────────────────────
function comSessao(permissions = ['*'], utilizador = UTILIZADOR) {
  sessionStorage.setItem(TOKEN_KEY, 'jwt-de-teste');
  const user = permissions === undefined ? utilizador : { ...utilizador, permissions };
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}
const semSessao = () => sessionStorage.clear();

const abrir = (caminho) => renderizar(<AdminApp />, { caminho, rota: '/admin/*' });
const abrirMenu = (caminho = '/admin/painel') => renderizar(<Sidebar />, { caminho });

const estaNoLogin = () => screen.queryByRole('button', { name: 'Entrar' }) !== null;
const temBarraLateral = () => screen.queryByText('Área Privada') !== null;
const abasVisiveis = () => screen.queryAllByRole('link').map((a) => a.textContent.trim());

beforeEach(() => {
  sessionStorage.clear();
  apiAuth.login.mockReset();
  apiAuth.logout.mockReset().mockResolvedValue({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('sem sessão — a porta está fechada', () => {
  it.each(ROTAS)('%s manda para o login e não deixa ver o conteúdo', (caminho, marcador) => {
    semSessao();
    abrir(caminho);
    expect(estaNoLogin()).toBe(true);
    expect(screen.queryByText(marcador)).not.toBeInTheDocument();
  });

  it('não mostra sequer a barra lateral', () => {
    semSessao();
    abrir('/admin/painel');
    expect(temBarraLateral()).toBe(false);
  });

  it('o endereço /admin sem mais nada também cai no login', () => {
    semSessao();
    abrir('/admin');
    expect(estaNoLogin()).toBe(true);
  });

  it('uma rota inventada também cai no login', () => {
    semSessao();
    abrir('/admin/isto-nao-existe');
    expect(estaNoLogin()).toBe(true);
  });

  it('token sem utilizador guardado não abre a porta', () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt-de-teste');
    abrir('/admin/painel');
    expect(estaNoLogin()).toBe(true);
  });

  it('utilizador guardado sem token não abre a porta', () => {
    sessionStorage.setItem(USER_KEY, JSON.stringify(UTILIZADOR));
    abrir('/admin/painel');
    expect(estaNoLogin()).toBe(true);
  });

  it('sessão corrompida não abre a porta', () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt-de-teste');
    sessionStorage.setItem(USER_KEY, '{isto não é json');
    abrir('/admin/clientes');
    expect(estaNoLogin()).toBe(true);
  });

  it('o ecrã de login aparece sem barra lateral nem menu', () => {
    semSessao();
    abrir('/admin/login');
    expect(estaNoLogin()).toBe(true);
    expect(temBarraLateral()).toBe(false);
  });

  it('o convite por link é público — abre sem sessão nenhuma', () => {
    semSessao();
    abrir('/admin/convite/tok_abc123');
    expect(screen.getByText('PÁGINA Convite')).toBeInTheDocument();
    expect(estaNoLogin()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('com sessão e acesso total — a Área Privada abre', () => {
  it.each(ROTAS)('%s mostra o conteúdo e não o login', (caminho, marcador) => {
    comSessao(['*']);
    abrir(caminho);
    expect(screen.getByText(marcador)).toBeInTheDocument();
    expect(estaNoLogin()).toBe(false);
  });

  it('mostra a barra lateral em volta da página', () => {
    comSessao(['*']);
    abrir('/admin/painel');
    expect(temBarraLateral()).toBe(true);
  });

  it('/admin sem mais nada abre no painel', () => {
    comSessao(['*']);
    abrir('/admin');
    expect(screen.getByText('PÁGINA Painel')).toBeInTheDocument();
  });

  it('uma rota inventada dentro da Área Privada volta ao painel', () => {
    comSessao(['*']);
    abrir('/admin/relatorios-secretos');
    expect(screen.getByText('PÁGINA Painel')).toBeInTheDocument();
  });

  it('uma rota inventada com vários níveis também volta ao painel', () => {
    comSessao(['*']);
    abrir('/admin/a/b/c');
    expect(screen.getByText('PÁGINA Painel')).toBeInTheDocument();
  });

  // Documentado: o /admin/login continua a mostrar o formulário mesmo com a
  // sessão aberta (AdminApp.jsx:62 não tem gate). Não é um buraco de segurança
  // — só uma oportunidade perdida de a levar direto ao painel.
  it('quem já entrou e volta ao /admin/login vê o formulário outra vez', () => {
    comSessao(['*']);
    abrir('/admin/login');
    expect(estaNoLogin()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('o menu mostra só as abas permitidas', () => {
  it('com acesso total mostra as oito abas', () => {
    comSessao(['*']);
    abrirMenu();
    expect(abasVisiveis()).toEqual(ABAS_DO_MENU);
  });

  it('com uma lista específica mostra só essas', () => {
    comSessao(['clientes', 'apoio']);
    abrirMenu();
    expect(abasVisiveis()).toEqual(['Clientes', 'Apoio Técnico']);
  });

  it('a aba proibida não aparece em lado nenhum do menu', () => {
    comSessao(['clientes']);
    abrirMenu();
    expect(screen.queryByText('Configurações')).not.toBeInTheDocument();
    expect(screen.queryByText('Parcelas')).not.toBeInTheDocument();
  });

  it('com a lista vazia não sobra aba nenhuma', () => {
    comSessao([]);
    abrirMenu();
    expect(abasVisiveis()).toEqual([]);
  });

  it('com permissões que não são abas nenhumas o menu fica vazio', () => {
    comSessao(['gerir_utilizadores']);
    abrirMenu();
    expect(abasVisiveis()).toEqual([]);
  });

  it('sessão antiga sem o campo permissions vê tudo (retrocompatibilidade)', () => {
    comSessao(undefined);
    abrirMenu();
    expect(abasVisiveis()).toEqual(ABAS_DO_MENU);
  });

  it('permissions com o tipo errado também vê tudo (retrocompatibilidade)', () => {
    comSessao('clientes');
    abrirMenu();
    expect(abasVisiveis()).toEqual(ABAS_DO_MENU);
  });

  it('o curinga no meio da lista abre tudo', () => {
    comSessao(['apoio', '*']);
    abrirMenu();
    expect(abasVisiveis()).toEqual(ABAS_DO_MENU);
  });

  it.each([
    ['painel', 'Painel'],
    ['clientes', 'Clientes'],
    ['parcelas', 'Parcelas'],
    ['calendario', 'Calendário'],
    ['notificacoes', 'Notificações'],
    ['estatisticas', 'Redes Sociais'],
    ['apoio', 'Apoio Técnico'],
    ['configuracoes', 'Configurações'],
  ])('só com «%s» o menu tem apenas «%s»', (permissao, aba) => {
    comSessao([permissao]);
    abrirMenu();
    expect(abasVisiveis()).toEqual([aba]);
  });

  it('mantém sempre a mesma ordem, seja qual for a ordem das permissões', () => {
    comSessao(['configuracoes', 'painel', 'apoio']);
    abrirMenu();
    expect(abasVisiveis()).toEqual(['Painel', 'Apoio Técnico', 'Configurações']);
  });

  it('a aba das redes sociais chama-se «Redes Sociais» mas a permissão é «estatisticas»', () => {
    comSessao(['estatisticas']);
    abrirMenu();
    expect(screen.getByRole('link', { name: 'Redes Sociais' })).toHaveAttribute('href', '/admin/estatisticas');
  });

  it('cada aba aponta para a sua rota', () => {
    comSessao(['*']);
    abrirMenu();
    for (const [rota] of ROTAS.filter(([r]) => !r.includes('/', 7))) {
      // só as rotas de topo estão no menu
      expect(screen.queryAllByRole('link').some((a) => a.getAttribute('href') === rota)).toBe(true);
    }
  });

  it('sem sessão nenhuma o menu mostra tudo — quem barra é o gate da rota', () => {
    semSessao();
    abrirMenu();
    expect(abasVisiveis()).toEqual(ABAS_DO_MENU);
  });

  it('o menu também aparece filtrado dentro da aplicação inteira', () => {
    comSessao(['apoio', 'clientes']);
    abrir('/admin/apoio');
    expect(abasVisiveis()).toEqual(['Clientes', 'Apoio Técnico']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('a aba onde a Dra. está fica marcada', () => {
  it('em /admin/clientes a aba Clientes está marcada', () => {
    comSessao(['*']);
    abrirMenu('/admin/clientes');
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page');
  });

  it('só uma aba fica marcada de cada vez', () => {
    comSessao(['*']);
    abrirMenu('/admin/clientes');
    const marcadas = screen.queryAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(marcadas).toHaveLength(1);
  });

  it('a aba marcada tem a classe que desenha a pílula', () => {
    comSessao(['*']);
    abrirMenu('/admin/parcelas');
    expect(screen.getByRole('link', { name: 'Parcelas' }).className).toContain('active');
  });

  it.each([
    ['/admin/painel', 'Painel'],
    ['/admin/parcelas', 'Parcelas'],
    ['/admin/calendario', 'Calendário'],
    ['/admin/notificacoes', 'Notificações'],
    ['/admin/estatisticas', 'Redes Sociais'],
    ['/admin/apoio', 'Apoio Técnico'],
    ['/admin/configuracoes', 'Configurações'],
  ])('em %s a aba marcada é «%s»', (caminho, aba) => {
    comSessao(['*']);
    abrirMenu(caminho);
    expect(screen.getByRole('link', { name: aba })).toHaveAttribute('aria-current', 'page');
  });

  it('numa página filha (ficha de cliente) a aba Clientes continua marcada', () => {
    comSessao(['*']);
    abrirMenu('/admin/clientes/cli_123');
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page');
  });

  it('em «novo cliente» a aba Clientes continua marcada', () => {
    comSessao(['*']);
    abrirMenu('/admin/clientes/novo');
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page');
  });

  it('numa rota fora do menu nenhuma aba fica marcada', () => {
    comSessao(['*']);
    abrirMenu('/admin/convite/tok_1');
    const marcadas = screen.queryAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(marcadas).toHaveLength(0);
  });

  it('dentro da aplicação inteira a marcação também acompanha a página', () => {
    comSessao(['*']);
    abrir('/admin/apoio');
    expect(screen.getByRole('link', { name: 'Apoio Técnico' })).toHaveAttribute('aria-current', 'page');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('escrever o endereço à mão não passa ao lado das permissões', () => {
  it('sem a permissão das configurações, /admin/configuracoes não abre', () => {
    comSessao(['apoio']);
    abrir('/admin/configuracoes');
    expect(screen.queryByText('PÁGINA Configurações')).not.toBeInTheDocument();
  });

  it('e devolve à primeira aba permitida', () => {
    comSessao(['apoio']);
    abrir('/admin/configuracoes');
    expect(screen.getByText('PÁGINA Apoio Técnico')).toBeInTheDocument();
  });

  it.each([
    ['/admin/painel', 'PÁGINA Painel'],
    ['/admin/clientes', 'PÁGINA Clientes'],
    ['/admin/parcelas', 'PÁGINA Parcelas'],
    ['/admin/calendario', 'PÁGINA Calendário'],
    ['/admin/notificacoes', 'PÁGINA Notificações'],
    ['/admin/estatisticas', 'PÁGINA Redes Sociais'],
    ['/admin/configuracoes', 'PÁGINA Configurações'],
  ])('quem só tem «apoio» não entra em %s', (caminho, marcador) => {
    comSessao(['apoio']);
    abrir(caminho);
    expect(screen.queryByText(marcador)).not.toBeInTheDocument();
  });

  it('a ficha de um cliente exige a permissão dos clientes', () => {
    comSessao(['parcelas']);
    abrir('/admin/clientes/cli_123');
    expect(screen.queryByText('PÁGINA Ficha do cliente')).not.toBeInTheDocument();
    expect(screen.getByText('PÁGINA Parcelas')).toBeInTheDocument();
  });

  it('criar cliente novo exige a permissão dos clientes', () => {
    comSessao(['parcelas']);
    abrir('/admin/clientes/novo');
    expect(screen.queryByText('PÁGINA Novo cliente')).not.toBeInTheDocument();
  });

  it('quem tem «clientes» entra na ficha do cliente', () => {
    comSessao(['clientes']);
    abrir('/admin/clientes/cli_123');
    expect(screen.getByText('PÁGINA Ficha do cliente')).toBeInTheDocument();
  });

  it('quem tem «clientes» entra no formulário de cliente novo', () => {
    comSessao(['clientes']);
    abrir('/admin/clientes/novo');
    expect(screen.getByText('PÁGINA Novo cliente')).toBeInTheDocument();
  });

  it('a permissão só abre a sua aba, não as vizinhas', () => {
    comSessao(['clientes']);
    abrir('/admin/parcelas');
    expect(screen.queryByText('PÁGINA Parcelas')).not.toBeInTheDocument();
    expect(screen.getByText('PÁGINA Clientes')).toBeInTheDocument();
  });

  it('uma rota inventada com permissões limitadas cai na primeira aba permitida', () => {
    comSessao(['apoio']);
    abrir('/admin/isto-nao-existe');
    expect(screen.getByText('PÁGINA Apoio Técnico')).toBeInTheDocument();
  });

  it('/admin com permissões limitadas também cai na primeira aba permitida', () => {
    comSessao(['configuracoes']);
    abrir('/admin');
    expect(screen.getByText('PÁGINA Configurações')).toBeInTheDocument();
  });

  it.each(ROTAS.filter(([r]) => ['/admin/painel', '/admin/clientes/cli_123', '/admin/configuracoes'].includes(r)))(
    'sessão antiga sem permissions entra em %s (retrocompatibilidade)',
    (caminho, marcador) => {
      comSessao(undefined);
      abrir(caminho);
      expect(screen.getByText(marcador)).toBeInTheDocument();
    },
  );

  // Documentado: com uma sessão sem permissão nenhuma, `primeiraRotaPermitida`
  // devolve '/admin/login' (src/admin/perms.js:25) e o gate atira-a para o
  // formulário de entrada — autenticada, mas sem nada para ver. Não há ciclo
  // infinito (o login não redireciona ninguém), só um beco sem saída.
  it('uma conta sem permissão nenhuma acaba no ecrã de login', () => {
    comSessao([]);
    abrir('/admin/painel');
    expect(estaNoLogin()).toBe(true);
  });

  it('a conta sem permissões não vê conteúdo nenhum da Área Privada', () => {
    comSessao([]);
    abrir('/admin/clientes');
    expect(screen.queryByText('PÁGINA Clientes')).not.toBeInTheDocument();
    expect(temBarraLateral()).toBe(false);
  });

  it('as maiúsculas contam: «Clientes» não abre a aba «clientes»', () => {
    comSessao(['Clientes']);
    abrir('/admin/clientes');
    expect(screen.queryByText('PÁGINA Clientes')).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('o menu de perfil', () => {
  const perfil = () => screen.getByRole('button', { name: /Titular/ });

  it('mostra o nome de quem tem a sessão aberta', () => {
    comSessao(['*'], { ...UTILIZADOR, name: 'Ana Assistente' });
    abrirMenu();
    expect(screen.getByText('Ana Assistente')).toBeInTheDocument();
  });

  it('sem nome na sessão mostra o nome da titular', () => {
    comSessao(['*'], { id: 'usr_x' });
    abrirMenu();
    expect(screen.getByText('Vyvian Avena')).toBeInTheDocument();
  });

  it('começa fechado', () => {
    comSessao(['*']);
    abrirMenu();
    expect(screen.queryByText('Terminar sessão')).not.toBeInTheDocument();
    expect(perfil()).toHaveAttribute('aria-expanded', 'false');
  });

  it('abre ao clicar no perfil', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    expect(screen.getByText('Terminar sessão')).toBeInTheDocument();
    expect(perfil()).toHaveAttribute('aria-expanded', 'true');
  });

  it('volta a fechar ao clicar outra vez', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    await utilizador.click(perfil());
    expect(screen.queryByText('Terminar sessão')).not.toBeInTheDocument();
  });

  it('fecha com a tecla Escape', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    await utilizador.keyboard('{Escape}');
    expect(screen.queryByText('Terminar sessão')).not.toBeInTheDocument();
  });

  it('fecha ao clicar fora', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    await utilizador.click(document.body);
    expect(screen.queryByText('Terminar sessão')).not.toBeInTheDocument();
  });

  it('mostra de quem é a sessão dentro do menu aberto', async () => {
    comSessao(['*'], { ...UTILIZADOR, name: 'Ana Assistente' });
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    expect(screen.getByText(/Sessão iniciada como/)).toBeInTheDocument();
  });

  it('«Gerir equipa» ainda não está disponível', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    expect(screen.getByRole('button', { name: /Gerir equipa/ })).toBeDisabled();
  });

  it('os botões do menu não submetem formulários', async () => {
    comSessao(['*']);
    const { utilizador } = abrirMenu();
    await utilizador.click(perfil());
    expect(screen.getByRole('button', { name: /Terminar sessão/ })).toHaveAttribute('type', 'button');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('terminar sessão', () => {
  const perfil = () => screen.getByRole('button', { name: /Titular/ });

  async function sair() {
    comSessao(['*']);
    const vista = abrir('/admin/painel');
    await vista.utilizador.click(perfil());
    await vista.utilizador.click(screen.getByRole('button', { name: /Terminar sessão/ }));
    return vista;
  }

  it('leva de volta ao ecrã de login', async () => {
    await sair();
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('apaga o token da sessão', async () => {
    await sair();
    await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBe(null));
  });

  it('apaga o utilizador guardado', async () => {
    await sair();
    await waitFor(() => expect(sessionStorage.getItem(USER_KEY)).toBe(null));
  });

  it('avisa o servidor para revogar a sessão', async () => {
    await sair();
    await waitFor(() => expect(apiAuth.logout).toHaveBeenCalledTimes(1));
  });

  it('a barra lateral desaparece', async () => {
    await sair();
    await waitFor(() => expect(temBarraLateral()).toBe(false));
  });

  it('o conteúdo da página desaparece', async () => {
    await sair();
    await waitFor(() => expect(screen.queryByText('PÁGINA Painel')).not.toBeInTheDocument());
  });

  it('sai à mesma quando o servidor não responde', async () => {
    apiAuth.logout.mockRejectedValue(new TypeError('Failed to fetch'));
    await sair();
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(null);
  });

  it('depois de sair, voltar à rota privada já não deixa entrar', async () => {
    await sair();
    await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBe(null));
    abrir('/admin/clientes');
    expect(screen.queryByText('PÁGINA Clientes')).not.toBeInTheDocument();
  });
});
