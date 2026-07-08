// worker/lib/procgen.js — gerador de PROCURAÇÃO em PDF
// Documento formal A4: cabeçalho com logo, título "PROCURAÇÃO", corpo justificado,
// local/data e linha de assinatura do outorgante. Texto vem de um template com
// placeholders substituídos pelos dados do cliente + campos editáveis (poderes).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_WHITE_PNG } from "./logo.js";

const FOREST = rgb(0.0706, 0.1882, 0.1647);
const GOLD   = rgb(0.7216, 0.5765, 0.3529);
const CREAM  = rgb(0.9608, 0.9412, 0.9098);
const INK    = rgb(0.13, 0.13, 0.13);
const MUTE   = rgb(0.45, 0.45, 0.45);

function fmtDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const meses = ["janeiro","fevereiro","mar\u00e7o","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${parseInt(d,10)} de ${meses[parseInt(m,10)-1]} de ${y}`;
}

// substitui {{campo}} pelos valores; remove placeholders vazios de forma limpa
export function preencherTemplate(corpo, valores) {
  return String(corpo).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = valores[k];
    return (v == null || v === "") ? "[\u2022]" : String(v);
  });
}

// mapeia o cliente do D1 -> valores dos placeholders
export function valoresDoCliente(client) {
  return {
    nome: client.name,
    estado_civil: client.marital_status || "",
    nacionalidade: client.nationality || "",
    morada: client.address || "",
    naturalidade: client.birth_place || "",
    nascimento: client.birth_date || "",
    nif: client.identification || "",
    niss: client.niss || "",
    doc_tipo: client.doc_type || "documento de identifica\u00e7\u00e3o",
    doc_numero: client.doc_number || "",
    doc_validade: client.doc_validity ? fmtDateLong(client.doc_validity) : "",
    filiacao: client.filiation || "",
  };
}

/**
 * @param {object} p
 * @param {string} p.texto         corpo já preenchido (placeholders substituídos)
 * @param {string} p.local         local de emissão (ex.: "Santa Maria da Feira")
 * @param {string} p.data          data ISO da emissão
 * @param {string} p.nomeOutorgante  nome para a linha de assinatura
 * @param {string[]} [p.boldSegments] trechos do corpo a renderizar a negrito (nomes das partes)
 */
