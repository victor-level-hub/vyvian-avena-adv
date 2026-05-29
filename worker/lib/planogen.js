// worker/lib/planogen.js
// Gera o PDF do PLANO DE PAGAMENTO no formato padrão da Dra. Vyvian Avena.
// Mesmo sistema visual dos recibos (pdf-lib, ESM puro, corre em Workers).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COLORS = {
  forest: rgb(0.071, 0.188, 0.165), // #12302a
  gold: rgb(0.722, 0.576, 0.353),   // #b8935a
  cream: rgb(0.961, 0.941, 0.910),  // #f5f0e8
  ink: rgb(0.15, 0.15, 0.15),
  muted: rgb(0.45, 0.45, 0.45),
  line: rgb(0.85, 0.85, 0.85),
  rowAlt: rgb(0.97, 0.96, 0.94),
  late: rgb(0.74, 0.21, 0.18),
  paid: rgb(0.18, 0.49, 0.30),
};

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return `${symbol} ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function statusLabel(s) {
  if (s === 'paid') return { txt: 'Pago', color: COLORS.paid };
  if (s === 'late') return { txt: 'Em atraso', color: COLORS.late };
  if (s === 'due_today') return { txt: 'Vence hoje', color: COLORS.gold };
  return { txt: 'A vencer', color: COLORS.muted };
}

/**
 * @param {object} data - { client, installments[], planNumber, local, issueDate }
 * @returns {Promise<Uint8Array>}
 */
export async function generatePaymentPlanPdf(data) {
  const {
    client: c,
    installments: rawList = [],
    planNumber,
    local,
    issueDate = new Date().toISOString().slice(0, 10),
  } = data;

  // Ordenar por número de parcela
  const list = [...rawList].sort(
    (a, b) => (a.installment_number || 0) - (b.installment_number || 0)
  );
  const currency = list[0]?.currency || (c.country === 'BR' ? 'BRL' : 'EUR');
  const total = list.reduce((s, i) => s + Number(i.amount || 0), 0);
  const paid = list.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0);
  const outstanding = total - paid;

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontSerif = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontSerifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // ===== HEADER =====
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: COLORS.forest });
  page.drawText('VYVIAN AVENA', { x: 50, y: height - 50, size: 24, font: fontSerifBold, color: COLORS.gold });
  page.drawText('A D V O G A D A', { x: 50, y: height - 72, size: 9, font: fontRegular, color: COLORS.gold, characterSpacing: 3 });
  page.drawText('PLANO DE', { x: width - 175, y: height - 47, size: 18, font: fontSerif, color: COLORS.cream });
  page.drawText('PAGAMENTO', { x: width - 175, y: height - 67, size: 18, font: fontSerif, color: COLORS.cream });
  if (planNumber) {
    page.drawText(`Nº ${planNumber}`, { x: width - 175, y: height - 85, size: 10, font: fontRegular, color: COLORS.gold });
  }

  // ===== INFO ESCRITÓRIO + DATA =====
  let y = height - 145;
  page.drawText('Vyvian Avena · Sociedade de Advogados', { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  const officeAddr = c.country === 'BR'
    ? 'Tijuca · Rio de Janeiro · Brasil'
    : 'Rua António Nobre 1D, 3.º DTO · Dream Offices · Cacilhas 2800-260';
  page.drawText(officeAddr, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  page.drawText('vyavenaadv.com · +351 911 831 530', { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });

  page.drawText('Emitido em', { x: width - 175, y: height - 145, size: 8, font: fontRegular, color: COLORS.muted });
  page.drawText(fmtDateLong(issueDate), { x: width - 175, y: height - 158, size: 10, font: fontBold, color: COLORS.ink });

  // ===== LINHA DOURADA =====
  y = height - 200;
  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: COLORS.gold });

  // ===== CLIENTE =====
  y -= 32;
  page.drawText('CLIENTE', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 18;
  page.drawText(c.name, { x: 50, y, size: 14, font: fontSerifBold, color: COLORS.ink });
  y -= 14;
  const idLabel = c.country === 'BR' ? 'CPF/CNPJ' : 'NIF';
  page.drawText(`${idLabel}: ${c.identification || '—'}`, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  if (c.email) {
    page.drawText(c.email, { x: 250, y, size: 9, font: fontRegular, color: COLORS.muted });
  }
  if (c.practice_area) {
    y -= 12;
    page.drawText(`Área: ${c.practice_area}`, { x: 50, y, size: 9, font: fontRegular, color: COLORS.muted });
  }

  // ===== RESUMO (3 caixas) =====
  y -= 38;
  const boxW = (width - 100 - 20) / 3;
  const boxes = [
    { label: 'TOTAL DO PLANO', value: fmtMoney(total, currency), color: COLORS.forest },
    { label: 'JÁ PAGO', value: fmtMoney(paid, currency), color: COLORS.paid },
    { label: 'EM ABERTO', value: fmtMoney(outstanding, currency), color: COLORS.gold },
  ];
  boxes.forEach((b, idx) => {
    const bx = 50 + idx * (boxW + 10);
    page.drawRectangle({ x: bx, y: y - 42, width: boxW, height: 50, color: COLORS.cream });
    page.drawText(b.label, { x: bx + 10, y: y - 8, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });
    page.drawText(b.value, { x: bx + 10, y: y - 30, size: 14, font: fontSerifBold, color: b.color });
  });

  // ===== TABELA DE PARCELAS =====
  y -= 70;
  page.drawText('PARCELAS', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 8;

  const cN = 52, cVenc = 110, cValor = 230, cEstado = 350, cPago = 460;
  const drawTableHead = () => {
    page.drawRectangle({ x: 50, y: y - 16, width: width - 100, height: 18, color: COLORS.forest });
    const hy = y - 11;
    page.drawText('#', { x: cN, y: hy, size: 8, font: fontBold, color: COLORS.cream });
    page.drawText('Vencimento', { x: cVenc, y: hy, size: 8, font: fontBold, color: COLORS.cream });
    page.drawText('Valor', { x: cValor, y: hy, size: 8, font: fontBold, color: COLORS.cream });
    page.drawText('Estado', { x: cEstado, y: hy, size: 8, font: fontBold, color: COLORS.cream });
    page.drawText('Pago em', { x: cPago, y: hy, size: 8, font: fontBold, color: COLORS.cream });
    y -= 16;
  };
  drawTableHead();

  const rowH = 18;
  list.forEach((i, idx) => {
    // Quebra de página
    if (y < 110) {
      page = pdf.addPage([595.28, 841.89]);
      y = height - 60;
      drawTableHead();
    }
    if (idx % 2 === 1) {
      page.drawRectangle({ x: 50, y: y - rowH + 4, width: width - 100, height: rowH, color: COLORS.rowAlt });
    }
    const ry = y - rowH + 9;
    const st = statusLabel(i.status);
    page.drawText(`${i.installment_number}/${i.total_installments}`, { x: cN, y: ry, size: 9, font: fontRegular, color: COLORS.ink });
    page.drawText(fmtDateShort(i.due_date), { x: cVenc, y: ry, size: 9, font: fontRegular, color: COLORS.ink });
    page.drawText(fmtMoney(i.amount, i.currency || currency), { x: cValor, y: ry, size: 9, font: fontBold, color: COLORS.ink });
    page.drawText(st.txt, { x: cEstado, y: ry, size: 9, font: fontRegular, color: st.color });
    page.drawText(i.paid_date ? fmtDateShort(i.paid_date) : '—', { x: cPago, y: ry, size: 9, font: fontRegular, color: COLORS.muted });
    y -= rowH;
  });

  page.drawLine({ start: { x: 50, y: y + 2 }, end: { x: width - 50, y: y + 2 }, thickness: 0.4, color: COLORS.line });
  // Total
  y -= 12;
  page.drawText('TOTAL', { x: cValor - 60, y, size: 9, font: fontBold, color: COLORS.muted });
  page.drawText(fmtMoney(total, currency), { x: cValor, y, size: 11, font: fontSerifBold, color: COLORS.forest });

  // ===== CONDIÇÕES =====
  y -= 40;
  if (y < 160) { page = pdf.addPage([595.28, 841.89]); y = height - 80; }
  page.drawText('CONDIÇÕES', { x: 50, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 16;
  const cond = c.country === 'BR'
    ? 'O pagamento das parcelas deverá ser efetuado até a data de vencimento indicada. O atraso poderá ensejar a cobrança de encargos conforme contrato de honorários firmado entre as partes.'
    : 'O pagamento das prestações deve ser efetuado até à data de vencimento indicada. O atraso poderá implicar a cobrança de encargos nos termos do contrato de honorários celebrado entre as partes.';
  // wrap simples
  const words = cond.split(' ');
  let lineTxt = '';
  const maxW = width - 100;
  for (const w of words) {
    const test = lineTxt ? lineTxt + ' ' + w : w;
    if (fontRegular.widthOfTextAtSize(test, 9) > maxW) {
      page.drawText(lineTxt, { x: 50, y, size: 9, font: fontRegular, color: COLORS.ink });
      y -= 13; lineTxt = w;
    } else lineTxt = test;
  }
  if (lineTxt) { page.drawText(lineTxt, { x: 50, y, size: 9, font: fontRegular, color: COLORS.ink }); y -= 13; }

  // ===== ASSINATURA =====
  y -= 50;
  if (y < 90) { page = pdf.addPage([595.28, 841.89]); y = height - 120; }
  page.drawLine({ start: { x: 50, y }, end: { x: 280, y }, thickness: 0.5, color: COLORS.ink });
  y -= 14;
  page.drawText('Dra. Vyvian Avena', { x: 50, y, size: 10, font: fontSerifBold, color: COLORS.ink });
  y -= 12;
  const orderLabel = c.country === 'BR' ? 'OAB — Advogada' : 'Ordem dos Advogados Portugueses';
  page.drawText(orderLabel, { x: 50, y, size: 8, font: fontRegular, color: COLORS.muted });

  // ===== FOOTER (em todas as páginas) =====
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: 50, y: 60 }, end: { x: width - 50, y: 60 }, thickness: 0.3, color: COLORS.gold });
    p.drawText('Documento gerado eletronicamente · Vyvian Avena Advogada', { x: 50, y: 45, size: 7, font: fontRegular, color: COLORS.muted });
    p.drawText(`${planNumber ? 'Plano Nº ' + planNumber + ' · ' : ''}Pág. ${idx + 1}/${pages.length} · ${new Date().toISOString().slice(0, 10)}`, { x: width - 180, y: 45, size: 7, font: fontRegular, color: COLORS.muted });
  });

  return await pdf.save();
}
