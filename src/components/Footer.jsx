import { Link } from "react-router-dom";
import { trackEvent } from "../lib/analytics";
import { Phone, Mail, MapPin, Instagram } from "lucide-react";

const LINKS = [
  { label: "Home", path: "/" },
  { label: "Sobre", path: "/sobre" },
  { label: "Áreas de Atuação", path: "/areas" },
  { label: "Apoio", path: "/apoio" },
  { label: "Blogue", path: "/blog" },
  { label: "Contacto", path: "/contacto" },
];

export default function Footer() {
  return (
    <footer className="bg-forest text-warmwhite/80">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="flex flex-col items-center justify-center">
            <img
              src="/logo-horizontal-dourado.svg"
              alt="Vyvian Avena — Advogada"
              width="1200" height="383"
              className="h-10 w-auto mt-8"
            />
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
              <a href="tel:+351911831530" onClick={() => trackEvent("tel_click", { origem: "rodape" })} className="flex items-center gap-2 hover:text-gold transition-colors">
                <Phone className="w-4 h-4 text-gold" />
                +351 911 831 530
              </a>
              <a href="mailto:vyavena@gmail.com" onClick={() => trackEvent("email_click", { origem: "rodape" })} className="flex items-center gap-2 hover:text-gold transition-colors">
                <Mail className="w-4 h-4 text-gold" />
                vyavena@gmail.com
              </a>
              <a href="mailto:vyvianavena-60987P@adv.oa.pt" onClick={() => trackEvent("email_click", { origem: "rodape" })} className="flex items-center gap-2 hover:text-gold transition-colors text-warmwhite/60">
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
          <p className="text-xs text-warmwhite/60">
            © {new Date().getFullYear()} Vyvian Avena — Advogada. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}


