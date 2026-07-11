import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";
import Seo from "../components/Seo";
import Breadcrumbs, { breadcrumbJsonLd } from "../components/Breadcrumbs";
import { AREAS } from "../data/areas";

/**
 * Indice das areas de atuacao. O conteudo completo (quando procurar, como ajudamos)
 * vive nas paginas dedicadas /areas/{slug} — mante-lo aqui duplicava cada pagina de
 * area consigo mesma aos olhos do Google. Os cards mantem id={slug} para que os
 * links antigos /areas#familia continuem a aterrar no sitio certo.
 */
export default function Areas() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const slug = hash.slice(1);
    // O Chrome re-ancora ao fragmento repetidamente enquanto o layout assenta
    // (medido: ~1.6s apos a carga, muito depois do load), sobrepondo qualquer
    // scroll programatico. Remover o fragmento do URL desarma essa re-ancoragem;
    // o scroll passa a ser so' nosso, com offset para o header.
    window.history.replaceState(null, '', pathname);
    const t = setTimeout(() => {
      const el = document.getElementById(slug);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 112;
      window.scrollTo({ top, behavior: 'smooth' });
    }, 400);
    return () => clearTimeout(t);
  }, [hash, pathname]);

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

      {/* Índice das áreas */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {AREAS.map((area, i) => (
            <ScrollReveal key={area.slug} delay={i * 60}>
              <Link
                to={`/areas/${area.slug}`}
                id={area.slug}
                className="group flex h-full flex-col p-8 bg-cream border border-border hover:border-gold transition-colors duration-300 scroll-mt-28"
              >
                <div className="flex items-center gap-3 mb-5">
                  <area.icon className="w-6 h-6 text-gold" aria-hidden="true" />
                  <span className="font-heading text-4xl text-forest/10">0{i + 1}</span>
                </div>
                <h2 className="font-heading text-2xl text-forest mb-3">{area.title}</h2>
                <p className="font-body text-sm text-forest/60 leading-relaxed flex-1">{area.desc}</p>
                <span className="inline-flex items-center gap-1.5 mt-6 text-sm text-gold font-body">
                  Saber mais
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
            <h2 className="font-heading text-3xl text-forest mb-4">Não sabe por onde começar?</h2>
            <p className="font-body text-forest/60 mb-10 max-w-xl mx-auto">
              Descreva-nos a sua situação e ajudamos a identificar o enquadramento certo.
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
