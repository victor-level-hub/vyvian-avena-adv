// @vitest-environment jsdom
// tests/admin/paineis.test.jsx
// Os cinco painéis de leitura da Área Privada: Painel, Redes Sociais
// (Instagram/Site), Engajamento, Calendário e Notificações.
//
// O fio condutor destes ecrãs é UM SÓ: nunca mostrar um número errado à Dra.
// Por isso, além do comportamento visível (períodos, listas, modais, CRUD), há
// um crivo que percorre o texto todo do ecrã e falha se encontrar `NaN`,
// `undefined`, `Infinity` ou `-0` — o caso mais provável é a base vazia, em que
// todas as divisões passam a ser por zero.
//
// Gráficos não se testam por píxeis: testam-se os DADOS que lhes chegam (séries,
// legendas, eixos, notas de série curta) e os números que os acompanham.
//
// A rede está fechada (tests/setup.js) — o apiClient vive mockado.
// Defeitos reais ficam marcados com `it.fails` + comentário `// BUG:`.
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderizar, screen, within, waitFor, fireEvent, configure } from '../helpers/dom.jsx';

// a suíte corre com dezenas de ficheiros de worker em paralelo; sob carga o
// jsdom fica lento e 1 s por omissão não chega para os findBy/waitFor
configure({ asyncUtilTimeout: 4000 });

// ─────────────────────────── API mockada (rede fechada) ──────────────────────
vi.mock('../../src/admin/apiClient.js', () => {
  const fn = () => vi.fn();
  return {
    dashboard: { get: fn() },
    stats: {
      site: fn(), instagram: fn(), engagement: fn(), engagementSync: fn(),
      campaignHistory: fn(), campaignEndSet: fn(),
    },
    calendar: {
      getAll: fn(), createEvent: fn(), updateEvent: fn(), deleteEvent: fn(),
      createType: fn(), updateType: fn(), deleteType: fn(),
    },
    installments: {
      list: fn(), create: fn(), upcoming: fn(), get: fn(), markPaid: fn(), update: fn(), remove: fn(),
    },
    notifications: {
      getOwnerPrefs: fn(), updateOwnerPrefs: fn(), listTemplates: fn(), getTemplate: fn(),
      updateTemplate: fn(), listRules: fn(), createRule: fn(), updateRule: fn(), removeRule: fn(), listLog: fn(),
    },
    insights: {
      topics: fn(), refresh: fn(), freeArticles: fn(), generateArticle: fn(), generateFromTheme: fn(),
      getArticle: fn(), saveArticle: fn(), deleteArticle: fn(), previaLink: fn(), aiCorrect: fn(),
      generateImages: fn(), chooseImage: fn(), imageUrl: fn(), imageBlob: fn(), replaceImage: fn(),
      imageBank: fn(), saveToBank: fn(), removeFromBank: fn(), adoptFromBank: fn(), discardImage: fn(),
      keywords: fn(), evaluateArticle: fn(), generateAudio: fn(), setReviewed: fn(), publishArticle: fn(),
      audioUrl: fn(), insertImages: fn(), imageRules: fn(), addImageRule: fn(), removeImageRule: fn(),
      sources: fn(), addSource: fn(), updateSource: fn(), removeSource: fn(),
    },
    auth: { login: fn(), logout: fn(), me: fn() },
    clients: { list: fn(), get: fn(), create: fn(), update: fn(), remove: fn() },
    getToken: () => 'tok', setToken: vi.fn(), clearToken: vi.fn(),
  };
});

import {
  dashboard as dashboardApi,
  stats as statsApi,
  calendar as calendarApi,
  installments as installmentsApi,
  notifications as notifApi,
  insights as insightsApi,
} from '../../src/admin/apiClient.js';

import Dashboard from '../../src/admin/pages/Dashboard.jsx';
import Statistics from '../../src/admin/pages/Statistics.jsx';
import EngagementSection from '../../src/admin/pages/Engagement.jsx';
import CalendarPage from '../../src/admin/pages/Calendar.jsx';
import Notifications from '../../src/admin/pages/Notifications.jsx';
import { DialogHost } from '../../src/admin/dialogs.jsx';
import { ToastHost } from '../../src/admin/toasts.jsx';

/* ═══════════════ ambiente que o jsdom não tem ═══════════════ */

class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ isIntersecting: true }]); }   // revela já (Reveal/Ticker)
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// O Ticker anima o número com requestAnimationFrame ao longo de 1200 ms. Um
// relógio que salta 3 s por quadro faz a animação terminar dentro do próprio
// efeito — o ecrã mostra o valor final e não um número a meio da contagem.
let relogioRaf = 0;

// Atribuição direta em vez de vi.stubGlobal de propósito: um componente ainda
// por desmontar pode correr um efeito depois do teste acabar, e um
// `unstubAllGlobals` a meio deixava o IntersectionObserver por definir.
function prepararAmbiente() {
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
  globalThis.requestAnimationFrame = (cb) => { relogioRaf += 3000; cb(relogioRaf); return relogioRaf; };
  globalThis.cancelAnimationFrame = () => {};
}

beforeAll(() => {
  Element.prototype.scrollIntoView = function () {};
  prepararAmbiente();
});

/* ═══════════════ utilitários ═══════════════ */
// Os KPIs sao desenhados por <Ticker>, que anima o numero. Esperar so pelo <h1>
// deixava a asserçao correr antes de o React ter pintado o valor final: com 36
// ficheiros em paralelo isso falhava de vez em quando, sempre num teste diferente.
// Aqui esperamos que o texto do ecra deixe de mudar entre duas leituras.
async function ecraEstavel() {
  let anterior = null;
  await waitFor(() => {
    const agora = document.body.textContent;
    const estavel = anterior !== null && agora === anterior;
    anterior = agora;
    if (!estavel) throw new Error('ecra ainda a atualizar');
  });
}



// pt-PT separa os milhares com espaço inseparável e alguns formatos usam o
// espaço estreito — comparar com espaço normal falharia com strings idênticas.
const norm = (s) => String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

// ── o crivo: números podres no texto visível ──────────────────────────────
// Com a base sem dados nenhum KPI pode mostrar NaN/undefined/Infinity/-0. O
// `-0` só se apanha isolado: em '2026-08' o '-0' faz parte de uma data.
const PODRES = [
  ['NaN', /NaN/],
  ['undefined', /undefined/],
  ['Infinity', /Infinity/],
  ['-0', /(?:^|[^\w.,-])-0(?![\d.,])/],
];
function numerosPodres(raiz) {
  const texto = norm((raiz || document.body).textContent);
  return PODRES.filter(([, re]) => re.test(texto)).map(([nome]) => nome);
}
const semPodres = (raiz) => expect(numerosPodres(raiz)).toEqual([]);

const texto = (raiz) => norm((raiz || document.body).textContent);
const contem = (raiz, s) => texto(raiz).includes(norm(s));

// emojis coloridos — a regra do projeto é UI só com glifos/SVGs monocromáticos
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// ── datas relativas ao dia real (sem relógios falsos, que partem o userEvent) ──
const HOJE = new Date(); HOJE.setHours(0, 0, 0, 0);
const p2 = (n) => String(n).padStart(2, '0');
const chave = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const maisDias = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return chave(d); };
const ANO = HOJE.getFullYear();
const MES = HOJE.getMonth();
const noMes = (dia) => `${ANO}-${p2(MES + 1)}-${p2(dia)}`;
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_NO_MES = new Date(ANO, MES + 1, 0).getDate();

// ── navegação no DOM (nunca para asserções: só para encontrar o cartão certo) ──
function cartao(rotulo, seletor = '.glass') {
  for (const no of screen.getAllByText(rotulo)) {
    const c = no.closest(seletor);
    if (c) return c;
  }
  throw new Error(`Cartão "${rotulo}" não encontrado (${seletor}).`);
}
const painelDe = (titulo) => screen.getByRole('heading', { name: titulo }).closest('.glass');

/* ═══════════════ fixtures ═══════════════ */

const parcela = (over = {}) => ({
  id: 'i1', client_id: 'c1', client_name: 'Maria Silva',
  installment_number: 1, total_installments: 3,
  amount: 400, currency: 'EUR', due_date: maisDias(5), status: 'pending', ...over,
});

const painel = (over = {}) => ({
  counts: { active_clients: 12, pending: 7, due_today: 2, late: 3, paid_last_30d: 9 },
  upcoming_revenue: [{ currency: 'EUR', total: 4200 }],
  upcoming: [parcela()],
  alerts: [],
  ...over,
});

const painelVazio = () => ({
  counts: { active_clients: 0, pending: 0, due_today: 0, late: 0, paid_last_30d: 0 },
  upcoming_revenue: [],
  upcoming: [],
  alerts: [],
});

const igSerie = (n = 5, base = 200) => Array.from({ length: n }, (_, i) => {
  const k = maisDias(-(n - 1 - i));
  return { key: k, label: k.slice(8, 10) + '/' + k.slice(5, 7), followers: base + i * 3 };
});

const igPost = (over = {}) => ({
  id: 'p1', caption: 'Nacionalidade portuguesa: o que mudou',
  media_type: 'IMAGE', permalink: 'https://instagram.com/p/1',
  timestamp: '2026-07-28T10:00:00+0000', like_count: 40, comments_count: 6, thumb_url: null, ...over,
});

const instagram = (over = {}) => ({
  range: '30d', period_days: 30, since: maisDias(-29),
  followers_count: 214, media_count: 48, new_followers: 12,
  series: igSerie(5, 200), posts: [igPost(), igPost({ id: 'p2', like_count: 20, comments_count: 1 })],
  updated_at: '2026-08-02 04:10:00', has_data: true, ...over,
});

const instagramVazio = () => ({
  range: '30d', period_days: 30, since: maisDias(-29),
  followers_count: null, media_count: null, new_followers: null,
  series: [], posts: [], updated_at: null, has_data: false,
});

const siteSerie = (n, valores) => Array.from({ length: n }, (_, i) => {
  const k = maisDias(-(n - 1 - i));
  return { key: k, label: k.slice(8, 10) + '/' + k.slice(5, 7), views: valores[i] ?? 0, visitors: Math.ceil((valores[i] ?? 0) / 2) };
});

const site = (over = {}) => ({
  range: '7d', granularity: 'day',
  series: siteSerie(7, [10, 20, 30, 25, 40, 15, 20]),
  total_views: 160, total_visitors: 80, prev_total_views: 80, tz: 'UTC', ...over,
});

const siteVazio = () => ({
  range: '7d', granularity: 'day',
  series: siteSerie(7, [0, 0, 0, 0, 0, 0, 0]),
  total_views: 0, total_visitors: 0, prev_total_views: 0, tz: 'UTC',
});

const engPost = (over = {}) => ({
  id: 'e1', caption: 'Como pedir a nacionalidade', format: 'Reel',
  permalink: 'https://instagram.com/p/e1', timestamp: '2026-07-28T10:00:00+0000', thumb_url: null,
  likes: 80, comments: 12, saved: 20, shares: 8, reach: 1000, views: 1800,
  profile_visits: 15, follows: 3, avg_watch_time: 65000,
  interactions: 120, rate: 12, has_insights: true, ...over,
});

const engIg = (over = {}) => ({
  connected: true, handle: '@vyvianavenaadv', has_data: true, has_daily: true,
  days_collected: 3, updated_at: '2026-08-02 04:10:00',
  followers_count: 214, media_count: 48,
  totals: {
    reach: 1000, views: 1800, accounts_engaged: 150, total_interactions: 200,
    likes: 120, comments: 30, saves: 35, shares: 10, replies: 5, profile_links_taps: 4,
  },
  prev_totals: {
    reach: 800, views: 1200, accounts_engaged: 120, total_interactions: 100,
    likes: 60, comments: 20, saves: 15, shares: 5, replies: 0, profile_links_taps: 2,
  },
  engagement_rate: 20,
  series: [
    { key: maisDias(-2), label: '01/08', reach: 300, views: 500, interactions: 60, accounts_engaged: 40 },
    { key: maisDias(-1), label: '02/08', reach: 350, views: 600, interactions: 70, accounts_engaged: 55 },
    { key: maisDias(0), label: '03/08', reach: 350, views: 700, interactions: 70, accounts_engaged: 55 },
  ],
  posts: [engPost()],
  ranking: [engPost(), engPost({ id: 'e2', caption: 'Álbum do escritório', format: 'Álbum', interactions: 40, reach: 400, saved: 4, shares: 1, rate: 10 })],
  best: engPost(),
  by_format: [
    { format: 'Reel', posts: 2, interactions: 240, avg_interactions: 120, reach: 2000, rate: 12 },
    { format: 'Álbum', posts: 1, interactions: 40, avg_interactions: 40, reach: 400, rate: 10 },
  ],
  by_weekday: [
    { day: 'terça', posts: 2, interactions: 240, avg: 120 },
    { day: 'sexta', posts: 1, interactions: 40, avg: 40 },
  ],
  demographics: {
    follower_country: [{ bucket: 'BR', value: 120 }, { bucket: 'PT', value: 60 }],
    follower_gender: [{ bucket: 'F', value: 150 }, { bucket: 'M', value: 30 }],
  },
  demographics_day: '2026-08-01',
  ...over,
});

const engajamento = (over = {}) => ({
  range: '30d', period_days: 30, since: maisDias(-29),
  platforms: {
    instagram: engIg(over.instagram || {}),
    facebook: {
      connected: false, page: 'Vyvian Avena Advogada',
      reason: 'A ligação atual é só do Instagram. As métricas da Página do Facebook precisam de um token de Página.',
    },
  },
});

const engajamentoVazio = () => ({
  range: '30d', period_days: 30, since: maisDias(-29),
  platforms: {
    instagram: {
      connected: true, handle: '@vyvianavenaadv', has_data: false, has_daily: false,
      days_collected: 0, updated_at: null, followers_count: null, media_count: null,
      totals: { reach: null, views: null, accounts_engaged: null, total_interactions: null, likes: null, comments: null, saves: null, shares: null, replies: null, profile_links_taps: null },
      prev_totals: { reach: null, views: null, accounts_engaged: null, total_interactions: null },
      engagement_rate: null, series: [], posts: [], ranking: [], best: null,
      by_format: [], by_weekday: [], demographics: {}, demographics_day: null,
    },
    facebook: { connected: false, page: 'Vyvian Avena Advogada', reason: 'A ligação atual é só do Instagram.' },
  },
});

