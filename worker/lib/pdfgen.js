// worker/lib/pdfgen.js — Fase 3
// Gera o recibo PDF (A4) com pdf-lib. Puro JS, corre no Cloudflare Worker.
// Design: verde-floresta #12302a + dourado #b8935a + creme #f5f0e8.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_WHITE_PNG } from "./logo.js";

// ── Cores ─────────────────────────────────────────────
const FOREST = rgb(0.0706, 0.1882, 0.1647); // #12302a
const GOLD   = rgb(0.7216, 0.5765, 0.3529); // #b8935a
const CREAM  = rgb(0.9608, 0.9412, 0.9098); // #f5f0e8
const INK    = rgb(0.13, 0.13, 0.13);
const MUTE   = rgb(0.45, 0.45, 0.45);
const WHITE  = rgb(1, 1, 1);

// ── Identidade profissional (CONFIRMA a cédula/OAB) ──
const ORDEM = {
  PT: { nome: "Dra. Vyvian Avena", linha: "Advogada \u00b7 Ordem dos Advogados (Portugal)", reg: "C\u00e9d. Prof. 60987P" },
  BR: { nome: "Dra. Vyvian Avena", linha: "Advogada \u00b7 OAB", reg: "OAB/RJ \u2014 (confirmar)" },
};

