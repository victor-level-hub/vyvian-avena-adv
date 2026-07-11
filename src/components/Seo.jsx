import { Helmet } from "react-helmet-async";

const SITE = "https://vyavenaadv.com";
const OG_IMAGE = `${SITE}/og-image.jpg`;
const SITE_NAME = "Vyvian Avena Advogada";

/**
 * Metadados por rota.
 * title  → 50-60 caracteres (o sufixo da marca é acrescentado quando cabe)
 * desc   → 150-160 caracteres
 */
export const ROUTE_META = {
  "/": {
    title: "Vyvian Avena Advogada | Direito de Família, Civil e Comercial",
    desc: "Advocacia em Portugal e Brasil: Direito de Família, Civil e Comercial. Atendimento humanizado em Cacilhas, Santa Maria da Feira e Barra Olímpica.",
  },
  "/sobre": {
    title: "Sobre a Dra. Vyvian Avena | Advogada em Portugal e Brasil",
    desc: "Conheça a Dra. Vyvian Avena: experiência em dupla jurisdição Portugal-Brasil, especialização em Direito de Família e Civil, com abordagem humanizada.",
  },
  "/areas": {
    title: "Áreas de Atuação | Família, Civil, Comercial e Nacionalidade",
    desc: "Direito de Família, Civil, Comercial, Nacionalidade e Cobrança de Dívida. Divórcio, responsabilidades parentais, partilhas, contratos e indemnizações.",
  },
  "/apoio": {
    title: "Apoio ao Cliente | Perguntas Frequentes e Como Funciona",
    desc: "Como decorre a primeira consulta, que documentos levar, consultas por videochamada e apoio a brasileiros em Portugal. Respostas às dúvidas mais comuns.",
  },
  "/contacto": {
    title: "Contacto | Marcação de Consulta em Portugal e Brasil",
    desc: "Marque a sua consulta com a Dra. Vyvian Avena. Escritórios em Cacilhas, Santa Maria da Feira e Barra Olímpica. Resposta em 24 a 48 horas úteis.",
  },
  "/blog": {
    title: "Blogue | Vyvian Avena Advogada",
    desc: "Artigos sobre os problemas jurídicos de quem vive entre Portugal e o Brasil: divórcio, herança, responsabilidades parentais e mais.",
  },
  "/404": {
    title: "Página não encontrada | Vyvian Avena Advogada",
    desc: "A página que procura não existe ou foi movida.",
  },
  "/politica-cookies": {
    title: "Política de Cookies | Vyvian Avena Advogada",
    desc: "Informação sobre a utilização de cookies no sítio de Vyvian Avena Advogada e como pode gerir as suas preferências de privacidade.",
  },
};

/**
 * Perguntas frequentes de /apoio, para o rich result FAQPage.
 * Mantém-se sincronizado com o array FAQS em src/pages/Apoio.jsx
 */
export const FAQ_JSONLD = (faqs) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

/**
 * jsonLd aceita um objecto ou um array de objectos (ex.: Service + BreadcrumbList).
 * title/desc permitem rotas dinamicas que nao constam do ROUTE_META (ex.: /areas/{slug}).
 */
export default function Seo({ path, jsonLd, title, desc, image, noindex: noindexProp = false }) {
  // A /404 nunca e' indexada. O prop noindex serve para conteudo em revisao
  // (ex.: blogue com blog.json publicado=false): existe no URL real mas fora
  // do indice e do sitemap ate' ser aprovado.
  const noindex = path === "/404" || noindexProp;
  const fallback = ROUTE_META[path] || ROUTE_META["/"];
  const meta = {
    title: title || fallback.title,
    desc: desc || fallback.desc,
  };
  const canonical = path === "/" ? `${SITE}/` : `${SITE}${path}`;
  // og:image por pagina (ex.: artigos do blogue). Caminho relativo vira absoluto —
  // o WhatsApp e o Facebook exigem URL absoluto na og:image.
  const ogImage = image ? (image.startsWith("http") ? image : `${SITE}${image}`) : OG_IMAGE;
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.desc} />
      {noindex ? (
        <meta name="robots" content="noindex, follow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}
      {!noindex && <link rel="canonical" href={canonical} />}

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="pt_PT" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.desc} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="Vyvian Avena — Advogada" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.desc} />
      <meta name="twitter:image" content={ogImage} />

      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(block)}
        </script>
      ))}
    </Helmet>
  );
}
