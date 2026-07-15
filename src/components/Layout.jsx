import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import Footer from "./Footer";
import WhatsAppButton from "./WhatsAppButton";
import CookieBanner from "./CookieBanner";
import { trackPageView } from "../lib/analytics";

export default function Layout({ children }) {
  // GA4: page_view por rota (SPA). Só o site público — o admin não passa por aqui.
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  // Esconder badge do Base44 caso esteja presente
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      #base44-badge,
      [id*="base44"],
      [class*="base44-badge"],
      a[href*="base44.com"][style*="position: fixed"],
      a[href*="base44.com"][style*="position:fixed"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-warmwhite">
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <WhatsAppButton />
      <CookieBanner />
    </div>
  );
}
