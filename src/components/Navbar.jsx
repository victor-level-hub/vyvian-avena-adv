import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Lock } from "lucide-react";

const NAV_LINKS = [
  { label: "Home", path: "/" },
  { label: "Sobre", path: "/sobre" },
  { label: "Áreas de Atuação", path: "/areas" },
  { label: "Apoio", path: "/apoio" },
  { label: "Blogue", path: "/blog" },
  { label: "Contacto", path: "/contacto" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-40"
        style={{
          transition: 'all 0.35s ease',
          backgroundColor: scrolled ? '#faf8f4' : 'transparent',
          boxShadow: scrolled ? '0 1px 12px rgba(0,0,0,0.08)' : 'none',
          paddingTop: scrolled ? '12px' : '20px',
          paddingBottom: scrolled ? '12px' : '20px',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img
              src={scrolled ? "/logo-horizontal-verde.png" : "/logo-horizontal-branco.webp"}
              alt="Vyvian Avena Advogada"
              width="512" height="161"
              style={{ height: '44px', width: 'auto', objectFit: 'contain' }}
            />
          </Link>

          <div className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-body tracking-wide transition-all duration-300 hover:text-gold ${
                  location.pathname === link.path
                    ? "text-gold"
                    : scrolled
                    ? "text-forest"
                    : "text-warmwhite/90"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/admin/login"
              className={`flex items-center gap-1 text-xs font-body tracking-wide transition-colors duration-300 hover:text-gold ${
                scrolled ? "text-forest/60" : "text-warmwhite/60"
              }`}
              title="Acesso restrito"
            >
              <Lock className="w-3 h-3" />
              Área Privada
            </Link>
            <Link
              to="/contacto"
              className="ml-2 px-5 py-2 text-sm font-body tracking-wide border border-gold text-gold hover:bg-gold hover:text-warmwhite transition-all duration-300"
            >
              Consulta
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(true)}
            className={`lg:hidden transition-colors ${scrolled ? "text-forest" : "text-warmwhite"}`}
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      <div
        className={`fixed inset-0 z-50 bg-forest transition-all duration-500 flex flex-col items-center justify-center ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={() => setMenuOpen(false)}
          className="absolute top-6 right-6 text-warmwhite"
          aria-label="Fechar menu"
        >
          <X className="w-7 h-7" />
        </button>
        <div className="flex flex-col items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`font-heading text-3xl tracking-wide transition-colors hover:text-gold ${
                location.pathname === link.path ? "text-gold" : "text-warmwhite"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/contacto"
            className="mt-4 px-8 py-3 font-body text-sm tracking-widest uppercase border border-gold text-gold hover:bg-gold hover:text-warmwhite transition-all"
          >
            Consulta
          </Link>
          <Link
            to="/admin/login"
            className="flex items-center gap-2 mt-6 font-body text-sm tracking-wide text-warmwhite/60 hover:text-gold transition-colors"
          >
            <Lock className="w-4 h-4" />
            Área Privada
          </Link>
        </div>
      </div>
    </>
  );
}
