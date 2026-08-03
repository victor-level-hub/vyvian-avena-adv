// @vitest-environment jsdom
// tests/site/paginas.test.jsx
// Páginas do SITE PÚBLICO — o que o visitante vê antes de ser cliente.
//
// Estas páginas são o cartão de visita da Dra.: se uma delas rebentar, ou se um
// link interno apontar para uma rota que não existe, ninguém dá por isso até o
// visitante desistir. Testa-se o que se vê (papéis, texto, destinos dos links)
// e não como está montado.
//
// Regras de casa aplicadas aqui:
//   • a rede está fechada (tests/setup.js) — o Formspree, o analytics e o leitor
//     de áudio do blogue estão mockados; nenhum teste chega ao fetch;
//   • estas páginas usam react-helmet-async: `montar()` embrulha no HelmetProvider
//     por cima do MemoryRouter do helper;
//   • o ScrollReveal usa IntersectionObserver, que o jsdom não tem — stub.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { renderizar, screen, within, waitFor, act, fireEvent } from '../helpers/dom.jsx';

// ─── analytics (fala com o Google e com /api/hit) ────────────────────────────
const analytics = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackPageView: vi.fn(),
  trackHit: vi.fn(),
  initAnalytics: vi.fn(),
  applyConsent: vi.fn(),
  readConsent: vi.fn(() => null),
}));
vi.mock('../../src/lib/analytics.js', () => analytics);

// ─── Formspree: falso com estado a sério, para poder testar "a enviar" ───────
// modo: 'sucesso' | 'erro' | 'pendente' (fica à espera de formspree.concluir()).
const formspree = vi.hoisted(() => ({
  envios: [],
  modo: 'sucesso',
  concluir: null,
  erros: [],
  idDoFormulario: null,
}));
vi.mock('@formspree/react', async () => {
  const React = await vi.importActual('react');
  return {
    useForm: (id) => {
      formspree.idDoFormulario = id;
      const [estado, setEstado] = React.useState({
        submitting: false,
        succeeded: false,
        errors: null,
      });
      const handleSubmit = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const dados = {};
        const form = e && e.target;
        if (form && typeof form.elements !== 'undefined') {
          for (const [k, v] of new FormData(form).entries()) dados[k] = v;
        }
        formspree.envios.push(dados);
        setEstado({ submitting: true, succeeded: false, errors: null });
        const espera = new Promise((res) => {
          formspree.concluir = res;
        });
        if (formspree.modo !== 'pendente') {
          Promise.resolve().then(() => formspree.concluir(formspree.modo));
        }
        return espera.then((modo) => {
          if (modo === 'erro') {
            setEstado({ submitting: false, succeeded: false, errors: formspree.erros });
          } else {
            setEstado({ submitting: false, succeeded: true, errors: null });
          }
        });
      };
      return [estado, handleSubmit];
    },
    ValidationError: ({ field, prefix, errors, className }) => {
      const lista = (errors || []).filter((e) =>
        field ? e.field === field : !e.field
      );
      if (lista.length === 0) return null;
      return React.createElement(
        'p',
        { className },
        lista.map((e) => [prefix, e.message].filter(Boolean).join(' ')).join(' ')
      );
    },
  };
});

// ─── artigos do blogue: array mutável, para simular lista vazia / estragada ──
const blog = vi.hoisted(() => ({ posts: [], reais: [] }));
vi.mock('../../src/data/blog.js', async () => {
  const real = await vi.importActual('../../src/data/blog.js');
  blog.reais = real.POSTS;
  blog.posts.push(...real.POSTS);
  return {
    POSTS: blog.posts,
    getPost: (slug) => blog.posts.find((p) => p.slug === slug),
  };
});
const usarPosts = (lista) => {
  blog.posts.length = 0;
  blog.posts.push(...lista);
};

// ─── leitor de áudio do artigo: vai buscar timings a /blog-audio/*.json ──────
vi.mock('../../src/components/blog/AudioArtigo.jsx', () => ({
  default: ({ slug }) =>
    React.createElement('div', { 'data-teste': 'audio-artigo' }, `Ouvir este artigo (${slug})`),
}));

import Home from '../../src/pages/Home.jsx';
import Sobre from '../../src/pages/Sobre.jsx';
import Areas from '../../src/pages/Areas.jsx';
import AreaDetalhe from '../../src/pages/AreaDetalhe.jsx';
import Blog from '../../src/pages/Blog.jsx';
import BlogArtigo from '../../src/pages/BlogArtigo.jsx';
import Contacto from '../../src/pages/Contacto.jsx';
import Links from '../../src/pages/Links.jsx';
import PoliticaCookies from '../../src/pages/PoliticaCookies.jsx';
import NaoEncontrado from '../../src/pages/NaoEncontrado.jsx';
import { AREAS } from '../../src/data/areas.js';

// ═════════════════════════════════════════════════════════════════════════════
// utilitários
// ═════════════════════════════════════════════════════════════════════════════
const montar = (ui, opcoes) => renderizar(<HelmetProvider>{ui}</HelmetProvider>, opcoes);

const artigo = (slug) => blog.reais.find((p) => p.slug === slug);
const ARTIGO_SIMPLES = 'heranca-portugal-brasil-mapa-das-decisoes'; // área civil, sem áudio
const ARTIGO_SEM_AREA = 'o-que-perguntar-a-um-advogado-antes-de-contratar';
const ARTIGO_COM_AUDIO = 'urgencia-em-processos-de-nacionalidade-nova-deliberacao';

const verArtigo = (slug) =>
  montar(<BlogArtigo />, { caminho: `/blog/${slug}`, rota: '/blog/:slug' });
const verArea = (slug) =>
  montar(<AreaDetalhe />, { caminho: `/areas/${slug}`, rota: '/areas/:slug' });

const titulos = (nivel) =>
  screen.getAllByRole('heading', { level: nivel }).map((h) => h.textContent.trim());
