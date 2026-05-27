import ScrollReveal from "../ScrollReveal";

export default function PhilosophySection({ oceanImage }) {
  return (
    <section className="relative bg-forest py-24 overflow-hidden">
      {oceanImage && (
        <img
          src={oceanImage}
          alt="Oceano Atlântico"
          className="absolute inset-0 w-full h-full object-cover opacity-10"
        />
      )}
      <div className="relative max-w-5xl mx-auto px-6 md:px-12">
        <ScrollReveal>
          <div className="text-center mb-12">
            <div className="h-px w-16 bg-gold mx-auto mb-6" />
            <h2 className="font-heading text-3xl md:text-4xl text-warmwhite mb-4">
              Direito como ferramenta de equilíbrio
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <ScrollReveal>
            <p className="font-body text-warmwhite/70 leading-relaxed text-base">
              Acreditamos que o Direito, mais do que resolução de conflitos, é uma ferramenta de
              equilíbrio e proteção. Cada caso é acompanhado de perto, com empatia e rigor, num
              compromisso de proximidade que marca a nossa prática profissional.
            </p>
            <p className="font-body text-warmwhite/70 leading-relaxed text-base mt-4">
              Com presença em Portugal e Brasil, oferecemos um acompanhamento humanizado
              que respeita a singularidade de cada pessoa e de cada situação.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={200}>
            <blockquote className="border-l-2 border-gold pl-8 py-4">
              <p className="font-heading text-2xl md:text-3xl text-warmwhite italic leading-snug">
                "O Direito pode — e deve — ser um caminho de equilíbrio, clareza e confiança."
              </p>
              <cite className="block mt-4 font-body text-gold text-sm tracking-wider uppercase not-italic">
                — Dra. Vyvian Avena
              </cite>
            </blockquote>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}