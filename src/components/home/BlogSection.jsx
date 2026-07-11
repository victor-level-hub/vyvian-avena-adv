import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import ScrollReveal from "../ScrollReveal";
import { POSTS } from "../../data/blog";
import { getArea } from "../../data/areas";

const areaTitle = (slug) => (slug ? (getArea(slug)?.title ?? "Blogue") : "Blogue");

/**
 * Secção do blogue na Home: os 3 artigos mais recentes, na linguagem editorial
 * do blog v2 (imagem, overline, título Fraunces, hovers lentos). Penúltima
 * secção — não empurra áreas/escritórios/CTA. Os links daqui são também os
 * links internos mais fortes para os artigos quando forem indexáveis.
 */
export default function BlogSection() {
  const posts = POSTS.slice(0, 3);
  if (posts.length === 0) return null;

  return (
    <section className="py-24 px-6 md:px-12 bg-cream">
      <div className="max-w-7xl mx-auto">
        <ScrollReveal>
          <div className="flex flex-wrap items-end justify-between gap-4 mb-12">
            <div>
              <div className="h-px w-16 bg-gold mb-6" />
              <h2 className="font-heading text-3xl md:text-4xl text-forest mb-3">Do nosso blogue</h2>
              <p className="font-body text-forest/60 max-w-lg">
                Os problemas jurídicos de quem vive entre Portugal e o Brasil, explicados pela estrutura.
              </p>
            </div>
            <Link
              to="/blog"
              className="inline-flex items-center gap-2 font-body text-sm text-gold hover:text-forest transition-colors duration-300"
            >
              Todos os artigos
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {posts.map((post, i) => (
            <ScrollReveal key={post.slug} delay={i * 100}>
              <Link
                to={`/blog/${post.slug}`}
                className="group flex flex-col h-full bg-warmwhite border border-border overflow-hidden"
              >
                <div className="overflow-hidden aspect-[1200/630]">
                  <img
                    src={post.imagem}
                    alt={post.imagem_alt || ""}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
                  />
                </div>
                <div className="flex flex-col flex-1 p-7">
                  <div className="font-body text-xs tracking-[0.15em] uppercase text-gold mb-3">
                    {areaTitle(post.area)} · {post.minutos} min
                  </div>
                  <h3 className="font-heading font-normal text-xl leading-snug text-forest transition-colors duration-300 group-hover:text-gold flex-1">
                    {post.titulo}
                  </h3>
                  <span className="inline-flex items-center gap-2 mt-5 text-sm text-gold font-body">
                    Ler artigo
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
