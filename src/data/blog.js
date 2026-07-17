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
  // \r?\n: tolera terminações Windows (CRLF) e Unix (LF)
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
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

// Desempate quando as datas coincidem — ordem editorial do handoff v2
// (o destaque do indice e' o primeiro desta lista).
const ORDEM = [
  "heranca-portugal-brasil-mapa-das-decisoes",
  "divorcio-portugal-brasil-porque-se-complica",
  "direito-portugues-e-brasileiro-numa-partilha",
  "responsabilidades-parentais-pais-em-paises-diferentes",
  "o-que-perguntar-a-um-advogado-antes-de-contratar",
];
const pos = (slug) => { const i = ORDEM.indexOf(slug); return i === -1 ? 99 : i; };

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
  .sort((a, b) => (a.data !== b.data ? (a.data < b.data ? 1 : -1) : pos(a.slug) - pos(b.slug)));

export const getPost = (slug) => POSTS.find((p) => p.slug === slug);
