import { Link } from "react-router-dom";
import { ArrowRight, Users, FileText, Briefcase, Landmark, Globe, BookOpen } from "lucide-react";
import ScrollReveal from "../ScrollReveal";

const AREAS = [
  { icon: Users, title: "Direito de Família", slug: "familia", desc: "Divórcios, partilhas, responsabilidades parentais e pensão de alimentos." },
  { icon: FileText, title: "Direito Civil", slug: "civil", desc: "Contratos, responsabilidade civil e direitos reais." },
  { icon: Briefcase, title: "Direito Comercial", slug: "comercial", desc: "Constituição de sociedades e contratos comerciais." },
  { icon: Landmark, title: "Cobrança de Dívida", slug: "cobranca", desc: "Injunções, ações executivas e recuperação de crédito." },
  { icon: Globe, title: "Nacionalidade", slug: "nacionalidade", desc: "Aquisição de nacionalidade portuguesa e processos migratórios." },
  { icon: BookOpen, title: "Direito Notarial", slug: "notarial", desc: "Escrituras, testamentos e habilitações de herdeiros." },
];

export default function PracticeAreasGrid() {
  return (
    <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
      <ScrollReveal>
        <div className="text-center mb-16">
          <div className="h-px w-16 bg-gold mx-auto mb-6" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-4">Áreas de Atuação</h2>
          <p className="font-body text-forest/60 max-w-lg mx-auto">
            Assistência jurídica especializada e personalizada em cada área do Direito.
          </p>
        </div>
      </ScrollReveal>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" style={{ alignItems: 'stretch' }}>
        {AREAS.map((area, i) => (
          <ScrollReveal key={area.title} delay={i * 100}>
            <Link
              to={`/areas/${area.slug}`}
              className="group flex flex-col h-full p-8 border border-border bg-warmwhite hover:bg-forest transition-all duration-500"
            >
              <area.icon className="w-6 h-6 text-gold mb-4" />
              <h3 className="font-heading text-xl text-forest group-hover:text-warmwhite transition-colors mb-2">
                {area.title}
              </h3>
              <p className="font-body text-sm text-forest/60 group-hover:text-warmwhite/70 transition-colors leading-relaxed mb-4 flex-1">
                {area.desc}
              </p>
              <ArrowRight className="w-4 h-4 text-gold group-hover:translate-x-2 transition-transform duration-300" />
            </Link>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}