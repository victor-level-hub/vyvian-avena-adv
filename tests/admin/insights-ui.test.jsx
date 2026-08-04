// @vitest-environment jsdom
// tests/admin/insights-ui.test.jsx
// Estúdio de artigos das Redes Sociais — src/admin/insights/{InsightsSection,
// ArticleStudio,RichEditor}.jsx. É por aqui que sai conteúdo para o PÚBLICO:
// um erro neste ecrã não fica no escritório, vai para o blogue.
//
// As rotas e os prompts já estão cobertos em tests/worker/insights.test.js e
// tests/worker/prompts-ia.test.js — aqui testa-se só o ECRÃ: o que a Dra. vê,
// o que consegue clicar, e o que lhe é dito quando a API falha.
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderizar, screen, within, waitFor } from '../helpers/dom.jsx';

// ─── API mockada (a rede está fechada em tests/setup.js) ─────────────────────
const api = vi.hoisted(() => {
  const nomes = [
    'topics', 'refresh', 'generateArticle', 'generateFromTheme', 'freeArticles', 'getArticle',
    'insertImages', 'saveArticle', 'deleteArticle', 'previaLink', 'aiCorrect', 'generateImages',
    'chooseImage', 'imageUrl', 'imageBlob', 'replaceImage', 'imageBank', 'saveToBank',
    'removeFromBank', 'adoptFromBank', 'discardImage', 'keywords', 'evaluateArticle',
    'generateAudio', 'setReviewed', 'publishArticle', 'audioUrl', 'imageRules', 'addImageRule',
    'removeImageRule', 'sources', 'addSource', 'updateSource', 'removeSource',
  ];
  return Object.fromEntries(nomes.map((n) => [n, vi.fn()]));
});
vi.mock('../../src/admin/apiClient.js', () => ({
  insights: api,
  getToken: () => 'tok', setToken: vi.fn(), clearToken: vi.fn(),
}));

import InsightsSection from '../../src/admin/insights/InsightsSection.jsx';
import RichEditor from '../../src/admin/insights/RichEditor.jsx';
import ArticleStudio from '../../src/admin/insights/ArticleStudio.jsx';
import { ToastHost } from '../../src/admin/toasts.jsx';
import { DialogHost } from '../../src/admin/dialogs.jsx';

// ─── o que o jsdom não tem ───────────────────────────────────────────────────
// O TipTap/ProseMirror mede o texto para posicionar o cursor; sem Range com
// getClientRects/getBoundingClientRect e sem elementFromPoint, qualquer escrita
// no corpo do artigo rebenta o editor (e o teste).
beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) });
  const listaVazia = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = listaVazia;
  Range.prototype.getBoundingClientRect = rect;
  document.elementFromPoint = () => document.body;
  Element.prototype.scrollIntoView = function () {};
  // o Confetti pinta num <canvas>; o jsdom não tem contexto 2d
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {}, drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  });
  URL.createObjectURL = () => 'blob:falso';
  URL.revokeObjectURL = () => {};
  // o Reveal (rs/ui.jsx) revela os cartões com IntersectionObserver; o Chart mede
  // o contentor com ResizeObserver — nenhum dos dois existe no jsdom
  class Observador {
    constructor(cb) { this.cb = cb; }
    observe(alvo) { this.cb([{ target: alvo, isIntersecting: true, contentRect: { width: 800, height: 400 } }], this); }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  }
  globalThis.IntersectionObserver = Observador;
  globalThis.ResizeObserver = Observador;
  // o jsdom não reproduz áudio: o player da narração chama play()/pause()
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
});

// A área de transferência não existe no jsdom — o «Copiar link de prévia» precisa
// dela. Devolve o espião para o teste confirmar o que foi copiado. Chamar SEMPRE
// depois de renderizar: o userEvent.setup() instala uma área de transferência
// falsa dele em navigator.clipboard e apagaria este espião.
function espiarAreaDeTransferencia(impl = () => Promise.resolve()) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
  return writeText;
}
function semAreaDeTransferencia() {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
}

// ─── fábricas de dados ───────────────────────────────────────────────────────
const artigo = (extra = {}) => ({
  id: 7, titulo: 'Novas regras do IRN em 2026', descricao: 'O que muda para quem pede a nacionalidade.',
  markdown: '## O que muda\n\nTexto do artigo.', area: 'nacionalidade', idioma: 'pt-PT',
  imagem_escolhida: null, publicado_em: null, publicar_em: null, revisto_em: null,
  avaliacao: null, audio_key: null, audio_em: null, criado_em: '2026-08-01 09:00:00', ...extra,
});
const dadosArtigo = (extra = {}, images = [], ronda = 1) => ({ article: artigo(extra), images, ronda });
const imagem = (id, extra = {}) => ({ id, provider: 'gemini', banco_origem: null, ...extra });
const tema = (extra = {}) => ({
  id: 't1', titulo: 'Prazos do IRN mudam em setembro', resumo: 'Resumo do tema.',
  justificacao: 'Saiu ontem em Diário da República.', area: 'nacionalidade', score: 88,
  estado: 'novo', artigo_id: null, fontes: [{ nome: 'IRN', url: 'https://irn.justica.gov.pt/a' }], ...extra,
});
const fonte = (extra = {}) => ({
  id: 1, nome: 'IRN', url: 'https://irn.justica.gov.pt', tipo: 'governo',
  fiabilidade: 5, engajamento: 3, indicados: 4, resumo: 'Registos e notariado.', origem: 'diretorio', ...extra,
});
const noBanco = (extra = {}) => ({
  id: 1, image_id: 'img-b1', criado_em: '2026-07-20 10:00:00', artigo_titulo: 'Artigo antigo',
  article_id: 3, usos: [], ...extra,
});

// ─── invólucros de render ────────────────────────────────────────────────────
// O ToastHost e o DialogHost são montados a sério: as mensagens de erro e as
// confirmações são exatamente as que a Dra. vê, não espias.
const Hosts = () => <><ToastHost /><DialogHost /></>;

function Redes() { return <><InsightsSection /><Hosts /></>; }
function Estudio({ id = 7, onClose = () => {} }) {
  return <><ArticleStudio articleId={id} onClose={onClose} /><Hosts /></>;
}

const tituloDoArtigo = () => screen.findByLabelText('Título do artigo');
async function abrirEstudio(props = {}) {
  const r = renderizar(<Estudio {...props} />);
  await tituloDoArtigo();
  return r;
}
async function abrirVista(u, rotulo) { await u.click(screen.getByRole('button', { name: rotulo })); }

const botao = (nome) => screen.getByRole('button', { name: nome });
const guardarBtn = () => screen.getByRole('button', { name: /^(Guardar|Guardado|A guardar…)$/ });
const tabela = () => screen.getByRole('table');

beforeEach(() => {
  vi.clearAllMocks();
  api.topics.mockResolvedValue({ batch: null, topics: [] });
  api.freeArticles.mockResolvedValue({ articles: [] });
  api.imageBank.mockResolvedValue({ images: [] });
  api.sources.mockResolvedValue({ sources: [] });
  api.imageRules.mockResolvedValue({ rules: [] });
  api.getArticle.mockResolvedValue(dadosArtigo());
  api.imageUrl.mockResolvedValue('blob:img');
  api.imageBlob.mockResolvedValue(null);
  api.audioUrl.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllGlobals(); });

