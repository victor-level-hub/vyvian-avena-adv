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
 */
export async function generateProcuracaoPDF({ texto, local, data, nomeOutorgante }) {
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
    const lh = 34, lw = lh * (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: height - headH / 2 - lh / 2, width: lw, height: lh });
  } catch (e) {
    page.drawText("VYVIAN AVENA", { x: M, y: height - 44, size: 16, font: FB, color: CREAM });
  }

  let y = height - headH - 56;

  // título
  const titulo = "PROCURA\u00c7\u00c3O";
  const tW = FB.widthOfTextAtSize(titulo, 22);
  page.drawText(titulo, { x: (width - tW) / 2, y, size: 22, font: FB, color: FOREST, characterSpacing: 4 });
  y -= 12;
  page.drawLine({ start: { x: (width - 120) / 2, y }, end: { x: (width + 120) / 2, y }, thickness: 1, color: GOLD });
  y -= 40;

  // corpo justificado, por parágrafos
  const size = 11.5, lh = 18;
  for (const para of String(texto).split("\n")) {
    if (para.trim() === "") { y -= lh; continue; }
    y = drawJustified(para.trim(), y);
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

  // justificação simples por palavra (último parágrafo/linha alinha à esquerda)
  function drawJustified(text, yy) {
    const words = text.split(" ");
    let line = [];
    for (let i = 0; i < words.length; i++) {
      const test = [...line, words[i]].join(" ");
      if (F.widthOfTextAtSize(test, size) > maxW && line.length) {
        drawLine(line, yy, false); yy -= lh; line = [words[i]];
      } else line.push(words[i]);
    }
    if (line.length) { drawLine(line, yy, true); yy -= lh; }
    return yy;
  }
  function drawLine(words, yy, last) {
    if (last || words.length === 1) {
      page.drawText(words.join(" "), { x: M, y: yy, size, font: F, color: INK });
      return;
    }
    const textW = words.reduce((s, w) => s + F.widthOfTextAtSize(w, size), 0);
    const gap = (maxW - textW) / (words.length - 1);
    let x = M;
    for (const w of words) {
      page.drawText(w, { x, y: yy, size, font: F, color: INK });
      x += F.widthOfTextAtSize(w, size) + gap;
    }
  }
}
