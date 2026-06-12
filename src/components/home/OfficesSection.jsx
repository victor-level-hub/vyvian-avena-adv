import { MapPin } from "lucide-react";
import ScrollReveal from "../ScrollReveal";

const OFFICES = [
  {
    flag: "🇵🇹",
    region: "Setúbal / Grande Lisboa",
    address: "Rua António Nobre 1D 3.º DTO",
    city: "Dream Offices - Cacilhas, 2800-260",
  },
  {
    flag: "🇵🇹",
    region: "Aveiro / Porto",
    address: "Rua Comendador de Sá Couto 112, 4º sala 2",
    city: "Santa Maria da Feira 4520-192",
  },
  {
    flag: "🇧🇷",
    region: "Rio de Janeiro",
    address: "Rua Amilcar de Castro 40, Ed. Marbella 103",
    city: "Barra Olímpica, RJ 22775-053",
  },
];

export default function OfficesSection() {
  return (
    <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
      <ScrollReveal>
        <div className="text-center mb-16">
          <div className="h-px w-16 bg-gold mx-auto mb-6" />
          <h2 className="font-heading text-3xl md:text-4xl text-forest mb-4">Nossos Escritórios</h2>
          <p className="font-body text-forest/60 max-w-lg mx-auto">
            Presença em Portugal e Brasil para melhor o servir.
          </p>
        </div>
      </ScrollReveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ alignItems: "stretch" }}>
        {OFFICES.map((office, i) => (
          <ScrollReveal key={office.region} delay={i * 150} className="flex">
            <div
              className="flex flex-col w-full bg-warmwhite p-8"
              style={{ minHeight: 220, boxShadow: "0 2px 16px rgba(0,0,0,0.08)", borderRadius: 2 }}
            >
              <span className="text-3xl mb-3">{office.flag}</span>
              <h3 className="font-heading text-xl text-forest mb-2">{office.region}</h3>
              <div className="h-px w-8 bg-gold mb-4" />
              <div className="flex items-start gap-2 text-sm text-forest/60 mt-auto">
                <MapPin className="w-4 h-4 text-gold mt-0.5 shrink-0" />
                <div>
                  <p>{office.address}</p>
                  <p>{office.city}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}