export async function generateProcuracaoPDF({ texto, local, data, nomeOutorgante, boldSegments = [] }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Procura\u00e7\u00e3o \u2014 ${nomeOutorgante || ""}`);
  doc.setAuthor("Vyvian Avena Advogada");
  doc.setProducer("vyvian-avena-adv");

  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  // corpo em Helvetica (equivalente Arial das fontes padrão do PDF)
  const F  = await doc.embedFont(StandardFonts.Helvetica);
  const FB = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = F;

  const M = 64;
  const maxW = width - 2 * M;

  // cabeçalho: faixa verde fina com logo
  const headH = 70;
  page.drawRectangle({ x: 0, y: height - headH, width, height: headH, color: FOREST });
  try {
    const logo = await doc.embedPng(LOGO_WHITE_PNG);
    const lh = 42, lw = lh * (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: height - headH / 2 - lh / 2, width: lw, height: lh });
  } catch (e) {
    page.drawText("VYVIAN AVENA", { x: M, y: height - 44, size: 16, font: FB, color: CREAM });
  }

  // marca d'água: balança da justiça estilizada, centrada, bege claro, atrás do texto
  drawWatermark();

  let y = height - headH - 56;

  // título
  const titulo = "PROCURA\u00c7\u00c3O";
  const tW = FB.widthOfTextAtSize(titulo, 22);
  page.drawText(titulo, { x: (width - tW) / 2, y, size: 22, font: FB, color: FOREST, characterSpacing: 4 });
  y -= 12;
  page.drawLine({ start: { x: (width - 120) / 2, y }, end: { x: (width + 120) / 2, y }, thickness: 1, color: GOLD });
  y -= 40;

  // corpo justificado, por parágrafos, com negrito nos trechos indicados (nomes das partes)
  const size = 11.5, lh = 18;
  const boldList = (boldSegments || []).filter((b) => b && b.trim().length > 2);
  for (const para of String(texto).split("\n")) {
    if (para.trim() === "") { y -= lh; continue; }
    y = drawJustified(tokenize(para.trim()), y);
    y -= 6; // espaço entre parágrafos
  }

  // (dateline removida a pedido — a procuração não leva local/data)
  y -= 60;

  // linha de assinatura do outorgante
  const sigW = 280;
  const sigX = (width - sigW) / 2;
  page.drawLine({ start: { x: sigX, y }, end: { x: sigX + sigW, y }, thickness: 0.8, color: INK });
  y -= 14;
  const oNome = nomeOutorgante || "O(A) Outorgante";
  const onW = F.widthOfTextAtSize(oNome, 10);
  page.drawText(oNome, { x: (width - onW) / 2, y, size: 10, font: F, color: MUTE });
  y -= 12;
  const lbl = "(O(A) Outorgante)";
  const lblW = sans.widthOfTextAtSize(lbl, 8);
  page.drawText(lbl, { x: (width - lblW) / 2, y, size: 8, font: sans, color: MUTE });

  return await doc.save();

  // divide o parágrafo em palavras, marcando as que caem dentro de um trecho a negrito
  function tokenize(text) {
    const ranges = [];
    for (const seg of boldList) {
      let idx = 0;
      while ((idx = text.indexOf(seg, idx)) !== -1) {
        ranges.push([idx, idx + seg.length]);
        idx += seg.length;
      }
    }
    const tokens = [];
    let pos = 0;
    for (const w of text.split(" ")) {
      const start = pos, end = pos + w.length;
      const bold = ranges.some(([a, b]) => start < b && end > a);
      tokens.push({ w, bold });
      pos = end + 1;
    }
    return tokens;
  }

  function wWidth(t) { return (t.bold ? FB : F).widthOfTextAtSize(t.w, size); }

  // justificação por palavra com fonte por-token (última linha alinha à esquerda)
  function drawJustified(tokens, yy) {
    const spaceW = F.widthOfTextAtSize(" ", size);
    let line = [];
    let lineW = 0;
    for (const t of tokens) {
      const tw = wWidth(t);
      const test = lineW + (line.length ? spaceW : 0) + tw;
      if (test > maxW && line.length) {
        drawLine(line, yy, false); yy -= lh; line = [t]; lineW = tw;
      } else { line.push(t); lineW = test; }
    }
    if (line.length) { drawLine(line, yy, true); yy -= lh; }
    return yy;
  }
  function drawLine(tokens, yy, last) {
    const spaceW = F.widthOfTextAtSize(" ", size);
    const wordsW = tokens.reduce((sum, t) => sum + wWidth(t), 0);
    const gap = (last || tokens.length === 1) ? spaceW : (maxW - wordsW) / (tokens.length - 1);
    let x = M;
    for (const t of tokens) {
      page.drawText(t.w, { x, y: yy, size, font: t.bold ? FB : F, color: INK });
      x += wWidth(t) + gap;
    }
  }

  // coluna do logótipo Vyvian Avena (paths do SVG oficial), clareada como marca d'água
  function drawWatermark() {
    // viewBox original: 0 0 146 201
    const PATHS = [
      "M36.1334 4.8665C35.0667 10.1998 32.2667 12.9998 26 14.5998L21.3334 15.9332L27.4667 18.5998C31.6 20.4665 34 22.4665 34.9334 25.1332C35.7334 27.2665 36.8 30.1998 37.3334 31.6665C38.2667 33.9332 38.5334 33.5332 39.6 29.3998C41.0667 23.9332 47.3334 17.6665 51.4667 17.6665C55.4667 17.6665 54.4 15.3998 50 14.5998C44.9334 13.5332 40.8 9.39983 39.7334 4.33316C38.8 -1.00017 37.2 -0.733505 36.1334 4.8665Z",
      "M16 40.9999C6.13335 44.4666 -0.666652 56.4666 1.33335 66.8666C2.40001 72.3333 10.4 80.9999 15.7333 82.3332C21.4667 83.7999 27.8667 81.9332 32 77.7999C39.6 69.7999 35.3334 56.3333 25.2 56.3333C20 56.3333 17.6 58.8666 18.2667 63.9332C18.6667 67.1332 19.2 67.6666 23.0667 67.6666C28.1333 67.6666 28.6667 70.0666 24 73.1332C15.6 78.5999 6.66668 66.3333 11.6 55.6666C14.6667 48.9999 18 48.3332 50 48.3332H79.3334V55.6666V62.9999H60.6667H42V67.6666V72.3333H60.6667H79.3334L79.6 125.267C79.7334 154.467 80 179.533 80.1334 181C80.2667 182.467 80.4 187.4 80.5334 192.067L80.6667 200.333L89.3334 193.533L98 186.733V138.333C98 86.5999 98.1334 85.5332 104.667 87.6666C107.333 88.4666 107.333 89.2666 107.333 134.467C107.333 159.667 107.733 180.333 108.133 180.333C108.533 180.333 111.467 178.467 114.8 176.333L120.667 172.2V126.867V81.5332L124.667 79.2666C127.467 77.7999 128.667 76.0666 128.4 74.3332C128 71.7999 126.8 71.6666 104.4 71.2666C81.7334 70.9999 80.6667 70.8666 80.6667 68.3333C80.6667 65.7999 81.6 65.6666 100.8 65.6666C111.733 65.6666 123.467 64.9999 126.533 64.1999C134.4 62.1999 141.333 56.1999 144 48.9999C148.133 38.3332 152.4 38.9999 83.0667 38.9999C33.4667 39.1332 20.2667 39.5332 16 40.9999Z",
      "M38.2667 85.1332C35.3334 87.1332 35.3334 87.5332 35.3334 122.2V157.267L42.1334 161.533C45.8667 163.8 49.0667 165.667 49.4667 165.667C49.7334 165.667 50 148.2 50 127C50 90.0665 49.8667 88.1998 47.3334 85.6665C44.1334 82.4665 42.2667 82.3332 38.2667 85.1332Z",
      "M59.3334 85.6666C56.8001 88.2 56.6667 90.0666 56.6667 129.667V170.867L63.4667 177.267C67.2001 180.733 70.8001 183.933 71.4667 184.067C72.1334 184.333 72.6667 164.733 72.6667 137.267C72.6667 91.5333 72.5334 89.9333 69.8667 86.4666C66.6667 82.3333 62.9334 82.0666 59.3334 85.6666Z",
    ];
    const scale = 2.3;                       // 146 x 2.3 ≈ 336pt de largura
    const w = 146 * scale, h = 201 * scale;
    const x = (width - w) / 2;
    const yTop = height / 2 + h / 2 - 24;    // centrada verticalmente
    const LIGHT = rgb(0.845, 0.895, 0.878);  // tom do logótipo, clareado (efeito marca d'água)
    try {
      for (const d of PATHS) {
        page.drawSvgPath(d, { x, y: yTop, scale, color: LIGHT, opacity: 0.55 });
      }
    } catch (e) { /* decorativa — nunca bloquear a geração */ }
  }

}