// ═════════════════════════════════════════════════════════════════════════════
// Aba Insights — navegação entre vistas
// ═════════════════════════════════════════════════════════════════════════════
describe('Insights — vistas', () => {
  it('abre nas Sugestões', async () => {
    renderizar(<Redes />);
    expect(await screen.findByText('Motor editorial')).toBeInTheDocument();
  });

  it('tem as quatro vistas', async () => {
    renderizar(<Redes />);
    for (const v of ['SUGESTÕES', 'TEMA LIVRE', 'IMAGENS', 'FONTES']) {
      expect(botao(v)).toBeInTheDocument();
    }
  });

  it('Tema livre mostra o campo do tema', async () => {
    const { utilizador } = renderizar(<Redes />);
    await abrirVista(utilizador, 'TEMA LIVRE');
    expect(await screen.findByText('Sobre o que quer escrever?')).toBeInTheDocument();
  });

  it('Imagens mostra o banco', async () => {
    const { utilizador } = renderizar(<Redes />);
    await abrirVista(utilizador, 'IMAGENS');
    expect(await screen.findByText('Banco de imagens')).toBeInTheDocument();
  });

  it('Fontes mostra o campo de adicionar fonte', async () => {
    const { utilizador } = renderizar(<Redes />);
    await abrirVista(utilizador, 'FONTES');
    expect(await screen.findByRole('button', { name: 'Adicionar fonte' })).toBeInTheDocument();
  });

  it('voltar às Sugestões traz o motor editorial de volta', async () => {
    const { utilizador } = renderizar(<Redes />);
    await abrirVista(utilizador, 'FONTES');
    await abrirVista(utilizador, 'SUGESTÕES');
    expect(await screen.findByText('Motor editorial')).toBeInTheDocument();
  });

  it('só a vista escolhida está visível de cada vez', async () => {
    const { utilizador } = renderizar(<Redes />);
    await abrirVista(utilizador, 'TEMA LIVRE');
    expect(screen.queryByText('Motor editorial')).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sugestões — listagem de temas
// ═════════════════════════════════════════════════════════════════════════════
describe('Sugestões — listagem', () => {
  it('sem temas convida à primeira pesquisa', async () => {
    renderizar(<Redes />);
    expect(await screen.findByText('Descubra o que vai engajar')).toBeInTheDocument();
  });

  it('sem temas diz que ainda não há sugestões', async () => {
    renderizar(<Redes />);
    expect(await screen.findByText(/Ainda sem sugestões/)).toBeInTheDocument();
  });

  it('com temas mostra o título de cada um', async () => {
    api.topics.mockResolvedValue({ batch: { criado_em: '2026-08-01 09:00:00' }, topics: [tema(), tema({ id: 't2', titulo: 'Outro tema' })] });
    renderizar(<Redes />);
    expect(await screen.findByRole('heading', { name: 'Prazos do IRN mudam em setembro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Outro tema' })).toBeInTheDocument();
  });

  it('mostra o resumo do tema', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    renderizar(<Redes />);
    expect(await screen.findByText('Resumo do tema.')).toBeInTheDocument();
  });

  it('mostra o «porquê agora»', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    renderizar(<Redes />);
    expect(await screen.findByText('Porquê agora')).toBeInTheDocument();
    expect(screen.getByText('Saiu ontem em Diário da República.')).toBeInTheDocument();
  });

  it('mostra a área jurídica do tema', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    renderizar(<Redes />);
    expect(await screen.findByText('Nacionalidade')).toBeInTheDocument();
  });

  it('o primeiro tema é marcado como o de maior potencial', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema(), tema({ id: 't2' })] });
    renderizar(<Redes />);
    expect(await screen.findByText('Maior potencial')).toBeInTheDocument();
  });

  it('mostra o score de engajamento', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ score: 91 })] });
    renderizar(<Redes />);
    expect((await screen.findAllByText('91')).length).toBeGreaterThan(0);
  });

  it('tema sem score não mostra barra de potencial', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ score: null })] });
    renderizar(<Redes />);
    await screen.findByRole('heading', { name: 'Prazos do IRN mudam em setembro' });
    expect(screen.queryByText('/100')).not.toBeInTheDocument();
  });

  it('mostra quantas fontes confirmam o tema', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ fontes: [{ nome: 'A', url: 'https://a.pt' }, { nome: 'B', url: 'https://b.pt' }] })] });
    renderizar(<Redes />);
    expect(await screen.findByText('Fontes (2)')).toBeInTheDocument();
  });

  it('as fontes são links que abrem noutro separador', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    renderizar(<Redes />);
    const link = await screen.findByRole('link', { name: 'IRN' });
    expect(link).toHaveAttribute('href', 'https://irn.justica.gov.pt/a');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('mostra só três fontes e conta as restantes', async () => {
    const fontes = [1, 2, 3, 4, 5].map((n) => ({ nome: `F${n}`, url: `https://f${n}.pt` }));
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ fontes })] });
    renderizar(<Redes />);
    expect(await screen.findByText('+2')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'F4' })).not.toBeInTheDocument();
  });

  it('tema por gerar mostra «Gerar artigo»', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    renderizar(<Redes />);
    expect(await screen.findByRole('button', { name: 'Gerar artigo' })).toBeInTheDocument();
  });

  it('tema já gerado mostra «Abrir artigo» e a marca de rascunho pronto', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ estado: 'artigo_gerado', artigo_id: 7 })] });
    renderizar(<Redes />);
    expect(await screen.findByRole('button', { name: 'Abrir artigo' })).toBeInTheDocument();
    expect(screen.getByText('Artigo gerado')).toBeInTheDocument();
  });

  it('mostra a data da última atualização', async () => {
    api.topics.mockResolvedValue({ batch: { criado_em: '2026-08-01 09:00:00' }, topics: [tema()] });
    renderizar(<Redes />);
    expect(await screen.findByText(/última atualização/)).toBeInTheDocument();
  });

  it('falha a carregar os temas mostra o erro à Dra.', async () => {
    api.topics.mockRejectedValue(new Error('502 no servidor'));
    renderizar(<Redes />);
    expect(await screen.findByText('502 no servidor')).toBeInTheDocument();
  });

  it('falha a carregar os temas não parte o ecrã', async () => {
    api.topics.mockRejectedValue(new Error('502 no servidor'));
    renderizar(<Redes />);
    await screen.findByText('502 no servidor');
    expect(botao('Atualizar')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sugestões — pesquisa de novos temas
// ═════════════════════════════════════════════════════════════════════════════
describe('Sugestões — atualizar', () => {
  it('Atualizar chama a pesquisa com os títulos já publicados', async () => {
    api.refresh.mockResolvedValue({ batch: {}, topics: [tema()] });
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(Array.isArray(api.refresh.mock.calls[0][0])).toBe(true);
  });

  it('enquanto pesquisa mostra os passos narrados', async () => {
    api.refresh.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    expect(await screen.findByText('A pesquisar temas com potencial (1–2 min)')).toBeInTheDocument();
    expect(screen.getByText('A consultar o diretório de fontes…')).toBeInTheDocument();
  });

  it('enquanto pesquisa o botão Atualizar fica bloqueado', async () => {
    api.refresh.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    await waitFor(() => expect(botao('Atualizar')).toBeDisabled());
  });

  it('pesquisa concluída anuncia os 10 temas novos', async () => {
    api.refresh.mockResolvedValue({ batch: {}, topics: [tema()] });
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    expect(await screen.findByText('Sugestões atualizadas — 10 novos temas.')).toBeInTheDocument();
  });

  it('pesquisa concluída substitui a lista', async () => {
    api.refresh.mockResolvedValue({ batch: {}, topics: [tema({ titulo: 'Tema fresquinho' })] });
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    expect(await screen.findByRole('heading', { name: 'Tema fresquinho' })).toBeInTheDocument();
  });

  it('pesquisa falhada mostra o erro dentro do loader', async () => {
    api.refresh.mockRejectedValue(new Error('a IA não respondeu'));
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    expect(await screen.findByText('a IA não respondeu')).toBeInTheDocument();
  });

  it('pesquisa falhada oferece tentar novamente', async () => {
    api.refresh.mockRejectedValue(new Error('a IA não respondeu'));
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    await screen.findByText('a IA não respondeu');
    expect(botao('Tentar novamente')).toBeInTheDocument();
  });

  it('tentar novamente repete a pesquisa', async () => {
    api.refresh.mockRejectedValueOnce(new Error('falhou')).mockResolvedValue({ batch: {}, topics: [tema()] });
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    await screen.findByText('falhou');
    await utilizador.click(botao('Tentar novamente'));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
  });

  it('fechar o loader de erro devolve o ecrã à Dra.', async () => {
    api.refresh.mockRejectedValue(new Error('falhou'));
    const { utilizador } = renderizar(<Redes />);
    await screen.findByText('Descubra o que vai engajar');
    await utilizador.click(botao('Atualizar'));
    await screen.findByText('falhou');
    await utilizador.click(botao('Fechar'));
    await waitFor(() => expect(screen.queryByText('A consultar o diretório de fontes…')).not.toBeInTheDocument());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sugestões — gerar o artigo a partir de um tema
// ═════════════════════════════════════════════════════════════════════════════
describe('Sugestões — gerar artigo', () => {
  it('Gerar artigo envia o id do tema', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    await waitFor(() => expect(api.generateArticle).toHaveBeenCalledWith('t1'));
  });

  it('enquanto gera mostra os passos do artigo', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    expect(await screen.findByText('A reunir as fontes do tema…')).toBeInTheDocument();
  });

  it('enquanto gera o loader diz de que área é o artigo', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    expect(await screen.findByText(/A gerar artigo · Nacionalidade/)).toBeInTheDocument();
  });

  it('enquanto gera bloqueia os outros temas', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema(), tema({ id: 't2', titulo: 'Segundo' })] });
    api.generateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click((await screen.findAllByRole('button', { name: 'Gerar artigo' }))[0]);
    await waitFor(() => {
      for (const b of screen.getAllByRole('button', { name: 'Gerar artigo' })) expect(b).toBeDisabled();
    });
  });

  it('artigo gerado abre o estúdio', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockResolvedValue({ article: { id: 7 } });
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    expect(await screen.findByLabelText('Título do artigo', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('gerar falhado mostra o erro no loader', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockRejectedValue(new Error('sem quota na IA'));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    expect(await screen.findByText('sem quota na IA')).toBeInTheDocument();
  });

  it('gerar falhado deixa fechar sem abrir artigo nenhum', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema()] });
    api.generateArticle.mockRejectedValue(new Error('sem quota na IA'));
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Gerar artigo' }));
    await screen.findByText('sem quota na IA');
    await utilizador.click(botao('Fechar'));
    expect(screen.queryByLabelText('Título do artigo')).not.toBeInTheDocument();
  });

  it('tema já gerado abre o artigo sem chamar a geração', async () => {
    api.topics.mockResolvedValue({ batch: {}, topics: [tema({ artigo_id: 7, estado: 'artigo_gerado' })] });
    const { utilizador } = renderizar(<Redes />);
    await utilizador.click(await screen.findByRole('button', { name: 'Abrir artigo' }));
    await tituloDoArtigo();
    expect(api.generateArticle).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Tema livre — a Dra. escreve o assunto
// ═════════════════════════════════════════════════════════════════════════════
const irParaTemaLivre = async (u) => {
  await abrirVista(u, 'TEMA LIVRE');
  return screen.findByPlaceholderText(/Ex\.: O que muda para os nômades digitais/);
};

describe('Tema livre', () => {
  it('o campo do tema começa vazio', async () => {
    const { utilizador } = renderizar(<Redes />);
    expect(await irParaTemaLivre(utilizador)).toHaveValue('');
  });

  it('sem tema escrito o botão está bloqueado', async () => {
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    expect(botao('Gerar artigo')).toBeDisabled();
  });

  it('escrever o tema desbloqueia o botão', async () => {
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8 em 2026');
    expect(botao('Gerar artigo')).toBeEnabled();
  });

  it('tema só com espaços não conta', async () => {
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, '   ');
    expect(botao('Gerar artigo')).toBeDisabled();
  });

  it('o contador acompanha o que se escreve', async () => {
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'abcde');
    expect(screen.getByText('5/300')).toBeInTheDocument();
  });

  it('o tema está limitado a 300 caracteres', async () => {
    const { utilizador } = renderizar(<Redes />);
    expect(await irParaTemaLivre(utilizador)).toHaveAttribute('maxlength', '300');
  });

  it('gerar envia o tema escrito', async () => {
    api.generateFromTheme.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8 em 2026');
    await utilizador.click(botao('Gerar artigo'));
    await waitFor(() => expect(api.generateFromTheme).toHaveBeenCalledWith('Visto D8 em 2026'));
  });

  it('gerar tira os espaços à volta do tema', async () => {
    api.generateFromTheme.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, '  Visto D8  ');
    await utilizador.click(botao('Gerar artigo'));
    await waitFor(() => expect(api.generateFromTheme).toHaveBeenCalledWith('Visto D8'));
  });

  it('enquanto gera mostra os passos do tema livre', async () => {
    api.generateFromTheme.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    expect(await screen.findByText('A pesquisar o tema nas fontes oficiais e na imprensa…')).toBeInTheDocument();
  });

  it('enquanto gera o campo fica bloqueado', async () => {
    api.generateFromTheme.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    await waitFor(() => expect(campo).toBeDisabled());
  });

  it('artigo gerado abre o estúdio', async () => {
    api.generateFromTheme.mockResolvedValue({ article: { id: 7 } });
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    expect(await screen.findByLabelText('Título do artigo', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('artigo gerado limpa o campo do tema', async () => {
    api.generateFromTheme.mockResolvedValue({ article: { id: 7 } });
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    await waitFor(() => expect(campo).toHaveValue(''));
  });

  it('gerar falhado mostra o erro sem perder o tema escrito', async () => {
    api.generateFromTheme.mockRejectedValue(new Error('a pesquisa web falhou'));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    expect(await screen.findByText('a pesquisa web falhou')).toBeInTheDocument();
    expect(campo).toHaveValue('Visto D8');
  });

  it('gerar falhado deixa tentar novamente', async () => {
    api.generateFromTheme.mockRejectedValueOnce(new Error('falhou')).mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    await utilizador.type(campo, 'Visto D8');
    await utilizador.click(botao('Gerar artigo'));
    await screen.findByText('falhou');
    await utilizador.click(botao('Tentar novamente'));
    await waitFor(() => expect(api.generateFromTheme).toHaveBeenCalledTimes(2));
  });

  it('sem temas anteriores não mostra a lista', async () => {
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    expect(screen.queryByText('Temas livres anteriores')).not.toBeInTheDocument();
  });

  it('com temas anteriores lista-os', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    expect(await screen.findByText('Rascunho antigo')).toBeInTheDocument();
    expect(screen.getByText('Temas livres anteriores')).toBeInTheDocument();
  });

  it('conta os artigos anteriores', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3 }), artigo({ id: 4, titulo: 'B' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    expect(await screen.findByText('2 artigos')).toBeInTheDocument();
  });

  it('um só artigo anterior fica no singular', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3 })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    expect(await screen.findByText('1 artigo')).toBeInTheDocument();
  });

  it('clicar num artigo anterior abre-o no estúdio', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 7, titulo: 'Rascunho antigo' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByText('Rascunho antigo'));
    await tituloDoArtigo();
    expect(api.getArticle).toHaveBeenCalledWith(7);
  });

  it('apagar um rascunho pede confirmação', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar «Rascunho antigo»' }));
    expect(await screen.findByText(/Apagar «Rascunho antigo» definitivamente\?/)).toBeInTheDocument();
  });

  it('cancelar a confirmação não apaga nada', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar «Rascunho antigo»' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.deleteArticle).not.toHaveBeenCalled();
  });

  it('confirmar apaga o rascunho e avisa', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    api.deleteArticle.mockResolvedValue({ ok: true });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar «Rascunho antigo»' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar artigo' }));
    await waitFor(() => expect(api.deleteArticle).toHaveBeenCalledWith(3));
    expect(await screen.findByText('Artigo apagado.')).toBeInTheDocument();
  });

  it('apagar falhado mostra o erro', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    api.deleteArticle.mockRejectedValue(new Error('já foi publicado'));
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar «Rascunho antigo»' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar artigo' }));
    expect(await screen.findByText('Não foi possível apagar: já foi publicado')).toBeInTheDocument();
  });

  it('apagar não abre o artigo por engano', async () => {
    api.freeArticles.mockResolvedValue({ articles: [artigo({ id: 3, titulo: 'Rascunho antigo' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaTemaLivre(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar «Rascunho antigo»' }));
    await screen.findByText(/definitivamente/);
    expect(screen.queryByLabelText('Título do artigo')).not.toBeInTheDocument();
  });

  it('falha a listar os anteriores não parte o ecrã', async () => {
    api.freeArticles.mockRejectedValue(new Error('502'));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaTemaLivre(utilizador);
    expect(campo).toBeInTheDocument();
    expect(screen.queryByText('Temas livres anteriores')).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Banco de Imagens (vista IMAGENS)
// ═════════════════════════════════════════════════════════════════════════════
const irParaImagens = async (u) => { await abrirVista(u, 'IMAGENS'); return screen.findByText('Banco de imagens'); };
const cartaoDaImagem = async () => (await screen.findByRole('button', { name: 'Ver em grande' })).closest('.glass');
const removerDoBanco = async (u) => u.click(within(await cartaoDaImagem()).getAllByRole('button').at(-1));

describe('Banco de Imagens', () => {
  it('banco vazio explica como guardar imagens', async () => {
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByText('Ainda sem imagens guardadas')).toBeInTheDocument();
  });

  it('mostra quantas imagens estão guardadas', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco(), noBanco({ id: 2, image_id: 'img-b2' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByText('2 imagens')).toBeInTheDocument();
  });

  it('uma imagem fica no singular', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByText('1 imagem')).toBeInTheDocument();
  });

  it('mostra a data em que a imagem foi guardada', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByText('Guardada a 20/07/2026')).toBeInTheDocument();
  });

  it('mostra o artigo de origem da imagem', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByRole('button', { name: 'Artigo antigo' })).toBeInTheDocument();
  });

  it('clicar no artigo de origem abre-o no estúdio', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco({ article_id: 7 })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Artigo antigo' }));
    await tituloDoArtigo();
    expect(api.getArticle).toHaveBeenCalledWith(7);
  });

  it('mostra em que artigos a imagem está em uso', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco({ usos: [{ article_id: 9, titulo: 'Outro artigo' }] })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByRole('button', { name: 'NO ARTIGO 9' })).toBeInTheDocument();
  });

  it('a imagem abre em grande', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Ver em grande' }));
    expect(await screen.findByRole('dialog', { name: 'Imagem ampliada' })).toBeInTheDocument();
  });

  it('a ampliação fecha no botão Fechar', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Ver em grande' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Imagem ampliada' })).not.toBeInTheDocument());
  });

  it('remover do banco pede confirmação', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await removerDoBanco(utilizador);
    expect(await screen.findByText(/Remover esta imagem do banco\?/)).toBeInTheDocument();
  });

  it('confirmar remove a imagem e diz que o ficheiro foi apagado', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    api.removeFromBank.mockResolvedValue({ apagada: true });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await removerDoBanco(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.removeFromBank).toHaveBeenCalledWith('img-b1'));
    expect(await screen.findByText('Imagem removida do banco e apagada do armazenamento.')).toBeInTheDocument();
  });

  it('imagem ainda em uso diz que o ficheiro se mantém', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    api.removeFromBank.mockResolvedValue({ apagada: false });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await removerDoBanco(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(await screen.findByText(/O ficheiro mantém-se por ainda estar em uso/)).toBeInTheDocument();
  });

  it('cancelar a remoção não chama a API', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await removerDoBanco(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.removeFromBank).not.toHaveBeenCalled();
  });

  it('remover falhado mostra o erro', async () => {
    api.imageBank.mockResolvedValue({ images: [noBanco()] });
    api.removeFromBank.mockRejectedValue(new Error('o R2 recusou'));
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await removerDoBanco(utilizador);
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('o R2 recusou')).toBeInTheDocument();
  });

  it('falha a carregar o banco mostra o erro', async () => {
    api.imageBank.mockRejectedValue(new Error('502 no banco'));
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    expect(await screen.findByText('502 no banco')).toBeInTheDocument();
  });

  // CORRIGIDO (era): InsightsSection.jsx:419 — quando api.imageBank() falha, o catch só faz
  // toast e deixa `imagens` a null: o ecrã fica preso no esqueleto de carregamento
  // para sempre. O BancoPicker do estúdio (ArticleStudio.jsx:1216) trata o mesmo
  // caso com setItens([]) — aqui devia cair no estado vazio em vez de deixar a
  // Dra. a olhar para um carregamento eterno depois de o toast desaparecer.
  it('falha a carregar o banco devia sair do estado de carregamento', async () => {
    api.imageBank.mockRejectedValue(new Error('502 no banco'));
    const { utilizador } = renderizar(<Redes />);
    await irParaImagens(utilizador);
    await screen.findByText('502 no banco');
    expect(screen.getByText('Ainda sem imagens guardadas')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Fontes acompanhadas (vista FONTES)
// ═════════════════════════════════════════════════════════════════════════════
// A vista desenha a tabela (desktop) E os cartões (telemóvel) — no jsdom estão
// as duas no DOM, por isso tudo o que é por fonte se procura dentro da tabela.
const irParaFontes = async (u) => {
  await abrirVista(u, 'FONTES');
  return screen.findByPlaceholderText(/Cole o link de um site/);
};
const linhaDaFonte = (nome) => within(tabela()).getByRole('link', { name: nome }).closest('tr');
// o campo do admPrompt vive dentro da caixa do diálogo, ao lado da pergunta
const campoDoPrompt = (pergunta) => screen.getByText(pergunta).parentElement.querySelector('input');
const PERGUNTA_RESUMO = 'Resumo do canal (que temas costuma tratar):';

describe('Fontes — listagem', () => {
  it('mostra o campo de colar o link', async () => {
    const { utilizador } = renderizar(<Redes />);
    expect(await irParaFontes(utilizador)).toBeInTheDocument();
  });

  it('o campo aceita só endereços', async () => {
    const { utilizador } = renderizar(<Redes />);
    expect(await irParaFontes(utilizador)).toHaveAttribute('type', 'url');
  });

  it('explica quanto tempo demora a classificação', async () => {
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(screen.getByText(/A classificação automática leva 20–40 s/)).toBeInTheDocument();
  });

  it('conta os canais do diretório', async () => {
    api.sources.mockResolvedValue({ sources: [fonte(), fonte({ id: 2, nome: 'SEF' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(await screen.findByText('Diretório · 2 canais')).toBeInTheDocument();
  });

  it('um canal fica no singular', async () => {
    api.sources.mockResolvedValue({ sources: [fonte()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(await screen.findByText('Diretório · 1 canal')).toBeInTheDocument();
  });

  it('a fonte é um link para o canal', async () => {
    api.sources.mockResolvedValue({ sources: [fonte()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByRole('table');
    expect(within(tabela()).getByRole('link', { name: 'IRN' })).toHaveAttribute('href', 'https://irn.justica.gov.pt');
  });

  it('mostra o domínio do canal sem o www', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ url: 'https://www.publico.pt', nome: 'Público' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect((await screen.findAllByText('publico.pt')).length).toBeGreaterThan(0);
  });

  it('URL inválido guardado no servidor não parte a listagem', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ url: 'isto-não-é-um-link' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect((await screen.findAllByText('isto-não-é-um-link')).length).toBeGreaterThan(0);
  });

  it('mostra o tipo do canal por extenso', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ tipo: 'instagram' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect((await screen.findAllByText('Instagram')).length).toBeGreaterThan(0);
  });

  it('mostra a fiabilidade e o engajamento em níveis', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ fiabilidade: 5, engajamento: 2 })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByRole('table');
    const niveis = within(linhaDaFonte('IRN')).getAllByRole('slider');
    expect(niveis[0]).toHaveAttribute('aria-valuenow', '5');
    expect(niveis[1]).toHaveAttribute('aria-valuenow', '2');
  });

  it('mostra quantos temas citaram a fonte', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ indicados: 12 })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByRole('table');
    expect(within(linhaDaFonte('IRN')).getByText('12')).toBeInTheDocument();
  });

  it('fonte sem resumo mostra um travessão', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ resumo: '' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByRole('table');
    expect(within(linhaDaFonte('IRN')).getByText('—')).toBeInTheDocument();
  });

  it('fontes acrescentadas pela Dra. ficam marcadas', async () => {
    api.sources.mockResolvedValue({ sources: [fonte({ origem: 'manual' })] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(await screen.findByText('1 adicionada pela Dra.')).toBeInTheDocument();
  });

  it('sem fontes manuais não há a marca da Dra.', async () => {
    api.sources.mockResolvedValue({ sources: [fonte()] });
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByRole('table');
    expect(screen.queryByText(/adicionada pela Dra\./)).not.toBeInTheDocument();
  });

  it('falha a carregar as fontes mostra o erro', async () => {
    api.sources.mockRejectedValue(new Error('503 no diretório'));
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(await screen.findByText('503 no diretório')).toBeInTheDocument();
  });

  // CORRIGIDO (era): InsightsSection.jsx:575 — igual ao Banco de Imagens: o catch só faz
  // toast e deixa `fontes` a null, por isso o diretório fica preso no esqueleto
  // de carregamento e a Dra. nunca vê a lista nem um estado vazio honesto.
  it('falha a carregar as fontes devia sair do estado de carregamento', async () => {
    api.sources.mockRejectedValue(new Error('503 no diretório'));
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    await screen.findByText('503 no diretório');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('Fontes — acrescentar', () => {
  it('sem link o botão está bloqueado', async () => {
    const { utilizador } = renderizar(<Redes />);
    await irParaFontes(utilizador);
    expect(botao('Adicionar fonte')).toBeDisabled();
  });

  it('link só com espaços não desbloqueia', async () => {
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, '   ');
    expect(botao('Adicionar fonte')).toBeDisabled();
  });

  it('colar um link desbloqueia o botão', async () => {
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://novo.pt');
    expect(botao('Adicionar fonte')).toBeEnabled();
  });

  it('acrescentar envia o link', async () => {
    api.addSource.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://novo.pt');
    await utilizador.click(botao('Adicionar fonte'));
    await waitFor(() => expect(api.addSource).toHaveBeenCalledWith('https://novo.pt'));
  });

  it('enquanto analisa mostra os passos e bloqueia o campo', async () => {
    api.addSource.mockReturnValue(new Promise(() => {}));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://novo.pt');
    await utilizador.click(botao('Adicionar fonte'));
    expect(await screen.findByText('A abrir o link e a ler o canal…')).toBeInTheDocument();
    expect(campo).toBeDisabled();
  });

  it('fonte classificada pela IA é anunciada pelo nome', async () => {
    api.addSource.mockResolvedValue({ source: { id: 9, nome: 'Diário da República' }, preenchido_por_ia: true });
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://dre.pt');
    await utilizador.click(botao('Adicionar fonte'));
    expect(await screen.findByText('Fonte «Diário da República» adicionada — campos preenchidos pela IA.')).toBeInTheDocument();
  });

  it('fonte que a IA não identificou pede revisão', async () => {
    api.addSource.mockResolvedValue({ source: { id: 9, nome: 'novo.pt' }, preenchido_por_ia: false });
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://novo.pt');
    await utilizador.click(botao('Adicionar fonte'));
    expect(await screen.findByText('Fonte adicionada. Não consegui identificar o canal; reveja os campos.')).toBeInTheDocument();
  });

  it('acrescentar limpa o campo e recarrega a lista', async () => {
    api.addSource.mockResolvedValue({ source: { id: 9, nome: 'Novo' }, preenchido_por_ia: true });
    api.sources.mockResolvedValueOnce({ sources: [] }).mockResolvedValue({ sources: [fonte({ id: 9, nome: 'Novo', url: 'https://novo.pt' })] });
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://novo.pt');
    await utilizador.click(botao('Adicionar fonte'));
    await waitFor(() => expect(campo).toHaveValue(''));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('URL recusado pelo servidor mostra a mensagem sem limpar o campo', async () => {
    api.addSource.mockRejectedValue(new Error('URL inválido'));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://xxx');
    await utilizador.click(botao('Adicionar fonte'));
    expect(await screen.findByText('URL inválido')).toBeInTheDocument();
    expect(campo).toHaveValue('https://xxx');
  });

  it('depois de falhar dá para tentar outra vez', async () => {
    api.addSource.mockRejectedValue(new Error('URL inválido'));
    const { utilizador } = renderizar(<Redes />);
    const campo = await irParaFontes(utilizador);
    await utilizador.type(campo, 'https://xxx');
    await utilizador.click(botao('Adicionar fonte'));
    await screen.findByText('URL inválido');
    expect(campo).toBeEnabled();
    expect(botao('Adicionar fonte')).toBeEnabled();
  });
});

describe('Fontes — editar e remover', () => {
  const comUmaFonte = async () => {
    api.sources.mockResolvedValue({ sources: [fonte()] });
    const r = renderizar(<Redes />);
    await irParaFontes(r.utilizador);
    await screen.findByRole('table');
    return r;
  };
  const botoesDaLinha = () => within(linhaDaFonte('IRN')).getAllByRole('button');

  it('mudar a fiabilidade guarda o novo nível', async () => {
    api.updateSource.mockResolvedValue({ ok: true });
    const { utilizador } = await comUmaFonte();
    const barra = within(linhaDaFonte('IRN')).getAllByRole('slider')[0];
    await utilizador.click(barra);
    await waitFor(() => expect(api.updateSource).toHaveBeenCalledWith(1, expect.objectContaining({ fiabilidade: expect.any(Number) })));
  });

  it('mudar o engajamento guarda o novo nível', async () => {
    api.updateSource.mockResolvedValue({ ok: true });
    const { utilizador } = await comUmaFonte();
    const barra = within(linhaDaFonte('IRN')).getAllByRole('slider')[1];
    await utilizador.click(barra);
    await waitFor(() => expect(api.updateSource).toHaveBeenCalledWith(1, expect.objectContaining({ engajamento: expect.any(Number) })));
  });

  it('mudar o nível falhado mostra o erro', async () => {
    api.updateSource.mockRejectedValue(new Error('sem permissões'));
    const { utilizador } = await comUmaFonte();
    await utilizador.click(within(linhaDaFonte('IRN')).getAllByRole('slider')[0]);
    expect(await screen.findByText('sem permissões')).toBeInTheDocument();
  });

  it('editar o resumo abre o diálogo com o texto atual', async () => {
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-2));
    expect(await screen.findByText(PERGUNTA_RESUMO)).toBeInTheDocument();
    expect(campoDoPrompt(PERGUNTA_RESUMO)).toHaveValue('Registos e notariado.');
  });

  it('guardar o resumo novo escreve-o na tabela', async () => {
    api.updateSource.mockResolvedValue({ ok: true });
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-2));
    await screen.findByText(PERGUNTA_RESUMO);
    const campo = campoDoPrompt(PERGUNTA_RESUMO);
    await utilizador.clear(campo);
    await utilizador.type(campo, 'Só nacionalidade.');
    await utilizador.click(botao('OK'));
    await waitFor(() => expect(api.updateSource).toHaveBeenCalledWith(1, { resumo: 'Só nacionalidade.' }));
    await waitFor(() => expect(within(tabela()).getAllByText('Só nacionalidade.').length).toBeGreaterThan(0));
    expect(screen.queryByText('Registos e notariado.')).not.toBeInTheDocument();
  });

  it('cancelar o resumo não chama a API', async () => {
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-2));
    await screen.findByText(PERGUNTA_RESUMO);
    await utilizador.click(botao('Cancelar'));
    expect(api.updateSource).not.toHaveBeenCalled();
  });

  it('guardar o resumo falhado mostra o erro', async () => {
    api.updateSource.mockRejectedValue(new Error('502'));
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-2));
    await screen.findByText(PERGUNTA_RESUMO);
    await utilizador.click(botao('OK'));
    expect(await screen.findByText('502')).toBeInTheDocument();
  });

  it('remover pede confirmação com o nome da fonte', async () => {
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-1));
    expect(await screen.findByText('Remover a fonte «IRN» da lista?')).toBeInTheDocument();
  });

  it('confirmar remove a fonte da lista', async () => {
    api.removeSource.mockResolvedValue({ ok: true });
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-1));
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.removeSource).toHaveBeenCalledWith(1));
    expect(await screen.findByText('Fonte removida.')).toBeInTheDocument();
  });

  it('cancelar não remove nada', async () => {
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-1));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.removeSource).not.toHaveBeenCalled();
  });

  it('remover falhado mostra o erro e mantém a fonte', async () => {
    api.removeSource.mockRejectedValue(new Error('fonte em uso'));
    const { utilizador } = await comUmaFonte();
    await utilizador.click(botoesDaLinha().at(-1));
    await utilizador.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('fonte em uso')).toBeInTheDocument();
    expect(within(tabela()).getByRole('link', { name: 'IRN' })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio do artigo — abrir e fechar
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — abrir', () => {
  it('enquanto carrega diz que está a abrir o artigo', async () => {
    api.getArticle.mockReturnValue(new Promise(() => {}));
    renderizar(<Estudio />);
    expect(await screen.findByText('A abrir o artigo…')).toBeInTheDocument();
  });

  it('pede o artigo pelo id', async () => {
    await abrirEstudio({ id: 42 });
    expect(api.getArticle).toHaveBeenCalledWith(42);
  });

  it('mostra o título guardado', async () => {
    await abrirEstudio();
    expect(screen.getByLabelText('Título do artigo')).toHaveValue('Novas regras do IRN em 2026');
  });

  it('mostra a área jurídica do artigo', async () => {
    await abrirEstudio();
    expect(screen.getByText('Nacionalidade')).toBeInTheDocument();
  });

  it('a área aparece por extenso quando o blogue lhe dá nome longo', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ area: 'familia' }));
    await abrirEstudio();
    expect(screen.getByText('Direito de Família')).toBeInTheDocument();
  });

  it('artigo sem área conhecida cai em «Blogue»', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ area: 'inventada' }));
    await abrirEstudio();
    expect(screen.getByText('Blogue')).toBeInTheDocument();
  });

  it('mostra o idioma do artigo', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ idioma: 'pt-BR' }));
    await abrirEstudio();
    expect(screen.getByText('PT-BR')).toBeInTheDocument();
  });

  it('mostra o tempo de leitura', async () => {
    await abrirEstudio();
    expect(screen.getByText(/min de leitura/)).toBeInTheDocument();
  });

  it('o estúdio é um diálogo identificado', async () => {
    await abrirEstudio();
    expect(screen.getByRole('dialog', { name: 'Editor do artigo' })).toBeInTheDocument();
  });

  it('falha a abrir o artigo mostra o erro', async () => {
    api.getArticle.mockRejectedValue(new Error('artigo não encontrado'));
    renderizar(<Estudio />);
    expect(await screen.findByText('artigo não encontrado')).toBeInTheDocument();
  });

  it('falha a abrir o artigo fecha o estúdio', async () => {
    api.getArticle.mockRejectedValue(new Error('artigo não encontrado'));
    const fechou = vi.fn();
    renderizar(<Estudio onClose={fechou} />);
    await waitFor(() => expect(fechou).toHaveBeenCalled());
  });

  it('Voltar sem alterações fecha sem perguntar nada', async () => {
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await utilizador.click(botao('Voltar'));
    await waitFor(() => expect(fechou).toHaveBeenCalled());
    expect(screen.queryByText('Guardar as alterações antes de fechar?')).not.toBeInTheDocument();
  });

  it('Voltar com alterações pergunta se quer guardar', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Voltar'));
    expect(await screen.findByText('Guardar as alterações antes de fechar?')).toBeInTheDocument();
  });

  it('«Guardar e fechar» guarda antes de sair', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Voltar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Guardar e fechar' }));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
    await waitFor(() => expect(fechou).toHaveBeenCalled());
  });

  it('«Sair sem guardar» fecha sem chamar a API', async () => {
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Voltar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Sair sem guardar' }));
    await waitFor(() => expect(fechou).toHaveBeenCalled());
    expect(api.saveArticle).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — título e descrição SEO
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — título e descrição', () => {
  const descricaoDoArtigo = () => document.querySelectorAll('textarea')[1];

  it('o título é editável à mão', async () => {
    const { utilizador } = await abrirEstudio();
    const t = screen.getByLabelText('Título do artigo');
    await utilizador.clear(t);
    await utilizador.type(t, 'Outro título');
    expect(t).toHaveValue('Outro título');
  });

  it('o título não tem limite de escrita (os gerados chegam nos 120)', async () => {
    await abrirEstudio();
    expect(screen.getByLabelText('Título do artigo')).not.toHaveAttribute('maxlength');
  });

  it('título curto não mostra aviso de SEO', async () => {
    await abrirEstudio();
    expect(screen.queryByText(/o SEO trava títulos acima de 60/)).not.toBeInTheDocument();
  });

  it('título acima de 60 avisa que o SEO o trava', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ titulo: 'T'.repeat(61) }));
    await abrirEstudio();
    expect(screen.getByText(/61\/60 — o SEO trava títulos acima de 60/)).toBeInTheDocument();
  });

  it('título acima de 120 avisa que vai ser cortado ao guardar', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ titulo: 'T'.repeat(121) }));
    await abrirEstudio();
    expect(screen.getByText(/acima de 120 é cortado ao guardar/)).toBeInTheDocument();
  });

  it('a descrição SEO mostra o contador', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ descricao: 'x'.repeat(30) }));
    await abrirEstudio();
    expect(screen.getByText('30/155')).toBeInTheDocument();
  });

  it('a descrição SEO acompanha o que se escreve', async () => {
    const { utilizador } = await abrirEstudio();
    const d = descricaoDoArtigo();
    await utilizador.clear(d);
    await utilizador.type(d, 'Resumo novo');
    expect(screen.getByText('11/155')).toBeInTheDocument();
  });

  it('a descrição SEO está travada nos 200 caracteres', async () => {
    await abrirEstudio();
    expect(descricaoDoArtigo()).toHaveAttribute('maxlength', '200');
  });

  it('a lista de verificação aprova a descrição dentro dos 155', async () => {
    await abrirEstudio();
    expect(screen.getByText('Descrição SEO ≤ 155')).toBeInTheDocument();
  });

  it('a lista de verificação cobre título, descrição, capa e aviso legal', async () => {
    await abrirEstudio();
    for (const l of ['Aviso legal incluído', 'Capa escolhida', 'Descrição SEO ≤ 155', 'Título ≤ 60 caracteres']) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
  });

  it('escrever no título marca o artigo como por guardar', async () => {
    const { utilizador } = await abrirEstudio();
    expect(guardarBtn()).toHaveTextContent('Guardado');
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    expect(guardarBtn()).toHaveTextContent('Guardar');
  });

  it('escrever na descrição marca o artigo como por guardar', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.type(descricaoDoArtigo(), '!');
    expect(guardarBtn()).toHaveTextContent('Guardar');
  });

  // BUG: ArticleStudio.jsx:608 — a caixa da descrição SEO não tem rótulo
  // acessível nenhum (nem aria-label, nem <label>, nem id): o «Descrição SEO»
  // ao lado é um <span class="overline">. O título logo acima tem
  // aria-label="Título do artigo" (linha 597) — a descrição devia ter o
  // equivalente, senão quem usa leitor de ecrã ouve só «caixa de texto».
  it.fails('a descrição SEO devia ter rótulo acessível, como o título', async () => {
    await abrirEstudio();
    expect(screen.getByLabelText(/Descrição SEO/)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — guardar
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — guardar', () => {
  it('guardar envia título, descrição e corpo', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.evaluateArticle.mockResolvedValue({ avaliacao: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(guardarBtn());
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalledWith(7, expect.objectContaining({
      titulo: 'Novas regras do IRN em 2026!',
      descricao: 'O que muda para quem pede a nacionalidade.',
      markdown: expect.stringContaining('O que muda'),
    })));
  });

  it('guardar avisa que a IA vai avaliar o texto', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.evaluateArticle.mockResolvedValue({ avaliacao: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    expect(await screen.findByText('Artigo guardado — a IA está a avaliar o novo texto…')).toBeInTheDocument();
  });

  it('guardar dispara a avaliação da IA', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.evaluateArticle.mockResolvedValue({ avaliacao: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    await waitFor(() => expect(api.evaluateArticle).toHaveBeenCalledWith(7));
  });

  it('enquanto guarda o botão diz «A guardar…»', async () => {
    api.saveArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    await waitFor(() => expect(guardarBtn()).toHaveTextContent('A guardar…'));
  });

  it('enquanto guarda o botão fica bloqueado', async () => {
    api.saveArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    await waitFor(() => expect(guardarBtn()).toBeDisabled());
  });

  it('guardado volta a dizer «Guardado»', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.evaluateArticle.mockResolvedValue({ avaliacao: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(guardarBtn());
    await waitFor(() => expect(guardarBtn()).toHaveTextContent('Guardado'));
  });

  it('guardar falhado mostra a razão', async () => {
    api.saveArticle.mockRejectedValue(new Error('a base de dados recusou'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    expect(await screen.findByText('Não foi possível guardar: a base de dados recusou')).toBeInTheDocument();
  });

  it('guardar falhado mantém o texto escrito no ecrã', async () => {
    api.saveArticle.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), ' — versão nova');
    await utilizador.click(guardarBtn());
    await screen.findByText(/Não foi possível guardar/);
    expect(screen.getByLabelText('Título do artigo')).toHaveValue('Novas regras do IRN em 2026 — versão nova');
  });

  it('guardar falhado deixa o artigo por guardar', async () => {
    api.saveArticle.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(guardarBtn());
    await screen.findByText(/Não foi possível guardar/);
    expect(guardarBtn()).toHaveTextContent('Guardar');
  });

  it('avaliação falhada depois de guardar não engole o artigo guardado', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.evaluateArticle.mockRejectedValue(new Error('a IA não respondeu'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(guardarBtn());
    expect(await screen.findByText('Avaliação falhou: a IA não respondeu')).toBeInTheDocument();
    expect(guardarBtn()).toHaveTextContent('Guardado');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — imagens: gerar, escolher, corpo do artigo, descartar
// ═════════════════════════════════════════════════════════════════════════════
const QUATRO = [imagem('i1'), imagem('i2'), imagem('i3'), imagem('i4')];
const capa = (n) => screen.getByRole('button', { name: new RegExp(`^Opção ${n}`) });
const marcarParaCorpo = (n) => within(capa(n)).getAllByRole('button').find((b) => b.hasAttribute('aria-pressed'));

describe('Estúdio — gerar imagens', () => {
  it('sem imagens convida a gerar 4 opções', async () => {
    await abrirEstudio();
    expect(botao('Gerar 4 opções de imagem')).toBeInTheDocument();
  });

  it('sem imagens diz quanto tempo demora e que motor usa', async () => {
    await abrirEstudio();
    expect(screen.getByText('1–2 min · Gemini, fallback Recraft')).toBeInTheDocument();
  });

  it('gerar chama a API com o id do artigo', async () => {
    api.generateImages.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    await waitFor(() => expect(api.generateImages).toHaveBeenCalledWith(7));
  });

  it('enquanto gera mostra os passos narrados', async () => {
    api.generateImages.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    expect(await screen.findByText('A gerar 4 novas capas (1–2 min)')).toBeInTheDocument();
    expect(screen.getByText('A ler o artigo e a extrair o tema visual…')).toBeInTheDocument();
  });

  it('imagens geradas são anunciadas com a marca da Dra.', async () => {
    api.generateImages.mockResolvedValue({ article: artigo(), images: QUATRO, ronda: 2 });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    expect(await screen.findByText('4 imagens geradas com a marca da Dra.')).toBeInTheDocument();
  });

  it('uma só imagem gerada fica no singular', async () => {
    api.generateImages.mockResolvedValue({ article: artigo(), images: [imagem('i1')], ronda: 2 });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    expect(await screen.findByText('1 imagem gerada com a marca da Dra.')).toBeInTheDocument();
  });

  it('a marca de água falhada não esconde as imagens geradas', async () => {
    api.generateImages.mockResolvedValue({ article: artigo(), images: QUATRO, ronda: 2 });
    api.imageBlob.mockRejectedValue(new Error('R2 fora'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    expect(await screen.findByText(/Imagens geradas, mas a marca de água falhou/)).toBeInTheDocument();
    expect(await screen.findByText('4 imagens geradas com a marca da Dra.')).toBeInTheDocument();
  });

  it('gerar falhado mostra o erro dentro do loader', async () => {
    api.generateImages.mockRejectedValue(new Error('o Gemini recusou o prompt'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    expect(await screen.findByText('o Gemini recusou o prompt')).toBeInTheDocument();
  });

  it('gerar falhado deixa tentar novamente', async () => {
    api.generateImages.mockRejectedValueOnce(new Error('falhou')).mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    await screen.findByText('falhou');
    await utilizador.click(botao('Tentar novamente'));
    await waitFor(() => expect(api.generateImages).toHaveBeenCalledTimes(2));
  });

  it('gerar falhado deixa fechar o loader e continuar a escrever', async () => {
    api.generateImages.mockRejectedValue(new Error('falhou'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar 4 opções de imagem'));
    await screen.findByText('falhou');
    await utilizador.click(botao('Fechar'));
    await waitFor(() => expect(screen.queryByText('A ler o artigo e a extrair o tema visual…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Título do artigo')).toBeInTheDocument();
  });

  it('gerar de novo com imagens já feitas avisa que as atuais se perdem', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar todas novamente'));
    expect(await screen.findByText(/Gerar 4 novas opções\? As atuais deixam de estar disponíveis/)).toBeInTheDocument();
  });

  it('cancelar a regeração não chama a API', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar todas novamente'));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.generateImages).not.toHaveBeenCalled();
  });
});

describe('Estúdio — escolher a capa', () => {
  const comQuatro = async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    return abrirEstudio();
  };

  it('mostra as quatro opções', async () => {
    await comQuatro();
    for (const n of [1, 2, 3, 4]) expect(capa(n)).toBeInTheDocument();
  });

  it('identifica o motor que gerou cada opção', async () => {
    await comQuatro();
    expect(within(capa(1)).getByText('Opção 1 · gemini')).toBeInTheDocument();
  });

  it('sem capa escolhida convida a clicar numa imagem', async () => {
    await comQuatro();
    expect(screen.getByText(/Clique numa imagem para a escolher como capa/)).toBeInTheDocument();
  });

  it('clicar numa opção escolhe-a para capa', async () => {
    api.chooseImage.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i2' }, QUATRO));
    const { utilizador } = await comQuatro();
    await utilizador.click(capa(2));
    await waitFor(() => expect(api.chooseImage).toHaveBeenCalledWith(7, 'i2'));
    expect(await screen.findByText('Imagem escolhida para a capa.')).toBeInTheDocument();
  });

  it('a capa escolhida fica marcada', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i2' }, QUATRO));
    await abrirEstudio();
    expect(capa(2)).toHaveAttribute('aria-pressed', 'true');
    expect(capa(1)).toHaveAttribute('aria-pressed', 'false');
  });

  it('com capa escolhida diz que se pode trocar', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i2' }, QUATRO));
    await abrirEstudio();
    expect(screen.getByText(/Pode trocar clicando noutra opção/)).toBeInTheDocument();
  });

  it('a capa escolhida marca a lista de verificação', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i2' }, QUATRO));
    await abrirEstudio();
    expect(screen.getByText('Capa escolhida')).toBeInTheDocument();
  });

  it('escolher falhado mostra o erro', async () => {
    api.chooseImage.mockRejectedValue(new Error('imagem já não existe'));
    const { utilizador } = await comQuatro();
    await utilizador.click(capa(1));
    expect(await screen.findByText('imagem já não existe')).toBeInTheDocument();
  });

  it('descartar uma opção pede confirmação', async () => {
    const { utilizador } = await comQuatro();
    await utilizador.click(within(capa(3)).getByRole('button', { name: 'Descartar a opção 3' }));
    expect(await screen.findByText(/Descartar a opção 3 deste artigo\?/)).toBeInTheDocument();
  });

  it('confirmar descarta a opção', async () => {
    api.discardImage.mockResolvedValue(dadosArtigo({}, QUATRO.slice(0, 3)));
    const { utilizador } = await comQuatro();
    await utilizador.click(within(capa(3)).getByRole('button', { name: 'Descartar a opção 3' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(api.discardImage).toHaveBeenCalledWith(7, 'i3'));
    expect(await screen.findByText('Opção descartada.')).toBeInTheDocument();
  });

  it('cancelar não descarta nada', async () => {
    const { utilizador } = await comQuatro();
    await utilizador.click(within(capa(3)).getByRole('button', { name: 'Descartar a opção 3' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.discardImage).not.toHaveBeenCalled();
  });

  it('descartar falhado mostra o erro', async () => {
    api.discardImage.mockRejectedValue(new Error('502'));
    const { utilizador } = await comQuatro();
    await utilizador.click(within(capa(3)).getByRole('button', { name: 'Descartar a opção 3' }));
    await utilizador.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(await screen.findByText('502')).toBeInTheDocument();
  });
});

describe('Estúdio — fotos no corpo do artigo', () => {
  const comQuatro = async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    return abrirEstudio();
  };

  it('sem fotos marcadas o botão de inserir está bloqueado', async () => {
    await comQuatro();
    expect(botao('Inserir no artigo')).toBeDisabled();
  });

  it('marcar uma foto desbloqueia o inserir e diz quantas são', async () => {
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    expect(await screen.findByRole('button', { name: 'Inserir 1 no artigo' })).toBeEnabled();
  });

  it('marcar duas fotos conta as duas', async () => {
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(marcarParaCorpo(2));
    expect(await screen.findByRole('button', { name: 'Inserir 2 no artigo' })).toBeInTheDocument();
  });

  it('desmarcar volta a bloquear', async () => {
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(marcarParaCorpo(1));
    expect(await screen.findByRole('button', { name: 'Inserir no artigo' })).toBeDisabled();
  });

  it('inserir envia as fotos marcadas', async () => {
    api.insertImages.mockResolvedValue(dadosArtigo({ markdown: '## O que muda\n\n![](/api/insights/images/i1)' }, QUATRO));
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Inserir 1 no artigo'));
    await waitFor(() => expect(api.insertImages).toHaveBeenCalledWith(7, ['i1']));
  });

  it('inserir anuncia onde as fotos ficaram', async () => {
    api.insertImages.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Inserir 1 no artigo'));
    expect(await screen.findByText('1 foto colocada nos parágrafos mais adequados.')).toBeInTheDocument();
  });

  it('duas fotos inseridas usam o plural', async () => {
    api.insertImages.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(marcarParaCorpo(2));
    await utilizador.click(botao('Inserir 2 no artigo'));
    expect(await screen.findByText('2 fotos colocadas nos parágrafos mais adequados.')).toBeInTheDocument();
  });

  it('enquanto insere avisa que está a posicionar', async () => {
    api.insertImages.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Inserir 1 no artigo'));
    expect(await screen.findByRole('button', { name: 'A posicionar as fotos…' })).toBeDisabled();
  });

  it('inserir falhado mostra o erro sem perder a marcação', async () => {
    api.insertImages.mockRejectedValue(new Error('a IA não encontrou parágrafos'));
    const { utilizador } = await comQuatro();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Inserir 1 no artigo'));
    expect(await screen.findByText('Não foi possível inserir as fotos: a IA não encontrou parágrafos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inserir 1 no artigo' })).toBeInTheDocument();
  });

  it('foto já no corpo do artigo aparece marcada como tal', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ markdown: 'Texto\n\n![](/api/insights/images/i1)' }, QUATRO));
    await abrirEstudio();
    expect(within(capa(1)).getByText('NO ARTIGO')).toBeInTheDocument();
    expect(marcarParaCorpo(1)).toBeUndefined();
  });

  it('inserir guarda primeiro as alterações por guardar', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    api.insertImages.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await comQuatro();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Inserir 1 no artigo'));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
    await waitFor(() => expect(api.insertImages).toHaveBeenCalled());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — imagens ampliadas (lightbox) e Banco de Imagens
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — ver ampliadas', () => {
  const abrirLightbox = async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    const r = await abrirEstudio();
    await r.utilizador.click(botao('Ver ampliadas'));
    await screen.findByRole('dialog', { name: 'Imagens ampliadas' });
    return r;
  };

  it('«Ver ampliadas» abre o carrossel', async () => {
    await abrirLightbox();
    expect(screen.getByRole('dialog', { name: 'Imagens ampliadas' })).toBeInTheDocument();
  });

  it('mostra em que opção vai e quantas há', async () => {
    await abrirLightbox();
    const d = screen.getByRole('dialog', { name: 'Imagens ampliadas' });
    expect(within(d).getByText('01')).toBeInTheDocument();
    expect(within(d).getByText('/ 04')).toBeInTheDocument();
  });

  it('a seta seguinte avança para a opção 2', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Seguinte'));
    expect(await screen.findByAltText('Opção 2')).toBeInTheDocument();
  });

  it('a seta anterior dá a volta para a última', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Anterior'));
    expect(await screen.findByAltText('Opção 4')).toBeInTheDocument();
  });

  it('as miniaturas saltam para a opção escolhida', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Ver a opção 3'));
    expect(await screen.findByAltText('Opção 3')).toBeInTheDocument();
  });

  it('«Usar como capa» escolhe a opção sem sair do carrossel', async () => {
    api.chooseImage.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i1' }, QUATRO));
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Usar como capa'));
    await waitFor(() => expect(api.chooseImage).toHaveBeenCalledWith(7, 'i1'));
    expect(screen.getByRole('dialog', { name: 'Imagens ampliadas' })).toBeInTheDocument();
  });

  it('a capa atual já não se pode voltar a escolher', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ imagem_escolhida: 'i1' }, QUATRO));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Ver ampliadas'));
    expect(await screen.findByRole('button', { name: 'É a capa escolhida' })).toBeDisabled();
  });

  it('«Salvar imagem» guarda no Banco de Imagens', async () => {
    api.saveToBank.mockResolvedValue({ resultados: [{ estado: 'guardada' }] });
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Salvar imagem'));
    await waitFor(() => expect(api.saveToBank).toHaveBeenCalledWith(['i1']));
    expect(await screen.findByText('Imagem salva com sucesso.')).toBeInTheDocument();
  });

  it('imagem repetida diz em que dia já tinha sido salva', async () => {
    api.saveToBank.mockResolvedValue({ resultados: [{ estado: 'ja_existia', criado_em: '2026-07-20 10:00:00' }] });
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Salvar imagem'));
    expect(await screen.findByText('Esta imagem já foi salva no dia 20/07/2026.')).toBeInTheDocument();
  });

  it('imagem que já não existe avisa', async () => {
    api.saveToBank.mockResolvedValue({ resultados: [] });
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Salvar imagem'));
    expect(await screen.findByText('Imagem não encontrada.')).toBeInTheDocument();
  });

  it('salvar falhado mostra o erro', async () => {
    api.saveToBank.mockRejectedValue(new Error('sem espaço no R2'));
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Salvar imagem'));
    expect(await screen.findByText('Não foi possível salvar no Banco de Imagens: sem espaço no R2')).toBeInTheDocument();
  });

  it('«Reportar erro» pergunta o que está errado', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Reportar erro'));
    expect(await screen.findByText(/Descreva o erro para a IA nunca mais o repetir/)).toBeInTheDocument();
    expect(screen.getByText('Reportar erro · Opção 1')).toBeInTheDocument();
  });

  it('erro reportado vira regra permanente', async () => {
    api.addImageRule.mockResolvedValue({ rules: [{ id: 1, texto: 'mãos com seis dedos' }] });
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Reportar erro'));
    const campo = campoDoPrompt('Descreva o erro para a IA nunca mais o repetir (ex.: «ecrã do telemóvel virado ao contrário»):');
    await utilizador.type(campo, 'mãos com seis dedos');
    await utilizador.click(botao('OK'));
    await waitFor(() => expect(api.addImageRule).toHaveBeenCalledWith('mãos com seis dedos'));
    expect(await screen.findByText('Correção guardada — entra no prompt das próximas gerações.')).toBeInTheDocument();
  });

  it('cancelar o relato não guarda regra nenhuma', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Reportar erro'));
    await screen.findByText(/Descreva o erro para a IA/);
    await utilizador.click(botao('Cancelar'));
    expect(api.addImageRule).not.toHaveBeenCalled();
  });

  it('o carrossel fecha no botão Fechar', async () => {
    const { utilizador } = await abrirLightbox();
    await utilizador.click(botao('Fechar'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Imagens ampliadas' })).not.toBeInTheDocument());
  });
});

describe('Estúdio — usar imagem do banco', () => {
  const abrirBanco = async (imagens = [noBanco()]) => {
    api.imageBank.mockResolvedValue({ images: imagens });
    const r = await abrirEstudio();
    await r.utilizador.click(botao('Usar imagem do banco'));
    await screen.findByRole('dialog', { name: 'Usar imagem do banco' });
    return r;
  };

  it('abre o modal do banco', async () => {
    await abrirBanco();
    expect(screen.getByRole('dialog', { name: 'Usar imagem do banco' })).toBeInTheDocument();
  });

  it('banco vazio explica como guardar imagens', async () => {
    await abrirBanco([]);
    expect(await screen.findByText(/O banco ainda está vazio/)).toBeInTheDocument();
  });

  it('conta as imagens guardadas', async () => {
    await abrirBanco([noBanco(), noBanco({ id: 2, image_id: 'img-b2' })]);
    expect(await screen.findByText('2 guardadas')).toBeInTheDocument();
  });

  it('sem seleção o botão de adicionar está bloqueado', async () => {
    await abrirBanco();
    await screen.findByText('Clique nas imagens para selecionar');
    expect(botao('Adicionar no artigo')).toBeDisabled();
  });

  it('selecionar uma imagem conta a seleção', async () => {
    const { utilizador } = await abrirBanco();
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    await utilizador.click((await within(d).findAllByRole('button', { pressed: false }))[0]);
    expect(await screen.findByText('1 selecionada')).toBeInTheDocument();
  });

  it('adicionar copia as imagens para as opções do artigo', async () => {
    api.adoptFromBank.mockResolvedValue({ ...dadosArtigo({}, QUATRO), resultados: [{ estado: 'adicionada' }] });
    const { utilizador } = await abrirBanco();
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    await utilizador.click((await within(d).findAllByRole('button', { pressed: false }))[0]);
    await utilizador.click(botao('Adicionar 1 no artigo'));
    await waitFor(() => expect(api.adoptFromBank).toHaveBeenCalledWith(7, ['img-b1']));
    expect(await screen.findByText('1 imagem adicionada às opções do artigo.')).toBeInTheDocument();
  });

  it('imagem que já estava no artigo é reportada como tal', async () => {
    api.adoptFromBank.mockResolvedValue({ ...dadosArtigo({}, QUATRO), resultados: [{ estado: 'ja_no_artigo' }] });
    const { utilizador } = await abrirBanco();
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    await utilizador.click((await within(d).findAllByRole('button', { pressed: false }))[0]);
    await utilizador.click(botao('Adicionar 1 no artigo'));
    expect(await screen.findByText('1 já estava neste artigo.')).toBeInTheDocument();
  });

  it('adicionar falhado mostra o erro sem fechar o modal', async () => {
    api.adoptFromBank.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirBanco();
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    await utilizador.click((await within(d).findAllByRole('button', { pressed: false }))[0]);
    await utilizador.click(botao('Adicionar 1 no artigo'));
    expect(await screen.findByText('Não foi possível adicionar do banco: 502')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Usar imagem do banco' })).toBeInTheDocument();
  });

  it('imagem que já está nas opções deste artigo não se pode voltar a escolher', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, [imagem('img-b1')]));
    await abrirBanco();
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    expect(await within(d).findByText('ESTÁ NESSE ARTIGO')).toBeInTheDocument();
  });

  it('mostra em que outros artigos a imagem já foi usada', async () => {
    await abrirBanco([noBanco({ usos: [{ article_id: 9, titulo: 'Outro' }] })]);
    const d = screen.getByRole('dialog', { name: 'Usar imagem do banco' });
    expect(await within(d).findByText('NO ARTIGO 9')).toBeInTheDocument();
  });

  it('Cancelar fecha o modal sem adicionar nada', async () => {
    const { utilizador } = await abrirBanco();
    await utilizador.click(botao('Cancelar'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usar imagem do banco' })).not.toBeInTheDocument());
    expect(api.adoptFromBank).not.toHaveBeenCalled();
  });

  it('falha a carregar o banco mostra o erro e o estado vazio', async () => {
    api.imageBank.mockRejectedValue(new Error('502 no banco'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Usar imagem do banco'));
    expect(await screen.findByText('502 no banco')).toBeInTheDocument();
    expect(await screen.findByText(/O banco ainda está vazio/)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — nota da IA (avaliação) e correções de imagem
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — nota da IA', () => {
  it('sem avaliação explica como se obtém a nota', async () => {
    await abrirEstudio();
    expect(screen.getByText(/a IA avalia o texto e a/)).toBeInTheDocument();
    expect(botao('Avaliar agora')).toBeInTheDocument();
  });

  it('«Avaliar agora» chama a avaliação', async () => {
    api.evaluateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    await waitFor(() => expect(api.evaluateArticle).toHaveBeenCalledWith(7));
  });

  it('enquanto avalia mostra que está a avaliar', async () => {
    api.evaluateArticle.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    expect(await screen.findByText('a avaliar…')).toBeInTheDocument();
  });

  it('mostra a nota do texto e da descrição SEO', async () => {
    api.evaluateArticle.mockResolvedValue({ avaliacao: { texto: { score: 8.4 }, seo: { score: 6.1 } } });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    expect(await screen.findByText('8.4')).toBeInTheDocument();
    expect(screen.getByText('6.1')).toBeInTheDocument();
  });

  it('mostra o motivo da nota', async () => {
    api.evaluateArticle.mockResolvedValue({ avaliacao: { texto: { score: 8, motivo: 'Bem estruturado.' }, seo: { score: 6 } } });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    expect(await screen.findByText('Bem estruturado.')).toBeInTheDocument();
  });

  it('mostra as sugestões de melhoria', async () => {
    api.evaluateArticle.mockResolvedValue({ avaliacao: { texto: { score: 8, melhorias: ['Encurtar o 3.º parágrafo'] }, seo: { score: 6 } } });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    expect(await screen.findByText('Encurtar o 3.º parágrafo')).toBeInTheDocument();
  });

  it('a avaliação guardada no artigo aparece logo ao abrir', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ avaliacao: JSON.stringify({ texto: { score: 9.2 }, seo: { score: 7 } }) }));
    await abrirEstudio();
    expect(screen.getByText('9.2')).toBeInTheDocument();
  });

  it('avaliação ilegível no artigo não parte o ecrã', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ avaliacao: 'isto não é json' }));
    await abrirEstudio();
    expect(botao('Avaliar agora')).toBeInTheDocument();
  });

  it('avaliação sem notas mostra travessões em vez de números', async () => {
    api.evaluateArticle.mockResolvedValue({ avaliacao: { texto: {}, seo: {} } });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    await waitFor(() => expect(screen.getAllByText('—').length).toBe(2));
  });

  it('avaliar de novo é possível depois da primeira nota', async () => {
    api.evaluateArticle.mockResolvedValue({ avaliacao: { texto: { score: 8 }, seo: { score: 6 } } });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    await screen.findByText('8.0');
    await utilizador.click(botao('Reavaliar agora'));
    await waitFor(() => expect(api.evaluateArticle).toHaveBeenCalledTimes(2));
  });

  it('avaliação falhada mostra o erro', async () => {
    api.evaluateArticle.mockRejectedValue(new Error('sem quota'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Avaliar agora'));
    expect(await screen.findByText('Avaliação falhou: sem quota')).toBeInTheDocument();
  });
});

