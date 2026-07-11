#!/usr/bin/env node
/**
 * scripts/seo-check.mjs
 *
 * Corre no fim do build e verifica o dist/ gerado. Falha (exit 1) se algum sinal
 * de SEO se partir — antes de a alteracao chegar a producao.
 *
 * Existe porque estes defeitos nao sao visiveis: o site continua bonito e a
 * funcionar enquanto desaparece do Google. Os casos concretos que ja' aconteceram
 * ou quase aconteceram neste projecto:
 *
 *   - dois <link rel=canonical> por pagina (o Google colapsa as rotas na Home)
 *   - ScrollReveal a arrancar com opacity-0 em SSR (conteudo invisivel aos crawlers)
 *   - <h1> transformado em <div> por ser "grande demais"
 *   - tags do Helmet removidas numa refactorizacao do App.jsx
 *   - JSON-LD apagado do index.html por parecer codigo a mais
 *   - PracticeAreasGrid a deixar de ligar para /areas/{slug}
 *
 * Nao substitui revisao humana; apanha o que passa despercebido.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllRoutes, getValidRoutes, getBlogSlugs } from './routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const SITE = 'https://vyavenaadv.com';

const LD = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

const falhas = [];
const avisos = [];

const erro = (rota, msg) => falhas.push(`${rota}: ${msg}`);
const aviso = (rota, msg) => avisos.push(`${rota}: ${msg}`);

/** dist/areas/familia.html para /areas/familia; dist/index.html para / */
const ficheiroDaRota = (rota) =>
  rota === '/' ? join(DIST, 'index.html') : join(DIST, `${rota.slice(1)}.html`);

