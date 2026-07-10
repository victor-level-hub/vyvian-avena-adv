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
import { readFile } from 'node:fs/promises';
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

/** Todas as rotas publicas indexaveis: estaticas + uma por area de atuacao. */
export async function getAllRoutes() {
  const slugs = await getAreaSlugs();
  return [
    ...STATIC_ROUTES,
    ...slugs.map((slug) => ({
      path: `/areas/${slug}`,
      priority: '0.8',
      changefreq: 'monthly',
    })),
  ];
}

/**
 * Rotas a prerenderizar. Inclui a /404, que tem de existir como HTML estatico para
 * o Worker a poder servir com codigo 404 — mas nunca entra no sitemap.
 */
export async function getPrerenderRoutes() {
  const rotas = await getAllRoutes();
  return [...rotas.map((r) => r.path), '/404'];
}
