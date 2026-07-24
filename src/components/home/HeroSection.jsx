import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const STATS = [
  { value: "15+", label: "Anos" },
  { value: "6", label: "Áreas" },
  { value: "3", label: "Escritórios" },
  { value: "2", label: "Países" },
];

export default function HeroSection({ heroImage }) {
  return (
    <section className="relative min-h-screen flex flex-col lg:flex-row">
      {/* Left: Text */}
      <div className="lg:w-1/2 bg-forest flex items-center px-6 md:px-12 lg:px-16 py-32 lg:py-0">
        <div className="max-w-lg">
          <div className="h-px w-16 bg-gold mb-8" />
          <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl text-warmwhite leading-tight mb-6">
            Confiança começa pela{" "}
            <em className="text-gold">atenção dedicada.</em>
          </h1>
          <p className="font-body text-warmwhite/70 text-base md:text-lg leading-relaxed mb-10 max-w-md">
            Atendimento humanizado e próximo nas áreas de Direito da Família, Civil e Comercial. Com experiência em Portugal e Brasil.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/contacto"
              className="px-7 py-3 bg-gold text-forest font-medium font-body text-sm tracking-wide hover:bg-gold/90 transition-all duration-300"
            >
              Consulta Inicial
            </Link>
            <Link
              to="/areas"
              className="px-7 py-3 border border-gold/50 text-gold font-body text-sm tracking-wide hover:border-gold hover:bg-gold/10 transition-all duration-300 flex items-center gap-2"
            >
              Áreas de Atuação
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Right: Image */}
      <div className="lg:w-1/2 relative min-h-[60vh] lg:min-h-screen">
        {/* LCP da página: srcset evita descarregar 864px num ecrã de 400,
            fetchpriority="high" adianta o pedido na fila do browser. */}
        <img
          src={heroImage}
          srcSet="/hero-escritorio-480.webp 480w, /hero-escritorio-864.webp 864w"
          sizes="(min-width: 1024px) 50vw, 100vw"
          width="864"
          height="1184"
          fetchpriority="high"
          alt="Escritório de advocacia"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-forest/30 to-transparent" />

        {/* Floating Stats Card */}
        <div className="absolute bottom-8 left-6 right-6 md:left-8 md:right-8 lg:bottom-12 lg:left-12 lg:right-12">
          <div className="bg-warmwhite/95 backdrop-blur-md p-6 md:p-8 shadow-xl">
            <div className="grid grid-cols-4 divide-x divide-border">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center px-2">
                  <p className="font-heading text-2xl md:text-3xl text-forest">{stat.value}</p>
                  <p className="font-body text-xs text-forest/60 tracking-wider uppercase mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}