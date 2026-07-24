#!/usr/bin/env node
/**
 * scripts/inline-css.mjs
 *
 * Inline do CSS público em cada HTML gerado (dist/**\/*.html).
 *
 * Porquê: o <link rel="stylesheet"> do bundle era o último recurso a bloquear
 * o render (~660 ms no 4G da auditoria PageSpeed). Como o CSS do site é
 * pequeno (~28 KB raw / ~6 KB gzip), inline de TODO o CSS é mais simples e
 * mais eficaz do que extrair "critical CSS": elimina um round-trip inteiro
 * do caminho crítico e nunca causa FOUC.
 *
 * O ficheiro .css continua em dist/assets (o chunk do admin importa o dele
 * próprio; nada mais referencia o público). Corre DEPOIS do prerender.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const assets = await readdir(join(DIST, 'assets'));
const cssFile = assets.find((f) => /^index-.*\.css$/.test(f));
if (!cssFile) {
  console.warn('inline-css: bundle CSS não encontrado — saltado.');
  process.exit(0);
}
const css = await readFile(join(DIST, 'assets', cssFile), 'utf-8');

const LINK_RE = new RegExp(
  `<link[^>]*rel="stylesheet"[^>]*href="/assets/${cssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`
);

let n = 0;
for (const file of await htmlFiles(DIST)) {
  const html = await readFile(file, 'utf-8');
  if (!LINK_RE.test(html)) continue;
  await writeFile(file, html.replace(LINK_RE, `<style>${css}</style>`));
  n++;
}
console.log(`inline-css: ${cssFile} inline em ${n} página(s)`);
