// @vitest-environment jsdom
// tests/admin/listagens.test.jsx
// Os dois ecrãs de listagem da Área Privada:
//   · src/admin/pages/Clients.jsx      — a lista de clientes
//   · src/admin/pages/Installments.jsx — parcelas e mensalidades
//
// São os ecrãs onde a Dra. passa o dia: procura um cliente pelo nome, filtra por
// país ou por situação, ordena por vencimento e clica para abrir a ficha. Aqui
// testa-se o que ela VÊ — esqueleto a carregar, mensagens de lista vazia, erros
// que não podem deixar o ecrã em branco, contagens que não podem dar NaN,
// dinheiro e datas em português — e o que ela CLICA.
//
// A API vive mockada (a rede está fechada em tests/setup.js). Defeitos reais
// ficam marcados com `it.fails` + comentário `// BUG:`.
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderizar, screen, within, waitFor, configure } from '../helpers/dom.jsx';

// a suíte corre ao lado de dezenas de ficheiros de worker; o jsdom fica lento sob
// carga e 1 s por omissão do findBy/waitFor não chega
configure({ asyncUtilTimeout: 3000 });

// ─── espia da navegação (o resto do react-router-dom fica real: Link, useSearchParams) ───
const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navegou };
});

// ─── API mockada ────────────────────────────────────────────────────────────
const api = vi.hoisted(() => ({
  listarClientes: vi.fn(),
  listarParcelas: vi.fn(),
  marcarPaga: vi.fn(),
  atualizarParcela: vi.fn(),
  logoUrl: vi.fn(),
}));
vi.mock('../../src/admin/apiClient.js', () => ({
  clients: {
    list: api.listarClientes,
    get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  },
  installments: {
    list: api.listarParcelas,
    markPaid: api.marcarPaga,
    update: api.atualizarParcela,
    create: vi.fn(), get: vi.fn(), remove: vi.fn(), upcoming: vi.fn(),
  },
  clientLogo: { fetchUrl: api.logoUrl, upload: vi.fn(), remove: vi.fn() },
  getToken: () => 'tok', setToken: vi.fn(), clearToken: vi.fn(),
}));

import { useSearchParams } from 'react-router-dom';
import Clients from '../../src/admin/pages/Clients.jsx';
import Installments from '../../src/admin/pages/Installments.jsx';
import { ToastHost } from '../../src/admin/toasts.jsx';
import { DialogHost } from '../../src/admin/dialogs.jsx';

/* ───────────────────── ambiente que o jsdom não tem ─────────────────────── */

class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ isIntersecting: true }]); }   // revela já (Reveal/RsShell/Ticker)
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const blobsCriados = [];

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  // O Ticker dos KPIs anima 1200 ms com requestAnimationFrame. Em vez de esperar
  // 1,2 s por teste, damos-lhe um relógio que salta: 2 frames e chega ao fim.
  let relogio = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => { relogio += 5000; cb(relogio); }, 0));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));

  URL.createObjectURL = (b) => { blobsCriados.push(b); return 'blob:falso'; };
  URL.revokeObjectURL = () => {};

  // âncoras reais (wa.me, CSV) não navegam no jsdom — evita o ruído de
  // "Not implemented: navigation" sem impedir os onClick do React
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();
  }, true);

  // Erros apanhados pela fronteira de erro são re-lançados pelo React em dev —
  // não podem derrubar o ficheiro de teste.
  window.addEventListener('error', (e) => { e.preventDefault(); });
});

beforeEach(() => {
  vi.clearAllMocks();
  blobsCriados.length = 0;
  api.logoUrl.mockResolvedValue(null);
  api.marcarPaga.mockResolvedValue({ ok: true });
  api.atualizarParcela.mockResolvedValue({ ok: true });
});

afterEach(() => { localStorage.clear(); });

/* ─────────────────────────── utilitários ────────────────────────────────── */

// pt-PT separa os milhares com espaço inseparável — comparar sem normalizar
// falha com duas strings visualmente idênticas.
const norm = (s) => String(s == null ? '' : s).replace(new RegExp('[\\u00a0\\u202f]', 'g'), ' ');
const txt = (el) => norm(el && el.textContent).replace(/\s+/g, ' ').trim();

