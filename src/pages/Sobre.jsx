import { Link } from "react-router-dom";
import { Heart, Users, Eye, Award, ArrowRight } from "lucide-react";
import ScrollReveal from "../components/ScrollReveal";

const ABOUT_IMAGE = "/images/vyvian-sobre.jpg";

const VALUES = [
  { icon: Heart, title: "Humanização", desc: "Cada pessoa é tratada com empatia e respeito pela sua singularidade." },
  { icon: Users, title: "Proximidade", desc: "Acompanhamento próximo em todas as fases do processo jurídico." },
  { icon: Eye, title: "Transparência", desc: "Comunicação clara sobre procedimentos, prazos e custos." },
  { icon: Award, title: "Excelência", desc: "Compromisso com o mais alto padrão de rigor técnico e ético." },
];

const DIFFERENTIALS = [
  "Experiência consolidada em Portugal e Brasil com dupla jurisdição",
  "Atendimento personalizado com acompanhamento de perto",
  "Especialização em Direito de Família e Civil com abordagem humanizada",
  "Rede de 3 escritórios para maior conveniência dos clientes",
];

export default function Sobre() {
  return (
    <div>
      {/* Hero */}
      <section className="relative bg-forest pt-32 pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-6" />
            <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-6 leading-tight">
              Dra. Vyvian Avena
            </h1>
            <p className="font-body text-gold text-sm tracking-widest uppercase mb-6">
              ADVOGADA INSCRITA NA ORDEM DOS ADVOGADOS DE PORTUGAL E DO BRASIL
            </p>
            <p className="font-body text-warmwhite/70 leading-relaxed">
              Com mais de 15 anos de experiência em Portugal e Brasil, a Dra. Vyvian Avena dedica a sua prática à defesa dos direitos dos seus clientes com proximidade, empatia e rigor profissional.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <div className="relative mx-auto max-w-[420px]">
              {/* moldura dourada decorativa deslocada (toque editorial) */}
              <div className="absolute -inset-3 border border-gold/30 rounded-md pointer-events-none" />
              <div className="relative aspect-[3/4] max-h-[520px] overflow-hidden rounded-md ring-1 ring-gold/40 shadow-2xl shadow-black/30">
                <img
                  src={ABOUT_IMAGE}
                  alt="Dra. Vyvian Avena"
                  className="w-full h-full object-cover"
                />
                {/* gradiente que funde a base da foto no verde do site */}
                <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-forest/50 to-transparent pointer-events-none" />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Biography */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="h-px w-16 bg-gold mb-8" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-8">Biografia Profissional</h2>
          <div className="space-y-4 font-body text-forest/70 leading-relaxed">
            <p>
              Formada em Direito com especialização nas áreas de Família e Civil, a Dra. Vyvian Avena iniciou a sua carreira no Brasil, onde adquiriu uma sólida experiência em processos complexos de Direito de Família, incluindo divórcios, regulação de poder paternal e partilhas patrimoniais.
            </p>
            <p>
              A sua trajetória internacional levou-a a Portugal, onde se inscreveu na Ordem dos Advogados de Portugal sob o número 60987P. Atualmente, dirige um escritório com presença em Setúbal/Grande Lisboa, Aveiro/Porto e Rio de Janeiro, oferecendo assistência jurídica em seis áreas do Direito.
            </p>
            <p>
              A sua abordagem distingue-se pelo atendimento humanizado, privilegiando a escuta ativa e a construção de soluções que respeitem as necessidades individuais de cada cliente.
            </p>
          </div>
        </ScrollReveal>
      </section>

      {/* Values */}
      <section className="py-24 px-6 md:px-12 bg-cream">
        <div className="max-w-7xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-16">
              <div className="h-px w-16 bg-gold mx-auto mb-6" />
              <h2 className="font-heading text-3xl md:text-4xl text-forest mb-4">Os Nossos Valores</h2>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
            {VALUES.map((val, i) => (
              <ScrollReveal key={val.title} delay={i * 100} className="h-full">
                <div className="h-full flex flex-col p-8 bg-warmwhite border border-border text-center">
                  <val.icon className="w-8 h-8 text-gold mx-auto mb-4" />
                  <h3 className="font-heading text-xl text-forest mb-2">{val.title}</h3>
                  <p className="font-body text-sm text-forest/60 leading-relaxed">{val.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Formation */}
      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="h-px w-16 bg-gold mb-8" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-8">Formação e Inscrições</h2>
          <div className="space-y-4 font-body text-forest/70">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-gold rounded-full mt-2 shrink-0" />
              <p>Licenciatura em Direito</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-gold rounded-full mt-2 shrink-0" />
              <p>Especialização em Direito de Família e Menores</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-gold rounded-full mt-2 shrink-0" />
              <p>Inscrita na Ordem dos Advogados de Portugal — Cédula 60987P</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-gold rounded-full mt-2 shrink-0" />
              <p>Inscrita na Ordem dos Advogados do Brasil — OAB/RJ</p>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 px-6 md:px-12 bg-forest">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="h-px w-16 bg-gold mb-8" />
            <h2 className="font-heading text-3xl md:text-4xl text-warmwhite mb-12">Porque nos escolher</h2>
          </ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ alignItems: 'stretch' }}>
            {DIFFERENTIALS.map((diff, i) => (
              <ScrollReveal key={i} delay={i * 100}>
                <div className="flex flex-col h-full p-6 border border-warmwhite/10" style={{ minHeight: 120 }}>
                  <span className="font-heading text-4xl text-gold/30">0{i + 1}</span>
                  <p className="font-body text-warmwhite/80 leading-relaxed pt-2">{diff}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
          <ScrollReveal delay={500}>
            <div className="mt-12 text-center">
              <Link
                to="/contacto"
                className="inline-flex items-center gap-2 px-8 py-3 bg-gold text-warmwhite font-body text-sm tracking-wide hover:bg-gold/90 transition-all"
              >
                Agendar Consulta
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}

