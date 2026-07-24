#!/usr/bin/env node
/**
 * scripts/routes.mjs
 *
 * Fonte unica das rotas publicas. Consumida pelo prerender e pelo gerador de sitemap,
 * para que nunca fiquem dessincronizados: acrescentar uma area em src/data/areas.js
 * passa a bastar para ela aparecer no sitemap e no HTML estatico.
 *
 * Os slugs vivem em src/data/area-slugs.json porque src/data/areas.js importa icones
 * do lucide-react, que nao resolvem num script Node puro. areas.js exporta AREA_SLUGS
 * e o build valida que as duas listas coincidem.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Rotas estaticas, com a prioridade que declaram no sitemap. */
export const STATIC_ROUTES = [
  { path: '/', priority: '1.0', changefreq: 'monthly' },
  { path: '/sobre', priority: '0.8', changefreq: 'monthly' },
  { path: '/areas', priority: '0.9', changefreq: 'monthly' },
  { path: '/apoio', priority: '0.7', changefreq: 'monthly' },
  { path: '/contacto', priority: '0.8', changefreq: 'monthly' },
  { path: '/politica-cookies', priority: '0.3', changefreq: 'yearly' },
];

export async function getAreaSlugs() {
  const raw = await readFile(join(__dirname, '..', 'src', 'data', 'area-slugs.json'), 'utf-8');
  return JSON.parse(raw);
}

/** Slugs do blogue = nomes dos ficheiros em src/content/blog. */
export async function getBlogSlugs() {
  try {
    const files = await readdir(join(__dirname, '..', 'src', 'content', 'blog'));
    return files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

async function blogPublicado() {
  try {
    const raw = await readFile(join(__dirname, '..', 'src', 'config', 'blog.json'), 'utf-8');
    return JSON.parse(raw).publicado === true;
  } catch {
    return false;
  }
}

/**
 * Rotas publicas INDEXAVEIS — e' isto que vai para o sitemap.
 * O blogue so' entra quando src/config/blog.json tiver publicado=true
 * (conteudo juridico so' e' indexavel depois de validado pela Dra. Vyvian).
 */
export async function getAllRoutes() {
  const slugs = await getAreaSlugs();
  const rotas = [
    ...STATIC_ROUTES,
    ...slugs.map((slug) => ({
      path: `/areas/${slug}`,
      priority: '0.8',
      changefreq: 'monthly',
    })),
  ];
  if (await blogPublicado()) {
    const posts = await getBlogSlugs();
    rotas.push({ path: '/blog', priority: '0.7', changefreq: 'weekly' });
    rotas.push(...posts.map((slug) => ({ path: `/blog/${slug}`, priority: '0.6', changefreq: 'monthly' })));
  }
  return rotas;
}

/**
 * Rotas VALIDAS — e' isto que o Worker usa para distinguir 404 de pagina real.
 * Inclui o blogue SEMPRE (mesmo em revisao, os URLs tem de servir 200 para a
 * Dra. Vyvian rever), independentemente de estarem ou nao no sitemap.
 */
export async function getValidRoutes() {
  const base = (await getAllRoutes()).map((r) => r.path);
  const extras = [];
  if (!base.includes('/blog')) {
    extras.push('/blog');
    extras.push(...(await getBlogSlugs()).map((s) => `/blog/${s}`));
  }
  return [...base, ...extras];
}

/**
 * Rotas a prerenderizar: as validas + /404, que tem de existir como HTML
 * estatico para o Worker a poder servir com codigo 404 — mas nunca no sitemap.
 */
export async function getPrerenderRoutes() {
  return [...(await getValidRoutes()), '/404'];
}