const pad = (n) => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const paraISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hojeISO = () => paraISO(hoje());
const emDias = (n) => { const d = hoje(); d.setDate(d.getDate() + n); return paraISO(d); };
// dia do mês corrente (o ecrã das parcelas abre filtrado pelo mês atual)
const noMes = (dia) => `${hojeISO().slice(0, 7)}-${pad(dia)}`;
// dia de um mês vizinho (n = -1 mês passado, +1 mês seguinte)
const mesVizinho = (n, dia) => {
  const d = hoje(); d.setDate(1); d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(dia)}`;
};
const rotuloMes = () => new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

// fronteira de erro: um ecrã que rebenta não pode derrubar a suíte em silêncio
class Limite extends React.Component {
  constructor(p) { super(p); this.state = { caiu: false }; }
  static getDerivedStateFromError() { return { caiu: true }; }
  componentDidCatch() {}
  render() { return this.state.caiu ? <p>ECRA REBENTOU</p> : this.props.children; }
}
const rebentou = () => screen.queryByText('ECRA REBENTOU') !== null;

// espia dos parâmetros do URL (os filtros são partilháveis por link)
function EspiaUrl() {
  const [p] = useSearchParams();
  return <span data-testid="url">{p.toString()}</span>;
}
const urlAtual = () => screen.getByTestId('url').textContent;

/* ───────────────────────────── fixtures ─────────────────────────────────── */

const cliente = (over = {}) => ({
  id: 'c1',
  name: 'Maria Silva',
  email: 'maria@exemplo.pt',
  phone: '+351911222333',
  country: 'PT',
  practice_area: 'Família',
  plan_type: 'parcelado',
  identification: '123 456 789',
  extra_people: 0,
  extra_names: '',
  logo_key: null,
  ...over,
});

const parcela = (over = {}) => ({
  id: 'p1',
  client_id: 'c1',
  client_name: 'Maria Silva',
  client_country: 'PT',
  client_phone: '+351911222333',
  installment_number: 1,
  total_installments: 3,
  due_date: noMes(10),
  amount: 200,
  currency: 'EUR',
  status: 'pending',
  wa_sent_at: null,
  ...over,
});

/* ─────────────────────────── montagem ───────────────────────────────────── */

// Clients faz 4 chamadas: clients.list() e installments.list() para pending,
// due_today e late.
function prepararClientes({ clientes = [], pendentes = [], hojeVence = [], atrasadas = [] } = {}) {
  api.listarClientes.mockResolvedValue({ clients: clientes });
  api.listarParcelas.mockImplementation((f = {}) => Promise.resolve({
    installments: f.status === 'due_today' ? hojeVence : f.status === 'late' ? atrasadas : pendentes,
  }));
}

async function montarClientes(dados = {}, { caminho = '/admin/clientes', url = false } = {}) {
  prepararClientes(dados);
  const r = renderizar(<>{<Clients />}{url && <EspiaUrl />}</>, { caminho });
  await screen.findByRole('heading', { name: 'Clientes' });
  return r;
}

async function montarParcelas(lista = [], { extras = false } = {}) {
  api.listarParcelas.mockResolvedValue({ installments: lista });
  const r = renderizar(<><Installments />{extras && <><ToastHost /><DialogHost /></>}</>);
  await screen.findByRole('heading', { name: 'Parcelas e mensalidades' });
  return r;
}

/* ───────────────────── atalhos de leitura do ecrã ───────────────────────── */

const linhas = () => (screen.queryAllByRole('row') || []).slice(1);
const celula = (tr, i) => within(tr).getAllByRole('cell')[i];
const colunaNomes = () => linhas().map((tr) => txt(celula(tr, 0)));
const cabecalho = (nome) => screen.getByRole('columnheader', { name: nome });
const temTabela = () => screen.queryByRole('table') !== null;
const subtitulo = () => txt(document.querySelector('.sub'));

// contador "N clientes" / "N clientes de M" da barra de situação
const contador = () => screen.getAllByText(/^\d+ clientes?( de \d+)?$/, { selector: 'span' })[0];

// cartão de KPI das parcelas (o rótulo identifica o cartão inteiro)
const cartao = (rotulo) => screen.getByText(rotulo).closest('.glass');

const pesquisaClientes = () => screen.getByPlaceholderText(/Pesquisar por nome/);
const pesquisaParcelas = () => screen.getByPlaceholderText(/Pesquisar por cliente/);
const botao = (nome) => screen.getByRole('button', { name: nome });

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — carregamento e erro
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — a carregar', () => {
  const pendurar = () => {
    api.listarClientes.mockReturnValue(new Promise(() => {}));
    api.listarParcelas.mockReturnValue(new Promise(() => {}));
  };

  it('mostra o esqueleto enquanto espera pela API', () => {
    pendurar();
    renderizar(<Clients />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('o esqueleto anuncia-se como ocupado às leitoras de ecrã', () => {
    pendurar();
    renderizar(<Clients />);
    expect(screen.getByLabelText('A carregar')).toHaveAttribute('aria-busy', 'true');
  });

  it('enquanto carrega não mostra o título da página', () => {
    pendurar();
    renderizar(<Clients />);
    expect(screen.queryByRole('heading', { name: 'Clientes' })).not.toBeInTheDocument();
  });

  it('enquanto carrega não mostra a tabela', () => {
    pendurar();
    renderizar(<Clients />);
    expect(temTabela()).toBe(false);
  });

  it('o esqueleto desaparece quando os dados chegam', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('pede a lista de clientes uma só vez', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(api.listarClientes).toHaveBeenCalledTimes(1);
  });

  it('pede as parcelas dos três estados que interessam ao ecrã', async () => {
    await montarClientes({ clientes: [cliente()] });
    const estados = api.listarParcelas.mock.calls.map(([f]) => f.status);
    expect(estados).toEqual(expect.arrayContaining(['pending', 'due_today', 'late']));
  });
});

describe('Clientes — erro ao carregar', () => {
  const falhar = (msg = 'Falha na ligação ao servidor') => {
    api.listarClientes.mockRejectedValue(new Error(msg));
    api.listarParcelas.mockResolvedValue({ installments: [] });
  };

  it('mostra a mensagem do erro em vez de um ecrã em branco', async () => {
    falhar();
    renderizar(<Clients />);
    expect(await screen.findByText('Falha na ligação ao servidor')).toBeInTheDocument();
  });

  it('o erro tira o esqueleto do ecrã', async () => {
    falhar();
    renderizar(<Clients />);
    await screen.findByText('Falha na ligação ao servidor');
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('com erro não mostra tabela nenhuma', async () => {
    falhar();
    renderizar(<Clients />);
    await screen.findByText('Falha na ligação ao servidor');
    expect(temTabela()).toBe(false);
  });

  it('um 401 do servidor aparece com a mensagem do servidor', async () => {
    falhar('Sessão expirada');
    renderizar(<Clients />);
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
  });

  it('se falharem só as parcelas o ecrã também avisa', async () => {
    api.listarClientes.mockResolvedValue({ clients: [cliente()] });
    api.listarParcelas.mockRejectedValue(new Error('Parcelas indisponíveis'));
    renderizar(<Clients />);
    expect(await screen.findByText('Parcelas indisponíveis')).toBeInTheDocument();
  });

  it('resposta sem a chave clients não rebenta o ecrã', async () => {
    api.listarClientes.mockResolvedValue({});
    api.listarParcelas.mockResolvedValue({});
    renderizar(<Clients />);
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — lista vazia
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — lista vazia', () => {
  it('diz que não encontrou clientes', async () => {
    await montarClientes({ clientes: [] });
    expect(screen.getByText('Nenhum cliente encontrado com esses filtros.')).toBeInTheDocument();
  });

  it('não desenha a tabela', async () => {
    await montarClientes({ clientes: [] });
    expect(temTabela()).toBe(false);
  });

  it('o contador diz 0 clientes', async () => {
    await montarClientes({ clientes: [] });
    expect(txt(contador())).toBe('0 clientes');
  });

  it('o subtítulo não dá NaN com a lista vazia', async () => {
    await montarClientes({ clientes: [] });
    expect(subtitulo()).toBe('0 clientes · 0 com plano ativo');
  });

  it('lista vazia não mostra paginação', async () => {
    await montarClientes({ clientes: [] });
    expect(screen.queryByRole('button', { name: 'Página seguinte' })).not.toBeInTheDocument();
  });

  it('a pesquisa sem resultados mostra a mesma mensagem', async () => {
    const { utilizador } = await montarClientes({ clientes: [cliente()] });
    await utilizador.type(pesquisaClientes(), 'zzzz');
    expect(await screen.findByText('Nenhum cliente encontrado com esses filtros.')).toBeInTheDocument();
  });

  it('a pesquisa sem resultados mantém o total original à vista', async () => {
    const { utilizador } = await montarClientes({ clientes: [cliente(), cliente({ id: 'c2', name: 'Ana' })] });
    await utilizador.type(pesquisaClientes(), 'zzzz');
    await waitFor(() => expect(txt(contador())).toBe('0 clientes de 2'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — a listagem
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — listagem', () => {
  const tres = [
    cliente(),
    cliente({ id: 'c2', name: 'João Pereira', email: 'joao@exemplo.pt', practice_area: 'Cível' }),
    cliente({ id: 'c3', name: 'Ana Costa', country: 'BR', phone: '+5511999998888', practice_area: 'Nacionalidade' }),
  ];

  it('mostra uma linha por cliente', async () => {
    await montarClientes({ clientes: tres });
    expect(linhas()).toHaveLength(3);
  });

  it('mostra o nome de cada cliente', async () => {
    await montarClientes({ clientes: tres });
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('João Pereira')).toBeInTheDocument();
  });

  it('mostra a área de atuação', async () => {
    await montarClientes({ clientes: tres });
    const linha = screen.getByText('João Pereira').closest('tr');
    expect(txt(celula(linha, 1))).toBe('Cível');
  });

  it('sem área mostra um travessão', async () => {
    await montarClientes({ clientes: [cliente({ practice_area: null })] });
    expect(txt(celula(linhas()[0], 1))).toBe('—');
  });

  it('clientes de Portugal mostram o e-mail', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(txt(celula(linhas()[0], 0))).toContain('maria@exemplo.pt');
  });

  it('clientes do Brasil mostram o telefone', async () => {
    await montarClientes({ clientes: [cliente({ country: 'BR', phone: '+5511999998888' })] });
    expect(txt(celula(linhas()[0], 0))).toContain('+5511999998888');
  });

  it('mostra a sigla do país ao lado do contacto', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(txt(celula(linhas()[0], 0))).toContain('· PT');
  });

  it('cliente sem contacto mostra travessão', async () => {
    await montarClientes({ clientes: [cliente({ email: null })] });
    expect(txt(celula(linhas()[0], 0))).toContain('— · PT');
  });

  it('a inicial do avatar vem das duas primeiras palavras do nome', async () => {
    await montarClientes({ clientes: [cliente({ name: 'Maria Silva Santos' })] });
    expect(screen.getByText('MS')).toBeInTheDocument();
  });

  it('cliente sem nome mostra um C no avatar', async () => {
    await montarClientes({ clientes: [cliente({ id: 'sem-nome', name: '' })] });
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('cliente conjunto mostra o distintivo com o número de pessoas', async () => {
    await montarClientes({ clientes: [cliente({ extra_people: 2, extra_names: 'José e Rita' })] });
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('cliente sozinho não tem distintivo', async () => {
    await montarClientes({ clientes: [cliente({ extra_people: 0 })] });
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('mostra a data do próximo vencimento em formato português', async () => {
    await montarClientes({
      clientes: [cliente()],
      pendentes: [parcela({ due_date: '2026-12-24' })],
    });
    expect(txt(celula(linhas()[0], 2))).toBe('24/12/2026');
  });

  it('cliente sem parcelas mostra travessão no vencimento', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(txt(celula(linhas()[0], 2))).toBe('—');
  });

  it('mostra o valor da próxima parcela em euros', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: 250 })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 250');
  });

  it('parcela em reais aparece com R$', async () => {
    await montarClientes({
      clientes: [cliente({ country: 'BR' })],
      pendentes: [parcela({ amount: 480, currency: 'BRL' })],
    });
    expect(txt(celula(linhas()[0], 3))).toBe('R$ 480');
  });

  it('os cêntimos aparecem com vírgula', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: 250.5 })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 250,5');
  });

  it('milhares aparecem separados por espaço', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: 25000 })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 25 000');
  });

  it('cliente sem parcelas e com plano parcelado aparece como quitado', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(txt(celula(linhas()[0], 3))).toBe('Quitado');
  });

  it('cliente pro bono não mostra valor', async () => {
    await montarClientes({ clientes: [cliente({ plan_type: 'probono' })] });
    expect(txt(celula(linhas()[0], 3))).toBe('—');
  });

  it('cliente oficioso sem parcelas mostra "A fixar"', async () => {
    await montarClientes({ clientes: [cliente({ plan_type: 'oficioso' })] });
    expect(txt(celula(linhas()[0], 3))).toBe('A fixar');
  });

  it('a tabela tem as cinco colunas do ecrã', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
  });

  it('aguenta uma lista grande sem perder o total', async () => {
    const muitos = Array.from({ length: 120 }, (_, i) => cliente({ id: 'c' + i, name: `Cliente ${i}` }));
    await montarClientes({ clientes: muitos });
    expect(subtitulo()).toContain('120 clientes');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — selos de estado
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — selo de estado', () => {
  // o selo vive na tabela; os filtros lá em cima usam as mesmas palavras
  const selo = (t) => within(screen.getByRole('table')).getByText(t);
  const semSelo = (t) => within(screen.getByRole('table')).queryByText(t);

  it('pro bono tem selo próprio', async () => {
    await montarClientes({ clientes: [cliente({ plan_type: 'probono' })] });
    expect(selo('PRO BONO')).toBeInTheDocument();
  });

  it('oficioso sem parcelas aguarda trânsito', async () => {
    await montarClientes({ clientes: [cliente({ plan_type: 'oficioso' })] });
    expect(selo('AGUARDA TRÂNSITO')).toBeInTheDocument();
  });

  it('sem parcelas por pagar o processo está concluído', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(selo('CONCLUÍDO')).toBeInTheDocument();
  });

  it('parcela atrasada mostra os dias de atraso', async () => {
    await montarClientes({
      clientes: [cliente()],
      atrasadas: [parcela({ status: 'late', due_date: emDias(-3) })],
    });
    expect(selo('3D ATRASO')).toBeInTheDocument();
  });

  it('parcela que vence hoje diz HOJE', async () => {
    await montarClientes({
      clientes: [cliente()],
      hojeVence: [parcela({ status: 'due_today', due_date: hojeISO() })],
    });
    expect(selo('HOJE')).toBeInTheDocument();
  });

  it('parcela de amanhã diz AMANHÃ', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ due_date: emDias(1) })] });
    expect(selo('AMANHÃ')).toBeInTheDocument();
  });

  it('parcela mais distante fica só a vencer', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ due_date: emDias(12) })] });
    expect(selo('A VENCER')).toBeInTheDocument();
  });

  it('oficioso já com parcela deixa de aguardar trânsito', async () => {
    await montarClientes({
      clientes: [cliente({ plan_type: 'oficioso' })],
      pendentes: [parcela({ due_date: emDias(12) })],
    });
    expect(semSelo('AGUARDA TRÂNSITO')).toBeNull();
    expect(selo('A VENCER')).toBeInTheDocument();
  });

  it('de duas parcelas do mesmo cliente vale a mais próxima', async () => {
    await montarClientes({
      clientes: [cliente()],
      pendentes: [parcela({ id: 'p2', due_date: emDias(30) }), parcela({ id: 'p3', due_date: emDias(2) })],
    });
    expect(txt(celula(linhas()[0], 2))).toBe(emDias(2).split('-').reverse().join('/'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — pesquisa
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — pesquisa', () => {
  const gente = [
    cliente({ id: 'c1', name: 'Maria Silva', email: 'maria@exemplo.pt', identification: '123 456 789' }),
    cliente({ id: 'c2', name: 'José Ávila', email: 'jose.avila@exemplo.pt', identification: '987 654 321' }),
    cliente({ id: 'c3', name: 'Ana Costa', email: 'ana@outra.pt', identification: '111 222 333', extra_names: 'Bruno Costa' }),
  ];
  const procurar = async (u, t) => {
    await u.type(pesquisaClientes(), t);
    await waitFor(() => expect(txt(contador())).toMatch(/^\d+ clientes? de 3$/));
  };

  it('encontra pelo nome', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'maria');
    expect(colunaNomes()).toHaveLength(1);
    expect(colunaNomes()[0]).toContain('Maria Silva');
  });

  it('ignora maiúsculas', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'MARIA');
    expect(colunaNomes()[0]).toContain('Maria Silva');
  });

  it('encontra por parte do apelido', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'silva');
    expect(colunaNomes()).toHaveLength(1);
  });

  it('encontra nomes com acentos escritos com acento', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'josé');
    expect(colunaNomes()[0]).toContain('José Ávila');
  });

  it('encontra acentos em maiúsculas', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'ÁVILA');
    expect(colunaNomes()[0]).toContain('José Ávila');
  });

  // A pesquisa compara texto cru: quem escreve "jose" não encontra "José".
  // Fica documentado — a Dra. tem de escrever o acento.
  it('sem acento não encontra o nome acentuado', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'jose ');
    expect(linhas()).toHaveLength(0);
  });

  it('encontra pelo e-mail', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'ana@outra');
    expect(colunaNomes()[0]).toContain('Ana Costa');
  });

  it('encontra pelo domínio do e-mail', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, '@exemplo.pt');
    expect(linhas()).toHaveLength(2);
  });

  it('encontra pelo NIF tal como está guardado', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, '987 654 321');
    expect(colunaNomes()[0]).toContain('José Ávila');
  });

  it('encontra o NIF escrito sem espaços', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, '987654321');
    expect(colunaNomes()[0]).toContain('José Ávila');
  });

  it('encontra por parte do NIF', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, '111222');
    expect(colunaNomes()[0]).toContain('Ana Costa');
  });

  it('encontra pelo nome de quem partilha o processo', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'Bruno');
    expect(colunaNomes()[0]).toContain('Ana Costa');
  });

  it('pesquisa sem resultados esvazia a tabela', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'ninguém');
    expect(temTabela()).toBe(false);
  });

  it('apagar a pesquisa devolve toda a gente', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await procurar(utilizador, 'maria');
    await utilizador.clear(pesquisaClientes());
    await waitFor(() => expect(linhas()).toHaveLength(3));
  });

  it('a pesquisa começa preenchida a partir do URL', async () => {
    await montarClientes({ clientes: gente }, { caminho: '/admin/clientes?q=maria' });
    expect(pesquisaClientes()).toHaveValue('maria');
    expect(linhas()).toHaveLength(1);
  });

  it('escrever na pesquisa guarda o termo no URL', async () => {
    const { utilizador } = await montarClientes({ clientes: gente }, { url: true });
    await utilizador.type(pesquisaClientes(), 'ana');
    await waitFor(() => expect(urlAtual()).toBe('q=ana'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — filtros
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — filtros', () => {
  const gente = [
    cliente({ id: 'c1', name: 'Maria Silva', country: 'PT', practice_area: 'Família' }),
    cliente({ id: 'c2', name: 'João Pereira', country: 'PT', practice_area: 'Cível' }),
    cliente({ id: 'c3', name: 'Ana Costa', country: 'BR', practice_area: 'Família' }),
    cliente({ id: 'c4', name: 'Rui Dias', country: 'BR', practice_area: 'Nacionalidade', plan_type: 'probono' }),
    cliente({ id: 'c5', name: 'Vera Lima', country: 'PT', practice_area: 'Cível', plan_type: 'oficioso' }),
  ];
  const selectArea = () => screen.getByLabelText('Filtrar por área');

  it('a lista começa sem filtros', async () => {
    await montarClientes({ clientes: gente });
    expect(linhas()).toHaveLength(5);
  });

  it('filtrar por área deixa só essa área', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.selectOptions(selectArea(), 'Família');
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('a lista de áreas tem as sete áreas do escritório', async () => {
    await montarClientes({ clientes: gente });
    for (const a of ['Família', 'Cível', 'Trabalhista', 'Empresarial', 'Nacionalidade', 'Administrativo', 'Criminal']) {
      expect(within(selectArea()).getByRole('option', { name: a })).toBeInTheDocument();
    }
  });

  it('voltar a "Todas as áreas" devolve a lista toda', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.selectOptions(selectArea(), 'Cível');
    await waitFor(() => expect(linhas()).toHaveLength(2));
    await utilizador.selectOptions(selectArea(), 'all');
    await waitFor(() => expect(linhas()).toHaveLength(5));
  });

  it('filtrar por Portugal esconde os clientes brasileiros', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('PT'));
    await waitFor(() => expect(linhas()).toHaveLength(3));
  });

  it('filtrar por Brasil deixa só os brasileiros', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('TODOS devolve os dois países', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(linhas()).toHaveLength(2));
    await utilizador.click(botao('TODOS'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
  });

  it('a situação PRO BONO deixa só quem não paga', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('PRO BONO'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
    expect(colunaNomes()[0]).toContain('Rui Dias');
  });

  it('a situação OFICIOSO deixa só quem aguarda trânsito', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('OFICIOSO'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
    expect(colunaNomes()[0]).toContain('Vera Lima');
  });

  it('a situação QUITADO deixa quem já não tem parcelas', async () => {
    const { utilizador } = await montarClientes({
      clientes: gente,
      pendentes: [parcela({ client_id: 'c1' })],
    });
    await utilizador.click(botao('QUITADO'));
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('a situação ATRASO deixa só os atrasados', async () => {
    const { utilizador } = await montarClientes({
      clientes: gente,
      atrasadas: [parcela({ client_id: 'c2', status: 'late', due_date: emDias(-5) })],
      pendentes: [parcela({ id: 'p9', client_id: 'c1' })],
    });
    await utilizador.click(botao('ATRASO'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
    expect(colunaNomes()[0]).toContain('João Pereira');
  });

  it('a situação A VENCER deixa só quem tem parcela por vencer', async () => {
    const { utilizador } = await montarClientes({
      clientes: gente,
      atrasadas: [parcela({ client_id: 'c2', status: 'late', due_date: emDias(-5) })],
      pendentes: [parcela({ id: 'p9', client_id: 'c1' })],
    });
    await utilizador.click(botao('A VENCER'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
    expect(colunaNomes()[0]).toContain('Maria Silva');
  });

  it('TODAS devolve todas as situações', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('PRO BONO'));
    await waitFor(() => expect(linhas()).toHaveLength(1));
    await utilizador.click(botao('TODAS'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
  });

  it('área e país combinam-se', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.selectOptions(selectArea(), 'Família');
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
    expect(colunaNomes()[0]).toContain('Ana Costa');
  });

  it('pesquisa e país combinam-se', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.type(pesquisaClientes(), 'a');
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(colunaNomes()).toHaveLength(2));
  });

  it('combinação sem resultados mostra a mensagem de vazio', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.selectOptions(selectArea(), 'Criminal');
    await utilizador.click(botao('BR'));
    expect(await screen.findByText('Nenhum cliente encontrado com esses filtros.')).toBeInTheDocument();
  });

  it('sem filtros não há botão de limpar', async () => {
    await montarClientes({ clientes: gente });
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();
  });

  it('com um filtro aparece o botão de limpar', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('BR'));
    expect(await screen.findByRole('button', { name: 'Limpar' })).toBeInTheDocument();
  });

  it('limpar repõe a lista inteira', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.selectOptions(selectArea(), 'Família');
    await utilizador.type(pesquisaClientes(), 'ana');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    await utilizador.click(botao('Limpar'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
  });

  it('limpar esvazia a caixa de pesquisa', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.type(pesquisaClientes(), 'ana');
    await utilizador.click(await screen.findByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(pesquisaClientes()).toHaveValue(''));
  });

  it('limpar desaparece depois de limpar', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(botao('BR'));
    await utilizador.click(await screen.findByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument());
  });

  it('os filtros do URL são respeitados ao abrir', async () => {
    await montarClientes({ clientes: gente }, { caminho: '/admin/clientes?pais=BR&area=Família' });
    expect(colunaNomes()).toHaveLength(1);
    expect(colunaNomes()[0]).toContain('Ana Costa');
  });

  it('a situação do URL é respeitada ao abrir', async () => {
    await montarClientes({ clientes: gente }, { caminho: '/admin/clientes?sit=probono' });
    expect(colunaNomes()[0]).toContain('Rui Dias');
  });

  it('mudar o país escreve-o no URL', async () => {
    const { utilizador } = await montarClientes({ clientes: gente }, { url: true });
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(urlAtual()).toBe('pais=BR'));
  });

  it('sem filtros o URL fica limpo', async () => {
    const { utilizador } = await montarClientes({ clientes: gente }, { url: true });
    await utilizador.click(botao('BR'));
    await waitFor(() => expect(urlAtual()).toBe('pais=BR'));
    await utilizador.click(botao('Limpar'));
    await waitFor(() => expect(urlAtual()).toBe(''));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — ordenação
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — ordenação', () => {
  const gente = [
    cliente({ id: 'c1', name: 'Zeca Nunes' }),
    cliente({ id: 'c2', name: 'Ávila Matos' }),
    cliente({ id: 'c3', name: 'Bruno Alves' }),
  ];
  const comValores = {
    clientes: gente,
    pendentes: [
      parcela({ id: 'p1', client_id: 'c1', amount: 300, due_date: emDias(20) }),
      parcela({ id: 'p2', client_id: 'c2', amount: 100, due_date: emDias(5) }),
      parcela({ id: 'p3', client_id: 'c3', amount: 200, due_date: emDias(12) }),
    ],
  };

  it('a coluna do nome ordena por ordem alfabética portuguesa', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(cabecalho('Cliente'));
    await waitFor(() => expect(colunaNomes()[0]).toContain('Ávila Matos'));
    expect(colunaNomes()[2]).toContain('Zeca Nunes');
  });

  it('clicar outra vez no nome inverte a ordem', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(cabecalho('Cliente'));
    await utilizador.click(cabecalho(/^Cliente/));
    await waitFor(() => expect(colunaNomes()[0]).toContain('Zeca Nunes'));
  });

  it('a coluna ordenada mostra a seta', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(cabecalho('Cliente'));
    expect(txt(cabecalho(/^Cliente/))).toBe('Cliente ▲');
  });

  it('a seta inverte-se ao inverter a ordem', async () => {
    const { utilizador } = await montarClientes({ clientes: gente });
    await utilizador.click(cabecalho('Cliente'));
    await utilizador.click(cabecalho(/^Cliente/));
    expect(txt(cabecalho(/^Cliente/))).toBe('Cliente ▼');
  });

  it('o vencimento é a ordenação de partida', async () => {
    await montarClientes(comValores);
    expect(txt(cabecalho(/^Próx. vencimento/))).toBe('Próx. vencimento ▲');
  });

  it('por omissão a lista vem da parcela mais próxima para a mais distante', async () => {
    await montarClientes(comValores);
    expect(colunaNomes()[0]).toContain('Ávila Matos');
    expect(colunaNomes()[2]).toContain('Zeca Nunes');
  });

  it('clicar no vencimento inverte para a mais distante primeiro', async () => {
    const { utilizador } = await montarClientes(comValores);
    await utilizador.click(cabecalho(/^Próx. vencimento/));
    await waitFor(() => expect(colunaNomes()[0]).toContain('Zeca Nunes'));
  });

  it('os atrasos vêm sempre à frente das parcelas por vencer', async () => {
    await montarClientes({
      clientes: gente,
      pendentes: [parcela({ id: 'p2', client_id: 'c2', due_date: emDias(1) })],
      atrasadas: [parcela({ id: 'p1', client_id: 'c1', status: 'late', due_date: emDias(-2) })],
    });
    expect(colunaNomes()[0]).toContain('Zeca Nunes');
  });

  it('quem não tem parcelas fica no fim da lista', async () => {
    await montarClientes({
      clientes: gente,
      pendentes: [parcela({ id: 'p2', client_id: 'c2', due_date: emDias(5) })],
    });
    expect(colunaNomes()[0]).toContain('Ávila Matos');
  });

  it('a coluna do valor ordena do mais baixo para o mais alto', async () => {
    const { utilizador } = await montarClientes(comValores);
    await utilizador.click(cabecalho('Valor'));
    await waitFor(() => expect(colunaNomes()[0]).toContain('Ávila Matos'));
    expect(colunaNomes()[2]).toContain('Zeca Nunes');
  });

  it('clicar outra vez no valor põe o mais alto à frente', async () => {
    const { utilizador } = await montarClientes(comValores);
    await utilizador.click(cabecalho('Valor'));
    await utilizador.click(cabecalho(/^Valor/));
    await waitFor(() => expect(colunaNomes()[0]).toContain('Zeca Nunes'));
  });

  it('mudar de coluna recomeça na ordem ascendente', async () => {
    const { utilizador } = await montarClientes(comValores);
    await utilizador.click(cabecalho('Cliente'));
    await utilizador.click(cabecalho(/^Cliente/));
    await utilizador.click(cabecalho('Valor'));
    expect(txt(cabecalho(/^Valor/))).toBe('Valor ▲');
  });

  it('só a coluna ativa tem seta', async () => {
    const { utilizador } = await montarClientes(comValores);
    await utilizador.click(cabecalho('Cliente'));
    expect(txt(cabecalho('Valor'))).toBe('Valor');
    expect(txt(cabecalho('Próx. vencimento'))).toBe('Próx. vencimento');
  });

  it('as colunas Área e Estado não são ordenáveis', async () => {
    await montarClientes(comValores);
    expect(txt(cabecalho('Área'))).toBe('Área');
    expect(txt(cabecalho('Estado'))).toBe('Estado');
  });

  it('a ordenação do URL é respeitada ao abrir', async () => {
    await montarClientes({ clientes: gente }, { caminho: '/admin/clientes?sort=name&dir=desc' });
    expect(colunaNomes()[0]).toContain('Zeca Nunes');
  });

  it('ordenar escreve a coluna e o sentido no URL', async () => {
    const { utilizador } = await montarClientes({ clientes: gente }, { url: true });
    await utilizador.click(cabecalho('Cliente'));
    await waitFor(() => expect(urlAtual()).toBe('sort=name'));
    await utilizador.click(cabecalho(/^Cliente/));
    await waitFor(() => expect(urlAtual()).toBe('sort=name&dir=desc'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — navegação
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — navegação', () => {
  it('clicar na linha abre a ficha do cliente', async () => {
    const { utilizador } = await montarClientes({ clientes: [cliente({ id: 'abc-123' })] });
    await utilizador.click(linhas()[0]);
    expect(navegou).toHaveBeenCalledWith('/admin/clientes/abc-123');
  });

  it('cada linha leva à ficha certa', async () => {
    const { utilizador } = await montarClientes({
      clientes: [cliente(), cliente({ id: 'c2', name: 'João Pereira' })],
    });
    await utilizador.click(screen.getByText('João Pereira').closest('tr'));
    expect(navegou).toHaveBeenCalledWith('/admin/clientes/c2');
  });

  it('o botão de novo cliente leva ao cadastro', async () => {
    const { utilizador } = await montarClientes({ clientes: [] });
    await utilizador.click(botao('Novo cliente'));
    expect(navegou).toHaveBeenCalledWith('/admin/clientes/novo');
  });

  it('abrir o ecrã não navega sozinho', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(navegou).not.toHaveBeenCalled();
  });

  it('filtrar não navega para lado nenhum', async () => {
    const { utilizador } = await montarClientes({ clientes: [cliente()] });
    await utilizador.click(botao('BR'));
    expect(navegou).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — contagens e paginação
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — contagens e paginação', () => {
  const muitos = (n) => Array.from({ length: n }, (_, i) => cliente({ id: 'c' + i, name: `Cliente ${pad(i)}` }));

  it('o subtítulo conta os clientes e os planos ativos', async () => {
    await montarClientes({
      clientes: [cliente(), cliente({ id: 'c2', name: 'João' })],
      pendentes: [parcela({ client_id: 'c1' })],
    });
    expect(subtitulo()).toBe('2 clientes · 1 com plano ativo');
  });

  it('um cliente sozinho fica no singular', async () => {
    await montarClientes({ clientes: [cliente()] });
    expect(txt(contador())).toBe('1 cliente');
  });

  it('vários clientes ficam no plural', async () => {
    await montarClientes({ clientes: muitos(3) });
    expect(txt(contador())).toBe('3 clientes');
  });

  it('com filtro o contador mostra quantos de quantos', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(4) });
    await utilizador.type(pesquisaClientes(), 'Cliente 01');
    await waitFor(() => expect(txt(contador())).toBe('1 cliente de 4'));
  });

  it('25 clientes cabem numa página', async () => {
    await montarClientes({ clientes: muitos(25) });
    expect(linhas()).toHaveLength(25);
    expect(screen.queryByRole('button', { name: 'Página seguinte' })).not.toBeInTheDocument();
  });

  it('26 clientes já pedem paginação', async () => {
    await montarClientes({ clientes: muitos(26) });
    expect(linhas()).toHaveLength(25);
    expect(screen.getByRole('button', { name: 'Página seguinte' })).toBeInTheDocument();
  });

  it('a segunda página mostra os restantes', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(30) });
    await utilizador.click(botao('Página seguinte'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
  });

  it('na primeira página não se pode recuar', async () => {
    await montarClientes({ clientes: muitos(30) });
    expect(botao('Página anterior')).toBeDisabled();
  });

  it('na última página não se pode avançar', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(30) });
    await utilizador.click(botao('Página seguinte'));
    await waitFor(() => expect(botao('Página seguinte')).toBeDisabled());
  });

  it('voltar atrás devolve a primeira página cheia', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(30) });
    await utilizador.click(botao('Página seguinte'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
    await utilizador.click(botao('Página anterior'));
    await waitFor(() => expect(linhas()).toHaveLength(25));
  });

  it('a paginação repete o total ao lado dos números', async () => {
    await montarClientes({ clientes: muitos(30) });
    expect(screen.getAllByText('30 clientes').length).toBeGreaterThan(0);
  });

  it('pesquisar volta a pôr a lista na primeira página', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(30) });
    await utilizador.click(botao('Página seguinte'));
    await waitFor(() => expect(linhas()).toHaveLength(5));
    await utilizador.type(pesquisaClientes(), 'Cliente');
    await waitFor(() => expect(linhas()).toHaveLength(25));
  });

  it('as reticências aparecem em listas muito longas', async () => {
    const { utilizador } = await montarClientes({ clientes: muitos(200) });
    await utilizador.click(botao('Página seguinte'));
    expect(await screen.findByText('…')).toBeInTheDocument();
  });

  it('os planos ativos contam-se pelas parcelas em aberto', async () => {
    await montarClientes({
      clientes: [cliente(), cliente({ id: 'c2', name: 'João' }), cliente({ id: 'c3', name: 'Ana' })],
      pendentes: [parcela({ client_id: 'c1' })],
      atrasadas: [parcela({ id: 'p2', client_id: 'c2', status: 'late', due_date: emDias(-1) })],
    });
    expect(subtitulo()).toBe('3 clientes · 2 com plano ativo');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTES — dados estranhos vindos da API
// ═════════════════════════════════════════════════════════════════════════════
describe('Clientes — dados estranhos da API', () => {
  it('cliente sem nome aparece na lista sem rebentar', async () => {
    await montarClientes({ clientes: [cliente({ id: 'x1', name: null, email: 'x@y.pt' })] });
    expect(linhas()).toHaveLength(1);
  });

  // BUG: Clients.jsx:130 — a pesquisa faz c.name.toLowerCase() sem defesa, ao
  // contrário do e-mail, do NIF e dos nomes extra (todos com `|| ''`). Um único
  // cliente sem nome na base de dados faz o ecrã inteiro rebentar assim que a
  // Dra. escreve a primeira letra na pesquisa.
  it.fails('cliente sem nome não devia rebentar a pesquisa', async () => {
    prepararClientes({ clientes: [cliente({ id: 'x2', name: null })] });
    renderizar(<Limite><Clients /></Limite>, { caminho: '/admin/clientes?q=ana' });
    await screen.findByText('ECRA REBENTOU');
    expect(rebentou()).toBe(false);
  });

  // BUG: Clients.jsx:142 — a ordenação por nome chama a.name.localeCompare(...)
  // sem defesa; ordenar por «Cliente» com um registo sem nome deita o ecrã abaixo.
  it.fails('cliente sem nome não devia rebentar a ordenação por nome', async () => {
    prepararClientes({
      clientes: [cliente({ id: 'x4', name: 'Ana' }), cliente({ id: 'x3', name: null }), cliente({ id: 'x5', name: 'Zé' })],
    });
    renderizar(<Limite><Clients /></Limite>, { caminho: '/admin/clientes?sort=name' });
    await screen.findByText('ECRA REBENTOU');
    expect(rebentou()).toBe(false);
  });

  it('cliente sem e-mail nem NIF não trava a pesquisa', async () => {
    const { utilizador } = await montarClientes({
      clientes: [cliente({ id: 'x5', email: null, identification: null }), cliente({ id: 'c2', name: 'Ana' })],
    });
    await utilizador.type(pesquisaClientes(), 'ana');
    await waitFor(() => expect(colunaNomes()).toHaveLength(1));
  });

  it('cliente sem país mostra na mesma o contacto', async () => {
    await montarClientes({ clientes: [cliente({ country: null })] });
    expect(txt(celula(linhas()[0], 0))).toContain('maria@exemplo.pt');
  });

  it('número de pessoas em texto continua a contar', async () => {
    await montarClientes({ clientes: [cliente({ extra_people: '3', extra_names: 'A e B' })] });
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('número de pessoas em texto vazio não inventa distintivo', async () => {
    await montarClientes({ clientes: [cliente({ extra_people: '' })] });
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('valor nulo na parcela aparece como zero', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: null })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 0');
  });

  it('valor em texto numérico continua a ser dinheiro', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: '250.75' })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 250,75');
  });

  // BUG: Clients.jsx:37 — fmtMoney faz Number(a || 0) e não verifica o resultado.
  // Um valor que não seja número (texto do utilizador, campo corrompido) chega ao
  // ecrã como «€ NaN» na coluna do valor.
  it.fails('valor que não é número não devia mostrar € NaN', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: 'a combinar' })] });
    expect(txt(celula(linhas()[0], 3))).not.toContain('NaN');
  });

  it('moeda desconhecida cai no euro', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ amount: 100, currency: 'USD' })] });
    expect(txt(celula(linhas()[0], 3))).toBe('€ 100');
  });

  // BUG: Clients.jsx:38 — fmtDate já devolve «—» quando não há data, mas uma data
  // impossível de ler passa pelo guarda e sai «Invalid Date» (em inglês) na coluna
  // do próximo vencimento.
  it.fails('data ilegível devia aparecer como travessão', async () => {
    await montarClientes({ clientes: [cliente()], pendentes: [parcela({ due_date: '31/02/2026' })] });
    expect(txt(celula(linhas()[0], 2))).toBe('—');
  });

  // BUG: Clients.jsx:53 — com uma data ilegível, daysUntil devolve NaN e o selo de
  // estado sai escrito «NaND ATRASO».
  it.fails('data ilegível não devia inventar o selo NaND ATRASO', async () => {
    await montarClientes({
      clientes: [cliente()],
      atrasadas: [parcela({ status: 'late', due_date: 'ontem' })],
    });
    expect(txt(screen.getByRole('table'))).not.toContain('NaN');
  });

  it('parcela de um cliente que já não existe não cria linhas fantasma', async () => {
    await montarClientes({
      clientes: [cliente()],
      pendentes: [parcela({ id: 'p9', client_id: 'apagado' })],
    });
    expect(linhas()).toHaveLength(1);
  });

  it('plano de tipo desconhecido não parte a listagem', async () => {
    await montarClientes({ clientes: [cliente({ plan_type: 'permuta' })] });
    expect(txt(celula(linhas()[0], 3))).toBe('Quitado');
  });

  it('logótipo do cliente é pedido só quando existe chave', async () => {
    await montarClientes({ clientes: [cliente({ id: 'logo-1', logo_key: 'k/1.png' })] });
    await waitFor(() => expect(api.logoUrl).toHaveBeenCalledWith('logo-1'));
  });

  it('sem chave de logótipo não se pede imagem nenhuma', async () => {
    await montarClientes({ clientes: [cliente({ id: 'logo-2', logo_key: null })] });
    expect(api.logoUrl).not.toHaveBeenCalled();
  });

  it('logótipo que falha deixa ficar as iniciais', async () => {
    api.logoUrl.mockResolvedValue(null);
    await montarClientes({ clientes: [cliente({ id: 'logo-3', name: 'Rita Nunes', logo_key: 'k/3.png' })] });
    expect(await screen.findByText('RN')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — carregamento e erro
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — a carregar', () => {
  it('mostra o esqueleto enquanto espera', () => {
    api.listarParcelas.mockReturnValue(new Promise(() => {}));
    renderizar(<Installments />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('enquanto carrega não mostra os cartões do mês', () => {
    api.listarParcelas.mockReturnValue(new Promise(() => {}));
    renderizar(<Installments />);
    expect(screen.queryByText('Já recebido')).not.toBeInTheDocument();
  });

  it('o esqueleto sai quando as parcelas chegam', async () => {
    await montarParcelas([parcela()]);
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('pede as parcelas uma só vez ao abrir', async () => {
    await montarParcelas([parcela()]);
    expect(api.listarParcelas).toHaveBeenCalledTimes(1);
  });

  it('erro da API aparece escrito no ecrã', async () => {
    api.listarParcelas.mockRejectedValue(new Error('Servidor indisponível'));
    renderizar(<Installments />);
    expect(await screen.findByText('Servidor indisponível')).toBeInTheDocument();
  });

  it('com erro não fica tabela nenhuma no ecrã', async () => {
    api.listarParcelas.mockRejectedValue(new Error('Servidor indisponível'));
    renderizar(<Installments />);
    await screen.findByText('Servidor indisponível');
    expect(temTabela()).toBe(false);
  });

  it('resposta sem a chave installments não rebenta', async () => {
    api.listarParcelas.mockResolvedValue({});
    renderizar(<Installments />);
    expect(await screen.findByRole('heading', { name: 'Parcelas e mensalidades' })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — lista vazia
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — lista vazia', () => {
  it('diz que não há parcelas com estes filtros', async () => {
    await montarParcelas([]);
    expect(screen.getByText('Nenhuma parcela com estes filtros.')).toBeInTheDocument();
  });

  it('não desenha tabela', async () => {
    await montarParcelas([]);
    expect(temTabela()).toBe(false);
  });

  it('o previsto do mês fica a zero e não a NaN', async () => {
    await montarParcelas([]);
    expect(txt(cartao(`Previsto (${rotuloMes()})`))).not.toContain('NaN');
  });

  it('o subtítulo não dá NaN com o mês vazio', async () => {
    await montarParcelas([]);
    expect(subtitulo()).toBe(`${rotuloMes()} · 0 lançamentos · € 0 previstos (EUR)`);
  });

  it('os contadores dos filtros ficam todos a zero', async () => {
    await montarParcelas([]);
    expect(botao('TODAS (0)')).toBeInTheDocument();
    expect(botao('PAGAS (0)')).toBeInTheDocument();
    expect(botao('ATRASADAS (0)')).toBeInTheDocument();
  });

  it('sem atrasos o cartão diz que está tudo em dia', async () => {
    await montarParcelas([]);
    expect(txt(cartao('Em atraso'))).toContain('Sem atrasos');
  });

  it('filtrar até não sobrar nada mostra a mensagem de vazio', async () => {
    const { utilizador } = await montarParcelas([parcela()]);
    await utilizador.click(botao(/^PAGAS/));
    expect(await screen.findByText('Nenhuma parcela com estes filtros.')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — cartões do mês e somas
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — cartões do mês', () => {
  const mes = [
    parcela({ id: 'p1', due_date: noMes(5), amount: 100, status: 'paid' }),
    parcela({ id: 'p2', due_date: noMes(10), amount: 200, status: 'pending' }),
    parcela({ id: 'p3', due_date: noMes(15), amount: 300, status: 'late' }),
  ];

  it('o cartão do previsto tem o nome do mês em português', async () => {
    await montarParcelas(mes);
    expect(screen.getByText(`Previsto (${rotuloMes()})`)).toBeInTheDocument();
  });

  it('o previsto soma tudo o que vence no mês', async () => {
    await montarParcelas(mes);
    await waitFor(() => expect(txt(cartao(`Previsto (${rotuloMes()})`))).toContain('€ 600'));
  });

  it('o já recebido soma só as parcelas pagas', async () => {
    await montarParcelas(mes);
    await waitFor(() => expect(txt(cartao('Já recebido'))).toContain('€ 100'));
  });

  it('o cartão do recebido diz quantas parcelas foram pagas', async () => {
    await montarParcelas(mes);
    expect(txt(cartao('Já recebido'))).toContain('1 parcela paga');
  });

  it('duas pagas ficam no plural', async () => {
    await montarParcelas([...mes, parcela({ id: 'p4', due_date: noMes(7), amount: 50, status: 'paid' })]);
    expect(txt(cartao('Já recebido'))).toContain('2 parcelas pagas');
  });

  it('o cartão a vencer conta as pendentes', async () => {
    await montarParcelas(mes);
    await waitFor(() => expect(txt(cartao('A vencer'))).toMatch(/1Neste mês|1 Neste mês/));
  });

  it('as que vencem hoje contam como a vencer', async () => {
    await montarParcelas([parcela({ id: 'p1', due_date: hojeISO(), status: 'due_today' })]);
    expect(botao('A VENCER (1)')).toBeInTheDocument();
  });

  it('o cartão dos atrasos conta as atrasadas', async () => {
    await montarParcelas(mes);
    expect(txt(cartao('Em atraso'))).toContain('Requer ação');
  });

  it('o subtítulo repete o previsto do mês', async () => {
    await montarParcelas(mes);
    expect(subtitulo()).toBe(`${rotuloMes()} · 3 lançamentos · € 600 previstos (EUR)`);
  });

  it('as parcelas em reais não entram na soma em euros', async () => {
    await montarParcelas([
      parcela({ id: 'p1', due_date: noMes(5), amount: 100 }),
      parcela({ id: 'p2', due_date: noMes(6), amount: 900, currency: 'BRL' }),
    ]);
    expect(subtitulo()).toContain('€ 100 previstos');
  });

  it('mas contam como lançamentos do mês', async () => {
    await montarParcelas([
      parcela({ id: 'p1', due_date: noMes(5), amount: 100 }),
      parcela({ id: 'p2', due_date: noMes(6), amount: 900, currency: 'BRL' }),
    ]);
    expect(subtitulo()).toContain('2 lançamentos');
  });

  it('as parcelas de outros meses não entram nos cartões', async () => {
    await montarParcelas([
      parcela({ id: 'p1', due_date: noMes(5), amount: 100 }),
      parcela({ id: 'p2', due_date: mesVizinho(1, 5), amount: 999 }),
    ]);
    expect(subtitulo()).toContain('1 lançamentos');
    expect(subtitulo()).toContain('€ 100 previstos');
  });

  it('os milhares do previsto aparecem separados por espaço', async () => {
    await montarParcelas([parcela({ due_date: noMes(5), amount: 15000 })]);
    expect(subtitulo()).toContain('€ 15 000 previstos');
  });

  it('os contadores dos filtros batem certo com o mês', async () => {
    await montarParcelas(mes);
    expect(botao('TODAS (3)')).toBeInTheDocument();
    expect(botao('PAGAS (1)')).toBeInTheDocument();
    expect(botao('A VENCER (1)')).toBeInTheDocument();
    expect(botao('ATRASADAS (1)')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — filtro por estado
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — filtro por estado', () => {
  const mes = [
    parcela({ id: 'p1', client_name: 'Paga Silva', due_date: noMes(5), status: 'paid' }),
    parcela({ id: 'p2', client_name: 'Pendente Sousa', due_date: noMes(10), status: 'pending' }),
    parcela({ id: 'p3', client_name: 'Atrasada Costa', due_date: noMes(15), status: 'late' }),
    parcela({ id: 'p4', client_name: 'Hoje Dias', due_date: hojeISO(), status: 'due_today' }),
  ];

  it('começa a mostrar todas as do mês', async () => {
    await montarParcelas(mes);
    expect(linhas()).toHaveLength(4);
  });

  it('PAGAS deixa só as pagas', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^PAGAS/));
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(txt(celula(linhas()[0], 0))).toBe('Paga Silva');
  });

  it('ATRASADAS deixa só as vencidas', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^ATRASADAS/));
    await waitFor(() => expect(txt(celula(linhas()[0], 0))).toBe('Atrasada Costa'));
  });

  it('A VENCER junta as pendentes e as de hoje', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^A VENCER/));
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('A VENCER não traz as pagas', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^A VENCER/));
    await waitFor(() => expect(screen.queryByText('Paga Silva')).not.toBeInTheDocument());
  });

  it('TODAS volta a trazer tudo', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^PAGAS/));
    await waitFor(() => expect(linhas()).toHaveLength(1));
    await utilizador.click(botao(/^TODAS/));
    await waitFor(() => expect(linhas()).toHaveLength(4));
  });

  it('o selo PAGO aparece nas pagas', async () => {
    await montarParcelas([parcela({ status: 'paid' })]);
    expect(screen.getByText('PAGO')).toBeInTheDocument();
  });

  it('o selo VENCIDO aparece nas atrasadas', async () => {
    await montarParcelas([parcela({ status: 'late' })]);
    expect(screen.getByText('VENCIDO')).toBeInTheDocument();
  });

  it('o selo HOJE aparece nas que vencem hoje', async () => {
    await montarParcelas([parcela({ due_date: hojeISO(), status: 'due_today' })]);
    expect(screen.getByText('HOJE')).toBeInTheDocument();
  });

  it('o selo A VENCER aparece nas pendentes', async () => {
    await montarParcelas([parcela({ status: 'pending' })]);
    expect(screen.getByText('A VENCER')).toBeInTheDocument();
  });

  it('estado desconhecido cai no selo A VENCER', async () => {
    await montarParcelas([parcela({ status: 'cancelada' })]);
    expect(screen.getByText('A VENCER')).toBeInTheDocument();
  });

  it('o filtro de estado e a pesquisa combinam-se', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.click(botao(/^A VENCER/));
    await utilizador.type(pesquisaParcelas(), 'Hoje');
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(txt(celula(linhas()[0], 0))).toBe('Hoje Dias');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — pesquisa por cliente
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — pesquisa por cliente', () => {
  const mes = [
    parcela({ id: 'p1', client_id: 'c1', client_name: 'Maria Silva', due_date: noMes(5) }),
    parcela({ id: 'p2', client_id: 'c2', client_name: 'José Ávila', due_date: noMes(10) }),
    parcela({ id: 'p3', client_id: 'c1', client_name: 'Maria Silva', due_date: noMes(20), installment_number: 2 }),
  ];

  it('encontra as parcelas de um cliente', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'maria');
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('ignora maiúsculas', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'MARIA');
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('ignora espaços à volta do que se escreve', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), '  maria  ');
    await waitFor(() => expect(linhas()).toHaveLength(2));
  });

  it('encontra nomes acentuados escritos com acento', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'ávila');
    await waitFor(() => expect(linhas()).toHaveLength(1));
  });

  it('pesquisa sem resultados mostra a mensagem de vazio', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'ninguém');
    expect(await screen.findByText('Nenhuma parcela com estes filtros.')).toBeInTheDocument();
  });

  it('apagar a pesquisa devolve a lista', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'maria');
    await waitFor(() => expect(linhas()).toHaveLength(2));
    await utilizador.clear(pesquisaParcelas());
    await waitFor(() => expect(linhas()).toHaveLength(3));
  });

  it('a pesquisa não mexe nos cartões do mês', async () => {
    const { utilizador } = await montarParcelas(mes);
    await utilizador.type(pesquisaParcelas(), 'maria');
    await waitFor(() => expect(linhas()).toHaveLength(2));
    expect(subtitulo()).toContain('3 lançamentos');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — período
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — filtro por período', () => {
  const varias = [
    parcela({ id: 'p1', client_name: 'Deste Mês', due_date: noMes(15), status: 'pending' }),
    parcela({ id: 'p2', client_name: 'Mês Passado Paga', due_date: mesVizinho(-1, 10), status: 'paid' }),
    parcela({ id: 'p3', client_name: 'Mês Passado Atrasada', due_date: mesVizinho(-1, 20), status: 'late' }),
    parcela({ id: 'p4', client_name: 'Mês Seguinte', due_date: mesVizinho(1, 8), status: 'pending' }),
  ];
  const periodo = () => screen.getByLabelText('Período');

  it('abre no mês corrente', async () => {
    await montarParcelas(varias);
    expect(periodo()).toHaveValue('current');
  });

  it('o mês corrente mostra só as deste mês', async () => {
    await montarParcelas(varias);
    expect(linhas()).toHaveLength(1);
    expect(txt(celula(linhas()[0], 0))).toBe('Deste Mês');
  });

  it('a opção do mês tem o nome do mês por extenso', async () => {
    await montarParcelas(varias);
    expect(within(periodo()).getByRole('option', { name: rotuloMes() })).toBeInTheDocument();
  });

  it('"Todas a vencer" traz também os meses seguintes', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all-future');
    await waitFor(() => expect(screen.getByText('Mês Seguinte')).toBeInTheDocument());
  });

  it('"Todas a vencer" arrasta os atrasos antigos', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all-future');
    await waitFor(() => expect(screen.getByText('Mês Passado Atrasada')).toBeInTheDocument());
  });

  it('"Todas a vencer" deixa para trás o que já foi pago', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all-future');
    await waitFor(() => expect(screen.queryByText('Mês Passado Paga')).not.toBeInTheDocument());
  });

  it('"Todo o histórico" traz tudo', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all');
    await waitFor(() => expect(linhas()).toHaveLength(4));
  });

  it('mudar de período não mexe nos cartões do mês', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all');
    await waitFor(() => expect(linhas()).toHaveLength(4));
    expect(subtitulo()).toContain('1 lançamentos');
  });

  it('voltar ao mês corrente volta a apertar a lista', async () => {
    const { utilizador } = await montarParcelas(varias);
    await utilizador.selectOptions(periodo(), 'all');
    await waitFor(() => expect(linhas()).toHaveLength(4));
    await utilizador.selectOptions(periodo(), 'current');
    await waitFor(() => expect(linhas()).toHaveLength(1));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — a tabela
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — tabela e formatação', () => {
  it('tem as sete colunas do ecrã', async () => {
    await montarParcelas([parcela()]);
    expect(screen.getAllByRole('columnheader').map((c) => txt(c)))
      .toEqual(['Cliente', 'País', 'Parcela', 'Vencimento', 'Valor', 'Estado', 'Lembrete']);
  });

  it('o nome do cliente é um atalho para a ficha', async () => {
    await montarParcelas([parcela({ client_id: 'abc', client_name: 'Maria Silva' })]);
    expect(screen.getByRole('link', { name: 'Maria Silva' })).toHaveAttribute('href', '/admin/clientes/abc');
  });

  it('mostra o país do cliente', async () => {
    await montarParcelas([parcela({ client_country: 'BR' })]);
    expect(txt(celula(linhas()[0], 1))).toBe('BR');
  });

  it('mostra a parcela em forma de fração', async () => {
    await montarParcelas([parcela({ installment_number: 2, total_installments: 6 })]);
    expect(txt(celula(linhas()[0], 2))).toBe('2/6');
  });

  it('o vencimento aparece em dia/mês', async () => {
    await montarParcelas([parcela({ due_date: noMes(9) })]);
    expect(txt(celula(linhas()[0], 3))).toBe(`09/${hojeISO().slice(5, 7)}`);
  });

  it('o valor em euros leva o símbolo €', async () => {
    await montarParcelas([parcela({ amount: 200 })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 200');
  });

  it('o valor em reais leva o símbolo R$', async () => {
    await montarParcelas([parcela({ amount: 750, currency: 'BRL' })]);
    expect(txt(celula(linhas()[0], 4))).toBe('R$ 750');
  });

  it('os milhares aparecem separados por espaço', async () => {
    await montarParcelas([parcela({ amount: 25000 })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 25 000');
  });

  it('a tabela arredonda os cêntimos', async () => {
    await montarParcelas([parcela({ amount: 250.5 })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 251');
  });

  it('as parcelas saem por ordem de vencimento', async () => {
    await montarParcelas([
      parcela({ id: 'p1', client_name: 'Terceira', due_date: noMes(20) }),
      parcela({ id: 'p2', client_name: 'Primeira', due_date: noMes(3) }),
      parcela({ id: 'p3', client_name: 'Segunda', due_date: noMes(11) }),
    ]);
    expect(linhas().map((tr) => txt(celula(tr, 0)))).toEqual(['Primeira', 'Segunda', 'Terceira']);
  });

  it('aguenta uma lista longa de parcelas', async () => {
    const muitas = Array.from({ length: 40 }, (_, i) => parcela({ id: 'p' + i, due_date: noMes((i % 28) + 1) }));
    await montarParcelas(muitas);
    expect(linhas()).toHaveLength(40);
  });

  it('as parcelas pagas não têm botão de lembrete', async () => {
    await montarParcelas([parcela({ status: 'paid' })]);
    expect(screen.queryByRole('button', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('as parcelas por pagar têm botão de lembrete', async () => {
    await montarParcelas([parcela({ status: 'pending' })]);
    expect(screen.getByRole('button', { name: /WhatsApp/ })).toBeInTheDocument();
  });

  it('as atrasadas também têm botão de lembrete', async () => {
    await montarParcelas([parcela({ status: 'late' })]);
    expect(screen.getByRole('button', { name: /WhatsApp/ })).toBeInTheDocument();
  });

  it('lembrete já enviado mostra a data e a hora', async () => {
    await montarParcelas([parcela({ wa_sent_at: `${noMes(2)}T09:05:00Z` })]);
    expect(txt(screen.getByRole('button', { name: /WhatsApp/ }))).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — lembrete por WhatsApp
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — lembrete por WhatsApp', () => {
  const abrir = async (over = {}) => {
    const r = await montarParcelas([parcela(over)], { extras: true });
    await r.utilizador.click(screen.getByRole('button', { name: /WhatsApp/ }));
    await screen.findByRole('heading', { name: /Enviar WhatsApp/ });
    return r;
  };
  // o cartão do modal é o pai do título — evita apanhar a pesquisa da página
  const modal = () => screen.getByRole('heading', { name: /Enviar WhatsApp/ }).parentElement;
  const texto = () => within(modal()).getByRole('textbox');

  it('o botão abre o modal com o nome do cliente', async () => {
    await abrir({ client_name: 'Maria Silva' });
    expect(screen.getByRole('heading', { name: 'Enviar WhatsApp — Maria Silva' })).toBeInTheDocument();
  });

  it('o modal resume a parcela, o valor e o vencimento', async () => {
    await abrir({ installment_number: 2, total_installments: 4, amount: 300, due_date: noMes(12) });
    expect(screen.getByText(/Parcela 2\/4/)).toBeInTheDocument();
  });

  it('o modal mostra o vencimento por extenso', async () => {
    await abrir({ due_date: noMes(12) });
    const dia = `12/${hojeISO().slice(5, 7)}/${hojeISO().slice(0, 4)}`;
    expect(within(modal()).getByText(new RegExp(`vence a ${dia}`), { selector: 'div' })).toBeInTheDocument();
  });

  it('a mensagem trata o cliente pelo primeiro nome', async () => {
    await abrir({ client_name: 'Maria Silva Santos' });
    expect(texto().value.startsWith('Olá Maria,')).toBe(true);
  });

  it('a mensagem de uma parcela por vencer fala em lembrar', async () => {
    await abrir({ status: 'pending' });
    expect(texto().value).toContain('Passo apenas para lembrar');
  });

  it('a mensagem de uma parcela atrasada fala em já ter vencido', async () => {
    await abrir({ status: 'late' });
    expect(texto().value).toContain('ainda não consta como paga');
  });

  it('a mensagem assina como a Dra.', async () => {
    await abrir();
    expect(texto().value).toContain('Dra. Vyvian Avena — Advogada');
  });

  it('a mensagem leva o valor formatado', async () => {
    await abrir({ amount: 350 });
    expect(norm(texto().value)).toContain('€ 350');
  });

  it('a mensagem em reais leva R$', async () => {
    await abrir({ amount: 900, currency: 'BRL' });
    expect(norm(texto().value)).toContain('R$ 900');
  });

  it('a mensagem pode ser reescrita', async () => {
    const { utilizador } = await abrir();
    await utilizador.clear(texto());
    await utilizador.type(texto(), 'Bom dia!');
    expect(texto()).toHaveValue('Bom dia!');
  });

  it('o link do WhatsApp leva o número sem símbolos', async () => {
    await abrir({ client_phone: '+351 911 222 333' });
    expect(screen.getByRole('link', { name: /Abrir no WhatsApp/ }).getAttribute('href'))
      .toContain('https://wa.me/351911222333');
  });

  it('o link leva a mensagem já escrita', async () => {
    await abrir({ client_name: 'Maria Silva' });
    expect(decodeURIComponent(screen.getByRole('link', { name: /Abrir no WhatsApp/ }).getAttribute('href')))
      .toContain('Olá Maria');
  });

  it('cliente sem telefone é avisado no modal', async () => {
    await abrir({ client_phone: null });
    expect(screen.getByText(/não tem telefone registado/)).toBeInTheDocument();
  });

  it('cliente sem telefone não deixa abrir o WhatsApp', async () => {
    await abrir({ client_phone: null });
    expect(screen.getByRole('button', { name: /Abrir no WhatsApp/ })).toBeDisabled();
  });

  it('cliente sem telefone tem atalho para a ficha', async () => {
    await abrir({ client_phone: null, client_id: 'c9' });
    expect(screen.getByRole('link', { name: /Abrir a ficha/ })).toHaveAttribute('href', '/admin/clientes/c9');
  });

  it('cancelar fecha o modal', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(botao('Cancelar'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Enviar WhatsApp/ })).not.toBeInTheDocument());
  });

  it('abrir o WhatsApp regista o envio na parcela', async () => {
    const { utilizador } = await abrir({ id: 'p7' });
    await utilizador.click(screen.getByRole('link', { name: /Abrir no WhatsApp/ }));
    await waitFor(() => expect(api.atualizarParcela).toHaveBeenCalledWith('p7', expect.objectContaining({ wa_sent_at: expect.any(String) })));
  });

  it('abrir o WhatsApp avisa a Dra. com um toast', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('link', { name: /Abrir no WhatsApp/ }));
    expect(await screen.findByText('Envio por WhatsApp registado')).toBeInTheDocument();
  });

  it('registar o envio fecha o modal', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('link', { name: /Abrir no WhatsApp/ }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Enviar WhatsApp/ })).not.toBeInTheDocument());
  });

  it('se o registo falhar no servidor o ecrã não rebenta', async () => {
    api.atualizarParcela.mockRejectedValue(new Error('rede'));
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('link', { name: /Abrir no WhatsApp/ }));
    expect(await screen.findByText('Envio por WhatsApp registado')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — exportar CSV
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — exportar CSV', () => {
  function espiarAncora() {
    const criadas = [];
    const original = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, opts) => {
      const el = original(tag, opts);
      if (String(tag).toLowerCase() === 'a') el.click = () => criadas.push(el);
      return el;
    });
    return { criadas, restaurar: () => spy.mockRestore() };
  }

  it('há um botão para exportar', async () => {
    await montarParcelas([parcela()]);
    expect(botao(/Exportar CSV/)).toBeInTheDocument();
  });

  it('exportar gera um ficheiro para descarregar', async () => {
    const a = espiarAncora();
    const { utilizador } = await montarParcelas([parcela()]);
    await utilizador.click(botao(/Exportar CSV/));
    expect(a.criadas).toHaveLength(1);
    a.restaurar();
  });

  it('o ficheiro tem nome com o mês', async () => {
    const a = espiarAncora();
    const { utilizador } = await montarParcelas([parcela()]);
    await utilizador.click(botao(/Exportar CSV/));
    expect(a.criadas[0].download).toMatch(/^parcelas-\d{4}-\d{2}\.csv$/);
    a.restaurar();
  });

  it('o conteúdo é um CSV com cabeçalho', async () => {
    const a = espiarAncora();
    const { utilizador } = await montarParcelas([parcela({ client_name: 'Maria Silva' })]);
    await utilizador.click(botao(/Exportar CSV/));
    const texto = await blobsCriados[blobsCriados.length - 1].text();
    expect(texto.split('\n')[0]).toBe('Cliente;Parcela;Vencimento;Valor;Moeda;Estado');
    a.restaurar();
  });

  it('o CSV leva as linhas que estão filtradas', async () => {
    const a = espiarAncora();
    const { utilizador } = await montarParcelas([
      parcela({ id: 'p1', client_name: 'Maria Silva', due_date: noMes(5), status: 'paid' }),
      parcela({ id: 'p2', client_name: 'João Pereira', due_date: noMes(6), status: 'pending' }),
    ]);
    await utilizador.click(botao(/^PAGAS/));
    await waitFor(() => expect(linhas()).toHaveLength(1));
    await utilizador.click(botao(/Exportar CSV/));
    const texto = await blobsCriados[blobsCriados.length - 1].text();
    expect(texto).toContain('Maria Silva');
    expect(texto).not.toContain('João Pereira');
    a.restaurar();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — marcar como paga
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — marcar como paga', () => {
  // BUG: Installments.jsx:110-123 — o handleMarkPaid (com confirmação, chamada a
  // installmentsApi.markPaid e recarregamento) continua no ficheiro, mas nenhum
  // botão o chama: o redesign v3 deixou a coluna «Lembrete» no lugar da acção.
  // Neste ecrã já não há forma de marcar uma parcela como paga — a Dra. tem de
  // entrar na ficha do cliente. O estado markingPaid também nunca é lido.
  it.fails('devia haver forma de marcar uma parcela como paga na listagem', async () => {
    await montarParcelas([parcela({ status: 'late' })], { extras: true });
    // dentro da linha da parcela — os filtros lá em cima também dizem «PAGAS»
    expect(within(linhas()[0]).getByRole('button', { name: /pag/i })).toBeInTheDocument();
  });

  it('nenhuma parcela é marcada como paga só por abrir o ecrã', async () => {
    await montarParcelas([parcela({ status: 'late' })], { extras: true });
    expect(api.marcarPaga).not.toHaveBeenCalled();
  });

  // A operação inversa (desmarcar) também não existe aqui: vive na ficha do
  // cliente (ClientDetail.jsx:510, handleUnmarkPaid).
  it('uma parcela paga não oferece forma de desmarcar', async () => {
    await montarParcelas([parcela({ status: 'paid' })], { extras: true });
    expect(screen.queryByRole('button', { name: /desmarcar/i })).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARCELAS — dados estranhos vindos da API
// ═════════════════════════════════════════════════════════════════════════════
describe('Parcelas — dados estranhos da API', () => {
  // BUG: Installments.jsx:134 e 145 — i.due_date.slice(0,7) sem defesa. Uma única
  // parcela sem data de vencimento (criada à mão, importada, ou com a coluna a
  // null) deita abaixo o ecrã inteiro, mesmo antes de qualquer filtro.
  it.fails('parcela sem data de vencimento não devia rebentar o ecrã', async () => {
    api.listarParcelas.mockResolvedValue({ installments: [parcela({ due_date: null })] });
    renderizar(<Limite><Installments /></Limite>);
    await screen.findByText('ECRA REBENTOU');
    expect(rebentou()).toBe(false);
  });

  it('parcela sem cliente associado continua a aparecer', async () => {
    await montarParcelas([parcela({ client_name: null, client_id: null })]);
    expect(linhas()).toHaveLength(1);
  });

  it('parcela sem cliente não trava a pesquisa', async () => {
    const { utilizador } = await montarParcelas([
      parcela({ id: 'p1', client_name: null }),
      parcela({ id: 'p2', client_name: 'Maria Silva', due_date: noMes(12) }),
    ]);
    await utilizador.type(pesquisaParcelas(), 'maria');
    await waitFor(() => expect(linhas()).toHaveLength(1));
  });

  it('parcela sem cliente deixa a coluna do país vazia', async () => {
    await montarParcelas([parcela({ client_name: null, client_country: null })]);
    expect(txt(celula(linhas()[0], 1))).toBe('');
  });

  it('valor nulo aparece como zero', async () => {
    await montarParcelas([parcela({ amount: null })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 0');
  });

  it('valor em texto numérico continua a ser dinheiro', async () => {
    await montarParcelas([parcela({ amount: '340' })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 340');
  });

  // BUG: Installments.jsx:37 — fmtMoney faz Number(amount || 0) e devolve NaN para
  // texto não numérico; a coluna do valor mostra «€ NaN» à Dra.
  it.fails('valor que não é número não devia mostrar € NaN', async () => {
    await montarParcelas([parcela({ amount: 'a combinar' })]);
    expect(txt(celula(linhas()[0], 4))).not.toContain('NaN');
  });

  // BUG: Installments.jsx:155 — o somatório do mês usa Number(i.amount) sem defesa
  // (ao contrário do fmtMoney, que trata o vazio como zero). Uma parcela sem valor
  // faz o cartão «Previsto» mostrar NaN, enquanto o subtítulo mostra € 0.
  it.fails('parcela sem valor não devia dar NaN no cartão do previsto', async () => {
    await montarParcelas([parcela({ amount: undefined, due_date: noMes(5) })]);
    const cartaoPrevisto = cartao(`Previsto (${rotuloMes()})`);
    await waitFor(() => expect(txt(cartaoPrevisto)).toContain('NaN'));
    expect(txt(cartaoPrevisto)).not.toContain('NaN');
  });

  // BUG: Installments.jsx:18-21 — fmtDate não valida a data e a coluna do
  // vencimento mostra «Invalid Date» em inglês.
  it.fails('data ilegível não devia aparecer como Invalid Date', async () => {
    await montarParcelas([parcela({ due_date: `${hojeISO().slice(0, 7)}-99` })]);
    expect(txt(celula(linhas()[0], 3))).not.toContain('Invalid');
  });

  it('número de parcela em falta não rebenta a linha', async () => {
    await montarParcelas([parcela({ installment_number: null, total_installments: null })]);
    expect(linhas()).toHaveLength(1);
  });

  it('moeda desconhecida cai no euro', async () => {
    await montarParcelas([parcela({ amount: 100, currency: 'USD' })]);
    expect(txt(celula(linhas()[0], 4))).toBe('€ 100');
  });

  it('lista com uma só parcela dá contadores coerentes', async () => {
    await montarParcelas([parcela({ due_date: noMes(5), amount: 120, status: 'paid' })]);
    expect(subtitulo()).toBe(`${rotuloMes()} · 1 lançamentos · € 120 previstos (EUR)`);
  });
});
