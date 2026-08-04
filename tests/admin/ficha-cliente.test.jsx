// @vitest-environment jsdom
// tests/admin/ficha-cliente.test.jsx
// Ficha do cliente (src/admin/pages/ClientDetail.jsx) — o ecrã onde a Dra. passa
// mais tempo: plano de honorários, parcelas, recibos/faturas, procurações,
// documentos, lembretes e a edição do cadastro.
//
// É o maior ficheiro da Área Privada e o que mexe em dinheiro: uma parcela que
// desaparece, um "pago" que não se desmarca ou um plano que deixa de fechar com
// o total contratado são erros que chegam ao cliente. Testa-se o que ela vê:
// títulos, botões, mensagens e os pedidos que saem para a API.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { renderizar, screen, within, waitFor, fireEvent } from '../helpers/dom.jsx';

// ─── espia da navegação ──────────────────────────────────────────────────────
const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navegou };
});

// ─── API mockada (a rede está fechada em tests/setup.js) ─────────────────────
const api = vi.hoisted(() => ({
  clienteGet: vi.fn(), clienteUpdate: vi.fn(), clienteRemove: vi.fn(),
  parcelaCriar: vi.fn(), parcelaUpdate: vi.fn(), parcelaRemover: vi.fn(), parcelaPagar: vi.fn(),
  docsParcelaInfo: vi.fn(), docParcelaUpload: vi.fn(), docParcelaAbrir: vi.fn(),
  docParcelaRemover: vi.fn(), docParcelaEnviar: vi.fn(),
  procModelos: vi.fn(), procPreview: vi.fn(), procGerar: vi.fn(),
  planoGerar: vi.fn(), planoEnviar: vi.fn(),
  tokenCriar: vi.fn(), tokenListar: vi.fn(), tokenRevogar: vi.fn(),
  ficheirosListar: vi.fn(), ficheiroRemover: vi.fn(), ficheiroAbrir: vi.fn(),
  logoUrl: vi.fn(), logoUpload: vi.fn(), logoRemover: vi.fn(),
  calendario: vi.fn(),
  notifLog: vi.fn(), notifRegras: vi.fn(), notifModelos: vi.fn(),
  notifCriarRegra: vi.fn(), notifUpdateRegra: vi.fn(), notifRemoverRegra: vi.fn(),
}));

vi.mock('../../src/admin/apiClient.js', () => ({
  clients: {
    get: api.clienteGet, update: api.clienteUpdate, remove: api.clienteRemove,
    list: vi.fn(), create: vi.fn(),
  },
  installments: {
    create: api.parcelaCriar, update: api.parcelaUpdate, remove: api.parcelaRemover,
    markPaid: api.parcelaPagar, list: vi.fn(), get: vi.fn(), upcoming: vi.fn(),
  },
  recibos: {
    infoAll: api.docsParcelaInfo, info: vi.fn(), upload: api.docParcelaUpload,
    openInNewTab: api.docParcelaAbrir, remove: api.docParcelaRemover, sendToClient: api.docParcelaEnviar,
  },
  procuracoes: { listTemplates: api.procModelos, preview: api.procPreview, generateOpen: api.procGerar },
  planos: { info: vi.fn(), enviar: api.planoEnviar, generateOpen: api.planoGerar },
  uploadTokens: { create: api.tokenCriar, list: api.tokenListar, revoke: api.tokenRevogar },
  clientDocs: { list: api.ficheirosListar, remove: api.ficheiroRemover, openInNewTab: api.ficheiroAbrir },
  clientLogo: { fetchUrl: api.logoUrl, upload: api.logoUpload, remove: api.logoRemover },
  calendar: { getAll: api.calendario },
  notifications: {
    listLog: api.notifLog, listRules: api.notifRegras, listTemplates: api.notifModelos,
    createRule: api.notifCriarRegra, updateRule: api.notifUpdateRegra, removeRule: api.notifRemoverRegra,
  },
  getToken: () => 'tok', setToken: vi.fn(), clearToken: vi.fn(),
}));

import ClientDetail from '../../src/admin/pages/ClientDetail.jsx';

// ─── utilitários ─────────────────────────────────────────────────────────────
const ROTA = '/admin/clientes/:clientId';
const CAMINHO = '/admin/clientes/cli-1';

