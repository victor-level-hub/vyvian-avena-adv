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
  const F  = await doc.embedFont(StandardFonts.TimesRoman);
  const FB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

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

  // local e data
  y -= 18;
  const ld = `${local || "Santa Maria da Feira"}, ${fmtDateLong(data || new Date().toISOString())}.`;
  page.drawText(ld, { x: M, y, size: size, font: F, color: INK });
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

  // rodapé
  page.drawLine({ start: { x: M, y: 56 }, end: { x: width - M, y: 56 }, thickness: 0.5, color: GOLD });
  const rod = "Vyvian Avena \u2014 Advogada \u00b7 Rua Comendador S\u00e1 Couto, 112, 4.\u00ba, Sala 2, 4520-192 Santa Maria da Feira";
  const rodW = sans.widthOfTextAtSize(rod, 7.5);
  page.drawText(rod, { x: (width - rodW) / 2, y: 44, size: 7.5, font: sans, color: MUTE });

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

  // balança da justiça em traço fino, bege claro, centrada (marca d'água do documento real)
  function drawWatermark() {
    const path = [
      "M50 12 L50 74",                 // haste
      "M44 9 Q50 3 56 9",              // topo
      "M20 22 L80 22",                 // travessão
      "M20 22 L11 47 M20 22 L29 47",   // cordas esq.
      "M9 47 L31 47 M9 47 Q20 60 31 47",   // prato esq.
      "M80 22 L71 47 M80 22 L89 47",   // cordas dir.
      "M69 47 L91 47 M69 47 Q80 60 91 47", // prato dir.
      "M40 76 L60 76 M34 82 L66 82",   // base
    ].join(" ");
    const scale = 3.6;               // ~360pt de largura
    const w = 100 * scale;
    const x = (width - w) / 2;
    const yTop = (height / 2) + (86 * scale) / 2 - 40; // centrado verticalmente
    try {
      page.drawSvgPath(path, {
        x, y: yTop, scale,
        borderColor: rgb(0.878, 0.845, 0.775), // bege claro
        borderWidth: 2.4,
        borderOpacity: 0.55,
      });
    } catch (e) { /* marca d'água é decorativa — nunca bloquear a geração */ }
  }
}