describe('Estúdio — correções de imagem', () => {
  const campoRegra = () => screen.getByPlaceholderText('Ex.: ecrã do telemóvel virado ao contrário');

  it('sem regras diz que ainda não há nenhuma', async () => {
    await abrirEstudio();
    expect(screen.getByText('Ainda sem correções registadas.')).toBeInTheDocument();
  });

  it('lista as regras já registadas', async () => {
    api.imageRules.mockResolvedValue({ rules: [{ id: 1, texto: 'nada de mãos estranhas' }] });
    await abrirEstudio();
    expect(screen.getByText('nada de mãos estranhas')).toBeInTheDocument();
  });

  it('sem texto o botão de guardar está bloqueado', async () => {
    await abrirEstudio();
    expect(botao('Guardar correção')).toBeDisabled();
  });

  it('escrever a correção desbloqueia o botão', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoRegra(), 'ecrã ao contrário');
    expect(botao('Guardar correção')).toBeEnabled();
  });

  it('guardar a correção envia o texto e limpa o campo', async () => {
    api.addImageRule.mockResolvedValue({ rules: [{ id: 1, texto: 'ecrã ao contrário' }] });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoRegra(), 'ecrã ao contrário');
    await utilizador.click(botao('Guardar correção'));
    await waitFor(() => expect(api.addImageRule).toHaveBeenCalledWith('ecrã ao contrário'));
    await waitFor(() => expect(campoRegra()).toHaveValue(''));
  });

  it('a correção guardada aparece na lista', async () => {
    api.addImageRule.mockResolvedValue({ rules: [{ id: 1, texto: 'ecrã ao contrário' }] });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoRegra(), 'ecrã ao contrário');
    await utilizador.click(botao('Guardar correção'));
    expect(await screen.findByText('ecrã ao contrário')).toBeInTheDocument();
  });

  it('guardar a correção falhado mostra o erro', async () => {
    api.addImageRule.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoRegra(), 'ecrã ao contrário');
    await utilizador.click(botao('Guardar correção'));
    expect(await screen.findByText('502')).toBeInTheDocument();
  });

  it('remover a correção chama a API', async () => {
    api.imageRules.mockResolvedValue({ rules: [{ id: 5, texto: 'nada de mãos estranhas' }] });
    api.removeImageRule.mockResolvedValue({ rules: [] });
    const { utilizador } = await abrirEstudio();
    const linha = screen.getByText('nada de mãos estranhas').closest('div');
    await utilizador.click(within(linha).getByRole('button'));
    await waitFor(() => expect(api.removeImageRule).toHaveBeenCalledWith(5));
  });

  it('remover a correção falhado mostra o erro', async () => {
    api.imageRules.mockResolvedValue({ rules: [{ id: 5, texto: 'nada de mãos estranhas' }] });
    api.removeImageRule.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    const linha = screen.getByText('nada de mãos estranhas').closest('div');
    await utilizador.click(within(linha).getByRole('button'));
    expect(await screen.findByText('502')).toBeInTheDocument();
  });

  it('falha a carregar as regras não parte o cartão', async () => {
    api.imageRules.mockRejectedValue(new Error('502'));
    await abrirEstudio();
    expect(await screen.findByText('Ainda sem correções registadas.')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — correções por IA (artigo inteiro e trecho selecionado)
// ═════════════════════════════════════════════════════════════════════════════
const campoPedidoIA = () => screen.getByPlaceholderText('O que corrigir…');
const corpoDoArtigo = () => document.querySelector('.ProseMirror');
async function selecionarTudoNoCorpo(u) {
  await u.click(corpoDoArtigo());
  await u.keyboard('{Control>}a{/Control}');
  await screen.findByText('Trecho selecionado');
}

describe('Estúdio — correções por IA', () => {
  it('explica para que serve o pedido de correção', async () => {
    await abrirEstudio();
    expect(screen.getByText('Correções por IA')).toBeInTheDocument();
    expect(campoPedidoIA()).toBeInTheDocument();
  });

  it('pedido demasiado curto mantém o botão bloqueado', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'abc');
    expect(botao('Aplicar correções')).toBeDisabled();
  });

  it('pedido com 5 caracteres desbloqueia o botão', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'abcde');
    expect(botao('Aplicar correções')).toBeEnabled();
  });

  it('o pedido está limitado a 2000 caracteres', async () => {
    await abrirEstudio();
    expect(campoPedidoIA()).toHaveAttribute('maxlength', '2000');
  });

  it('aplicar correções envia o pedido ao artigo inteiro', async () => {
    api.aiCorrect.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'o prazo certo é de 30 dias');
    await utilizador.click(botao('Aplicar correções'));
    await waitFor(() => expect(api.aiCorrect).toHaveBeenCalledWith(7, 'o prazo certo é de 30 dias'));
  });

  it('enquanto corrige avisa que a IA verifica os factos', async () => {
    api.aiCorrect.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    expect(await screen.findByRole('button', { name: 'A aplicar as correções…' })).toBeDisabled();
    expect(screen.getByText(/a IA verifica os factos nas fontes antes de reescrever/)).toBeInTheDocument();
  });

  it('correções aplicadas devolvem o texto novo ao editor', async () => {
    api.aiCorrect.mockResolvedValue({ ...dadosArtigo({ titulo: 'Título corrigido', markdown: '## Novo\n\nTexto corrigido.' }), notas: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    await waitFor(() => expect(screen.getByLabelText('Título do artigo')).toHaveValue('Título corrigido'));
    await waitFor(() => expect(corpoDoArtigo()).toHaveTextContent('Texto corrigido.'));
  });

  it('correções aplicadas pedem revisão antes de marcar como revisto', async () => {
    api.aiCorrect.mockResolvedValue({ ...dadosArtigo(), notas: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    expect(await screen.findByText('Correções aplicadas — reveja o texto antes de marcar «Revisto pela Dra.».')).toBeInTheDocument();
  });

  it('correções aplicadas limpam o pedido', async () => {
    api.aiCorrect.mockResolvedValue({ ...dadosArtigo(), notas: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    await waitFor(() => expect(campoPedidoIA()).toHaveValue(''));
  });

  it('mostra as notas do que a IA mudou', async () => {
    api.aiCorrect.mockResolvedValue({ ...dadosArtigo(), notas: 'Corrigi o prazo de 15 para 30 dias.' });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    expect(await screen.findByText('Corrigi o prazo de 15 para 30 dias.')).toBeInTheDocument();
  });

  it('correções falhadas mostram o erro sem perder o pedido', async () => {
    api.aiCorrect.mockRejectedValue(new Error('a IA não respondeu'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    expect(await screen.findByText('Não foi possível aplicar as correções: a IA não respondeu')).toBeInTheDocument();
    expect(campoPedidoIA()).toHaveValue('corrige o prazo');
  });

  it('corrigir guarda primeiro o que estiver por guardar', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.aiCorrect.mockResolvedValue({ ...dadosArtigo(), notas: null });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.type(campoPedidoIA(), 'corrige o prazo');
    await utilizador.click(botao('Aplicar correções'));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
  });
});

describe('Estúdio — correções por IA num trecho selecionado', () => {
  it('selecionar texto no corpo avisa que a correção incide só nele', async () => {
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    expect(screen.getByText('Trecho selecionado')).toBeInTheDocument();
  });

  it('com trecho selecionado o botão muda de nome', async () => {
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    expect(botao('Corrigir o trecho selecionado')).toBeEnabled();
  });

  it('«usar o artigo inteiro» desfaz a seleção', async () => {
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.click(botao('usar o artigo inteiro'));
    await waitFor(() => expect(screen.queryByText('Trecho selecionado')).not.toBeInTheDocument());
  });

  it('corrigir o trecho envia a seleção em Markdown', async () => {
    api.aiCorrect.mockReturnValue(new Promise(() => {}));
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await waitFor(() => expect(api.aiCorrect).toHaveBeenCalledWith(7, 'torna isto mais claro', expect.stringContaining('O que muda')));
  });

  it('a proposta abre num modal editável', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto pela IA.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    expect(await screen.findByRole('dialog', { name: 'Correção proposta pela IA' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Texto proposto pela IA.')).toBeInTheDocument();
  });

  it('a proposta mostra o trecho original ao lado', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await screen.findByRole('dialog', { name: 'Correção proposta pela IA' });
    expect(screen.getByText('Trecho original')).toBeInTheDocument();
  });

  it('proposta vazia não deixa aplicar', async () => {
    api.aiCorrect.mockResolvedValue({ texto: '   ', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    expect(await screen.findByRole('button', { name: 'Aplicar no texto' })).toBeDisabled();
  });

  it('aplicar a proposta troca o trecho no editor', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto pela IA.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await utilizador.click(await screen.findByRole('button', { name: 'Aplicar no texto' }));
    expect(await screen.findByText('Trecho corrigido — reveja e guarde o artigo.')).toBeInTheDocument();
    await waitFor(() => expect(corpoDoArtigo()).toHaveTextContent('Texto proposto pela IA.'));
  });

  it('aplicar a proposta fecha o modal e limpa o pedido', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto pela IA.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await utilizador.click(await screen.findByRole('button', { name: 'Aplicar no texto' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Correção proposta pela IA' })).not.toBeInTheDocument());
    expect(campoPedidoIA()).toHaveValue('');
  });

  it('cancelar a proposta não mexe no texto', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto pela IA.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await screen.findByRole('dialog', { name: 'Correção proposta pela IA' });
    await utilizador.click(botao('Cancelar'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Correção proposta pela IA' })).not.toBeInTheDocument());
    expect(corpoDoArtigo()).toHaveTextContent('Texto do artigo.');
  });

  it('corrigir o trecho falhado mostra o erro', async () => {
    api.aiCorrect.mockRejectedValue(new Error('trecho grande demais'));
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    expect(await screen.findByText('Não foi possível corrigir o trecho: trecho grande demais')).toBeInTheDocument();
  });

  it('corrigir o trecho não guarda o artigo (a proposta ainda não é definitiva)', async () => {
    api.aiCorrect.mockResolvedValue({ texto: 'Texto proposto.', notas: null });
    const { utilizador } = await abrirEstudio();
    await selecionarTudoNoCorpo(utilizador);
    await utilizador.type(campoPedidoIA(), 'torna isto mais claro');
    await utilizador.click(botao('Corrigir o trecho selecionado'));
    await screen.findByRole('dialog', { name: 'Correção proposta pela IA' });
    expect(api.saveArticle).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — pré-visualização (a página real do blogue)
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — pré-visualização', () => {
  const preVisualizar = async (u) => {
    await u.click(botao('Pré-visualizar'));
    return screen.findByRole('dialog', { name: 'Pré-visualização do artigo' });
  };

  it('abre a pré-visualização', async () => {
    const { utilizador } = await abrirEstudio();
    expect(await preVisualizar(utilizador)).toBeInTheDocument();
  });

  it('a pré-visualização mostra o título como o leitor o vai ver', async () => {
    const { utilizador } = await abrirEstudio();
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByRole('heading', { level: 1, name: 'Novas regras do IRN em 2026' })).toBeInTheDocument();
  });

  it('a pré-visualização mostra o corpo do artigo em HTML', async () => {
    const { utilizador } = await abrirEstudio();
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByRole('heading', { level: 2, name: 'O que muda' })).toBeInTheDocument();
    expect(within(pv).getByText('Texto do artigo.')).toBeInTheDocument();
  });

  it('a pré-visualização mostra a descrição SEO no rail lateral', async () => {
    const { utilizador } = await abrirEstudio();
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByText('O que muda para quem pede a nacionalidade.')).toBeInTheDocument();
  });

  it('a pré-visualização mostra a área e o tempo de leitura', async () => {
    const { utilizador } = await abrirEstudio();
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByText(/Nacionalidade ·.*min de leitura/)).toBeInTheDocument();
  });

  it('as alterações por guardar aparecem na pré-visualização', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    const { utilizador } = await abrirEstudio();
    const t = screen.getByLabelText('Título do artigo');
    await utilizador.clear(t);
    await utilizador.type(t, 'Título ainda por guardar');
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByRole('heading', { level: 1, name: 'Título ainda por guardar' })).toBeInTheDocument();
  });

  it('pré-visualizar guarda primeiro o que estiver por guardar', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await preVisualizar(utilizador);
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
  });

  it('pré-visualizar com fotos marcadas mas não inseridas avisa a Dra.', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({}, QUATRO));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(marcarParaCorpo(1));
    await utilizador.click(botao('Pré-visualizar'));
    expect(await screen.findByText(/Tem 1 foto marcada ainda NÃO inserida/)).toBeInTheDocument();
  });

  it('a pré-visualização limpa as etiquetas de citação da pesquisa web', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ markdown: 'Prazo de 30 dias<cite>fonte</cite>.' }));
    const { utilizador } = await abrirEstudio();
    const pv = await preVisualizar(utilizador);
    expect(within(pv).getByText('Prazo de 30 diasfonte.')).toBeInTheDocument();
  });

  it('a pré-visualização fecha no botão próprio', async () => {
    const { utilizador } = await abrirEstudio();
    await preVisualizar(utilizador);
    await utilizador.click(botao('Fechar pré-visualização'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pré-visualização do artigo' })).not.toBeInTheDocument());
  });

  it('fechar a pré-visualização não fecha o estúdio', async () => {
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await preVisualizar(utilizador);
    await utilizador.click(botao('Fechar pré-visualização'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pré-visualização do artigo' })).not.toBeInTheDocument());
    expect(fechou).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — link público de pré-visualização (partilhável no WhatsApp)
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — link público de prévia', () => {
  const LINK = 'https://vyavenaadv.com/previa/tok123';

  it('o botão está no cabeçalho do estúdio', async () => {
    await abrirEstudio();
    expect(botao('Copiar link de prévia')).toBeInTheDocument();
  });

  it('copiar o link pede-o ao servidor para este artigo', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    espiarAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    await waitFor(() => expect(api.previaLink).toHaveBeenCalledWith(7));
  });

  it('o link vai mesmo para a área de transferência', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    const copiou = espiarAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    await waitFor(() => expect(copiou).toHaveBeenCalledWith(LINK));
  });

  it('avisa que o link pode ser colado no WhatsApp da Dra.', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    espiarAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    expect(await screen.findByText('Link da prévia copiado — pode colar no WhatsApp da Dra.')).toBeInTheDocument();
  });

  it('guarda primeiro para o link mostrar a última versão', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    espiarAreaDeTransferencia();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Copiar link de prévia'));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
    await waitFor(() => expect(api.previaLink).toHaveBeenCalled());
  });

  it('sem alterações por guardar não guarda à toa', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    espiarAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    await waitFor(() => expect(api.previaLink).toHaveBeenCalled());
    expect(api.saveArticle).not.toHaveBeenCalled();
  });

  it('servidor sem token mostra o erro em vez de copiar lixo', async () => {
    api.previaLink.mockRejectedValue(new Error('artigo ainda sem texto'));
    const { utilizador } = await abrirEstudio();
    const copiou = espiarAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    expect(await screen.findByText('Não foi possível copiar o link: artigo ainda sem texto')).toBeInTheDocument();
    expect(copiou).not.toHaveBeenCalled();
  });

  it('área de transferência recusada mostra mensagem e não parte o ecrã', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    espiarAreaDeTransferencia(() => Promise.reject(new Error('permissão negada')));
    await utilizador.click(botao('Copiar link de prévia'));
    expect(await screen.findByText('Não foi possível copiar o link: permissão negada')).toBeInTheDocument();
    expect(screen.getByLabelText('Título do artigo')).toBeInTheDocument();
  });

  it('browser sem área de transferência avisa em vez de rebentar', async () => {
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    semAreaDeTransferencia();
    await utilizador.click(botao('Copiar link de prévia'));
    expect(await screen.findByText(/Não foi possível copiar o link:/)).toBeInTheDocument();
    expect(screen.getByLabelText('Título do artigo')).toBeInTheDocument();
  });

  it('guardar falhado não impede o link de ser copiado', async () => {
    api.saveArticle.mockRejectedValue(new Error('502'));
    api.previaLink.mockResolvedValue({ url: LINK });
    const { utilizador } = await abrirEstudio();
    const copiou = espiarAreaDeTransferencia();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Copiar link de prévia'));
    await waitFor(() => expect(copiou).toHaveBeenCalledWith(LINK));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — revisão, publicação e apagar
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — revisto pela Dra.', () => {
  const revistoBtn = () => screen.getByRole('button', { name: /^Revisto pela Dra\./ });

  it('rascunho por rever diz que está pronto a revisão', async () => {
    await abrirEstudio();
    expect(screen.getByText('Rascunho pronto a revisão')).toBeInTheDocument();
  });

  it('marcar como revisto chama a API', async () => {
    api.setReviewed.mockResolvedValue(dadosArtigo({ revisto_em: '2026-08-02 10:00:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(revistoBtn());
    await waitFor(() => expect(api.setReviewed).toHaveBeenCalledWith(7, true));
  });

  it('marcado como revisto o estado muda para aprovado', async () => {
    api.setReviewed.mockResolvedValue(dadosArtigo({ revisto_em: '2026-08-02 10:00:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(revistoBtn());
    expect(await screen.findByText('Aprovado pela Dra. — pronto a publicar')).toBeInTheDocument();
  });

  it('marcar como revisto guarda primeiro o texto por guardar', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.setReviewed.mockResolvedValue(dadosArtigo({ revisto_em: '2026-08-02 10:00:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(revistoBtn());
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
    await waitFor(() => expect(api.setReviewed).toHaveBeenCalled());
  });

  it('se o guardar falhar não marca como revisto', async () => {
    api.saveArticle.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(revistoBtn());
    await screen.findByText(/Não foi possível guardar/);
    expect(api.setReviewed).not.toHaveBeenCalled();
  });

  it('desmarcar a revisão é possível', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ revisto_em: '2026-08-02 10:00:00' }));
    api.setReviewed.mockResolvedValue(dadosArtigo());
    const { utilizador } = await abrirEstudio();
    expect(revistoBtn()).toHaveAttribute('aria-pressed', 'true');
    await utilizador.click(revistoBtn());
    await waitFor(() => expect(api.setReviewed).toHaveBeenCalledWith(7, false));
    expect(await screen.findByText('Revisão desmarcada.')).toBeInTheDocument();
  });

  it('marcar a revisão falhado mostra o erro', async () => {
    api.setReviewed.mockRejectedValue(new Error('artigo já publicado'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(revistoBtn());
    expect(await screen.findByText('artigo já publicado')).toBeInTheDocument();
  });

  it('a data da revisão fica visível', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ revisto_em: '2026-08-02 10:00:00' }));
    await abrirEstudio();
    expect(screen.getByText('· 02/08/2026')).toBeInTheDocument();
  });
});

describe('Estúdio — publicar', () => {
  const revisto = (extra = {}) => dadosArtigo({ revisto_em: '2026-08-02 10:00:00', ...extra });

  it('sem revisão o botão de publicar está bloqueado', async () => {
    await abrirEstudio();
    expect(botao('Publicar')).toBeDisabled();
  });

  it('depois de revisto o botão de publicar liberta-se', async () => {
    api.getArticle.mockResolvedValue(revisto());
    await abrirEstudio();
    expect(botao('Publicar')).toBeEnabled();
  });

  it('publicar pede confirmação e explica a fila', async () => {
    api.getArticle.mockResolvedValue(revisto());
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Publicar'));
    expect(await screen.findByText(/Publicar este artigo no blogue\?/)).toBeInTheDocument();
    expect(screen.getByText(/fica no ar em até ~15 minutos/)).toBeInTheDocument();
  });

  it('cancelar não publica nada', async () => {
    api.getArticle.mockResolvedValue(revisto());
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Publicar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.publishArticle).not.toHaveBeenCalled();
  });

  it('confirmar mete o artigo na fila de publicação', async () => {
    api.getArticle.mockResolvedValue(revisto());
    api.publishArticle.mockResolvedValue(revisto({ publicar_em: '2026-08-04 12:00:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Publicar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Publicar no blogue' }));
    await waitFor(() => expect(api.publishArticle).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Na fila de publicação — o artigo entra no ar em até ~15 minutos.')).toBeInTheDocument();
  });

  it('publicar guarda primeiro as alterações por guardar', async () => {
    api.getArticle.mockResolvedValue(revisto());
    api.saveArticle.mockResolvedValue(revisto());
    api.publishArticle.mockResolvedValue(revisto({ publicar_em: '2026-08-04 12:00:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Publicar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Publicar no blogue' }));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
    await waitFor(() => expect(api.publishArticle).toHaveBeenCalled());
  });

  it('se o guardar falhar o artigo não é publicado', async () => {
    api.getArticle.mockResolvedValue(revisto());
    api.saveArticle.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Publicar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Publicar no blogue' }));
    await screen.findByText(/Não foi possível guardar/);
    expect(api.publishArticle).not.toHaveBeenCalled();
  });

  it('publicar falhado mostra o erro', async () => {
    api.getArticle.mockResolvedValue(revisto());
    api.publishArticle.mockRejectedValue(new Error('o GitHub Actions recusou'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Publicar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Publicar no blogue' }));
    expect(await screen.findByText('o GitHub Actions recusou')).toBeInTheDocument();
  });

  it('artigo na fila mostra «A publicar…» em vez do botão', async () => {
    api.getArticle.mockResolvedValue(revisto({ publicar_em: '2026-08-04 12:00:00' }));
    await abrirEstudio();
    expect(screen.getByText('A publicar…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
  });

  it('artigo publicado mostra o estado Publicado', async () => {
    api.getArticle.mockResolvedValue(revisto({ publicado_em: '2026-08-04 12:15:00' }));
    await abrirEstudio();
    expect(screen.getByText('Publicado')).toBeInTheDocument();
  });

  it('artigo publicado já não se pode publicar outra vez', async () => {
    api.getArticle.mockResolvedValue(revisto({ publicado_em: '2026-08-04 12:15:00' }));
    await abrirEstudio();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
  });

  it('artigo publicado já não se pode apagar por aqui', async () => {
    api.getArticle.mockResolvedValue(revisto({ publicado_em: '2026-08-04 12:15:00' }));
    await abrirEstudio();
    expect(screen.queryByRole('button', { name: 'Apagar' })).not.toBeInTheDocument();
  });

  it('artigo na fila também não se pode apagar', async () => {
    api.getArticle.mockResolvedValue(revisto({ publicar_em: '2026-08-04 12:00:00' }));
    await abrirEstudio();
    expect(screen.queryByRole('button', { name: 'Apagar' })).not.toBeInTheDocument();
  });
});

describe('Estúdio — apagar o rascunho', () => {
  it('apagar pede confirmação com o título do artigo', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Apagar'));
    expect(await screen.findByText(/Apagar «Novas regras do IRN em 2026» definitivamente\?/)).toBeInTheDocument();
  });

  it('a confirmação avisa que as imagens também vão', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Apagar'));
    expect(await screen.findByText(/só ficam as que estão no Banco de Imagens/)).toBeInTheDocument();
  });

  it('cancelar não apaga nada', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Apagar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.deleteArticle).not.toHaveBeenCalled();
  });

  it('confirmar apaga e fecha o estúdio', async () => {
    api.deleteArticle.mockResolvedValue({ ok: true });
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await utilizador.click(botao('Apagar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar artigo' }));
    await waitFor(() => expect(api.deleteArticle).toHaveBeenCalledWith(7));
    await waitFor(() => expect(fechou).toHaveBeenCalled());
  });

  it('apagar falhado mostra o erro e mantém o estúdio aberto', async () => {
    api.deleteArticle.mockRejectedValue(new Error('artigo já publicado'));
    const fechou = vi.fn();
    const { utilizador } = await abrirEstudio({ onClose: fechou });
    await utilizador.click(botao('Apagar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar artigo' }));
    expect(await screen.findByText('Não foi possível apagar: artigo já publicado')).toBeInTheDocument();
    expect(fechou).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Título do artigo')).toBeInTheDocument();
  });

  it('depois de falhar dá para tentar apagar outra vez', async () => {
    api.deleteArticle.mockRejectedValue(new Error('502'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Apagar'));
    await utilizador.click(await screen.findByRole('button', { name: 'Apagar artigo' }));
    await screen.findByText(/Não foi possível apagar/);
    expect(botao('Apagar')).toBeEnabled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Estúdio — narração ElevenLabs
// ═════════════════════════════════════════════════════════════════════════════
describe('Estúdio — narração', () => {
  it('sem narração convida a gerar quando o texto estiver finalizado', async () => {
    await abrirEstudio();
    expect(botao('Gerar narração')).toBeInTheDocument();
  });

  it('gerar narração pergunta se o texto está finalizado', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar narração'));
    expect(await screen.findByText(/O texto está finalizado\?/)).toBeInTheDocument();
  });

  it('cancelar não gera narração nenhuma', async () => {
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar narração'));
    await utilizador.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.generateAudio).not.toHaveBeenCalled();
  });

  it('confirmar gera a narração com a voz do blogue', async () => {
    api.generateAudio.mockResolvedValue({ audio_key: 'a.mp3', audio_em: '2026-08-04 10:00:00' });
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar narração'));
    await utilizador.click(await screen.findByRole('button', { name: 'Sim, gerar narração' }));
    await waitFor(() => expect(api.generateAudio).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Narração gerada com a voz do blogue.')).toBeInTheDocument();
  });

  it('gerar narração guarda primeiro o texto por guardar', async () => {
    api.saveArticle.mockResolvedValue(dadosArtigo());
    api.generateAudio.mockResolvedValue({ audio_key: 'a.mp3', audio_em: '2026-08-04 10:00:00' });
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    await utilizador.click(botao('Gerar narração'));
    await utilizador.click(await screen.findByRole('button', { name: 'Sim, gerar narração' }));
    await waitFor(() => expect(api.saveArticle).toHaveBeenCalled());
  });

  it('gerar narração falhado mostra o erro', async () => {
    api.generateAudio.mockRejectedValue(new Error('sem créditos ElevenLabs'));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar narração'));
    await utilizador.click(await screen.findByRole('button', { name: 'Sim, gerar narração' }));
    expect(await screen.findByText('Não foi possível gerar a narração: sem créditos ElevenLabs')).toBeInTheDocument();
  });

  it('com narração mostra a data em que foi gerada', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ audio_key: 'a.mp3', audio_em: '2026-08-02 14:30:00' }));
    await abrirEstudio();
    expect(screen.getByText(/Gerada a 02\/08\/2026/)).toBeInTheDocument();
  });

  it('com narração dá para ouvir aqui mesmo', async () => {
    api.audioUrl.mockResolvedValue('blob:audio');
    api.getArticle.mockResolvedValue(dadosArtigo({ audio_key: 'a.mp3', audio_em: '2026-08-02 14:30:00' }));
    await abrirEstudio();
    expect(await screen.findByRole('button', { name: 'Ouvir a narração' })).toBeInTheDocument();
  });

  it('texto alterado depois da narração avisa que é preciso gerar de novo', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ audio_key: 'a.mp3', audio_em: '2026-08-02 14:30:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.type(screen.getByLabelText('Título do artigo'), '!');
    expect(screen.getByText(/O texto foi alterado desde então — gere novamente/)).toBeInTheDocument();
  });

  it('regenerar a narração avisa que a anterior é substituída', async () => {
    api.getArticle.mockResolvedValue(dadosArtigo({ audio_key: 'a.mp3', audio_em: '2026-08-02 14:30:00' }));
    const { utilizador } = await abrirEstudio();
    await utilizador.click(botao('Gerar novamente'));
    expect(await screen.findByText(/A anterior é substituída/)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RichEditor — o corpo do artigo (TipTap + tiptap-markdown)
// ═════════════════════════════════════════════════════════════════════════════
async function montarEditor({ md = 'Texto do artigo.', ...props } = {}) {
  const emitido = vi.fn();
  const r = renderizar(<><RichEditor initialMarkdown={md} onChangeMarkdown={emitido} {...props} /><Hosts /></>);
  await screen.findByRole('toolbar', { name: 'Formatação' });
  return { ...r, emitido, area: document.querySelector('.ProseMirror') };
}
const ultimoMd = (emitido) => emitido.mock.calls.at(-1)?.[0];
async function selecionarTudo(u, area) {
  await u.click(area);
  await u.keyboard('{Control>}a{/Control}');
}

describe('RichEditor — barra de ferramentas', () => {
  const FERRAMENTAS = [
    'Anular (Ctrl+Z)', 'Refazer (Ctrl+Y)', 'Parágrafo', 'Título de secção (H2)', 'Subtítulo (H3)',
    'Negrito (Ctrl+B)', 'Itálico (Ctrl+I)', 'Sublinhado (Ctrl+U)', 'Rasurado',
    'Lista de pontos', 'Lista numerada', 'Caixa de aviso (citação)',
    'Inserir/editar link', 'Remover link', 'Linha separadora', 'Limpar formatação',
  ];

  it('a barra tem todas as ferramentas', async () => {
    await montarEditor();
    for (const f of FERRAMENTAS) expect(botao(f)).toBeInTheDocument();
  });

  it('nenhum botão da barra submete formulários à volta', async () => {
    await montarEditor();
    for (const f of FERRAMENTAS) expect(botao(f)).toHaveAttribute('type', 'button');
  });

  it('sem edições não há nada para anular nem refazer', async () => {
    await montarEditor();
    expect(botao('Anular (Ctrl+Z)')).toBeDisabled();
    expect(botao('Refazer (Ctrl+Y)')).toBeDisabled();
  });

  it('sem link no cursor não há link para remover', async () => {
    await montarEditor();
    expect(botao('Remover link')).toBeDisabled();
  });

  it('num texto simples o parágrafo está ativo', async () => {
    const { utilizador, area } = await montarEditor();
    await utilizador.click(area);
    await waitFor(() => expect(botao('Parágrafo').className).toContain('active'));
  });
});

describe('RichEditor — formatar o texto', () => {
  it('o negrito envolve o trecho selecionado', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('**Texto do artigo.**'));
  });

  it('o itálico envolve o trecho selecionado', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Itálico (Ctrl+I)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('*Texto do artigo.*'));
  });

  it('o rasurado envolve o trecho selecionado', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Rasurado'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('~~Texto do artigo.~~'));
  });

  it('o negrito fica marcado como ativo depois de aplicado', async () => {
    const { utilizador, area } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(botao('Negrito (Ctrl+B)').className).toContain('active'));
  });

  it('carregar duas vezes no negrito desfaz o negrito', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('**Texto do artigo.**'));
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Texto do artigo.'));
  });

  it('o H2 transforma o parágrafo em título de secção', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Título de secção (H2)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('## Texto do artigo.'));
  });

  it('o H3 transforma o parágrafo em subtítulo', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Subtítulo (H3)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('### Texto do artigo.'));
  });

  it('voltar a parágrafo desfaz o título', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '## Uma secção' });
    await utilizador.click(area);
    await utilizador.click(botao('Parágrafo'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Uma secção'));
  });

  it('a lista de pontos vira travessões em Markdown', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Lista de pontos'));
    await waitFor(() => expect(ultimoMd(emitido)).toContain('- Texto do artigo.'));
  });

  it('a lista numerada vira «1.» em Markdown', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Lista numerada'));
    await waitFor(() => expect(ultimoMd(emitido)).toContain('1. Texto do artigo.'));
  });

  it('a caixa de aviso vira citação — é o aviso legal do blogue', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Caixa de aviso (citação)'));
    await waitFor(() => expect(ultimoMd(emitido)).toContain('> Texto do artigo.'));
  });

  it('a linha separadora entra no Markdown', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await utilizador.click(area);
    await utilizador.click(botao('Linha separadora'));
    await waitFor(() => expect(ultimoMd(emitido)).toContain('---'));
  });

  it('limpar formatação devolve texto simples', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '## **Título forte**' });
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Limpar formatação'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Título forte'));
  });

  it('anular fica disponível depois de uma edição', async () => {
    const { utilizador, area } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(botao('Anular (Ctrl+Z)')).toBeEnabled());
  });

  it('anular desfaz a última edição', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('**Texto do artigo.**'));
    await utilizador.click(botao('Anular (Ctrl+Z)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Texto do artigo.'));
  });

  it('refazer repõe o que foi anulado', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Negrito (Ctrl+B)'));
    await utilizador.click(botao('Anular (Ctrl+Z)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Texto do artigo.'));
    await utilizador.click(botao('Refazer (Ctrl+Y)'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('**Texto do artigo.**'));
  });
});

