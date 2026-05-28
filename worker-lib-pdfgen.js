// worker/lib/pdfgen.js
// Geração de recibos PDF usando pdf-lib.
// pdf-lib é ESM puro, funciona em Workers (sem dependências nativas).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COLORS = {
  forest: rgb(0.071, 0.188, 0.165),  // #12302a — verde-floresta
  gold: rgb(0.722, 0.576, 0.353),    // #b8935a — dourado
  cream: rgb(0.961, 0.941, 0.910),   // #f5f0e8
  ink: rgb(0.15, 0.15, 0.15),
  muted: rgb(0.45, 0.45, 0.45),
  line: rgb(0.85, 0.85, 0.85),
};

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return `${symbol} ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Gera um recibo em PDF.
 * @param {object} data - { installment, client, receiptNumber }
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateReceiptPdf(data) {
  const { installment: i, client: c, receiptNumber } = data;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontSerif = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontSerifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // ===== HEADER (faixa verde-floresta) =====
  page.drawRectangle({
    x: 0, y: height - 110,
    width, height: 110,
    color: COLORS.forest,
  });

  // Título escritório
  page.drawText('VYVIAN AVENA', {
    x: 50, y: height - 50,
    size: 24,
    font: fontSerifBold,
    color: COLORS.gold,
  });
  page.drawText('A D V O G A D A', {
    x: 50, y: height - 72,
    size: 9,
    font: fontRegular,
    color: COLORS.gold,
    characterSpacing: 3,
  });

  // RECIBO no canto direito
  page.drawText('RECIBO', {
    x: width - 140, y: height - 50,
    size: 22,
    font: fontSerif,
    color: COLORS.cream,
  });
  page.drawText(`Nº ${receiptNumber}`, {
    x: width - 140, y: height - 72,
    size: 10,
    font: fontRegular,
    color: COLORS.gold,
  });

  // ===== INFO DO ESCRITÓRIO =====
  let y = height - 145;
  page.drawText('Vyvian Avena · Sociedade de Advogados', { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  const officeAddr = c.country === 'BR'
    ? 'Tijuca · Rio de Janeiro · Brasil'
    : 'Cacilhas · Santa Maria da Feira · Portugal';
  page.drawText(officeAddr, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  page.drawText('vyavenaadv.com', { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });

  // Data de emissão (direita)
  page.drawText('Emitido em', { x: width - 140, y: height - 145, size: 8, font: fontRegular, color: COLORS.muted });
  page.drawText(fmtDate(i.paid_date || new Date().toISOString().slice(0, 10)), {
    x: width - 140, y: height - 158,
    size: 10, font: fontBold, color: COLORS.ink,
  });

  // ===== LINHA DOURADA SEPARADORA =====
  y = height - 200;
  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 0.5,
    color: COLORS.gold,
  });

  // ===== CORPO DO RECIBO =====
  y -= 35;
  page.drawText('RECEBI DE', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 18;
  page.drawText(c.name, { x: 50, y, size: 14, font: fontSerifBold, color: COLORS.ink });

  y -= 14;
  const idLabel = c.country === 'BR' ? 'CPF/CNPJ' : 'NIF';
  const idValue = c.identification || '—';
  page.drawText(`${idLabel}: ${idValue}`, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });

  if (c.email) {
    y -= 12;
    page.drawText(c.email, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  }

  // ===== QUANTIA =====
  y -= 40;
  page.drawText('A QUANTIA DE', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 22;
  page.drawText(fmtMoney(i.amount, i.currency), {
    x: 50, y, size: 28,
    font: fontSerifBold, color: COLORS.forest,
  });

  // ===== DESCRIÇÃO =====
  y -= 45;
  page.drawText('REFERENTE A', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 16;

  const description = `Honorários advocatícios · Parcela ${i.installment_number}/${i.total_installments}`;
  page.drawText(description, { x: 50, y, size: 11, font: fontRegular, color: COLORS.ink });

  if (i.notes) {
    y -= 14;
    const truncated = i.notes.length > 80 ? i.notes.slice(0, 77) + '...' : i.notes;
    page.drawText(truncated, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  }

  // ===== TABELA DE DETALHES =====
  y -= 45;
  page.drawLine({ start: { x: 50, y: y + 18 }, end: { x: width - 50, y: y + 18 }, thickness: 0.3, color: COLORS.line });

  const detailY = y;
  const col1x = 50, col2x = 220, col3x = 360, col4x = width - 130;

  page.drawText('Data de vencimento', { x: col1x, y: detailY, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });
  page.drawText('Data de pagamento', { x: col2x, y: detailY, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });
  page.drawText('Forma', { x: col3x, y: detailY, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });
  page.drawText('Valor', { x: col4x, y: detailY, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });

  y = detailY - 14;
  page.drawText(fmtDateShort(i.due_date), { x: col1x, y, size: 10, font: fontRegular, color: COLORS.ink });
  page.drawText(fmtDateShort(i.paid_date), { x: col2x, y, size: 10, font: fontRegular, color: COLORS.ink });
  page.drawText(i.payment_method || 'Transferência', { x: col3x, y, size: 10, font: fontRegular, color: COLORS.ink });
  page.drawText(fmtMoney(i.amount, i.currency), { x: col4x, y, size: 10, font: fontBold, color: COLORS.ink });

  page.drawLine({ start: { x: 50, y: y - 8 }, end: { x: width - 50, y: y - 8 }, thickness: 0.3, color: COLORS.line });

  // ===== DECLARAÇÃO =====
  y -= 55;
  const declaration = c.country === 'BR'
    ? 'Por ser verdade, dou plena, geral e irrevogável quitação da quantia acima recebida.'
    : 'Pela presente, dou plena, geral e irrevogável quitação da quantia acima recebida.';
  page.drawText(declaration, { x: 50, y, size: 10, font: fontRegular, color: COLORS.ink });

  // ===== ASSINATURA =====
  y -= 80;
  page.drawLine({
    start: { x: 50, y },
    end: { x: 280, y },
    thickness: 0.5, color: COLORS.ink,
  });
  y -= 14;
  page.drawText('Dra. Vyvian Avena', { x: 50, y, size: 10, font: fontSerifBold, color: COLORS.ink });
  y -= 12;
  const orderLabel = c.country === 'BR' ? 'OAB/RJ — Advogada' : 'Ordem dos Advogados Portugueses';
  page.drawText(orderLabel, { x: 50, y, size: 8, font: fontRegular, color: COLORS.muted });

  // ===== FOOTER =====
  page.drawLine({
    start: { x: 50, y: 60 },
    end: { x: width - 50, y: 60 },
    thickness: 0.3, color: COLORS.gold,
  });
  page.drawText('Este recibo foi gerado eletronicamente e tem validade fiscal.', {
    x: 50, y: 45, size: 7, font: fontRegular, color: COLORS.muted,
  });
  page.drawText(`Recibo Nº ${receiptNumber} · Parcela ${i.id} · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, {
    x: 50, y: 33, size: 7, font: fontRegular, color: COLORS.muted,
  });

  return await pdf.save();
}