const TIPOS = [
  { id: 'evento_pessoal', label: 'Eventos pessoais', color: '#8E7CC3', description: 'Compromissos pessoais.', is_visible: 1, is_default: 1 },
  { id: 'financeiro', label: 'Financeiro', color: '#4F8A67', description: 'Vencimentos e pagamentos.', is_visible: 1, is_default: 1 },
  { id: 'processo', label: 'Prazos processuais', color: '#B35C5C', description: 'Prazos do tribunal.', is_visible: 1, is_default: 1 },
  { id: 'cliente', label: 'Reuniões com clientes', color: '#59788E', description: null, is_visible: 1, is_default: 1 },
  { id: 'feriado_nacional', label: 'Feriados nacionais', color: '#8B6F47', description: 'Feriados nacionais de Portugal.', is_visible: 1, is_default: 1 },
  { id: 'conservatoria', label: 'Conservatória', color: '#59788E', description: 'Marcações na conservatória.', is_visible: 1, is_default: 0 },
];

const evento = (over = {}) => ({
  id: 'ev1', title: 'Audiência de julgamento', description: 'Tribunal de Lisboa, sala 3.',
  type_id: 'processo', start_date: noMes(10), end_date: null, is_all_day: 1,
  amount: 0, currency: 'EUR', status: 'none',
  client_name: 'Maria Silva', case_reference: '1289/26', source: 'manual', ...over,
});

const feriado = () => evento({
  id: 'fer1', title: 'Feriado de teste', description: 'Feriado nacional.',
  type_id: 'feriado_nacional', start_date: noMes(15), client_name: null, case_reference: null, source: 'system',
});

const calendario = (over = {}) => ({ types: TIPOS, events: [evento()], ...over });

const prefs = (over = {}) => ({
  prefs: [
    { alert_type: 'vence_hoje', email_enabled: 1, whatsapp_enabled: 0 },
    { alert_type: 'em_atraso', email_enabled: 0, whatsapp_enabled: 0 },
  ],
  contacts: { email: 'vyavena@gmail.com', whatsapp: '351911831530' },
  log: [],
  ...over,
});

const modelos = (over = {}) => ({
  templates: [
    {
      id: 't1', name: 'Lembrete de vencimento', channel: 'email', language: 'pt-PT',
      subject: 'Lembrete: {{cliente}}', body: 'Olá {{cliente}}, a parcela de {{valor}} vence a {{data}}.',
    },
  ],
  ...over,
});

/* ═══════════════ arranque de cada teste ═══════════════ */

beforeEach(() => {
  vi.clearAllMocks();
  prepararAmbiente();
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('vyvian_admin_user', JSON.stringify({ name: 'Vyvian Avena', role: 'owner' }));

  dashboardApi.get.mockResolvedValue(painel());
  statsApi.instagram.mockResolvedValue(instagram());
  statsApi.site.mockResolvedValue(site());
  statsApi.engagement.mockResolvedValue(engajamento());
  statsApi.engagementSync.mockResolvedValue({ ok: true });
  statsApi.campaignHistory.mockResolvedValue({ entries: [], fim: null });
  statsApi.campaignEndSet.mockResolvedValue({ ok: true });
  calendarApi.getAll.mockResolvedValue(calendario());
  calendarApi.createEvent.mockResolvedValue({ ok: true, id: 'novo' });
  calendarApi.updateEvent.mockResolvedValue({ ok: true });
  calendarApi.deleteEvent.mockResolvedValue({ ok: true });
  calendarApi.createType.mockResolvedValue({ ok: true, id: 't' });
  calendarApi.updateType.mockResolvedValue({ ok: true });
  calendarApi.deleteType.mockResolvedValue({ ok: true });
  installmentsApi.list.mockResolvedValue({ installments: [] });
  notifApi.getOwnerPrefs.mockResolvedValue(prefs());
  notifApi.updateOwnerPrefs.mockResolvedValue(prefs());
  notifApi.listTemplates.mockResolvedValue(modelos());
  insightsApi.topics.mockResolvedValue({ topics: [] });
  insightsApi.freeArticles.mockResolvedValue({ articles: [] });
  insightsApi.imageBank.mockResolvedValue({ images: [] });
  insightsApi.sources.mockResolvedValue({ sources: [] });
});

afterEach(() => { vi.unstubAllGlobals(); });

