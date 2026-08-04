// @vitest-environment jsdom
// tests/site/componentes.test.jsx
//
// O SITE PÚBLICO — o que o mundo vê antes de falar com a Dra.
//
// Duas peças mandam aqui e por isso levam a maior fatia:
//
//   1. Seo.jsx        — decide como o escritório aparece no Google e no WhatsApp.
//                       Um canonical a mais colapsa as rotas na Home; um noindex
//                       distraído apaga o site da pesquisa. Nada disto se vê no
//                       ecrã: o site continua bonito enquanto desaparece.
//                       As regras que se testam são as mesmas de scripts/seo-check.mjs
//                       (que falha o build) — aqui apanham-se antes, no componente.
//   2. CookieBanner.jsx — consentimento. Este é o sítio de uma advogada: uma recusa
//                       que na prática ativa a analítica não é um bug de interface,
//                       é um problema legal.
//
// Como se lê o Helmet sem testes intermitentes: o <Seo> é montado num
// HelmetProvider com `canUseDOM = false` e um `context` — exatamente o caminho do
// prerender (scripts/prerender.mjs). O estado sai SÍNCRONO e completo, e é depois
// reparseado com o DOMParser, para se afirmar sobre HTML a sério e não sobre
// objetos internos da biblioteca. Há à parte um punhado de testes do caminho do
// browser (com waitFor sobre o document.head), que confirmam que as tags chegam
// mesmo à página.
//
// A rede está fechada (tests/setup.js): src/lib/analytics.js vive mockado para os
// componentes, e é reimportado a sério — módulo fresco — na secção que o testa.
//
// Defeitos reais ficam marcados com `it.fails` + comentário `// BUG:`.
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelmetProvider } from 'react-helmet-async';
import {
  renderizar, render, screen, within, waitFor, fireEvent, act, configure,
} from '../helpers/dom.jsx';

// a suíte corre com dezenas de ficheiros em paralelo; sob carga o jsdom fica
// lento e 1 s por omissão não chega para os waitFor
configure({ asyncUtilTimeout: 4000 });

// ─────────────────────────── analítica mockada (rede fechada) ────────────────
// Todos os componentes do site importam daqui. A secção "analytics.js" mais
// abaixo reimporta o módulo verdadeiro com vi.importActual.
const analitica = vi.hoisted(() => ({
  applyConsent: vi.fn(),
  trackEvent: vi.fn(),
  trackPageView: vi.fn(),
  trackHit: vi.fn(),
  readConsent: vi.fn(() => null),
  initAnalytics: vi.fn(),
}));
vi.mock('../../src/lib/analytics.js', () => analitica);

import Seo, { ROUTE_META, FAQ_JSONLD } from '../../src/components/Seo.jsx';
import CookieBanner from '../../src/components/CookieBanner.jsx';
import Navbar from '../../src/components/Navbar.jsx';
import Footer from '../../src/components/Footer.jsx';
import Layout from '../../src/components/Layout.jsx';
import Breadcrumbs, { breadcrumbJsonLd } from '../../src/components/Breadcrumbs.jsx';
import WhatsAppButton from '../../src/components/WhatsAppButton.jsx';
import ScrollReveal from '../../src/components/ScrollReveal.jsx';
import ScrollToTop from '../../src/components/ScrollToTop.jsx';
import ContactMap from '../../src/components/ContactMap.jsx';
import { capaSrcSet } from '../../src/lib/imagens.js';

const SITE = 'https://vyavenaadv.com';
const ROTAS = Object.keys(ROUTE_META);
const INDEXAVEIS = ROTAS.filter((r) => r !== '/404');

