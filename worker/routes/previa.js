// worker/routes/previa.js — pré-visualização PÚBLICA de um artigo em rascunho.
//
//   GET /pre-visual-artigo?id=N&t=TOKEN   -> página standalone com o artigo
//
// O link é partilhável (WhatsApp da Dra.) sem login: o acesso é guardado por um
// token derivado de SHA-256(`previa:${id}:${JWT_SECRET}`) — quem não tem o link
// exato não abre nada. A página replica o visual do artigo no blogue público
// (claro, Fraunces/Mulish, hero verde-floresta) num HTML autocontido; as imagens
// do corpo e a capa usam /api/insights/images/:id, que já é público (serve <img>).
// noindex/nofollow: nunca entra nos motores de busca.
import { marked } from "marked";
import { jsonError } from "../lib/response.js";

export async function tokenPrevia(env, id) {
  const dados = new TextEncoder().encode(`previa:${id}:${env.JWT_SECRET || ""}`);
  const hash = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

const AREAS_LABEL = {
  familia: "Direito de Família", civil: "Direito Civil", comercial: "Direito Comercial",
  cobranca: "Cobrança de Dívida", nacionalidade: "Nacionalidade", notarial: "Direito Notarial",
};

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const minutosLeitura = (md) => Math.max(1, Math.round((md || "").split(/\s+/).length / 180));

export async function handlePreviaArtigo(request, env) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get("id") || "", 10);
  const t = url.searchParams.get("t") || "";
  if (!id || !t || t !== (await tokenPrevia(env, id))) {
    return new Response("Pré-visualização não encontrada.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const a = await env.DB.prepare(`SELECT * FROM insight_articles WHERE id = ?`).bind(id).first();
  if (!a) return jsonError("Artigo não encontrado", 404);

  // mesma limpeza da pré-visualização interna (tags de citação da pesquisa web)
  const md = String(a.markdown || "").replace(/<\/?(?:cite|ref|citation|source)\b[^>]*>/gi, "");
  const corpo = marked.parse(md);
  const areaLabel = AREAS_LABEL[a.area] || "";
  const dataTxt = new Date().toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
  const capa = a.imagem_escolhida ? `/api/insights/images/${a.imagem_escolhida}` : null;

  const html = `<!doctype html>
<html lang="${a.idioma === "pt-BR" ? "pt-BR" : "pt-PT"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Prévia · ${esc(a.titulo)}</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  :root { --forest:#12302a; --gold:#b8935a; --gold-deep:#8e6f3f; --paper:#faf8f4; --ink:#2a2520; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--paper); color:var(--ink); font-family:Mulish,-apple-system,sans-serif; line-height:1.7; font-weight:300; }
  .previa-tag { position:fixed; top:14px; right:14px; z-index:50; background:var(--gold); color:#fff; font-size:11px;
    letter-spacing:.14em; text-transform:uppercase; font-weight:800; padding:7px 14px; border-radius:999px; box-shadow:0 6px 18px rgba(18,48,42,.25); }
  .hero { position:relative; min-height:480px; background:var(--forest); display:flex; align-items:flex-end; }
  .hero img.capa { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.38; }
  .hero .veu { position:absolute; inset:0; background:linear-gradient(to top,#12302a 4%,rgba(18,48,42,.55) 45%,rgba(18,48,42,.25)); }
  .hero .conteudo { position:relative; width:100%; max-width:1152px; margin:0 auto; padding:160px 24px 64px; }
  .hero .risco { height:1px; width:48px; background:var(--gold); margin-bottom:24px; }
  .hero .meta { font-size:12px; letter-spacing:.15em; text-transform:uppercase; color:var(--gold); margin-bottom:20px; }
  .hero h1 { font-family:Fraunces,Georgia,serif; font-weight:400; font-size:clamp(30px,5vw,52px); line-height:1.12; color:#faf6ee; max-width:880px; }
  main { max-width:760px; margin:0 auto; padding:56px 24px 40px; }
  .descricao { font-size:15px; color:rgba(18,48,42,.6); border-left:2px solid var(--gold); padding-left:14px; margin-bottom:36px; line-height:1.7; }
  .prosa { font-size:16.5px; }
  .prosa h2 { font-family:Fraunces,Georgia,serif; font-weight:500; font-size:27px; color:var(--forest); margin:44px 0 14px; line-height:1.25; }
  .prosa h3 { font-family:Fraunces,Georgia,serif; font-weight:500; font-size:21px; color:var(--forest); margin:32px 0 10px; }
  .prosa p { margin:0 0 18px; }
  .prosa a { color:var(--gold-deep); }
  .prosa strong { font-weight:700; color:var(--forest); }
  .prosa ul, .prosa ol { margin:0 0 18px 22px; }
  .prosa li { margin-bottom:8px; }
  .prosa img { max-width:100%; height:auto; display:block; margin:28px 0; }
  .prosa blockquote { border-left:3px solid var(--gold); background:rgba(184,147,90,.08); padding:14px 18px; margin:28px 0; font-size:14.5px; color:rgba(42,37,32,.75); }
  .prosa blockquote p { margin:0; }
  .prosa hr { border:0; height:1px; background:rgba(18,48,42,.12); margin:36px 0; }
  .assina { max-width:760px; margin:0 auto; padding:0 24px 80px; border-top:0; }
  .assina .risco { height:1px; width:32px; background:var(--gold); margin:8px 0 18px; }
  .assina .nome { font-family:Fraunces,Georgia,serif; font-size:17px; color:var(--forest); }
  .assina .sub { font-size:12.5px; color:rgba(18,48,42,.45); }
</style>
</head>
<body>
  <span class="previa-tag">Pré-visualização</span>
  <section class="hero">
    ${capa ? `<img class="capa" src="${capa}" alt="">` : ""}
    <div class="veu"></div>
    <div class="conteudo">
      <div class="risco"></div>
      <div class="meta">${areaLabel ? `${esc(areaLabel)} · ` : ""}${esc(dataTxt)} · ${minutosLeitura(md)} min de leitura</div>
      <h1>${esc(a.titulo)}</h1>
    </div>
  </section>
  <main>
    ${a.descricao ? `<p class="descricao">${esc(a.descricao)}</p>` : ""}
    <article class="prosa">${corpo}</article>
  </main>
  <div class="assina">
    <div class="risco"></div>
    <div class="nome">Dra. Vyvian Avena</div>
    <div class="sub">Advogada · Portugal e Brasil — pré-visualização interna, ainda não publicado</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
