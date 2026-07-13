/**
 * Imagens responsivas das capas do blogue.
 *
 * As capas vivem em public/blog/{slug}.jpg (1200x630, também usadas como
 * og:image — o WhatsApp/Facebook não aceitam WebP de forma fiável, por isso
 * o JPG continua a ser a fonte de verdade e o fallback do <img src>).
 * Para o browser existem variantes WebP geradas em 480/800/1200 px
 * (sharp, quality 78) — ~85% mais leves que o JPG original.
 *
 * Se adicionares uma capa nova, gera as variantes com:
 *   npx sharp-cli ... ou o snippet em docs/otimizacao-performance.md
 */
export function capaSrcSet(imagem) {
  if (!imagem || !imagem.endsWith(".jpg")) return undefined;
  const base = imagem.replace(/\.jpg$/, "");
  return `${base}-480.webp 480w, ${base}-800.webp 800w, ${base}-1200.webp 1200w`;
}
