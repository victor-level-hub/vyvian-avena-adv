import { Link, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
import { AREAS, getArea } from "../data/areas";
import NaoEncontrado from "./NaoEncontrado";

const SITE = "https://vyavenaadv.com";

const serviceJsonLd = (area) => ({
  "@context": "https://schema.org",
  "@type": "Service",
  name: area.title,
  description: area.desc,
  serviceType: area.title,
  url: `${SITE}/areas/${area.slug}`,
  provider: {
    "@type": "LegalService",
    name: "Vyvian Avena Advogada",
    url: `${SITE}/`,
  },
  areaServed: [
    { "@type": "Country", name: "Portugal" },
    { "@type": "Country", name: "Brasil" },
  ],
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: `Serviços em ${area.title}`,
    itemListElement: area.services.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s },
    })),
  },
});

export default function AreaDetalhe() {
  const { slug } = useParams();
  const area = getArea(slug);

  // Slug desconhecido: mostrar a pagina 404. Redireccionar para /areas daria 200
  // numa rota inexistente — um soft-404. O Worker serve esta pagina com 404 real.
  if (!area) return <NaoEncontrado />;

  const crumbs = [
    { name: "Início", path: "/" },
    { name: "Áreas de Atuação", path: "/areas" },
    { name: area.title, path: `/areas/${area.slug}` },
  ];

  const outras = AREAS.filter((a) => a.slug !== area.slug);

  return (
    <div>
      <Seo
        path={`/areas/${area.slug}`}
        title={area.metaTitle}
        desc={area.metaDesc}
        jsonLd={[serviceJsonLd(area), breadcrumbJsonLd(crumbs)]}
      />

      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <Breadcrumbs items={crumbs} className="mb-8" />
            <div className="h-px w-16 bg-gold mb-6" />
            <div className="flex items-center gap-4 mb-4">
              <area.icon className="w-8 h-8 text-gold shrink-0" />
              <h1 className="font-heading text-4xl md:text-5xl text-warmwhite">{area.title}</h1>
            </div>
            <p className="font-body text-warmwhite/60 max-w-2xl text-lg">{area.desc}</p>
          </ScrollReveal>
        </div>
      </section>

      {/* Quando procurar */}
      <section className="py-20 px-6 md:px-12 max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="max-w-3xl">
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-3xl md:text-4xl text-forest mb-6">
              Quando procurar apoio jurídico
            </h2>
            <p className="font-body text-forest/70 leading-relaxed border-l-2 border-gold pl-6">
              {area.when}
            </p>
          </div>
        </ScrollReveal>
      </section>

      {/* Como ajudamos */}
      <section className="py-20 px-6 md:px-12 bg-cream">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-3xl md:text-4xl text-forest mb-12">Como ajudamos</h2>
          </ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-5">
            {area.services.map((s, i) => (
              <ScrollReveal key={s} delay={i * 60}>
                <div className="flex items-start gap-3 pb-5 border-b border-border">
                  <Check className="w-5 h-5 text-gold shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="font-body text-forest/80">{s}</span>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 md:px-12">
        <div className="max-w-3xl mx-auto text-center">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mx-auto mb-8" />
            <h2 className="font-heading text-3xl md:text-4xl text-forest mb-4">
              Precisa de apoio nesta área?
            </h2>
            <p className="font-body text-forest/60 mb-10 max-w-xl mx-auto">
              Marque uma primeira consulta para analisarmos a sua situação e traçarmos as opções
              disponíveis.
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

      {/* Outras areas — ligacoes internas, ajudam o rastreio e a navegacao */}
      <section className="py-20 px-6 md:px-12 bg-cream">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-2xl md:text-3xl text-forest mb-10">Outras áreas</h2>
          </ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {outras.map((a, i) => (
              <ScrollReveal key={a.slug} delay={i * 60}>
                <Link
                  to={`/areas/${a.slug}`}
                  className="group block h-full p-6 bg-warmwhite border border-border hover:border-gold transition-colors duration-300"
                >
                  <a.icon className="w-6 h-6 text-gold mb-4" aria-hidden="true" />
                  <h3 className="font-heading text-xl text-forest mb-2">{a.title}</h3>
                  <p className="font-body text-sm text-forest/60 leading-relaxed">{a.desc}</p>
                  <span className="inline-flex items-center gap-1.5 mt-4 text-sm text-gold font-body">
                    Saber mais
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
                  </span>
                </Link>
              </ScrollReveal>
            ))}
          </div>
          <ScrollReveal>
            <Link
              to="/areas"
              className="inline-flex items-center gap-2 mt-12 text-sm text-forest/60 hover:text-forest font-body transition-colors duration-300"
            >
              <ArrowLeft className="w-4 h-4" />
              Ver todas as áreas
            </Link>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
