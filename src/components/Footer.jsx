import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Instagram } from "lucide-react";

const LINKS = [
  { label: "Home", path: "/" },
  { label: "Sobre", path: "/sobre" },
  { label: "Áreas de Atuação", path: "/areas" },
  { label: "Apoio", path: "/apoio" },
  { label: "Contacto", path: "/contacto" },
];

export default function Footer() {
  return (
    <footer className="bg-forest text-warmwhite/80">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <img
              src="/logo-vyvian-vertical-gold.svg"
              alt="Vyvian Avena — Advogada"
              className="h-28 w-auto mb-5"
            />
            <p className="text-sm leading-relaxed">
              Atendimento humanizado e próximo nas áreas de Direito da Família, Civil e Comercial.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-heading text-lg text-warmwhite mb-4">Navegação</h4>
            <div className="flex flex-col gap-2">
              {LINKS.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className="text-sm hover:text-gold transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-heading text-lg text-warmwhite mb-4">Contacto</h4>
            <div className="flex flex-col gap-3 text-sm">
              <a href="tel:+351911831530" className="flex items-center gap-2 hover:text-gold transition-colors">
                <Phone className="w-4 h-4 text-gold" />
                +351 911 831 530
              </a>
              <a href="mailto:vyavena@gmail.com" className="flex items-center gap-2 hover:text-gold transition-colors">
                <Mail className="w-4 h-4 text-gold" />
                vyavena@gmail.com
              </a>
              <a href="mailto:vyvianavena-60987P@adv.oa.pt" className="flex items-center gap-2 hover:text-gold transition-colors text-warmwhite/60">
                <Mail className="w-4 h-4 text-gold" />
                vyvianavena-60987P@adv.oa.pt
              </a>
              <a href="https://www.instagram.com/vyvianavenaadv/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-gold transition-colors">
                <Instagram className="w-4 h-4 text-gold" />
                @vyvianavenaadv
              </a>
            </div>
          </div>

          {/* Offices */}
          <div>
            <h4 className="font-heading text-lg text-warmwhite mb-4">Escritórios</h4>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gold mt-0.5 shrink-0" />
                <span>🇵🇹 Cacilhas — Setúbal/Grande Lisboa</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gold mt-0.5 shrink-0" />
                <span>🇵🇹 Santa Maria da Feira — Aveiro/Porto</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gold mt-0.5 shrink-0" />
                <span>🇧🇷 Barra Olímpica — Rio de Janeiro</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-warmwhite/10 flex items-center justify-center">
          <p className="text-xs text-warmwhite/50">
            © {new Date().getFullYear()} Vyvian Avena — Advogada. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}


