/**
 * Publica artigos do Insights no blogue (corre no GitHub Actions).
 *   node scripts/publicar-artigos.mjs preparar   — lê a fila do Worker, escreve
 *     src/content/blog/<slug>.md + imagens em public/blog/, e .publicados.json
 *   node scripts/publicar-artigos.mjs confirmar  — após o deploy, confirma no Worker
 * Env: PUBLISH_KEY (obrigatória), WORKER_URL (default https://vyavenaadv.com)
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.WORKER_URL || "https://vyavenaadv.com";
const KEY = process.env.PUBLISH_KEY;
const modo = process.argv[2] || "preparar";
if (!KEY) { console.error("PUBLISH_KEY em falta"); process.exit(1); }

const saida = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

if (modo === "confirmar") {
  const lista = JSON.parse(readFileSync(join(RAIZ, ".publicados.json"), "utf-8"));
  for (const a of lista) {
    const r = await fetch(`${BASE}/api/insights/articles/${a.id}/publicado?key=${encodeURIComponent(KEY)}`, { method: "POST" });
    console.log(`confirmado #${a.id} (${a.slug}): ${r.status}`);
  }
  process.exit(0);
}

const r = await fetch(`${BASE}/api/insights/fila-publicacao?key=${encodeURIComponent(KEY)}`);
if (!r.ok) { console.error("fila:", r.status, await r.text()); process.exit(1); }
const { artigos } = await r.json();
console.log(`fila: ${artigos.length} artigo(s)`);
saida("total", String(artigos.length));
if (!artigos.length) { writeFileSync(join(RAIZ, ".publicados.json"), "[]"); process.exit(0); }

const baixar = async (id, destino) => {
  const res = await fetch(`${BASE}/api/insights/images/${id}`);
  if (!res.ok) throw new Error(`imagem ${id}: ${res.status}`);
  writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
};

mkdirSync(join(RAIZ, "public", "blog"), { recursive: true });
for (const a of artigos) {
  // capa -> /blog/<slug>.jpg
  await baixar(a.capa_image_id, join(RAIZ, "public", "blog", `${a.slug}.jpg`));
  // variantes responsivas da capa (o seo-check exige -480/-800/-1200.webp)
  try {
    const { default: sharp } = await import("sharp");
    for (const w of [480, 800, 1200]) {
      await sharp(join(RAIZ, "public", "blog", `${a.slug}.jpg`)).resize(w).webp({ quality: 78 })
        .toFile(join(RAIZ, "public", "blog", `${a.slug}-${w}.webp`));
    }
  } catch (e) { console.error("AVISO: variantes webp falharam:", e.message); }
  // fotos do corpo -> /blog/<slug>-corpo-N.jpg, reescritas no markdown como <img>
  let md = a.markdown;
  a.body_image_ids.forEach((id, i) => {
    const nome = `${a.slug}-corpo-${i + 1}.jpg`;
    const re = new RegExp(`!\\[([^\\]]*)\\]\\(/api/insights/images/${id}\\)`, "g");
    md = md.replace(re, (_, alt) =>
      `\n\n<img src="/blog/${nome}" alt="${(alt || a.titulo).replace(/"/g, "'")}" width="1376" height="768" loading="lazy" />\n\n`);
  });
  for (let i = 0; i < a.body_image_ids.length; i++) {
    await baixar(a.body_image_ids[i], join(RAIZ, "public", "blog", `${a.slug}-corpo-${i + 1}.jpg`));
  }
  md = md.replace(/\n{3,}/g, "\n\n"); // blocos sempre separados por linha em branco única
  const hoje = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `titulo: ${a.titulo}`,
    `descricao: ${a.descricao}`,
    `data: ${hoje}`,
    `revisto_em: ${a.revisto_em || hoje}`,
    "validade: perecivel",
    `imagem: /blog/${a.slug}.jpg`,
    `imagem_alt: ${a.titulo}`,
    `area: ${a.area || "nacionalidade"}`,
    "audio: sim",
    "---",
  ].join("\n");
  const alvo = join(RAIZ, "src", "content", "blog", `${a.slug}.md`);
  if (existsSync(alvo)) console.warn(`AVISO: ${a.slug}.md já existia — será substituído`);
  writeFileSync(alvo, `${fm}\n\n${md.trim()}\n`);
  console.log(`preparado: ${a.slug}`);
}
writeFileSync(join(RAIZ, ".publicados.json"), JSON.stringify(artigos.map(({ id, slug }) => ({ id, slug })), null, 2));
