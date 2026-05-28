// worker/lib/pdfgen.js — Fase 3 (recibo com 2 layouts: PT e BR)
// PT: comprovativo de cortesia (sem valor fiscal — o Recibo Verde sai à parte na AT).
// BR: recibo de honorários em prosa, com valor por extenso e cláusula de quitação.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_WHITE_PNG } from "./logo.js";

const FOREST = rgb(0.0706, 0.1882, 0.1647);
const GOLD   = rgb(0.7216, 0.5765, 0.3529);
const CREAM  = rgb(0.9608, 0.9412, 0.9098);
const INK    = rgb(0.13, 0.13, 0.13);
const MUTE   = rgb(0.45, 0.45, 0.45);

const ADV = { nome: "Dra. Vyvian Avena", linha: "Advogada" };

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
function fmtDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const meses = ["janeiro","fevereiro","mar\u00e7o","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${parseInt(d,10)} de ${meses[parseInt(m,10)-1]} de ${y}`;
}

function extenso(valor) {
  valor = Math.round(Number(valor || 0) * 100) / 100;
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);
  const u = ["","um","dois","tr\u00eas","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","catorze","quinze","dezasseis","dezassete","dezoito","dezanove"];
  const dez = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  const cem = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function ate999(n) {
    if (n === 0) return "";
    if (n === 100) return "cem";
    let s = "";
    const c = Math.floor(n / 100), resto = n % 100;
    if (c) s += cem[c];
    if (resto) {
      if (s) s += " e ";
      if (resto < 20) s += u[resto];
      else { const d = Math.floor(resto / 10), un = resto % 10; s += dez[d]; if (un) s += " e " + u[un]; }
    }
    return s;
  }
  function grupo(n, singular, plural) {
    if (n === 0) return "";
    if (n === 1) return "um " + singular;
    return ate999(n) + " " + plural;
  }
  let partes = [];
  const milhoes = Math.floor(inteiro / 1000000);
  const milhares = Math.floor((inteiro % 1000000) / 1000);
  const resto = inteiro % 1000;
  if (milhoes) partes.push(grupo(milhoes, "milh\u00e3o", "milh\u00f5es"));
  if (milhares) partes.push(milhares === 1 ? "mil" : ate999(milhares) + " mil");
  if (resto) partes.push(ate999(resto));
  let txt = partes.join(" e ") || "zero";
  txt += inteiro === 1 ? " real" : " reais";
  if (centavos) {
    txt += " e " + (centavos < 20 ? u[centavos] : (dez[Math.floor(centavos/10)] + (centavos%10 ? " e "+u[centavos%10] : "")));
    txt += centavos === 1 ? " centavo" : " centavos";
  }
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export async function generateReciboPDF({ client, installment, receiptNumber }) {
  const country = (client.country || "PT").toUpperCase();
  const currency = installment.currency || (country === "BR" ? "BRL" : "EUR");

  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${receiptNumber} \u2014 ${client.name}`);
  doc.setAuthor("Vyvian Avena Advogada");
  doc.setProducer("vyvian-avena-adv");

  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 56;
  const text = (s, x, y, { font = serif, size = 11, color = INK, spacing = 0 } = {}) =>
    page.drawText(String(s == null ? "" : s), { x, y, size, font, color, characterSpacing: spacing });
  const label = (s, x, y) => text(s.toUpperCase(), x, y, { font: sansB, size: 8, color: GOLD, spacing: 1.5 });

  function wrap(str, x, y, { font = serif, size = 11, color = INK, lh = 16, maxW = width - 2 * M } = {}) {
    const words = String(str).split(" ");
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW) { text(line, x, y, { font, size, color }); y -= lh; line = w; }
      else line = test;
    }
    if (line) { text(line, x, y, { font, size, color }); y -= lh; }
    return y;
  }

  const headH = 96;
  page.drawRectangle({ x: 0, y: height - headH, width, height: headH, color: FOREST });
  try {
    const logo = await doc.embedPng(LOGO_WHITE_PNG);
    const logoH = 46;
    const logoW = logoH * (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: height - headH / 2 - logoH / 2, width: logoW, height: logoH });
  } catch (e) {
    text("VYVIAN AVENA", M, height - 46, { font: serifB, size: 20, color: CREAM, spacing: 2 });
    text("A D V O G A D A", M, height - 64, { font: sans, size: 9, color: GOLD, spacing: 3 });
  }
  const rn = `RECIBO N\u00ba ${receiptNumber}`;
  const rnW = serifB.widthOfTextAtSize(rn, 13);
  text(rn, width - M - rnW, height - 46, { font: serifB, size: 13, color: GOLD });
  const dt = `Data: ${fmtDate(installment.paid_date)}`;
  const dtW = sans.widthOfTextAtSize(dt, 9);
  text(dt, width - M - dtW, height - 64, { font: sans, size: 9, color: CREAM });

  let y = height - headH - 44;
  if (country === "BR") y = bodyBR(); else y = bodyPT();

  const sigY = 150;
  const sigX = width - M - 220;
  page.drawLine({ start: { x: sigX, y: sigY + 4 }, end: { x: width - M, y: sigY + 4 }, thickness: 0.8, color: GOLD });
  const nameW = serifB.widthOfTextAtSize(ADV.nome, 12);
  text(ADV.nome, sigX + (220 - nameW) / 2, sigY - 12, { font: serifB, size: 12, color: FOREST });
  const lW = sans.widthOfTextAtSize(ADV.linha, 8.5);
  text(ADV.linha, sigX + (220 - lW) / 2, sigY - 26, { font: sans, size: 8.5, color: MUTE });

  page.drawLine({ start: { x: M, y: 70 }, end: { x: width - M, y: 70 }, thickness: 0.5, color: GOLD });
  const stamp = `ID ${client.id}/${installment.id} \u00b7 Gerado em ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC \u00b7 Documento gerado eletronicamente`;
  text(stamp, M, 56, { font: sans, size: 7.5, color: MUTE });

  return await doc.save();

  function bodyPT() {
    label("Recebi de", M, y); y -= 20;
    text(client.name, M, y, { font: serifB, size: 15, color: FOREST }); y -= 18;
    const ident = client.identification ? `NIF: ${client.identification}` : null;
    const detLine = [ident, client.email].filter(Boolean).join("   \u00b7   ");
    if (detLine) { text(detLine, M, y, { font: sans, size: 10, color: MUTE }); }
    if (client.address) { y -= 14; text(client.address, M, y, { font: sans, size: 10, color: MUTE }); }
    y -= 28;

    label("A quantia de", M, y); y -= 30;
    text(fmtMoney(installment.amount, currency), M, y, { font: serifB, size: 30, color: FOREST }); y -= 34;

    label("Referente a", M, y); y -= 18;
    text(`Honor\u00e1rios advocat\u00edcios \u00b7 Parcela ${installment.installment_number}/${installment.total_installments}`, M, y, { font: serif, size: 12, color: INK }); y -= 34;

    const cols = [
      { t: "VENCIMENTO", v: fmtDate(installment.due_date) },
      { t: "PAGAMENTO", v: fmtDate(installment.paid_date) },
      { t: "FORMA", v: installment.payment_method || "\u2014" },
      { t: "VALOR", v: fmtMoney(installment.amount, currency) },
    ];
    const tableY = y, rowH = 40;
    page.drawRectangle({ x: M, y: tableY - rowH, width: width - 2 * M, height: rowH, color: CREAM });
    const colW = (width - 2 * M) / cols.length;
    cols.forEach((c, i) => {
      const cx = M + i * colW + 12;
      text(c.t, cx, tableY - 15, { font: sansB, size: 7.5, color: GOLD, spacing: 1 });
      text(c.v, cx, tableY - 31, { font: serifB, size: 11, color: FOREST });
    });
    y = tableY - rowH - 36;

    label("Declara\u00e7\u00e3o", M, y); y -= 18;
    y = wrap("Para os devidos efeitos, declaro ter recebido a quantia acima indicada, referente aos honor\u00e1rios discriminados, dando da mesma plena e integral quita\u00e7\u00e3o.", M, y, { size: 10.5, lh: 16 });

    y -= 12;
    page.drawRectangle({ x: M, y: y - 26, width: width - 2 * M, height: 36, color: rgb(0.97, 0.95, 0.90) });
    text("Documento sem valor fiscal. A fatura-recibo legal \u00e9 emitida atrav\u00e9s da Autoridade", M + 10, y - 8, { font: serifI, size: 9, color: MUTE });
    text("Tribut\u00e1ria (Portal das Finan\u00e7as) e enviada em separado.", M + 10, y - 20, { font: serifI, size: 9, color: MUTE });
    return y;
  }

  function bodyBR() {
    label("Recibo de honor\u00e1rios advocat\u00edcios", M, y); y -= 30;

    text(fmtMoney(installment.amount, currency), M, y, { font: serifB, size: 30, color: FOREST }); y -= 16;
    text(`(${extenso(installment.amount)})`, M, y, { font: serifI, size: 11, color: MUTE }); y -= 32;

    const qual = [];
    if (client.nationality) qual.push(client.nationality);
    if (client.marital_status) qual.push(client.marital_status);
    const docs = [];
    if (client.identification) docs.push(`CPF n\u00ba ${client.identification}`);
    if (client.rg) docs.push(`RG n\u00ba ${client.rg}`);

    let frase = `Recebi de ${client.name}`;
    if (qual.length) frase += `, ${qual.join(", ")}`;
    if (docs.length) frase += `, inscrito(a) sob ${docs.join(" e ")}`;
    if (client.address) frase += `, residente em ${client.address}`;
    frase += `, a import\u00e2ncia de ${fmtMoney(installment.amount, currency)} (${extenso(installment.amount)}), `;
    frase += `referente ao pagamento da parcela ${installment.installment_number}/${installment.total_installments} `;
    frase += `dos honor\u00e1rios advocat\u00edcios contratados`;
    if (installment.payment_method) frase += `, paga atrav\u00e9s de ${installment.payment_method}`;
    frase += `.`;

    y = wrap(frase, M, y, { size: 12, lh: 19 });
    y -= 10;
    y = wrap("Para clareza e como documento de quita\u00e7\u00e3o, declaro haver recebido a import\u00e2ncia acima discriminada, outorgando plena, geral e irrevog\u00e1vel quita\u00e7\u00e3o, para nada mais reclamar a este t\u00edtulo.", M, y, { size: 12, lh: 19 });

    y -= 18;
    text(fmtDateLong(installment.paid_date) + ".", M, y, { font: serif, size: 11, color: INK });
    return y;
  }
}
