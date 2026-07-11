#!/usr/bin/env node
/**
 * scripts/sitemap.mjs
 *
 * Gera dist/sitemap.xml a partir da lista de rotas em scripts/routes.mjs.
 * Substitui o sitemap estatico em public/, que tinha de ser editado a mao sempre
 * que uma rota era acrescentada — e por isso ficava desactualizado.
 *
 * As URLs nao levam barra final: e' assim que o Cloudflare as serve
 * (o prerender escreve areas/familia.html, nao areas/familia/index.html)
 * e e' o que os canonicals declaram.
 */
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllRoutes, getValidRoutes } from './routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://vyavenaadv.com';

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  const routes = await getAllRoutes();
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = routes
    .map(({ path, priority, changefreq }) => {
      const loc = path === '/' ? `${SITE}/` : `${SITE}${path}`;
      return [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  const out = join(__dirname, '..', 'dist', 'sitemap.xml');
  await writeFile(out, xml, 'utf-8');
  console.log(`  sitemap: ${routes.length} URLs`);

  // O Worker usa esta lista para devolver 404 real em rotas publicas inexistentes.
  // Nota: e' a lista de rotas VALIDAS, nao a de indexaveis — o blogue em revisao
  // (fora do sitemap) tem de servir 200 na mesma, senao ninguem o consegue rever.
  const validas = await getValidRoutes();
  const rotasJs = `// Gerado por scripts/sitemap.mjs. Nao editar a mao.\nexport const ROTAS_PUBLICAS = ${JSON.stringify(validas)};\n`;
  await writeFile(join(__dirname, '..', 'worker', 'rotas-publicas.js'), rotasJs, 'utf-8');
  console.log(`  rotas-publicas.js: ${validas.length} rotas validas`);
}

main().catch((err) => {
  console.warn('sitemap: falhou —', err.message);
  console.warn('sitemap: o build continua com o sitemap anterior, se existir.');
});