describe('RichEditor — Markdown de entrada e de saída', () => {
  it('o título de secção do Markdown aparece como H2', async () => {
    await montarEditor({ md: '## O que muda' });
    expect(screen.getByRole('heading', { level: 2, name: 'O que muda' })).toBeInTheDocument();
  });

  it('o subtítulo do Markdown aparece como H3', async () => {
    await montarEditor({ md: '### Detalhe' });
    expect(screen.getByRole('heading', { level: 3, name: 'Detalhe' })).toBeInTheDocument();
  });

  it('o negrito do Markdown aparece a negrito', async () => {
    const { area } = await montarEditor({ md: 'Prazo **de 30 dias**' });
    expect(area.querySelector('strong')).toHaveTextContent('de 30 dias');
  });

  it('a lista do Markdown aparece como lista', async () => {
    await montarEditor({ md: '- um\n- dois' });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('a citação do Markdown aparece como caixa de aviso', async () => {
    const { area } = await montarEditor({ md: '> Este texto não substitui aconselhamento jurídico.' });
    expect(area.querySelector('blockquote')).toHaveTextContent('não substitui aconselhamento jurídico');
  });

  it('o link do Markdown aparece como link', async () => {
    await montarEditor({ md: 'Ver o [IRN](https://irn.justica.gov.pt).' });
    expect(screen.getByRole('link', { name: 'IRN' })).toHaveAttribute('href', 'https://irn.justica.gov.pt');
  });

  it('os links levam rel de segurança', async () => {
    await montarEditor({ md: '[IRN](https://irn.justica.gov.pt)' });
    expect(screen.getByRole('link', { name: 'IRN' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('as fotos do corpo do artigo aparecem no editor', async () => {
    const { area } = await montarEditor({ md: '![Legenda da foto](/api/insights/images/i1)' });
    const img = area.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/insights/images/i1');
    expect(img).toHaveAttribute('alt', 'Legenda da foto');
  });

  it('as fotos do corpo carregam em diferido', async () => {
    const { area } = await montarEditor({ md: '![](/api/insights/images/i1)' });
    expect(area.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('escrever no corpo devolve o Markdown ao estúdio', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '' });
    await utilizador.click(area);
    await utilizador.keyboard('Uma frase nova');
    await waitFor(() => expect(ultimoMd(emitido)).toBe('Uma frase nova'));
  });

  it('só emite Markdown quando o texto muda', async () => {
    const { emitido } = await montarEditor();
    expect(emitido).not.toHaveBeenCalled();
  });

  it('o Markdown de saída guarda os títulos escritos', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '' });
    await utilizador.click(area);
    await utilizador.click(botao('Título de secção (H2)'));
    await utilizador.keyboard('Uma secção');
    await waitFor(() => expect(ultimoMd(emitido)).toBe('## Uma secção'));
  });

  it('um artigo novo mudar de artigo recarrega o corpo', async () => {
    const emitido = vi.fn();
    const { rerender } = renderizar(<RichEditor initialMarkdown="Primeiro artigo." onChangeMarkdown={emitido} />);
    await screen.findByRole('toolbar', { name: 'Formatação' });
    rerender(<RichEditor initialMarkdown="Segundo artigo." onChangeMarkdown={emitido} />);
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('Segundo artigo.'));
  });

  it('Markdown vazio não parte o editor', async () => {
    const { area } = await montarEditor({ md: '' });
    expect(area).toBeInTheDocument();
  });

  it('Markdown nulo não parte o editor', async () => {
    const { area } = await montarEditor({ md: null });
    expect(area).toBeInTheDocument();
  });
});

describe('RichEditor — placeholder e estado', () => {
  it('sem texto mostra o convite que lhe passam', async () => {
    const { area } = await montarEditor({ md: '', placeholder: 'Corpo do artigo…' });
    expect(area.querySelector('[data-placeholder]')).toHaveAttribute('data-placeholder', 'Corpo do artigo…');
  });

  it('sem placeholder próprio usa o convite por omissão', async () => {
    const { area } = await montarEditor({ md: '' });
    expect(area.querySelector('[data-placeholder]')).toHaveAttribute('data-placeholder', 'Escreva o artigo…');
  });

  it('com texto o editor não fica marcado como vazio', async () => {
    const { area } = await montarEditor({ md: 'Já tem texto.' });
    expect(area.querySelector('.is-editor-empty')).toBeNull();
  });

  it('o corpo do artigo é editável', async () => {
    const { area } = await montarEditor();
    expect(area).toHaveAttribute('contenteditable', 'true');
  });

  it('um diálogo aberto desativa o editor (não rouba o teclado)', async () => {
    const { area } = await montarEditor();
    window.dispatchEvent(new CustomEvent('adm-dialog-open'));
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'false'));
  });

  it('fechado o diálogo o editor volta a ser editável', async () => {
    const { area } = await montarEditor();
    window.dispatchEvent(new CustomEvent('adm-dialog-open'));
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'false'));
    window.dispatchEvent(new CustomEvent('adm-dialog-close'));
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'true'));
  });

  it('escrever num campo de fora desativa o editor (queixa do título)', async () => {
    const { utilizador, area } = await montarEditor();
    const fora = document.createElement('textarea');
    document.body.appendChild(fora);
    await utilizador.click(fora);
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'false'));
    fora.remove();
  });

  it('voltar ao corpo do artigo devolve-lhe a escrita', async () => {
    const { utilizador, area } = await montarEditor();
    const fora = document.createElement('textarea');
    document.body.appendChild(fora);
    await utilizador.click(fora);
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'false'));
    await utilizador.click(area);
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'true'));
    fora.remove();
  });
});

