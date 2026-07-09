#!/usr/bin/env node
/**
 * scripts/prerender.mjs
 *
 * Corre depois do `vite build`. Serve a pasta dist/, visita cada rota pública
 * com um Chrome headless, e grava o HTML já renderizado em dist/<rota>/index.html.
 *
 * Porquê: o site é uma SPA. Sem isto, os crawlers (Bing, bots de IA, pré-visualizações
 * de partilha) recebem um index.html vazio, sem <h1> nem conteúdo. As rotas /admin e
 * /upload ficam de fora — não devem ser indexadas.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// O puppeteer pode nao estar disponivel (ex.: CI sem Chrome). Nesse caso o
// prerender e' saltado e o build continua — o site publica sem HTML estatico.
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.warn('prerender: puppeteer indisponivel — build continua sem prerender.');
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = 4178;

const ROUTES = ['/', '/sobre', '/areas', '/apoio', '/contacto', '/politica-cookies'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

// Servidor estático mínimo com fallback SPA.
function serveDist() {
  return createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = join(DIST, urlPath);

    if (!extname(filePath) || !existsSync(filePath)) {
      filePath = join(DIST, 'index.html'); // fallback SPA
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

async function main() {
  const server = serveDist();
  await new Promise((r) => server.listen(PORT, r));

  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  // Permite apontar para um Chrome ja instalado (CHROME_PATH / PUPPETEER_EXECUTABLE_PATH).
  const sysChrome = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (sysChrome) launchOpts.executablePath = sysChrome;

  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (err) {
    console.warn(`prerender: nao foi possivel lancar o Chrome (${err.message.split('\n')[0]}).`);
    console.warn('prerender: saltado. O build continua e o site publica sem HTML estatico.');
    server.close();
    process.exit(0);
  }

  let failures = 0;

  for (const route of ROUTES) {
    const page = await browser.newPage();
    try {
      await page.goto(`http://localhost:${PORT}${route}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      // Garantir que o React montou e o Helmet já escreveu o <title>.
      await page.waitForSelector('#root > *', { timeout: 15000 });

      // ScrollReveal usa IntersectionObserver: forçar visibilidade de tudo,
      // caso contrário o HTML gravado fica com o conteúdo em opacity:0.
      await page.evaluate(() => {
        document.querySelectorAll('[style*="opacity"]').forEach((el) => {
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
      });

      const html = await page.content();

      if (!/<h1[\s>]/i.test(html)) {
        console.warn(`  aviso: ${route} não tem <h1> no HTML gerado`);
      }

      const outDir = route === '/' ? DIST : join(DIST, route);
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.html'), html, 'utf-8');
      console.log(`  ok  ${route.padEnd(20)} ${(html.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      failures++;
      console.error(`  ERRO ${route}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.close();

  if (failures) {
    // Nao rebentar o deploy: e' preferivel publicar sem prerender do que nao publicar.
    console.warn(`\nprerender: ${failures} rota(s) falharam; as restantes foram geradas.`);
  } else {
    console.log(`\nprerender: ${ROUTES.length} rotas geradas`);
  }
}

main().catch((err) => {
  console.warn('prerender: erro inesperado —', err.message);
  console.warn('prerender: saltado. O build continua.');
  process.exit(0);
});
