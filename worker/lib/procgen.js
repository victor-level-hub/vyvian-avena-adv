// worker/lib/procgen.js — gerador de PROCURAÇÃO em PDF
// Documento formal A4 no timbrado da Dra. (worker/lib/timbrado.js): título
// local/data e linha de assinatura do outorgante. Texto vem de um template com
// placeholders substituídos pelos dados do cliente + campos editáveis (poderes).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { desenharTimbrado, embutirLogoTimbrado, MARGEM, A4, VERDE_FAIXA, TINTA, TINTA_SUAVE } from "./timbrado.js";

// As cores vivem em timbrado.js — aqui só se usam as de lá.

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

  // O timbrado da Dra. (faixa verde à direita + coluna em marca de água) vem do
  // modelo Word aprovado por ela; ver worker/lib/timbrado.js.
  const logoTimbrado = await embutirLogoTimbrado(doc).catch(() => null);
  let page = doc.addPage(A4);
  desenharTimbrado(page, logoTimbrado);
  const { width, height } = page.getSize();
  // corpo em Helvetica (equivalente Arial das fontes padrão do PDF)
  const F  = await doc.embedFont(StandardFonts.Helvetica);
  const FB = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = F;

  // Margens do modelo: a da direita já conta com a faixa e deixa folga, para
  // nenhuma linha encostar ao verde.
  const M = MARGEM.esquerda;
  const maxW = width - MARGEM.esquerda - MARGEM.direita;

  let y = height - MARGEM.topo - 18;

  // título
  const titulo = "PROCURA\u00c7\u00c3O";
  const tW = FB.widthOfTextAtSize(titulo, 22);
  page.drawText(titulo, { x: M + maxW / 2 - tW / 2, y, size: 22, font: FB, color: VERDE_FAIXA, characterSpacing: 4 });
  y -= 12;
  page.drawLine({ start: { x: M + maxW / 2 - 60, y }, end: { x: M + maxW / 2 + 60, y }, thickness: 1, color: VERDE_FAIXA });
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

  // linha de assinatura do outorgante — nunca na parte de baixo da folha
  if (y < MARGEM.base + 110) {
    page = doc.addPage(A4);
    desenharTimbrado(page, logoTimbrado);
    y = height - MARGEM.topo - 40;
  }
  const sigW = 280;
  const sigX = M + maxW / 2 - sigW / 2;
  page.drawLine({ start: { x: sigX, y }, end: { x: sigX + sigW, y }, thickness: 0.8, color: TINTA });
  y -= 14;
  const oNome = nomeOutorgante || "O(A) Outorgante";
  const onW = F.widthOfTextAtSize(oNome, 10);
  page.drawText(oNome, { x: M + maxW / 2 - onW / 2, y, size: 10, font: F, color: TINTA_SUAVE });
  y -= 12;
  const lbl = "(O(A) Outorgante)";
  const lblW = sans.widthOfTextAtSize(lbl, 8);
  page.drawText(lbl, { x: M + maxW / 2 - lblW / 2, y, size: 8, font: sans, color: TINTA_SUAVE });

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
  // Vira a página quando já não cabe mais uma linha. Antes o texto simplesmente
  // continuava a descer para fora da folha e desaparecia — e com as margens do
  // timbrado, que são mais largas, uma procuração comprida passa disso com
  // facilidade.
  function talvezNovaPagina(yy) {
    if (yy > MARGEM.base + 80) return yy;
    page = doc.addPage(A4);
    desenharTimbrado(page, logoTimbrado);
    return height - MARGEM.topo;
  }

  function drawJustified(tokens, yy) {
    const spaceW = F.widthOfTextAtSize(" ", size);
    let line = [];
    let lineW = 0;
    for (const t of tokens) {
      const tw = wWidth(t);
      const test = lineW + (line.length ? spaceW : 0) + tw;
      if (test > maxW && line.length) {
        yy = talvezNovaPagina(yy);
        drawLine(line, yy, false); yy -= lh; line = [t]; lineW = tw;
      } else { line.push(t); lineW = test; }
    }
    if (line.length) { yy = talvezNovaPagina(yy); drawLine(line, yy, true); yy -= lh; }
    return yy;
  }
  function drawLine(tokens, yy, last) {
    const spaceW = F.widthOfTextAtSize(" ", size);
    const wordsW = tokens.reduce((sum, t) => sum + wWidth(t), 0);
    const gap = (last || tokens.length === 1) ? spaceW : (maxW - wordsW) / (tokens.length - 1);
    let x = M;
    for (const t of tokens) {
      page.drawText(t.w, { x, y: yy, size, font: t.bold ? FB : F, color: TINTA });
      x += wWidth(t) + gap;
    }
  }

  // coluna do logótipo Vyvian Avena (paths do SVG oficial), clareada como marca d'água

}