function verificarPagina(rota, html) {
  // --- <h1> unico e nao vazio ---
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (h1s.length === 0) erro(rota, 'sem <h1>. Um titulo estilizado como <div> nao conta para o Google.');
  else if (h1s.length > 1) erro(rota, `${h1s.length} elementos <h1>. Deve haver exactamente um.`);
  else if (!h1s[0][1].replace(/<[^>]+>/g, '').trim()) erro(rota, '<h1> vazio. O texto virou imagem?');

  // --- <title> unico ---
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1) erro(rota, `${titles.length} elementos <title>. Deve haver exactamente um.`);
  else {
    const t = titles[0][1].trim();
    if (!t) erro(rota, '<title> vazio.');
    if (t.length > 65) aviso(rota, `<title> com ${t.length} caracteres; acima de ~60 e' truncado nas pesquisas.`);
  }

  // --- canonical unico e correcto ---
  const canons = [...html.matchAll(/rel="canonical"[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
  const esperado = rota === '/' ? `${SITE}/` : `${SITE}${rota}`;
  if (canons.length === 0) erro(rota, 'sem <link rel="canonical">.');
  else if (canons.length > 1) erro(rota, `${canons.length} canonicals. Dois canonicals colapsam as rotas na Home.`);
  else if (canons[0] !== esperado) erro(rota, `canonical aponta para ${canons[0]}, esperado ${esperado}.`);

  // --- meta description ---
  const descs = [...html.matchAll(/name="description"[^>]*content="([^"]*)"/gi)].map((m) => m[1]);
  if (descs.length === 0) erro(rota, 'sem meta description.');
  else if (descs.length > 1) erro(rota, `${descs.length} meta descriptions.`);
  else if (!descs[0].trim()) erro(rota, 'meta description vazia.');

  // --- meta robots unica e nao contraditoria ---
  // Duas tags robots (uma no index.html, outra do Helmet) davam "index" e "noindex"
  // na mesma pagina. O Google aplica a mais restritiva, mas depender disso e' fragil.
  const robots = [...html.matchAll(/name="robots"[^>]*content="([^"]*)"/gi)].map((m) => m[1]);
  if (robots.length === 0) erro(rota, 'sem meta robots.');
  else if (robots.length > 1) erro(rota, `${robots.length} meta robots: ${robots.join(' | ')}. Deve haver uma.`);
  else if (rota !== '/404' && /noindex/i.test(robots[0])) erro(rota, 'meta robots com noindex numa pagina que deve ser indexada.');

  // --- Open Graph ---
  for (const prop of ['og:title', 'og:description', 'og:url', 'og:image']) {
    const n = [...html.matchAll(new RegExp(`property="${prop}"`, 'gi'))].length;
    if (n === 0) erro(rota, `sem ${prop}.`);
    else if (n > 1) erro(rota, `${n} tags ${prop}.`);
  }

  // --- JSON-LD valido ---
  LD.lastIndex = 0;
  const blocos = [...html.matchAll(LD)];
  if (blocos.length === 0) erro(rota, 'sem JSON-LD. O LegalService global foi removido do index.html?');
  for (const [, corpo] of blocos) {
    try {
      const d = JSON.parse(corpo);
      if (!d['@type']) erro(rota, 'bloco JSON-LD sem @type.');
    } catch {
      erro(rota, 'JSON-LD invalido (nao faz parse).');
    }
  }

  // --- conteudo real no HTML estatico ---
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (texto.length < 500) {
    erro(rota, `so' ${texto.length} caracteres de texto. O prerender falhou ou a pagina esta' vazia.`);
  }

  // --- ScrollReveal a esconder conteudo ---
  // O menu mobile fechado usa legitimamente opacity-0 + pointer-events-none.
  // Qualquer outro opacity-0 no HTML estatico esconde conteudo dos crawlers.
  const suspeitos = [...html.matchAll(/opacity-0/g)].filter((m) => {
    const contexto = html.slice(Math.max(0, m.index - 200), m.index + 60);
    return !contexto.includes('pointer-events-none');
  });
  if (suspeitos.length > 0) {
    erro(
      rota,
      `${suspeitos.length}x opacity-0 sem pointer-events-none. O ScrollReveal deve arrancar visivel em SSR (ver IS_SSR em ScrollReveal.jsx), senao o conteudo fica escondido dos crawlers.`
    );
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('seo-check: dist/ nao existe. Correr depois do build.');
    process.exit(1);
  }

  const rotas = (await getAllRoutes()).map((r) => r.path);

  for (const rota of rotas) {
    const f = ficheiroDaRota(rota);
    if (!existsSync(f)) {
      erro(rota, 'HTML estatico ausente. O prerender nao correu para esta rota.');
      continue;
    }
    verificarPagina(rota, await readFile(f, 'utf-8'));
  }

  // --- pagina 404: existe, tem noindex, nao tem canonical, nao esta no sitemap ---
  const p404 = join(DIST, '404.html');
  if (!existsSync(p404)) {
    falhas.push('404.html ausente do dist/. O Worker precisa dela para servir 404 real.');
  } else {
    const html404 = await readFile(p404, 'utf-8');
    const robots404 = [...html404.matchAll(/name="robots"[^>]*content="([^"]*)"/gi)].map((m) => m[1]);
    if (robots404.length !== 1) falhas.push(`404: ${robots404.length} meta robots, esperada uma.`);
    else if (!/noindex/i.test(robots404[0])) falhas.push('404: sem noindex. Nao deve ser indexada.');
    if (/rel="canonical"/i.test(html404)) falhas.push('404: tem canonical. Nao e\' uma pagina real.');
    if (!/<h1[\s>]/i.test(html404)) falhas.push('404: sem <h1>.');
  }

  // --- a lista de rotas do Worker acompanha as rotas reais ---
  const rotasWorker = join(__dirname, '..', 'worker', 'rotas-publicas.js');
  if (!existsSync(rotasWorker)) {
    falhas.push('worker/rotas-publicas.js ausente. O Worker nao consegue distinguir 404 de rota valida.');
  } else {
    const src = await readFile(rotasWorker, 'utf-8');
    const m = src.match(/ROTAS_PUBLICAS\s*=\s*(\[[^\]]*\])/);
    if (!m) falhas.push('worker/rotas-publicas.js sem ROTAS_PUBLICAS.');
    else {
      const doWorker = JSON.parse(m[1]);
      const validas = await getValidRoutes();
      for (const r of validas) {
        if (!doWorker.includes(r)) falhas.push(`worker/rotas-publicas.js: falta ${r}. O Worker devolveria 404 numa pagina valida.`);
      }
      for (const r of doWorker) {
        if (!validas.includes(r)) falhas.push(`worker/rotas-publicas.js: ${r} ja' nao existe.`);
        else if (!existsSync(ficheiroDaRota(r))) falhas.push(`worker/rotas-publicas.js: ${r} e' valida mas nao tem HTML no dist.`);
      }
    }
  }

  // --- blogue: existe, e o estado de indexacao respeita a flag publicado ---
  // Enquanto publicado=false: paginas servem mas com noindex e SEM canonical,
  // e nao podem aparecer no sitemap (conteudo juridico em revisao pela Dra.).
  // Quando publicado=true: exige-se o inverso — index, canonical e sitemap.
  {
    const blogSlugs = await getBlogSlugs();
    let publicado = false;
    try {
      publicado = JSON.parse(await readFile(join(__dirname, '..', 'src', 'config', 'blog.json'), 'utf-8')).publicado === true;
    } catch { /* sem config = nao publicado */ }

    const rotasBlog = blogSlugs.length ? ['/blog', ...blogSlugs.map((s) => `/blog/${s}`)] : [];
    for (const rota of rotasBlog) {
      const f = ficheiroDaRota(rota);
      if (!existsSync(f)) { falhas.push(`${rota}: HTML estatico ausente.`); continue; }
      const html = await readFile(f, 'utf-8');
      const robotsB = [...html.matchAll(/name="robots"[^>]*content="([^"]*)"/gi)].map((x) => x[1]);
      const temCanonical = /rel="canonical"/i.test(html);
      const temNoindex = robotsB.some((r) => /noindex/i.test(r));
      if (robotsB.length !== 1) falhas.push(`${rota}: ${robotsB.length} meta robots, esperada uma.`);
      if (!publicado) {
        if (!temNoindex) falhas.push(`${rota}: blogue em revisao (publicado=false) mas sem noindex.`);
        if (temCanonical) falhas.push(`${rota}: blogue em revisao mas com canonical.`);
      } else {
        if (temNoindex) falhas.push(`${rota}: blogue publicado mas com noindex.`);
        if (!temCanonical) falhas.push(`${rota}: blogue publicado mas sem canonical.`);
      }
      if (!/<h1[\s>]/i.test(html)) falhas.push(`${rota}: sem <h1>.`);
    }
  }

  // --- higiene de performance e presença (guardas de regressão 2026-07) ---
  {
    const home = await readFile(ficheiroDaRota('/'), 'utf-8');
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(home))
      falhas.push('home: fontes do Google detectadas — devem ser auto-hospedadas (/fonts/).');
    if (!home.includes('rel="preload" as="image" href="/hero-escritorio'))
      falhas.push('home: falta o preload do hero (LCP).');
    const sobre = await readFile(ficheiroDaRota('/sobre'), 'utf-8');
    if (!/"@type":\s*"Person"/.test(sobre))
      falhas.push('/sobre: falta o JSON-LD Person (E-E-A-T).');
    for (const f of ['robots.txt', 'llms.txt', 'fonts/fonts.css']) {
      if (!existsSync(join(__dirname, '..', 'dist', f))) falhas.push(`dist/${f} ausente.`);
    }
    // nenhuma pagina prerenderizada deve ter <img> sem atributo alt
    for (const rota of rotas) {
      const html = await readFile(ficheiroDaRota(rota), 'utf-8');
      const imgs = html.match(/<img[^>]*>/g) || [];
      for (const img of imgs) {
        if (!/\salt=/.test(img)) falhas.push(`${rota}: <img> sem alt: ${img.slice(0, 60)}…`);
      }
    }
  }

  // --- sitemap coerente com as rotas ---
  const sitemapPath = join(DIST, 'sitemap.xml');
  if (!existsSync(sitemapPath)) {
    falhas.push('sitemap.xml ausente do dist/.');
  } else {
    const xml = await readFile(sitemapPath, 'utf-8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const rota of rotas) {
      const esperado = rota === '/' ? `${SITE}/` : `${SITE}${rota}`;
      if (!locs.includes(esperado)) falhas.push(`sitemap: falta ${esperado}.`);
    }
    for (const loc of locs) {
      if (loc !== `${SITE}/` && loc.endsWith('/')) {
        falhas.push(`sitemap: ${loc} tem barra final; o Cloudflare responde 307 e desperdica rastreio.`);
      }
      const pathLoc = loc.replace(SITE, '') || '/';
      if (!rotas.some((r) => r === pathLoc)) {
        falhas.push(`sitemap: ${pathLoc} nao e' uma rota indexavel (blogue em revisao?).`);
      }
    }
  }

  // --- robots.txt ---
  const robots = join(DIST, 'robots.txt');
  if (!existsSync(robots)) falhas.push('robots.txt ausente do dist/.');
  else {
    const r = await readFile(robots, 'utf-8');
    if (!r.includes('Sitemap:')) falhas.push('robots.txt sem linha Sitemap:.');
    if (!/Disallow:\s*\/admin/.test(r)) falhas.push('robots.txt nao bloqueia /admin.');
  }

  // --- as paginas de area devem ser alcancaveis a partir de /areas ---
  const indice = ficheiroDaRota('/areas');
  if (existsSync(indice)) {
    const html = await readFile(indice, 'utf-8');
    for (const rota of rotas.filter((r) => r.startsWith('/areas/'))) {
      if (!html.includes(`href="${rota}"`)) {
        aviso('/areas', `nao liga para ${rota}. Paginas sem ligacoes internas sao mal rastreadas.`);
      }
    }
  }

  // --- /admin e /upload nunca prerenderizados ---
  for (const proibido of ['admin', 'upload']) {
    if (existsSync(join(DIST, `${proibido}.html`)) || existsSync(join(DIST, proibido, 'index.html'))) {
      falhas.push(`${proibido} foi prerenderizado. Nao deve ser indexado.`);
    }
  }

  if (avisos.length) {
    console.warn(`\nseo-check: ${avisos.length} aviso(s)`);
    avisos.forEach((a) => console.warn(`  ! ${a}`));
  }

  if (falhas.length) {
    console.error(`\nseo-check: ${falhas.length} FALHA(S)\n`);
    falhas.forEach((f) => console.error(`  x ${f}`));
    console.error('\nO build foi interrompido. Corrigir antes de publicar.\n');
    process.exit(1);
  }

  console.log(`\nseo-check: ${rotas.length} rotas verificadas, tudo conforme.`);
}

main().catch((err) => {
  console.error('seo-check: erro inesperado —', err.message);
  process.exit(1);
});
