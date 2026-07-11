import { Link, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
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
  author: {
    "@type": "Person",
    name: "Vyvian Avena",
    jobTitle: "Advogada",
  },
  publisher: {
    "@type": "LegalService",
    name: "Vyvian Avena Advogada",
    url: `${SITE}/`,
  },
});

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
    <div>
      <Seo
        path={`/blog/${post.slug}`}
        title={post.titulo}
        desc={post.descricao}
        noindex={!blogConfig.publicado}
        image={post.imagem || undefined}
        jsonLd={[articleJsonLd(post), breadcrumbJsonLd(crumbs)]}
      />

      {/* Hero */}
      <section className="bg-forest pt-32 pb-16 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <Breadcrumbs items={crumbs.slice(0, 2)} className="mb-8" />
          <div className="h-px w-16 bg-gold mb-6" />
          <h1 className="font-heading text-3xl md:text-5xl text-warmwhite mb-6 leading-tight">
            {post.titulo}
          </h1>
          <div className="font-body text-sm text-warmwhite/50">
            {fmtData(post.data)} · {post.minutos} min de leitura
            {post.revisto_em && post.revisto_em !== post.data && (
              <> · Revisto a {fmtData(post.revisto_em)}</>
            )}
          </div>
        </div>
      </section>

      {/* Imagem do artigo — a mesma do card e da og:image */}
      {post.imagem && (
        <div className="px-6 md:px-12 -mt-2">
          <img
            src={post.imagem}
            alt={post.imagem_alt || ""}
            className="max-w-3xl mx-auto w-full aspect-[1200/630] object-cover"
          />
        </div>
      )}

      {/* Corpo */}
      <article className="py-16 px-6 md:px-12">
        <div
          className="blog-prose max-w-3xl mx-auto"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </article>

      {/* CTA para a área + contacto */}
      <section className="pb-8 px-6 md:px-12">
        <div className="max-w-3xl mx-auto p-8 bg-cream border border-border">
          <h2 className="font-heading text-2xl text-forest mb-3">
            {area ? `Precisa de apoio em ${area.title}?` : "Este tema toca a sua situação?"}
          </h2>
          <p className="font-body text-sm text-forest/60 mb-6 leading-relaxed">
            {area
              ? area.desc
              : "Descreva-nos o seu caso e ajudamos a identificar o enquadramento certo."}
          </p>
          <div className="flex flex-wrap gap-3">
            {area && (
              <Link
                to={`/areas/${area.slug}`}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-forest text-warmwhite text-sm font-body tracking-wide hover:bg-forest-mid transition-all duration-300"
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
      </section>

      {/* Outros artigos */}
      {outros.length > 0 && (
        <section className="py-16 px-6 md:px-12 bg-cream">
          <div className="max-w-3xl mx-auto">
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-2xl text-forest mb-8">Continuar a ler</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {outros.map((p) => (
                <Link
                  key={p.slug}
                  to={`/blog/${p.slug}`}
                  className="group block p-6 bg-warmwhite border border-border hover:border-gold transition-colors duration-300"
                >
                  <h3 className="font-heading text-lg text-forest mb-2 leading-snug">{p.titulo}</h3>
                  <span className="inline-flex items-center gap-1.5 text-sm text-gold font-body">
                    Ler artigo
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
                  </span>
                </Link>
              ))}
            </div>
            <Link
              to="/blog"
              className="inline-flex items-center gap-2 mt-10 text-sm text-forest/60 hover:text-forest font-body transition-colors duration-300"
            >
              <ArrowLeft className="w-4 h-4" />
              Todos os artigos
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
