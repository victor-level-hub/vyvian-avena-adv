import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
import { POSTS } from "../data/blog";
import { getArea } from "../data/areas";
import { capaSrcSet } from "../lib/imagens";
import blogConfig from "../config/blog.json";

const fmtData = (iso) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : "";

const areaTitle = (slug) => (slug ? (getArea(slug)?.title ?? "") : "");

/**
 * Índice do blogue — design "editorial moderno" (handoff Claude Design v2,
 * reimplementado nos tokens do site): artigo destacado em split-card, restantes
 * em lista numerada com numerais fantasma, CTA de fecho em painel forest.
 * A mecânica de revisão mantém-se: noindex/fora do sitemap até blog.json
 * ter publicado=true.
 */
export default function Blog() {
  const crumbs = [
    { name: "Início", path: "/" },
    { name: "Blogue", path: "/blog" },
  ];
  const [destaque, ...resto] = POSTS;

  return (
    <div className="bg-warmwhite">
      <Seo path="/blog" noindex={!blogConfig.publicado} jsonLd={breadcrumbJsonLd(crumbs)} />

      <div className="max-w-[1152px] mx-auto px-6 md:px-12">
        {/* Header editorial: título à esquerda, lead à direita */}
        <header className="pt-32 md:pt-40 pb-12 grid md:grid-cols-2 items-end gap-6 md:gap-12">
          <ScrollReveal>
            <Breadcrumbs items={crumbs} className="mb-6" />
            <div className="h-px w-12 bg-gold mb-7" />
            <h1 className="font-heading font-normal text-5xl md:text-[76px] leading-none text-forest">Blogue</h1>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <p className="font-body text-[17px] leading-[1.7] text-forest/60 md:text-right md:ml-auto md:max-w-[440px]">
              Os problemas jurídicos de quem vive entre Portugal e o Brasil — explicados pela
              estrutura, sem juridiquês.
            </p>
          </ScrollReveal>
        </header>

        {/* Artigo destacado */}
        {destaque && (
          <ScrollReveal>
            <Link
              to={`/blog/${destaque.slug}`}
              className="group grid md:grid-cols-[1fr_1.15fr] border border-border bg-warmwhite overflow-hidden"
            >
              <div className="flex flex-col p-8 md:p-14 md:pb-12 order-2 md:order-1">
                <div className="flex items-baseline gap-4 mb-7">
                  <span aria-hidden="true" className="font-heading text-[64px] leading-none text-forest/10 select-none">01</span>
                  <span className="font-body text-xs tracking-[0.15em] uppercase text-gold">
                    {areaTitle(destaque.area) || "Blogue"} · {destaque.minutos} min
                  </span>
                </div>
                <h2 className="font-heading font-normal text-2xl md:text-4xl leading-[1.2] text-forest mb-4 transition-colors duration-300 group-hover:text-gold">
                  {destaque.titulo}
                </h2>
                <p className="font-body text-[15px] leading-[1.7] text-forest/60 flex-1">{destaque.descricao}</p>
                <span className="inline-flex items-center gap-2 mt-8 text-sm tracking-[0.05em] text-gold font-body">
                  Ler artigo
                  <ArrowRight className="w-[15px] h-[15px] transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </div>
              {/* A foto do destaque mostra-se por inteiro (object-contain no desktop),
                  centrada na coluna — sem o recorte que a "quebrava". */}
              <div className="overflow-hidden order-1 md:order-2 aspect-[1200/630] md:aspect-auto md:flex md:items-center">
                <img
                  src={destaque.imagem}
                  srcSet={capaSrcSet(destaque.imagem)}
                  sizes="(min-width: 768px) 50vw, 100vw"
                  width="1200"
                  height="630"
                  fetchpriority="high"
                  alt={destaque.imagem_alt || ""}
                  className="w-full h-full object-cover md:h-auto md:object-contain transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
                />
              </div>
            </Link>
          </ScrollReveal>
        )}

        {/* Lista editorial numerada */}
        <section className="pt-16 pb-8">
          {resto.map((post, i) => (
            <ScrollReveal key={post.slug} delay={i * 60}>
              <Link
                to={`/blog/${post.slug}`}
                className="group grid grid-cols-[96px_1fr_auto] md:grid-cols-[64px_200px_1fr_auto] gap-4 md:gap-8 items-center py-8 border-t border-border"
              >
                <span aria-hidden="true" className="hidden md:block font-heading text-[40px] leading-none text-forest/10 select-none">
                  {String(i + 2).padStart(2, "0")}
                </span>
                <div className="overflow-hidden aspect-[1200/630]">
                  <img
                    src={post.imagem}
                    srcSet={capaSrcSet(post.imagem)}
                    sizes="(min-width: 768px) 200px, 96px"
                    width="1200"
                    height="630"
                    alt={post.imagem_alt || ""}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
                  />
                </div>
                <div>
                  <div className="font-body text-xs tracking-[0.15em] uppercase text-gold mb-2.5">
                    {areaTitle(post.area) || "Blogue"} · {fmtData(post.data)} · {post.minutos} min
                  </div>
                  <h3 className="font-heading font-normal text-lg md:text-2xl leading-[1.3] text-forest mb-2 transition-colors duration-300 group-hover:text-gold">
                    {post.titulo}
                  </h3>
                  <p className="hidden md:block font-body text-sm leading-relaxed text-forest/60 max-w-[560px]">{post.descricao}</p>
                </div>
                <ArrowRight className="hidden md:block w-[18px] h-[18px] text-gold transition-transform duration-300 group-hover:translate-x-2" />
              </Link>
            </ScrollReveal>
          ))}
          <div className="border-t border-border" />
        </section>

        {/* CTA de fecho */}
        <section className="pt-8 pb-28">
          <ScrollReveal>
            <div className="bg-forest p-10 md:py-[72px] md:px-16 grid md:grid-cols-[1.2fr_auto] items-center gap-8 md:gap-12">
              <div>
                <div className="h-px w-12 bg-gold mb-6" />
                <h2 className="font-heading font-normal text-2xl md:text-[34px] leading-tight text-warmwhite mb-3">
                  O seu caso é concreto, <em className="italic text-gold">não um artigo.</em>
                </h2>
                <p className="font-body text-[15px] text-warmwhite/60 max-w-[520px]">
                  Estes textos explicam a estrutura dos problemas. A sua situação merece uma análise própria.
                </p>
              </div>
              <Link
                to="/contacto"
                className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-gold text-warmwhite text-sm font-body tracking-wide hover:bg-[#a07d4a] transition-all duration-300"
              >
                Agendar Consulta
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </ScrollReveal>
        </section>
      </div>
    </div>
  );
}
