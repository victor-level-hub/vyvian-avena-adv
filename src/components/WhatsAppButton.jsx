import { trackEvent } from "../lib/analytics";

export default function WhatsAppButton() {
  return (
    <a
      href="https://wa.me/351911831530?text=Olá,%20gostaria%20de%20agendar%20uma%20consulta."
      onClick={() => trackEvent("whatsapp_click", { origem: "pill_flutuante" })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Fale connosco via WhatsApp"
      className="wa-flutuante fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gold text-forest font-body text-sm font-medium shadow-lg hover:scale-105 transition-transform duration-300"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0" aria-hidden="true">
        <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.01c-.24.68-1.42 1.31-1.96 1.36-.5.05-.96.24-3.23-.67-2.72-1.07-4.46-3.84-4.6-4.02-.13-.18-1.1-1.47-1.1-2.8 0-1.33.7-1.99.95-2.26.24-.27.53-.34.71-.34.18 0 .35 0 .51.01.16.01.39-.06.6.46.24.59.81 2.04.88 2.19.07.15.12.32.02.51-.1.18-.15.3-.29.46-.15.18-.31.39-.44.53-.15.15-.3.31-.13.6.18.3.78 1.28 1.67 2.07 1.15 1.02 2.12 1.34 2.42 1.49.3.15.47.13.65-.08.18-.21.75-.87.95-1.17.2-.3.39-.25.66-.15.27.1 1.7.8 1.99.95.3.15.49.22.56.34.07.12.07.7-.17 1.38z"/>
      </svg>
      Fale connosco
    </a>
  );
}
