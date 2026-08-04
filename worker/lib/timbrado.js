// worker/lib/timbrado.js — o papel timbrado da Dra. Vyvian Avena.
//
// Reproduz o modelo Word aprovado por ela ("EXEMPLO Timbrado Dra Vyvian.docx"):
// página branca, faixa fina no topo, faixa verde na margem direita — estreita em
// cima, mais larga a partir do meio da página — e o logótipo da coluna em verde
// muito claro, como marca de água atrás do texto.
//
// A geometria abaixo foi medida no PNG do modelo (1414x2000, proporção A4) e está
// escrita em FRAÇÕES da página, para o desenho acompanhar qualquer formato.
//
// UMA DIFERENÇA DELIBERADA face ao modelo: a faixa larga de baixo foi ESTREITADA
// (o «corte» pedido). No original ocupava 17,2% da largura da página e entrava
// ~17pt dentro da área de texto; agora ocupa 10% e fica toda dentro da margem
// direita, dando ao texto o respiro que faltava. Ver CORTE_FAIXA mais abaixo.
import { rgb } from "pdf-lib";
import { LOGO_TIMBRADO_PNG, LOGO_TIMBRADO_W, LOGO_TIMBRADO_H } from "./logo-timbrado.js";

export const A4 = [595.28, 841.89];

// cores medidas no modelo
export const VERDE_FAIXA = rgb(81 / 255, 145 / 255, 139 / 255);   // #51918b
export const VERDE_LOGO  = rgb(211 / 255, 227 / 255, 226 / 255);  // #d3e3e2
export const TINTA       = rgb(0.13, 0.13, 0.13);
export const TINTA_SUAVE = rgb(0.42, 0.42, 0.42);

// ── geometria, em frações da página ─────────────────────────────────────────
const TOPO_H      = 0.015;   // faixa fina do topo (1,5% da altura)
const FAIXA_FINA  = 0.0396;  // largura da faixa em cima (3,96% da largura)
const FAIXA_LARGA_ORIGINAL = 0.1719; // como vinha no Word
export const CORTE_FAIXA = 0.42;     // fatia retirada à faixa larga (o «corte» pedido)
const FAIXA_LARGA = FAIXA_LARGA_ORIGINAL * (1 - CORTE_FAIXA); // ≈ 0,0997

const CURVA_TOPO_INI = 0.02;  // onde começa o canto arredondado (fração da altura)
const CURVA_TOPO_FIM = 0.10;  // onde termina
const ALARGA_INI     = 0.52;  // onde a faixa começa a alargar
const ALARGA_FIM     = 0.60;  // onde fica com a largura de baixo

const K = 0.5523; // aproximação de um quarto de círculo por cúbica de Bézier

// Margens de texto que respeitam a faixa. A da direita conta com a faixa larga e
// deixa uma folga, para nenhuma linha encostar ao verde.
export const MARGEM = {
  topo: 70.9,      // 2,5 cm
  base: 70.9,
  esquerda: 85.05, // 3 cm
  get direita() { return Math.max(85.05, A4[0] * FAIXA_LARGA + 22); },
};

// Largura útil de escrita.
export const LARGURA_UTIL = A4[0] - MARGEM.esquerda - MARGEM.direita;

/**
 * Desenha o timbrado numa página. Chamar ANTES de escrever o texto — o logótipo
 * é marca de água e tem de ficar por baixo.
 *
 * @param {PDFPage} page
 * @param {PDFImage} logo  imagem já embutida (ver embutirLogoTimbrado)
 */
export function desenharTimbrado(page, logo) {
  const { width: W, height: H } = page.getSize();

  // 1) fundo verde por baixo de tudo…
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: VERDE_FAIXA });

  // 2) …e a área branca por cima, que é o que dá a forma à faixa.
  //    Coordenadas SVG (y para baixo) com origem no canto superior esquerdo.
  const topo   = H * TOPO_H;
  const xFina  = W * (1 - FAIXA_FINA);
  const xLarga = W * (1 - FAIXA_LARGA);
  const cIni   = H * CURVA_TOPO_INI;
  const cFim   = H * CURVA_TOPO_FIM;
  const aIni   = H * ALARGA_INI;
  const aFim   = H * ALARGA_FIM;

  const rx = xFina - W * 0.834;  // raio horizontal do canto de cima
  const ry = cFim - cIni;        // raio vertical
  const dx = xFina - xLarga;     // recuo da faixa larga
  const dy = aFim - aIni;

  const branco = [
    `M 0 ${topo}`,
    `L ${xFina - rx} ${cIni}`,
    // canto superior direito arredondado
    `C ${xFina - rx + K * rx} ${cIni} ${xFina} ${cFim - K * ry} ${xFina} ${cFim}`,
    `L ${xFina} ${aIni}`,
    // a faixa alarga: curva côncava até à largura de baixo
    `C ${xFina} ${aIni + K * dy} ${xLarga + K * dx} ${aFim} ${xLarga} ${aFim}`,
    `L ${xLarga} ${H}`,
    `L 0 ${H}`,
    "Z",
  ].join(" ");

  page.drawSvgPath(branco, { x: 0, y: H, color: rgb(1, 1, 1), borderWidth: 0 });

  // 3) marca de água: logótipo centrado à esquerda, atrás do texto
  if (logo) {
    const larg = W * 0.4356;                                  // 616 px do modelo
    const alt  = larg * (LOGO_TIMBRADO_H / LOGO_TIMBRADO_W);
    page.drawImage(logo, {
      x: W * 0.434 - larg / 2,
      y: H * 0.5 - alt / 2,
      width: larg,
      height: alt,
    });
  }
}

/** Embute o logótipo uma só vez por documento (pdf-lib reutiliza-o em cada página). */
export function embutirLogoTimbrado(doc) {
  return doc.embedPng(LOGO_TIMBRADO_PNG);
}

/** Cria uma página A4 já timbrada. */
export async function novaPaginaTimbrada(doc, logo) {
  const page = doc.addPage(A4);
  desenharTimbrado(page, logo);
  return page;
}