beforeEach(() => {
  for (const fn of Object.values(analitica)) if (typeof fn.mockClear === 'function') fn.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
// Seo.jsx — o que o Google e o WhatsApp veem
// ═════════════════════════════════════════════════════════════════════════════
describe('Seo — metadados por rota (caminho do prerender)', () => {
  let canUseDOMOriginal;
  beforeAll(() => {
    canUseDOMOriginal = HelmetProvider.canUseDOM;
    HelmetProvider.canUseDOM = false; // estado devolvido no context, síncrono
  });
  afterAll(() => { HelmetProvider.canUseDOM = canUseDOMOriginal; });

  /** Monta o <Seo> e devolve o HTML do <head> já reparseado. */
  function cabeca(props) {
    const ctx = {};
    render(<HelmetProvider context={ctx}><Seo {...props} /></HelmetProvider>);
    const h = ctx.helmet;
    const html = ['title', 'meta', 'link', 'script'].map((k) => h[k].toString()).join('');
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head>${html}</head><body></body></html>`, 'text/html'
    );
    const head = doc.head;
    return {
      html,
      head,
      titulo: () => head.querySelector('title')?.textContent ?? null,
      meta: (nome) => head.querySelector(`meta[name="${nome}"]`)?.getAttribute('content') ?? null,
      og: (prop) => head.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ?? null,
      canonical: () => head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      quantos: (sel) => head.querySelectorAll(sel).length,
      blocos: () => [...head.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => JSON.parse(s.textContent)),
      brutos: () => [...head.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent),
    };
  }

  // ── título ─────────────────────────────────────────────────────────────────
  describe('título', () => {
    it.each(ROTAS)('%s tem o título do ROUTE_META', (rota) => {
      expect(cabeca({ path: rota }).titulo()).toBe(ROUTE_META[rota].title);
    });

    it.each(ROTAS)('%s tem exactamente um <title>', (rota) => {
      expect(cabeca({ path: rota }).quantos('title')).toBe(1);
    });

    it('nenhuma rota fica com o título vazio', () => {
      for (const r of ROTAS) expect(cabeca({ path: r }).titulo().trim().length).toBeGreaterThan(0);
    });

    it.each(ROTAS)('%s tem título até 65 caracteres (acima disso o Google trunca)', (rota) => {
      expect(cabeca({ path: rota }).titulo().length).toBeLessThanOrEqual(65);
    });

    it.each(INDEXAVEIS)('%s tem título com pelo menos 25 caracteres', (rota) => {
      expect(cabeca({ path: rota }).titulo().length).toBeGreaterThanOrEqual(25);
    });

    it('os títulos das rotas são todos diferentes entre si', () => {
      const titulos = ROTAS.map((r) => cabeca({ path: r }).titulo());
      expect(new Set(titulos).size).toBe(titulos.length);
    });

    it('o título passado por prop ganha ao do ROUTE_META', () => {
      expect(cabeca({ path: '/', title: 'Título da área' }).titulo()).toBe('Título da área');
    });

    it('título vazio recai no do ROUTE_META', () => {
      expect(cabeca({ path: '/sobre', title: '' }).titulo()).toBe(ROUTE_META['/sobre'].title);
    });

    it('rota dinâmica sem ROUTE_META usa o título dado', () => {
      expect(cabeca({ path: '/areas/familia', title: 'Direito de Família' }).titulo())
        .toBe('Direito de Família');
    });

    it('aspas e & no título não partem o HTML', () => {
      const c = cabeca({ path: '/', title: 'Herança & partilhas: "o que fazer"' });
      expect(c.titulo()).toBe('Herança & partilhas: "o que fazer"');
    });

    it('acentos sobrevivem ao percurso até ao HTML', () => {
      expect(cabeca({ path: '/areas' }).titulo()).toContain('Áreas de Atuação');
    });
  });

  // ── descrição ──────────────────────────────────────────────────────────────
  describe('meta description', () => {
    it.each(ROTAS)('%s tem a descrição do ROUTE_META', (rota) => {
      expect(cabeca({ path: rota }).meta('description')).toBe(ROUTE_META[rota].desc);
    });

    it.each(ROTAS)('%s tem exactamente uma meta description', (rota) => {
      expect(cabeca({ path: rota }).quantos('meta[name="description"]')).toBe(1);
    });

    it.each(INDEXAVEIS)('%s tem descrição entre 100 e 200 caracteres', (rota) => {
      const n = cabeca({ path: rota }).meta('description').length;
      expect(n).toBeGreaterThanOrEqual(100);
      expect(n).toBeLessThanOrEqual(200);
    });

    it('as descrições das rotas são todas diferentes entre si', () => {
      const descs = ROTAS.map((r) => cabeca({ path: r }).meta('description'));
      expect(new Set(descs).size).toBe(descs.length);
    });

    it('a descrição passada por prop ganha à do ROUTE_META', () => {
      expect(cabeca({ path: '/', desc: 'Descrição da área.' }).meta('description'))
        .toBe('Descrição da área.');
    });

    it('descrição vazia recai na do ROUTE_META', () => {
      expect(cabeca({ path: '/blog', desc: '' }).meta('description')).toBe(ROUTE_META['/blog'].desc);
    });

    it('aspas na descrição não partem o atributo content', () => {
      const c = cabeca({ path: '/', desc: 'Ela disse "sim" & assinou' });
      expect(c.meta('description')).toBe('Ela disse "sim" & assinou');
    });

    it('nenhuma descrição termina a meio de uma palavra com reticências automáticas', () => {
      for (const r of ROTAS) expect(cabeca({ path: r }).meta('description')).not.toMatch(/\s\.\.\.$/);
    });
  });

  // ── canonical ──────────────────────────────────────────────────────────────
  describe('canonical', () => {
    it('a home canonicaliza para a raiz com barra final', () => {
      expect(cabeca({ path: '/' }).canonical()).toBe(`${SITE}/`);
    });

    it.each(INDEXAVEIS.filter((r) => r !== '/'))('%s canonicaliza para o próprio URL', (rota) => {
      expect(cabeca({ path: rota }).canonical()).toBe(`${SITE}${rota}`);
    });

    it.each(INDEXAVEIS.filter((r) => r !== '/'))('%s não leva barra final (evita o 307 do Cloudflare)', (rota) => {
      expect(cabeca({ path: rota }).canonical().endsWith('/')).toBe(false);
    });

    it.each(INDEXAVEIS)('%s tem exactamente um canonical (dois colapsam as rotas na Home)', (rota) => {
      expect(cabeca({ path: rota }).quantos('link[rel="canonical"]')).toBe(1);
    });

    it('o canonical é sempre absoluto e no domínio do site', () => {
      for (const r of INDEXAVEIS) expect(cabeca({ path: r }).canonical()).toMatch(new RegExp(`^${SITE}/`));
    });

    it('rota dinâmica de área canonicaliza para o próprio caminho', () => {
      expect(cabeca({ path: '/areas/familia', title: 'x', desc: 'y' }).canonical())
        .toBe(`${SITE}/areas/familia`);
    });

    it('rota dinâmica de artigo canonicaliza para o próprio caminho', () => {
      expect(cabeca({ path: '/blog/heranca-em-portugal', title: 'x', desc: 'y' }).canonical())
        .toBe(`${SITE}/blog/heranca-em-portugal`);
    });

    it('a /404 não tem canonical — não é uma página real', () => {
      expect(cabeca({ path: '/404' }).canonical()).toBeNull();
    });

    it('conteúdo em revisão (noindex) não tem canonical', () => {
      expect(cabeca({ path: '/blog', noindex: true }).canonical()).toBeNull();
    });
  });

  // ── robots ─────────────────────────────────────────────────────────────────
  describe('robots', () => {
    it.each(INDEXAVEIS)('%s é indexável', (rota) => {
      expect(cabeca({ path: rota }).meta('robots')).toBe('index, follow');
    });

    it.each(ROTAS)('%s tem exactamente uma meta robots', (rota) => {
      expect(cabeca({ path: rota }).quantos('meta[name="robots"]')).toBe(1);
    });

    it('a /404 é sempre noindex, mesmo sem o pedirem', () => {
      expect(cabeca({ path: '/404' }).meta('robots')).toBe('noindex, follow');
    });

    it('noindex explícito respeita-se', () => {
      expect(cabeca({ path: '/blog', noindex: true }).meta('robots')).toBe('noindex, follow');
    });

    it('noindex mantém o follow (os links continuam a ser seguidos)', () => {
      expect(cabeca({ path: '/blog', noindex: true }).meta('robots')).toContain('follow');
    });

    it('noindex=false não esconde a página', () => {
      expect(cabeca({ path: '/blog', noindex: false }).meta('robots')).toBe('index, follow');
    });

    it('nenhuma rota indexável traz a palavra noindex', () => {
      for (const r of INDEXAVEIS) expect(cabeca({ path: r }).meta('robots')).not.toMatch(/noindex/i);
    });
  });

  // ── Open Graph ─────────────────────────────────────────────────────────────
  describe('Open Graph', () => {
    const OBRIGATORIAS = ['og:title', 'og:description', 'og:url', 'og:image'];

    it.each(OBRIGATORIAS)('a home tem %s', (prop) => {
      expect(cabeca({ path: '/' }).og(prop)).toBeTruthy();
    });

    it.each(OBRIGATORIAS)('a home tem exactamente uma tag %s', (prop) => {
      expect(cabeca({ path: '/' }).quantos(`meta[property="${prop}"]`)).toBe(1);
    });

    it.each(ROTAS)('%s traz as quatro tags Open Graph obrigatórias', (rota) => {
      const c = cabeca({ path: rota });
      for (const p of OBRIGATORIAS) expect(c.og(p), p).toBeTruthy();
    });

    it('og:type é website', () => {
      expect(cabeca({ path: '/' }).og('og:type')).toBe('website');
    });

    it('og:site_name identifica o escritório', () => {
      expect(cabeca({ path: '/' }).og('og:site_name')).toBe('Vyvian Avena Advogada');
    });

    it('og:locale declara português de Portugal', () => {
      expect(cabeca({ path: '/' }).og('og:locale')).toBe('pt_PT');
    });

    it('og:title acompanha o título da página', () => {
      const c = cabeca({ path: '/contacto' });
      expect(c.og('og:title')).toBe(c.titulo());
    });

    it('og:description acompanha a descrição da página', () => {
      const c = cabeca({ path: '/contacto' });
      expect(c.og('og:description')).toBe(c.meta('description'));
    });

    it('og:url acompanha o canonical', () => {
      const c = cabeca({ path: '/sobre' });
      expect(c.og('og:url')).toBe(c.canonical());
    });

    it('og:url existe mesmo quando não há canonical (noindex)', () => {
      const c = cabeca({ path: '/blog', noindex: true });
      expect(c.canonical()).toBeNull();
      expect(c.og('og:url')).toBe(`${SITE}/blog`);
    });

    it('og:image por omissão é o cartão do escritório, absoluto', () => {
      expect(cabeca({ path: '/' }).og('og:image')).toBe(`${SITE}/og-image.jpg`);
    });

    it('imagem relativa torna-se absoluta (o WhatsApp exige URL absoluto)', () => {
      expect(cabeca({ path: '/blog/x', image: '/blog/x.jpg' }).og('og:image'))
        .toBe(`${SITE}/blog/x.jpg`);
    });

    it('imagem já absoluta (https) fica como está', () => {
      expect(cabeca({ path: '/blog/x', image: 'https://cdn.exemplo.pt/a.jpg' }).og('og:image'))
        .toBe('https://cdn.exemplo.pt/a.jpg');
    });

    it('imagem absoluta em http também fica como está', () => {
      expect(cabeca({ path: '/blog/x', image: 'http://exemplo.pt/a.jpg' }).og('og:image'))
        .toBe('http://exemplo.pt/a.jpg');
    });

    it('imagem vazia recai na imagem por omissão', () => {
      expect(cabeca({ path: '/', image: '' }).og('og:image')).toBe(`${SITE}/og-image.jpg`);
    });

    it('as dimensões da og:image são as do cartão 1200x630', () => {
      const c = cabeca({ path: '/' });
      expect(c.og('og:image:width')).toBe('1200');
      expect(c.og('og:image:height')).toBe('630');
    });

    it('a og:image tem texto alternativo', () => {
      expect(cabeca({ path: '/' }).og('og:image:alt')).toBeTruthy();
    });

    it('a og:image é sempre um URL absoluto, em qualquer rota', () => {
      for (const r of ROTAS) expect(cabeca({ path: r }).og('og:image')).toMatch(/^https?:\/\//);
    });
  });

  // ── Twitter ────────────────────────────────────────────────────────────────
  describe('Twitter Card', () => {
    it('usa o cartão grande', () => {
      expect(cabeca({ path: '/' }).meta('twitter:card')).toBe('summary_large_image');
    });

    it.each(['twitter:title', 'twitter:description', 'twitter:image'])('a home tem %s', (nome) => {
      expect(cabeca({ path: '/' }).meta(nome)).toBeTruthy();
    });

    it.each(ROTAS)('%s traz as quatro tags de Twitter', (rota) => {
      const c = cabeca({ path: rota });
      for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
        expect(c.meta(n), n).toBeTruthy();
      }
    });

    it('twitter:title acompanha o título', () => {
      const c = cabeca({ path: '/apoio' });
      expect(c.meta('twitter:title')).toBe(c.titulo());
    });

    it('twitter:description acompanha a descrição', () => {
      const c = cabeca({ path: '/apoio' });
      expect(c.meta('twitter:description')).toBe(c.meta('description'));
    });

    it('twitter:image acompanha a og:image', () => {
      const c = cabeca({ path: '/blog/x', image: '/blog/x.jpg' });
      expect(c.meta('twitter:image')).toBe(c.og('og:image'));
    });

    it('não há tags de Twitter duplicadas', () => {
      const c = cabeca({ path: '/' });
      for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
        expect(c.quantos(`meta[name="${n}"]`), n).toBe(1);
      }
    });
  });

  // ── dados estruturados ─────────────────────────────────────────────────────
  describe('JSON-LD', () => {
    const FAQS = [
      { q: 'Como decorre a primeira consulta?', a: 'Ouvimos o seu caso e explicamos os passos.' },
      { q: 'Que documentos devo levar?', a: 'Identificação e tudo o que diga respeito ao caso.' },
    ];
    const SERVICE = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Direito de Família',
      description: 'Divórcio, responsabilidades parentais e partilhas.',
      url: `${SITE}/areas/familia`,
      provider: { '@type': 'LegalService', name: 'Vyvian Avena Advogada', url: `${SITE}/` },
    };

    it('sem jsonLd não há blocos ld+json (o global vive no index.html)', () => {
      expect(cabeca({ path: '/' }).blocos()).toHaveLength(0);
    });

    it('um objecto dá um bloco', () => {
      expect(cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()).toHaveLength(1);
    });

    it('um array dá um bloco por elemento', () => {
      const jsonLd = [SERVICE, breadcrumbJsonLd([{ name: 'Início', path: '/' }])];
      expect(cabeca({ path: '/areas/familia', jsonLd }).blocos()).toHaveLength(2);
    });

    it('o bloco é JSON válido', () => {
      const [bruto] = cabeca({ path: '/areas/familia', jsonLd: SERVICE }).brutos();
      expect(() => JSON.parse(bruto)).not.toThrow();
    });

    it('o bloco declara o @context da schema.org', () => {
      expect(cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0]['@context'])
        .toBe('https://schema.org');
    });

    it('o bloco declara o @type', () => {
      expect(cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0]['@type']).toBe('Service');
    });

    it('o objecto chega ao HTML sem perder campos', () => {
      expect(cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0]).toEqual(SERVICE);
    });

    it('Service leva nome, descrição e URL — os campos que a Google mostra', () => {
      const b = cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0];
      expect(b.name).toBeTruthy();
      expect(b.description).toBeTruthy();
      expect(b.url).toMatch(/^https:\/\//);
    });

    it('o prestador do Service é um LegalService identificado', () => {
      const b = cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0];
      expect(b.provider['@type']).toBe('LegalService');
      expect(b.provider.name).toBe('Vyvian Avena Advogada');
    });

    it('cada bloco de um array mantém o seu @type', () => {
      const jsonLd = [SERVICE, breadcrumbJsonLd([{ name: 'Início', path: '/' }])];
      expect(cabeca({ path: '/x', title: 't', desc: 'd', jsonLd }).blocos().map((b) => b['@type']))
        .toEqual(['Service', 'BreadcrumbList']);
    });

    it('acentos dentro do JSON-LD sobrevivem', () => {
      const b = cabeca({ path: '/areas/familia', jsonLd: SERVICE }).blocos()[0];
      expect(b.name).toBe('Direito de Família');
    });

    it('todos os blocos declaram type="application/ld+json"', () => {
      const c = cabeca({ path: '/x', title: 't', desc: 'd', jsonLd: [SERVICE, SERVICE] });
      expect(c.quantos('script[type="application/ld+json"]')).toBe(2);
    });

    it('jsonLd nulo não produz bloco nenhum', () => {
      expect(cabeca({ path: '/', jsonLd: null }).blocos()).toHaveLength(0);
    });

    it('array vazio não produz bloco nenhum', () => {
      expect(cabeca({ path: '/', jsonLd: [] }).blocos()).toHaveLength(0);
    });

    // ── FAQPage (usado em /apoio) ────────────────────────────────────────────
    it('FAQ_JSONLD declara FAQPage e o @context', () => {
      const d = FAQ_JSONLD(FAQS);
      expect(d['@type']).toBe('FAQPage');
      expect(d['@context']).toBe('https://schema.org');
    });

    it('FAQ_JSONLD cria uma Question por pergunta', () => {
      const d = FAQ_JSONLD(FAQS);
      expect(d.mainEntity).toHaveLength(2);
      expect(d.mainEntity.every((q) => q['@type'] === 'Question')).toBe(true);
    });

    it('cada Question leva o nome e uma Answer com texto', () => {
      const [q] = FAQ_JSONLD(FAQS).mainEntity;
      expect(q.name).toBe(FAQS[0].q);
      expect(q.acceptedAnswer['@type']).toBe('Answer');
      expect(q.acceptedAnswer.text).toBe(FAQS[0].a);
    });

    it('FAQ_JSONLD mantém a ordem das perguntas', () => {
      expect(FAQ_JSONLD(FAQS).mainEntity.map((q) => q.name)).toEqual(FAQS.map((f) => f.q));
    });

    it('FAQ_JSONLD sem perguntas não rebenta', () => {
      expect(FAQ_JSONLD([]).mainEntity).toEqual([]);
    });

    it('o FAQPage atravessa o Seo intacto', () => {
      const b = cabeca({ path: '/apoio', jsonLd: FAQ_JSONLD(FAQS) }).blocos()[0];
      expect(b).toEqual(FAQ_JSONLD(FAQS));
    });

    it('o FAQPage no HTML continua a ter as perguntas legíveis', () => {
      const [bruto] = cabeca({ path: '/apoio', jsonLd: FAQ_JSONLD(FAQS) }).brutos();
      expect(bruto).toContain('Como decorre a primeira consulta?');
    });

    // CORRIGIDO (era): src/components/Seo.jsx:114 — o JSON-LD é injetado com
    // {JSON.stringify(block)} dentro de um <script>, sem escapar "</script>".
    // Um título de artigo (ou uma resposta da FAQ) que contenha essa sequência
    // fecha o script a meio: o bloco deixa de fazer parse — é exatamente a falha
    // "JSON-LD invalido" que o scripts/seo-check.mjs procura — e o resto do JSON
    // passa a ser texto visível na página. Devia sair escapado (ex.: "<\/script>").
    it('JSON-LD com </script> no texto continua a ser JSON válido', () => {
      const jsonLd = { '@context': 'https://schema.org', '@type': 'Article', name: 'a</script>b' };
      const [bruto] = cabeca({ path: '/blog/x', title: 't', desc: 'd', jsonLd }).brutos();
      expect(() => JSON.parse(bruto)).not.toThrow();
    });
  });

  // ── valores em falta ───────────────────────────────────────────────────────
  describe('valores em falta', () => {
    it('rota desconhecida recai nos metadados da Home', () => {
      const c = cabeca({ path: '/rota-que-nao-existe' });
      expect(c.titulo()).toBe(ROUTE_META['/'].title);
      expect(c.meta('description')).toBe(ROUTE_META['/'].desc);
    });

    it.each(ROTAS)('%s não escreve "undefined" em lado nenhum do head', (rota) => {
      expect(cabeca({ path: rota }).html).not.toContain('undefined');
    });

    it('nenhuma rota escreve "null" no head', () => {
      for (const r of ROTAS) expect(cabeca({ path: r }).html, r).not.toContain('null');
    });

    it('título e descrição a undefined recaem no ROUTE_META, sem "undefined"', () => {
      const c = cabeca({ path: '/sobre', title: undefined, desc: undefined });
      expect(c.titulo()).toBe(ROUTE_META['/sobre'].title);
      expect(c.html).not.toContain('undefined');
    });

    it('imagem a undefined não escreve "undefined" na og:image', () => {
      expect(cabeca({ path: '/', image: undefined }).og('og:image')).not.toContain('undefined');
    });

    it('rota dinâmica sem título nem descrição ainda produz meta utilizáveis', () => {
      const c = cabeca({ path: '/areas/familia' });
      expect(c.titulo()).toBeTruthy();
      expect(c.meta('description')).toBeTruthy();
    });

    // CORRIGIDO (era): src/components/Seo.jsx:79 — sem `path`, o canonical é montado com
    // `${SITE}${path}` e sai "https://vyavenaadv.comundefined" (o mesmo na og:url).
    // Hoje nenhuma página o omite, mas uma rota nova que se esqueça do prop
    // publica um canonical inválido sem partir nada visível. Devia recair em "/"
    // (ou não emitir canonical nenhum).
    it('sem path não se publica um canonical com "undefined"', () => {
      const c = cabeca({});
      expect(c.canonical() ?? '').not.toContain('undefined');
    });
  });
});

// ─── Seo no browser: as tags chegam mesmo ao document.head ───────────────────
describe('Seo — no browser', () => {
  let canUseDOMOriginal;
  beforeAll(() => {
    canUseDOMOriginal = HelmetProvider.canUseDOM;
    HelmetProvider.canUseDOM = true;
  });
  afterAll(() => { HelmetProvider.canUseDOM = canUseDOMOriginal; });
  afterEach(() => {
    document.head.querySelectorAll('[data-rh]').forEach((n) => n.remove());
    document.title = '';
  });

  it('o título da rota chega ao separador do browser', async () => {
    render(<HelmetProvider><Seo path="/contacto" /></HelmetProvider>);
    await waitFor(() => expect(document.title).toBe(ROUTE_META['/contacto'].title));
  });

  it('a meta description chega ao head', async () => {
    render(<HelmetProvider><Seo path="/contacto" /></HelmetProvider>);
    await waitFor(() => {
      const m = document.head.querySelector('meta[name="description"][data-rh]');
      expect(m?.getAttribute('content')).toBe(ROUTE_META['/contacto'].desc);
    });
  });

  it('o canonical chega ao head, e só um', async () => {
    render(<HelmetProvider><Seo path="/contacto" /></HelmetProvider>);
    await waitFor(() => {
      const l = document.head.querySelectorAll('link[rel="canonical"][data-rh]');
      expect(l).toHaveLength(1);
      expect(l[0].getAttribute('href')).toBe(`${SITE}/contacto`);
    });
  });

  it('o JSON-LD chega ao head e faz parse', async () => {
    const bloco = { '@context': 'https://schema.org', '@type': 'Person', name: 'Vyvian Avena' };
    render(<HelmetProvider><Seo path="/sobre" jsonLd={bloco} /></HelmetProvider>);
    await waitFor(() => {
      const s = document.head.querySelector('script[type="application/ld+json"][data-rh]');
      expect(JSON.parse(s.textContent)).toEqual(bloco);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CookieBanner.jsx — consentimento (RGPD)
// ═════════════════════════════════════════════════════════════════════════════
describe('CookieBanner — consentimento', () => {
  const CHAVE = 'cookie_consent';
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

  const banner = () => screen.queryByText('Preferências de Privacidade');
  const botao = (nome) => screen.getByRole('button', { name: nome });

  // ── primeira visita ────────────────────────────────────────────────────────
  it('aparece na primeira visita', () => {
    renderizar(<CookieBanner />);
    expect(banner()).toBeInTheDocument();
  });

  it('explica para que servem os cookies', () => {
    renderizar(<CookieBanner />);
    expect(screen.getByText(/Utilizamos cookies/i)).toBeInTheDocument();
  });

  it('oferece as três saídas: essenciais, personalizar e aceitar', () => {
    renderizar(<CookieBanner />);
    expect(botao('Apenas Essenciais')).toBeInTheDocument();
    expect(botao('Personalizar')).toBeInTheDocument();
    expect(botao('Aceitar Todos')).toBeInTheDocument();
  });

  // ── aceitar ────────────────────────────────────────────────────────────────
  it('aceitar tudo guarda a decisão', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Aceitar Todos'));
    expect(localStorage.getItem(CHAVE)).toBe('accepted');
  });

  it('aceitar tudo ativa estatísticas e marketing', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Aceitar Todos'));
    expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: true, marketing: true });
  });

  it('aceitar fecha o banner', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Aceitar Todos'));
    expect(banner()).not.toBeInTheDocument();
  });

  // ── recusar ────────────────────────────────────────────────────────────────
  it('recusar guarda a decisão como "essential"', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Apenas Essenciais'));
    expect(localStorage.getItem(CHAVE)).toBe('essential');
  });

  it('recusar NÃO ativa a analítica', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Apenas Essenciais'));
    expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: false, marketing: false });
  });

  it('recusar nunca chama a analítica com statistics verdadeiro', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Apenas Essenciais'));
    for (const [c] of analitica.applyConsent.mock.calls) expect(c.statistics).toBe(false);
  });

  it('recusar fecha o banner', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Apenas Essenciais'));
    expect(banner()).not.toBeInTheDocument();
  });

  it('a decisão é tomada uma vez só — a analítica é chamada uma vez', async () => {
    const { utilizador } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Aceitar Todos'));
    expect(analitica.applyConsent).toHaveBeenCalledTimes(1);
  });

  // ── a escolha fica guardada ────────────────────────────────────────────────
  it('não volta a aparecer depois de aceitar', () => {
    localStorage.setItem(CHAVE, 'accepted');
    renderizar(<CookieBanner />);
    expect(banner()).not.toBeInTheDocument();
  });

  it('não volta a aparecer depois de recusar', () => {
    localStorage.setItem(CHAVE, 'essential');
    renderizar(<CookieBanner />);
    expect(banner()).not.toBeInTheDocument();
  });

  it('não volta a aparecer com preferências personalizadas guardadas', () => {
    localStorage.setItem(CHAVE, 'custom:{"statistics":true,"marketing":false}');
    renderizar(<CookieBanner />);
    expect(banner()).not.toBeInTheDocument();
  });

  it('numa visita já decidida não se volta a mexer na analítica', () => {
    localStorage.setItem(CHAVE, 'accepted');
    renderizar(<CookieBanner />);
    expect(analitica.applyConsent).not.toHaveBeenCalled();
  });

  it('a decisão sobrevive a uma nova montagem do componente', async () => {
    const { utilizador, unmount } = renderizar(<CookieBanner />);
    await utilizador.click(botao('Apenas Essenciais'));
    unmount();
    renderizar(<CookieBanner />);
    expect(banner()).not.toBeInTheDocument();
  });

  // ── política de cookies ────────────────────────────────────────────────────
  it('liga à Política de Cookies', () => {
    renderizar(<CookieBanner />);
    expect(screen.getByRole('link', { name: 'Política de Cookies' }))
      .toHaveAttribute('href', '/politica-cookies');
  });

  it('a política abre noutro separador sem perder o consentimento a meio', () => {
    renderizar(<CookieBanner />);
    expect(screen.getByRole('link', { name: 'Política de Cookies' }))
      .toHaveAttribute('target', '_blank');
  });

  it('a ligação à política é segura (noopener)', () => {
    renderizar(<CookieBanner />);
    expect(screen.getByRole('link', { name: 'Política de Cookies' })
      .getAttribute('rel')).toContain('noopener');
  });

  // ── personalizar ───────────────────────────────────────────────────────────
  describe('personalizar preferências', () => {
    const abrir = async () => {
      const r = renderizar(<CookieBanner />);
      await r.utilizador.click(botao('Personalizar'));
      return r;
    };

    it('mostra as três famílias de cookies', async () => {
      await abrir();
      expect(screen.getByText('Cookies Funcionais')).toBeInTheDocument();
      expect(screen.getByText('Cookies Estatísticos')).toBeInTheDocument();
      expect(screen.getByText('Cookies de Marketing')).toBeInTheDocument();
    });

    it('diz que os funcionais são sempre necessários', async () => {
      await abrir();
      expect(screen.getByText(/Sempre ativos/i)).toBeInTheDocument();
    });

    it('explica para que serve cada família', async () => {
      await abrir();
      expect(screen.getByText(/como os visitantes interagem/i)).toBeInTheDocument();
      expect(screen.getByText(/publicidade relevante/i)).toBeInTheDocument();
    });

    it('guardar sem mexer em nada aceita só as estatísticas', async () => {
      const { utilizador } = await abrir();
      await utilizador.click(botao('Guardar Preferências'));
      expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: true, marketing: false });
    });

    it('guardar escreve as preferências no localStorage, não só "custom"', async () => {
      const { utilizador } = await abrir();
      await utilizador.click(botao('Guardar Preferências'));
      expect(localStorage.getItem(CHAVE)).toBe('custom:{"statistics":true,"marketing":false}');
    });

    it('desligar as estatísticas antes de guardar respeita-se', async () => {
      const { utilizador } = await abrir();
      await utilizador.click(screen.getByText('Cookies Estatísticos').parentElement.nextElementSibling);
      await utilizador.click(botao('Guardar Preferências'));
      expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: false, marketing: false });
    });

    it('ligar o marketing antes de guardar respeita-se', async () => {
      const { utilizador } = await abrir();
      await utilizador.click(screen.getByText('Cookies de Marketing').parentElement.nextElementSibling);
      await utilizador.click(botao('Guardar Preferências'));
      expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: true, marketing: true });
    });

    it('o interruptor dos funcionais não se desliga', async () => {
      const { utilizador } = await abrir();
      const interruptor = screen.getByText('Cookies Funcionais').parentElement.nextElementSibling;
      await utilizador.click(interruptor);
      await utilizador.click(botao('Guardar Preferências'));
      expect(localStorage.getItem(CHAVE)).toBe('custom:{"statistics":true,"marketing":false}');
    });

    it('guardar fecha o banner', async () => {
      const { utilizador } = await abrir();
      await utilizador.click(botao('Guardar Preferências'));
      expect(banner()).not.toBeInTheDocument();
    });

    it('fechar o painel volta à escolha inicial sem guardar nada', async () => {
      const { utilizador, container } = await abrir();
      await utilizador.click(container.querySelectorAll('button')[0]);
      expect(botao('Aceitar Todos')).toBeInTheDocument();
      expect(localStorage.getItem(CHAVE)).toBeNull();
    });

    it('fechar o painel não toca na analítica', async () => {
      const { utilizador, container } = await abrir();
      await utilizador.click(container.querySelectorAll('button')[0]);
      expect(analitica.applyConsent).not.toHaveBeenCalled();
    });

    // CORRIGIDO (era): src/components/CookieBanner.jsx:99 — os interruptores de cada família
    // são <div> com onClick: sem role, sem tabIndex e sem tratamento de teclas.
    // Quem navega só com teclado (ou com leitor de ecrã) não consegue escolher as
    // preferências — só "aceitar tudo" ou "só essenciais". Deviam ser <button
    // role="switch" aria-checked> ou uma checkbox com rótulo.
    it('os interruptores são operáveis por teclado', async () => {
      const { utilizador } = await abrir();
      const interruptor = screen.getByRole('switch', { name: /estatísticos/i });
      await utilizador.type(interruptor, '{Space}');
      await utilizador.click(botao('Guardar Preferências'));
      expect(analitica.applyConsent).toHaveBeenCalledWith({ statistics: false, marketing: false });
    });
  });

  // ── teclado / navegação ────────────────────────────────────────────────────
  describe('teclado', () => {
    it('todos os botões do banner são alcançáveis por Tab', async () => {
      const { utilizador } = renderizar(<CookieBanner />);
      const alcancados = new Set();
      for (let i = 0; i < 6; i++) {
        await utilizador.tab();
        if (document.activeElement?.tagName === 'BUTTON') alcancados.add(document.activeElement.textContent);
      }
      expect(alcancados).toContain('Aceitar Todos');
      expect(alcancados).toContain('Apenas Essenciais');
    });

    it('a ligação para a política também é alcançável por Tab', async () => {
      const { utilizador } = renderizar(<CookieBanner />);
      let achou = false;
      for (let i = 0; i < 6 && !achou; i++) {
        await utilizador.tab();
        achou = document.activeElement?.getAttribute('href') === '/politica-cookies';
      }
      expect(achou).toBe(true);
    });

    it('não prende o foco: o conteúdo do site continua a ser alcançável', async () => {
      const { utilizador } = renderizar(
        <><a href="/contacto">Marcar consulta</a><CookieBanner /></>
      );
      await utilizador.tab();
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Marcar consulta' }));
    });

    it('o banner encosta ao fundo e não cobre a página toda', () => {
      const { container } = renderizar(<CookieBanner />);
      const caixa = container.firstChild;
      expect(caixa.style.position).toBe('fixed');
      expect(caixa.style.bottom).toBe('0px');
      expect(caixa.style.top).toBe('');
    });

    it('depois de decidir, o rodapé da página deixa de estar tapado', async () => {
      const { utilizador, container } = renderizar(<CookieBanner />);
      await utilizador.click(botao('Aceitar Todos'));
      expect(container.firstChild).toBeNull();
    });
  });

  // CORRIGIDO (era): src/components/CookieBanner.jsx:13 — o localStorage é lido sem try/catch.
  // Em Safari com "bloquear todos os cookies" (ou numa iframe de terceiros) o
  // getItem atira SecurityError e o site inteiro deixa de renderizar — o banner
  // vive dentro do Layout, por cima de todas as páginas. O src/lib/analytics.js
  // faz esta leitura protegida (readConsent); aqui falta o mesmo cuidado.
  it('não rebenta o site se o localStorage estiver bloqueado', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('SecurityError'); },
      setItem() {},
      clear() {},
    });
    expect(() => renderizar(<CookieBanner />)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// analytics.js — nada sai do browser sem consentimento
// ═════════════════════════════════════════════════════════════════════════════
describe('analytics.js', () => {
  /** Módulo fresco em cada teste: gtagLoaded é estado de módulo. */
  async function carregar() {
    vi.resetModules();
    return vi.importActual('../../src/lib/analytics.js');
  }
  const scripts = () => [...document.head.querySelectorAll('script[src*="googletagmanager"]')];
  const camada = () => (window.dataLayer || []).map((a) => Array.from(a));

  beforeEach(() => {
    localStorage.clear();
    delete window.dataLayer;
    scripts().forEach((s) => s.remove());
  });
  afterEach(() => {
    vi.unstubAllGlobals(); // antes do clear: há testes que substituem o localStorage
    localStorage.clear();
    scripts().forEach((s) => s.remove());
    delete navigator.sendBeacon;
  });

  // ── ler o consentimento guardado ───────────────────────────────────────────
  describe('readConsent', () => {
    it('sem decisão devolve null', async () => {
      const { readConsent } = await carregar();
      expect(readConsent()).toBeNull();
    });

    it('"accepted" dá estatísticas e marketing', async () => {
      localStorage.setItem('cookie_consent', 'accepted');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: true, marketing: true });
    });

    it('"essential" não dá nada', async () => {
      localStorage.setItem('cookie_consent', 'essential');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: false, marketing: false });
    });

    it('preferências personalizadas são respeitadas', async () => {
      localStorage.setItem('cookie_consent', 'custom:{"statistics":true,"marketing":false}');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: true, marketing: false });
    });

    it('preferências personalizadas corrompidas caem no mais restritivo', async () => {
      localStorage.setItem('cookie_consent', 'custom:{isto nao e json}');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: false, marketing: false });
    });

    it('"custom" legado (sem preferências) cai no mais restritivo', async () => {
      localStorage.setItem('cookie_consent', 'custom');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: false, marketing: false });
    });

    it('valor desconhecido cai no mais restritivo', async () => {
      localStorage.setItem('cookie_consent', 'sim-pode-tudo');
      const { readConsent } = await carregar();
      expect(readConsent()).toEqual({ statistics: false, marketing: false });
    });

    it('localStorage bloqueado devolve null em vez de rebentar', async () => {
      const { readConsent } = await carregar();
      vi.stubGlobal('localStorage', { getItem() { throw new Error('SecurityError'); } });
      expect(readConsent()).toBeNull();
    });
  });

  // ── arranque ───────────────────────────────────────────────────────────────
  describe('initAnalytics', () => {
    it('sem decisão não carrega o Google Analytics', async () => {
      const { initAnalytics } = await carregar();
      initAnalytics();
      expect(scripts()).toHaveLength(0);
    });

    it('sem decisão o consentimento por omissão é "denied" em tudo', async () => {
      const { initAnalytics } = await carregar();
      initAnalytics();
      const [tipo, momento, valores] = camada()[0];
      expect(tipo).toBe('consent');
      expect(momento).toBe('default');
      expect(Object.values(valores).every((v) => v === 'denied')).toBe(true);
    });

    it('o consentimento por omissão cobre analytics e publicidade', async () => {
      const { initAnalytics } = await carregar();
      initAnalytics();
      const [, , valores] = camada()[0];
      expect(Object.keys(valores).sort()).toEqual(
        ['ad_personalization', 'ad_storage', 'ad_user_data', 'analytics_storage']
      );
    });

    it('com "essential" guardado continua a não carregar o Google', async () => {
      localStorage.setItem('cookie_consent', 'essential');
      const { initAnalytics } = await carregar();
      initAnalytics();
      expect(scripts()).toHaveLength(0);
    });

    it('com "accepted" guardado carrega o Google', async () => {
      localStorage.setItem('cookie_consent', 'accepted');
      const { initAnalytics } = await carregar();
      initAnalytics();
      expect(scripts()).toHaveLength(1);
    });

    it('com estatísticas recusadas nas preferências não carrega o Google', async () => {
      localStorage.setItem('cookie_consent', 'custom:{"statistics":false,"marketing":true}');
      const { initAnalytics } = await carregar();
      initAnalytics();
      expect(scripts()).toHaveLength(0);
    });

    it('o "default denied" é sempre o primeiro sinal enviado', async () => {
      localStorage.setItem('cookie_consent', 'accepted');
      const { initAnalytics } = await carregar();
      initAnalytics();
      expect(camada()[0][1]).toBe('default');
    });
  });

  // ── aplicar consentimento ──────────────────────────────────────────────────
  describe('applyConsent', () => {
    it('recusa não carrega o script do Google', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: false, marketing: false });
      expect(scripts()).toHaveLength(0);
    });

    it('recusa envia um update com tudo negado', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: false, marketing: false });
      const [tipo, momento, v] = camada().at(-1);
      expect([tipo, momento]).toEqual(['consent', 'update']);
      expect(Object.values(v).every((x) => x === 'denied')).toBe(true);
    });

    it('aceitar estatísticas carrega o script do Google', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      expect(scripts()).toHaveLength(1);
    });

    it('o script do Google leva a medição correcta', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      expect(scripts()[0].src).toContain('G-TJZ5EZPWH3');
    });

    it('o script do Google é assíncrono (não bloqueia a página)', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      expect(scripts()[0].async).toBe(true);
    });

    it('aceitar duas vezes não duplica o script', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      applyConsent({ statistics: true, marketing: true });
      expect(scripts()).toHaveLength(1);
    });

    it('estatísticas sim e marketing não concede só a analítica', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      const v = camada().find((e) => e[1] === 'update')[2];
      expect(v.analytics_storage).toBe('granted');
      expect(v.ad_storage).toBe('denied');
      expect(v.ad_user_data).toBe('denied');
      expect(v.ad_personalization).toBe('denied');
    });

    it('marketing sim concede os três sinais de publicidade', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: true });
      const v = camada().find((e) => e[1] === 'update')[2];
      expect([v.ad_storage, v.ad_user_data, v.ad_personalization])
        .toEqual(['granted', 'granted', 'granted']);
    });

    it('marketing sem estatísticas não carrega o Google', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: false, marketing: true });
      expect(scripts()).toHaveLength(0);
    });

    it('a configuração do GA não envia page_view automático (é a SPA que envia)', async () => {
      const { applyConsent } = await carregar();
      applyConsent({ statistics: true, marketing: false });
      const config = camada().find((e) => e[0] === 'config');
      expect(config[2]).toEqual({ send_page_view: false });
    });
  });

  // ── eventos ────────────────────────────────────────────────────────────────
  describe('eventos', () => {
    it('sem consentimento um evento não chega a sair do browser', async () => {
      const { trackEvent } = await carregar();
      trackEvent('whatsapp_click', { origem: 'teste' });
      expect(scripts()).toHaveLength(0); // sem gtag.js a fila fica inerte
    });

    it('sem consentimento um evento não faz pedidos de rede', async () => {
      const rede = vi.fn();
      vi.stubGlobal('fetch', rede);
      const { trackEvent } = await carregar();
      trackEvent('whatsapp_click');
      expect(rede).not.toHaveBeenCalled();
    });

    it('o evento entra na fila com nome e parâmetros', async () => {
      const { trackEvent } = await carregar();
      trackEvent('tel_click', { origem: 'rodape' });
      expect(camada().at(-1)).toEqual(['event', 'tel_click', { origem: 'rodape' }]);
    });

    it('evento sem parâmetros usa um objecto vazio', async () => {
      const { trackEvent } = await carregar();
      trackEvent('email_click');
      expect(camada().at(-1)).toEqual(['event', 'email_click', {}]);
    });

    it('page_view leva o caminho da rota', async () => {
      const { trackPageView } = await carregar();
      trackPageView('/areas/familia');
      const [, nome, params] = camada().at(-1);
      expect(nome).toBe('page_view');
      expect(params.page_path).toBe('/areas/familia');
    });

    it('page_view leva o URL completo e o título da página', async () => {
      document.title = 'Uma página';
      const { trackPageView } = await carregar();
      trackPageView('/x');
      const params = camada().at(-1)[2];
      expect(params.page_location).toBe(window.location.href);
      expect(params.page_title).toBe('Uma página');
      document.title = '';
    });

    it('vários eventos seguidos empilham-se pela ordem', async () => {
      const { trackEvent } = await carregar();
      trackEvent('a'); trackEvent('b'); trackEvent('c');
      expect(camada().map((e) => e[1])).toEqual(['a', 'b', 'c']);
    });
  });

  // ── contador próprio (sem cookies) ─────────────────────────────────────────
  describe('trackHit — contador 1st-party', () => {
    const comBeacon = (fn) => Object.defineProperty(navigator, 'sendBeacon', {
      value: fn, configurable: true, writable: true,
    });

    it('usa o sendBeacon quando existe', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      const { trackHit } = await carregar();
      trackHit();
      expect(beacon).toHaveBeenCalledTimes(1);
    });

    it('o beacon vai para /api/hit', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      const { trackHit } = await carregar();
      trackHit();
      expect(beacon.mock.calls[0][0]).toBe('/api/hit');
    });

    it('o beacon leva o caminho da página', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      window.history.pushState({}, '', '/areas/familia');
      const { trackHit } = await carregar();
      trackHit();
      expect(beacon.mock.calls[0][1]).toBe('/areas/familia');
      window.history.pushState({}, '', '/');
    });

    it('o beacon não leva query nem fragmento', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      window.history.pushState({}, '', '/blog?utm_source=insta#topo');
      const { trackHit } = await carregar();
      trackHit();
      expect(beacon.mock.calls[0][1]).toBe('/blog');
      window.history.pushState({}, '', '/');
    });

    it('com beacon não se usa o fetch', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      const rede = vi.fn(() => Promise.resolve());
      vi.stubGlobal('fetch', rede);
      const { trackHit } = await carregar();
      trackHit();
      expect(rede).not.toHaveBeenCalled();
    });

    it('sem beacon recai no fetch para /api/hit', async () => {
      const rede = vi.fn(() => Promise.resolve());
      vi.stubGlobal('fetch', rede);
      const { trackHit } = await carregar();
      trackHit();
      expect(rede.mock.calls[0][0]).toBe('/api/hit');
    });

    it('o fetch de recurso é um POST que sobrevive à navegação', async () => {
      const rede = vi.fn(() => Promise.resolve());
      vi.stubGlobal('fetch', rede);
      const { trackHit } = await carregar();
      trackHit();
      const opcoes = rede.mock.calls[0][1];
      expect(opcoes.method).toBe('POST');
      expect(opcoes.keepalive).toBe(true);
    });

    it('se o beacon rebentar, tenta o fetch', async () => {
      comBeacon(() => { throw new Error('bloqueado'); });
      const rede = vi.fn(() => Promise.resolve());
      vi.stubGlobal('fetch', rede);
      const { trackHit } = await carregar();
      trackHit();
      expect(rede).toHaveBeenCalledTimes(1);
    });

    it('falha de rede no fetch não rebenta a página', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
      const { trackHit } = await carregar();
      expect(() => trackHit()).not.toThrow();
    });

    it('fetch inexistente não rebenta a página', async () => {
      vi.stubGlobal('fetch', undefined);
      const { trackHit } = await carregar();
      expect(() => trackHit()).not.toThrow();
    });

    it('o contador não guarda nada no dispositivo', async () => {
      const beacon = vi.fn(() => true);
      comBeacon(beacon);
      const { trackHit } = await carregar();
      trackHit();
      expect(localStorage.length).toBe(0);
      expect(document.cookie).toBe('');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Navbar.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('Navbar', () => {
  const MENU = [
    ['Home', '/'],
    ['Sobre', '/sobre'],
    ['Áreas de Atuação', '/areas'],
    ['Apoio', '/apoio'],
    ['Blogue', '/blog'],
    ['Contacto', '/contacto'],
  ];

  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  it.each(MENU)('tem ligação para %s (%s)', (rotulo, destino) => {
    renderizar(<Navbar />);
    const links = screen.getAllByRole('link', { name: rotulo });
    expect(links.some((l) => l.getAttribute('href') === destino)).toBe(true);
  });

  it('o logótipo leva à Home', () => {
    renderizar(<Navbar />);
    expect(screen.getByRole('link', { name: 'Vyvian Avena Advogada' }))
      .toHaveAttribute('href', '/');
  });

  it('o logótipo tem texto alternativo (o Google não lê imagens)', () => {
    renderizar(<Navbar />);
    expect(screen.getByAltText('Vyvian Avena Advogada')).toBeInTheDocument();
  });

  it('o logótipo declara largura e altura (evita o salto de layout)', () => {
    renderizar(<Navbar />);
    const logo = screen.getByAltText('Vyvian Avena Advogada');
    expect(logo).toHaveAttribute('width');
    expect(logo).toHaveAttribute('height');
  });

  it('tem um convite à consulta que leva ao contacto', () => {
    renderizar(<Navbar />);
    const consulta = screen.getAllByRole('link', { name: 'Consulta' });
    expect(consulta.length).toBeGreaterThan(0);
    expect(consulta[0]).toHaveAttribute('href', '/contacto');
  });

  it('a Área Privada leva ao login do admin', () => {
    renderizar(<Navbar />);
    expect(screen.getAllByRole('link', { name: /Área Privada/ })[0])
      .toHaveAttribute('href', '/admin/login');
  });

  it('as ligações do menu aparecem no ecrã grande e no menu de telemóvel', () => {
    renderizar(<Navbar />);
    expect(screen.getAllByRole('link', { name: 'Sobre' })).toHaveLength(2);
  });

  it('não há ligações mortas no menu', () => {
    renderizar(<Navbar />);
    for (const l of screen.getAllByRole('link')) {
      expect(l.getAttribute('href')).toBeTruthy();
      expect(l.getAttribute('href')).not.toBe('#');
    }
  });

  // ── item ativo ─────────────────────────────────────────────────────────────
  // O destaque do item atual é dado por uma classe própria (`text-gold`), não por
  // aria-current; a classe `hover:text-gold` está em todos e não conta.
  const marcado = (el) => /(?:^|\s)text-gold(?:\s|$)/.test(el.className);

  it('a rota atual fica marcada no menu', () => {
    renderizar(<Navbar />, { caminho: '/sobre' });
    const [sobre] = screen.getAllByRole('link', { name: 'Sobre' });
    expect(marcado(sobre)).toBe(true);
  });

  it('só a rota atual fica marcada', () => {
    renderizar(<Navbar />, { caminho: '/sobre' });
    const [areas] = screen.getAllByRole('link', { name: 'Áreas de Atuação' });
    expect(marcado(areas)).toBe(false);
  });

  it('na Home é a Home que está marcada', () => {
    renderizar(<Navbar />, { caminho: '/' });
    const [home] = screen.getAllByRole('link', { name: 'Home' });
    expect(marcado(home)).toBe(true);
  });

  it('numa rota de área nenhum item do menu se marca por engano', () => {
    renderizar(<Navbar />, { caminho: '/areas/familia' });
    const [areas] = screen.getAllByRole('link', { name: 'Áreas de Atuação' });
    expect(marcado(areas)).toBe(false);
  });

  it('o destaque acompanha a rota em todas as entradas do menu', () => {
    for (const [rotulo, destino] of MENU) {
      const { unmount } = renderizar(<Navbar />, { caminho: destino });
      const [link] = screen.getAllByRole('link', { name: rotulo });
      expect(marcado(link), rotulo).toBe(true);
      unmount();
    }
  });

  // ── menu de telemóvel ──────────────────────────────────────────────────────
  describe('menu de telemóvel', () => {
    const painel = () => screen.getByLabelText('Fechar menu').parentElement;

    it('tem botão de abrir com nome acessível', () => {
      renderizar(<Navbar />);
      expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    });

    it('arranca fechado', () => {
      renderizar(<Navbar />);
      expect(painel().className).toContain('pointer-events-none');
    });

    it('abre ao clicar', async () => {
      const { utilizador } = renderizar(<Navbar />);
      await utilizador.click(screen.getByRole('button', { name: 'Abrir menu' }));
      expect(painel().className).toContain('pointer-events-auto');
    });

    it('fecha no X', async () => {
      const { utilizador } = renderizar(<Navbar />);
      await utilizador.click(screen.getByRole('button', { name: 'Abrir menu' }));
      await utilizador.click(screen.getByRole('button', { name: 'Fechar menu' }));
      expect(painel().className).toContain('pointer-events-none');
    });

    it('fecha sozinho ao navegar para outra página', async () => {
      const { utilizador } = renderizar(<Navbar />, { caminho: '/' });
      await utilizador.click(screen.getByRole('button', { name: 'Abrir menu' }));
      const sobre = screen.getAllByRole('link', { name: 'Sobre' }).at(-1);
      await utilizador.click(sobre);
      await waitFor(() => expect(painel().className).toContain('pointer-events-none'));
    });

    it('fechado não recebe cliques (não tapa a página)', () => {
      renderizar(<Navbar />);
      expect(painel().className).toMatch(/opacity-0/);
      expect(painel().className).toMatch(/pointer-events-none/);
    });

    it('o menu fechado leva sempre pointer-events-none junto do opacity-0 (o seo-check conta com isso)', () => {
      renderizar(<Navbar />);
      const classes = painel().className;
      const i = classes.indexOf('opacity-0');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(classes).toContain('pointer-events-none');
    });
  });

  // ── scroll ─────────────────────────────────────────────────────────────────
  describe('aspeto ao rolar', () => {
    const rolar = (y) => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
      fireEvent.scroll(window);
    };

    it('no topo da Home o logótipo é a versão clara', () => {
      renderizar(<Navbar />, { caminho: '/' });
      expect(screen.getByAltText('Vyvian Avena Advogada').getAttribute('src'))
        .toContain('branco');
    });

    it('depois de rolar passa ao logótipo verde sobre fundo claro', () => {
      renderizar(<Navbar />, { caminho: '/' });
      rolar(200);
      expect(screen.getByAltText('Vyvian Avena Advogada').getAttribute('src'))
        .toContain('verde');
    });

    it('voltar ao topo repõe o logótipo claro', () => {
      renderizar(<Navbar />, { caminho: '/' });
      rolar(200);
      rolar(0);
      expect(screen.getByAltText('Vyvian Avena Advogada').getAttribute('src'))
        .toContain('branco');
    });

    it('o blogue já arranca com o navbar claro (fundo claro, sem hero)', () => {
      renderizar(<Navbar />, { caminho: '/blog' });
      expect(screen.getByAltText('Vyvian Avena Advogada').getAttribute('src'))
        .toContain('verde');
    });
  });

  // ── teclado ────────────────────────────────────────────────────────────────
  describe('teclado', () => {
    it('o Tab entra pelo logótipo', async () => {
      const { utilizador } = renderizar(<Navbar />);
      await utilizador.tab();
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Vyvian Avena Advogada' }));
    });

    it('o Tab percorre as ligações principais pela ordem do menu', async () => {
      const { utilizador } = renderizar(<Navbar />);
      const vistos = [];
      for (let i = 0; i < 7; i++) {
        await utilizador.tab();
        vistos.push(document.activeElement?.textContent?.trim());
      }
      expect(vistos).toEqual(expect.arrayContaining(['Home', 'Sobre', 'Áreas de Atuação']));
    });

    it('o botão do menu é alcançável por teclado', async () => {
      const { utilizador } = renderizar(<Navbar />);
      const abrir = screen.getByRole('button', { name: 'Abrir menu' });
      abrir.focus();
      expect(document.activeElement).toBe(abrir);
      await utilizador.keyboard('{Enter}');
      expect(screen.getByLabelText('Fechar menu').parentElement.className)
        .toContain('pointer-events-auto');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Footer.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('Footer', () => {
  it('mostra o telefone do escritório', () => {
    renderizar(<Footer />);
    expect(screen.getByText('+351 911 831 530')).toBeInTheDocument();
  });

  it('o telefone é clicável no telemóvel', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: /911 831 530/ }))
      .toHaveAttribute('href', 'tel:+351911831530');
  });

  it('mostra o e-mail pessoal', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: /vyavena@gmail.com/ }))
      .toHaveAttribute('href', 'mailto:vyavena@gmail.com');
  });

  it('mostra o e-mail profissional da Ordem dos Advogados', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: /adv\.oa\.pt/ }))
      .toHaveAttribute('href', 'mailto:vyvianavena-60987P@adv.oa.pt');
  });

  it('a cédula profissional aparece no e-mail da Ordem', () => {
    renderizar(<Footer />);
    expect(screen.getByText(/60987P/)).toBeInTheDocument();
  });

  it('liga ao Instagram do escritório', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: /@vyvianavenaadv/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/vyvianavenaadv/');
  });

  it('o Instagram abre noutro separador em segurança', () => {
    renderizar(<Footer />);
    const insta = screen.getByRole('link', { name: /@vyvianavenaadv/ });
    expect(insta).toHaveAttribute('target', '_blank');
    expect(insta.getAttribute('rel')).toContain('noopener');
  });

  it('lista os três escritórios', () => {
    renderizar(<Footer />);
    expect(screen.getByText(/Cacilhas/)).toBeInTheDocument();
    expect(screen.getByText(/Santa Maria da Feira/)).toBeInTheDocument();
    expect(screen.getByText(/Barra Olímpica/)).toBeInTheDocument();
  });

  it.each([
    ['Home', '/'],
    ['Sobre', '/sobre'],
    ['Áreas de Atuação', '/areas'],
    ['Apoio', '/apoio'],
    ['Blogue', '/blog'],
    ['Contacto', '/contacto'],
  ])('tem ligação interna para %s (%s)', (rotulo, destino) => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: rotulo })).toHaveAttribute('href', destino);
  });

  it('mostra o ano atual no aviso de direitos', () => {
    renderizar(<Footer />);
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()}`))).toBeInTheDocument();
  });

  it('reserva os direitos em nome da advogada', () => {
    renderizar(<Footer />);
    expect(screen.getByText(/Todos os direitos reservados/)).toBeInTheDocument();
  });

  it('o logótipo do rodapé tem texto alternativo', () => {
    renderizar(<Footer />);
    expect(screen.getByAltText('Vyvian Avena — Advogada')).toBeInTheDocument();
  });

  it('regista o clique no telefone', async () => {
    const { utilizador } = renderizar(<Footer />);
    await utilizador.click(screen.getByRole('link', { name: /911 831 530/ }));
    expect(analitica.trackEvent).toHaveBeenCalledWith('tel_click', { origem: 'rodape' });
  });

  it('regista o clique no e-mail', async () => {
    const { utilizador } = renderizar(<Footer />);
    await utilizador.click(screen.getByRole('link', { name: /vyavena@gmail.com/ }));
    expect(analitica.trackEvent).toHaveBeenCalledWith('email_click', { origem: 'rodape' });
  });

  it('as secções do rodapé têm títulos', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('heading', { name: 'Navegação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contacto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Escritórios' })).toBeInTheDocument();
  });

  it('é mesmo um <footer> (marco de página para leitores de ecrã)', () => {
    const { container } = renderizar(<Footer />);
    expect(container.querySelector('footer')).toBeTruthy();
  });

  // CORRIGIDO (era): src/components/Footer.jsx — o rodapé não liga à Política de Cookies.
  // A página existe, é indexável e entra no sitemap (scripts/routes.mjs), mas o
  // único caminho para lá no site com Layout é o banner de cookies — que
  // desaparece assim que o visitante decide. Fica uma página órfã (mal rastreada,
  // como avisa o seo-check) e, num sítio de advogada, a informação de privacidade
  // deixa de estar acessível a quem já consentiu. A página /links tem a ligação;
  // o rodapé do site não.
  it('liga à Política de Cookies', () => {
    renderizar(<Footer />);
    expect(screen.getByRole('link', { name: /Pol[íi]tica de Cookies/i }))
      .toHaveAttribute('href', '/politica-cookies');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Breadcrumbs.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('Breadcrumbs', () => {
  const AREAS = [
    { name: 'Início', path: '/' },
    { name: 'Áreas de Atuação', path: '/areas' },
  ];
  const AREA = [...AREAS, { name: 'Direito de Família', path: '/areas/familia' }];
  const BLOG = [
    { name: 'Início', path: '/' },
    { name: 'Blogue', path: '/blog' },
    { name: 'Herança em Portugal', path: '/blog/heranca' },
  ];

  it('é uma navegação com nome acessível', () => {
    renderizar(<Breadcrumbs items={AREAS} />);
    expect(screen.getByRole('navigation', { name: 'Percurso' })).toBeInTheDocument();
  });

  it('usa uma lista ordenada', () => {
    const { container } = renderizar(<Breadcrumbs items={AREAS} />);
    expect(container.querySelector('ol')).toBeTruthy();
  });

  it('mostra um item por nível', () => {
    const { container } = renderizar(<Breadcrumbs items={AREA} />);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('mostra os nomes pela ordem da hierarquia', () => {
    const { container } = renderizar(<Breadcrumbs items={AREA} />);
    const textos = [...container.querySelectorAll('li')].map((li) => li.textContent.trim());
    expect(textos).toEqual(['Início', 'Áreas de Atuação', 'Direito de Família']);
  });

  it('/areas tem dois níveis: Início e Áreas de Atuação', () => {
    renderizar(<Breadcrumbs items={AREAS} />);
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Áreas de Atuação')).toBeInTheDocument();
  });

  it('/areas/{slug} tem três níveis', () => {
    renderizar(<Breadcrumbs items={AREA} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Direito de Família')).toBeInTheDocument();
  });

  it('/blog/{slug} tem três níveis a começar no Início', () => {
    const { container } = renderizar(<Breadcrumbs items={BLOG} />);
    expect([...container.querySelectorAll('li')].map((li) => li.textContent.trim()))
      .toEqual(['Início', 'Blogue', 'Herança em Portugal']);
  });

  it('todos os níveis menos o último são ligações', () => {
    renderizar(<Breadcrumbs items={AREA} />);
    expect(screen.getAllByRole('link')).toHaveLength(AREA.length - 1);
  });

  it('o último item não é ligação', () => {
    renderizar(<Breadcrumbs items={AREA} />);
    expect(screen.queryByRole('link', { name: 'Direito de Família' })).not.toBeInTheDocument();
  });

  it('o último item anuncia-se como a página atual', () => {
    renderizar(<Breadcrumbs items={AREA} />);
    expect(screen.getByText('Direito de Família')).toHaveAttribute('aria-current', 'page');
  });

  it('só há um item marcado como página atual', () => {
    const { container } = renderizar(<Breadcrumbs items={AREA} />);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('as ligações apontam para os caminhos dados', () => {
    renderizar(<Breadcrumbs items={AREA} />);
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Áreas de Atuação' })).toHaveAttribute('href', '/areas');
  });

  it('as setas ficam escondidas dos leitores de ecrã', () => {
    const { container } = renderizar(<Breadcrumbs items={AREA} />);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it('um único nível não tem ligações nem setas', () => {
    const { container } = renderizar(<Breadcrumbs items={[{ name: 'Início', path: '/' }]} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('lista vazia não rebenta', () => {
    const { container } = renderizar(<Breadcrumbs items={[]} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('aceita classes extra sem perder as suas', () => {
    const { container } = renderizar(<Breadcrumbs items={AREAS} className="mb-8" />);
    expect(container.querySelector('nav').className).toContain('mb-8');
    expect(container.querySelector('nav').className).toContain('font-body');
  });

  // ── JSON-LD ────────────────────────────────────────────────────────────────
  describe('breadcrumbJsonLd', () => {
    it('declara BreadcrumbList e o @context', () => {
      const d = breadcrumbJsonLd(AREA);
      expect(d['@type']).toBe('BreadcrumbList');
      expect(d['@context']).toBe('https://schema.org');
    });

    it('tem um ListItem por nível', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement).toHaveLength(3);
    });

    it('as posições começam em 1 e são seguidas', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    });

    it('cada item é um ListItem', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement.every((i) => i['@type'] === 'ListItem')).toBe(true);
    });

    it('os nomes acompanham os que se veem no ecrã', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement.map((i) => i.name))
        .toEqual(AREA.map((i) => i.name));
    });

    it('os URLs são absolutos', () => {
      for (const i of breadcrumbJsonLd(AREA).itemListElement) {
        expect(i.item).toMatch(new RegExp(`^${SITE}/`));
      }
    });

    it('a raiz fica em https://vyavenaadv.com/', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement[0].item).toBe(`${SITE}/`);
    });

    it('o último item aponta para a própria página', () => {
      expect(breadcrumbJsonLd(AREA).itemListElement.at(-1).item).toBe(`${SITE}/areas/familia`);
    });

    it('lista vazia dá um itemListElement vazio', () => {
      expect(breadcrumbJsonLd([]).itemListElement).toEqual([]);
    });

    it('o resultado é serializável para o <script> do Seo', () => {
      expect(() => JSON.parse(JSON.stringify(breadcrumbJsonLd(AREA)))).not.toThrow();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WhatsAppButton.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('WhatsAppButton', () => {
  const pill = () => screen.getByRole('link', { name: 'Fale connosco via WhatsApp' });

  it('leva ao WhatsApp do escritório', () => {
    renderizar(<WhatsAppButton />);
    expect(pill().getAttribute('href')).toContain('wa.me/351911831530');
  });

  it('usa o indicativo de Portugal sem sinal de mais nem espaços', () => {
    renderizar(<WhatsAppButton />);
    expect(pill().getAttribute('href')).toMatch(/wa\.me\/351911831530(\?|$)/);
  });

  it('leva uma mensagem já escrita', () => {
    renderizar(<WhatsAppButton />);
    const url = new URL(pill().getAttribute('href'));
    expect(url.searchParams.get('text')).toBe('Olá, gostaria de agendar uma consulta.');
  });

  it('a mensagem vai codificada (não parte o URL)', () => {
    renderizar(<WhatsAppButton />);
    expect(pill().getAttribute('href')).not.toMatch(/\s/);
  });

  it('abre noutro separador', () => {
    renderizar(<WhatsAppButton />);
    expect(pill()).toHaveAttribute('target', '_blank');
  });

  it('abre em segurança: noopener', () => {
    renderizar(<WhatsAppButton />);
    expect(pill().getAttribute('rel')).toContain('noopener');
  });

  it('abre em segurança: noreferrer', () => {
    renderizar(<WhatsAppButton />);
    expect(pill().getAttribute('rel')).toContain('noreferrer');
  });

  it('tem nome acessível para leitores de ecrã', () => {
    renderizar(<WhatsAppButton />);
    expect(pill()).toHaveAttribute('aria-label', 'Fale connosco via WhatsApp');
  });

  it('mostra o convite por escrito', () => {
    renderizar(<WhatsAppButton />);
    expect(screen.getByText('Fale connosco')).toBeInTheDocument();
  });

  it('o ícone não é lido em voz alta', () => {
    const { container } = renderizar(<WhatsAppButton />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('regista o clique com a origem certa', async () => {
    const { utilizador } = renderizar(<WhatsAppButton />);
    await utilizador.click(pill());
    expect(analitica.trackEvent).toHaveBeenCalledWith('whatsapp_click', { origem: 'pill_flutuante' });
  });

  it('o registo do clique não impede a ida para o WhatsApp', async () => {
    const { utilizador } = renderizar(<WhatsAppButton />);
    await utilizador.click(pill());
    expect(pill()).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ScrollReveal.jsx — o conteúdo nunca pode ficar invisível
// ═════════════════════════════════════════════════════════════════════════════
describe('ScrollReveal', () => {
  let observados;
  let ligacoes;

  const observadorQueNuncaDispara = () => {
    observados = [];
    ligacoes = [];
    class FalsoIO {
      constructor(cb) { this.cb = cb; ligacoes.push(this); this.desligado = false; }
      observe(el) { observados.push(el); this.alvo = el; }
      unobserve() { this.desobservou = true; }
      disconnect() { this.desligado = true; }
      disparar() { this.cb([{ isIntersecting: true, target: this.alvo }], this); }
    }
    vi.stubGlobal('IntersectionObserver', FalsoIO);
  };

  beforeEach(observadorQueNuncaDispara);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('mostra o conteúdo que lhe dão', () => {
    renderizar(<ScrollReveal><h2>Áreas de Atuação</h2></ScrollReveal>);
    expect(screen.getByRole('heading', { name: 'Áreas de Atuação' })).toBeInTheDocument();
  });

  it('o conteúdo fica no HTML mesmo sem o observador disparar', () => {
    renderizar(<ScrollReveal><p>Texto que o Google tem de ler</p></ScrollReveal>);
    expect(screen.getByText('Texto que o Google tem de ler')).toBeInTheDocument();
  });

  it('o conteúdo não é escondido de leitores de ecrã', () => {
    const { container } = renderizar(<ScrollReveal><p>Texto</p></ScrollReveal>);
    expect(container.firstChild).not.toHaveAttribute('aria-hidden');
    expect(container.firstChild).not.toHaveAttribute('hidden');
  });

  it('não usa display:none (que tira o texto do fluxo)', () => {
    const { container } = renderizar(<ScrollReveal><p>Texto</p></ScrollReveal>);
    expect(container.firstChild.style.display).not.toBe('none');
  });

  it('observa o elemento que embrulha', () => {
    renderizar(<ScrollReveal><p>x</p></ScrollReveal>);
    expect(observados).toHaveLength(1);
  });

  it('revela quando o elemento entra no ecrã', async () => {
    const { container } = renderizar(<ScrollReveal><p>x</p></ScrollReveal>);
    await act(async () => { ligacoes[0].disparar(); });
    await waitFor(() => expect(container.firstChild.className).toContain('opacity-100'));
  });

  it('depois de revelar deixa de observar (não repete a animação)', async () => {
    renderizar(<ScrollReveal><p>x</p></ScrollReveal>);
    await act(async () => { ligacoes[0].disparar(); });
    expect(ligacoes[0].desobservou).toBe(true);
  });

  it('desliga o observador ao sair da página', () => {
    const { unmount } = renderizar(<ScrollReveal><p>x</p></ScrollReveal>);
    unmount();
    expect(ligacoes[0].desligado).toBe(true);
  });

  it('respeita o atraso pedido antes de revelar', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ScrollReveal delay={300}><p>x</p></ScrollReveal>);
      act(() => { ligacoes[0].disparar(); });
      expect(container.firstChild.className).toContain('opacity-0');
      act(() => { vi.advanceTimersByTime(300); });
      expect(container.firstChild.className).toContain('opacity-100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sem atraso revela de imediato', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ScrollReveal><p>x</p></ScrollReveal>);
      act(() => { ligacoes[0].disparar(); });
      act(() => { vi.advanceTimersByTime(0); });
      expect(container.firstChild.className).toContain('opacity-100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aceita classes extra', () => {
    const { container } = renderizar(<ScrollReveal className="mb-8"><p>x</p></ScrollReveal>);
    expect(container.firstChild.className).toContain('mb-8');
  });

  it('sem filhos não rebenta', () => {
    expect(() => renderizar(<ScrollReveal />)).not.toThrow();
  });

  it('vários blocos na mesma página revelam-se de forma independente', async () => {
    const { container } = renderizar(
      <><ScrollReveal><p>um</p></ScrollReveal><ScrollReveal><p>dois</p></ScrollReveal></>
    );
    await act(async () => { ligacoes[0].disparar(); });
    await waitFor(() => expect(container.children[0].className).toContain('opacity-100'));
    expect(container.children[1].className).toContain('opacity-0');
  });

  // ── o que o prerender vê ───────────────────────────────────────────────────
  // A regressão que o scripts/seo-check.mjs persegue: se o estado inicial voltar
  // a ser `useState(false)`, o HTML estático sai todo com opacity-0 e o conteúdo
  // desaparece para os crawlers. Aqui reimporta-se o módulo sem `window`, que é
  // o ambiente do react-dom/server em scripts/prerender.mjs.
  describe('no prerender (sem window)', () => {
    async function moduloSSR() {
      vi.resetModules();
      vi.stubGlobal('window', undefined);
      try {
        return (await import('../../src/components/ScrollReveal.jsx')).default;
      } finally {
        vi.unstubAllGlobals();
        observadorQueNuncaDispara();
      }
    }

    it('arranca visível no HTML estático', async () => {
      const SR = await moduloSSR();
      const html = renderToStaticMarkup(<SR><p>Conteúdo para o Google</p></SR>);
      expect(html).toContain('opacity-100');
    });

    it('o HTML estático não sai com opacity-0', async () => {
      const SR = await moduloSSR();
      const html = renderToStaticMarkup(<SR><p>Conteúdo para o Google</p></SR>);
      expect(html).not.toContain('opacity-0');
    });

    it('o texto vai mesmo dentro do HTML estático', async () => {
      const SR = await moduloSSR();
      const html = renderToStaticMarkup(<SR><h2>Direito de Família</h2></SR>);
      expect(html).toContain('Direito de Família');
    });

    it('também não translada o bloco para fora do sítio', async () => {
      const SR = await moduloSSR();
      const html = renderToStaticMarkup(<SR><p>x</p></SR>);
      expect(html).toContain('translate-y-0');
    });
  });

  // CORRIGIDO (era): src/components/ScrollReveal.jsx:13 — o `new IntersectionObserver` corre
  // sem guarda de suporte. Num browser sem IntersectionObserver o efeito atira
  // ReferenceError, o React desmonta a árvore e a página fica em branco — pior do
  // que não animar. Devia revelar o conteúdo (setIsVisible(true)) quando a API
  // não existe.
  it('sem IntersectionObserver o conteúdo continua a aparecer', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() => renderizar(<ScrollReveal><p>Texto</p></ScrollReveal>)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ScrollToTop.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('ScrollToTop', () => {
  let subir;
  beforeEach(() => {
    subir = vi.fn();
    vi.stubGlobal('scrollTo', subir);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('não desenha nada', () => {
    const { container } = renderizar(<ScrollToTop />);
    expect(container).toBeEmptyDOMElement();
  });

  it('põe a página no topo ao entrar', () => {
    renderizar(<ScrollToTop />);
    expect(subir).toHaveBeenCalledTimes(1);
  });

  it('sobe até ao topo absoluto', () => {
    renderizar(<ScrollToTop />);
    expect(subir).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });

  it('sobe sem animação (mudar de página não é rolar)', () => {
    renderizar(<ScrollToTop />);
    expect(subir.mock.calls[0][0].behavior).toBe('instant');
  });

  it('volta a subir ao mudar de rota', async () => {
    const { Link } = await import('react-router-dom');
    const { utilizador } = renderizar(
      <><ScrollToTop /><Link to="/sobre">Sobre</Link></>
    );
    subir.mockClear();
    await utilizador.click(screen.getByRole('link', { name: 'Sobre' }));
    await waitFor(() => expect(subir).toHaveBeenCalledTimes(1));
  });

  it('não sobe outra vez se o destino for a página onde já se está', async () => {
    const { Link } = await import('react-router-dom');
    const { utilizador } = renderizar(
      <><ScrollToTop /><Link to="/">Home</Link></>, { caminho: '/' }
    );
    subir.mockClear();
    await utilizador.click(screen.getByRole('link', { name: 'Home' }));
    expect(subir).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ContactMap.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('ContactMap', () => {
  const mapas = (c) => [...c.querySelectorAll('iframe')];

  it('mostra um mapa por escritório', () => {
    const { container } = renderizar(<ContactMap />);
    expect(mapas(container)).toHaveLength(3);
  });

  it('cada mapa tem título (sem isto é uma moldura anónima para quem usa leitor de ecrã)', () => {
    const { container } = renderizar(<ContactMap />);
    for (const m of mapas(container)) expect(m.getAttribute('title')).toBeTruthy();
  });

  it('os títulos dos mapas são diferentes entre si', () => {
    const { container } = renderizar(<ContactMap />);
    const titulos = mapas(container).map((m) => m.getAttribute('title'));
    expect(new Set(titulos).size).toBe(3);
  });

  it('mostra o escritório de Cacilhas', () => {
    renderizar(<ContactMap />);
    expect(screen.getByText(/Cacilhas/)).toBeInTheDocument();
  });

  it('mostra o escritório do norte', () => {
    renderizar(<ContactMap />);
    expect(screen.getByText(/Aveiro/)).toBeInTheDocument();
  });

  it('mostra o escritório do Rio de Janeiro', () => {
    renderizar(<ContactMap />);
    expect(screen.getByText(/Barra Olímpica/)).toBeInTheDocument();
  });

  it('a morada de Cacilhas está no mapa', () => {
    const { container } = renderizar(<ContactMap />);
    expect(mapas(container)[0].getAttribute('src')).toContain('Cacilhas');
  });

  it('a morada de Santa Maria da Feira está no mapa', () => {
    const { container } = renderizar(<ContactMap />);
    expect(mapas(container)[1].getAttribute('src')).toContain('Santa+Maria+da+Feira');
  });

  it('a morada do Rio está no mapa', () => {
    const { container } = renderizar(<ContactMap />);
    expect(mapas(container)[2].getAttribute('src')).toContain('Rio+de+Janeiro');
  });

  it('todos os mapas são embebidos do Google Maps', () => {
    const { container } = renderizar(<ContactMap />);
    for (const m of mapas(container)) {
      expect(m.getAttribute('src')).toMatch(/^https:\/\/www\.google\.com\/maps\?/);
      expect(m.getAttribute('src')).toContain('output=embed');
    }
  });

  it('os mapas só carregam quando chegam ao ecrã', () => {
    const { container } = renderizar(<ContactMap />);
    for (const m of mapas(container)) expect(m.getAttribute('loading')).toBe('lazy');
  });

  it('os mapas podem abrir em ecrã inteiro', () => {
    const { container } = renderizar(<ContactMap />);
    for (const m of mapas(container)) expect(m.hasAttribute('allowfullscreen')).toBe(true);
  });

  it('os mapas ocupam a largura toda da coluna', () => {
    const { container } = renderizar(<ContactMap />);
    for (const m of mapas(container)) expect(m.getAttribute('width')).toBe('100%');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Layout.jsx
// ═════════════════════════════════════════════════════════════════════════════
describe('Layout', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it('mostra o conteúdo da página', () => {
    renderizar(<Layout><h1>Contacto</h1></Layout>);
    expect(screen.getByRole('heading', { name: 'Contacto', level: 1 })).toBeInTheDocument();
  });

  it('o conteúdo vive dentro do <main>', () => {
    const { container } = renderizar(<Layout><p>corpo</p></Layout>);
    expect(within(container.querySelector('main')).getByText('corpo')).toBeInTheDocument();
  });

  it('há exactamente um <main> por página', () => {
    const { container } = renderizar(<Layout><p>x</p></Layout>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('traz o menu de navegação', () => {
    renderizar(<Layout><p>x</p></Layout>);
    expect(screen.getAllByRole('link', { name: 'Sobre' }).length).toBeGreaterThan(0);
  });

  it('traz o rodapé', () => {
    const { container } = renderizar(<Layout><p>x</p></Layout>);
    expect(container.querySelector('footer')).toBeTruthy();
  });

  it('traz o botão de WhatsApp', () => {
    renderizar(<Layout><p>x</p></Layout>);
    expect(screen.getByRole('link', { name: 'Fale connosco via WhatsApp' })).toBeInTheDocument();
  });

  it('traz o banner de cookies na primeira visita', () => {
    renderizar(<Layout><p>x</p></Layout>);
    expect(screen.getByText('Preferências de Privacidade')).toBeInTheDocument();
  });

  it('não traz o banner a quem já decidiu', () => {
    localStorage.setItem('cookie_consent', 'essential');
    renderizar(<Layout><p>x</p></Layout>);
    expect(screen.queryByText('Preferências de Privacidade')).not.toBeInTheDocument();
  });

  it('regista a visita à rota', () => {
    renderizar(<Layout><p>x</p></Layout>, { caminho: '/contacto' });
    expect(analitica.trackPageView).toHaveBeenCalledWith('/contacto');
  });

  it('conta o acesso no contador próprio', () => {
    renderizar(<Layout><p>x</p></Layout>);
    expect(analitica.trackHit).toHaveBeenCalledTimes(1);
  });

  it('regista uma visita por mudança de rota', async () => {
    const { Link } = await import('react-router-dom');
    const { utilizador } = renderizar(
      <Layout><Link to="/sobre">ir para sobre</Link></Layout>, { caminho: '/' }
    );
    await utilizador.click(screen.getByRole('link', { name: 'ir para sobre' }));
    await waitFor(() => expect(analitica.trackPageView).toHaveBeenCalledWith('/sobre'));
  });

  it('esconde o crachá do Base44 com um estilo próprio', () => {
    renderizar(<Layout><p>x</p></Layout>);
    expect([...document.head.querySelectorAll('style')].some((s) => s.innerHTML.includes('base44')))
      .toBe(true);
  });

  it('retira esse estilo ao sair (não se acumula)', () => {
    const { unmount } = renderizar(<Layout><p>x</p></Layout>);
    unmount();
    expect([...document.head.querySelectorAll('style')].some((s) => s.innerHTML.includes('base44')))
      .toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// lib/imagens.js — capas responsivas do blogue
// ═════════════════════════════════════════════════════════════════════════════
describe('capaSrcSet', () => {
  const SRC = '/blog/heranca-em-portugal.jpg';

  it('dá as três larguras que o build gera', () => {
    expect(capaSrcSet(SRC).split(',')).toHaveLength(3);
  });

  it('mantém o caminho da capa', () => {
    expect(capaSrcSet(SRC)).toContain('/blog/heranca-em-portugal-800.webp');
  });

  it('descreve cada variante com a sua largura', () => {
    expect(capaSrcSet(SRC)).toBe(
      '/blog/heranca-em-portugal-480.webp 480w, ' +
      '/blog/heranca-em-portugal-800.webp 800w, ' +
      '/blog/heranca-em-portugal-1200.webp 1200w'
    );
  });

  it('as variantes são todas WebP (o formato leve)', () => {
    for (const parte of capaSrcSet(SRC).split(', ')) expect(parte).toContain('.webp');
  });

  it('as larguras vêm por ordem crescente', () => {
    const larguras = capaSrcSet(SRC).split(', ').map((p) => Number(p.split(' ')[1].replace('w', '')));
    expect(larguras).toEqual([480, 800, 1200]);
  });

  it('a maior variante tem a largura da og:image (1200)', () => {
    expect(capaSrcSet(SRC)).toContain('-1200.webp 1200w');
  });

  it('não devolve o JPG original (esse fica no src, para o WhatsApp)', () => {
    expect(capaSrcSet(SRC)).not.toContain('.jpg');
  });

  it('sem imagem não há srcSet', () => {
    expect(capaSrcSet(undefined)).toBeUndefined();
  });

  it('imagem nula não há srcSet', () => {
    expect(capaSrcSet(null)).toBeUndefined();
  });

  it('string vazia não há srcSet', () => {
    expect(capaSrcSet('')).toBeUndefined();
  });

  it('imagem que não é JPG não tem variantes', () => {
    expect(capaSrcSet('/blog/capa.png')).toBeUndefined();
  });

  it('WebP passado à mão não gera variantes de si próprio', () => {
    expect(capaSrcSet('/blog/capa.webp')).toBeUndefined();
  });

  it('extensão em maiúsculas não é reconhecida (fica só o src original)', () => {
    expect(capaSrcSet('/blog/capa.JPG')).toBeUndefined();
  });

  it('só a extensão final é substituída', () => {
    expect(capaSrcSet('/blog/foto.jpg.jpg')).toContain('/blog/foto.jpg-480.webp 480w');
  });

  it('nomes com pontos pelo meio sobrevivem', () => {
    expect(capaSrcSet('/blog/lei-2.1-familia.jpg')).toContain('/blog/lei-2.1-familia-800.webp');
  });

  it('caminho absoluto de outro domínio é respeitado', () => {
    expect(capaSrcSet('https://cdn.exemplo.pt/a.jpg')).toContain('https://cdn.exemplo.pt/a-480.webp');
  });

  it('o resultado serve directamente o atributo srcSet (vírgula e espaço)', () => {
    expect(capaSrcSet(SRC)).toMatch(/^\S+ \d+w(, \S+ \d+w)+$/);
  });
});
