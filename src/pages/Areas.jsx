import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
import { AREAS } from "../data/areas";


export default function Areas() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.replace('#', ''));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [hash]);

  const crumbs = [
    { name: "Início", path: "/" },
    { name: "Áreas de Atuação", path: "/areas" },
  ];

  return (
    <div>
      <Seo path="/areas" jsonLd={breadcrumbJsonLd(crumbs)} />

      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <Breadcrumbs items={crumbs} className="mb-8" />
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">Áreas de Atuação</h1>
            <p className="font-body text-warmwhite/60 max-w-2xl text-lg">
              Assistência jurídica especializada em seis áreas do Direito, com atendimento humanizado e personalizado.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Areas */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <div className="space-y-20">
          {AREAS.map((area, i) => (
            <ScrollReveal key={area.title}>
              <div id={area.slug} className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20 border-b border-border last:border-0">
                <div className="lg:col-span-1">
                  <div className="flex items-center gap-3 mb-4">
                    <area.icon className="w-6 h-6 text-gold" />
                    <span className="font-heading text-5xl text-forest/10">0{i + 1}</span>
                  </div>
                  <h2 className="font-heading text-2xl md:text-3xl text-forest mb-2">{area.title}</h2>
                  <p className="font-body text-forest/60 text-sm leading-relaxed">{area.desc}</p>
                </div>
                <div className="lg:col-span-2 space-y-6">
                  <p className="font-body text-forest/70 text-sm italic border-l-2 border-gold pl-4">
                    {area.when}
                  </p>
                  <div>
                    <h4 className="font-body text-xs tracking-widest uppercase text-gold mb-3">Como ajudamos</h4>
                    <ul className="space-y-2">
                      {area.services.map((s) => (
                        <li key={s} className="flex items-start gap-2 text-sm text-forest/70 font-body">
                          <div className="w-1.5 h-1.5 bg-gold rounded-full mt-2 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to={`/areas/${area.slug}`}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-forest text-warmwhite text-sm font-body tracking-wide hover:bg-forest-mid transition-all duration-300"
                    >
                      Saber mais
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                      to="/contacto"
                      className="inline-flex items-center gap-2 px-6 py-2.5 border border-gold text-gold text-sm font-body tracking-wide hover:bg-gold hover:text-warmwhite transition-all duration-300"
                    >
                      Agendar Consulta
                    </Link>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>
    </div>
  );
}