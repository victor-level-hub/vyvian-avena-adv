import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import Seo from "../components/Seo";
import { breadcrumbJsonLd } from "../components/Breadcrumbs";
import NaoEncontrado from "./NaoEncontrado";
import { POSTS, getPost } from "../data/blog";
import { getArea } from "../data/areas";
import blogConfig from "../config/blog.json";

const SITE = "https://vyavenaadv.com";

const fmtData = (iso) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : "";

const articleJsonLd = (post) => ({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: post.titulo,
  description: post.descricao,
  datePublished: post.data,
  dateModified: post.revisto_em || post.data,
  inLanguage: "pt-PT",
  image: post.imagem ? `${SITE}${post.imagem}` : undefined,
  url: `${SITE}/blog/${post.slug}`,
  author: { "@type": "Person", name: "Vyvian Avena", jobTitle: "Advogada" },
  publisher: { "@type": "LegalService", name: "Vyvian Avena Advogada", url: `${SITE}/` },
});

/** Barra de progresso de leitura: 2px dourada, fixa no topo. Client-only por
 *  natureza (scroll); no SSR renderiza a 0% — invisível, sem impacto no HTML. */
function ProgressoLeitura() {
  const barRef = useRef(null);
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      if (barRef.current) barRef.current.style.width = `${max > 0 ? (el.scrollTop / max) * 100 : 0}%`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div aria-hidden="true" className="fixed top-0 left-0 right-0 h-[2px] z-[60] pointer-events-none">
      <div ref={barRef} className="h-full bg-gold" style={{ width: "0%" }} />
    </div>
  );
}

/**
 * Página de artigo — design "editorial moderno" (handoff Claude Design v2):
 * hero full-bleed com imagem escurecida, rail lateral sticky (sumário + autora),
 * prosa com drop cap e réguas por secção, CTA contextual por área.
 */
export default function BlogArtigo() {
  const { slug } = useParams();
  const post = getPost(slug);

  if (!post) return <NaoEncontrado />;

  const crumbs = [
    { name: "Início", path: "/" },
    { name: "Blogue", path: "/blog" },
    { name: post.titulo, path: `/blog/${post.slug}` },
  ];
  const area = post.area ? getArea(post.area) : null;
  const outros = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="bg-warmwhite">
      <Seo
        path={`/blog/${post.slug}`}
        title={post.titulo}
        desc={post.descricao}
        noindex={!blogConfig.publicado}
        image={post.imagem || undefined}
        jsonLd={[articleJsonLd(post), breadcrumbJsonLd(crumbs)]}
      />
      <ProgressoLeitura />

      {/* Hero full-bleed */}
      <section className="relative min-h-[480px] md:min-h-[560px] bg-forest flex items-end">
        {post.imagem && (
          <img src={post.imagem} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.38]" />
        )}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, #12302a 4%, rgba(18,48,42,0.55) 45%, rgba(18,48,42,0.25))" }}
        />
        <div className="relative w-full max-w-[1152px] mx-auto px-6 md:px-12 pt-40 pb-14 md:pb-[72px]">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 font-body text-[13px] text-warmwhite/70 hover:text-warmwhite transition-colors duration-300 mb-7"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Blogue
          </Link>
          <div className="h-px w-12 bg-gold mb-6" />
          <div className="font-body text-xs tracking-[0.15em] uppercase text-gold mb-5">
            {area ? `${area.title} · ` : ""}{fmtData(post.data)} · {post.minutos} min de leitura
          </div>
          <h1 className="font-heading font-normal text-3xl md:text-[52px] leading-[1.12] text-warmwhite max-w-[880px]">
            {post.titulo}
          </h1>
        </div>
      </section>

      {/* Corpo: rail + prosa */}
      <div className="max-w-[1152px] mx-auto px-6 md:px-12 pt-14 md:pt-20 pb-6 grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
        <aside className="hidden lg:block sticky top-[120px] self-start">
          <div className="font-body text-xs tracking-[0.15em] uppercase text-forest/40 mb-3">Neste artigo</div>
          <p className="font-body text-[13.5px] leading-[1.7] text-forest/60">{post.descricao}</p>
          <div className="h-px w-8 bg-gold my-6" />
          <div className="font-body text-xs tracking-[0.15em] uppercase text-forest/40 mb-2">Escrito por</div>
          <div className="font-heading text-[17px] text-forest">Dra. Vyvian Avena</div>
          <div className="font-body text-[12.5px] text-forest/40">Advogada · Portugal e Brasil</div>
        </aside>

        <article className="blog-prose max-w-[680px]" dangerouslySetInnerHTML={{ __html: post.html }} />
      </div>

      {/* CTA contextual */}
      <div className="max-w-[1152px] mx-auto px-6 md:px-12 pb-2 grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
        <div className="hidden lg:block" />
        <div className="bg-forest px-8 py-9 md:px-11 md:py-10 max-w-[680px]">
          <h2 className="font-heading font-normal text-2xl text-warmwhite mb-2.5">
            {area ? `Precisa de apoio em ${area.title}?` : "Este tema toca a sua situação?"}
          </h2>
          <p className="font-body text-sm text-warmwhite/60 mb-7 leading-relaxed">
            {area ? area.desc : "Descreva-nos o seu caso e ajudamos a identificar o enquadramento certo."}
          </p>
          <div className="flex flex-wrap gap-3">
            {area && (
              <Link
                to={`/areas/${area.slug}`}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-gold text-warmwhite text-sm font-body tracking-wide hover:bg-[#a07d4a] transition-all duration-300"
              >
                Ver {area.title}
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            <Link
              to="/contacto"
              className="inline-flex items-center gap-2 px-6 py-2.5 border border-gold text-gold text-sm font-body tracking-wide hover:bg-gold hover:text-warmwhite transition-all duration-300"
            >
              Agendar Consulta
            </Link>
          </div>
        </div>
      </div>

      {/* Continuar a ler */}
      {outros.length > 0 && (
        <section className="max-w-[1152px] mx-auto px-6 md:px-12 pt-12 pb-24 md:pb-[104px]">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-heading font-normal text-[26px] md:text-[28px] text-forest">Continuar a ler</h2>
            <Link
              to="/blog"
              className="inline-flex items-center gap-1.5 font-body text-sm text-gold hover:text-forest transition-colors duration-300"
            >
              Todos os artigos
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {outros.map((p) => (
            <Link
              key={p.slug}
              to={`/blog/${p.slug}`}
              className="group grid grid-cols-[112px_1fr] md:grid-cols-[160px_1fr_auto] gap-4 md:gap-8 items-center py-6 border-t border-border"
            >
              <div className="overflow-hidden aspect-[1200/630]">
                <img
                  src={p.imagem}
                  alt={p.imagem_alt || ""}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
                />
              </div>
              <div>
                <div className="font-body text-xs tracking-[0.15em] uppercase text-gold mb-1.5">
                  {p.area ? `${getArea(p.area)?.title ?? "Blogue"} · ` : ""}{p.minutos} min
                </div>
                <h3 className="font-heading font-normal text-lg md:text-[21px] leading-snug text-forest transition-colors duration-300 group-hover:text-gold">
                  {p.titulo}
                </h3>
              </div>
              <ArrowRight className="hidden md:block w-[18px] h-[18px] text-gold transition-transform duration-300 group-hover:translate-x-2" />
            </Link>
          ))}
          <div className="border-t border-border" />
        </section>
      )}
    </div>
  );
}
