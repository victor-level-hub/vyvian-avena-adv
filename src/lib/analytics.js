// Google Analytics 4 com Consent Mode v2 (RGPD).
//
// Princípio: NADA sai do browser sem consentimento. O consent default é
// "denied" para tudo; o script gtag.js só é injetado quando o visitante
// aceita cookies estatísticos (agora ou numa visita anterior — o banner
// guarda a decisão em localStorage "cookie_consent").
//
// Os eventos (trackEvent/trackPageView) fazem sempre push ao dataLayer:
// sem consentimento o gtag.js nunca carrega e o array fica inerte no
// browser — nenhum dado é enviado. Com consentimento, o gtag processa a
// fila normalmente.
//
// Valores em localStorage (compatível com o histórico do banner):
//   "accepted"            → estatísticos + marketing
//   "essential"           → nada além do funcional
//   "custom:{...json...}" → preferências granulares (formato novo)
//   "custom"              → legado sem preferências guardadas → tratar como só essenciais

const GA_ID = "G-TJZ5EZPWH3";
const STORAGE_KEY = "cookie_consent";

let gtagLoaded = false;

function gtag() {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(arguments);
}

export function readConsent() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null; // ainda sem decisão
  if (raw === "accepted") return { statistics: true, marketing: true };
  if (raw === "essential") return { statistics: false, marketing: false };
  if (raw.startsWith("custom:")) {
    try {
      const p = JSON.parse(raw.slice(7));
      return { statistics: !!p.statistics, marketing: !!p.marketing };
    } catch {
      return { statistics: false, marketing: false };
    }
  }
  // "custom" legado (as preferências não eram guardadas) — assumir o mais restritivo
  return { statistics: false, marketing: false };
}

function loadGtag() {
  if (gtagLoaded) return;
  gtagLoaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  gtag("js", new Date());
  // send_page_view: false — os page_views são enviados por rota (SPA)
  // em Layout.jsx via trackPageView.
  gtag("config", GA_ID, { send_page_view: false });
}

// Chamar uma única vez, no arranque da app (main.jsx), ANTES de qualquer evento.
export function initAnalytics() {
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  const c = readConsent();
  if (c) applyConsent(c);
}

// Chamado pelo CookieBanner quando o visitante decide (e no arranque, se já decidiu).
export function applyConsent({ statistics, marketing }) {
  gtag("consent", "update", {
    analytics_storage: statistics ? "granted" : "denied",
    ad_storage: marketing ? "granted" : "denied",
    ad_user_data: marketing ? "granted" : "denied",
    ad_personalization: marketing ? "granted" : "denied",
  });
  if (statistics) loadGtag();
}

export function trackEvent(name, params = {}) {
  gtag("event", name, params);
}

export function trackPageView(path) {
  gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
