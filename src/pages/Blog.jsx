import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
import { POSTS } from "../data/blog";
import blogConfig from "../config/blog.json";

const fmtData = (iso) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : "";

/**
 * Indice do blogue. Enquanto blog.json tiver publicado=false, esta pagina e os
 * artigos servem com noindex e ficam fora do sitemap e do menu — existem nos URLs
 * reais para a Dra. Vyvian rever, mas nao sao encontraveis. Ao aprovar, muda-se a
 * flag e tudo passa a indexavel num unico commit.
 */
export default function Blog() {
  const crumbs = [
    { name: "Início", path: "/" },
    { name: "Blogue", path: "/blog" },
  ];

  return (
    <div>
      <Seo path="/blog" noindex={!blogConfig.publicado} jsonLd={breadcrumbJsonLd(crumbs)} />

      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <Breadcrumbs items={crumbs} className="mb-8" />
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">Blogue</h1>
            <p className="font-body text-warmwhite/60 max-w-2xl text-lg">
              Artigos sobre os problemas jurídicos de quem vive entre Portugal e o Brasil — explicados
              pela estrutura, sem juridiquês.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Artigos */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {POSTS.map((post, i) => (
            <ScrollReveal key={post.slug} delay={i * 60}>
              <Link
                to={`/blog/${post.slug}`}
                className="group flex h-full flex-col p-8 bg-cream border border-border hover:border-gold transition-colors duration-300"
              >
                <div className="font-body text-xs tracking-widest uppercase text-gold mb-4">
                  {fmtData(post.data)} · {post.minutos} min de leitura
                </div>
                <h2 className="font-heading text-2xl text-forest mb-3 leading-snug">{post.titulo}</h2>
                <p className="font-body text-sm text-forest/60 leading-relaxed flex-1">{post.descricao}</p>
                <span className="inline-flex items-center gap-1.5 mt-6 text-sm text-gold font-body">
                  Ler artigo
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
                </span>
              </Link>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 px-6 md:px-12">
        <div className="max-w-3xl mx-auto text-center">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mx-auto mb-8" />
            <h2 className="font-heading text-3xl text-forest mb-4">O seu caso é concreto, não um artigo</h2>
            <p className="font-body text-forest/60 mb-10 max-w-xl mx-auto">
              Estes textos explicam a estrutura dos problemas. A sua situação merece uma análise própria.
            </p>
            <Link
              to="/contacto"
              className="inline-flex items-center gap-2 px-8 py-3 bg-forest text-warmwhite text-sm font-body tracking-wide hover:bg-forest-mid transition-all duration-300"
            >
              Agendar Consulta
              <ArrowRight className="w-4 h-4" />
            </Link>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
