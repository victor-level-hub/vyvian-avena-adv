import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRight, Users, FileText, Briefcase, Landmark, Globe, BookOpen } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";

const AREAS = [
  { icon: Users, slug: "familia", title: "Direito de Família", desc: "Acompanhamento sensível e rigoroso em questões que afetam a vida familiar e pessoal.", when: "Quando procurar: em casos de divórcio, separação, guarda de filhos, pensão de alimentos, regulação do poder parental ou conflitos familiares.", services: ["Divórcio por mútuo consentimento e litigioso", "Partilhas de bens", "Responsabilidades parentais", "Pensão de alimentos", "Adoção e tutela", "Violência doméstica"] },
  { icon: FileText, slug: "civil", title: "Direito Civil", desc: "Proteção dos seus direitos e interesses em relações contratuais e patrimoniais.", when: "Quando procurar: em disputas contratuais, questões de propriedade, indemnizações, heranças ou qualquer questão civil.", services: ["Contratos civis (compra e venda, arrendamento)", "Responsabilidade civil e indemnizações", "Direitos reais e propriedade", "Sucessões e heranças", "Direito do consumidor"] },
  { icon: Briefcase, slug: "comercial", title: "Direito Comercial", desc: "Suporte jurídico para empresas e empreendedores na criação e gestão de negócios.", when: "Quando procurar: ao constituir uma empresa, negociar contratos comerciais ou resolver disputas empresariais.", services: ["Constituição de sociedades", "Contratos comerciais", "Fusões e aquisições", "Direito societário", "Resolução de litígios comerciais"] },
  { icon: Landmark, slug: "cobranca", title: "Cobrança de Dívida", desc: "Recuperação eficaz de créditos com estratégias extrajudiciais e judiciais.", when: "Quando procurar: quando tem valores em dívida por cobrar, contratos não cumpridos ou precisa de recuperar créditos.", services: ["Injunções (procedimento europeu e nacional)", "Ações executivas", "Negociação extrajudicial", "Recuperação de crédito", "Insolvência e reestruturação"] },
  { icon: Globe, slug: "nacionalidade", title: "Nacionalidade", desc: "Assistência completa nos processos de aquisição de nacionalidade e migração.", when: "Quando procurar: se pretende adquirir a nacionalidade portuguesa, regularizar a sua situação migratória ou obter autorização de residência.", services: ["Aquisição de nacionalidade portuguesa", "Processos de naturalização", "Reagrupamento familiar", "Autorização de residência", "Vistos e permissões migratórias"] },
  { icon: BookOpen, slug: "notarial", title: "Direito Notarial", desc: "Orientação especializada em atos notariais e registos, com segurança jurídica.", when: "Quando procurar: quando precisa de escrituras, testamentos, procurações ou habilitação de herdeiros.", services: ["Escrituras públicas", "Testamentos", "Habilitações de herdeiros", "Procurações", "Registos e averbamentos"] },
];

export default function Areas() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.replace('#', ''));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [hash]);

  return (
    <div>
      {/* Hero */}
      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
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
                  <Link
                    to="/contacto"
                    className="inline-flex items-center gap-2 px-6 py-2.5 border border-gold text-gold text-sm font-body tracking-wide hover:bg-gold hover:text-warmwhite transition-all duration-300"
                  >
                    Agendar Consulta
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>
    </div>
  );
}