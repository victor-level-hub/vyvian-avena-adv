#!/usr/bin/env node
/**
 * scripts/prerender.mjs
 *
 * Gera HTML estatico das rotas publicas com react-dom/server. Nao usa browser:
 * o Puppeteer nao arranca no CI do Cloudflare (faltam libs de sistema do GTK,
 * libatk-1.0.so.0), e depender de um Chrome headless num container de build e' fragil.
 *
 * Corre depois de:
 *   1) vite build            -> dist/ (cliente)
 *   2) vite build --ssr      -> dist-ssr/entry-server.js
 *
 * As rotas /admin e /upload ficam de fora — nao devem ser indexadas.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPrerenderRoutes } from './routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SSR_ENTRY = join(ROOT, 'dist-ssr', 'entry-server.js');

// Rotas vindas de scripts/routes.mjs — a mesma lista que alimenta o sitemap,
// para que nunca haja uma rota prerenderizada que falte no sitemap, ou vice-versa.

async function main() {
  const ROUTES = await getPrerenderRoutes();

  if (!existsSync(SSR_ENTRY)) {
    console.warn('prerender: bundle SSR ausente — saltado, o build continua.');
    return;
  }

  const { render } = await import(pathToFileURL(SSR_ENTRY).href);
  const template = await readFile(join(DIST, 'index.html'), 'utf-8');

  let failures = 0;

  for (const route of ROUTES) {
    try {
      const { html, head } = render(route);

      let page = template.replace(
        '<div id="root"></div>',
        `<div id="root">${html}</div>`
      );

      // Injectar as meta tags do Helmet imediatamente antes de </head>.
      page = page.replace('</head>', `    ${head}\n  </head>`);

      // Preload do LCP: o hero so' existe na Home — inutil (e nocivo) nas outras.
      if (route === '/') {
        page = page.replace(
          '</head>',
          `    <link rel="preload" as="image" href="/hero-escritorio.webp" fetchpriority="high" />\n  </head>`
        );
      }

      // O <title> de fallback do template ficaria duplicado com o do Helmet.
      if (/<title[^>]*data-rh/i.test(head)) {
        page = page.replace(/<title>(?!.*data-rh)[^<]*<\/title>\s*/i, '');
      }

      if (!/<h1[\s>]/i.test(page)) {
        console.warn(`  aviso: ${route} sem <h1> no HTML gerado`);
      }

      // Escrever como ficheiro individual (areas.html), nao como pasta (areas/index.html).
      // Com html_handling=auto-trailing-slash (o default), o Cloudflare serve um ficheiro
      // individual em /areas, mas um index de pasta em /areas/ — e redireccionaria /areas
      // com um 307. O sitemap e os canonicals declaram URLs sem barra final.
      const outPath =
        route === '/' ? join(DIST, 'index.html') : join(DIST, `${route.slice(1)}.html`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, page, 'utf-8');
      console.log(`  ok  ${route.padEnd(20)} ${(page.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      failures++;
      console.error(`  ERRO ${route}: ${err.message}`);
    }
  }

  if (failures) {
    // Publicar sem prerender e' preferivel a nao publicar.
    console.warn(`\nprerender: ${failures} rota(s) falharam; as restantes foram geradas.`);
  } else {
    console.log(`\nprerender: ${ROUTES.length} rotas geradas`);
  }
}

main().catch((err) => {
  console.warn('prerender: erro inesperado —', err.message);
  console.warn('prerender: saltado. O build continua.');
});
