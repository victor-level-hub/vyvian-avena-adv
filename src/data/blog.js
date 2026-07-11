import { marked } from "marked";

/**
 * Carrega os artigos de src/content/blog/*.md no build (Vite glob, funciona no
 * cliente e no bundle SSR do prerender). O slug e' o nome do ficheiro.
 *
 * Frontmatter minimo entre --- ---:
 *   titulo, descricao (para as metas), data (YYYY-MM-DD), revisto_em,
 *   validade (estavel|perecivel), area (slug de /areas/{slug}, opcional)
 *
 * Regras de conteudo (opcao B, acordada com a Dra. Vyvian):
 * sem prazos, sem valores, sem listas de documentos; onde o tema tocar num
 * ponto que a lei possa mudar, o artigo remete para consulta (blockquote,
 * que o CSS apresenta como caixa de aviso).
 */
const RAW = import.meta.glob("../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

function readingTime(text) {
  const words = text.replace(/[#>*_`\-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const POSTS = Object.entries(RAW)
  .map(([path, raw]) => {
    const slug = path.split("/").pop().replace(/\.md$/, "");
    const { meta, body } = parseFrontmatter(raw);
    return {
      slug,
      titulo: meta.titulo || slug,
      descricao: meta.descricao || "",
      data: meta.data || "",
      revisto_em: meta.revisto_em || meta.data || "",
      validade: meta.validade || "estavel",
      area: meta.area || "",
      imagem: meta.imagem || "",
      imagem_alt: meta.imagem_alt || "",
      minutos: readingTime(body),
      html: marked.parse(body),
      texto: body,
    };
  })
  .sort((a, b) => (a.data < b.data ? 1 : -1));

export const getPost = (slug) => POSTS.find((p) => p.slug === slug);