// ── Helpers de formatação (sem ICU/Intl, robusto no Worker) ──
function fmtMoney(amount, currency) {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  const [int, dec] = n.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = `${grouped},${dec}`;
  if (currency === "BRL") return `R$ ${body}`;
  if (currency === "EUR") return `${body} \u20ac`;
  if (currency === "USD") return `$ ${body}`;
  return `${body} ${currency || ""}`.trim();
}
function fmtDate(iso) {
  if (!iso) return "\u2014";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * @param {object} p
 * @param {object} p.client       linha da tabela clients
 * @param {object} p.installment  linha da tabela installments
 * @param {string} p.receiptNumber  ex: "2026-0007"
 * @returns {Promise<Uint8Array>}
 */
export async function generateReciboPDF({ client, installment, receiptNumber }) {
  const country = (client.country || "PT").toUpperCase();
  const ordem = ORDEM[country] || ORDEM.PT;
  const currency = installment.currency || (country === "BR" ? "BRL" : "EUR");

  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${receiptNumber} \u2014 ${client.name}`);
  doc.setAuthor("Vyvian Avena Advogada");
  doc.setProducer("vyvian-avena-adv");

  const page = doc.addPage([595.28, 841.89]); // A4 retrato
  const { width, height } = page.getSize();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 56; // margem
  const text = (s, x, y, { font = serif, size = 11, color = INK, spacing = 0 } = {}) =>
    page.drawText(String(s == null ? "" : s), { x, y, size, font, color, characterSpacing: spacing });
  const label = (s, x, y) => text(s.toUpperCase(), x, y, { font: sansB, size: 8, color: GOLD, spacing: 1.5 });

  // ── Cabeçalho ────────────────────────────────────────
  const headH = 96;
  page.drawRectangle({ x: 0, y: height - headH, width, height: headH, color: FOREST });
  // Logo branca embutida (PNG). Fallback para wordmark de texto se algo falhar.
  try {
    const logo = await doc.embedPng(LOGO_WHITE_PNG);
    const logoH = 46;
    const logoW = logoH * (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: height - headH / 2 - logoH / 2, width: logoW, height: logoH });
  } catch (e) {
    text("VYVIAN AVENA", M, height - 46, { font: serifB, size: 20, color: CREAM, spacing: 2 });
    text("A D V O G A D A", M, height - 64, { font: sans, size: 9, color: GOLD, spacing: 3 });
  }
  // bloco recibo nº (à direita)
  const rn = `RECIBO N\u00ba ${receiptNumber}`;
  const rnW = serifB.widthOfTextAtSize(rn, 13);
  text(rn, width - M - rnW, height - 46, { font: serifB, size: 13, color: GOLD });
  const dt = `Data: ${fmtDate(installment.paid_date)}`;
  const dtW = sans.widthOfTextAtSize(dt, 9);
  text(dt, width - M - dtW, height - 64, { font: sans, size: 9, color: CREAM });

  let y = height - headH - 44;

  // ── Recebi de ───────────────────────────────────────
  label("Recebi de", M, y); y -= 20;
  text(client.name, M, y, { font: serifB, size: 15, color: FOREST }); y -= 18;
  const ident = client.identification ? `${country === "BR" ? "CPF/CNPJ" : "NIF"}: ${client.identification}` : null;
  const detLine = [ident, client.email].filter(Boolean).join("   \u00b7   ");
  if (detLine) { text(detLine, M, y, { font: sans, size: 10, color: MUTE }); y -= 26; }
  else { y -= 8; }

  // ── A quantia de ────────────────────────────────────
  label("A quantia de", M, y); y -= 30;
  text(fmtMoney(installment.amount, currency), M, y, { font: serifB, size: 30, color: FOREST });
  y -= 34;

  // ── Referente a ─────────────────────────────────────
  label("Referente a", M, y); y -= 18;
  const ref = `Honor\u00e1rios advocat\u00edcios \u00b7 Parcela ${installment.installment_number}/${installment.total_installments}`;
  text(ref, M, y, { font: serif, size: 12, color: INK }); y -= 34;

  // ── Tabela de detalhe ───────────────────────────────
  const cols = [
    { t: "VENCIMENTO", v: fmtDate(installment.due_date) },
    { t: "PAGAMENTO", v: fmtDate(installment.paid_date) },
    { t: "FORMA", v: installment.payment_method || "\u2014" },
    { t: "VALOR", v: fmtMoney(installment.amount, currency) },
  ];
  const tableY = y;
  const rowH = 40;
  page.drawRectangle({ x: M, y: tableY - rowH, width: width - 2 * M, height: rowH, color: CREAM });
  const colW = (width - 2 * M) / cols.length;
  cols.forEach((c, i) => {
    const cx = M + i * colW + 12;
    text(c.t, cx, tableY - 15, { font: sansB, size: 7.5, color: GOLD, spacing: 1 });
    text(c.v, cx, tableY - 31, { font: serifB, size: 11, color: FOREST });
  });
  y = tableY - rowH - 36;

  // ── Declaração de quitação ──────────────────────────
  label("Declara\u00e7\u00e3o", M, y); y -= 18;
  const quit = country === "BR"
    ? "Para clareza e como documento de quita\u00e7\u00e3o, declaro haver recebido a import\u00e2ncia acima discriminada, dando plena, geral e irrevog\u00e1vel quita\u00e7\u00e3o, para nada mais reclamar a este t\u00edtulo."
    : "Para os devidos efeitos, declaro ter recebido a quantia acima indicada, referente aos honor\u00e1rios discriminados, dando da mesma plena e integral quita\u00e7\u00e3o.";
  // word wrap simples
  const maxW = width - 2 * M;
  const words = quit.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (serif.widthOfTextAtSize(test, 10.5) > maxW) {
      text(line, M, y, { font: serif, size: 10.5, color: INK }); y -= 16; line = w;
    } else line = test;
  }
  if (line) { text(line, M, y, { font: serif, size: 10.5, color: INK }); y -= 16; }

  // ── Assinatura ──────────────────────────────────────
  const sigY = 150;
  const sigX = width - M - 220;
  page.drawLine({ start: { x: sigX, y: sigY + 4 }, end: { x: width - M, y: sigY + 4 }, thickness: 0.8, color: GOLD });
  const nameW = serifB.widthOfTextAtSize(ordem.nome, 12);
  text(ordem.nome, sigX + (220 - nameW) / 2, sigY - 12, { font: serifB, size: 12, color: FOREST });
  const lW = sans.widthOfTextAtSize(ordem.linha, 8.5);
  text(ordem.linha, sigX + (220 - lW) / 2, sigY - 26, { font: sans, size: 8.5, color: MUTE });
  const rW = sans.widthOfTextAtSize(ordem.reg, 8.5);
  text(ordem.reg, sigX + (220 - rW) / 2, sigY - 38, { font: sans, size: 8.5, color: MUTE });

  // ── Rodapé ──────────────────────────────────────────
  page.drawLine({ start: { x: M, y: 70 }, end: { x: width - M, y: 70 }, thickness: 0.5, color: GOLD });
  const stamp = `ID ${client.id}/${installment.id} \u00b7 Gerado em ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC \u00b7 Documento gerado eletronicamente`;
  text(stamp, M, 56, { font: sans, size: 7.5, color: MUTE });

  return await doc.save();
}