describe('RichEditor — links', () => {
  it('inserir link pergunta o endereço', async () => {
    const { utilizador, area } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Inserir/editar link'));
    expect(await screen.findByText('Endereço do link:')).toBeInTheDocument();
    expect(screen.getByText('Inserir link')).toBeInTheDocument();
  });

  it('o endereço escrito vira link no texto', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Inserir/editar link'));
    await screen.findByText('Endereço do link:');
    await utilizador.type(campoDoPrompt('Endereço do link:'), 'https://irn.justica.gov.pt');
    await utilizador.click(botao('OK'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('[Texto do artigo.](https://irn.justica.gov.pt)'));
  });

  it('cancelar o endereço não mexe no texto', async () => {
    const { utilizador, area, emitido } = await montarEditor();
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Inserir/editar link'));
    await screen.findByText('Endereço do link:');
    await utilizador.click(botao('Cancelar'));
    await waitFor(() => expect(area).toHaveTextContent('Texto do artigo.'));
    expect(area.querySelector('a')).toBeNull();
  });

  it('apagar o endereço retira o link e deixa o texto', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '[IRN](https://irn.justica.gov.pt)' });
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Inserir/editar link'));
    await screen.findByText('Endereço do link:');
    await utilizador.clear(campoDoPrompt('Endereço do link:'));
    await utilizador.click(botao('OK'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('IRN'));
  });

  it('editar um link já existente traz o endereço atual', async () => {
    const { utilizador, area } = await montarEditor({ md: '[IRN](https://irn.justica.gov.pt)' });
    await selecionarTudo(utilizador, area);
    await utilizador.click(botao('Inserir/editar link'));
    await screen.findByText('Endereço do link:');
    expect(campoDoPrompt('Endereço do link:')).toHaveValue('https://irn.justica.gov.pt');
  });

  it('«Remover link» liberta-se com o cursor dentro de um link', async () => {
    const { utilizador, area } = await montarEditor({ md: '[IRN](https://irn.justica.gov.pt)' });
    await selecionarTudo(utilizador, area);
    await waitFor(() => expect(botao('Remover link')).toBeEnabled());
  });

  it('«Remover link» tira o link e deixa o texto', async () => {
    const { utilizador, area, emitido } = await montarEditor({ md: '[IRN](https://irn.justica.gov.pt)' });
    await selecionarTudo(utilizador, area);
    await waitFor(() => expect(botao('Remover link')).toBeEnabled());
    await utilizador.click(botao('Remover link'));
    await waitFor(() => expect(ultimoMd(emitido)).toBe('IRN'));
  });
});