// ═════════════════════════════════════════════════════════════════════════════
// PAINEL — carregamento, erro e vazio
// ═════════════════════════════════════════════════════════════════════════════
describe('Painel — carregamento, erro e vazio', () => {
  const abrir = async () => {
    const r = renderizar(<Dashboard />);
    await screen.findByRole('heading', { level: 1 });
    await ecraEstavel();
    return r;
  };

  it('enquanto carrega mostra o esqueleto', () => {
    dashboardApi.get.mockReturnValue(new Promise(() => {}));
    renderizar(<Dashboard />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('enquanto carrega não mostra números', () => {
    dashboardApi.get.mockReturnValue(new Promise(() => {}));
    const { container } = renderizar(<Dashboard />);
    expect(texto(container)).toBe('');
  });

  it('erro da API aparece no ecrã', async () => {
    dashboardApi.get.mockRejectedValue(new Error('Sessão expirada'));
    renderizar(<Dashboard />);
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
  });

  it('com erro não mostra KPIs', async () => {
    dashboardApi.get.mockRejectedValue(new Error('HTTP 500'));
    renderizar(<Dashboard />);
    await screen.findByText('HTTP 500');
    expect(screen.queryByText('Clientes ativos')).not.toBeInTheDocument();
  });

  it('base vazia não mostra NaN, undefined, Infinity nem -0', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    const { container } = await abrir();
    semPodres(container);
  });

  it('base vazia mostra receita a zero', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    await abrir();
    expect(within(cartao('Receita prevista (30d)')).getByText('€ 0')).toBeInTheDocument();
  });

  it('base vazia mostra zero clientes ativos', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    await abrir();
    expect(within(cartao('Clientes ativos')).getByText('0')).toBeInTheDocument();
  });

  it('base vazia diz que não há nada nos próximos 30 dias', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    await abrir();
    expect(screen.getByText('Nada nos próximos 30 dias.')).toBeInTheDocument();
  });

  it('base vazia diz que não há atrasos', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    await abrir();
    expect(screen.getByRole('heading', { name: 'Parcelas vencidas' })).toBeInTheDocument();
    expect(contem(null, 'Sem atrasos.')).toBe(true);
  });

  it('painel cheio também não mostra números podres', async () => {
    dashboardApi.get.mockResolvedValue(painel({
      upcoming_revenue: [{ currency: 'EUR', total: 4200 }, { currency: 'BRL', total: 15000 }],
      upcoming: [parcela(), parcela({ id: 'i2', currency: 'BRL', amount: 1500, due_date: maisDias(0) })],
      alerts: [parcela({ id: 'i3', status: 'late', due_date: maisDias(-4) })],
    }));
    const { container } = await abrir();
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PAINEL — cabeçalho e KPIs
// ═════════════════════════════════════════════════════════════════════════════
describe('Painel — cabeçalho e KPIs', () => {
  const abrir = async (dados) => {
    if (dados) dashboardApi.get.mockResolvedValue(dados);
    const r = renderizar(<Dashboard />);
    await screen.findByRole('heading', { level: 1 });
    await ecraEstavel();
    return r;
  };

  it('cumprimenta a Dra. conforme a hora do dia', async () => {
    await abrir();
    const h = new Date().getHours();
    const esperado = h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite';
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${esperado}, Dra. Vyvian`);
  });

  it('mostra a data de hoje por extenso em português', async () => {
    await abrir();
    const hoje = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    expect(contem(null, hoje)).toBe(true);
  });

  it('escreve o nome da sessão no subtítulo', async () => {
    await abrir();
    expect(contem(null, 'Vyvian Avena')).toBe(true);
  });

  it('dois vencimentos hoje ficam no plural', async () => {
    await abrir();
    expect(contem(null, '2 vencimentos hoje')).toBe(true);
  });

  it('um vencimento hoje fica no singular', async () => {
    await abrir(painel({ counts: { ...painel().counts, due_today: 1 } }));
    expect(contem(null, '1 vencimento hoje')).toBe(true);
  });

  it('sem vencimentos hoje usa o plural', async () => {
    await abrir(painelVazio());
    expect(contem(null, '0 vencimentos hoje')).toBe(true);
  });

  it('tem os quatro KPIs', async () => {
    await abrir();
    for (const k of ['Receita prevista (30d)', 'Clientes ativos', 'Em atraso', 'Próximos vencimentos']) {
      expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    }
  });

  it('a receita prevista aparece em euros', async () => {
    await abrir();
    expect(within(cartao('Receita prevista (30d)')).getByText('€ 4200')).toBeInTheDocument();
  });

  it('sem receita em reais diz que o período é só em EUR', async () => {
    await abrir();
    expect(within(cartao('Receita prevista (30d)')).getByText('Apenas EUR este período')).toBeInTheDocument();
  });

  it('com receita em reais mostra o total em R$', async () => {
    await abrir(painel({ upcoming_revenue: [{ currency: 'EUR', total: 4200 }, { currency: 'BRL', total: 15000 }] }));
    expect(contem(cartao('Receita prevista (30d)'), '+ R$ 15 000 em BRL')).toBe(true);
  });

  it('só com receita em reais o euro fica a zero e não em NaN', async () => {
    const { container } = await abrir(painel({ upcoming_revenue: [{ currency: 'BRL', total: 900 }] }));
    expect(within(cartao('Receita prevista (30d)')).getByText('€ 0')).toBeInTheDocument();
    semPodres(container);
  });

  it('mostra o número de clientes ativos', async () => {
    await abrir();
    expect(within(cartao('Clientes ativos')).getByText('12')).toBeInTheDocument();
  });

  it('a nota dos clientes conta as parcelas pagas nos últimos 30 dias', async () => {
    await abrir();
    expect(within(cartao('Clientes ativos')).getByText('9 parcelas pagas (30d)')).toBeInTheDocument();
  });

  it('mostra quantas parcelas estão em atraso', async () => {
    await abrir();
    expect(within(cartao('Em atraso')).getByText('3')).toBeInTheDocument();
  });

  it('com atrasos pede ação', async () => {
    await abrir();
    expect(within(cartao('Em atraso')).getByText('Requer ação')).toBeInTheDocument();
  });

  it('próximos vencimentos soma pendentes e os de hoje', async () => {
    await abrir();
    expect(within(cartao('Próximos vencimentos')).getByText('9')).toBeInTheDocument();
  });

  it('a nota dos próximos vencimentos separa hoje do que está a vir', async () => {
    await abrir();
    expect(within(cartao('Próximos vencimentos')).getByText('2 hoje · 7 a vir')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PAINEL — janela dos próximos vencimentos
// ═════════════════════════════════════════════════════════════════════════════
describe('Painel — janela dos próximos vencimentos', () => {
  const abrir = async () => {
    const r = renderizar(<Dashboard />);
    await screen.findByRole('heading', { level: 1 });
    await ecraEstavel();
    return r;
  };

  it('começa em 30 dias', async () => {
    await abrir();
    expect(dashboardApi.get).toHaveBeenCalledWith(30);
  });

  it('oferece as seis janelas', async () => {
    await abrir();
    for (const j of ['7D', '15D', '30D', '60D', '90D', '180D']) {
      expect(screen.getByRole('button', { name: j })).toBeInTheDocument();
    }
  });

  it('escolher 90D pede os dados outra vez com 90', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '90D' }));
    await waitFor(() => expect(dashboardApi.get).toHaveBeenLastCalledWith(90));
  });

  it('escolher 7D muda o rótulo do KPI da receita', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '7D' }));
    expect(await screen.findByText('Receita prevista (7d)')).toBeInTheDocument();
  });

  it('o texto de lista vazia acompanha a janela escolhida', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '180D' }));
    expect(await screen.findByText('Nada nos próximos 180 dias.')).toBeInTheDocument();
  });

  it('mudar de janela não deixa números podres no ecrã', async () => {
    dashboardApi.get.mockResolvedValue(painelVazio());
    const { utilizador, container } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '60D' }));
    await screen.findByText('Nada nos próximos 60 dias.');
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PAINEL — listas de vencimentos e de atrasos
// ═════════════════════════════════════════════════════════════════════════════
describe('Painel — listas de vencimentos e de atrasos', () => {
  const abrir = async (dados) => {
    dashboardApi.get.mockResolvedValue(dados);
    const r = renderizar(<Dashboard />);
    await screen.findByRole('heading', { level: 1 });
    await ecraEstavel();
    return r;
  };

  it('mostra o nome do cliente de cada parcela', async () => {
    await abrir(painel());
    expect(within(painelDe('Próximos vencimentos')).getByText('Maria Silva')).toBeInTheDocument();
  });

  it('mostra o número da parcela sobre o total', async () => {
    await abrir(painel({ upcoming: [parcela({ installment_number: 2, total_installments: 6 })] }));
    expect(screen.getByText('Parcela 2/6')).toBeInTheDocument();
  });

  it('mostra o valor da parcela em euros', async () => {
    await abrir(painel());
    expect(within(painelDe('Próximos vencimentos')).getByText('€ 400')).toBeInTheDocument();
  });

  it('mostra o valor da parcela em reais quando a moeda é BRL', async () => {
    await abrir(painel({ upcoming: [parcela({ currency: 'BRL', amount: 1500 })] }));
    expect(within(painelDe('Próximos vencimentos')).getByText('R$ 1500')).toBeInTheDocument();
  });

  it('parcela que vence hoje diz "Hoje"', async () => {
    await abrir(painel({ upcoming: [parcela({ due_date: maisDias(0), status: 'due_today' })] }));
    expect(within(painelDe('Próximos vencimentos')).getByText('Hoje')).toBeInTheDocument();
  });

  it('parcela que vence amanhã diz "Amanhã"', async () => {
    await abrir(painel({ upcoming: [parcela({ due_date: maisDias(1) })] }));
    expect(screen.getByText('Amanhã')).toBeInTheDocument();
  });

  it('parcela a cinco dias diz "5 dias"', async () => {
    await abrir(painel({ upcoming: [parcela({ due_date: maisDias(5) })] }));
    expect(screen.getByText('5 dias')).toBeInTheDocument();
  });

  it('parcela marcada como atrasada conta os dias de atraso', async () => {
    await abrir(painel({ upcoming: [parcela({ status: 'late', due_date: maisDias(-4) })] }));
    expect(screen.getAllByText('4d atraso').length).toBeGreaterThan(0);
  });

  it('parcela pendente com data passada também mostra atraso', async () => {
    await abrir(painel({ upcoming: [parcela({ status: 'pending', due_date: maisDias(-2) })] }));
    expect(screen.getByText('2d atraso')).toBeInTheDocument();
  });

  it('cada parcela liga à ficha do cliente', async () => {
    await abrir(painel());
    const link = within(painelDe('Próximos vencimentos')).getByRole('link', { name: /Maria Silva/ });
    expect(link).toHaveAttribute('href', '/admin/clientes/c1');
  });

  it('tem um atalho para ver todas as parcelas', async () => {
    await abrir(painel());
    expect(screen.getByRole('link', { name: /Ver todos/ })).toHaveAttribute('href', '/admin/parcelas');
  });

  it('lista várias parcelas pela ordem em que vêm', async () => {
    await abrir(painel({
      upcoming: [
        parcela({ id: 'a', client_name: 'Ana Costa', due_date: maisDias(1) }),
        parcela({ id: 'b', client_name: 'Bruno Dias', due_date: maisDias(3) }),
      ],
    }));
    const nomes = within(painelDe('Próximos vencimentos')).getAllByRole('link')
      .map((l) => norm(l.textContent)).filter((t) => t.includes('Costa') || t.includes('Dias'));
    expect(nomes[0]).toContain('Ana Costa');
    expect(nomes[1]).toContain('Bruno Dias');
  });

  it('sem atrasos o painel da atenção fica vazio', async () => {
    await abrir(painel());
    expect(contem(painelDe('Parcelas vencidas'), 'Sem atrasos.')).toBe(true);
  });

  it('com atrasos explica o que fazer', async () => {
    await abrir(painel({ alerts: [parcela({ id: 'i9', status: 'late', due_date: maisDias(-10) })] }));
    expect(screen.getByText('Clique num cliente para tratar a cobrança.')).toBeInTheDocument();
  });

  it('cada atraso mostra o cliente e o valor', async () => {
    await abrir(painel({ alerts: [parcela({ id: 'i9', status: 'late', due_date: maisDias(-10), amount: 250 })] }));
    const bloco = painelDe('Parcelas vencidas');
    expect(within(bloco).getByText('Maria Silva')).toBeInTheDocument();
    expect(within(bloco).getByText('€ 250')).toBeInTheDocument();
  });

  it('cada atraso conta os dias em atraso', async () => {
    await abrir(painel({ alerts: [parcela({ id: 'i9', status: 'late', due_date: maisDias(-10) })] }));
    expect(within(painelDe('Parcelas vencidas')).getByText('10d atraso')).toBeInTheDocument();
  });

  // CORRIGIDO (era): Dashboard.jsx:80 e :152 — o painel usa o emoji colorido 🌿 nas notas
  // "Sem atrasos 🌿" / "Sem atrasos. 🌿". A regra do projeto é interface só com
  // glifos e SVGs monocromáticos (src/admin/icons.jsx); um emoji colorido
  // desalinha com o resto da Área Privada e depende da fonte do sistema.
  it('o painel não usa emojis coloridos', async () => {
    await abrir(painelVazio());
    expect(EMOJI.test(document.body.textContent)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REDES SOCIAIS — abas
// ═════════════════════════════════════════════════════════════════════════════
describe('Redes Sociais — abas', () => {
  it('abre no Instagram', async () => {
    renderizar(<Statistics />);
    expect(await screen.findByText('Seguidores')).toBeInTheDocument();
  });

  it('tem as quatro abas', () => {
    renderizar(<Statistics />);
    for (const t of ['Instagram', 'Engajamento', 'Site', 'Insights']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    }
  });

  it('a aba ativa fica marcada', () => {
    renderizar(<Statistics />);
    expect(screen.getByRole('tab', { name: 'Instagram' })).toHaveAttribute('aria-selected', 'true');
  });

  it('o subtítulo descreve a aba do Instagram', () => {
    renderizar(<Statistics />);
    expect(contem(null, 'Instagram · @vyvianavenaadv — sincronização diária automática.')).toBe(true);
  });

  it('ir para o Site pede os acessos ao site', async () => {
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('tab', { name: 'Site' }));
    await waitFor(() => expect(statsApi.site).toHaveBeenCalled());
  });

  it('ir para o Site troca o subtítulo', async () => {
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('tab', { name: 'Site' }));
    expect(await screen.findByText(/Acessos ao site · vyavenaadv\.com/)).toBeInTheDocument();
  });

  it('ir para o Engajamento pede as métricas de engajamento', async () => {
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('tab', { name: 'Engajamento' }));
    await waitFor(() => expect(statsApi.engagement).toHaveBeenCalled());
  });

  it('ir para os Insights não rebenta', async () => {
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('tab', { name: 'Insights' }));
    await waitFor(() => expect(insightsApi.topics).toHaveBeenCalled());
  });

  it('o tema alterna entre claro e escuro', async () => {
    const { utilizador } = renderizar(<Statistics />);
    expect(screen.getByRole('button', { name: 'Alternar tema' })).toHaveTextContent('Claro');
    await utilizador.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(screen.getByRole('button', { name: 'Alternar tema' })).toHaveTextContent('Escuro');
  });

  it('o tema escolhido fica guardado', async () => {
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('button', { name: 'Alternar tema' }));
    await waitFor(() => expect(localStorage.getItem('rs-theme')).toBe('light'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REDES SOCIAIS — Instagram
// ═════════════════════════════════════════════════════════════════════════════
describe('Redes Sociais — Instagram', () => {
  const abrir = async (dados) => {
    if (dados) statsApi.instagram.mockResolvedValue(dados);
    const r = renderizar(<Statistics />);
    await waitFor(() => expect(statsApi.instagram).toHaveBeenCalled());
    return r;
  };

  it('pede 30 dias por omissão', async () => {
    await abrir();
    expect(statsApi.instagram).toHaveBeenCalledWith('30d');
  });

  it('não oferece o período de 1 dia (os seguidores só se contam 1×/dia)', async () => {
    await abrir();
    await screen.findByText('Seguidores');
    expect(screen.queryByRole('button', { name: '1 DIA' })).not.toBeInTheDocument();
  });

  it('oferece os restantes períodos', async () => {
    await abrir();
    await screen.findByText('Seguidores');
    for (const r of ['7 DIAS', '15 DIAS', '30 DIAS', '60 DIAS', '90 DIAS', '120 DIAS']) {
      expect(screen.getByRole('button', { name: r })).toBeInTheDocument();
    }
  });

  it('escolher 7 dias pede os dados outra vez', async () => {
    const { utilizador } = await abrir();
    await screen.findByText('Seguidores');
    await utilizador.click(screen.getByRole('button', { name: '7 DIAS' }));
    await waitFor(() => expect(statsApi.instagram).toHaveBeenLastCalledWith('7d'));
  });

  it('a legenda do filtro diz o período e o agrupamento', async () => {
    await abrir();
    await screen.findByText('Seguidores');
    expect(contem(null, 'Últimos 30 dias · agrupado por dia')).toBe(true);
  });

  it('agrupar por semanas muda a legenda', async () => {
    const { utilizador } = await abrir();
    await screen.findByText('Seguidores');
    await utilizador.click(screen.getByRole('button', { name: 'SEMANAS' }));
    expect(contem(null, 'agrupado por semana')).toBe(true);
  });

  it('agrupar por meses muda a legenda', async () => {
    const { utilizador } = await abrir();
    await screen.findByText('Seguidores');
    await utilizador.click(screen.getByRole('button', { name: 'MESES' }));
    expect(contem(null, 'agrupado por mês')).toBe(true);
  });

  it('mostra o total de seguidores', async () => {
    await abrir();
    expect(within(cartao('Seguidores', '.kpi')).getByText('214')).toBeInTheDocument();
  });

  it('mostra os novos seguidores do período', async () => {
    await abrir();
    expect(contem(cartao('Seguidores', '.kpi'), '+12 desde o início do período')).toBe(true);
  });

  it('perder seguidores mostra o sinal negativo', async () => {
    await abrir(instagram({ new_followers: -5 }));
    expect(contem(cartao('Seguidores', '.kpi'), '-5 desde o início do período')).toBe(true);
  });

  it('sem histórico de seguidores mostra o handle', async () => {
    await abrir(instagram({ new_followers: null }));
    expect(contem(cartao('Seguidores', '.kpi'), '@vyvianavenaadv')).toBe(true);
  });

  it('o KPI dos novos mostra a média por dia', async () => {
    await abrir();
    expect(contem(cartao('Novos', '.kpi'), '≈ 0.4/dia')).toBe(true);
  });

  it('sem variação nenhuma diz que está estável', async () => {
    await abrir(instagram({ new_followers: 0 }));
    expect(contem(cartao('Novos', '.kpi'), 'estável no período')).toBe(true);
  });

  it('mostra o total de publicações do perfil', async () => {
    await abrir();
    expect(within(cartao('Publicações', '.kpi')).getByText('48')).toBeInTheDocument();
  });

  it('diz quantas publicações recentes foram recolhidas', async () => {
    await abrir();
    expect(contem(cartao('Publicações', '.kpi'), '2 recentes recolhidas')).toBe(true);
  });

  it('soma as curtidas das publicações recolhidas', async () => {
    await abrir();
    expect(within(cartao('Curtidas', '.kpi')).getByText('60')).toBeInTheDocument();
  });

  it('mostra a média de curtidas por publicação', async () => {
    await abrir();
    expect(contem(cartao('Curtidas', '.kpi'), '30/publicação')).toBe(true);
  });

  it('um só comentário fica no singular', async () => {
    await abrir(instagram({ posts: [igPost({ comments_count: 1 })] }));
    expect(contem(cartao('Curtidas', '.kpi'), '1 comentário')).toBe(true);
  });

  it('vários comentários ficam no plural', async () => {
    await abrir();
    expect(contem(cartao('Curtidas', '.kpi'), '7 comentários')).toBe(true);
  });

  it('o gráfico da evolução tem os eixos rotulados', async () => {
    await abrir();
    await screen.findByRole('heading', { name: 'Evolução de seguidores' });
    expect(contem(painelDe('Evolução de seguidores'), 'Eixo X · dias')).toBe(true);
    expect(contem(painelDe('Evolução de seguidores'), 'Eixo Y · seguidores')).toBe(true);
  });

  it('o gráfico recebe um ponto por dia recolhido', async () => {
    await abrir();
    expect(painelDe('Evolução de seguidores').querySelectorAll('circle').length).toBeGreaterThanOrEqual(5);
  });

  it('com um só dia recolhido explica que faltam pontos', async () => {
    await abrir(instagram({ series: igSerie(1, 200) }));
    expect(await screen.findByText(/precisa de pelo menos dois dias de recolha/)).toBeInTheDocument();
  });

  it('agrupar por mês uma série curta avisa que só há um ponto', async () => {
    // série toda dentro do mesmo mês (datas fixas): agrupada por mês dá 1 ponto
    const { utilizador } = await abrir(instagram({
      series: ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']
        .map((k, i) => ({ key: k, label: k.slice(8, 10) + '/' + k.slice(5, 7), followers: 200 + i })),
    }));
    await screen.findByText('Seguidores');
    await utilizador.click(screen.getByRole('button', { name: 'MESES' }));
    expect(await screen.findByText(/só tem 1 ponto/)).toBeInTheDocument();
  });

  it('mostra a percentagem de crescimento', async () => {
    await abrir();
    await screen.findByRole('heading', { name: 'Evolução de seguidores' });
    expect(contem(painelDe('Evolução de seguidores'), '+5.9%')).toBe(true);
  });

  // CORRIGIDO (era): Statistics.jsx:374 — o sinal «+» é fixo no JSX e o growPct já traz o
  // seu próprio sinal. Quando a conta perde seguidores no período (new_followers
  // negativo, caso perfeitamente normal) o selo de crescimento sai «+-2.4%».
  it('perder seguidores não devia mostrar "+-"', async () => {
    await abrir(instagram({ new_followers: -5 }));
    await screen.findByRole('heading', { name: 'Evolução de seguidores' });
    expect(texto(painelDe('Evolução de seguidores'))).not.toContain('+-');
  });

  it('lista as últimas publicações', async () => {
    await abrir();
    expect(await screen.findByRole('heading', { name: 'Últimas publicações' })).toBeInTheDocument();
  });

  it('cada publicação liga ao Instagram', async () => {
    await abrir();
    await screen.findByRole('heading', { name: 'Últimas publicações' });
    expect(screen.getAllByRole('link', { name: /Nacionalidade portuguesa/ })[0])
      .toHaveAttribute('href', 'https://instagram.com/p/1');
  });

  it('cada publicação mostra a data em formato português', async () => {
    await abrir();
    await screen.findByRole('heading', { name: 'Últimas publicações' });
    expect(screen.getAllByText('28/07/26').length).toBeGreaterThan(0);
  });

  it('marca os vídeos', async () => {
    await abrir(instagram({ posts: [igPost({ media_type: 'VIDEO' })] }));
    expect(await screen.findByText('VÍDEO')).toBeInTheDocument();
  });

  it('marca os álbuns', async () => {
    await abrir(instagram({ posts: [igPost({ media_type: 'CAROUSEL_ALBUM' })] }));
    expect(await screen.findByText('ÁLBUM')).toBeInTheDocument();
  });

  it('sem publicações recolhidas diz-o', async () => {
    await abrir(instagram({ posts: [] }));
    expect(await screen.findByText('Ainda sem publicações recolhidas.')).toBeInTheDocument();
  });

  it('conta ligada sem recolha mostra o estado em vez de zeros', async () => {
    await abrir(instagramVazio());
    expect(await screen.findByText('Conta ligada com sucesso')).toBeInTheDocument();
    expect(screen.queryByText('Seguidores')).not.toBeInTheDocument();
  });

  it('conta ligada sem recolha não mostra números podres', async () => {
    const { container } = await abrir(instagramVazio());
    await screen.findByText('Conta ligada com sucesso');
    semPodres(container);
  });

  it('erro da API aparece no ecrã', async () => {
    statsApi.instagram.mockRejectedValue(new Error('Instagram indisponível'));
    renderizar(<Statistics />);
    expect(await screen.findByText('Instagram indisponível')).toBeInTheDocument();
  });

  it('mostra quando foi a última sincronização', async () => {
    await abrir();
    await screen.findByText('Seguidores');
    expect(contem(null, 'Atualizado a 02/08 · sincronização diária')).toBe(true);
  });

  it('com dados não há números podres', async () => {
    const { container } = await abrir();
    await screen.findByRole('heading', { name: 'Últimas publicações' });
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REDES SOCIAIS — Site
// ═════════════════════════════════════════════════════════════════════════════
describe('Redes Sociais — Site', () => {
  const abrir = async (dados) => {
    if (dados) statsApi.site.mockResolvedValue(dados);
    const r = renderizar(<Statistics />);
    await r.utilizador.click(screen.getByRole('tab', { name: 'Site' }));
    await waitFor(() => expect(statsApi.site).toHaveBeenCalled());
    return r;
  };

  it('pede 7 dias por omissão', async () => {
    await abrir();
    expect(statsApi.site).toHaveBeenCalledWith('7d');
  });

  it('oferece o período de 1 dia (há tráfego hora a hora)', async () => {
    await abrir();
    expect(await screen.findByRole('button', { name: '1 DIA' })).toBeInTheDocument();
  });

  it('mostra o total de visitas', async () => {
    await abrir();
    expect(within(cartao('Visitas', '.kpi')).getByText('160')).toBeInTheDocument();
  });

  it('compara com o período homólogo', async () => {
    await abrir();
    expect(contem(cartao('Visitas', '.kpi'), 'vs. período anterior')).toBe(true);
  });

  it('a variação face ao período anterior aparece com sinal', async () => {
    await abrir();
    expect(contem(cartao('Visitas', '.kpi'), '+100%')).toBe(true);
  });

  it('uma queda mostra a variação negativa', async () => {
    await abrir(site({ total_views: 40, prev_total_views: 80 }));
    expect(contem(cartao('Visitas', '.kpi'), '-50%')).toBe(true);
  });

  it('período anterior a zero não faz divisão por zero', async () => {
    const { container } = await abrir(site({ total_views: 12, prev_total_views: 0 }));
    expect(contem(cartao('Visitas', '.kpi'), '+100%')).toBe(true);
    semPodres(container);
  });

  it('sem visitas em nenhum dos períodos a variação é zero', async () => {
    const { container } = await abrir(site({ total_views: 0, prev_total_views: 0 }));
    expect(contem(cartao('Visitas', '.kpi'), '+0%')).toBe(true);
    semPodres(container);
  });

  it('mostra a média por dia', async () => {
    await abrir();
    expect(within(cartao('Média por dia', '.kpi')).getByText('23')).toBeInTheDocument();
  });

  it('mostra os visitantes únicos', async () => {
    await abrir();
    expect(within(cartao('Visitantes únicos', '.kpi')).getByText('80')).toBeInTheDocument();
  });

  it('explica que a contagem é sem cookies', async () => {
    await abrir();
    expect(contem(cartao('Visitantes únicos', '.kpi'), 'sem cookies')).toBe(true);
  });

  it('mostra o pico do período', async () => {
    await abrir();
    expect(within(cartao('Pico', '.kpi')).getByText('40')).toBeInTheDocument();
  });

  it('o pico identifica o dia', async () => {
    await abrir();
    const dia = maisDias(-2).slice(8, 10) + '/' + maisDias(-2).slice(5, 7);
    expect(contem(cartao('Pico', '.kpi'), `melhor dia · ${dia}`)).toBe(true);
  });

  it('sem acessos nenhuns o pico diz que ainda não há dados', async () => {
    await abrir(siteVazio());
    expect(contem(cartao('Pico', '.kpi'), 'sem dados ainda')).toBe(true);
  });

  it('sem acessos nenhuns o gráfico explica-se em vez de mentir', async () => {
    await abrir(siteVazio());
    expect(await screen.findByText(/Ainda sem acessos registados neste período/)).toBeInTheDocument();
  });

  it('sem acessos nenhuns não há números podres', async () => {
    const { container } = await abrir(siteVazio());
    await screen.findByRole('heading', { name: /Acessos por dia/ });
    semPodres(container);
  });

  it('o gráfico de tráfego tem legenda de visitas e únicos', async () => {
    await abrir();
    const bloco = await screen.findByRole('heading', { name: /Acessos por dia/ });
    expect(contem(bloco.closest('.glass'), 'Visitas')).toBe(true);
    expect(contem(bloco.closest('.glass'), 'Únicos')).toBe(true);
  });

  it('o gráfico de tráfego rotula os eixos', async () => {
    await abrir();
    await screen.findByRole('heading', { name: /Acessos por dia/ });
    expect(contem(painelDe(/Acessos por dia/), 'Eixo X · dias')).toBe(true);
  });

  it('escolher 1 dia pede a série horária', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '1 DIA' }));
    await waitFor(() => expect(statsApi.site).toHaveBeenLastCalledWith('1d'));
  });

  const horario = (views = 10) => ({
    range: '1d', granularity: 'hour',
    series: Array.from({ length: 24 }, (_, i) => ({ key: `d${i}`, label: p2(i) + 'h', views })),
    total_views: views * 24, total_visitors: null, prev_total_views: 0, tz: 'UTC',
  });
  const abrirHorario = async () => {
    statsApi.site.mockResolvedValue(horario());
    const r = renderizar(<Statistics />);
    await r.utilizador.click(screen.getByRole('tab', { name: 'Site' }));
    await r.utilizador.click(await screen.findByRole('button', { name: '1 DIA' }));
    return r;
  };

  it('na vista horária o agrupamento desaparece', async () => {
    await abrirHorario();
    expect(await screen.findByText('Últimas 24 horas · agrupado por hora')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SEMANAS' })).not.toBeInTheDocument();
  });

  it('na vista horária a média é por hora', async () => {
    await abrirHorario();
    expect(await screen.findByText('Média por hora')).toBeInTheDocument();
  });

  it('na vista horária os visitantes únicos ficam a zero e não em NaN', async () => {
    const { container } = await abrirHorario();
    await screen.findByText('Média por hora');
    semPodres(container);
  });

  it('erro da API aparece no ecrã', async () => {
    statsApi.site.mockRejectedValue(new Error('Sem estatísticas'));
    const { utilizador } = renderizar(<Statistics />);
    await utilizador.click(screen.getByRole('tab', { name: 'Site' }));
    expect(await screen.findByText('Sem estatísticas')).toBeInTheDocument();
  });

  it('remete para os Insights quando o tráfego precisa de conteúdo', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver sugestões/ }));
    await waitFor(() => expect(insightsApi.topics).toHaveBeenCalled());
  });

  it('com dados não há números podres', async () => {
    const { container } = await abrir();
    await screen.findByRole('heading', { name: /Acessos por dia/ });
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGAJAMENTO — plataforma, período e estados
// ═════════════════════════════════════════════════════════════════════════════
describe('Engajamento — plataforma, período e estados', () => {
  const abrir = async (dados) => {
    if (dados) statsApi.engagement.mockResolvedValue(dados);
    const r = renderizar(<><EngagementSection /><ToastHost /></>);
    await waitFor(() => expect(statsApi.engagement).toHaveBeenCalled());
    return r;
  };

  it('pede 30 dias por omissão', async () => {
    await abrir();
    expect(statsApi.engagement).toHaveBeenCalledWith('30d');
  });

  it('mostra as duas plataformas', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: 'INSTAGRAM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FACEBOOK' })).toBeInTheDocument();
  });

  it('oferece cinco períodos', async () => {
    await abrir();
    for (const r of ['7 DIAS', '15 DIAS', '30 DIAS', '60 DIAS', '90 DIAS']) {
      expect(screen.getByRole('button', { name: r })).toBeInTheDocument();
    }
  });

  it('escolher 90 dias pede os dados outra vez', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '90 DIAS' }));
    await waitFor(() => expect(statsApi.engagement).toHaveBeenLastCalledWith('90d'));
  });

  it('o período escolhido aparece nos KPIs', async () => {
    await abrir(engajamento({ instagram: {} }));
    expect(screen.getAllByText('últimos 30 dias').length).toBeGreaterThan(0);
  });

  it('o Facebook esconde o seletor de período', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'FACEBOOK' }));
    expect(screen.queryByRole('button', { name: '90 DIAS' })).not.toBeInTheDocument();
  });

  it('o Facebook explica que a ligação está por fazer', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'FACEBOOK' }));
    expect(await screen.findByText('Por ligar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vyvian Avena Advogada' })).toBeInTheDocument();
  });

  it('o Facebook não inventa números', async () => {
    const { utilizador, container } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'FACEBOOK' }));
    await screen.findByText('Por ligar');
    semPodres(container);
  });

  it('voltar ao Instagram traz os números de volta', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'FACEBOOK' }));
    await utilizador.click(screen.getByRole('button', { name: 'INSTAGRAM' }));
    expect(await screen.findByText('Contas com engajamento')).toBeInTheDocument();
  });

  it('erro da API aparece no ecrã', async () => {
    statsApi.engagement.mockRejectedValue(new Error('Meta fora de serviço'));
    renderizar(<EngagementSection />);
    expect(await screen.findByText('Meta fora de serviço')).toBeInTheDocument();
  });

  it('sem recolha nenhuma mostra o estado em vez de zeros', async () => {
    await abrir(engajamentoVazio());
    expect(await screen.findByText('Engajamento a caminho')).toBeInTheDocument();
  });

  it('sem recolha nenhuma não há números podres', async () => {
    const { container } = await abrir(engajamentoVazio());
    await screen.findByText('Engajamento a caminho');
    semPodres(container);
  });

  it('mostra quando foi a última sincronização', async () => {
    await abrir();
    expect(contem(null, 'Atualizado a 02/08 às')).toBe(true);
  });

  it('«Atualizar agora» corre o sync', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Atualizar agora/ }));
    await waitFor(() => expect(statsApi.engagementSync).toHaveBeenCalled());
  });

  it('depois do sync recarrega os números', async () => {
    const { utilizador } = await abrir();
    const antes = statsApi.engagement.mock.calls.length;
    await utilizador.click(screen.getByRole('button', { name: /Atualizar agora/ }));
    await waitFor(() => expect(statsApi.engagement.mock.calls.length).toBeGreaterThan(antes));
  });

  it('sync com sucesso avisa a Dra.', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Atualizar agora/ }));
    expect(await screen.findByText('Números atualizados — registo adicionado ao histórico.')).toBeInTheDocument();
  });

  it('sync falhado não deita a aba abaixo', async () => {
    statsApi.engagementSync.mockRejectedValue(new Error('timeout'));
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Atualizar agora/ }));
    expect(await screen.findByText('Não foi possível atualizar agora: timeout')).toBeInTheDocument();
    expect(screen.getByText('Contas com engajamento')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGAJAMENTO — KPIs e variações
// ═════════════════════════════════════════════════════════════════════════════
describe('Engajamento — KPIs e variações', () => {
  const abrir = async (ig) => {
    if (ig) statsApi.engagement.mockResolvedValue(engajamento({ instagram: ig }));
    const r = renderizar(<EngagementSection />);
    await screen.findByText('Contas com engajamento');
    return r;
  };

  it('mostra as contas com engajamento', async () => {
    await abrir();
    expect(within(cartao('Contas com engajamento', '.kpi')).getByText('150')).toBeInTheDocument();
  });

  it('mostra as interações totais', async () => {
    await abrir();
    expect(within(cartao('Interações totais', '.kpi')).getByText('200')).toBeInTheDocument();
  });

  it('mostra o alcance', async () => {
    await abrir();
    expect(within(cartao('Contas alcançadas', '.kpi')).getByText('1000')).toBeInTheDocument();
  });

  it('mostra a taxa de engajamento em percentagem portuguesa', async () => {
    await abrir();
    expect(within(cartao('Taxa de engajamento', '.kpi')).getByText('20,0%')).toBeInTheDocument();
  });

  it('subida em relação ao período anterior aparece com ▲', async () => {
    await abrir();
    expect(contem(cartao('Interações totais', '.kpi'), '▲ 100% vs. período anterior')).toBe(true);
  });

  it('descida em relação ao período anterior aparece com ▼', async () => {
    await abrir(engIg({ totals: { ...engIg().totals, total_interactions: 50 } }));
    expect(contem(cartao('Interações totais', '.kpi'), '▼ 50% vs. período anterior')).toBe(true);
  });

  it('período anterior a zero não rebenta a divisão', async () => {
    const { container } = await abrir(engIg({ prev_totals: { reach: 0, total_interactions: 0, accounts_engaged: 0 } }));
    expect(contem(cartao('Interações totais', '.kpi'), '▲ 100%')).toBe(true);
    semPodres(container);
  });

  it('sem alcance a taxa de engajamento fica em traço', async () => {
    await abrir(engIg({ engagement_rate: null }));
    expect(contem(cartao('Taxa de engajamento', '.kpi'), '—')).toBe(true);
  });

  it('métrica em falta mostra traço em vez de zero inventado', async () => {
    await abrir(engIg({ totals: { ...engIg().totals, accounts_engaged: null } }));
    expect(contem(cartao('Contas com engajamento', '.kpi'), '—')).toBe(true);
  });

  it('métrica em falta não mostra variação nenhuma', async () => {
    await abrir(engIg({ totals: { ...engIg().totals, accounts_engaged: null } }));
    expect(texto(cartao('Contas com engajamento', '.kpi'))).not.toContain('▲');
  });

  it('explica o que conta como interação', async () => {
    await abrir();
    expect(contem(cartao('Interações totais', '.kpi'), 'curtidas + comentários + guardados + partilhas')).toBe(true);
  });

  it('avisa que o alcance é soma diária', async () => {
    await abrir();
    expect(contem(cartao('Contas alcançadas', '.kpi'), 'soma diária — repete quem viu em dias diferentes')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGAJAMENTO — composição, evolução e destaque
// ═════════════════════════════════════════════════════════════════════════════
describe('Engajamento — composição, evolução e destaque', () => {
  const abrir = async (ig) => {
    if (ig) statsApi.engagement.mockResolvedValue(engajamento({ instagram: ig }));
    const r = renderizar(<EngagementSection />);
    await screen.findByText('Contas com engajamento');
    return r;
  };

  it('decompõe o engajamento nas seis métricas', async () => {
    await abrir();
    const bloco = painelDe('Do que é feito o engajamento');
    for (const m of ['Curtidas', 'Comentários', 'Guardados', 'Partilhas', 'Respostas', 'Toques no link']) {
      expect(within(bloco).getByText(m)).toBeInTheDocument();
    }
  });

  it('cada métrica mostra a sua quota do total', async () => {
    await abrir();
    const bloco = painelDe('Do que é feito o engajamento');
    expect(within(bloco).getByText('60%')).toBeInTheDocument();   // 120 curtidas em 200
  });

  it('guardados e partilhas têm a quota certa', async () => {
    await abrir();
    const bloco = painelDe('Do que é feito o engajamento');
    expect(within(bloco).getByText('18%')).toBeInTheDocument();   // 35 guardados em 200
    expect(within(bloco).getByText('5%')).toBeInTheDocument();    // 10 partilhas em 200
  });

  it('total de interações a zero não gera percentagens infinitas', async () => {
    const { container } = await abrir(engIg({
      totals: { ...engIg().totals, total_interactions: 0, likes: 0, comments: 0, saves: 0, shares: 0, replies: 0 },
    }));
    semPodres(container);
  });

  it('métrica sem valor mostra traço', async () => {
    await abrir(engIg({ totals: { ...engIg().totals, replies: null } }));
    const bloco = painelDe('Do que é feito o engajamento');
    expect(texto(bloco)).toContain('—');
  });

  it('explica porque guardados e partilhas valem mais', async () => {
    await abrir();
    expect(contem(painelDe('Do que é feito o engajamento'), 'Guardados e partilhas valem mais do que curtidas')).toBe(true);
  });

  it('o gráfico de evolução tem as duas séries na legenda', async () => {
    await abrir();
    const bloco = painelDe('Interações e alcance por dia');
    expect(within(bloco).getAllByText('interações').length).toBeGreaterThan(0);
    expect(within(bloco).getAllByText('alcance').length).toBeGreaterThan(0);
  });

  it('o gráfico de evolução rotula os eixos', async () => {
    await abrir();
    const bloco = painelDe('Interações e alcance por dia');
    expect(contem(bloco, 'Eixo X · Dia')).toBe(true);
    expect(contem(bloco, 'Eixo Y · Total')).toBe(true);
  });

  it('diz quantos dias foram recolhidos', async () => {
    await abrir();
    expect(contem(painelDe('Interações e alcance por dia'), '3 dias recolhidos no período')).toBe(true);
  });

  it('um só dia recolhido fica no singular', async () => {
    await abrir(engIg({ days_collected: 1, series: [engIg().series[0]] }));
    expect(contem(painelDe('Interações e alcance por dia'), '1 dia recolhido no período')).toBe(true);
  });

  it('com menos de dois dias o gráfico explica-se em vez de desenhar uma reta', async () => {
    await abrir(engIg({ days_collected: 1, series: [engIg().series[0]] }));
    expect(screen.getByText(/precisa de pelo menos dois dias recolhidos/)).toBeInTheDocument();
  });

  it('a publicação em destaque mostra a legenda', async () => {
    await abrir();
    expect(contem(painelDe('Publicação com mais engajamento'), 'Como pedir a nacionalidade')).toBe(true);
  });

  it('a publicação em destaque mostra alcance e curtidas', async () => {
    await abrir();
    const bloco = painelDe('Publicação com mais engajamento');
    expect(within(bloco).getByText('Alcance')).toBeInTheDocument();
    expect(within(bloco).getByText('1000')).toBeInTheDocument();
  });

  it('a publicação em destaque formata o tempo médio em minutos e segundos', async () => {
    await abrir();
    expect(contem(painelDe('Publicação com mais engajamento'), '1m 05s')).toBe(true);
  });

  it('tempo médio abaixo de um minuto fica em segundos', async () => {
    await abrir(engIg({ best: engPost({ avg_watch_time: 42000 }) }));
    expect(contem(painelDe('Publicação com mais engajamento'), '42s')).toBe(true);
  });

  it('sem tempo médio não mostra o campo', async () => {
    await abrir(engIg({ best: engPost({ avg_watch_time: null }) }));
    expect(within(painelDe('Publicação com mais engajamento')).queryByText('Tempo médio')).not.toBeInTheDocument();
  });

  it('publicação sem legenda diz "Sem legenda"', async () => {
    await abrir(engIg({ best: engPost({ caption: null }) }));
    expect(contem(painelDe('Publicação com mais engajamento'), 'Sem legenda')).toBe(true);
  });

  it('a data da publicação em destaque vem em formato português', async () => {
    await abrir();
    expect(contem(painelDe('Publicação com mais engajamento'), '28/07/2026')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGAJAMENTO — ranking, formatos e demografia
// ═════════════════════════════════════════════════════════════════════════════
describe('Engajamento — ranking, formatos e demografia', () => {
  const abrir = async (ig) => {
    if (ig) statsApi.engagement.mockResolvedValue(engajamento({ instagram: ig }));
    const r = renderizar(<EngagementSection />);
    await screen.findByText('Contas com engajamento');
    return r;
  };
  const tabela = () => within(painelDe('Ranking das publicações')).getByRole('table');

  it('o ranking tem as sete colunas', async () => {
    await abrir();
    for (const c of ['Publicação', 'Formato', 'Alcance', 'Interações', 'Guardados', 'Partilhas', 'Taxa']) {
      expect(within(tabela()).getByRole('columnheader', { name: c })).toBeInTheDocument();
    }
  });

  it('o ranking mostra uma linha por publicação', async () => {
    await abrir();
    expect(within(tabela()).getAllByRole('row')).toHaveLength(3); // cabeçalho + 2
  });

  it('o ranking vem ordenado por interações', async () => {
    await abrir();
    const linhas = within(tabela()).getAllByRole('row').slice(1);
    expect(norm(linhas[0].textContent)).toContain('Como pedir a nacionalidade');
    expect(norm(linhas[1].textContent)).toContain('Álbum do escritório');
  });

  it('o ranking numera as posições', async () => {
    await abrir();
    const linhas = within(tabela()).getAllByRole('row').slice(1);
    expect(norm(linhas[0].textContent).startsWith('1')).toBe(true);
    expect(norm(linhas[1].textContent).startsWith('2')).toBe(true);
  });

  it('cada linha mostra o formato', async () => {
    await abrir();
    expect(within(tabela()).getByText('Reel')).toBeInTheDocument();
    expect(within(tabela()).getByText('Álbum')).toBeInTheDocument();
  });

  it('cada linha mostra a taxa em percentagem portuguesa', async () => {
    await abrir();
    expect(within(tabela()).getByText('12,0%')).toBeInTheDocument();
  });

  it('publicação sem métricas detalhadas mostra traço em vez de zero', async () => {
    await abrir(engIg({
      ranking: [engPost({ reach: null, saved: null, shares: null, rate: null, has_insights: false })],
    }));
    const celulas = within(tabela()).getAllByRole('cell');
    expect(celulas.filter((c) => norm(c.textContent) === '—').length).toBeGreaterThanOrEqual(4);
  });

  it('explica as linhas com traço', async () => {
    await abrir(engIg({
      ranking: [engPost({ reach: null, saved: null, shares: null, rate: null, has_insights: false })],
    }));
    expect(contem(painelDe('Ranking das publicações'), 'ainda não foram recolhidas')).toBe(true);
  });

  it('ranking vazio diz que ainda não há publicações', async () => {
    await abrir(engIg({ ranking: [] }));
    expect(contem(painelDe('Ranking das publicações'), 'Ainda sem publicações recolhidas.')).toBe(true);
  });

  it('publicação sem legenda no ranking diz "Sem legenda"', async () => {
    await abrir(engIg({ ranking: [engPost({ caption: '' })] }));
    expect(within(tabela()).getByText('Sem legenda')).toBeInTheDocument();
  });

  it('cada linha liga à publicação no Instagram', async () => {
    await abrir();
    expect(within(tabela()).getAllByRole('link')[0]).toHaveAttribute('href', 'https://instagram.com/p/e1');
  });

  it('o painel dos formatos mostra a média por publicação', async () => {
    await abrir();
    const bloco = painelDe('Que formato funciona');
    expect(within(bloco).getByText('Reel · 2 peças')).toBeInTheDocument();
    expect(within(bloco).getByText('120')).toBeInTheDocument();
  });

  it('um único post fica no singular', async () => {
    await abrir(engIg({ by_format: [{ format: 'Reel', posts: 1, avg_interactions: 30 }] }));
    expect(within(painelDe('Que formato funciona')).getByText('Reel · 1 peça')).toBeInTheDocument();
  });

  it('as médias por formato não trazem percentagem (não são partes de um todo)', async () => {
    await abrir();
    expect(texto(painelDe('Que formato funciona'))).not.toMatch(/\d+%/);
  });

  it('sem formatos suficientes explica-se', async () => {
    await abrir(engIg({ by_format: [] }));
    expect(contem(painelDe('Que formato funciona'), 'Sem publicações suficientes para comparar formatos.')).toBe(true);
  });

  it('o melhor dia para publicar mostra os dias da semana', async () => {
    await abrir();
    expect(within(painelDe('Melhor dia para publicar')).getByText('terça · 2 peças')).toBeInTheDocument();
  });

  it('sem histórico o melhor dia explica-se', async () => {
    await abrir(engIg({ by_weekday: [] }));
    expect(contem(painelDe('Melhor dia para publicar'), 'Sem histórico suficiente.')).toBe(true);
  });

  it('a demografia traduz os códigos de país', async () => {
    await abrir();
    const bloco = painelDe('Quem está do outro lado');
    expect(within(bloco).getByText('Brasil')).toBeInTheDocument();
    expect(within(bloco).getByText('Portugal')).toBeInTheDocument();
  });

  it('a demografia traduz os códigos de género', async () => {
    await abrir();
    const bloco = painelDe('Quem está do outro lado');
    expect(within(bloco).getByText('Feminino')).toBeInTheDocument();
    expect(within(bloco).getByText('Masculino')).toBeInTheDocument();
  });

  it('a demografia mostra a quota de cada linha', async () => {
    await abrir();
    const bloco = painelDe('Quem está do outro lado');
    expect(within(bloco).getByText('67%')).toBeInTheDocument();   // 120 de 180
    expect(within(bloco).getByText('33%')).toBeInTheDocument();   // 60 de 180
  });

  it('a demografia diz de que dia é a fotografia', async () => {
    await abrir();
    expect(contem(painelDe('Quem está do outro lado'), 'fotografia de 01/08')).toBe(true);
  });

  it('sem demografia explica a regra dos 100 seguidores', async () => {
    await abrir(engIg({ demographics: {}, demographics_day: null }));
    expect(contem(painelDe('Quem está do outro lado'), '100 seguidores ou mais')).toBe(true);
  });

  it('com dados completos não há números podres', async () => {
    const { container } = await abrir();
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGAJAMENTO — histórico da campanha
// ═════════════════════════════════════════════════════════════════════════════
describe('Engajamento — histórico da campanha', () => {
  const entrada = (over = {}) => ({
    id: 1, data: '2026-07-30', hora: '14:20', fase: 'auditoria',
    titulo: 'Auditoria dos dois conjuntos', resumo: 'Verificação do gasto e do alcance.',
    acoes: ['Conferido o orçamento diário', 'Comparados PT e BR'],
    metricas: [{ label: 'Alcance', valor: '12 300' }],
    decisao: 'Manter o conjunto PT.', ...over,
  });

  const abrir = async () => {
    const r = renderizar(<><EngagementSection /><ToastHost /></>);
    await waitFor(() => expect(statsApi.campaignHistory).toHaveBeenCalled());
    return r;
  };

  it('o cartão do histórico aparece no topo', async () => {
    await abrir();
    expect(await screen.findByText('Histórico da campanha')).toBeInTheDocument();
  });

  it('sem registos diz que ainda não há nenhum', async () => {
    await abrir();
    expect(await screen.findByText('Sem registos ainda.')).toBeInTheDocument();
  });

  it('com registos conta-os e mostra a data do último', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    await abrir();
    expect(await screen.findByText('1 registo · último: 30 de julho de 2026')).toBeInTheDocument();
  });

  it('vários registos ficam no plural', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada(), entrada({ id: 2 })], fim: null });
    await abrir();
    expect(await screen.findByText(/^2 registos/)).toBeInTheDocument();
  });

  it('abrir o cartão mostra o histórico completo', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    expect(await screen.findByText('Auditoria dos dois conjuntos')).toBeInTheDocument();
  });

  it('cada entrada mostra a fase', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    expect(await screen.findByText('Auditoria')).toBeInTheDocument();
  });

  it('cada entrada lista as ações', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    expect(await screen.findByText('Conferido o orçamento diário')).toBeInTheDocument();
  });

  it('cada entrada mostra as métricas e a decisão', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    expect(await screen.findByText('Manter o conjunto PT.')).toBeInTheDocument();
    expect(screen.getAllByText('Alcance').length).toBeGreaterThan(0);
    expect(screen.getByText('12 300')).toBeInTheDocument();
  });

  it('histórico vazio explica-se dentro do modal', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    expect(await screen.findByText('Ainda não há registos desta campanha.')).toBeInTheDocument();
  });

  it('o modal fecha no botão de fechar', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    await screen.findByText('Ainda não há registos desta campanha.');
    await utilizador.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByText('Ainda não há registos desta campanha.')).not.toBeInTheDocument());
  });

  it('o modal fecha com a tecla Esc', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    await screen.findByText('Ainda não há registos desta campanha.');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Ainda não há registos desta campanha.')).not.toBeInTheDocument());
  });

  it('guardar a data de fim envia-a com o fuso de Brasília', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    const campo = document.querySelector('input[type="datetime-local"]');
    fireEvent.change(campo, { target: { value: '2026-08-30T23:00' } });
    await utilizador.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(statsApi.campaignEndSet).toHaveBeenCalledWith('2026-08-30T23:00:00-03:00'));
  });

  it('guardar a data de fim avisa a Dra.', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    const campo = document.querySelector('input[type="datetime-local"]');
    fireEvent.change(campo, { target: { value: '2026-08-30T23:00' } });
    await utilizador.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Data de fim do engajamento guardada.')).toBeInTheDocument();
  });

  it('erro a guardar a data de fim é comunicado', async () => {
    statsApi.campaignEndSet.mockRejectedValue(new Error('sem permissões'));
    const { utilizador } = await abrir();
    await utilizador.click(await screen.findByRole('button', { name: /Ver histórico/ }));
    const campo = document.querySelector('input[type="datetime-local"]');
    fireEvent.change(campo, { target: { value: '2026-08-30T23:00' } });
    await utilizador.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Não foi possível guardar: sem permissões')).toBeInTheDocument();
  });

  it('campanha já terminada di-lo no cartão', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [], fim: '2020-01-01T10:00:00-03:00' });
    await abrir();
    expect(await screen.findByText(/Engajamento terminou/)).toBeInTheDocument();
  });

  it('campanha a decorrer mostra a contagem decrescente', async () => {
    const futuro = new Date(Date.now() + 3 * 86400000).toISOString();
    statsApi.campaignHistory.mockResolvedValue({ entries: [], fim: futuro });
    await abrir();
    expect(await screen.findByText(/faltam \d+d/)).toBeInTheDocument();
  });

  it('histórico em falha não deita a aba abaixo', async () => {
    statsApi.campaignHistory.mockRejectedValue(new Error('boom'));
    await abrir();
    expect(await screen.findByText('Sem registos ainda.')).toBeInTheDocument();
  });

  it('o cartão do histórico não mostra números podres', async () => {
    statsApi.campaignHistory.mockResolvedValue({ entries: [entrada()], fim: null });
    const { container } = await abrir();
    await screen.findByText(/1 registo/);
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — carregamento, erro e vazio
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — carregamento, erro e vazio', () => {
  const abrir = async (extra) => {
    const r = renderizar(<><CalendarPage />{extra}<DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };

  it('enquanto carrega mostra o esqueleto', () => {
    calendarApi.getAll.mockReturnValue(new Promise(() => {}));
    renderizar(<CalendarPage />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('erro da API aparece no ecrã', async () => {
    calendarApi.getAll.mockRejectedValue(new Error('Calendário indisponível'));
    renderizar(<CalendarPage />);
    expect(await screen.findByText('Calendário indisponível')).toBeInTheDocument();
  });

  it('erro nas parcelas também aparece', async () => {
    installmentsApi.list.mockRejectedValue(new Error('Parcelas em baixo'));
    renderizar(<CalendarPage />);
    expect(await screen.findByText('Parcelas em baixo')).toBeInTheDocument();
  });

  it('calendário sem nada não mostra números podres', async () => {
    calendarApi.getAll.mockResolvedValue({ types: TIPOS, events: [] });
    const { container } = await abrir();
    semPodres(container);
  });

  it('calendário sem nada mostra zero vencimentos', async () => {
    calendarApi.getAll.mockResolvedValue({ types: TIPOS, events: [] });
    await abrir();
    expect(screen.getByText('0 vencimentos · € 0 previstos (EUR)')).toBeInTheDocument();
  });

  it('resposta sem tipos nem eventos não rebenta', async () => {
    calendarApi.getAll.mockResolvedValue({});
    const { container } = await abrir();
    semPodres(container);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — vistas e navegação
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — vistas e navegação', () => {
  const abrir = async () => {
    const r = renderizar(<><CalendarPage /><DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };
  const seguinte = () => document.querySelector('[data-tip="Período seguinte"]');
  const anterior = () => document.querySelector('[data-tip="Período anterior"]');

  it('abre no mês atual', async () => {
    await abrir();
    expect(screen.getByText(`${MESES_PT[MES]} · ${ANO}`)).toBeInTheDocument();
  });

  it('mostra os sete dias da semana em português', async () => {
    await abrir();
    for (const d of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) {
      expect(screen.getByText(d)).toBeInTheDocument();
    }
  });

  it('a grelha tem sempre semanas completas', async () => {
    await abrir();
    expect(document.querySelectorAll('.gcal-day').length % 7).toBe(0);
  });

  it('a grelha tem todos os dias do mês', async () => {
    await abrir();
    const nums = [...document.querySelectorAll('.gcal-day:not(.muted) .gcal-daynum')].map((n) => n.textContent);
    expect(nums).toHaveLength(DIAS_NO_MES);
  });

  it('o dia de hoje vem assinalado', async () => {
    await abrir();
    const hoje = document.querySelector('.gcal-day.today .gcal-daynum');
    expect(hoje.textContent).toBe(String(HOJE.getDate()));
  });

  it('avançar um mês muda o título', async () => {
    await abrir();
    fireEvent.click(seguinte());
    const d = new Date(ANO, MES + 1, 1);
    expect(await screen.findByText(`${MESES_PT[d.getMonth()]} · ${d.getFullYear()}`)).toBeInTheDocument();
  });

  it('recuar um mês muda o título', async () => {
    await abrir();
    fireEvent.click(anterior());
    const d = new Date(ANO, MES - 1, 1);
    expect(await screen.findByText(`${MESES_PT[d.getMonth()]} · ${d.getFullYear()}`)).toBeInTheDocument();
  });

  it('avançar e recuar volta ao mês atual', async () => {
    await abrir();
    fireEvent.click(seguinte());
    fireEvent.click(anterior());
    expect(await screen.findByText(`${MESES_PT[MES]} · ${ANO}`)).toBeInTheDocument();
  });

  it('doze avanços mudam o ano', async () => {
    await abrir();
    for (let i = 0; i < 12; i++) fireEvent.click(seguinte());
    expect(await screen.findByText(`${MESES_PT[MES]} · ${ANO + 1}`)).toBeInTheDocument();
  });

  it('«Hoje» traz de volta o mês atual', async () => {
    const { utilizador } = await abrir();
    fireEvent.click(seguinte());
    fireEvent.click(seguinte());
    await utilizador.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(await screen.findByText(`${MESES_PT[MES]} · ${ANO}`)).toBeInTheDocument();
  });

  it('tem as cinco vistas', async () => {
    await abrir();
    for (const v of ['MÊS', 'SEMANA', 'DIA', 'LISTA', '30 DIAS']) {
      expect(screen.getByRole('button', { name: v })).toBeInTheDocument();
    }
  });

  it('a vista de semana muda o título', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'SEMANA' }));
    expect(await screen.findByText(/^Semana de /)).toBeInTheDocument();
  });

  it('a vista de dia mostra a data por extenso', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'DIA' }));
    const esperado = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    expect(await screen.findByText(esperado)).toBeInTheDocument();
  });

  it('a vista de 30 dias tem título próprio', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: '30 DIAS' }));
    expect(await screen.findByText('Próximos 30 dias')).toBeInTheDocument();
  });

  it('a vista de lista mostra os eventos do mês', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    expect(await screen.findByText('Audiência de julgamento')).toBeInTheDocument();
  });

  it('na vista de lista cada evento traz a data por extenso', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    const esperado = new Date(noMes(10) + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    expect(await screen.findByText(new RegExp(esperado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('mês sem eventos na lista di-lo', async () => {
    calendarApi.getAll.mockResolvedValue({ types: TIPOS, events: [] });
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    expect(await screen.findByText('Sem eventos no período.')).toBeInTheDocument();
  });

  it('na vista de dia a navegação anda um dia de cada vez', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'DIA' }));
    fireEvent.click(seguinte());
    const amanha = new Date(HOJE); amanha.setDate(amanha.getDate() + 1);
    const esperado = amanha.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    expect(await screen.findByText(esperado)).toBeInTheDocument();
  });

  // CORRIGIDO (era): Calendar.jsx:531 e :533 — os botões de período anterior/seguinte só
  // levam um ícone e um data-tip; não têm texto nem aria-label, por isso não
  // têm nome acessível nenhum (leitor de ecrã anuncia "botão").
  it('os botões de navegação deviam ter nome acessível', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: /seguinte/i })).toBeInTheDocument();
  });

  // CORRIGIDO (era): Calendar.jsx:316 — `d.setMonth(d.getMonth() + dir)` num dia 31 salta o
  // mês seguinte quando este tem 30 dias (31 de agosto + 1 mês = 31 de setembro
  // = 1 de outubro). Basta a Dra. navegar pela vista de dia até ao dia 31 e
  // voltar à vista de mês para setembro desaparecer da navegação.
  it('avançar um mês a partir do dia 31 não devia saltar um mês', async () => {
    const { utilizador } = await abrir();
    // encontrar o próximo dia 31 seguido de um mês com menos de 31 dias
    let passos = 0; const d = new Date(HOJE);
    for (let i = 0; i < 400; i++) {
      d.setDate(d.getDate() + 1);
      if (d.getDate() === 31 && new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate() < 31) { passos = i + 1; break; }
    }
    await utilizador.click(screen.getByRole('button', { name: 'DIA' }));
    for (let i = 0; i < passos; i++) fireEvent.click(seguinte());
    await utilizador.click(screen.getByRole('button', { name: 'MÊS' }));
    fireEvent.click(seguinte());
    const esperado = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    expect(await screen.findByText(`${MESES_PT[esperado.getMonth()]} · ${esperado.getFullYear()}`)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — eventos, feriados e vencimentos na grelha
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — eventos, feriados e vencimentos na grelha', () => {
  const abrir = async (dados, parcelas) => {
    if (dados) calendarApi.getAll.mockResolvedValue(dados);
    if (parcelas) installmentsApi.list.mockResolvedValue({ installments: parcelas });
    const r = renderizar(<><CalendarPage /><DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };
  const celula = (dia) => [...document.querySelectorAll('.gcal-day:not(.muted)')]
    .find((c) => c.querySelector('.gcal-daynum')?.textContent === String(dia));
  // cada chip escreve o título duas vezes: a etiqueta visível e o popover de
  // detalhe que só aparece ao passar o rato. A etiqueta é a primeira.
  const etiqueta = (dia, titulo) => within(celula(dia)).getAllByText(titulo)[0];

  it('o evento aparece no dia certo', async () => {
    await abrir();
    expect(etiqueta(10, 'Audiência de julgamento')).toBeInTheDocument();
  });

  it('o evento não aparece noutro dia', async () => {
    await abrir();
    expect(within(celula(11)).queryByText('Audiência de julgamento')).not.toBeInTheDocument();
  });

  it('evento que atravessa a meia-noite aparece nos dois dias', async () => {
    await abrir({ types: TIPOS, events: [evento({ start_date: noMes(12), end_date: noMes(13), title: 'Vigília' })] });
    expect(etiqueta(12, 'Vigília')).toBeInTheDocument();
    expect(etiqueta(13, '· Vigília')).toBeInTheDocument();
  });

  it('o dia de continuação marca-se com um ponto', async () => {
    await abrir({ types: TIPOS, events: [evento({ start_date: noMes(12), end_date: noMes(14), title: 'Congresso' })] });
    expect(norm(celula(13).textContent)).toContain('· Congresso');
    expect(norm(celula(12).textContent)).not.toContain('· Congresso');
  });

  it('evento de três dias ocupa os três dias', async () => {
    await abrir({ types: TIPOS, events: [evento({ start_date: noMes(12), end_date: noMes(14), title: 'Congresso' })] });
    for (const d of [12, 13, 14]) expect(norm(celula(d).textContent)).toContain('Congresso');
    expect(norm(celula(15).textContent)).not.toContain('Congresso');
  });

  it('os feriados aparecem na grelha', async () => {
    await abrir({ types: TIPOS, events: [feriado()] });
    expect(etiqueta(15, 'Feriado de teste')).toBeInTheDocument();
  });

  it('os feriados não se editam pela grelha (vêm do sistema)', async () => {
    await abrir({ types: TIPOS, events: [feriado()] });
    fireEvent.click(etiqueta(15, 'Feriado de teste'));
    expect(screen.queryByRole('heading', { name: 'Editar evento' })).not.toBeInTheDocument();
  });

  it('esconder os feriados tira-os da grelha', async () => {
    const { utilizador } = await abrir({ types: TIPOS, events: [feriado()] });
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Feriados nacionais/ }));
    await waitFor(() => expect(screen.queryAllByText('Feriado de teste')).toHaveLength(0));
  });

  it('o vencimento de uma parcela aparece no dia', async () => {
    await abrir(null, [parcela({ due_date: noMes(20), amount: 400 })]);
    expect(norm(celula(20).textContent)).toContain('€ 400');
  });

  it('o resumo do mês conta os vencimentos', async () => {
    await abrir({ types: TIPOS, events: [] }, [parcela({ due_date: noMes(20), amount: 400 })]);
    expect(screen.getByText('1 vencimentos · € 400 previstos (EUR)')).toBeInTheDocument();
  });

  it('o resumo do mês soma as parcelas em euros', async () => {
    await abrir({ types: TIPOS, events: [] }, [
      parcela({ id: 'a', due_date: noMes(20), amount: 400 }),
      parcela({ id: 'b', due_date: noMes(21), amount: 350 }),
    ]);
    expect(screen.getByText('2 vencimentos · € 750 previstos (EUR)')).toBeInTheDocument();
  });

  it('as parcelas em reais não entram no total em euros', async () => {
    await abrir({ types: TIPOS, events: [] }, [
      parcela({ id: 'a', due_date: noMes(20), amount: 400 }),
      parcela({ id: 'b', due_date: noMes(21), amount: 1000, currency: 'BRL' }),
    ]);
    expect(screen.getByText('2 vencimentos · € 400 previstos (EUR)')).toBeInTheDocument();
  });

  it('a legenda explica as cores dos vencimentos', async () => {
    await abrir();
    for (const l of ['Pago', 'A vencer', 'Atrasado']) expect(screen.getByText(l)).toBeInTheDocument();
  });

  it('a legenda lista os tipos visíveis', async () => {
    await abrir();
    expect(screen.getAllByText('Prazos processuais').length).toBeGreaterThan(0);
  });

  it('parcela em reais aparece com R$', async () => {
    await abrir(null, [parcela({ due_date: noMes(20), amount: 500, currency: 'BRL' })]);
    expect(norm(celula(20).textContent)).toContain('R$ 500');
  });

  // BUG: Calendar.jsx:26 — a forma compacta usa o ponto decimal inglês
  // ("€ 1.2k") num ecrã que é todo em português (o resto usa vírgula decimal e
  // ponto de milhares). Numa grelha em que "1.2" se lê como mil e duzentos, é
  // um número ambíguo em cima de dinheiro.
  it.fails('o valor compacto devia usar a vírgula decimal portuguesa', async () => {
    await abrir(null, [parcela({ due_date: noMes(20), amount: 1200 })]);
    expect(norm(celula(20).textContent)).toContain('€ 1,2k');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — detalhe do dia e pesquisa
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — detalhe do dia e pesquisa', () => {
  const abrir = async (dados, parcelas) => {
    if (dados) calendarApi.getAll.mockResolvedValue(dados);
    if (parcelas) installmentsApi.list.mockResolvedValue({ installments: parcelas });
    const r = renderizar(<><CalendarPage /><DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };
  const celula = (dia) => [...document.querySelectorAll('.gcal-day:not(.muted)')]
    .find((c) => c.querySelector('.gcal-daynum')?.textContent === String(dia));

  it('clicar num dia abre o detalhe com a data por extenso', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(celula(10));
    const esperado = new Date(noMes(10) + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    expect(await screen.findByText(`Dia ${esperado}`)).toBeInTheDocument();
  });

  it('o detalhe mostra os eventos desse dia', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(celula(10));
    await waitFor(() => expect(screen.getAllByText('Tribunal de Lisboa, sala 3.').length).toBeGreaterThan(1));
  });

  it('dia sem eventos di-lo em vez de ficar em branco', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(celula(18));
    expect(await screen.findByText('Sem eventos no período.')).toBeInTheDocument();
  });

  it('o detalhe do dia oferece criar um evento nesse dia', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(celula(18));
    expect(await screen.findByRole('button', { name: /Adicionar evento neste dia/ })).toBeInTheDocument();
  });

  it('o detalhe mostra os vencimentos do dia', async () => {
    const { utilizador } = await abrir(null, [parcela({ due_date: noMes(20), amount: 400 })]);
    await utilizador.click(celula(20));
    expect(await screen.findByText('parcela 1/3', { exact: false })).toBeInTheDocument();
  });

  it('cada vencimento liga à ficha do cliente', async () => {
    const { utilizador } = await abrir(null, [parcela({ due_date: noMes(20) })]);
    await utilizador.click(celula(20));
    expect(await screen.findByRole('link', { name: 'Maria Silva' })).toHaveAttribute('href', '/admin/clientes/c1');
  });

  it('o estado da parcela aparece como selo', async () => {
    const { utilizador } = await abrir(null, [parcela({ due_date: noMes(20), status: 'late' })]);
    await utilizador.click(celula(20));
    // 'Atrasado' também está na legenda das cores — no detalhe passa a haver dois
    await waitFor(() => expect(screen.getAllByText('Atrasado')).toHaveLength(2));
  });

  it('parcela paga mostra o selo Pago', async () => {
    const { utilizador } = await abrir(null, [parcela({ due_date: noMes(20), status: 'paid' })]);
    await utilizador.click(celula(20));
    expect(await screen.findAllByText('Pago')).not.toHaveLength(0);
  });

  it('a pesquisa filtra os eventos pelo título', async () => {
    const { utilizador } = await abrir({
      types: TIPOS, events: [evento(), evento({ id: 'ev2', title: 'Reunião com o cliente', start_date: noMes(11) })],
    });
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), 'Audiência');
    await waitFor(() => expect(screen.queryAllByText('Reunião com o cliente')).toHaveLength(0));
    expect(screen.getAllByText('Audiência de julgamento').length).toBeGreaterThan(0);
  });

  it('a pesquisa também procura na referência do processo', async () => {
    const { utilizador } = await abrir();
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), '1289/26');
    expect(screen.getAllByText('Audiência de julgamento').length).toBeGreaterThan(0);
  });

  it('a pesquisa também procura no nome do cliente', async () => {
    const { utilizador } = await abrir();
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), 'maria');
    expect(screen.getAllByText('Audiência de julgamento').length).toBeGreaterThan(0);
  });

  it('pesquisa sem resultados esvazia a grelha', async () => {
    const { utilizador } = await abrir();
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), 'zzz');
    await waitFor(() => expect(screen.queryAllByText('Audiência de julgamento')).toHaveLength(0));
  });

  it('a pesquisa filtra os vencimentos pelo cliente', async () => {
    const { utilizador } = await abrir(null, [parcela({ due_date: noMes(20), amount: 400 })]);
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), 'Bruno');
    await waitFor(() => expect(screen.getByText('0 vencimentos · € 0 previstos (EUR)')).toBeInTheDocument());
  });

  it('limpar a pesquisa devolve tudo', async () => {
    const { utilizador } = await abrir();
    await utilizador.type(screen.getByPlaceholderText('Pesquisar eventos, clientes, processos…'), 'zzz');
    await waitFor(() => expect(screen.queryAllByText('Audiência de julgamento')).toHaveLength(0));
    await utilizador.click(screen.getByRole('button', { name: '✕' }));
    await waitFor(() => expect(screen.getAllByText('Audiência de julgamento').length).toBeGreaterThan(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — criar, editar e apagar eventos
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — criar, editar e apagar eventos', () => {
  const abrir = async (dados) => {
    if (dados) calendarApi.getAll.mockResolvedValue(dados);
    const r = renderizar(<><CalendarPage /><DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };
  const campo = (rotulo) => screen.getByText(rotulo).closest('label').querySelector('input, select, textarea');

  it('o botão Evento abre o modal de criação', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    expect(await screen.findByRole('heading', { name: /Novo evento/ })).toBeInTheDocument();
  });

  it('o modal de criação nasce com a data de hoje', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    expect(campo('Data inicial *')).toHaveValue(chave(HOJE));
  });

  it('criar um evento envia o que a Dra. escreveu', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Escritura na conservatória');
    fireEvent.change(campo('Data inicial *'), { target: { value: noMes(22) } });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0]).toMatchObject({
      title: 'Escritura na conservatória', start_date: noMes(22), type_id: 'evento_pessoal',
    });
  });

  it('depois de criar recarrega o calendário', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Escritura');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.getAll).toHaveBeenCalledTimes(2));
  });

  it('depois de criar o modal fecha', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Escritura');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Novo evento/ })).not.toBeInTheDocument());
  });

  it('sem título recusa e explica porquê', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('Título, tipo e data inicial são obrigatórios.')).toBeInTheDocument();
    expect(calendarApi.createEvent).not.toHaveBeenCalled();
  });

  it('título só com espaços conta como vazio', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), '   ');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('Título, tipo e data inicial são obrigatórios.')).toBeInTheDocument();
  });

  it('sem data inicial recusa', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Sem data');
    fireEvent.change(campo('Data inicial *'), { target: { value: '' } });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('Título, tipo e data inicial são obrigatórios.')).toBeInTheDocument();
  });

  it('data final anterior à inicial é recusada', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Ao contrário');
    fireEvent.change(campo('Data inicial *'), { target: { value: noMes(20) } });
    fireEvent.change(campo('Data final (opcional)'), { target: { value: noMes(10) } });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('A data final não pode ser anterior à inicial.')).toBeInTheDocument();
    expect(calendarApi.createEvent).not.toHaveBeenCalled();
  });

  it('data final igual à inicial é aceite', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Um dia só');
    fireEvent.change(campo('Data inicial *'), { target: { value: noMes(20) } });
    fireEvent.change(campo('Data final (opcional)'), { target: { value: noMes(20) } });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
  });

  it('evento que atravessa a meia-noite guarda as duas datas', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Plantão da meia-noite');
    fireEvent.change(campo('Data inicial *'), { target: { value: noMes(20) } });
    fireEvent.change(campo('Data final (opcional)'), { target: { value: noMes(21) } });
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0]).toMatchObject({ start_date: noMes(20), end_date: noMes(21) });
  });

  it('sem data final envia null e não string vazia', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Só um dia');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0].end_date).toBeNull();
  });

  it('sem valor o montante vai a zero e não em NaN', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Sem valor');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0].amount).toBe(0);
  });

  it('o tipo financeiro faz aparecer o valor e a moeda', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.selectOptions(campo('Tipo de data *'), 'financeiro');
    expect(screen.getByText('Valor')).toBeInTheDocument();
    expect(screen.getByText('Moeda')).toBeInTheDocument();
  });

  it('o valor com vírgula decimal é convertido', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Honorários');
    await utilizador.selectOptions(campo('Tipo de data *'), 'financeiro');
    await utilizador.type(campo('Valor'), '250,50');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0].amount).toBe(250.5);
  });

  it('a moeda pode ser o real', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Honorários BR');
    await utilizador.selectOptions(campo('Tipo de data *'), 'financeiro');
    await utilizador.selectOptions(campo('Moeda'), 'BRL');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0].currency).toBe('BRL');
  });

  // CORRIGIDO (era): Calendar.jsx:353 — `String(f.amount).replace(',', '.')` só troca a
  // primeira vírgula e não tira o ponto de milhares. Um valor escrito à
  // portuguesa ("1.200,50") vira parseFloat("1.200.50") = 1.2 e o evento fica
  // guardado com €1,20 em vez de €1200,50.
  it('valor com ponto de milhares devia ser guardado por inteiro', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Honorários');
    await utilizador.selectOptions(campo('Tipo de data *'), 'financeiro');
    await utilizador.type(campo('Valor'), '1.200,50');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(calendarApi.createEvent).toHaveBeenCalled());
    expect(calendarApi.createEvent.mock.calls[0][0].amount).toBe(1200.5);
  });

  it('erro da API a criar é comunicado', async () => {
    calendarApi.createEvent.mockRejectedValue(new Error('conflito de horário'));
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.type(campo('Título *'), 'Vai falhar');
    await utilizador.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('Erro: conflito de horário')).toBeInTheDocument();
  });

  it('cancelar fecha o modal sem gravar', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Evento/ }));
    await screen.findByRole('heading', { name: /Novo evento/ });
    await utilizador.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Novo evento/ })).not.toBeInTheDocument());
    expect(calendarApi.createEvent).not.toHaveBeenCalled();
  });

  it('clicar num evento manual abre-o para edição', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getAllByText('Audiência de julgamento')[0]);
    expect(await screen.findByRole('heading', { name: /Editar evento/ })).toBeInTheDocument();
  });

  it('a edição traz os dados do evento', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getAllByText('Audiência de julgamento')[0]);
    await screen.findByRole('heading', { name: /Editar evento/ });
    expect(campo('Título *')).toHaveValue('Audiência de julgamento');
    expect(campo('Data inicial *')).toHaveValue(noMes(10));
  });

  it('guardar a edição chama a API com o id do evento', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getAllByText('Audiência de julgamento')[0]);
    await screen.findByRole('heading', { name: /Editar evento/ });
    await utilizador.clear(campo('Título *'));
    await utilizador.type(campo('Título *'), 'Audiência adiada');
    await utilizador.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calendarApi.updateEvent).toHaveBeenCalled());
    expect(calendarApi.updateEvent.mock.calls[0][0]).toBe('ev1');
    expect(calendarApi.updateEvent.mock.calls[0][1].title).toBe('Audiência adiada');
  });

  it('apagar pede confirmação', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await utilizador.click(await screen.findByRole('link', { name: 'Apagar' }));
    expect(await screen.findByText('Apagar o evento "Audiência de julgamento"?')).toBeInTheDocument();
  });

  it('confirmar apaga mesmo', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await utilizador.click(await screen.findByRole('link', { name: 'Apagar' }));
    await utilizador.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(calendarApi.deleteEvent).toHaveBeenCalledWith('ev1'));
  });

  it('cancelar a confirmação não apaga nada', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await utilizador.click(await screen.findByRole('link', { name: 'Apagar' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText(/Apagar o evento/)).not.toBeInTheDocument());
    expect(calendarApi.deleteEvent).not.toHaveBeenCalled();
  });

  it('a lista oferece editar o evento', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await utilizador.click(await screen.findByRole('link', { name: 'Editar' }));
    expect(await screen.findByRole('heading', { name: /Editar evento/ })).toBeInTheDocument();
  });

  it('eventos do sistema não oferecem editar nem apagar na lista', async () => {
    const { utilizador } = await abrir({ types: TIPOS, events: [feriado()] });
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await screen.findByText('Feriado de teste');
    expect(screen.queryByRole('link', { name: 'Apagar' })).not.toBeInTheDocument();
  });

  it('erro da API a apagar é comunicado', async () => {
    calendarApi.deleteEvent.mockRejectedValue(new Error('já não existe'));
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'LISTA' }));
    await utilizador.click(await screen.findByRole('link', { name: 'Apagar' }));
    await utilizador.click(await screen.findByRole('button', { name: 'OK' }));
    expect(await screen.findByText('Erro: já não existe')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO — filtros e tipos de data
// ═════════════════════════════════════════════════════════════════════════════
describe('Calendário — filtros e tipos de data', () => {
  const abrir = async () => {
    const r = renderizar(<><CalendarPage /><DialogHost /></>);
    await screen.findByRole('heading', { name: 'Calendário', level: 1 });
    return r;
  };

  it('o painel de filtros abre e fecha', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(screen.getByRole('button', { name: /Selecionar todos/ })).toBeInTheDocument();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(screen.queryByRole('button', { name: /Selecionar todos/ })).not.toBeInTheDocument();
  });

  it('desmarcar um tipo esconde os seus eventos', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Prazos processuais/ }));
    await waitFor(() => expect(screen.queryAllByText('Audiência de julgamento')).toHaveLength(0));
  });

  it('a escolha dos filtros fica guardada no browser', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Prazos processuais/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vyvian_cal_visibility')).processo).toBe(false));
  });

  it('desselecionar todos esconde tudo', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Desselecionar todos/ }));
    await waitFor(() => expect(screen.queryAllByText('Audiência de julgamento')).toHaveLength(0));
  });

  it('selecionar todos traz tudo de volta', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Desselecionar todos/ }));
    await waitFor(() => expect(screen.queryAllByText('Audiência de julgamento')).toHaveLength(0));
    await utilizador.click(screen.getByRole('button', { name: /Selecionar todos/ }));
    await waitFor(() => expect(screen.getAllByText('Audiência de julgamento').length).toBeGreaterThan(0));
  });

  it('os tipos ocultos aparecem como badges quando o painel está fechado', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Prazos processuais/ }));
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(await screen.findByText('Ocultos:')).toBeInTheDocument();
  });

  it('o botão de filtros conta os tipos ativos', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: /Filtros/ }));
    await utilizador.click(screen.getByRole('button', { name: /Prazos processuais/ }));
    expect(await screen.findByRole('button', { name: /Filtros \(5\/6\)/ })).toBeInTheDocument();
  });

  it('o gestor de tipos lista todos os tipos', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    const modal = (await screen.findByRole('heading', { name: 'Tipos de data' })).closest('.gcal-modal');
    for (const t of TIPOS) expect(within(modal).getByText(t.label)).toBeInTheDocument();
  });

  it('os tipos nativos não se apagam', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    const modal = (await screen.findByRole('heading', { name: 'Tipos de data' })).closest('.gcal-modal');
    expect(within(modal).getAllByRole('link', { name: 'Apagar' })).toHaveLength(1); // só o personalizado
  });

  it('o tipo personalizado vem assinalado', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    expect(await screen.findByText('personalizado')).toBeInTheDocument();
  });

  it('criar um tipo exige a label', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    await utilizador.click(await screen.findByRole('button', { name: /Criar tipo personalizado/ }));
    await utilizador.click(screen.getByRole('button', { name: 'Guardar tipo' }));
    expect(await screen.findByText('A label é obrigatória.')).toBeInTheDocument();
  });

  it('criar um tipo envia label, cor e descrição', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    await utilizador.click(await screen.findByRole('button', { name: /Criar tipo personalizado/ }));
    await utilizador.type(screen.getByText('Label *').closest('label').querySelector('input'), 'Notário');
    await utilizador.click(screen.getByRole('button', { name: 'Guardar tipo' }));
    await waitFor(() => expect(calendarApi.createType).toHaveBeenCalled());
    expect(calendarApi.createType.mock.calls[0][0].label).toBe('Notário');
  });

  it('apagar um tipo pergunta o que fazer aos eventos', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    const modal = (await screen.findByRole('heading', { name: 'Tipos de data' })).closest('.gcal-modal');
    await utilizador.click(within(modal).getByRole('link', { name: 'Apagar' }));
    expect(await screen.findByText(/o que fazer aos eventos deste tipo/)).toBeInTheDocument();
  });

  it('apagar o tipo e os eventos usa a estratégia delete', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    const modal = (await screen.findByRole('heading', { name: 'Tipos de data' })).closest('.gcal-modal');
    await utilizador.click(within(modal).getByRole('link', { name: 'Apagar' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar eventos também' }));
    await waitFor(() => expect(calendarApi.deleteType).toHaveBeenCalledWith('conservatoria', 'delete'));
  });

  it('mover os eventos usa a estratégia move', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    const modal = (await screen.findByRole('heading', { name: 'Tipos de data' })).closest('.gcal-modal');
    await utilizador.click(within(modal).getByRole('link', { name: 'Apagar' }));
    await utilizador.click(await screen.findByRole('button', { name: /Mover para/ }));
    await waitFor(() => expect(calendarApi.deleteType).toHaveBeenCalledWith('conservatoria', 'move'));
  });

  it('o gestor de tipos fecha no botão do rodapé', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    await screen.findByRole('heading', { name: 'Tipos de data' });
    const fechar = screen.getAllByRole('button', { name: 'Fechar' });
    await utilizador.click(fechar[fechar.length - 1]);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Tipos de data' })).not.toBeInTheDocument());
  });

  it('o gestor de tipos fecha no ✕ do canto', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Tipos de data' }));
    await screen.findByRole('heading', { name: 'Tipos de data' });
    await utilizador.click(screen.getAllByRole('button', { name: 'Fechar' })[0]);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Tipos de data' })).not.toBeInTheDocument());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — preferências e destinos
// ═════════════════════════════════════════════════════════════════════════════
describe('Notificações — preferências e destinos', () => {
  const abrir = async (dados) => {
    if (dados) notifApi.getOwnerPrefs.mockResolvedValue(dados);
    const r = renderizar(<><Notifications /><ToastHost /></>);
    await screen.findByRole('heading', { name: 'Notificações', level: 1 });
    return r;
  };

  it('enquanto carrega mostra o esqueleto', () => {
    notifApi.getOwnerPrefs.mockReturnValue(new Promise(() => {}));
    renderizar(<Notifications />);
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('erro ao carregar aparece no ecrã', async () => {
    notifApi.getOwnerPrefs.mockRejectedValue(new Error('sem preferências'));
    renderizar(<Notifications />);
    expect(await screen.findByText('sem preferências')).toBeInTheDocument();
  });

  it('lista os quatro alertas', async () => {
    await abrir();
    for (const a of ['Pagamento vence hoje', 'Pagamento ficou em atraso', 'Resumo diário de vencimentos', 'Pagamento recebido']) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });

  it('cada alerta explica-se', async () => {
    await abrir();
    expect(screen.getByText('Avisa quando um pagamento passa o prazo sem ser liquidado.')).toBeInTheDocument();
  });

  it('há uma coluna para email e outra para WhatsApp', async () => {
    await abrir();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('cada alerta tem dois interruptores identificados', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: 'Pagamento vence hoje por email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagamento vence hoje por whatsapp' })).toBeInTheDocument();
  });

  it('o interruptor mostra o estado guardado', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: 'Pagamento vence hoje por email' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pagamento vence hoje por whatsapp' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('alerta sem preferência guardada começa desligado', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: 'Pagamento recebido por email' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicar liga o interruptor', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    expect(screen.getByRole('button', { name: 'Pagamento recebido por email' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicar outra vez desliga', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento vence hoje por email' }));
    expect(screen.getByRole('button', { name: 'Pagamento vence hoje por email' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('mostra os destinos guardados', async () => {
    await abrir();
    expect(screen.getByDisplayValue('vyavena@gmail.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('351911831530')).toBeInTheDocument();
  });

  it('sem destinos os campos ficam vazios e não com "null"', async () => {
    await abrir(prefs({ contacts: { email: null, whatsapp: null } }));
    const campos = screen.getAllByRole('textbox');
    expect(campos.every((c) => c.value === '')).toBe(true);
  });

  it('avisa que um canal sem destino é ignorado', async () => {
    await abrir();
    expect(screen.getByText('Um alerta com canal ativo mas sem destino preenchido é simplesmente ignorado.')).toBeInTheDocument();
  });

  it('sem alterações o botão de guardar está desativado', async () => {
    await abrir();
    expect(screen.getByRole('button', { name: /Guardar alterações/ })).toBeDisabled();
  });

  it('mexer num interruptor ativa o botão de guardar', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    expect(screen.getByRole('button', { name: /Guardar alterações/ })).toBeEnabled();
  });

  it('escrever no destino ativa o botão de guardar', async () => {
    const { utilizador } = await abrir(prefs({ contacts: { email: '', whatsapp: '' } }));
    await utilizador.type(screen.getAllByRole('textbox')[0], 'a');
    expect(screen.getByRole('button', { name: /Guardar alterações/ })).toBeEnabled();
  });

  it('guardar envia as quatro preferências', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    await waitFor(() => expect(notifApi.updateOwnerPrefs).toHaveBeenCalled());
    expect(notifApi.updateOwnerPrefs.mock.calls[0][0].prefs).toHaveLength(4);
  });

  it('guardar envia o estado certo de cada canal', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    await waitFor(() => expect(notifApi.updateOwnerPrefs).toHaveBeenCalled());
    const enviado = notifApi.updateOwnerPrefs.mock.calls[0][0].prefs;
    expect(enviado.find((p) => p.alert_type === 'pagamento_recebido')).toMatchObject({ email_enabled: 1, whatsapp_enabled: 0 });
    expect(enviado.find((p) => p.alert_type === 'vence_hoje')).toMatchObject({ email_enabled: 1 });
  });

  it('guardar envia os destinos sem espaços à volta', async () => {
    const { utilizador } = await abrir(prefs({ contacts: { email: '  ', whatsapp: '351911831530' } }));
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    await waitFor(() => expect(notifApi.updateOwnerPrefs).toHaveBeenCalled());
    expect(notifApi.updateOwnerPrefs.mock.calls[0][0].contacts).toEqual({ email: null, whatsapp: '351911831530' });
  });

  it('guardar avisa a Dra.', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    expect(await screen.findByText('Preferências de alertas guardadas')).toBeInTheDocument();
  });

  it('depois de guardar o botão volta a ficar desativado', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Guardado/ })).toBeDisabled());
  });

  it('erro a guardar aparece no ecrã', async () => {
    notifApi.updateOwnerPrefs.mockRejectedValue(new Error('sem permissões'));
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Pagamento recebido por email' }));
    await utilizador.click(screen.getByRole('button', { name: /Guardar alterações/ }));
    expect(await screen.findByText('sem permissões')).toBeInTheDocument();
  });

  it('a página explica que os lembretes aos clientes vivem noutro sítio', async () => {
    await abrir();
    expect(contem(null, 'configuram-se na ficha de cada cliente')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — histórico de envios e modelos
// ═════════════════════════════════════════════════════════════════════════════
describe('Notificações — histórico de envios e modelos', () => {
  const registo = (over = {}) => ({
    alert_type: 'vence_hoje', channel: 'email', status: 'sent',
    sent_at: '2026-08-01 10:30:00', message_preview: '2 pagamentos vencem hoje',
    error_message: null, ...over,
  });
  const abrir = async (dados) => {
    if (dados) notifApi.getOwnerPrefs.mockResolvedValue(dados);
    const r = renderizar(<><Notifications /><ToastHost /></>);
    await screen.findByRole('heading', { name: 'Notificações', level: 1 });
    return r;
  };

  it('sem envios o histórico não aparece', async () => {
    await abrir();
    expect(screen.queryByRole('heading', { name: 'Últimos alertas enviados' })).not.toBeInTheDocument();
  });

  it('com envios o histórico aparece', async () => {
    await abrir(prefs({ log: [registo()] }));
    expect(screen.getByRole('heading', { name: 'Últimos alertas enviados' })).toBeInTheDocument();
  });

  it('cada envio mostra o alerta por extenso', async () => {
    await abrir(prefs({ log: [registo()] }));
    expect(within(painelDe('Últimos alertas enviados')).getByText('Pagamento vence hoje')).toBeInTheDocument();
  });

  it('cada envio mostra a data e a hora em formato português', async () => {
    await abrir(prefs({ log: [registo()] }));
    const esperado = new Date('2026-08-01T10:30:00Z').toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    expect(contem(painelDe('Últimos alertas enviados'), esperado)).toBe(true);
  });

  it('cada envio mostra a pré-visualização da mensagem', async () => {
    await abrir(prefs({ log: [registo()] }));
    expect(contem(painelDe('Últimos alertas enviados'), '2 pagamentos vencem hoje')).toBe(true);
  });

  it('envio bem sucedido não é marcado como falhado', async () => {
    await abrir(prefs({ log: [registo()] }));
    expect(texto(painelDe('Últimos alertas enviados'))).not.toContain('falhou');
  });

  it('envio com erro é marcado como falhado', async () => {
    await abrir(prefs({ log: [registo({ status: 'error', error_message: 'endereço inválido' })] }));
    expect(contem(painelDe('Últimos alertas enviados'), 'falhou')).toBe(true);
  });

  it('o erro do envio é mostrado à Dra.', async () => {
    await abrir(prefs({ log: [registo({ status: 'error', error_message: 'endereço inválido' })] }));
    expect(within(painelDe('Últimos alertas enviados')).getByText('endereço inválido')).toBeInTheDocument();
  });

  it('alerta desconhecido mostra o código em vez de ficar vazio', async () => {
    await abrir(prefs({ log: [registo({ alert_type: 'inventado' })] }));
    expect(within(painelDe('Últimos alertas enviados')).getByText('inventado')).toBeInTheDocument();
  });

  it('envio sem data não mostra "undefined"', async () => {
    const { container } = await abrir(prefs({ log: [registo({ sent_at: null })] }));
    semPodres(container);
  });

  it('vários envios aparecem todos', async () => {
    await abrir(prefs({ log: [registo(), registo({ channel: 'whatsapp', alert_type: 'em_atraso' })] }));
    const bloco = painelDe('Últimos alertas enviados');
    expect(within(bloco).getByText('Pagamento vence hoje')).toBeInTheDocument();
    expect(within(bloco).getByText('Pagamento ficou em atraso')).toBeInTheDocument();
  });

  it('lista os modelos de mensagem', async () => {
    await abrir();
    expect(contem(painelDe('Modelos de mensagem'), 'Lembrete de vencimento')).toBe(true);
  });

  it('cada modelo diz o canal e o idioma', async () => {
    await abrir();
    expect(contem(painelDe('Modelos de mensagem'), 'email · pt-PT')).toBe(true);
  });

  it('as variáveis do modelo aparecem sem chavetas', async () => {
    await abrir();
    const bloco = painelDe('Modelos de mensagem');
    expect(within(bloco).getAllByText('cliente').length).toBeGreaterThan(0);
    expect(within(bloco).getByText('valor')).toBeInTheDocument();
  });

  it('o texto fixo do modelo mantém-se', async () => {
    await abrir();
    expect(contem(painelDe('Modelos de mensagem'), 'a parcela de')).toBe(true);
  });

  it('explica que as variáveis são substituídas no envio', async () => {
    await abrir();
    expect(contem(painelDe('Modelos de mensagem'), 'substituídas automaticamente')).toBe(true);
  });

  it('sem modelos a secção fica vazia mas não rebenta', async () => {
    notifApi.listTemplates.mockResolvedValue({ templates: [] });
    const { container } = await abrir();
    expect(screen.getByRole('heading', { name: 'Modelos de mensagem' })).toBeInTheDocument();
    semPodres(container);
  });

  it('modelo sem corpo não mostra "undefined"', async () => {
    notifApi.listTemplates.mockResolvedValue({ templates: [{ id: 't1', name: 'Vazio', channel: 'email', language: 'pt-PT', subject: null, body: null }] });
    const { container } = await abrir();
    semPodres(container);
  });

  it('a página inteira com dados não mostra números podres', async () => {
    const { container } = await abrir(prefs({ log: [registo(), registo({ status: 'error', error_message: 'x' })] }));
    semPodres(container);
  });

  it('a página inteira sem dados nenhuns não mostra números podres', async () => {
    notifApi.listTemplates.mockResolvedValue({ templates: [] });
    const { container } = await abrir({ prefs: [], contacts: { email: null, whatsapp: null }, log: [] });
    semPodres(container);
  });
});
