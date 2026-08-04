// worker/lib/planogen.js
// Gera o PDF do PLANO DE PAGAMENTO no formato padrão da Dra. Vyvian Avena.
// Mesmo sistema visual dos recibos (pdf-lib, ESM puro, corre em Workers).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { desenharTimbrado, embutirLogoTimbrado, MARGEM, A4, VERDE_FAIXA } from './timbrado.js';

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
  // valor ilegivel vale zero: NaN num plano de honorarios e pior do que um zero
  if (!Number.isFinite(Number(amount))) amount = 0;
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
  // sem isto o plano saia sem autoria nenhuma, ao contrario do recibo e da procuracao
  pdf.setTitle(`Plano de pagamento${planNumber ? ' ' + planNumber : ''} — ${c.name || ''}`.trim());
  pdf.setAuthor('Vyvian Avena Advogada');
  pdf.setProducer('vyvian-avena-adv');
  // timbrado da Dra. (ver worker/lib/timbrado.js) — a faixa verde fica à direita,
  // por isso o conteúdo respeita MARGEM em vez dos 50pt de antes.
  const logoTimbrado = await embutirLogoTimbrado(pdf).catch(() => null);
  let page = pdf.addPage(A4);
  desenharTimbrado(page, logoTimbrado);
  const { width, height } = page.getSize();
  const ML = MARGEM.esquerda;              // margem esquerda
  const MR = MARGEM.direita;               // margem direita (já conta com a faixa)
  const DIR = width - MR;                  // limite direito do conteúdo

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontSerif = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontSerifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // ===== CABEÇALHO (sobre o timbrado, já não há barra escura) =====
  page.drawText('VYVIAN AVENA', { x: ML, y: height - 78, size: 22, font: fontSerifBold, color: VERDE_FAIXA });
  page.drawText('A D V O G A D A', { x: ML, y: height - 96, size: 8.5, font: fontRegular, color: COLORS.muted, characterSpacing: 3 });
  const tituloDoc = 'PLANO DE PAGAMENTO';
  const twDoc = fontSerif.widthOfTextAtSize(tituloDoc, 15);
  page.drawText(tituloDoc, { x: DIR - twDoc, y: height - 78, size: 15, font: fontSerif, color: COLORS.ink });
  if (planNumber) {
    const nw = fontRegular.widthOfTextAtSize(`Nº ${planNumber}`, 10);
    page.drawText(`Nº ${planNumber}`, { x: DIR - nw, y: height - 96, size: 10, font: fontRegular, color: COLORS.muted });
  }

  // ===== INFO ESCRITÓRIO + DATA =====
  let y = height - 145;
  page.drawText('Vyvian Avena · Sociedade de Advogados', { x: ML, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  const officeAddr = c.country === 'BR'
    ? 'Tijuca · Rio de Janeiro · Brasil'
    : 'Rua António Nobre 1D, 3.º DTO · Dream Offices · Cacilhas 2800-260';
  page.drawText(officeAddr, { x: ML, y, size: 9, font: fontRegular, color: COLORS.muted });
  y -= 12;
  page.drawText('vyavenaadv.com · +351 911 831 530', { x: ML, y, size: 9, font: fontRegular, color: COLORS.muted });

  page.drawText('Emitido em', { x: DIR - 130, y: height - 145, size: 8, font: fontRegular, color: COLORS.muted });
  page.drawText(fmtDateLong(issueDate), { x: DIR - 130, y: height - 158, size: 10, font: fontBold, color: COLORS.ink });

  // ===== LINHA DOURADA =====
  y = height - 200;
  page.drawLine({ start: { x: ML, y }, end: { x: DIR, y }, thickness: 0.5, color: COLORS.gold });

  // ===== CLIENTE =====
  y -= 32;
  page.drawText('CLIENTE', { x: ML, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 18;
  // Cliente conjunto: uma linha por pessoa. `c.pessoas` vem já filtrado pela
  // escolha feita na ficha (worker/routes/planos.js); sem ele, todos os titulares.
  const pessoas = c.pessoas || [{ name: c.name, identification: c.identification }, ...(c.people || [])];
  for (let i = 0; i < pessoas.length; i++) {
    page.drawText(pessoas[i].name, { x: ML, y, size: 14, font: fontSerifBold, color: COLORS.ink });
    if (i < pessoas.length - 1) y -= 17;
  }
  y -= 14;
  const idLabel = c.country === 'BR' ? 'CPF/CNPJ' : 'NIF';
  const idents = pessoas.map((p) => p.identification || '—').join(' · ');
  page.drawText(`${idLabel}: ${idents}`, { x: ML, y, size: 9, font: fontRegular, color: COLORS.muted });
  if (c.email) {
    page.drawText(c.email, { x: 250, y, size: 9, font: fontRegular, color: COLORS.muted });
  }
  if (c.practice_area) {
    y -= 12;
    page.drawText(`Área: ${c.practice_area}`, { x: ML, y, size: 9, font: fontRegular, color: COLORS.muted });
  }

  // ===== RESUMO (3 caixas) =====
  y -= 38;
  const boxW = (DIR - ML - 20) / 3;
  const boxes = [
    { label: 'TOTAL DO PLANO', value: fmtMoney(total, currency), color: COLORS.forest },
    { label: 'JÁ PAGO', value: fmtMoney(paid, currency), color: COLORS.paid },
    { label: 'EM ABERTO', value: fmtMoney(outstanding, currency), color: COLORS.gold },
  ];
  boxes.forEach((b, idx) => {
    const bx = ML + idx * (boxW + 10);
    page.drawRectangle({ x: bx, y: y - 42, width: boxW, height: 50, color: COLORS.cream });
    page.drawText(b.label, { x: bx + 10, y: y - 8, size: 7, font: fontBold, color: COLORS.muted, characterSpacing: 1 });
    page.drawText(b.value, { x: bx + 10, y: y - 30, size: 14, font: fontSerifBold, color: b.color });
  });

  // ===== TABELA DE PARCELAS =====
  y -= 70;
  page.drawText('PARCELAS', { x: ML, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 8;

  // Colunas em proporção da área útil: com o timbrado a margem mudou e os
  // valores fixos de antes (52, 110, 230…) caíam fora dela.
  const util = DIR - ML;
  const cN = ML + 2, cVenc = ML + util * 0.14, cValor = ML + util * 0.40,
        cEstado = ML + util * 0.66, cPago = ML + util * 0.88;
  const drawTableHead = () => {
    page.drawRectangle({ x: ML, y: y - 16, width: DIR - ML, height: 18, color: VERDE_FAIXA });
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
      page = pdf.addPage(A4);
      desenharTimbrado(page, logoTimbrado);
      y = height - 60;
      drawTableHead();
    }
    if (idx % 2 === 1) {
      page.drawRectangle({ x: ML, y: y - rowH + 4, width: DIR - ML, height: rowH, color: COLORS.rowAlt });
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

  page.drawLine({ start: { x: ML, y: y + 2 }, end: { x: DIR, y: y + 2 }, thickness: 0.4, color: COLORS.line });
  // Total
  y -= 12;
  page.drawText('TOTAL', { x: cValor - 60, y, size: 9, font: fontBold, color: COLORS.muted });
  page.drawText(fmtMoney(total, currency), { x: cValor, y, size: 11, font: fontSerifBold, color: COLORS.forest });

  // ===== CONDIÇÕES =====
  y -= 40;
  if (y < 160) { page = pdf.addPage(A4);
      desenharTimbrado(page, logoTimbrado); y = height - 80; }
  page.drawText('CONDIÇÕES', { x: ML, y, size: 8, font: fontBold, color: COLORS.gold, characterSpacing: 2 });
  y -= 16;
  const cond = c.country === 'BR'
    ? 'O pagamento das parcelas deverá ser efetuado até a data de vencimento indicada. O atraso poderá ensejar a cobrança de encargos conforme contrato de honorários firmado entre as partes.'
    : 'O pagamento das prestações deve ser efetuado até à data de vencimento indicada. O atraso poderá implicar a cobrança de encargos nos termos do contrato de honorários celebrado entre as partes.';
  // wrap simples
  const words = cond.split(' ');
  let lineTxt = '';
  const maxW = DIR - ML;
  for (const w of words) {
    const test = lineTxt ? lineTxt + ' ' + w : w;
    if (fontRegular.widthOfTextAtSize(test, 9) > maxW) {
      page.drawText(lineTxt, { x: ML, y, size: 9, font: fontRegular, color: COLORS.ink });
      y -= 13; lineTxt = w;
    } else lineTxt = test;
  }
  if (lineTxt) { page.drawText(lineTxt, { x: ML, y, size: 9, font: fontRegular, color: COLORS.ink }); y -= 13; }

  // ===== ASSINATURA =====
  y -= 50;
  if (y < 90) { page = pdf.addPage(A4);
      desenharTimbrado(page, logoTimbrado); y = height - 120; }
  page.drawLine({ start: { x: ML, y }, end: { x: ML + 230, y }, thickness: 0.5, color: COLORS.ink });
  y -= 14;
  page.drawText('Dra. Vyvian Avena', { x: ML, y, size: 10, font: fontSerifBold, color: COLORS.ink });
  y -= 12;
  const orderLabel = c.country === 'BR' ? 'OAB — Advogada' : 'Ordem dos Advogados Portugueses';
  page.drawText(orderLabel, { x: ML, y, size: 8, font: fontRegular, color: COLORS.muted });

  // ===== FOOTER (em todas as páginas) =====
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: ML, y: 60 }, end: { x: DIR, y: 60 }, thickness: 0.3, color: COLORS.gold });
    p.drawText('Documento gerado eletronicamente · Vyvian Avena Advogada', { x: ML, y: 45, size: 7, font: fontRegular, color: COLORS.muted });
    // alinhado à DIREITA da área útil: com x fixo esta linha corria por baixo
    // da faixa verde (o teste de largura em tests/worker/pdfs.test.js apanhou-o).
    const carimbo = `${planNumber ? 'Plano Nº ' + planNumber + ' · ' : ''}Pág. ${idx + 1}/${pages.length} · ${new Date().toISOString().slice(0, 10)}`;
    const cw = fontRegular.widthOfTextAtSize(carimbo, 7);
    p.drawText(carimbo, { x: DIR - cw, y: 45, size: 7, font: fontRegular, color: COLORS.muted });
  });

  return await pdf.save();
}