describe('RichEditor — API para o estúdio', () => {
  const comApi = async (props = {}) => {
    const apiRef = React.createRef();
    const r = await montarEditor({ apiRef, ...props });
    await waitFor(() => expect(apiRef.current).toBeTruthy());
    return { ...r, apiRef };
  };

  it('a API fica disponível ao estúdio', async () => {
    const { apiRef } = await comApi();
    expect(typeof apiRef.current.textoEntre).toBe('function');
    expect(typeof apiRef.current.substituirTrecho).toBe('function');
    expect(typeof apiRef.current.limparSelecao).toBe('function');
  });

  it('textoEntre devolve o trecho pedido', async () => {
    const { apiRef } = await comApi();
    expect(apiRef.current.textoEntre(1, 6)).toBe('Texto');
  });

  it('textoEntre não rebenta com posições fora do documento', async () => {
    const { apiRef } = await comApi();
    expect(() => apiRef.current.textoEntre(1, 99999)).not.toThrow();
  });

  it('substituirTrecho troca só o trecho indicado', async () => {
    const { apiRef, area } = await comApi();
    apiRef.current.substituirTrecho(1, 6, 'Frase');
    await waitFor(() => expect(area).toHaveTextContent('Frase do artigo.'));
  });

  it('substituirTrecho interpreta o texto novo como Markdown', async () => {
    const { apiRef, area } = await comApi();
    apiRef.current.substituirTrecho(1, 6, '**Forte**');
    await waitFor(() => expect(area.querySelector('strong')).toHaveTextContent('Forte'));
  });

  it('substituirTrecho volta a ligar a escrita mesmo com o editor desativado', async () => {
    const { apiRef, area } = await comApi();
    window.dispatchEvent(new CustomEvent('adm-dialog-open'));
    await waitFor(() => expect(area).toHaveAttribute('contenteditable', 'false'));
    apiRef.current.substituirTrecho(1, 6, 'Frase');
    await waitFor(() => expect(area).toHaveTextContent('Frase do artigo.'));
  });

  it('a seleção é avisada ao estúdio quando há trecho marcado', async () => {
    const onSelectionChange = vi.fn();
    const { utilizador, area } = await montarEditor({ onSelectionChange });
    await selecionarTudo(utilizador, area);
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ texto: 'Texto do artigo.' })));
  });

  it('a seleção traz também o trecho em Markdown', async () => {
    const onSelectionChange = vi.fn();
    const { utilizador, area } = await montarEditor({ md: '## O que muda', onSelectionChange });
    await selecionarTudo(utilizador, area);
    await waitFor(() => expect(onSelectionChange.mock.calls.at(-1)[0].md).toContain('O que muda'));
  });

  it('limparSelecao avisa que já não há trecho marcado', async () => {
    const onSelectionChange = vi.fn();
    const apiRef = React.createRef();
    const { utilizador, area } = await montarEditor({ onSelectionChange, apiRef });
    await selecionarTudo(utilizador, area);
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ texto: 'Texto do artigo.' })));
    apiRef.current.limparSelecao();
    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(null));
  });
});