// Os valores em euros são compostos com espaço INSEPARÁVEL (e o Intl usa o seu
// próprio separador de milhares): normaliza-se tudo para espaço simples, senão a
// comparação falha com duas strings visualmente idênticas.
const norm = (s) => String(s ?? '').replace(/[  ]/g, ' ');
const dinheiro = (n, moeda = 'EUR') =>
  norm((moeda === 'BRL' ? 'R$' : '€') + ' ' + Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const textoDe = (el) => norm(el.textContent);

// getByText tolerante a frases partidas por <strong>/<em>/ícones: escolhe o
// elemento MAIS INTERIOR cujo texto casa (sem isto, cada antepassado também
// casaria e o getByText queixava-se de "found multiple elements").
const porTexto = (padrao) => (_c, el) => {
  if (!el || !padrao.test(norm(el.textContent))) return false;
  return ![...el.children].some((filho) => padrao.test(norm(filho.textContent)));
};

const hojeISO = () => new Date().toISOString().slice(0, 10);
const diasDaqui = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function adiar() {
  let resolver, rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

// ─── fixtures ────────────────────────────────────────────────────────────────
const CLIENTE_BASE = {
  id: 'cli-1',
  name: 'Maria Silva',
  country: 'PT',
  person_type: 'singular',
  plan_type: 'installment',
  email: 'maria@exemplo.pt',
  phone: '+351911222333',
  emails: null,
  phones: null,
  identification: '123456789',
  practice_area: 'Família',
  honorarios_total: 1200,
  honorarios_parcelas: 3,
  contract_start_date: '2026-01-10',
  first_attendance_date: '2025-12-01',
  created_at: '2025-12-01',
  status: 'active',
  notes: '',
  process_summary: '',
  nationality: 'portuguesa',
};

const cliente = (extra = {}) => ({ ...CLIENTE_BASE, ...extra });

const parcela = (n, extra = {}) => ({
  id: `cli-1-p${n}`,
  client_id: 'cli-1',
  installment_number: n,
  total_installments: 3,
  amount: 400,
  currency: 'EUR',
  due_date: `2026-0${n}-10`,
  status: 'pending',
  paid_date: null,
  ...extra,
});

const TRES_PARCELAS = [parcela(1), parcela(2), parcela(3)];

function resposta(extra = {}) {
  return { client: cliente(extra.client), installments: [], people: [], rules: [], ...extra };
}

// Monta a ficha e espera que o cabeçalho apareça (o loadData é assíncrono).
async function abrir(dados = {}, aba = null) {
  api.clienteGet.mockResolvedValue(resposta(dados));
  const vista = renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
  await screen.findByRole('heading', { level: 1 });
  if (aba) await vista.utilizador.click(screen.getByRole('button', { name: aba }));
  return vista;
}

const irPara = (u, aba) => u.click(screen.getByRole('button', { name: aba }));
const botao = (nome) => screen.getByRole('button', { name: nome });
const talvezBotao = (nome) => screen.queryByRole('button', { name: nome });
const linhaDaParcela = (n) => screen.getByText(`${n}/3`).closest('tr');
// campos do modal "Editar plano": <div class="adm-field"><label>X</label><input/>
const caixaDoRotulo = (t) => screen.getByText(t, { selector: 'label' }).closest('.adm-field');
const campoDoRotulo = (t) => caixaDoRotulo(t).querySelector('input, select, textarea');

const PDF = (nome = 'recibo.pdf') => new File(['%PDF-1.4'], nome, { type: 'application/pdf' });
const inputFicheiro = () => document.querySelector('input[type="file"][accept="application/pdf"]');

// Anexa um PDF ao botão "Anexar X" da parcela (clique + seletor de ficheiro).
async function anexar(u, n, label, ficheiro = PDF()) {
  await u.click(within(linhaDaParcela(n)).getByRole('button', { name: `Anexar ${label}` }));
  fireEvent.change(inputFicheiro(), { target: { files: [ficheiro] } });
}

// Abre o modal "Editar cliente".
async function abrirEdicao(u) {
  await u.click(botao('Editar'));
  return screen.findByRole('heading', { name: 'Editar cliente' });
}

// Abre o modal "Editar plano de pagamento".
async function abrirPlano(u) {
  await u.click(botao('Editar plano'));
  return screen.findByRole('heading', { name: 'Editar plano de pagamento' });
}

let confirmar, alertar;

beforeAll(() => {
  Element.prototype.scrollIntoView = function () {};
});

beforeEach(() => {
  vi.clearAllMocks();
  // Os diálogos da Área Privada (admConfirm/admAlert) caem nos nativos quando o
  // DialogHost não está montado — é por aí que se lhes lê a mensagem.
  confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
  alertar = vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, {
    createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn(),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true, writable: true,
  });

  api.clienteGet.mockResolvedValue(resposta());
  api.clienteUpdate.mockResolvedValue({ ok: true });
  api.clienteRemove.mockResolvedValue({ ok: true });
  api.parcelaCriar.mockResolvedValue({ ok: true });
  api.parcelaUpdate.mockResolvedValue({ ok: true });
  api.parcelaRemover.mockResolvedValue({ ok: true });
  api.parcelaPagar.mockResolvedValue({ ok: true });
  api.docsParcelaInfo.mockResolvedValue({ docs: {} });
  api.docParcelaUpload.mockResolvedValue({ ok: true });
  api.docParcelaAbrir.mockResolvedValue(undefined);
  api.docParcelaRemover.mockResolvedValue({ ok: true });
  api.docParcelaEnviar.mockResolvedValue({ ok: true, sent_to: 'maria@exemplo.pt' });
  api.procModelos.mockResolvedValue({ templates: [] });
  api.procPreview.mockResolvedValue({ texto: '', campos_editaveis: [] });
  api.procGerar.mockResolvedValue(undefined);
  api.planoGerar.mockResolvedValue(undefined);
  api.planoEnviar.mockResolvedValue({ ok: true, sent_to: 'maria@exemplo.pt' });
  api.tokenCriar.mockResolvedValue({ token: 'tk-novo' });
  api.tokenListar.mockResolvedValue({ tokens: [] });
  api.tokenRevogar.mockResolvedValue({ ok: true });
  api.ficheirosListar.mockResolvedValue({ documents: [] });
  api.ficheiroRemover.mockResolvedValue({ ok: true });
  api.ficheiroAbrir.mockResolvedValue(undefined);
  api.logoUrl.mockResolvedValue(null);
  api.logoUpload.mockResolvedValue({ ok: true });
  api.logoRemover.mockResolvedValue({ ok: true });
  api.calendario.mockResolvedValue({ events: [] });
  api.notifLog.mockResolvedValue({ log: [] });
  api.notifRegras.mockResolvedValue({ rules: [] });
  api.notifModelos.mockResolvedValue({ templates: [] });
  api.notifCriarRegra.mockResolvedValue({ ok: true });
  api.notifUpdateRegra.mockResolvedValue({ ok: true });
  api.notifRemoverRegra.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// Carregamento, erro e cliente inexistente
// ═════════════════════════════════════════════════════════════════════════════
describe('Ficha do cliente — carregamento', () => {
  it('mostra o esqueleto enquanto carrega', () => {
    api.clienteGet.mockReturnValue(new Promise(() => {}));
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(document.querySelector('[aria-label="A carregar"]')).not.toBeNull();
  });

  it('pede à API o cliente do URL', async () => {
    await abrir();
    expect(api.clienteGet).toHaveBeenCalledWith('cli-1');
  });

  it('mostra o nome do cliente no cabeçalho', async () => {
    await abrir();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Silva');
  });

  it('o esqueleto desaparece quando os dados chegam', async () => {
    await abrir();
    expect(document.querySelector('[aria-label="A carregar"]')).toBeNull();
  });

  it('erro no carregamento aparece por escrito', async () => {
    api.clienteGet.mockRejectedValue(new Error('Ligação perdida'));
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByText('Ligação perdida')).toBeInTheDocument();
  });

  it('com erro não mostra o resto da ficha', async () => {
    api.clienteGet.mockRejectedValue(new Error('HTTP 500'));
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    await screen.findByText('HTTP 500');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('cliente inexistente diz que não foi encontrado', async () => {
    api.clienteGet.mockResolvedValue({ client: null });
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByText(/Cliente não encontrado/)).toBeInTheDocument();
  });

  it('cliente inexistente oferece a volta à lista', async () => {
    api.clienteGet.mockResolvedValue({ client: null });
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByRole('link', { name: 'Voltar à lista' })).toBeInTheDocument();
  });

  it('resposta vazia da API não rebenta o ecrã', async () => {
    api.clienteGet.mockResolvedValue({});
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByText(/Cliente não encontrado/)).toBeInTheDocument();
  });

  it('carrega o estado dos documentos de cada parcela', async () => {
    await abrir({ installments: TRES_PARCELAS });
    await waitFor(() => expect(api.docsParcelaInfo).toHaveBeenCalledTimes(3));
  });

  it('falha a ler os documentos de uma parcela não parte a ficha', async () => {
    api.docsParcelaInfo.mockRejectedValue(new Error('R2 em baixo'));
    await abrir({ installments: TRES_PARCELAS });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Silva');
  });

  it('há sempre um caminho de volta à lista', async () => {
    await abrir();
    expect(screen.getByRole('link', { name: /Voltar à lista/ })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cabeçalho — identidade e contactos
// ═════════════════════════════════════════════════════════════════════════════
describe('Ficha do cliente — cabeçalho', () => {
  it('mostra o telefone do cliente', async () => {
    await abrir();
    expect(screen.getByText(porTexto(/\+351911222333/))).toBeInTheDocument();
  });

  it('mostra o e-mail do cliente', async () => {
    await abrir();
    expect(screen.getByText(porTexto(/maria@exemplo\.pt/))).toBeInTheDocument();
  });

  it('mostra o NIF em Portugal', async () => {
    await abrir();
    expect(screen.getByText(porTexto(/^NIF 123456789$/))).toBeInTheDocument();
  });

  it('mostra CPF no Brasil', async () => {
    await abrir({ client: cliente({ country: 'BR' }) });
    expect(screen.getByText(porTexto(/^CPF 123456789$/))).toBeInTheDocument();
  });

  it('empresa portuguesa mostra NIPC', async () => {
    await abrir({ client: cliente({ person_type: 'coletiva' }) });
    expect(screen.getByText(porTexto(/^NIPC 123456789$/))).toBeInTheDocument();
  });

  it('empresa brasileira mostra CNPJ', async () => {
    await abrir({ client: cliente({ person_type: 'coletiva', country: 'BR' }) });
    expect(screen.getByText(porTexto(/^CNPJ 123456789$/))).toBeInTheDocument();
  });

  it('sem identificação não inventa etiqueta', async () => {
    await abrir({ client: cliente({ identification: null }) });
    expect(screen.queryByText(porTexto(/^NIF/))).not.toBeInTheDocument();
  });

  it('mostra vários e-mails com a etiqueta de cada um', async () => {
    await abrir({ client: cliente({ emails: JSON.stringify([{ label: 'Pessoal', value: 'a@x.pt' }, { label: 'Empresa', value: 'b@x.pt' }]) }) });
    expect(screen.getByText(porTexto(/b@x\.pt \(Empresa\)/))).toBeInTheDocument();
  });

  it('a etiqueta "Pessoal" não é repetida ao lado do contacto', async () => {
    await abrir({ client: cliente({ emails: JSON.stringify([{ label: 'Pessoal', value: 'a@x.pt' }]) }) });
    expect(screen.getByText(porTexto(/^\s*a@x\.pt\s*$/))).toBeInTheDocument();
  });

  it('sem contactos nenhum o cabeçalho não mostra linhas vazias', async () => {
    await abrir({ client: cliente({ email: null, phone: null, emails: null, phones: null }) });
    expect(screen.queryByText(porTexto(/@/))).not.toBeInTheDocument();
  });

  it('mostra a área de atuação e o país', async () => {
    await abrir();
    expect(screen.getByText(porTexto(/^Família · PT$/))).toBeInTheDocument();
  });

  it('sem área de atuação mostra um travessão', async () => {
    await abrir({ client: cliente({ practice_area: null }) });
    expect(screen.getByText(porTexto(/^— · PT$/))).toBeInTheDocument();
  });

  it('pessoa coletiva anuncia-se como tal', async () => {
    await abrir({ client: cliente({ person_type: 'coletiva' }) });
    expect(screen.getByText(porTexto(/Pessoa coletiva/))).toBeInTheDocument();
  });

  it('pessoa coletiva mostra o responsável e o cargo', async () => {
    await abrir({ client: cliente({ person_type: 'coletiva', rep_name: 'António Costa', rep_role: 'Sócio-gerente' }) });
    expect(screen.getByText(porTexto(/Rep\.: António Costa \(Sócio-gerente\)/))).toBeInTheDocument();
  });

  it('DUNS só aparece em pessoa coletiva', async () => {
    await abrir({ client: cliente({ duns: '123456' }) });
    expect(screen.queryByText(porTexto(/DUNS/))).not.toBeInTheDocument();
  });

  it('DUNS aparece na empresa que o tem', async () => {
    await abrir({ client: cliente({ person_type: 'coletiva', duns: '123456' }) });
    expect(screen.getByText(porTexto(/DUNS 123456/))).toBeInTheDocument();
  });

  it('cliente sem nome não rebenta o cabeçalho', async () => {
    await abrir({ client: cliente({ name: null }) });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('as iniciais do nome preenchem o avatar', async () => {
    await abrir();
    expect(document.querySelector('.adm-client-avatar').textContent).toBe('MS');
  });

  it('cliente sem nome mostra um C no avatar', async () => {
    await abrir({ client: cliente({ name: '' }) });
    expect(document.querySelector('.adm-client-avatar').textContent).toBe('C');
  });

  it('sem logo não vai buscar a imagem', async () => {
    await abrir();
    expect(api.logoUrl).not.toHaveBeenCalled();
  });

  it('com logo vai buscá-la ao servidor', async () => {
    await abrir({ client: cliente({ logo_key: 'logos/cli-1.png' }) });
    await waitFor(() => expect(api.logoUrl).toHaveBeenCalledWith('cli-1'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cliente conjunto (várias pessoas)
// ═════════════════════════════════════════════════════════════════════════════
describe('Ficha do cliente — cliente conjunto', () => {
  const DUAS = { people: [{ id: 'cli-1-pes2', name: 'João Silva', identification: '987654321' }] };

  it('anuncia o cliente conjunto no cabeçalho', async () => {
    await abrir(DUAS);
    expect(screen.getByText(porTexto(/Cliente conjunto · com João Silva/))).toBeInTheDocument();
  });

  it('junta os nomes de várias pessoas com "e"', async () => {
    await abrir({ people: [{ id: 'p2', name: 'João' }, { id: 'p3', name: 'Ana' }] });
    expect(screen.getByText(porTexto(/com João e Ana/))).toBeInTheDocument();
  });

  it('cliente de uma só pessoa não fala em cliente conjunto', async () => {
    await abrir();
    expect(screen.queryByText(porTexto(/Cliente conjunto/))).not.toBeInTheDocument();
  });

  it('o seletor de titulares do plano só aparece com duas pessoas', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(screen.queryByText('Titulares no PDF do plano')).not.toBeInTheDocument();
  });

  it('com duas pessoas há seletor de titulares do plano', async () => {
    await abrir({ ...DUAS, installments: TRES_PARCELAS });
    expect(screen.getByText('Titulares no PDF do plano')).toBeInTheDocument();
  });

  it('o titular é a primeira pessoa da lista', async () => {
    await abrir({ ...DUAS, installments: TRES_PARCELAS });
    expect(screen.getByText(porTexto(/^Titular · 123456789$/))).toBeInTheDocument();
  });

  it('a segunda pessoa é identificada como 2.ª pessoa', async () => {
    await abrir({ ...DUAS, installments: TRES_PARCELAS });
    expect(screen.getByText(porTexto(/2\.ª pessoa · 987654321/))).toBeInTheDocument();
  });

  it('todos os titulares começam assinalados', async () => {
    await abrir({ ...DUAS, installments: TRES_PARCELAS });
    for (const c of screen.getAllByRole('checkbox')) expect(c).toBeChecked();
  });

  it('desmarcar um titular tira-o do PDF gerado', async () => {
    const { utilizador } = await abrir({ ...DUAS, installments: TRES_PARCELAS });
    await utilizador.click(screen.getAllByRole('checkbox')[1]);
    await utilizador.click(botao('Gerar PDF'));
    await waitFor(() => expect(api.planoGerar).toHaveBeenCalledWith('cli-1', { people_ids: ['cli-1'] }));
  });

  it('nunca deixa ficar zero titulares assinalados', async () => {
    const { utilizador } = await abrir({ ...DUAS, installments: TRES_PARCELAS });
    await utilizador.click(screen.getAllByRole('checkbox')[1]);
    await utilizador.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  });

  it('o resumo menciona a pessoa em conjunto', async () => {
    await abrir(DUAS, 'Resumo');
    expect(screen.getByText('João Silva')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Separadores
// ═════════════════════════════════════════════════════════════════════════════
describe('Ficha do cliente — separadores', () => {
  const ABAS = ['Plano de pagamento', 'Resumo', 'Comunicações', 'Notificações', 'Documentos', 'Procurações', 'Notas'];

  it('tem os sete separadores', async () => {
    await abrir();
    for (const t of ABAS) expect(botao(t)).toBeInTheDocument();
  });

  it('abre no plano de pagamento', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(botao('Plano de pagamento')).toHaveAttribute('data-tab-active', '1');
  });

  it('o separador escolhido fica marcado', async () => {
    const { utilizador } = await abrir();
    await irPara(utilizador, 'Notas');
    expect(botao('Notas')).toHaveAttribute('data-tab-active', '1');
  });

  it('mudar de separador troca o conteúdo', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await irPara(utilizador, 'Notas');
    expect(screen.queryByRole('button', { name: 'Editar plano' })).not.toBeInTheDocument();
  });

  it('os separadores não submetem formulários', async () => {
    await abrir();
    for (const t of ABAS) expect(botao(t)).toHaveAttribute('type', 'button');
  });

  it('voltar ao plano traz a tabela de volta', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await irPara(utilizador, 'Notas');
    await irPara(utilizador, 'Plano de pagamento');
    expect(screen.getByRole('button', { name: 'Editar plano' })).toBeInTheDocument();
  });

  it('o cabeçalho do cliente fica visível em todos os separadores', async () => {
    const { utilizador } = await abrir();
    for (const t of ABAS) {
      await irPara(utilizador, t);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Silva');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plano — resumo (KPIs)
// ═════════════════════════════════════════════════════════════════════════════
describe('Plano de honorários — resumo', () => {
  it('parcelado mostra o total contratado', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(screen.getByText('Total contratado')).toBeInTheDocument();
    expect(textoDe(screen.getByText('Total contratado').closest('.adm-plan-item'))).toContain(dinheiro(1200));
  });

  it('soma o que já foi recebido', async () => {
    await abrir({ installments: [parcela(1, { status: 'paid', paid_date: '2026-01-10' }), parcela(2), parcela(3)] });
    const item = screen.getByText('Já recebido').closest('.adm-plan-item');
    expect(textoDe(item)).toContain(dinheiro(400));
  });

  it('soma o que está em aberto', async () => {
    await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    const item = screen.getByText('Em aberto').closest('.adm-plan-item');
    expect(textoDe(item)).toContain(dinheiro(800));
  });

  it('mostra o progresso em parcelas pagas', async () => {
    await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
  });

  it('sem nada pago o recebido é zero', async () => {
    await abrir({ installments: TRES_PARCELAS });
    const item = screen.getByText('Já recebido').closest('.adm-plan-item');
    expect(textoDe(item)).toContain(dinheiro(0));
  });

  it('avença mensal mostra o valor mensal em vez do total', async () => {
    await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0, honorarios_parcelas: 0 }), installments: [parcela(1, { amount: 450, total_installments: 12 })] });
    expect(screen.getByText('Avença mensal')).toBeInTheDocument();
  });

  it('avença mensal mostra a data de início', async () => {
    await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0 }), installments: [parcela(1, { amount: 450 })] });
    expect(textoDe(screen.getByText('Início da avença').closest('.adm-plan-item'))).toContain('10/01/2026');
  });

  it('avença mensal conta o tempo ativo', async () => {
    await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0 }), installments: [parcela(1, { amount: 450 })] });
    expect(screen.getByText(porTexto(/meses ativo/))).toBeInTheDocument();
  });

  it('cliente sem honorários é tratado como avença', async () => {
    await abrir({ client: cliente({ plan_type: null, honorarios_total: 0 }), installments: [parcela(1)] });
    expect(screen.getByText('Avença mensal')).toBeInTheDocument();
  });

  it('pro bono anuncia-se com destaque', async () => {
    await abrir({ client: cliente({ plan_type: 'probono' }) });
    expect(textoDe(screen.getByText('Honorários').closest('.adm-plan-item'))).toContain('Pro bono');
  });

  it('pro bono explica que não há componente financeira', async () => {
    await abrir({ client: cliente({ plan_type: 'probono' }) });
    expect(screen.getByText(porTexto(/gratuito e voluntário, sem componente financeira/))).toBeInTheDocument();
  });

  it('pro bono não mostra o botão de editar plano', async () => {
    await abrir({ client: cliente({ plan_type: 'probono' }) });
    expect(talvezBotao('Editar plano')).toBeNull();
  });

  it('pro bono não oferece registar pagamento', async () => {
    await abrir({ client: cliente({ plan_type: 'probono' }) });
    expect(talvezBotao('+ Pagamento')).toBeNull();
  });

  it('oficioso avisa que aguarda trânsito em julgado', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }) });
    expect(screen.getByText(porTexto(/aguarda trânsito em julgado/i))).toBeInTheDocument();
  });

  it('oficioso com recebimentos muda o texto', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }), installments: [parcela(1, { status: 'paid' })] });
    expect(screen.getByText(porTexto(/Recebimentos registados como pagamentos avulsos/))).toBeInTheDocument();
  });

  it('oficioso continua a permitir registar pagamentos', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }) });
    expect(botao('+ Pagamento')).toBeInTheDocument();
  });

  it('oficioso sem parcelas não mostra tabela nenhuma', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }) });
    expect(document.querySelector('.adm-table')).toBeNull();
  });

  it('oficioso com um recebimento já mostra a tabela', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }), installments: [parcela(1, { status: 'paid' })] });
    expect(document.querySelector('.adm-table')).not.toBeNull();
  });

  it('cliente do Brasil mostra os valores em reais', async () => {
    await abrir({ client: cliente({ country: 'BR' }), installments: [parcela(1, { currency: 'BRL' })] });
    const item = screen.getByText('Total contratado').closest('.adm-plan-item');
    expect(textoDe(item)).toContain('R$');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plano — tabela de parcelas
// ═════════════════════════════════════════════════════════════════════════════
describe('Plano de honorários — tabela de parcelas', () => {
  it('mostra uma linha por parcela', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(document.querySelectorAll('.adm-table tbody tr')).toHaveLength(3);
  });

  it('numera as parcelas com o total', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('mostra a data de vencimento em formato português', async () => {
    await abrir({ installments: [parcela(1, { due_date: '2026-03-25' })] });
    expect(screen.getByText('25/03/2026')).toBeInTheDocument();
  });

  it('mostra o valor de cada parcela', async () => {
    await abrir({ installments: [parcela(1, { amount: 400 })] });
    expect(textoDe(linhaDaParcela(1))).toContain(dinheiro(400));
  });

  it('parcela por pagar não tem data de pagamento', async () => {
    await abrir({ installments: [parcela(1)] });
    expect(textoDe(linhaDaParcela(1))).toContain('—');
  });

  it('parcela paga mostra a data em que foi paga', async () => {
    await abrir({ installments: [parcela(1, { status: 'paid', paid_date: '2026-01-11' })] });
    expect(screen.getByText('11/01/2026')).toBeInTheDocument();
  });

  it('parcela pendente traz a etiqueta Pendente', async () => {
    await abrir({ installments: [parcela(1, { due_date: diasDaqui(20) })] });
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('parcela paga traz a etiqueta Pago', async () => {
    await abrir({ installments: [parcela(1, { status: 'paid' })] });
    expect(screen.getByText('Pago')).toBeInTheDocument();
  });

  it('parcela que vence hoje é assinalada', async () => {
    await abrir({ installments: [parcela(1, { status: 'due_today', due_date: hojeISO() })] });
    expect(screen.getByText('Hoje')).toBeInTheDocument();
  });

  it('parcela que vence amanhã é assinalada', async () => {
    await abrir({ installments: [parcela(1, { due_date: diasDaqui(1) })] });
    expect(screen.getByText('Amanhã')).toBeInTheDocument();
  });

  it('parcela em atraso mostra os dias de atraso', async () => {
    await abrir({ installments: [parcela(1, { status: 'late', due_date: diasDaqui(-5) })] });
    expect(screen.getByText('5d atraso')).toBeInTheDocument();
  });

  it('as parcelas aparecem por ordem de vencimento', async () => {
    await abrir({ installments: [parcela(3, { due_date: '2026-03-10' }), parcela(1, { due_date: '2026-01-10' }), parcela(2, { due_date: '2026-02-10' })] });
    const nums = [...document.querySelectorAll('.adm-table tbody tr td:first-child')].map((td) => td.textContent);
    expect(nums).toEqual(['1/3', '2/3', '3/3']);
  });

  it('sem parcelas a tabela fica sem linhas', async () => {
    await abrir({ installments: [] });
    expect(document.querySelectorAll('.adm-table tbody tr')).toHaveLength(0);
  });

  it('lista de parcelas em falta na resposta não rebenta', async () => {
    api.clienteGet.mockResolvedValue({ client: cliente(), installments: null });
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('valor como texto vindo da API continua a ser formatado', async () => {
    await abrir({ installments: [parcela(1, { amount: '400.50' })] });
    expect(textoDe(linhaDaParcela(1))).toContain(dinheiro(400.5));
  });

  it('parcela sem valor mostra zero em vez de NaN', async () => {
    await abrir({ installments: [parcela(1, { amount: null })] });
    expect(textoDe(linhaDaParcela(1))).not.toContain('NaN');
  });

  it('parcela em reais mostra o símbolo do real', async () => {
    await abrir({ client: cliente({ country: 'BR' }), installments: [parcela(1, { currency: 'BRL' })] });
    expect(textoDe(linhaDaParcela(1))).toContain('R$');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plano — marcar e desmarcar parcelas como pagas
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — marcar e desmarcar como paga', () => {
  const UMA_PAGA = { installments: [parcela(1, { status: 'paid', paid_date: '2026-01-11' }), parcela(2), parcela(3)] };

  it('a etiqueta Pago é clicável para desmarcar', async () => {
    await abrir(UMA_PAGA);
    expect(screen.getByText('Pago')).toHaveAttribute('role', 'button');
  });

  it('desmarcar pede confirmação', async () => {
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Desmarcar a parcela 1/3'));
  });

  it('a confirmação avisa que os documentos se mantêm', async () => {
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    expect(confirmar.mock.calls[0][0]).toContain('os documentos anexados mantêm-se');
  });

  it('desmarcar põe a parcela de novo pendente', async () => {
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    await waitFor(() => expect(api.parcelaUpdate).toHaveBeenCalledWith('cli-1-p1', { status: 'pending', paid_date: null }));
  });

  it('desmarcar recarrega a ficha', async () => {
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    await waitFor(() => expect(api.clienteGet).toHaveBeenCalledTimes(2));
  });

  it('recusar a confirmação não mexe na parcela', async () => {
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    expect(api.parcelaUpdate).not.toHaveBeenCalled();
  });

  it('a tecla Enter também desmarca', async () => {
    await abrir(UMA_PAGA);
    fireEvent.keyDown(screen.getByText('Pago'), { key: 'Enter' });
    await waitFor(() => expect(api.parcelaUpdate).toHaveBeenCalled());
  });

  it('erro ao desmarcar é mostrado à utilizadora', async () => {
    api.parcelaUpdate.mockRejectedValue(new Error('parcela bloqueada'));
    const { utilizador } = await abrir(UMA_PAGA);
    await utilizador.click(screen.getByText('Pago'));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('parcela bloqueada')));
  });

  // CORRIGIDO (era): ClientDetail.jsx:524 — handleMarkPaid existe mas NENHUM botão o chama
  // (a coluna de ações só tem Anexar/Ver/Remover documentos). A única forma de
  // marcar uma parcela como paga é anexar-lhe um PDF de Recibo ou Fatura-Recibo:
  // quem recebeu por transferência e ainda não emitiu o recibo não consegue
  // registar o pagamento nesta tabela.
  it('devia haver um botão para marcar a parcela como paga', async () => {
    await abrir({ installments: TRES_PARCELAS });
    expect(within(linhaDaParcela(2)).getByRole('button', { name: /marcar/i })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Parcelas — recibos, faturas e fatura-recibos
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — documentos anexados', () => {
  const comDoc = (tipo, extra = {}) => {
    api.docsParcelaInfo.mockImplementation(async (id) => ({
      docs: id === 'cli-1-p1' ? { [tipo]: { exists: true, filename: 'x.pdf', ...extra } } : {},
    }));
  };

  it('oferece anexar os três tipos de documento', async () => {
    await abrir({ installments: [parcela(1)] });
    for (const l of ['Fatura', 'Recibo', 'Fatura-Recibo']) {
      expect(within(linhaDaParcela(1)).getByRole('button', { name: `Anexar ${l}` })).toBeInTheDocument();
    }
  });

  it('documento já anexado passa a botão de ver', async () => {
    comDoc('recibo');
    await abrir({ installments: [parcela(1)] });
    expect(await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ })).toBeInTheDocument();
  });

  it('documento anexado deixa de oferecer anexar do mesmo tipo', async () => {
    comDoc('recibo');
    await abrir({ installments: [parcela(1)] });
    await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ });
    expect(within(linhaDaParcela(1)).queryByRole('button', { name: 'Anexar Recibo' })).toBeNull();
  });

  it('os outros tipos continuam por anexar', async () => {
    comDoc('recibo');
    await abrir({ installments: [parcela(1)] });
    await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ });
    expect(within(linhaDaParcela(1)).getByRole('button', { name: 'Anexar Fatura' })).toBeInTheDocument();
  });

  it('o botão de ver mostra a data em que foi anexado', async () => {
    comDoc('recibo', { uploaded_at: '2026-03-12T14:20:00' });
    await abrir({ installments: [parcela(1)] });
    expect(await within(linhaDaParcela(1)).findByText(/12\/03 - 14:20/)).toBeInTheDocument();
  });

  it('ver abre o documento noutro separador', async () => {
    comDoc('recibo');
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ }));
    expect(api.docParcelaAbrir).toHaveBeenCalledWith('cli-1-p1', 'recibo');
  });

  it('falha a abrir o documento é explicada', async () => {
    comDoc('recibo');
    api.docParcelaAbrir.mockRejectedValue(new Error('ficheiro apagado'));
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ }));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('ficheiro apagado')));
  });

  it('anexar um PDF envia-o para a parcela certa', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Recibo');
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalledWith('cli-1-p1', expect.any(File), 'recibo'));
  });

  it('anexar fatura usa o tipo fatura', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Fatura');
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalledWith('cli-1-p1', expect.any(File), 'fatura'));
  });

  it('anexar fatura-recibo usa o tipo fatura-recibo', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Fatura-Recibo');
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalledWith('cli-1-p1', expect.any(File), 'fatura-recibo'));
  });

  it('anexar recibo marca a parcela como paga', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Recibo');
    await waitFor(() => expect(api.parcelaPagar).toHaveBeenCalledWith('cli-1-p1', hojeISO()));
  });

  it('anexar fatura NÃO marca a parcela como paga', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Fatura');
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalled());
    expect(api.parcelaPagar).not.toHaveBeenCalled();
  });

  it('anexar recibo a uma parcela já paga não a marca outra vez', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' })] });
    await anexar(utilizador, 1, 'Recibo');
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalled());
    expect(api.parcelaPagar).not.toHaveBeenCalled();
  });

  it('ficheiro que não é PDF é recusado', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Recibo', new File(['x'], 'foto.png', { type: 'image/png' }));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('PDF')));
  });

  it('ficheiro que não é PDF não chega a subir', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Recibo', new File(['x'], 'foto.png', { type: 'image/png' }));
    await waitFor(() => expect(alertar).toHaveBeenCalled());
    expect(api.docParcelaUpload).not.toHaveBeenCalled();
  });

  it('erro no upload é explicado à utilizadora', async () => {
    api.docParcelaUpload.mockRejectedValue(new Error('ficheiro demasiado grande'));
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await anexar(utilizador, 1, 'Recibo');
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('ficheiro demasiado grande')));
  });

  it('arrastar um PDF para o botão anexa-o', async () => {
    await abrir({ installments: [parcela(1)] });
    fireEvent.drop(within(linhaDaParcela(1)).getByRole('button', { name: 'Anexar Recibo' }), { dataTransfer: { files: [PDF()] } });
    await waitFor(() => expect(api.docParcelaUpload).toHaveBeenCalledWith('cli-1-p1', expect.any(File), 'recibo'));
  });

  it('remover um documento pede confirmação', async () => {
    comDoc('recibo');
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Remover o documento "Recibo"'));
  });

  it('remover apaga o documento no servidor', async () => {
    comDoc('recibo');
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    await waitFor(() => expect(api.docParcelaRemover).toHaveBeenCalledWith('cli-1-p1', 'recibo'));
  });

  it('recusar a confirmação não remove nada', async () => {
    comDoc('recibo');
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    expect(api.docParcelaRemover).not.toHaveBeenCalled();
  });

  it('remover o único comprovativo devolve a parcela a pendente', async () => {
    api.docsParcelaInfo.mockResolvedValueOnce({ docs: { recibo: { exists: true } } }).mockResolvedValue({ docs: {} });
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' })] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    await waitFor(() => expect(api.parcelaUpdate).toHaveBeenCalledWith('cli-1-p1', { status: 'pending', paid_date: null }));
  });

  it('remover a fatura não mexe no estado da parcela', async () => {
    api.docsParcelaInfo.mockResolvedValueOnce({ docs: { fatura: { exists: true }, recibo: { exists: true } } }).mockResolvedValue({ docs: { recibo: { exists: true } } });
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' })] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Fatura' }));
    await waitFor(() => expect(api.docParcelaRemover).toHaveBeenCalled());
    expect(api.parcelaUpdate).not.toHaveBeenCalled();
  });

  it('sobrando um comprovativo a parcela mantém-se paga', async () => {
    api.docsParcelaInfo
      .mockResolvedValueOnce({ docs: { recibo: { exists: true }, 'fatura-recibo': { exists: true } } })
      .mockResolvedValue({ docs: { 'fatura-recibo': { exists: true } } });
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' })] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    await waitFor(() => expect(api.docParcelaRemover).toHaveBeenCalled());
    expect(api.parcelaUpdate).not.toHaveBeenCalled();
  });

  it('erro ao remover é explicado', async () => {
    comDoc('recibo');
    api.docParcelaRemover.mockRejectedValue(new Error('sem permissões'));
    const { utilizador } = await abrir({ installments: [parcela(1)] });
    await utilizador.click(await within(linhaDaParcela(1)).findByRole('button', { name: 'Remover Recibo' }));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('sem permissões')));
  });

  it('parcela sem documentos nenhuns só mostra os botões de anexar', async () => {
    await abrir({ installments: [parcela(1)] });
    expect(within(linhaDaParcela(1)).queryByRole('button', { name: /^Ver / })).toBeNull();
  });

  // CORRIGIDO (era): ClientDetail.jsx:629 — handleSendRecibo (recibosApi.sendToClient) não
  // tem botão nenhum na ficha. Com o Recibo Verde anexado, não há forma de o
  // enviar ao cliente a partir deste ecrã, apesar de a API existir e de o
  // apiClient a expor (apiClient.js:288).
  it('devia dar para enviar o recibo anexado ao cliente', async () => {
    comDoc('recibo');
    await abrir({ installments: [parcela(1)] });
    await within(linhaDaParcela(1)).findByRole('button', { name: /^Ver Recibo/ });
    expect(within(linhaDaParcela(1)).getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plano — PDF e envio ao cliente
// ═════════════════════════════════════════════════════════════════════════════
describe('Plano de honorários — PDF e envio', () => {
  it('gera o PDF do plano do cliente', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Gerar PDF'));
    expect(api.planoGerar).toHaveBeenCalledWith('cli-1', { people_ids: ['cli-1'] });
  });

  it('enquanto gera, o botão avisa', async () => {
    const { promessa, resolver } = adiar();
    api.planoGerar.mockReturnValue(promessa);
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Gerar PDF'));
    expect(await screen.findByRole('button', { name: 'A gerar…' })).toBeDisabled();
    resolver();
  });

  it('falha a gerar o PDF aparece ao lado dos botões', async () => {
    api.planoGerar.mockRejectedValue(new Error('modelo em falta'));
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Gerar PDF'));
    expect(await screen.findByText('modelo em falta')).toBeInTheDocument();
  });

  it('sem parcelas não deixa gerar o PDF', async () => {
    await abrir({ installments: [] });
    expect(botao('Gerar PDF')).toBeDisabled();
  });

  it('sem parcelas não deixa enviar o plano', async () => {
    await abrir({ installments: [] });
    expect(botao('Enviar ao cliente')).toBeDisabled();
  });

  it('enviar o plano pede confirmação com o e-mail', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('maria@exemplo.pt'));
  });

  it('confirmado, envia o plano', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    await waitFor(() => expect(api.planoEnviar).toHaveBeenCalledWith('cli-1', { people_ids: ['cli-1'] }));
  });

  it('recusar a confirmação não envia nada', async () => {
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(api.planoEnviar).not.toHaveBeenCalled();
  });

  it('envio bem sucedido diz para onde foi', async () => {
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(await screen.findByText('Plano enviado para maria@exemplo.pt.')).toBeInTheDocument();
  });

  it('envio por configurar é explicado', async () => {
    api.planoEnviar.mockResolvedValue({ skipped: true, reason: 'falta a chave Resend' });
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(await screen.findByText('Envio não configurado: falta a chave Resend')).toBeInTheDocument();
  });

  it('erro no envio aparece por escrito', async () => {
    api.planoEnviar.mockRejectedValue(new Error('caixa cheia'));
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(await screen.findByText('caixa cheia')).toBeInTheDocument();
  });

  it('cliente sem e-mail é avisado antes de tentar enviar', async () => {
    const { utilizador } = await abrir({ client: cliente({ email: null, emails: null }), installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(await screen.findByText(/Cliente sem email registado/)).toBeInTheDocument();
  });

  it('cliente sem e-mail não chega a chamar a API', async () => {
    const { utilizador } = await abrir({ client: cliente({ email: null }), installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    await waitFor(() => expect(screen.getByText(/Cliente sem email registado/)).toBeInTheDocument());
    expect(api.planoEnviar).not.toHaveBeenCalled();
  });

  it('enquanto envia, o botão avisa', async () => {
    const { promessa, resolver } = adiar();
    api.planoEnviar.mockReturnValue(promessa);
    const { utilizador } = await abrir({ installments: TRES_PARCELAS });
    await utilizador.click(botao('Enviar ao cliente'));
    expect(await screen.findByRole('button', { name: 'A enviar…' })).toBeDisabled();
    resolver({ sent_to: 'x' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Plano — modal de edição
// ═════════════════════════════════════════════════════════════════════════════
describe('Editar plano de pagamento', () => {
  const PLANO = { installments: TRES_PARCELAS };

  it('abre o modal de edição do plano', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(screen.getByRole('heading', { name: 'Editar plano de pagamento' })).toBeInTheDocument();
  });

  it('traz o tipo de plano do cliente', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(campoDoRotulo('Tipo de plano')).toHaveValue('installment');
  });

  it('cliente em avença abre como avença', async () => {
    const { utilizador } = await abrir({ client: cliente({ honorarios_total: 0, plan_type: 'monthly' }), installments: [parcela(1)] });
    await abrirPlano(utilizador);
    expect(campoDoRotulo('Tipo de plano')).toHaveValue('monthly');
  });

  it('traz o total contratado', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(campoDoRotulo('Valor total contratado')).toHaveValue('1200');
  });

  it('traz o número de parcelas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(campoDoRotulo('Número de parcelas')).toHaveValue(3);
  });

  it('traz a data de vencimento', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(textoDe(caixaDoRotulo('Data de Vencimento'))).toContain('10/01/2026');
  });

  it('mostra a lista de valores das parcelas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(screen.getByText('Valores das parcelas')).toBeInTheDocument();
  });

  it('gera três linhas para três parcelas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(screen.getByText(porTexto(/^Parcela 3$/))).toBeInTheDocument();
  });

  it('a soma das parcelas fecha com o total', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    expect(norm(document.querySelector('.adm-overlay').textContent)).toContain('✓');
  });

  it('mexer no total sem acertar as parcelas mostra a diferença', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.type(campoDoRotulo('Valor total contratado'), '1500');
    expect(norm(document.querySelector('.adm-overlay').textContent)).toContain('faltam');
  });

  it('acrescentar uma parcela cria uma linha nova', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Aumentar' }));
    expect(screen.getByText(porTexto(/^Parcela 4$/))).toBeInTheDocument();
  });

  it('tirar uma parcela apaga a última linha', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Diminuir' }));
    expect(screen.queryByText(porTexto(/^Parcela 3$/))).toBeNull();
  });

  it('o ✕ elimina uma parcela e reajusta a contagem', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    const overlay = document.querySelector('.adm-overlay');
    await utilizador.click(within(overlay).getAllByRole('button', { name: '✕' })[0]);
    expect(campoDoRotulo('Número de parcelas')).toHaveValue(2);
  });

  it('mudar para avença mensal troca os campos', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    expect(screen.getByText('Valor mensal')).toBeInTheDocument();
  });

  it('avença mensal esconde a lista de parcelas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    expect(screen.queryByText('Valores das parcelas')).toBeNull();
  });

  it('voltar a parcelado traz a lista de volta', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'installment');
    expect(screen.getByText('Valores das parcelas')).toBeInTheDocument();
  });

  it('sem data de vencimento recusa guardar', async () => {
    const { utilizador } = await abrir({ client: cliente({ contract_start_date: null }), installments: TRES_PARCELAS });
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(alertar).toHaveBeenCalledWith(expect.stringContaining('Data de Vencimento'));
  });

  it('parcelado sem total recusa guardar', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(alertar).toHaveBeenCalledWith(expect.stringContaining('valor total contratado'));
  });

  it('avença sem valor mensal recusa guardar', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(alertar).toHaveBeenCalledWith(expect.stringContaining('valor mensal'));
  });

  it('soma que não fecha com o total recusa guardar', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.type(campoDoRotulo('Valor total contratado'), '1500');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(alertar).toHaveBeenCalledWith(expect.stringContaining('não fecha com o total contratado'));
  });

  it('soma que não fecha não chega a mexer nas parcelas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.type(campoDoRotulo('Valor total contratado'), '1500');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(api.parcelaRemover).not.toHaveBeenCalled();
  });

  it('menos parcelas do que as já pagas é recusado', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2, { status: 'paid' }), parcela(3)] });
    await abrirPlano(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Diminuir' }));
    await utilizador.click(screen.getByRole('button', { name: 'Diminuir' }));
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(alertar).toHaveBeenCalledWith(expect.stringContaining('parcelas pagas'));
  });

  it('guardar avisa que as parcelas por pagar são substituídas', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('3 parcelas por pagar serão substituídas'));
  });

  it('recusar a confirmação não guarda nada', async () => {
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(api.clienteUpdate).not.toHaveBeenCalled();
  });

  it('guardar grava o total e o número de parcelas no cliente', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', {
      plan_type: 'installment',
      honorarios_total: 1200, honorarios_parcelas: 3, contract_start_date: '2026-01-10',
    }));
  });

  // CORRIGIDO (era): o handleSavePlan não enviava o plan_type, e como a leitura lhe
  // dá prioridade (ClientDetail.jsx:1101), um cliente que passasse de avença a
  // parcelado continuava a ser lido como avença — a ficha mostrava "Avença mensal".
  it('guardar grava também o tipo de plano', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(api.clienteUpdate.mock.calls.at(-1)[1]).toHaveProperty('plan_type', 'installment');
  });

  it('guardar apaga as parcelas por pagar', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.parcelaRemover).toHaveBeenCalledTimes(3));
  });

  it('guardar cria as parcelas novas com o valor certo', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalledTimes(3));
    expect(api.parcelaCriar.mock.calls[0][0]).toMatchObject({ client_id: 'cli-1', amount: 400, currency: 'EUR', installment_number: 1, total_installments: 3 });
  });

  it('as parcelas pagas são atualizadas em vez de apagadas', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.parcelaUpdate).toHaveBeenCalledWith('cli-1-p1', expect.objectContaining({ amount: 400 })));
    expect(api.parcelaRemover).not.toHaveBeenCalledWith('cli-1-p1');
  });

  it('a lista avisa quantas parcelas pagas inclui', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    await abrirPlano(utilizador);
    expect(screen.getByText(porTexto(/1 parcela\(s\) paga\(s\) incluídas na lista/))).toBeInTheDocument();
  });

  it('avença mensal cria doze mensalidades', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    await utilizador.type(campoDoRotulo('Valor mensal'), '450');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalledTimes(12));
  });

  it('avença mensal zera o total contratado', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'monthly');
    await utilizador.type(campoDoRotulo('Valor mensal'), '450');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ honorarios_total: 0, honorarios_parcelas: 0 })));
  });

  it('enquanto guarda, o botão desativa-se', async () => {
    const { promessa, resolver } = adiar();
    api.clienteUpdate.mockReturnValue(promessa);
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    expect(await screen.findByRole('button', { name: 'A guardar…' })).toBeDisabled();
    resolver({ ok: true });
  });

  it('erro a guardar o plano é explicado', async () => {
    api.clienteUpdate.mockRejectedValue(new Error('conflito de versões'));
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('conflito de versões')));
  });

  it('erro a guardar mantém o modal aberto', async () => {
    api.clienteUpdate.mockRejectedValue(new Error('rede'));
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(alertar).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Editar plano de pagamento' })).toBeInTheDocument();
  });

  it('guardar com sucesso fecha o modal', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Editar plano de pagamento' })).toBeNull());
  });

  it('guardar com sucesso recarrega a ficha', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteGet).toHaveBeenCalledTimes(2));
  });

  it('cancelar fecha o modal sem gravar', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.click(botao('Cancelar'));
    expect(screen.queryByRole('heading', { name: 'Editar plano de pagamento' })).toBeNull();
    expect(api.clienteUpdate).not.toHaveBeenCalled();
  });

  it('reabrir o modal repõe os valores do cliente', async () => {
    const { utilizador } = await abrir(PLANO);
    await abrirPlano(utilizador);
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.type(campoDoRotulo('Valor total contratado'), '9999');
    await utilizador.click(botao('Cancelar'));
    await abrirPlano(utilizador);
    expect(campoDoRotulo('Valor total contratado')).toHaveValue('1200');
  });

  it('desmarcar uma parcela paga dentro do editor pede confirmação', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    await abrirPlano(utilizador);
    await utilizador.click(screen.getByText(porTexto(/^Paga ✕$/)));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Desmarcar a Parcela 1'));
  });

  it('desmarcar dentro do editor põe a parcela pendente', async () => {
    const { utilizador } = await abrir({ installments: [parcela(1, { status: 'paid' }), parcela(2), parcela(3)] });
    await abrirPlano(utilizador);
    await utilizador.click(screen.getByText(porTexto(/^Paga ✕$/)));
    await waitFor(() => expect(api.parcelaUpdate).toHaveBeenCalledWith('cli-1-p1', { status: 'pending', paid_date: null }));
  });

  it('cliente sem parcelas nenhumas guarda sem pedir confirmação', async () => {
    const { utilizador } = await abrir({ installments: [] });
    await abrirPlano(utilizador);
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(confirmar).not.toHaveBeenCalled();
  });

  // CORRIGIDO (era): ClientDetail.jsx:757-761 — handleSavePlan grava honorarios_total,
  // honorarios_parcelas e contract_start_date mas nunca plan_type. Um cliente
  // com plan_type 'monthly' que passe a parcelado continua a ser lido como
  // avença (ClientDetail.jsx:1101-1103 dá prioridade ao plan_type gravado) e a
  // ficha volta a mostrar "Avença mensal" e "meses ativo" em vez do total
  // contratado e do progresso das parcelas.
  it('mudar de avença para parcelado grava o novo tipo de plano', async () => {
    const { utilizador } = await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0 }), installments: [parcela(1)] });
    await abrirPlano(utilizador);
    await utilizador.selectOptions(campoDoRotulo('Tipo de plano'), 'installment');
    await utilizador.clear(campoDoRotulo('Valor total contratado'));
    await utilizador.type(campoDoRotulo('Valor total contratado'), '900');
    // o número de parcelas tem de estar preenchido para o plano poder ser gravado
    const nParcelas = campoDoRotulo('Número de parcelas');
    await utilizador.clear(nParcelas);
    await utilizador.type(nParcelas, '3');
    await utilizador.click(botao('Guardar e gerar parcelas'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(api.clienteUpdate.mock.calls.at(-1)[1]).toMatchObject({ plan_type: 'installment' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Pagamento avulso
// ═════════════════════════════════════════════════════════════════════════════
describe('Pagamento avulso', () => {
  const abrirAvulso = async (u) => {
    await u.click(botao('+ Pagamento'));
    return screen.findByRole('heading', { name: 'Pagamento avulso' });
  };

  it('abre o modal do pagamento avulso', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    expect(screen.getByRole('heading', { name: 'Pagamento avulso' })).toBeInTheDocument();
  });

  it('a data começa em hoje', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    expect(screen.getByLabelText('Data *')).toHaveValue(hojeISO());
  });

  it('começa marcado como já pago', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    expect(screen.getByLabelText('Já foi pago')).toBeChecked();
  });

  it('cliente português usa euros', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    expect(screen.getByLabelText('Moeda')).toHaveValue('EUR');
  });

  it('cliente brasileiro usa reais', async () => {
    const { utilizador } = await abrir({ client: cliente({ country: 'BR' }) });
    await abrirAvulso(utilizador);
    expect(screen.getByLabelText('Moeda')).toHaveValue('BRL');
  });

  it('sem valor recusa gravar', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.click(botao('Registar pagamento'));
    expect(await screen.findByText('Indique um valor válido.')).toBeInTheDocument();
  });

  it('valor zero recusa gravar', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '0');
    await utilizador.click(botao('Registar pagamento'));
    expect(await screen.findByText('Indique um valor válido.')).toBeInTheDocument();
  });

  it('valor inválido não chega à API', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.click(botao('Registar pagamento'));
    await screen.findByText('Indique um valor válido.');
    expect(api.parcelaCriar).not.toHaveBeenCalled();
  });

  it('aceita vírgula decimal', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '150,50');
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalledWith(expect.objectContaining({ amount: 150.5 })));
  });

  it('cria o registo como 1/1 fora do plano', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'cli-1', installment_number: 1, total_installments: 1, notes: 'Pagamento avulso',
    })));
  });

  it('a descrição escrita entra nas notas', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.type(screen.getByLabelText('Descrição (opcional)'), 'consulta de 11/07');
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Avulso: consulta de 11/07' })));
  });

  it('marcado como pago, é logo dado como pago', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(api.parcelaPagar).toHaveBeenCalled());
  });

  it('sem estar pago não é marcado como pago', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(screen.getByLabelText('Já foi pago'));
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(api.parcelaCriar).toHaveBeenCalled());
    expect(api.parcelaPagar).not.toHaveBeenCalled();
  });

  it('desmarcar "já foi pago" esconde a data de pagamento', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.click(screen.getByLabelText('Já foi pago'));
    expect(screen.queryByLabelText('Data de pagamento')).toBeNull();
  });

  it('erro a registar aparece no modal', async () => {
    api.parcelaCriar.mockRejectedValue(new Error('id repetido'));
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(botao('Registar pagamento'));
    expect(await screen.findByText('id repetido')).toBeInTheDocument();
  });

  it('enquanto regista, o botão desativa-se', async () => {
    const { promessa, resolver } = adiar();
    api.parcelaCriar.mockReturnValue(promessa);
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(botao('Registar pagamento'));
    expect(await screen.findByRole('button', { name: 'A registar…' })).toBeDisabled();
    resolver({ ok: true });
  });

  it('registado com sucesso fecha o modal', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.type(screen.getByLabelText('Valor *'), '200');
    await utilizador.click(botao('Registar pagamento'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pagamento avulso' })).toBeNull());
  });

  it('cancelar fecha o modal sem gravar', async () => {
    const { utilizador } = await abrir();
    await abrirAvulso(utilizador);
    await utilizador.click(botao('Cancelar'));
    expect(screen.queryByRole('heading', { name: 'Pagamento avulso' })).toBeNull();
    expect(api.parcelaCriar).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Editar cliente — modal
// ═════════════════════════════════════════════════════════════════════════════
describe('Editar cliente — dados e gravação', () => {
  it('abre o modal de edição', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByRole('heading', { name: 'Editar cliente' })).toBeInTheDocument();
  });

  it('traz o nome do cliente', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Nome *')).toHaveValue('Maria Silva');
  });

  it('traz a identificação', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('NIF')).toHaveValue('123456789');
  });

  it('traz o e-mail nos contactos', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByDisplayValue('maria@exemplo.pt')).toBeInTheDocument();
  });

  it('traz o telefone nos contactos', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByDisplayValue('+351911222333')).toBeInTheDocument();
  });

  it('traz a área de atuação', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Área de atuação')).toHaveValue('Família');
  });

  it('traz o estado do cliente', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Estado')).toHaveValue('active');
  });

  it('traz o resumo do processo', async () => {
    const { utilizador } = await abrir({ client: cliente({ process_summary: 'Divórcio consensual' }) });
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Resumo do processo')).toHaveValue('Divórcio consensual');
  });

  it('traz as notas', async () => {
    const { utilizador } = await abrir({ client: cliente({ notes: 'Cliente do Dr. António' }) });
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Notas')).toHaveValue('Cliente do Dr. António');
  });

  it('campos nulos entram como vazios em vez de "null"', async () => {
    const { utilizador } = await abrir({ client: cliente({ nationality: null, birth_place: null }) });
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Nacionalidade')).toHaveValue('');
    expect(screen.getByLabelText('Naturalidade')).toHaveValue('');
  });

  it('guardar sem nome é recusado', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.click(botao('Guardar alterações'));
    expect(await screen.findByText('O nome é obrigatório.')).toBeInTheDocument();
  });

  it('nome só com espaços conta como vazio', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.type(screen.getByLabelText('Nome *'), '   ');
    await utilizador.click(botao('Guardar alterações'));
    await screen.findByText('O nome é obrigatório.');
    expect(api.clienteUpdate).not.toHaveBeenCalled();
  });

  it('guardar envia o nome alterado', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.type(screen.getByLabelText('Nome *'), 'Maria Silva Costa');
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ name: 'Maria Silva Costa' })));
  });

  it('guardar envia os contactos em JSON', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    const corpo = api.clienteUpdate.mock.calls[0][1];
    expect(JSON.parse(corpo.emails)).toEqual([{ label: 'Pessoal', value: 'maria@exemplo.pt' }]);
  });

  it('guardar mantém o e-mail principal em coluna própria', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ email: 'maria@exemplo.pt' })));
  });

  it('guardar não envia os campos auxiliares da morada', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    const corpo = api.clienteUpdate.mock.calls[0][1];
    expect(corpo).not.toHaveProperty('addrParts');
    expect(corpo).not.toHaveProperty('repAddrParts');
  });

  it('a filiação é composta a partir do pai e da mãe', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.type(screen.getByLabelText('Pai'), 'José');
    await utilizador.type(screen.getByLabelText('Mãe'), 'Ana');
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ filiation: 'José e Ana' })));
  });

  it('datas vazias são enviadas como nulo', async () => {
    const { utilizador } = await abrir({ client: cliente({ contract_start_date: '', first_attendance_date: '' }) });
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({
      contract_start_date: null, first_attendance_date: null,
    })));
  });

  it('enquanto grava, o botão avisa e desativa-se', async () => {
    const { promessa, resolver } = adiar();
    api.clienteUpdate.mockReturnValue(promessa);
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    expect(await screen.findByRole('button', { name: 'A guardar…' })).toBeDisabled();
    resolver({ ok: true });
  });

  it('enquanto grava, os campos ficam bloqueados', async () => {
    const { promessa, resolver } = adiar();
    api.clienteUpdate.mockReturnValue(promessa);
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(screen.getByLabelText('Nome *')).toBeDisabled());
    resolver({ ok: true });
  });

  it('erro ao gravar aparece dentro do modal', async () => {
    api.clienteUpdate.mockRejectedValue(new Error('NIF já existente'));
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    expect(await screen.findByText('NIF já existente')).toBeInTheDocument();
  });

  it('erro ao gravar mantém o modal aberto', async () => {
    api.clienteUpdate.mockRejectedValue(new Error('falhou'));
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await screen.findByText('falhou');
    expect(screen.getByRole('heading', { name: 'Editar cliente' })).toBeInTheDocument();
  });

  it('erro ao gravar devolve o botão ao normal', async () => {
    api.clienteUpdate.mockRejectedValue(new Error('falhou'));
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await screen.findByText('falhou');
    expect(botao('Guardar alterações')).toBeEnabled();
  });

  it('gravar com sucesso fecha o modal', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Editar cliente' })).toBeNull());
  });

  it('gravar com sucesso recarrega a ficha', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteGet).toHaveBeenCalledTimes(2));
  });

  it('cancelar fecha o modal', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Cancelar'));
    expect(screen.queryByRole('heading', { name: 'Editar cliente' })).toBeNull();
  });

  it('cancelar não grava nada', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.type(screen.getByLabelText('Nome *'), 'Outro Nome');
    await utilizador.click(botao('Cancelar'));
    expect(api.clienteUpdate).not.toHaveBeenCalled();
  });

  it('reabrir depois de cancelar repõe os dados originais', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.type(screen.getByLabelText('Nome *'), 'Outro Nome');
    await utilizador.click(botao('Cancelar'));
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Nome *')).toHaveValue('Maria Silva');
  });

  it('o cabeçalho continua a mostrar o nome antigo depois de cancelar', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.clear(screen.getByLabelText('Nome *'));
    await utilizador.type(screen.getByLabelText('Nome *'), 'Outro Nome');
    await utilizador.click(botao('Cancelar'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Silva');
  });

  it('o ✕ do canto também fecha o modal', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('heading', { name: 'Editar cliente' })).toBeNull();
  });

  it('a tecla Esc fecha o modal', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Editar cliente' })).toBeNull());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Editar cliente — singular vs coletiva
// ═════════════════════════════════════════════════════════════════════════════
describe('Editar cliente — pessoa singular vs coletiva', () => {
  const paraColetiva = (u) => u.selectOptions(screen.getByLabelText('Tipo de cliente'), 'coletiva');

  it('cliente singular pede o nome', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Nome *')).toBeInTheDocument();
  });

  it('passar a coletiva pede a denominação da empresa', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByLabelText('Denominação da empresa *')).toBeInTheDocument();
  });

  it('coletiva muda o título da secção', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByText('Dados da empresa')).toBeInTheDocument();
  });

  it('singular mostra "Dados pessoais"', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByText('Dados pessoais')).toBeInTheDocument();
  });

  it('coletiva pede NIFC em Portugal', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByLabelText('NIFC')).toBeInTheDocument();
  });

  it('coletiva pede CNPJ no Brasil', async () => {
    const { utilizador } = await abrir({ client: cliente({ country: 'BR' }) });
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByLabelText('CNPJ')).toBeInTheDocument();
  });

  it('coletiva mostra o DUNS', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByLabelText('DUNS')).toBeInTheDocument();
  });

  it('coletiva abre a secção do responsável', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByText('Dados do responsável')).toBeInTheDocument();
  });

  it('coletiva pede nome, cargo e NIF do responsável', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    for (const l of ['Nome do responsável', 'Cargo', 'NIF do responsável', 'Nacionalidade do responsável']) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
  });

  it('coletiva tem morada da sede e do responsável', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    expect(screen.getByText('Sede da empresa')).toBeInTheDocument();
    expect(screen.getByText('Morada do responsável')).toBeInTheDocument();
  });

  it('singular tem só a morada', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByText('Morada')).toBeInTheDocument();
    expect(screen.queryByText('Morada do responsável')).toBeNull();
  });

  it('singular não tem secção do responsável', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.queryByText('Dados do responsável')).toBeNull();
  });

  it('cliente já coletivo abre com os dados da empresa', async () => {
    const { utilizador } = await abrir({ client: cliente({ person_type: 'coletiva', rep_name: 'António Costa' }) });
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('Nome do responsável')).toHaveValue('António Costa');
  });

  it('guardar coletiva envia a morada do responsável quando preenchida', async () => {
    const { utilizador } = await abrir({ client: cliente({ person_type: 'coletiva' }) });
    await abrirEdicao(utilizador);
    const caixa = screen.getByText('Morada do responsável').closest('.adm-field');
    await utilizador.type(within(caixa).getByPlaceholderText('Nome da via'), 'do Ouro');
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ rep_address: 'Rua do Ouro' })));
  });

  it('singular nunca envia morada do responsável', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ rep_address: null })));
  });

  it('coletiva não envia pessoas adicionais', async () => {
    const { utilizador } = await abrir({ people: [{ id: 'p2', name: 'João' }] });
    await abrirEdicao(utilizador);
    await paraColetiva(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalledWith('cli-1', expect.objectContaining({ people: [] })));
  });

  it('em Portugal pede NISS, no Brasil pede RG', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('NISS')).toBeInTheDocument();
    expect(screen.queryByLabelText('RG')).toBeNull();
  });

  it('cliente brasileiro pede RG', async () => {
    const { utilizador } = await abrir({ client: cliente({ country: 'BR' }) });
    await abrirEdicao(utilizador);
    expect(screen.getByLabelText('RG')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Editar cliente — pessoas adicionais
// ═════════════════════════════════════════════════════════════════════════════
describe('Editar cliente — cliente conjunto', () => {
  const DUAS = { people: [{ id: 'cli-1-pes2', name: 'João Silva', identification: '987654321' }] };

  it('mostra uma pílula por pessoa', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    expect(botao('Maria Silva')).toBeInTheDocument();
    expect(botao('João Silva')).toBeInTheDocument();
  });

  it('há um botão para adicionar pessoa', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(screen.getByRole('button', { name: /Adicionar pessoa/ })).toBeInTheDocument();
  });

  it('adicionar pessoa abre os campos dela', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));
    expect(screen.getByLabelText('Nome completo *')).toBeInTheDocument();
  });

  it('escolher a segunda pessoa mostra os dados dela', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('João Silva'));
    expect(screen.getByLabelText('Nome completo *')).toHaveValue('João Silva');
  });

  it('a segunda pessoa tem morada própria', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('João Silva'));
    expect(screen.getByText('Morada / Endereço')).toBeInTheDocument();
  });

  it('voltar ao titular mostra os dados dele', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('João Silva'));
    await utilizador.click(botao('Maria Silva'));
    expect(screen.getByLabelText('Nome *')).toHaveValue('Maria Silva');
  });

  it('guardar envia as pessoas adicionais', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(api.clienteUpdate.mock.calls[0][1].people[0]).toMatchObject({ id: 'cli-1-pes2', name: 'João Silva' });
  });

  it('pessoa sem nome mas com dados trava a gravação', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));
    await utilizador.type(screen.getByLabelText('NIF'), '111222333');
    await utilizador.click(botao('Guardar alterações'));
    expect(await screen.findByText(/A pessoa 2 tem dados preenchidos mas falta o nome/)).toBeInTheDocument();
  });

  it('pessoa vazia acabada de adicionar não trava a gravação', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
  });

  it('pessoa sem nome não é gravada', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    await utilizador.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(api.clienteUpdate.mock.calls[0][1].people).toEqual([]);
  });

  it('remover uma pessoa tira-a da lista gravada', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('João Silva'));
    await utilizador.click(botao('Remover esta pessoa'));
    await utilizador.click(botao('Guardar alterações'));
    await waitFor(() => expect(api.clienteUpdate).toHaveBeenCalled());
    expect(api.clienteUpdate.mock.calls[0][1].people).toEqual([]);
  });

  it('remover uma pessoa avisa que só se aplica ao guardar', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.click(botao('João Silva'));
    expect(screen.getByText(/A remoção só é aplicada ao Guardar alterações/)).toBeInTheDocument();
  });

  it('pessoa sem nome fica com o rótulo "Pessoa N"', async () => {
    const { utilizador } = await abrir({ people: [{ id: 'p2', name: '' }] });
    await abrirEdicao(utilizador);
    expect(botao('Pessoa 2')).toBeInTheDocument();
  });

  it('coletiva não mostra as pílulas das pessoas', async () => {
    const { utilizador } = await abrir(DUAS);
    await abrirEdicao(utilizador);
    await utilizador.selectOptions(screen.getByLabelText('Tipo de cliente'), 'coletiva');
    expect(screen.queryByRole('button', { name: /Adicionar pessoa/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Eliminar cliente
// ═════════════════════════════════════════════════════════════════════════════
describe('Eliminar cliente', () => {
  const abrirEliminar = async (u) => {
    await abrirEdicao(u);
    await u.click(botao('Eliminar cliente…'));
    return screen.findByRole('heading', { name: 'Eliminar cliente' });
  };

  it('o botão de eliminar vive na edição do cliente', async () => {
    const { utilizador } = await abrir();
    await abrirEdicao(utilizador);
    expect(botao('Eliminar cliente…')).toBeInTheDocument();
  });

  it('abre o modal de confirmação', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(screen.getByRole('heading', { name: 'Eliminar cliente' })).toBeInTheDocument();
  });

  it('avisa que apaga tudo o que está associado', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(screen.getByText(/parcelas e pagamentos, histórico de comunicações, regras de notificação e documentos/)).toBeInTheDocument();
  });

  it('avisa que não há forma de recuperar', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(screen.getByText(/Não há forma de recuperar/)).toBeInTheDocument();
  });

  it('sugere arquivar em vez de eliminar', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(screen.getByText(/Se o objetivo é apenas arquivar/)).toBeInTheDocument();
  });

  it('o nome do cliente aparece no aviso', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(within(document.querySelectorAll('.adm-overlay')[1]).getByText('Maria Silva')).toBeInTheDocument();
  });

  it('o botão começa desativado', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    expect(botao('Eliminar definitivamente')).toBeDisabled();
  });

  it('nome errado mantém o botão desativado', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria');
    expect(botao('Eliminar definitivamente')).toBeDisabled();
  });

  it('nome exato liberta o botão', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    expect(botao('Eliminar definitivamente')).toBeEnabled();
  });

  it('espaços à volta do nome são tolerados', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), '  Maria Silva  ');
    expect(botao('Eliminar definitivamente')).toBeEnabled();
  });

  it('confirmar elimina o cliente', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    await utilizador.click(botao('Eliminar definitivamente'));
    await waitFor(() => expect(api.clienteRemove).toHaveBeenCalledWith('cli-1'));
  });

  it('eliminado, volta à lista de clientes', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    await utilizador.click(botao('Eliminar definitivamente'));
    await waitFor(() => expect(navegou).toHaveBeenCalledWith('/admin/clientes'));
  });

  it('enquanto elimina, o botão avisa', async () => {
    const { promessa, resolver } = adiar();
    api.clienteRemove.mockReturnValue(promessa);
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    await utilizador.click(botao('Eliminar definitivamente'));
    expect(await screen.findByRole('button', { name: 'A eliminar…' })).toBeInTheDocument();
    resolver({ ok: true });
  });

  it('erro ao eliminar é mostrado no modal', async () => {
    api.clienteRemove.mockRejectedValue(new Error('cliente com processos abertos'));
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    await utilizador.click(botao('Eliminar definitivamente'));
    expect(await screen.findByText('cliente com processos abertos')).toBeInTheDocument();
  });

  it('erro ao eliminar não navega', async () => {
    api.clienteRemove.mockRejectedValue(new Error('falhou'));
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    await utilizador.click(botao('Eliminar definitivamente'));
    await screen.findByText('falhou');
    expect(navegou).not.toHaveBeenCalled();
  });

  it('cancelar fecha o modal sem eliminar', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    const overlay = document.querySelectorAll('.adm-overlay')[1];
    await utilizador.click(within(overlay).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Eliminar cliente' })).toBeNull();
    expect(api.clienteRemove).not.toHaveBeenCalled();
  });

  it('reabrir o modal limpa o nome escrito', async () => {
    const { utilizador } = await abrir();
    await abrirEliminar(utilizador);
    await utilizador.type(screen.getByLabelText(/escreva o nome exato/), 'Maria Silva');
    const overlay = document.querySelectorAll('.adm-overlay')[1];
    await utilizador.click(within(overlay).getByRole('button', { name: 'Cancelar' }));
    await utilizador.click(botao('Eliminar cliente…'));
    expect(screen.getByLabelText(/escreva o nome exato/)).toHaveValue('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Resumo
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Resumo', () => {
  it('conta desde quando é cliente', async () => {
    await abrir({}, 'Resumo');
    expect(screen.getByText(porTexto(/é cliente desde 01\/12\/2025/))).toBeInTheDocument();
  });

  it('sem data de 1.º atendimento usa a do contrato', async () => {
    await abrir({ client: cliente({ first_attendance_date: null }) }, 'Resumo');
    expect(screen.getByText(porTexto(/é cliente desde 10\/01\/2026/))).toBeInTheDocument();
  });

  it('descreve o plano parcelado', async () => {
    await abrir({ installments: TRES_PARCELAS }, 'Resumo');
    expect(screen.getByText(porTexto(/parcelado em 3 prestações/))).toBeInTheDocument();
  });

  it('descreve a avença mensal', async () => {
    await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0 }), installments: [parcela(1, { amount: 450 })] }, 'Resumo');
    expect(screen.getByText(porTexto(/avença mensal de/))).toBeInTheDocument();
  });

  it('descreve o pro bono', async () => {
    await abrir({ client: cliente({ plan_type: 'probono' }) }, 'Resumo');
    expect(screen.getByText(porTexto(/gratuito e voluntário/))).toBeInTheDocument();
  });

  it('descreve o oficioso', async () => {
    await abrir({ client: cliente({ plan_type: 'oficioso' }) }, 'Resumo');
    expect(screen.getByText(porTexto(/nomeação da Ordem dos Advogados/))).toBeInTheDocument();
  });

  it('sem área de atuação assume "geral"', async () => {
    await abrir({ client: cliente({ practice_area: null }) }, 'Resumo');
    expect(screen.getByText('geral')).toBeInTheDocument();
  });

  it('mostra os lembretes configurados', async () => {
    await abrir({ rules: [{ id: 'r1', days_before: 3, channel: 'email' }] }, 'Resumo');
    expect(screen.getByText(porTexto(/3d antes via email/))).toBeInTheDocument();
  });

  it('sem lembretes não fala neles', async () => {
    await abrir({}, 'Resumo');
    expect(screen.queryByText(porTexto(/Lembretes configurados/))).toBeNull();
  });

  it('sem processo nenhum não mostra o cartão dos processos', async () => {
    await abrir({ client: cliente({ practice_area: null, process_summary: '', notes: '' }) }, 'Resumo');
    expect(screen.queryByText('Processo')).toBeNull();
  });

  it('mostra o processo do cliente', async () => {
    await abrir({ client: cliente({ processes: JSON.stringify([{ ref: '1289/26', area: 'Família', resumo: 'Divórcio' }]) }) }, 'Resumo');
    expect(screen.getAllByText('1289/26').length).toBeGreaterThan(0);
    expect(screen.getByText('Divórcio')).toBeInTheDocument();
  });

  it('com vários processos o título fica no plural', async () => {
    await abrir({ client: cliente({ processes: JSON.stringify([{ ref: 'A' }, { ref: 'B' }]) }) }, 'Resumo');
    expect(screen.getByText('Processos')).toBeInTheDocument();
  });

  it('escolher outro processo troca o painel', async () => {
    const { utilizador } = await abrir({ client: cliente({ processes: JSON.stringify([{ ref: 'A', resumo: 'um' }, { ref: 'B', resumo: 'dois' }]) }) }, 'Resumo');
    await utilizador.click(botao('B'));
    expect(screen.getByText('dois')).toBeInTheDocument();
  });

  it('processo sem resumo diz que não tem', async () => {
    await abrir({ client: cliente({ processes: JSON.stringify([{ ref: 'A' }]) }) }, 'Resumo');
    expect(screen.getByText('Sem resumo para este processo.')).toBeInTheDocument();
  });

  it('processo sem referência fica "Processo N"', async () => {
    await abrir({ client: cliente({ processes: JSON.stringify([{ resumo: 'x' }, { resumo: 'y' }]) }) }, 'Resumo');
    expect(botao(/Processo 1/)).toBeInTheDocument();
  });

  it('JSON de processos inválido cai no processo legado', async () => {
    await abrir({ client: cliente({ processes: 'não é json', process_summary: 'Resumo antigo' }) }, 'Resumo');
    expect(screen.getByText('Resumo antigo')).toBeInTheDocument();
  });

  it('clientes antigos mostram o processo escrito nas notas', async () => {
    await abrir({ client: cliente({ notes: 'Processo: 555/25', process_summary: 'x' }) }, 'Resumo');
    expect(screen.getAllByText('555/25').length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Notas
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Notas', () => {
  it('mostra as notas registadas', async () => {
    await abrir({ client: cliente({ notes: 'Prefere ser contactada à tarde.' }) }, 'Notas');
    expect(screen.getByText('Prefere ser contactada à tarde.')).toBeInTheDocument();
  });

  it('sem notas explica que não há', async () => {
    await abrir({}, 'Notas');
    expect(screen.getByText('Sem notas registadas para este cliente.')).toBeInTheDocument();
  });

  it('notas nulas não mostram "null"', async () => {
    await abrir({ client: cliente({ notes: null }) }, 'Notas');
    expect(screen.getByText('Sem notas registadas para este cliente.')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Comunicações
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Comunicações', () => {
  const LOG = [{ id: 'n1', sent_at: '2026-03-12T14:20:00', channel: 'email', status: 'sent', message_preview: 'Lembrete da parcela 1/3' }];

  it('pede o histórico deste cliente', async () => {
    await abrir({}, 'Comunicações');
    await waitFor(() => expect(api.notifLog).toHaveBeenCalledWith({ client_id: 'cli-1', limit: 100 }));
  });

  it('sem comunicações explica que ainda não houve', async () => {
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Ainda não foram enviadas comunicações a este cliente.')).toBeInTheDocument();
  });

  it('mostra a mensagem enviada', async () => {
    api.notifLog.mockResolvedValue({ log: LOG });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Lembrete da parcela 1/3')).toBeInTheDocument();
  });

  it('traduz o canal para E-mail', async () => {
    api.notifLog.mockResolvedValue({ log: LOG });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('E-mail')).toBeInTheDocument();
  });

  it('traduz o canal para WhatsApp', async () => {
    api.notifLog.mockResolvedValue({ log: [{ ...LOG[0], channel: 'whatsapp' }] });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('WhatsApp')).toBeInTheDocument();
  });

  it('mostra o estado enviada', async () => {
    api.notifLog.mockResolvedValue({ log: LOG });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Enviada')).toBeInTheDocument();
  });

  it('mostra o estado ignorada', async () => {
    api.notifLog.mockResolvedValue({ log: [{ ...LOG[0], status: 'skipped' }] });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Ignorada')).toBeInTheDocument();
  });

  it('falha de envio mostra a razão', async () => {
    api.notifLog.mockResolvedValue({ log: [{ ...LOG[0], status: 'error', error_message: 'caixa cheia' }] });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('caixa cheia')).toBeInTheDocument();
  });

  it('estado desconhecido é mostrado tal como veio', async () => {
    api.notifLog.mockResolvedValue({ log: [{ ...LOG[0], status: 'pendente' }] });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('pendente')).toBeInTheDocument();
  });

  it('mensagem sem pré-visualização mostra um travessão', async () => {
    api.notifLog.mockResolvedValue({ log: [{ ...LOG[0], message_preview: null }] });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('erro a carregar o histórico é explicado', async () => {
    api.notifLog.mockRejectedValue(new Error('sem ligação'));
    await abrir({}, 'Comunicações');
    expect(await screen.findByText(/Erro a carregar o histórico: sem ligação/)).toBeInTheDocument();
  });

  it('a hora do envio aparece ao lado da data', async () => {
    api.notifLog.mockResolvedValue({ log: LOG });
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('14:20')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Notificações (lembretes do cliente)
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Notificações', () => {
  const REGRA = { id: 'r1', days_before: 3, channel: 'email', template_id: 't1', enabled: 1 };
  const MODELOS = [{ id: 't1', name: 'Lembrete simpático', channel: 'email' }];

  it('explica a quem se destinam os lembretes', async () => {
    await abrir({}, 'Notificações');
    expect(screen.getByText(porTexto(/Lembretes automáticos enviados/))).toBeInTheDocument();
  });

  it('pede as regras deste cliente', async () => {
    await abrir({}, 'Notificações');
    await waitFor(() => expect(api.notifRegras).toHaveBeenCalledWith('cli-1'));
  });

  it('sem lembretes explica que não há', async () => {
    await abrir({}, 'Notificações');
    expect(await screen.findByText('Sem lembretes configurados para este cliente.')).toBeInTheDocument();
  });

  it('mostra a antecedência de cada lembrete', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    await abrir({}, 'Notificações');
    expect(await screen.findByText('3 dias antes')).toBeInTheDocument();
  });

  it('antecedência de um dia fica no singular', async () => {
    api.notifRegras.mockResolvedValue({ rules: [{ ...REGRA, days_before: 1 }] });
    await abrir({}, 'Notificações');
    expect(await screen.findByText('1 dia antes')).toBeInTheDocument();
  });

  it('antecedência zero diz "No próprio dia"', async () => {
    api.notifRegras.mockResolvedValue({ rules: [{ ...REGRA, days_before: 0 }] });
    await abrir({}, 'Notificações');
    expect(await screen.findByText('No próprio dia')).toBeInTheDocument();
  });

  it('mostra o nome do modelo', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    api.notifModelos.mockResolvedValue({ templates: MODELOS });
    await abrir({}, 'Notificações');
    const tabela = await screen.findByRole('table');
    expect(within(tabela).getByText('Lembrete simpático')).toBeInTheDocument();
  });

  it('modelo desconhecido mostra um travessão', async () => {
    api.notifRegras.mockResolvedValue({ rules: [{ ...REGRA, template_id: 'nada' }] });
    await abrir({}, 'Notificações');
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('desligar um lembrete grava o novo estado', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(api.notifUpdateRegra).toHaveBeenCalledWith('r1', { enabled: 0 }));
  });

  it('ligar um lembrete desligado grava o novo estado', async () => {
    api.notifRegras.mockResolvedValue({ rules: [{ ...REGRA, enabled: 0 }] });
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(api.notifUpdateRegra).toHaveBeenCalledWith('r1', { enabled: 1 }));
  });

  it('remover um lembrete pede confirmação', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(confirmar).toHaveBeenCalledWith('Remover este lembrete?');
  });

  it('confirmado, o lembrete é removido', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.notifRemoverRegra).toHaveBeenCalledWith('r1'));
  });

  it('recusar a confirmação não remove', async () => {
    api.notifRegras.mockResolvedValue({ rules: [REGRA] });
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(api.notifRemoverRegra).not.toHaveBeenCalled();
  });

  it('criar um lembrete envia o canal e a antecedência', async () => {
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Adicionar lembrete' }));
    await waitFor(() => expect(api.notifCriarRegra).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'cli-1', channel: 'email', days_before: 3, enabled: 1,
    })));
  });

  it('sem modelo escolhido não envia template_id', async () => {
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Adicionar lembrete' }));
    await waitFor(() => expect(api.notifCriarRegra).toHaveBeenCalled());
    expect(api.notifCriarRegra.mock.calls[0][0]).not.toHaveProperty('template_id');
  });

  it('mudar para WhatsApp muda o canal do novo lembrete', async () => {
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.selectOptions(screen.getByLabelText('Canal'), 'whatsapp');
    await utilizador.click(botao('Adicionar lembrete'));
    await waitFor(() => expect(api.notifCriarRegra).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp' })));
  });

  it('os modelos oferecidos são os do canal escolhido', async () => {
    api.notifModelos.mockResolvedValue({ templates: [...MODELOS, { id: 't2', name: 'WhatsApp curto', channel: 'whatsapp' }] });
    const { utilizador } = await abrir({}, 'Notificações');
    await waitFor(() => expect(screen.getByLabelText('Modelo')).toBeInTheDocument());
    expect(within(screen.getByLabelText('Modelo')).queryByRole('option', { name: 'WhatsApp curto' })).toBeNull();
    await utilizador.selectOptions(screen.getByLabelText('Canal'), 'whatsapp');
    expect(within(screen.getByLabelText('Modelo')).getByRole('option', { name: 'WhatsApp curto' })).toBeInTheDocument();
  });

  it('erro a carregar os lembretes é explicado', async () => {
    api.notifRegras.mockRejectedValue(new Error('sem permissões'));
    await abrir({}, 'Notificações');
    expect(await screen.findByText(/Erro: sem permissões/)).toBeInTheDocument();
  });

  it('erro a criar o lembrete é explicado', async () => {
    api.notifCriarRegra.mockRejectedValue(new Error('regra repetida'));
    const { utilizador } = await abrir({}, 'Notificações');
    await utilizador.click(await screen.findByRole('button', { name: 'Adicionar lembrete' }));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('regra repetida')));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Documentos do cliente e link de upload
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Documentos', () => {
  const DOC = { id: 'd1', filename: 'passaporte.pdf', content_type: 'application/pdf', size_bytes: 2048, uploaded_at: '2026-03-12T14:20:00' };
  const TOKEN = { token: 'tk-1', created_at: '2026-03-01', expires_at: '2099-01-01', used_count: 2, revoked: 0 };

  it('pede a lista de documentos ao entrar', async () => {
    await abrir({}, 'Documentos');
    await waitFor(() => expect(api.ficheirosListar).toHaveBeenCalledWith('cli-1'));
  });

  it('sem documentos explica que não há', async () => {
    await abrir({}, 'Documentos');
    expect(await screen.findByText('Sem documentos enviados.')).toBeInTheDocument();
  });

  it('mostra o nome do ficheiro enviado', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('passaporte.pdf')).toBeInTheDocument();
  });

  it('mostra o tamanho em KB', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('2 KB')).toBeInTheDocument();
  });

  it('abrir um documento chama a API', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Abrir' }));
    expect(api.ficheiroAbrir).toHaveBeenCalledWith('d1');
  });

  it('remover um documento pede confirmação com o nome', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Remover' }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('passaporte.pdf'));
  });

  it('confirmado, o documento é apagado', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Remover' }));
    await waitFor(() => expect(api.ficheiroRemover).toHaveBeenCalledWith('d1'));
  });

  it('recusar a confirmação não apaga', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [DOC] });
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Remover' }));
    expect(api.ficheiroRemover).not.toHaveBeenCalled();
  });

  it('gerar link cria um token de 30 dias', async () => {
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(botao('Gerar link (válido 30 dias)'));
    await waitFor(() => expect(api.tokenCriar).toHaveBeenCalledWith({ client_id: 'cli-1', instructions: null, days: 30 }));
  });

  it('as instruções escritas seguem com o link', async () => {
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.type(campoDoRotulo('Instruções (opcional)'), 'Enviar passaporte');
    await utilizador.click(botao('Gerar link (válido 30 dias)'));
    await waitFor(() => expect(api.tokenCriar).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'Enviar passaporte' })));
  });

  it('o link gerado é copiado para a área de transferência', async () => {
    const { utilizador } = await abrir({}, 'Documentos');
    // o userEvent.setup() instala o seu próprio clipboard no jsdom — espia-se
    // esse, já depois de montado o ecrã.
    const escrever = vi.spyOn(navigator.clipboard, 'writeText');
    await utilizador.click(botao('Gerar link (válido 30 dias)'));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(expect.stringContaining('/upload/tk-novo')));
  });

  it('o link gerado é mostrado à utilizadora', async () => {
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(botao('Gerar link (válido 30 dias)'));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('/upload/tk-novo')));
  });

  it('erro a gerar o link é explicado', async () => {
    api.tokenCriar.mockRejectedValue(new Error('limite atingido'));
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(botao('Gerar link (válido 30 dias)'));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('limite atingido')));
  });

  it('sem links ativos não mostra a tabela deles', async () => {
    await abrir({}, 'Documentos');
    await screen.findByText('Sem documentos enviados.');
    expect(screen.queryByText('LINKS ATIVOS')).toBeNull();
  });

  it('mostra os links ativos', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('LINKS ATIVOS')).toBeInTheDocument();
  });

  it('mostra quantas vezes o link foi usado', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('link válido aparece como Ativo', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('Ativo')).toBeInTheDocument();
  });

  it('link revogado aparece como Revogado', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [{ ...TOKEN, revoked: 1 }] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('Revogado')).toBeInTheDocument();
  });

  it('link fora de prazo aparece como Expirado', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [{ ...TOKEN, expires_at: '2020-01-01' }] });
    await abrir({}, 'Documentos');
    expect(await screen.findByText('Expirado')).toBeInTheDocument();
  });

  it('link expirado já não deixa copiar nem revogar', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [{ ...TOKEN, expires_at: '2020-01-01' }] });
    await abrir({}, 'Documentos');
    await screen.findByText('Expirado');
    expect(screen.queryByRole('link', { name: 'Copiar link' })).toBeNull();
  });

  it('copiar o link põe-no na área de transferência', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    const { utilizador } = await abrir({}, 'Documentos');
    const escrever = vi.spyOn(navigator.clipboard, 'writeText');
    await utilizador.click(await screen.findByRole('link', { name: 'Copiar link' }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(expect.stringContaining('/upload/tk-1')));
  });

  it('copiar o link dá confirmação visual', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Copiar link' }));
    expect(await screen.findByText('✓ Copiado')).toBeInTheDocument();
  });

  it('revogar o link pede confirmação', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Revogar' }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Revogar este link?'));
  });

  it('confirmado, o link é revogado', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Revogar' }));
    await waitFor(() => expect(api.tokenRevogar).toHaveBeenCalledWith('tk-1'));
  });

  it('recusar a confirmação não revoga', async () => {
    api.tokenListar.mockResolvedValue({ tokens: [TOKEN] });
    confirmar.mockReturnValue(false);
    const { utilizador } = await abrir({}, 'Documentos');
    await utilizador.click(await screen.findByRole('link', { name: 'Revogar' }));
    expect(api.tokenRevogar).not.toHaveBeenCalled();
  });

  it('falha a carregar os documentos deixa a lista vazia sem rebentar', async () => {
    api.ficheirosListar.mockRejectedValue(new Error('R2 em baixo'));
    await abrir({}, 'Documentos');
    expect(await screen.findByText('Sem documentos enviados.')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Procurações
// ═════════════════════════════════════════════════════════════════════════════
describe('Separador Procurações', () => {
  const MODELOS = [{ id: 'm1', nome: 'Procuração forense', categoria: 'Cível' }];
  const comModelos = () => api.procModelos.mockResolvedValue({ templates: MODELOS });

  it('explica que os dados vêm do cadastro', async () => {
    await abrir({}, 'Procurações');
    expect(screen.getByText(porTexto(/preenchidos automaticamente a partir do cadastro/))).toBeInTheDocument();
  });

  it('lista os modelos disponíveis', async () => {
    comModelos();
    await abrir({}, 'Procurações');
    expect(await screen.findByRole('option', { name: '[Cível] Procuração forense' })).toBeInTheDocument();
  });

  it('sem modelo escolhido não mostra o botão de gerar', async () => {
    comModelos();
    await abrir({}, 'Procurações');
    expect(talvezBotao('Gerar PDF')).toBeNull();
  });

  it('escolher o modelo faz a pré-visualização', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 'Eu, Maria Silva, constituo…', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await waitFor(() => expect(api.procPreview).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'm1', client_id: 'cli-1' })));
  });

  it('o texto preenchido aparece na pré-visualização', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 'Eu, Maria Silva, constituo…', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByText('Eu, Maria Silva, constituo…')).toBeInTheDocument();
  });

  it('modelo com poderes editáveis mostra o campo dos poderes', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: ['poderes'], poderes_default: 'poderes no processo [INDICAR]' });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByText('Poderes específicos (editável)')).toBeInTheDocument();
  });

  it('sem processo conhecido os poderes ficam com [INDICAR]', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: ['poderes'], poderes_default: 'poderes no processo [INDICAR]' });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByDisplayValue('poderes no processo [INDICAR]')).toBeInTheDocument();
  });

  it('o processo escrito entra no lugar de [INDICAR]', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: ['poderes'], poderes_default: 'poderes no processo [INDICAR]' });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await screen.findByText('Poderes específicos (editável)');
    await utilizador.type(screen.getByPlaceholderText(/n.º do processo/), '1289/26');
    expect(screen.getByDisplayValue('poderes no processo 1289/26')).toBeInTheDocument();
  });

  it('o processo escrito nas notas é oferecido na lista', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: ['poderes'], poderes_default: 'x [INDICAR]' });
    const { utilizador } = await abrir({ client: cliente({ notes: 'Processo: 555/25' }) }, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByRole('option', { name: '555/25' })).toBeInTheDocument();
  });

  it('a data de emissão começa em hoje', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByDisplayValue(hojeISO())).toBeInTheDocument();
  });

  it('o local de emissão vem preenchido', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByDisplayValue('Santa Maria da Feira')).toBeInTheDocument();
  });

  it('gerar o PDF envia modelo, cliente, local e data', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar PDF' }));
    await waitFor(() => expect(api.procGerar).toHaveBeenCalledWith(expect.objectContaining({
      template_id: 'm1', client_id: 'cli-1', person_id: 'cli-1', local: 'Santa Maria da Feira',
    })));
  });

  it('erro a gerar a procuração é explicado', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    api.procGerar.mockRejectedValue(new Error('modelo corrompido'));
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar PDF' }));
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('modelo corrompido')));
  });

  it('erro a carregar o modelo é explicado', async () => {
    comModelos();
    api.procPreview.mockRejectedValue(new Error('modelo inexistente'));
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await waitFor(() => expect(alertar).toHaveBeenCalledWith(expect.stringContaining('modelo inexistente')));
  });

  it('cliente conjunto escolhe o outorgante', async () => {
    comModelos();
    await abrir({ people: [{ id: 'p2', name: 'João Silva' }] }, 'Procurações');
    expect(screen.getByText('Outorgante desta procuração')).toBeInTheDocument();
  });

  it('trocar de outorgante refaz a pré-visualização', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    const { utilizador } = await abrir({ people: [{ id: 'p2', name: 'João Silva' }] }, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    await utilizador.click(screen.getAllByRole('checkbox')[1]);
    await waitFor(() => expect(api.procPreview).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'p2' })));
  });

  it('cliente de uma pessoa não mostra escolha de outorgante', async () => {
    comModelos();
    await abrir({}, 'Procurações');
    expect(screen.queryByText('Outorgante desta procuração')).toBeNull();
  });

  it('avisa que campos em falta saem como [•]', async () => {
    comModelos();
    api.procPreview.mockResolvedValue({ texto: 't', campos_editaveis: [] });
    const { utilizador } = await abrir({}, 'Procurações');
    await utilizador.selectOptions(campoDoRotulo('Modelo de procuração'), 'm1');
    expect(await screen.findByText(/Campos em falta no cadastro/)).toBeInTheDocument();
  });

  it('falha a listar os modelos não parte o separador', async () => {
    api.procModelos.mockRejectedValue(new Error('sem ligação'));
    await abrir({}, 'Procurações');
    expect(screen.getByText('Gerar procuração')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Ler documentos com IA
// ═════════════════════════════════════════════════════════════════════════════
describe('Ler mais documentos com IA', () => {
  it('a zona de leitura por IA está sempre visível', async () => {
    await abrir();
    expect(screen.getByText('Ler mais documentos com IA')).toBeInTheDocument();
  });

  it('clicar abre o modal de leitura', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByText('Ler mais documentos com IA'));
    expect(await screen.findByRole('heading', { name: 'Ler com IA' })).toBeInTheDocument();
  });

  it('o modal explica que só preenche o que falta', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByText('Ler mais documentos com IA'));
    expect(await screen.findByText(/preenche apenas o que estiver em falta/)).toBeInTheDocument();
  });

  it('fechar o modal deixa a ficha como estava', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByText('Ler mais documentos com IA'));
    await utilizador.click(await screen.findByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('heading', { name: 'Ler com IA' })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Valores estranhos vindos da API
// ═════════════════════════════════════════════════════════════════════════════
describe('Ficha do cliente — dados estranhos vindos da API', () => {
  it('cliente sem campo nenhum além do id não rebenta', async () => {
    api.clienteGet.mockResolvedValue({ client: { id: 'cli-1' } });
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('contactos com JSON inválido caem no valor antigo', async () => {
    await abrir({ client: cliente({ emails: 'isto não é json' }) });
    expect(screen.getByText(porTexto(/maria@exemplo\.pt/))).toBeInTheDocument();
  });

  it('lista de contactos vazia recai no campo antigo', async () => {
    await abrir({ client: cliente({ emails: '[]' }) });
    expect(screen.getByText(porTexto(/maria@exemplo\.pt/))).toBeInTheDocument();
  });

  it('total contratado como texto continua a ser somado', async () => {
    await abrir({ client: cliente({ honorarios_total: '1200' }), installments: TRES_PARCELAS });
    const item = screen.getByText('Total contratado').closest('.adm-plan-item');
    expect(textoDe(item)).toContain(dinheiro(1200));
  });

  it('lista de pessoas nula não rebenta', async () => {
    api.clienteGet.mockResolvedValue({ client: cliente(), installments: [], people: null });
    renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('data de vencimento nula mostra travessão', async () => {
    await abrir({ client: cliente({ plan_type: 'monthly', honorarios_total: 0, contract_start_date: null }), installments: [parcela(1)] });
    const item = screen.getByText('Início da avença').closest('.adm-plan-item');
    expect(textoDe(item)).toContain('—');
  });

  it('parcela sem número não rebenta a tabela', async () => {
    await abrir({ installments: [parcela(1, { installment_number: null, total_installments: null })] });
    expect(document.querySelectorAll('.adm-table tbody tr')).toHaveLength(1);
  });

  it('estado desconhecido da parcela cai em pendente', async () => {
    await abrir({ installments: [parcela(1, { status: 'seja_o_que_for', due_date: diasDaqui(30) })] });
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('regras nulas não partem o resumo', async () => {
    api.clienteGet.mockResolvedValue({ client: cliente(), installments: [], people: [], rules: null });
    const { utilizador } = renderizar(<ClientDetail />, { caminho: CAMINHO, rota: ROTA });
    await screen.findByRole('heading', { level: 1 });
    await irPara(utilizador, 'Resumo');
    expect(screen.getByText(porTexto(/é cliente desde/))).toBeInTheDocument();
  });

  it('documentos sem tamanho não mostram NaN', async () => {
    api.ficheirosListar.mockResolvedValue({ documents: [{ id: 'd1', filename: 'x.pdf', content_type: 'application/pdf', size_bytes: 0, uploaded_at: '2026-03-12T10:00:00' }] });
    await abrir({}, 'Documentos');
    await screen.findByText('x.pdf');
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('log de comunicações nulo é tratado como vazio', async () => {
    api.notifLog.mockResolvedValue({});
    await abrir({}, 'Comunicações');
    expect(await screen.findByText('Ainda não foram enviadas comunicações a este cliente.')).toBeInTheDocument();
  });

  it('regras de lembrete nulas são tratadas como vazias', async () => {
    api.notifRegras.mockResolvedValue({});
    await abrir({}, 'Notificações');
    expect(await screen.findByText('Sem lembretes configurados para este cliente.')).toBeInTheDocument();
  });
});