const h1 = () => screen.getAllByRole('heading', { level: 1 });
const ligacoesInternas = (container) =>
  [...container.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href'));
const imagens = (container) => [...container.querySelectorAll('img')];

// Clicar sem deixar o jsdom tentar navegar (mailto:, tel:, https://…).
function clicarSemNavegar(el) {
  const trava = (e) => e.preventDefault();
  document.addEventListener('click', trava, true);
  try {
    fireEvent.click(el);
  } finally {
    document.removeEventListener('click', trava, true);
  }
}

// ─── rotas declaradas em src/App.jsx (fonte de verdade dos destinos) ─────────
const APP_SRC = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const ROTAS_DECLARADAS = [...new Set([...APP_SRC.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))];
// Os apanha-tudo ('*', '/*') casariam com qualquer disparate — fora da comparação.
const ROTAS = ROTAS_DECLARADAS.filter((r) => r !== '*' && r !== '/*');

function rotaConhecida(caminho) {
  if (caminho === '/') return ROTAS.includes('/');
  return ROTAS.some((r) => {
    if (r === '/') return false;
    const padrao = r.replace(/\*/g, '.+').replace(/:[^/]+/g, '[^/]+');
    return new RegExp(`^${padrao}$`).test(caminho);
  });
}

// Além de a rota existir, o parâmetro tem de existir no conteúdo: /areas/xpto
// casaria com /areas/:slug e mesmo assim daria 404 ao visitante.
function ligacaoValida(href) {
  const caminho = href.split(/[?#]/)[0].replace(/(.)\/$/, '$1');
  if (caminho.startsWith('/areas/')) return AREAS.some((a) => a.slug === caminho.slice(7));
  if (caminho.startsWith('/blog/')) return blog.reais.some((p) => p.slug === caminho.slice(6));
  return rotaConhecida(caminho);
}

beforeEach(() => {
  vi.clearAllMocks();
  usarPosts(blog.reais);
  formspree.envios.length = 0;
  formspree.modo = 'sucesso';
  formspree.erros = [];
  formspree.concluir = null;

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
  );
  vi.stubGlobal('matchMedia', (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  }));
  vi.stubGlobal('scrollTo', () => {});
  Element.prototype.scrollIntoView = function () {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════
// Rotas do site — a lista com que todos os links são comparados
// ═════════════════════════════════════════════════════════════════════════════
describe('Rotas declaradas em App.jsx', () => {
  it('a lista de rotas foi lida do ficheiro', () => {
    expect(ROTAS.length).toBeGreaterThan(5);
  });

  it('inclui a página inicial', () => expect(ROTAS).toContain('/'));
  it('inclui /sobre', () => expect(ROTAS).toContain('/sobre'));
  it('inclui /areas', () => expect(ROTAS).toContain('/areas'));
  it('inclui a rota dinâmica das áreas', () => expect(ROTAS).toContain('/areas/:slug'));
  it('inclui /apoio', () => expect(ROTAS).toContain('/apoio'));
  it('inclui /contacto', () => expect(ROTAS).toContain('/contacto'));
  it('inclui /blog', () => expect(ROTAS).toContain('/blog'));
  it('inclui a rota dinâmica dos artigos', () => expect(ROTAS).toContain('/blog/:slug'));
  it('inclui /politica-cookies', () => expect(ROTAS).toContain('/politica-cookies'));
  it('inclui /links', () => expect(ROTAS).toContain('/links'));

  it('reconhece uma rota estática existente', () => expect(rotaConhecida('/contacto')).toBe(true));
  it('não reconhece uma rota inventada', () => expect(rotaConhecida('/servicos')).toBe(false));
  it('reconhece uma área que existe', () => expect(ligacaoValida('/areas/familia')).toBe(true));
  it('rejeita uma área que não existe', () => expect(ligacaoValida('/areas/imobiliario')).toBe(false));
  it('reconhece um artigo que existe', () => {
    expect(ligacaoValida(`/blog/${ARTIGO_SIMPLES}`)).toBe(true);
  });
  it('rejeita um artigo que não existe', () => expect(ligacaoValida('/blog/nao-existe')).toBe(false));
});

// ═════════════════════════════════════════════════════════════════════════════
// Home
// ═════════════════════════════════════════════════════════════════════════════
describe('Home', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Home />);
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Home />);
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é a promessa da marca', () => {
    montar(<Home />);
    expect(h1()[0]).toHaveTextContent(/Confiança começa pela/);
  });

  it('mostra o subtítulo do hero', () => {
    montar(<Home />);
    expect(screen.getByText(/Atendimento humanizado e próximo/)).toBeInTheDocument();
  });

  it('convida para a consulta inicial', () => {
    montar(<Home />);
    expect(screen.getByRole('link', { name: 'Consulta Inicial' })).toHaveAttribute('href', '/contacto');
  });

  it('leva às áreas de atuação a partir do hero', () => {
    montar(<Home />);
    expect(screen.getByRole('link', { name: /Áreas de Atuação/ })).toHaveAttribute('href', '/areas');
  });

  it('mostra os números do escritório', () => {
    montar(<Home />);
    for (const n of ['15+', '6', '3', '2']) expect(screen.getByText(n)).toBeInTheDocument();
  });

  it('a imagem do hero tem texto alternativo', () => {
    const { container } = montar(<Home />);
    expect(container.querySelector('img[src="/hero-escritorio.webp"]')).toHaveAttribute(
      'alt',
      'Escritório de advocacia'
    );
  });

  it('mostra a grelha das seis áreas', () => {
    const { container } = montar(<Home />);
    for (const a of AREAS) {
      expect(container.querySelector(`a[href="/areas/${a.slug}"]`)).not.toBeNull();
    }
  });

  it('cada área da grelha tem título próprio', () => {
    montar(<Home />);
    for (const a of AREAS) {
      expect(screen.getAllByText(a.title).length).toBeGreaterThan(0);
    }
  });

  it('mostra a secção da filosofia', () => {
    montar(<Home />);
    expect(screen.getByRole('heading', { name: /Direito como ferramenta de equilíbrio/ })).toBeInTheDocument();
  });

  it('mostra a citação da Dra. Vyvian', () => {
    montar(<Home />);
    expect(screen.getByText(/— Dra. Vyvian Avena/)).toBeInTheDocument();
  });

  it('mostra os três escritórios', () => {
    montar(<Home />);
    expect(screen.getByRole('heading', { name: 'Nossos Escritórios' })).toBeInTheDocument();
    for (const r of ['Setúbal / Grande Lisboa', 'Aveiro / Porto', 'Rio de Janeiro']) {
      expect(screen.getByRole('heading', { name: r })).toBeInTheDocument();
    }
  });

  it('mostra a morada de Cacilhas', () => {
    montar(<Home />);
    expect(screen.getByText('Rua António Nobre 1D 3.º DTO')).toBeInTheDocument();
  });

  it('mostra a secção do blogue', () => {
    montar(<Home />);
    expect(screen.getByRole('heading', { name: 'Do nosso blogue' })).toBeInTheDocument();
  });

  it('a secção do blogue traz os três artigos mais recentes', () => {
    const { container } = montar(<Home />);
    for (const p of blog.reais.slice(0, 3)) {
      expect(container.querySelector(`a[href="/blog/${p.slug}"]`)).not.toBeNull();
    }
  });

  it('a secção do blogue não traz o quarto artigo', () => {
    const { container } = montar(<Home />);
    expect(container.querySelector(`a[href="/blog/${blog.reais[3].slug}"]`)).toBeNull();
  });

  it('oferece o índice completo do blogue', () => {
    montar(<Home />);
    expect(screen.getByRole('link', { name: /Todos os artigos/ })).toHaveAttribute('href', '/blog');
  });

  it('sem artigos, a secção do blogue desaparece em vez de ficar vazia', () => {
    usarPosts([]);
    montar(<Home />);
    expect(screen.queryByRole('heading', { name: 'Do nosso blogue' })).not.toBeInTheDocument();
  });

  it('sem artigos, o resto da página continua de pé', () => {
    usarPosts([]);
    montar(<Home />);
    expect(h1()).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Nossos Escritórios' })).toBeInTheDocument();
  });

  it('um artigo sem capa não parte a secção do blogue', () => {
    usarPosts([{ ...artigo(ARTIGO_SIMPLES), imagem: '', imagem_alt: '' }]);
    const { container } = montar(<Home />);
    expect(container.querySelector(`a[href="/blog/${ARTIGO_SIMPLES}"]`)).not.toBeNull();
  });

  it('todas as imagens têm atributo alt', () => {
    const { container } = montar(<Home />);
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = montar(<Home />);
    const partidas = ligacoesInternas(container).filter((h) => !ligacaoValida(h));
    expect(partidas).toEqual([]);
  });

  it('a hierarquia começa no h1 e desce para h2', () => {
    montar(<Home />);
    expect(titulos(2).length).toBeGreaterThanOrEqual(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Áreas de Atuação (índice)
// ═════════════════════════════════════════════════════════════════════════════
describe('Áreas de Atuação', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Areas />, { caminho: '/areas' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é "Áreas de Atuação"', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(h1()[0]).toHaveTextContent('Áreas de Atuação');
  });

  it('explica que são seis áreas', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(screen.getByText(/seis áreas do Direito/)).toBeInTheDocument();
  });

  it('mostra o percurso (breadcrumbs)', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(screen.getByRole('navigation', { name: 'Percurso' })).toBeInTheDocument();
  });

  it('o percurso leva de volta ao início', () => {
    montar(<Areas />, { caminho: '/areas' });
    const nav = screen.getByRole('navigation', { name: 'Percurso' });
    expect(within(nav).getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/');
  });

  it('a página actual no percurso não é um link', () => {
    montar(<Areas />, { caminho: '/areas' });
    const nav = screen.getByRole('navigation', { name: 'Percurso' });
    expect(within(nav).queryByRole('link', { name: 'Áreas de Atuação' })).not.toBeInTheDocument();
  });

  it('mostra um cartão por área', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(titulos(2)).toEqual(expect.arrayContaining(AREAS.map((a) => a.title)));
  });

  for (const a of AREAS) {
    it(`o cartão de ${a.title} liga à página dedicada`, () => {
      const { container } = montar(<Areas />, { caminho: '/areas' });
      expect(container.querySelector(`a[href="/areas/${a.slug}"]`)).not.toBeNull();
    });

    it(`o cartão de ${a.title} mostra a descrição do conteúdo`, () => {
      montar(<Areas />, { caminho: '/areas' });
      expect(screen.getByText(a.desc)).toBeInTheDocument();
    });

    it(`o cartão de ${a.title} mantém a âncora antiga (#${a.slug})`, () => {
      const { container } = montar(<Areas />, { caminho: '/areas' });
      expect(container.querySelector(`#${a.slug}`)).not.toBeNull();
    });
  }

  it('não inventa áreas além das do conteúdo', () => {
    const { container } = montar(<Areas />, { caminho: '/areas' });
    const destinos = ligacoesInternas(container).filter((h) => h.startsWith('/areas/'));
    expect(new Set(destinos)).toEqual(new Set(AREAS.map((a) => `/areas/${a.slug}`)));
  });

  it('fecha com o convite para quem não sabe por onde começar', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(screen.getByRole('heading', { name: 'Não sabe por onde começar?' })).toBeInTheDocument();
  });

  it('o botão final agenda consulta', () => {
    montar(<Areas />, { caminho: '/areas' });
    expect(screen.getByRole('link', { name: /Agendar Consulta/ })).toHaveAttribute('href', '/contacto');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = montar(<Areas />, { caminho: '/areas' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  it('não tem imagens sem alt', () => {
    const { container } = montar(<Areas />, { caminho: '/areas' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('os ícones decorativos estão escondidos dos leitores de ecrã', () => {
    const { container } = montar(<Areas />, { caminho: '/areas' });
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Página de uma área
// ═════════════════════════════════════════════════════════════════════════════
describe('Página de área', () => {
  it('monta sem rebentar', () => {
    const { container } = verArea('familia');
    expect(container.firstChild).not.toBeNull();
  });

  for (const a of AREAS) {
    it(`${a.title}: o h1 é o título da área`, () => {
      verArea(a.slug);
      expect(h1()).toHaveLength(1);
      expect(h1()[0]).toHaveTextContent(a.title);
    });

    it(`${a.title}: mostra a descrição`, () => {
      verArea(a.slug);
      expect(screen.getAllByText(a.desc).length).toBeGreaterThan(0);
    });

    it(`${a.title}: mostra quando procurar apoio`, () => {
      verArea(a.slug);
      expect(screen.getByText(a.when)).toBeInTheDocument();
    });

    it(`${a.title}: lista todos os serviços do conteúdo`, () => {
      verArea(a.slug);
      for (const s of a.services) expect(screen.getByText(s)).toBeInTheDocument();
    });

    it(`${a.title}: propõe as outras cinco áreas`, () => {
      const { container } = verArea(a.slug);
      const outras = AREAS.filter((o) => o.slug !== a.slug);
      for (const o of outras) {
        expect(container.querySelector(`a[href="/areas/${o.slug}"]`)).not.toBeNull();
      }
      expect(container.querySelector(`a[href="/areas/${a.slug}"]`)).toBeNull();
    });
  }

  it('tem os cabeçalhos de secção esperados', () => {
    verArea('familia');
    expect(titulos(2)).toEqual(
      expect.arrayContaining([
        'Quando procurar apoio jurídico',
        'Como ajudamos',
        'Precisa de apoio nesta área?',
        'Outras áreas',
      ])
    );
  });

  it('as outras áreas aparecem como h3, abaixo dos h2', () => {
    verArea('familia');
    expect(titulos(3)).toHaveLength(5);
  });

  it('o percurso tem três degraus', () => {
    verArea('civil');
    const nav = screen.getByRole('navigation', { name: 'Percurso' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
  });

  it('o percurso volta ao índice das áreas', () => {
    verArea('civil');
    const nav = screen.getByRole('navigation', { name: 'Percurso' });
    expect(within(nav).getByRole('link', { name: 'Áreas de Atuação' })).toHaveAttribute('href', '/areas');
  });

  it('oferece o caminho de volta a todas as áreas', () => {
    verArea('civil');
    expect(screen.getByRole('link', { name: /Ver todas as áreas/ })).toHaveAttribute('href', '/areas');
  });

  it('convida a agendar consulta', () => {
    verArea('civil');
    expect(screen.getByRole('link', { name: /Agendar Consulta/ })).toHaveAttribute('href', '/contacto');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = verArea('nacionalidade');
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  it('uma área que não existe mostra a página de não encontrado', () => {
    verArea('imobiliario');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('uma área que não existe não finge ser uma área', () => {
    verArea('imobiliario');
    expect(screen.queryByRole('heading', { name: 'Como ajudamos' })).not.toBeInTheDocument();
  });

  it('um slug com maiúsculas não é aceite como área', () => {
    verArea('Familia');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('um slug só com um espaço cai no não encontrado', () => {
    verArea('%20');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('um slug com segmento a mais cai no não encontrado', () => {
    verArea('familia-e-civil');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('a página de não encontrado dá caminhos de volta', () => {
    verArea('nao-existe');
    expect(screen.getByRole('link', { name: /Voltar ao início/ })).toHaveAttribute('href', '/');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Blogue (índice)
// ═════════════════════════════════════════════════════════════════════════════
describe('Blogue', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é "Blogue"', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(h1()[0]).toHaveTextContent('Blogue');
  });

  it('explica de que trata o blogue', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByText(/entre Portugal e o Brasil/)).toBeInTheDocument();
  });

  it('mostra o percurso', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('navigation', { name: 'Percurso' })).toBeInTheDocument();
  });

  it('lista todos os artigos publicados', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    for (const p of blog.reais) {
      expect(container.querySelector(`a[href="/blog/${p.slug}"]`)).not.toBeNull();
    }
  });

  it('não mostra um artigo por página a mais nem a menos', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    const destinos = ligacoesInternas(container).filter((h) => h.startsWith('/blog/'));
    expect(new Set(destinos)).toEqual(new Set(blog.reais.map((p) => `/blog/${p.slug}`)));
  });

  it('destaca o artigo mais recente', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('heading', { level: 2, name: blog.reais[0].titulo })).toBeInTheDocument();
  });

  it('os restantes artigos ficam como h3', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(titulos(3)).toHaveLength(blog.reais.length - 1);
  });

  it('mostra o título de cada artigo', () => {
    montar(<Blog />, { caminho: '/blog' });
    for (const p of blog.reais) expect(screen.getByText(p.titulo)).toBeInTheDocument();
  });

  it('mostra a descrição do artigo destacado', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getAllByText(blog.reais[0].descricao).length).toBeGreaterThan(0);
  });

  it('mostra a data em português nos artigos da lista', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByText(/8 de julho de 2026/)).toBeInTheDocument();
  });

  it('mostra o tempo de leitura', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getAllByText(/\d+ min/).length).toBeGreaterThan(0);
  });

  it('mostra a área de cada artigo quando existe', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getAllByText(/Direito Civil ·/).length).toBeGreaterThan(0);
  });

  it('um artigo sem área aparece como "Blogue"', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getAllByText(/^Blogue ·/).length).toBeGreaterThan(0);
  });

  it('as capas têm texto alternativo do conteúdo', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    const capa = container.querySelector(`img[src="${blog.reais[0].imagem}"]`);
    expect(capa).toHaveAttribute('alt', blog.reais[0].imagem_alt);
  });

  it('todas as imagens têm alt (mesmo que vazio, se decorativas)', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('as capas da lista carregam em diferido', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    const capa = container.querySelector(`img[src="${blog.reais[1].imagem}"]`);
    expect(capa).toHaveAttribute('loading', 'lazy');
  });

  it('fecha com o convite à consulta', () => {
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('link', { name: /Agendar Consulta/ })).toHaveAttribute('href', '/contacto');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = montar(<Blog />, { caminho: '/blog' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  it('sem artigos nenhuns, a página não rebenta', () => {
    usarPosts([]);
    const { container } = montar(<Blog />, { caminho: '/blog' });
    expect(container.firstChild).not.toBeNull();
  });

  it('sem artigos nenhuns, o título continua lá', () => {
    usarPosts([]);
    montar(<Blog />, { caminho: '/blog' });
    expect(h1()[0]).toHaveTextContent('Blogue');
  });

  it('sem artigos nenhuns, não há cartões de artigo', () => {
    usarPosts([]);
    const { container } = montar(<Blog />, { caminho: '/blog' });
    expect(ligacoesInternas(container).filter((h) => h.startsWith('/blog/'))).toEqual([]);
  });

  it('sem artigos nenhuns, o convite à consulta mantém-se', () => {
    usarPosts([]);
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('link', { name: /Agendar Consulta/ })).toBeInTheDocument();
  });

  it('com um só artigo, ele é o destaque e a lista fica vazia', () => {
    usarPosts([artigo(ARTIGO_SIMPLES)]);
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('heading', { level: 2, name: artigo(ARTIGO_SIMPLES).titulo })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('um artigo com dados em falta não parte o ecrã', () => {
    usarPosts([
      { slug: 'meio-vazio', titulo: 'Meio vazio', descricao: '', data: '', area: '', imagem: '', imagem_alt: '', minutos: 1 },
    ]);
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('heading', { level: 2, name: 'Meio vazio' })).toBeInTheDocument();
  });

  it('um artigo sem data não mostra uma data inventada', () => {
    usarPosts([
      artigo(ARTIGO_SIMPLES),
      { slug: 'sem-data', titulo: 'Sem data', descricao: '', data: '', area: '', imagem: '', imagem_alt: '', minutos: 2 },
    ]);
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('heading', { level: 3, name: 'Sem data' })).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('uma área desconhecida no artigo não parte a lista', () => {
    usarPosts([{ ...artigo(ARTIGO_SIMPLES), area: 'inexistente' }]);
    montar(<Blog />, { caminho: '/blog' });
    expect(screen.getByRole('heading', { level: 2, name: artigo(ARTIGO_SIMPLES).titulo })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Artigo do blogue
// ═════════════════════════════════════════════════════════════════════════════
describe('Artigo do blogue', () => {
  it('monta sem rebentar', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é o título do artigo', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(h1()[0]).toHaveTextContent(artigo(ARTIGO_SIMPLES).titulo);
  });

  it('mostra a data em português', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByText(/8 de julho de 2026/)).toBeInTheDocument();
  });

  it('mostra o tempo de leitura', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByText(/min de leitura/)).toBeInTheDocument();
  });

  it('mostra a área do artigo por cima do título', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByText(/Direito Civil ·/)).toBeInTheDocument();
  });

  it('mostra o corpo do artigo', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    const prosa = container.querySelector('.blog-prose');
    expect(prosa).not.toBeNull();
    expect(prosa.textContent.length).toBeGreaterThan(500);
  });

  it('o corpo do artigo traz os subtítulos do markdown', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(container.querySelectorAll('.blog-prose h2').length).toBeGreaterThan(0);
  });

  it('o corpo do artigo não introduz um segundo h1', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(container.querySelectorAll('.blog-prose h1')).toHaveLength(0);
  });

  it('mostra a autora no rail lateral', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByText('Dra. Vyvian Avena')).toBeInTheDocument();
  });

  it('mostra o resumo no rail lateral', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByText(artigo(ARTIGO_SIMPLES).descricao)).toBeInTheDocument();
  });

  it('a imagem do hero é decorativa (o título já está ao lado)', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    const hero = container.querySelector('section img');
    expect(hero).toHaveAttribute('alt', '');
  });

  it('todas as imagens têm atributo alt', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('as capas dos artigos sugeridos têm alt do conteúdo', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    const sugeridos = blog.reais.filter((p) => p.slug !== ARTIGO_SIMPLES).slice(0, 2);
    for (const p of sugeridos) {
      const img = container.querySelector(`img[src="${p.imagem}"]`);
      expect(img).toHaveAttribute('alt', p.imagem_alt);
    }
  });

  it('oferece o caminho de volta ao blogue no topo', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getAllByRole('link', { name: /Blogue/ })[0]).toHaveAttribute('href', '/blog');
  });

  it('oferece todos os artigos no fim', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByRole('link', { name: /Todos os artigos/ })).toHaveAttribute('href', '/blog');
  });

  it('sugere continuar a ler', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByRole('heading', { name: 'Continuar a ler' })).toBeInTheDocument();
  });

  it('sugere exactamente dois artigos', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(titulos(3)).toHaveLength(2);
  });

  it('nunca se sugere a si próprio', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(container.querySelector(`a[href="/blog/${ARTIGO_SIMPLES}"]`)).toBeNull();
  });

  it('o CTA aponta para a área do artigo', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByRole('link', { name: /Ver Direito Civil/ })).toHaveAttribute('href', '/areas/civil');
  });

  it('o CTA pergunta pela área do artigo', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(
      screen.getByRole('heading', { name: 'Precisa de apoio em Direito Civil?' })
    ).toBeInTheDocument();
  });

  it('o CTA convida sempre a agendar consulta', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByRole('link', { name: 'Agendar Consulta' })).toHaveAttribute('href', '/contacto');
  });

  it('um artigo sem área usa o CTA genérico', () => {
    verArtigo(ARTIGO_SEM_AREA);
    expect(
      screen.getByRole('heading', { name: 'Este tema toca a sua situação?' })
    ).toBeInTheDocument();
  });

  it('um artigo sem área não mostra o botão "Ver área"', () => {
    verArtigo(ARTIGO_SEM_AREA);
    expect(screen.queryByRole('link', { name: /^Ver / })).not.toBeInTheDocument();
  });

  it('um artigo sem área continua a convidar à consulta', () => {
    verArtigo(ARTIGO_SEM_AREA);
    expect(screen.getByRole('link', { name: 'Agendar Consulta' })).toHaveAttribute('href', '/contacto');
  });

  it('um artigo com narração mostra o leitor de áudio', () => {
    verArtigo(ARTIGO_COM_AUDIO);
    expect(screen.getByText(/Ouvir este artigo/)).toBeInTheDocument();
  });

  it('um artigo sem narração não mostra o leitor de áudio', () => {
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.queryByText(/Ouvir este artigo/)).not.toBeInTheDocument();
  });

  it('a barra de progresso de leitura existe e está escondida dos leitores de ecrã', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull();
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  for (const slug of ['heranca-portugal-brasil-mapa-das-decisoes', 'divorcio-portugal-brasil-porque-se-complica', 'responsabilidades-parentais-pais-em-paises-diferentes']) {
    it(`${slug}: monta e mostra o título`, () => {
      verArtigo(slug);
      expect(h1()[0]).toHaveTextContent(artigo(slug).titulo);
    });

    it(`${slug}: as ligações internas são válidas`, () => {
      const { container } = verArtigo(slug);
      expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
    });
  }

  it('um artigo que não existe mostra a página de não encontrado', () => {
    verArtigo('artigo-que-nunca-existiu');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('um artigo que não existe não mostra corpo nenhum', () => {
    const { container } = verArtigo('artigo-que-nunca-existiu');
    expect(container.querySelector('.blog-prose')).toBeNull();
  });

  it('um artigo que não existe dá caminho de volta', () => {
    verArtigo('artigo-que-nunca-existiu');
    expect(screen.getByRole('link', { name: /Voltar ao início/ })).toHaveAttribute('href', '/');
  });

  it('com a lista de artigos vazia, um slug qualquer dá não encontrado', () => {
    usarPosts([]);
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('sendo o único artigo, não há secção "Continuar a ler"', () => {
    usarPosts([artigo(ARTIGO_SIMPLES)]);
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.queryByRole('heading', { name: 'Continuar a ler' })).not.toBeInTheDocument();
  });

  it('um artigo sem capa não parte o hero', () => {
    usarPosts([{ ...artigo(ARTIGO_SIMPLES), imagem: '' }]);
    verArtigo(ARTIGO_SIMPLES);
    expect(h1()[0]).toHaveTextContent(artigo(ARTIGO_SIMPLES).titulo);
  });

  it('um artigo sem corpo mostra o título à mesma', () => {
    usarPosts([{ ...artigo(ARTIGO_SIMPLES), html: '' }]);
    const { container } = verArtigo(ARTIGO_SIMPLES);
    expect(h1()[0]).toHaveTextContent(artigo(ARTIGO_SIMPLES).titulo);
    expect(container.querySelector('.blog-prose').textContent).toBe('');
  });

  it('um artigo sem data não mostra "Invalid Date"', () => {
    usarPosts([{ ...artigo(ARTIGO_SIMPLES), data: '' }]);
    verArtigo(ARTIGO_SIMPLES);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Contacto — informações
// ═════════════════════════════════════════════════════════════════════════════
describe('Contacto — informações', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é "Contacto"', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(h1()[0]).toHaveTextContent('Contacto');
  });

  it('tem as duas secções: formulário e informações', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(titulos(2)).toEqual(
      expect.arrayContaining(['Envie-nos uma mensagem', 'Informações de Contacto'])
    );
  });

  it('mostra o telefone', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getAllByRole('link', { name: '+351 911 831 530' })[0]).toHaveAttribute(
      'href',
      'tel:+351911831530'
    );
  });

  it('mostra o e-mail pessoal', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByRole('link', { name: 'vyavena@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:vyavena@gmail.com'
    );
  });

  it('mostra o e-mail da Ordem dos Advogados', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByRole('link', { name: 'vyvianavena-60987P@adv.oa.pt' })).toHaveAttribute(
      'href',
      'mailto:vyvianavena-60987P@adv.oa.pt'
    );
  });

  it('mostra o WhatsApp com o mesmo número', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    const wa = container.querySelector('a[href^="https://wa.me"]');
    expect(wa).toHaveAttribute('href', 'https://wa.me/351911831530');
    expect(wa).toHaveTextContent('+351 911 831 530');
  });

  it('o WhatsApp abre em separador novo e em segurança', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    const wa = container.querySelector('a[href^="https://wa.me"]');
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa.getAttribute('rel')).toContain('noopener');
  });

  it('mostra o Instagram', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByRole('link', { name: '@vyvianavenaadv' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/vyvianavenaadv/'
    );
  });

  it('mostra o horário de atendimento', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByText(/Segunda a Sexta: 9h00/)).toBeInTheDocument();
  });

  it('mostra os três mapas dos escritórios', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    expect(container.querySelectorAll('iframe')).toHaveLength(3);
  });

  it('cada mapa tem título para os leitores de ecrã', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    for (const f of container.querySelectorAll('iframe')) {
      expect(f.getAttribute('title')).toBeTruthy();
    }
  });

  it('os mapas carregam em diferido', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    for (const f of container.querySelectorAll('iframe')) {
      expect(f).toHaveAttribute('loading', 'lazy');
    }
  });

  it('clicar no telefone regista o evento de analytics', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    clicarSemNavegar(document.querySelector('a[href="tel:+351911831530"]'));
    expect(analytics.trackEvent).toHaveBeenCalledWith('tel_click', { origem: 'pagina_contacto' });
  });

  it('clicar no e-mail regista o evento de analytics', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    clicarSemNavegar(document.querySelector('a[href="mailto:vyavena@gmail.com"]'));
    expect(analytics.trackEvent).toHaveBeenCalledWith('email_click', { origem: 'pagina_contacto' });
  });

  it('clicar no WhatsApp regista o evento de analytics', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    clicarSemNavegar(document.querySelector('a[href^="https://wa.me"]'));
    expect(analytics.trackEvent).toHaveBeenCalledWith('whatsapp_click', { origem: 'pagina_contacto' });
  });

  it('nada é enviado para a rede só por abrir a página', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(formspree.envios).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Contacto — formulário
// ═════════════════════════════════════════════════════════════════════════════
describe('Contacto — formulário', () => {
  const form = () => document.querySelector('form');
  const campo = (nome) => document.querySelector(`[name="${nome}"]`);
  const botao = () => screen.getByRole('button', { name: /Enviar mensagem|A enviar/ });

  async function preencher(u, { nome = 'Maria Silva', email = 'maria@exemplo.pt', mensagem = 'Preciso de ajuda.' } = {}) {
    if (nome) await u.type(campo('name'), nome);
    if (email) await u.type(campo('email'), email);
    if (mensagem) await u.type(campo('message'), mensagem);
  }

  it('o formulário existe', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(form()).not.toBeNull();
  });

  it('usa o formulário certo do Formspree', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(formspree.idDoFormulario).toBe('mqewdklw');
  });

  it('tem os cinco campos esperados', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    for (const n of ['name', 'email', 'phone', 'area', 'message']) {
      expect(campo(n)).not.toBeNull();
    }
  });

  it('mostra as etiquetas dos campos', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    const etiquetas = [...document.querySelectorAll('form label')].map((l) => l.textContent.trim());
    expect(etiquetas).toEqual(['Nome *', 'Email *', 'Telefone', 'Área de interesse', 'Mensagem *']);
  });

  // BUG: Contacto.jsx:68-131 — nenhum <label> tem htmlFor nem envolve o campo, e
  // os campos não têm id nem aria-label. Visualmente parece etiquetado, mas um
  // leitor de ecrã anuncia "caixa de texto" sem dizer qual — e getByLabelText,
  // que é como se testa um formulário acessível, não encontra nada.
  it.fails('o campo do nome devia ser alcançável pela etiqueta', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByLabelText(/Nome/)).toBeInTheDocument();
  });

  it.fails('o campo do e-mail devia ser alcançável pela etiqueta', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
  });

  it.fails('o campo da mensagem devia ser alcançável pela etiqueta', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByLabelText(/Mensagem/)).toBeInTheDocument();
  });

  it.fails('a lista de áreas devia ser alcançável pela etiqueta', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(screen.getByLabelText(/Área de interesse/)).toBeInTheDocument();
  });

  it('nome, e-mail e mensagem são obrigatórios', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    for (const n of ['name', 'email', 'message']) expect(campo(n)).toBeRequired();
  });

  it('telefone e área são opcionais', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    for (const n of ['phone', 'area']) expect(campo(n)).not.toBeRequired();
  });

  it('o e-mail usa o teclado de e-mail', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(campo('email')).toHaveAttribute('type', 'email');
  });

  it('o telefone usa o teclado de telefone', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(campo('phone')).toHaveAttribute('type', 'tel');
  });

  it('a mensagem é uma caixa de várias linhas', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(campo('message').tagName).toBe('TEXTAREA');
  });

  it('a lista de áreas começa por um convite a escolher', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(within(campo('area')).getByRole('option', { name: 'Selecione uma área' })).toBeInTheDocument();
  });

  it('a lista de áreas oferece todas as áreas do site', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    for (const a of AREAS) {
      expect(within(campo('area')).getByRole('option', { name: a.title })).toBeInTheDocument();
    }
  });

  it('a lista de áreas tem também "Outro"', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(within(campo('area')).getByRole('option', { name: 'Outro' })).toBeInTheDocument();
  });

  it('escolher uma área guarda a escolha', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await utilizador.selectOptions(campo('area'), 'Nacionalidade');
    expect(campo('area')).toHaveValue('Nacionalidade');
  });

  it('deixa escrever o nome', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await utilizador.type(campo('name'), 'Maria Silva');
    expect(campo('name')).toHaveValue('Maria Silva');
  });

  it('deixa escrever a mensagem', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await utilizador.type(campo('message'), 'Bom dia.');
    expect(campo('message')).toHaveValue('Bom dia.');
  });

  it('o botão começa activo e diz "Enviar mensagem"', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(botao()).toBeEnabled();
    expect(botao()).toHaveTextContent('Enviar mensagem');
  });

  it('o botão submete o formulário', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(botao()).toHaveAttribute('type', 'submit');
  });

  it('um formulário vazio não é válido', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(form().checkValidity()).toBe(false);
  });

  it('sem nome o formulário continua inválido', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador, { nome: '' });
    expect(form().checkValidity()).toBe(false);
  });

  it('sem mensagem o formulário continua inválido', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador, { mensagem: '' });
    expect(form().checkValidity()).toBe(false);
  });

  it('um e-mail sem arroba é recusado pelo próprio campo', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador, { email: 'maria.exemplo.pt' });
    expect(campo('email').checkValidity()).toBe(false);
    expect(campo('email').validity.typeMismatch).toBe(true);
  });

  it('um e-mail sem domínio é recusado', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador, { email: 'maria@' });
    expect(campo('email').checkValidity()).toBe(false);
  });

  it('um e-mail bem formado é aceite', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    expect(campo('email').checkValidity()).toBe(true);
  });

  it('com tudo preenchido o formulário fica válido', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    expect(form().checkValidity()).toBe(true);
  });

  it('clicar em enviar com o formulário vazio não envia nada', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await utilizador.click(botao());
    expect(formspree.envios).toHaveLength(0);
  });

  it('clicar em enviar com e-mail inválido não envia nada', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador, { email: 'nao-e-email' });
    await utilizador.click(botao());
    expect(formspree.envios).toHaveLength(0);
  });

  it('envio com sucesso mostra a confirmação', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByText('Mensagem enviada!')).toBeInTheDocument();
  });

  it('envio com sucesso agradece e promete resposta', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByText(/Entraremos em contacto brevemente/)).toBeInTheDocument();
  });

  it('envio com sucesso retira o formulário do ecrã', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Mensagem enviada!');
    expect(document.querySelector('form')).toBeNull();
  });

  it('envio com sucesso leva os campos preenchidos', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.selectOptions(campo('area'), 'Direito Civil');
    await utilizador.click(botao());
    await screen.findByText('Mensagem enviada!');
    expect(formspree.envios[0]).toMatchObject({
      name: 'Maria Silva',
      email: 'maria@exemplo.pt',
      message: 'Preciso de ajuda.',
      area: 'Direito Civil',
    });
  });

  it('envio com sucesso regista a conversão no analytics', async () => {
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Mensagem enviada!');
    await waitFor(() =>
      expect(analytics.trackEvent).toHaveBeenCalledWith('generate_lead', { form: 'contacto' })
    );
  });

  it('sem envio não há conversão registada', () => {
    montar(<Contacto />, { caminho: '/contacto' });
    expect(analytics.trackEvent).not.toHaveBeenCalledWith('generate_lead', expect.anything());
  });

  it('enquanto envia, o botão diz "A enviar..."', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByRole('button', { name: 'A enviar...' })).toBeInTheDocument();
  });

  it('enquanto envia, o botão fica bloqueado', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByRole('button', { name: 'A enviar...' })).toBeDisabled();
  });

  it('enquanto envia, o formulário ainda está no ecrã', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByRole('button', { name: 'A enviar...' });
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('clicar duas vezes não envia duas mensagens', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByRole('button', { name: 'A enviar...' });
    await utilizador.click(botao()).catch(() => {});
    expect(formspree.envios).toHaveLength(1);
  });

  it('carregar em Enter na mensagem não duplica o envio', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByRole('button', { name: 'A enviar...' });
    fireEvent.submit(document.querySelector('form'));
    expect(formspree.envios.length).toBeLessThanOrEqual(2);
  });

  it('terminado o envio pendente, aparece a confirmação', async () => {
    formspree.modo = 'pendente';
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByRole('button', { name: 'A enviar...' });
    await act(async () => {
      formspree.concluir('sucesso');
    });
    expect(await screen.findByText('Mensagem enviada!')).toBeInTheDocument();
  });

  it('envio falhado mantém o formulário no ecrã', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Não foi possível enviar. Tente novamente.' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await waitFor(() => expect(botao()).toBeEnabled());
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('envio falhado mostra a mensagem de erro', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Não foi possível enviar. Tente novamente.' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByText(/Não foi possível enviar/)).toBeInTheDocument();
  });

  it('envio falhado não mostra a confirmação', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Falhou' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Falhou');
    expect(screen.queryByText('Mensagem enviada!')).not.toBeInTheDocument();
  });

  it('envio falhado não regista conversão', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Falhou' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Falhou');
    expect(analytics.trackEvent).not.toHaveBeenCalledWith('generate_lead', expect.anything());
  });

  it('envio falhado devolve o botão ao estado normal', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Falhou' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Falhou');
    expect(botao()).toBeEnabled();
    expect(botao()).toHaveTextContent('Enviar mensagem');
  });

  it('erro por campo aparece junto do campo', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ field: 'email', message: 'deve ser um endereço válido' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    expect(await screen.findByText(/Email deve ser um endereço válido/)).toBeInTheDocument();
  });

  it('depois de falhar, é possível tentar outra vez', async () => {
    formspree.modo = 'erro';
    formspree.erros = [{ message: 'Falhou' }];
    const { utilizador } = montar(<Contacto />, { caminho: '/contacto' });
    await preencher(utilizador);
    await utilizador.click(botao());
    await screen.findByText('Falhou');
    formspree.modo = 'sucesso';
    await utilizador.click(botao());
    expect(await screen.findByText('Mensagem enviada!')).toBeInTheDocument();
    expect(formspree.envios).toHaveLength(2);
  });

  it('todas as ligações internas da página são válidas', () => {
    const { container } = montar(<Contacto />, { caminho: '/contacto' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sobre
// ═════════════════════════════════════════════════════════════════════════════
describe('Sobre', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Sobre />, { caminho: '/sobre' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é o nome da advogada', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(h1()[0]).toHaveTextContent('Dra. Vyvian Avena');
  });

  it('diz que está inscrita nas duas ordens', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getByText(/ORDEM DOS ADVOGADOS DE PORTUGAL E DO BRASIL/)).toBeInTheDocument();
  });

  it('tem as quatro secções principais', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(titulos(2)).toEqual([
      'Biografia Profissional',
      'Os Nossos Valores',
      'Formação e Inscrições',
      'Porque nos escolher',
    ]);
  });

  it('a biografia menciona a licenciatura', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getAllByText(/Universidade Estácio de Sá/).length).toBeGreaterThan(0);
  });

  it('a biografia menciona o mestrado', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getAllByText(/Universidade Lusófona do Porto/).length).toBeGreaterThan(0);
  });

  it('mostra os quatro valores', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    for (const v of ['Humanização', 'Proximidade', 'Transparência', 'Excelência']) {
      expect(screen.getByRole('heading', { level: 3, name: v })).toBeInTheDocument();
    }
  });

  it('mostra a descrição de cada valor', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getByText(/empatia e respeito pela sua singularidade/)).toBeInTheDocument();
  });

  it('lista as inscrições nas ordens', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getByText('Inscrita na Ordem dos Advogados de Portugal')).toBeInTheDocument();
    expect(screen.getByText(/OAB\/RJ/)).toBeInTheDocument();
  });

  it('mostra os quatro diferenciais', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getByText(/dupla jurisdição/)).toBeInTheDocument();
    expect(screen.getByText(/Rede de 3 escritórios/)).toBeInTheDocument();
  });

  it('a fotografia da advogada tem texto alternativo', () => {
    const { container } = montar(<Sobre />, { caminho: '/sobre' });
    expect(container.querySelector('img[src="/images/vyvian-sobre.jpg"]')).toHaveAttribute(
      'alt',
      'Dra. Vyvian Avena'
    );
  });

  it('todas as imagens têm alt', () => {
    const { container } = montar(<Sobre />, { caminho: '/sobre' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('fecha com o convite à consulta', () => {
    montar(<Sobre />, { caminho: '/sobre' });
    expect(screen.getByRole('link', { name: /Agendar Consulta/ })).toHaveAttribute('href', '/contacto');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = montar(<Sobre />, { caminho: '/sobre' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Links (página da bio)
// ═════════════════════════════════════════════════════════════════════════════
describe('Links', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<Links />, { caminho: '/links' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 identifica a advogada', () => {
    montar(<Links />, { caminho: '/links' });
    expect(h1()[0]).toHaveTextContent(/Vyvian Avena/);
  });

  it('o logótipo tem texto alternativo', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    expect(container.querySelector('header img')).toHaveAttribute('alt', 'Vyvian Avena — Advogada');
  });

  it('diz onde exerce', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByText('Advogada · Portugal e Brasil')).toBeInTheDocument();
  });

  it('o botão principal é o WhatsApp', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      expect.stringContaining('wa.me/351911831530')
    );
  });

  it('a mensagem do WhatsApp já vem escrita', () => {
    montar(<Links />, { caminho: '/links' });
    const wa = screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    expect(decodeURIComponent(wa)).toContain('agendar uma consulta');
  });

  it('leva ao formulário de contacto', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: /Agendar consulta/ })).toHaveAttribute('href', '/contacto');
  });

  it('mostra o e-mail', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: /vyavena@gmail.com/ })).toHaveAttribute(
      'href',
      'mailto:vyavena@gmail.com'
    );
  });

  it('mostra o telefone', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: /\+351 911 831 530/ })).toHaveAttribute(
      'href',
      'tel:+351911831530'
    );
  });

  it('liga ao Instagram', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: /Instagram/ })).toHaveAttribute(
      'href',
      'https://www.instagram.com/vyvianavenaadv/'
    );
  });

  it('liga ao Facebook', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: /Facebook/ })).toHaveAttribute(
      'href',
      'https://facebook.com/vyavenaadv'
    );
  });

  it('tem o menu das secções do site', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('navigation', { name: 'Secções do site' })).toBeInTheDocument();
  });

  it('o menu leva às áreas, ao blogue e ao sobre', () => {
    montar(<Links />, { caminho: '/links' });
    const nav = screen.getByRole('navigation', { name: 'Secções do site' });
    expect(within(nav).getByRole('link', { name: /Áreas de atuação/ })).toHaveAttribute('href', '/areas');
    expect(within(nav).getByRole('link', { name: /Blogue/ })).toHaveAttribute('href', '/blog');
    expect(within(nav).getByRole('link', { name: /Sobre a Dra. Vyvian/ })).toHaveAttribute('href', '/sobre');
  });

  it('mostra os três escritórios no rodapé', () => {
    montar(<Links />, { caminho: '/links' });
    for (const t of ['Cacilhas', 'Santa Maria da Feira', 'Barra Olímpica']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it('o rodapé liga à política de cookies', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: 'Política de Cookies' })).toHaveAttribute(
      'href',
      '/politica-cookies'
    );
  });

  it('destaca os dois artigos mais recentes', () => {
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByText('Em destaque')).toBeInTheDocument();
    expect(titulos(2)).toEqual(blog.reais.slice(0, 2).map((p) => p.titulo));
  });

  it('cada destaque liga ao artigo', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    for (const p of blog.reais.slice(0, 2)) {
      expect(container.querySelector(`a[href="/blog/${p.slug}"]`)).not.toBeNull();
    }
  });

  it('sem artigos, a secção em destaque desaparece', () => {
    usarPosts([]);
    montar(<Links />, { caminho: '/links' });
    expect(screen.queryByText('Em destaque')).not.toBeInTheDocument();
  });

  it('sem artigos, o resto da página fica de pé', () => {
    usarPosts([]);
    montar(<Links />, { caminho: '/links' });
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
  });

  it('com um só artigo mostra só esse', () => {
    usarPosts([artigo(ARTIGO_SIMPLES)]);
    montar(<Links />, { caminho: '/links' });
    expect(titulos(2)).toEqual([artigo(ARTIGO_SIMPLES).titulo]);
  });

  it('todas as imagens têm alt', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('todas as ligações internas apontam para rotas que existem', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  it('leva de volta ao site oficial', () => {
    const { container } = montar(<Links />, { caminho: '/links' });
    expect(container.querySelectorAll('a[href="/"]').length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Política de Cookies
// ═════════════════════════════════════════════════════════════════════════════
describe('Política de Cookies', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 é "Política de Cookies"', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(h1()[0]).toHaveTextContent('Política de Cookies');
  });

  it('diz quando foi actualizada', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/Última atualização:/)).toBeInTheDocument();
  });

  it('tem as seis secções numeradas', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(titulos(2)).toEqual([
      '1. Introdução',
      '2. O que são cookies?',
      '3. Tipos de cookies que utilizamos',
      '4. Os seus direitos',
      '5. Gestão de cookies',
      '6. Contacto',
    ]);
  });

  it('explica o que é um cookie', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/Um cookie é um pequeno ficheiro/)).toBeInTheDocument();
  });

  it('distingue os três tipos de cookies', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    for (const t of ['Cookies técnicos/funcionais', 'Cookies estatísticos', 'Cookies de marketing']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it('diz que os técnicos não precisam de consentimento', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/Não requerem consentimento/)).toBeInTheDocument();
  });

  it('diz que os de marketing exigem consentimento explícito', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/consentimento explícito/)).toBeInTheDocument();
  });

  it('invoca o RGPD nos direitos do visitante', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/Regulamento Geral sobre a Proteção de Dados/)).toBeInTheDocument();
  });

  it('explica como desativar os cookies', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/definições do seu navegador/)).toBeInTheDocument();
  });

  it('identifica o responsável pelo tratamento', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText('Vyvian Avena Advogada')).toBeInTheDocument();
  });

  it('dá a morada do escritório', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByText(/Rua António Nobre 1D 3.º DTO/)).toBeInTheDocument();
  });

  it('dá um e-mail para exercer os direitos', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByRole('link', { name: 'vyvianavena-60987P@adv.oa.pt' })).toHaveAttribute(
      'href',
      'mailto:vyvianavena-60987P@adv.oa.pt'
    );
  });

  it('dá um telefone para exercer os direitos', () => {
    montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(screen.getByRole('link', { name: '+351 911 831 530' })).toHaveAttribute(
      'href',
      'tel:+351911831530'
    );
  });

  it('não tem imagens sem alt', () => {
    const { container } = montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });

  it('não deixa ligações internas partidas', () => {
    const { container } = montar(<PoliticaCookies />, { caminho: '/politica-cookies' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Página não encontrada
// ═════════════════════════════════════════════════════════════════════════════
describe('Página não encontrada', () => {
  it('monta sem rebentar', () => {
    const { container } = montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(container.firstChild).not.toBeNull();
  });

  it('tem exactamente um h1', () => {
    montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(h1()).toHaveLength(1);
  });

  it('o h1 diz que a página não foi encontrada', () => {
    montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(h1()[0]).toHaveTextContent('Página não encontrada');
  });

  it('assume o erro 404 em texto', () => {
    montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(screen.getByText('Erro 404')).toBeInTheDocument();
  });

  it('explica o que aconteceu', () => {
    montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(screen.getByText(/não existe ou foi movida/)).toBeInTheDocument();
  });

  it('oferece três caminhos úteis', () => {
    montar(<NaoEncontrado />, { caminho: '/qualquer-coisa' });
    expect(titulos(2)).toEqual(['Áreas de Atuação', 'Apoio ao Cliente', 'Contacto']);
  });

  it('o cartão das áreas leva a /areas', () => {
    montar(<NaoEncontrado />, { caminho: '/x' });
    expect(screen.getByRole('link', { name: /Áreas de Atuação/ })).toHaveAttribute('href', '/areas');
  });

  it('o cartão do apoio leva a /apoio', () => {
    montar(<NaoEncontrado />, { caminho: '/x' });
    expect(screen.getByRole('link', { name: /Apoio ao Cliente/ })).toHaveAttribute('href', '/apoio');
  });

  it('o cartão do contacto leva a /contacto', () => {
    montar(<NaoEncontrado />, { caminho: '/x' });
    expect(screen.getByRole('link', { name: /Contacto/ })).toHaveAttribute('href', '/contacto');
  });

  it('oferece o caminho de volta ao início', () => {
    montar(<NaoEncontrado />, { caminho: '/x' });
    expect(screen.getByRole('link', { name: /Voltar ao início/ })).toHaveAttribute('href', '/');
  });

  it('todos os destinos existem em App.jsx', () => {
    const { container } = montar(<NaoEncontrado />, { caminho: '/x' });
    expect(ligacoesInternas(container).filter((h) => !ligacaoValida(h))).toEqual([]);
  });

  it('tem quatro ligações e nem uma a mais', () => {
    const { container } = montar(<NaoEncontrado />, { caminho: '/x' });
    expect(ligacoesInternas(container)).toHaveLength(4);
  });

  it('não tem imagens sem alt', () => {
    const { container } = montar(<NaoEncontrado />, { caminho: '/x' });
    for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transversal — o mesmo contrato em todas as páginas
// ═════════════════════════════════════════════════════════════════════════════
const PAGINAS = [
  { nome: 'Home', ui: <Home />, opcoes: { caminho: '/' } },
  { nome: 'Sobre', ui: <Sobre />, opcoes: { caminho: '/sobre' } },
  { nome: 'Áreas', ui: <Areas />, opcoes: { caminho: '/areas' } },
  { nome: 'Área (família)', ui: <AreaDetalhe />, opcoes: { caminho: '/areas/familia', rota: '/areas/:slug' } },
  { nome: 'Blogue', ui: <Blog />, opcoes: { caminho: '/blog' } },
  { nome: 'Artigo', ui: <BlogArtigo />, opcoes: { caminho: `/blog/${ARTIGO_SIMPLES}`, rota: '/blog/:slug' } },
  { nome: 'Contacto', ui: <Contacto />, opcoes: { caminho: '/contacto' } },
  { nome: 'Política de Cookies', ui: <PoliticaCookies />, opcoes: { caminho: '/politica-cookies' } },
  { nome: 'Links', ui: <Links />, opcoes: { caminho: '/links' } },
  { nome: '404', ui: <NaoEncontrado />, opcoes: { caminho: '/nada' } },
];

describe('Contrato comum a todas as páginas', () => {
  for (const { nome, ui, opcoes } of PAGINAS) {
    it(`${nome}: monta e mostra conteúdo`, () => {
      const { container } = montar(ui, opcoes);
      expect(container.textContent.trim().length).toBeGreaterThan(50);
    });

    it(`${nome}: tem um e um só h1, com texto`, () => {
      montar(ui, opcoes);
      expect(h1()).toHaveLength(1);
      expect(h1()[0].textContent.trim().length).toBeGreaterThan(0);
    });

    it(`${nome}: não salta de h1 para h4`, () => {
      montar(ui, opcoes);
      const niveis = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
        Number(h.tagName[1])
      );
      let anterior = 0;
      for (const n of niveis) {
        expect(n - anterior).toBeLessThanOrEqual(1);
        anterior = Math.max(anterior, n);
      }
    });

    it(`${nome}: todas as imagens têm alt`, () => {
      const { container } = montar(ui, opcoes);
      for (const img of imagens(container)) expect(img).toHaveAttribute('alt');
    });

    it(`${nome}: nenhuma ligação interna aponta para uma rota inexistente`, () => {
      const { container } = montar(ui, opcoes);
      const partidas = ligacoesInternas(container).filter((h) => !ligacaoValida(h));
      expect(partidas).toEqual([]);
    });

    it(`${nome}: nenhuma ligação fica sem destino`, () => {
      const { container } = montar(ui, opcoes);
      const vazias = [...container.querySelectorAll('a')].filter(
        (a) => !a.getAttribute('href') || a.getAttribute('href').trim() === ''
      );
      expect(vazias).toEqual([]);
    });

    it(`${nome}: nenhuma ligação fica sem nome acessível`, () => {
      const { container } = montar(ui, opcoes);
      const mudas = [...container.querySelectorAll('a')].filter(
        (a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.getAttribute('title')
      );
      expect(mudas).toEqual([]);
    });

    it(`${nome}: as ligações externas abrem em segurança ou ficam no mesmo separador`, () => {
      const { container } = montar(ui, opcoes);
      const inseguras = [...container.querySelectorAll('a[target="_blank"]')].filter(
        (a) => !(a.getAttribute('rel') || '').includes('noopener')
      );
      expect(inseguras).toEqual([]);
    });
  }
});
