import { Users, FileText, Briefcase, Landmark, Globe, BookOpen } from "lucide-react";

/**
 * Fonte unica de verdade das areas de atuacao.
 * Consumido por: /areas (indice), /areas/{slug} (paginas dedicadas),
 * PracticeAreasGrid (home), sitemap e prerender.
 *
 * Campos de conteudo (desc, when, services) sao os aprovados pela Dra. Vyvian.
 * Campos de SEO (metaTitle, metaDesc) foram escritos para as paginas dedicadas.
 */
export const AREAS = [
  {
    icon: Users,
    slug: "familia",
    title: "Direito de Família",
    desc: "Acompanhamento sensível e rigoroso em questões que afetam a vida familiar e pessoal.",
    when: "Quando procurar: em casos de divórcio, separação, guarda de filhos, pensão de alimentos, regulação do poder parental ou conflitos familiares.",
    services: [
      "Divórcio por mútuo consentimento e litigioso",
      "Partilhas de bens",
      "Responsabilidades parentais",
      "Pensão de alimentos",
      "Adoção e tutela",
      "Violência doméstica",
    ],
    metaTitle: "Advogada de Direito de Família | Divórcio e Parentalidade",
    metaDesc:
      "Apoio jurídico em divórcio, responsabilidades parentais, pensão de alimentos e partilhas. Atendimento em Portugal e Brasil, com acompanhamento próximo.",
  },
  {
    icon: FileText,
    slug: "civil",
    title: "Direito Civil",
    desc: "Proteção dos seus direitos e interesses em relações contratuais e patrimoniais.",
    when: "Quando procurar: em disputas contratuais, questões de propriedade, indemnizações, heranças ou qualquer questão civil.",
    services: [
      "Contratos civis (compra e venda, arrendamento)",
      "Responsabilidade civil e indemnizações",
      "Direitos reais e propriedade",
      "Sucessões e heranças",
      "Direito do consumidor",
    ],
    metaTitle: "Advogada de Direito Civil | Contratos e Heranças",
    metaDesc:
      "Apoio jurídico em contratos, arrendamento, responsabilidade civil, sucessões e heranças. Atendimento em Portugal e Brasil, incluindo casos transfronteiriços.",
  },
  {
    icon: Briefcase,
    slug: "comercial",
    title: "Direito Comercial",
    desc: "Suporte jurídico para empresas e empreendedores na criação e gestão de negócios.",
    when: "Quando procurar: ao constituir uma empresa, negociar contratos comerciais ou resolver disputas empresariais.",
    services: [
      "Constituição de sociedades",
      "Contratos comerciais",
      "Fusões e aquisições",
      "Direito societário",
      "Resolução de litígios comerciais",
    ],
    metaTitle: "Advogada de Direito Comercial | Sociedades e Contratos",
    metaDesc:
      "Apoio jurídico na constituição de sociedades, contratos comerciais, direito societário e litígios empresariais, em Portugal e no Brasil.",
  },
  {
    icon: Landmark,
    slug: "cobranca",
    title: "Cobrança de Dívida",
    desc: "Recuperação eficaz de créditos com estratégias extrajudiciais e judiciais.",
    when: "Quando procurar: quando tem valores em dívida por cobrar, contratos não cumpridos ou precisa de recuperar créditos.",
    services: [
      "Injunções (procedimento europeu e nacional)",
      "Ações executivas",
      "Negociação extrajudicial",
      "Recuperação de crédito",
      "Insolvência e reestruturação",
    ],
    metaTitle: "Advogada | Cobrança de Dívida, Injunções e Ações Executivas",
    metaDesc:
      "Recuperação de créditos por via extrajudicial e judicial: injunções, ações executivas e negociação. Apoio a empresas e particulares em Portugal e Brasil.",
  },
  {
    icon: Globe,
    slug: "nacionalidade",
    title: "Nacionalidade",
    desc: "Assistência completa nos processos de aquisição de nacionalidade e migração.",
    when: "Quando procurar: se pretende adquirir a nacionalidade portuguesa, regularizar a sua situação migratória ou obter autorização de residência.",
    services: [
      "Aquisição de nacionalidade portuguesa",
      "Processos de naturalização",
      "Reagrupamento familiar",
      "Autorização de residência",
      "Vistos e permissões migratórias",
    ],
    metaTitle: "Advogada | Nacionalidade Portuguesa e Naturalização",
    metaDesc:
      "Apoio em nacionalidade portuguesa, naturalização, reagrupamento familiar e autorização de residência, para quem vive entre Portugal e Brasil.",
  },
  {
    icon: BookOpen,
    slug: "notarial",
    title: "Direito Notarial",
    desc: "Orientação especializada em atos notariais e registos, com segurança jurídica.",
    when: "Quando procurar: quando precisa de escrituras, testamentos, procurações ou habilitação de herdeiros.",
    services: [
      "Escrituras públicas",
      "Testamentos",
      "Habilitações de herdeiros",
      "Procurações",
      "Registos e averbamentos",
    ],
    metaTitle: "Advogada de Direito Notarial | Escrituras e Testamentos",
    metaDesc:
      "Apoio em escrituras públicas, testamentos, procurações, habilitação de herdeiros e registos. Atendimento em Portugal e no Brasil.",
  },
];

/** Rotas publicas das paginas dedicadas, usadas pelo sitemap e pelo prerender. */
export const AREA_ROUTES = AREAS.map((a) => `/areas/${a.slug}`);

/**
 * area-slugs.json e' a lista lida pelos scripts de build (Node puro nao resolve
 * os icones do lucide-react importados aqui). Se divergirem, o sitemap e o
 * prerender ficariam dessincronizados desta lista — falhar cedo e' preferivel.
 */
export const AREA_SLUGS = AREAS.map((a) => a.slug);

export const getArea = (slug) => AREAS.find((a) => a.slug === slug);
