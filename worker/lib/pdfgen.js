// worker/lib/pdfgen.js — Fase 3 — "RECIBO DE PAGAMENTO DE HONORÁRIOS"
// Layout inspirado em invoice premium: faixa lateral verde + área principal limpa.
// PT: comprovativo de cortesia (com observação fiscal). BR: idem, com quitação em prosa.
// Uma só família tipográfica (Helvetica) para coesão visual.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_WHITE_PNG } from "./logo.js";

const FOREST = rgb(0.0706, 0.1882, 0.1647); // #12302a barra lateral
const GOLD   = rgb(0.7216, 0.5765, 0.3529); // #b8935a detalhes
const CREAM  = rgb(0.9608, 0.9412, 0.9098); // #f5f0e8
const INK    = rgb(0.16, 0.16, 0.16);
const MUTE   = rgb(0.45, 0.45, 0.45);
const LIGHT  = rgb(0.82, 0.82, 0.82);
const SIDE_TXT = rgb(0.86, 0.88, 0.86); // texto claro sobre a barra

const ESCRITORIO = {
  PT: "Rua Ant\u00f3nio Nobre 1D, 3.\u00ba DTO\nDream Offices \u2014 Cacilhas\n2800-260 Almada, Portugal",
  BR: "Tijuca, Rio de Janeiro \u2014 RJ\nBrasil",
};

function fmtMoney(amount, currency) {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  const [int, dec] = n.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = `${grouped},${dec}`;
  if (currency === "BRL") return `R$ ${body}`;
  if (currency === "EUR") return `\u20ac ${body}`;
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

function extenso(valor, currency) {
  valor = Math.round(Number(valor || 0) * 100) / 100;
  const inteiro = Math.floor(valor);
  const cent = Math.round((valor - inteiro) * 100);
  const u = ["","um","dois","tr\u00eas","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","catorze","quinze","dezasseis","dezassete","dezoito","dezanove"];
  const dez = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  const cem = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function a999(n){ if(n===0)return""; if(n===100)return"cem"; let s="";const c=Math.floor(n/100),r=n%100; if(c)s+=cem[c]; if(r){if(s)s+=" e "; if(r<20)s+=u[r]; else{const d=Math.floor(r/10),un=r%10;s+=dez[d];if(un)s+=" e "+u[un];}} return s; }
  const moedaSing = currency === "BRL" ? "real" : "euro";
  const moedaPlur = currency === "BRL" ? "reais" : "euros";
  const centSing = currency === "BRL" ? "centavo" : "c\u00eantimo";
  const centPlur = currency === "BRL" ? "centavos" : "c\u00eantimos";
  let partes=[];
  const mi=Math.floor(inteiro/1000000), mil=Math.floor((inteiro%1000000)/1000), r=inteiro%1000;
  if(mi)partes.push(mi===1?"um milh\u00e3o":a999(mi)+" milh\u00f5es");
  if(mil)partes.push(mil===1?"mil":a999(mil)+" mil");
  if(r)partes.push(a999(r));
  let txt=partes.join(" e ")||"zero";
  txt += " " + (inteiro===1?moedaSing:moedaPlur);
  if(cent){ txt+=" e "+(cent<20?u[cent]:(dez[Math.floor(cent/10)]+(cent%10?" e "+u[cent%10]:"")))+" "+(cent===1?centSing:centPlur); }
  return txt.charAt(0).toUpperCase()+txt.slice(1);
}

export async function generateReciboPDF({ client, installment, receiptNumber }) {
  const country = (client.country || "PT").toUpperCase();
  const currency = installment.currency || (country === "BR" ? "BRL" : "EUR");

  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${receiptNumber} \u2014 ${client.name}`);
  doc.setAuthor("Vyvian Avena Advogada");
  doc.setProducer("vyvian-avena-adv");

  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const F  = await doc.embedFont(StandardFonts.Helvetica);
  const FB = await doc.embedFont(StandardFonts.HelveticaBold);
  const FO = await doc.embedFont(StandardFonts.HelveticaOblique);

  const SIDE_W = 168; // ~28% barra lateral
  const PAD = 32;     // padding interno da área principal
  const MX = SIDE_W + PAD; // margem esquerda da área principal
  const RX = width - PAD;  // margem direita

  const txt = (s, x, y, { font = F, size = 10, color = INK, spacing = 0 } = {}) =>
    page.drawText(String(s == null ? "" : s), { x, y, size, font, color, characterSpacing: spacing });
  const txtR = (s, x, y, o = {}) => { const f=o.font||F,sz=o.size||10; txt(s, x - f.widthOfTextAtSize(String(s),sz), y, o); };

  function wrap(str, x, y, { font = F, size = 10, color = INK, lh = 14, maxW = RX - MX } = {}) {
    for (const para of String(str).split("\n")) {
      let line = "";
      for (const w of para.split(" ")) {
        const test = line ? line + " " + w : w;
        if (font.widthOfTextAtSize(test, size) > maxW) { txt(line, x, y, { font, size, color }); y -= lh; line = w; }
        else line = test;
      }
      txt(line, x, y, { font, size, color }); y -= lh;
    }
    return y;
  }

  // ===== BARRA LATERAL =====
  page.drawRectangle({ x: 0, y: 0, width: SIDE_W, height, color: FOREST });

  // logo (centrada no topo da barra)
  try {
    const logo = await doc.embedPng(LOGO_WHITE_PNG);
    const lw = SIDE_W - 44, lh = lw * (logo.height / logo.width);
    page.drawImage(logo, { x: 22, y: height - 64 - lh / 2, width: lw, height: lh });
  } catch (e) {
    txt("VYVIAN AVENA", 22, height - 64, { font: FB, size: 13, color: CREAM, spacing: 1 });
  }

  // dados rápidos na barra
  let sy = height - 150;
  const sideItem = (label, value) => {
    txt(label.toUpperCase(), 22, sy, { font: FB, size: 7, color: GOLD, spacing: 1.2 }); sy -= 13;
    for (const ln of String(value || "\u2014").split("\n")) { txt(ln, 22, sy, { font: F, size: 9, color: SIDE_TXT }); sy -= 12; }
    sy -= 10;
  };
  sideItem("Recibo n.\u00ba", receiptNumber);
  sideItem("Data de emiss\u00e3o", fmtDate(new Date().toISOString()));
  sideItem("Data do pagamento", fmtDate(installment.paid_date));
  sideItem("Forma de pagamento", installment.payment_method || "\u2014");
  if (installment.notes) sideItem("Refer\u00eancia", installment.notes);

  // rodapé da barra
  txt("vyavenaadv.com", 22, 40, { font: F, size: 8, color: SIDE_TXT });

  // ===== ÁREA PRINCIPAL =====
  let y = height - 70;

  // título
  txt("RECIBO DE PAGAMENTO", MX, y, { font: FB, size: 20, color: FOREST, spacing: 1 }); y -= 24;
  txt("DE HONOR\u00c1RIOS", MX, y, { font: FB, size: 20, color: FOREST, spacing: 1 }); y -= 14;
  page.drawLine({ start: { x: MX, y }, end: { x: RX, y }, thickness: 1.5, color: GOLD }); y -= 30;

  // dois blocos: PRESTADORA | CLIENTE
  const colGap = 24;
  const colW = (RX - MX - colGap) / 2;
  const cxL = MX, cxR = MX + colW + colGap;
  const blockTop = y;

  txt("PRESTADORA DOS SERVI\u00c7OS", cxL, y, { font: FB, size: 8, color: GOLD, spacing: 1 });
  txt(country === "BR" ? "PAGADOR / CLIENTE" : "CLIENTE / PAGADOR", cxR, y, { font: FB, size: 8, color: GOLD, spacing: 1 });
  let yL = y - 15, yR = y - 15;

  // prestadora
  txt("Dra. Vyvian Avena", cxL, yL, { font: FB, size: 11, color: INK }); yL -= 14;
  txt("Advogada", cxL, yL, { font: F, size: 9, color: MUTE }); yL -= 14;
  for (const ln of ESCRITORIO[country].split("\n")) { txt(ln, cxL, yL, { font: F, size: 9, color: MUTE }); yL -= 12; }

  // cliente
  txt(client.name, cxR, yR, { font: FB, size: 11, color: INK, }); yR -= 14;
  const idLabel = country === "BR" ? "CPF" : "NIF";
  if (client.identification) { txt(`${idLabel}: ${client.identification}`, cxR, yR, { font: F, size: 9, color: MUTE }); yR -= 12; }
  if (country === "BR" && client.rg) { txt(`RG: ${client.rg}`, cxR, yR, { font: F, size: 9, color: MUTE }); yR -= 12; }
  if (client.address) { yR = wrapCol(client.address, cxR, yR, colW); }
  if (client.email) { txt(client.email, cxR, yR, { font: F, size: 9, color: MUTE }); yR -= 12; }

  function wrapCol(str, x, yy, mw) {
    let line = "";
    for (const w of String(str).split(" ")) {
      const test = line ? line + " " + w : w;
      if (F.widthOfTextAtSize(test, 9) > mw) { txt(line, x, yy, { font: F, size: 9, color: MUTE }); yy -= 12; line = w; }
      else line = test;
    }
    if (line) { txt(line, x, yy, { font: F, size: 9, color: MUTE }); yy -= 12; }
    return yy;
  }

  y = Math.min(yL, yR) - 24;

  // ===== TABELA DE VALORES =====
  // cabeçalho
  page.drawRectangle({ x: MX, y: y - 18, width: RX - MX, height: 22, color: FOREST });
  txt("DESCRI\u00c7\u00c3O", MX + 10, y - 13, { font: FB, size: 8, color: CREAM, spacing: 0.5 });
  txtR("VALOR", RX - 10, y - 13, { font: FB, size: 8, color: CREAM, spacing: 0.5 });
  y -= 18;

  // linha de honorários
  const desc = `Honor\u00e1rios advocat\u00edcios \u2014 parcela ${installment.installment_number}/${installment.total_installments}`;
  y -= 22;
  txt(desc, MX + 10, y + 4, { font: F, size: 10, color: INK });
  txtR(fmtMoney(installment.amount, currency), RX - 10, y + 4, { font: F, size: 10, color: INK });
  page.drawLine({ start: { x: MX, y: y - 6 }, end: { x: RX, y: y - 6 }, thickness: 0.5, color: LIGHT });
  y -= 18;

  // total recebido (destaque)
  const totW = 200, totX = RX - totW;
  page.drawRectangle({ x: totX, y: y - 30, width: totW, height: 30, color: CREAM });
  txt("TOTAL RECEBIDO", totX + 10, y - 12, { font: FB, size: 8, color: GOLD, spacing: 0.5 });
  txtR(fmtMoney(installment.amount, currency), RX - 10, y - 24, { font: FB, size: 14, color: FOREST });
  y -= 44;

  // valor por extenso
  txt("VALOR POR EXTENSO", MX, y, { font: FB, size: 7.5, color: GOLD, spacing: 1 }); y -= 13;
  y = wrap(extenso(installment.amount, currency) + ".", MX, y, { font: FO, size: 10, color: INK, lh: 14 });
  y -= 14;

  // ===== DECLARAÇÃO / QUITAÇÃO =====
  const decl =
    `Declara a prestadora dos servi\u00e7os, Dra. Vyvian Avena, Advogada, ter recebido de ${client.name}` +
    (client.identification ? `, ${idLabel} ${client.identification}` : "") +
    `, a quantia de ${fmtMoney(installment.amount, currency)} (${extenso(installment.amount, currency)}), ` +
    `a t\u00edtulo de pagamento de honor\u00e1rios referentes \u00e0 parcela ${installment.installment_number}/${installment.total_installments} dos servi\u00e7os contratados. ` +
    `Pelo presente documento, \u00e9 dada a respetiva quita\u00e7\u00e3o pelo montante recebido.`;
  y = wrap(decl, MX, y, { font: F, size: 10, color: INK, lh: 15 });
  y -= 10;
  const compl =
    `Salvo indica\u00e7\u00e3o expressa em contr\u00e1rio, o presente recibo apenas comprova o pagamento dos honor\u00e1rios aqui identificados, ` +
    `n\u00e3o abrangendo outros valores, despesas, encargos, impostos, servi\u00e7os adicionais ou quantias que n\u00e3o estejam expressamente mencionados neste documento.`;
  y = wrap(compl, MX, y, { font: F, size: 9, color: MUTE, lh: 13 });

  // ===== ASSINATURA =====
  const sigY = 150, sigX = RX - 200;
  page.drawLine({ start: { x: sigX, y: sigY + 2 }, end: { x: RX, y: sigY + 2 }, thickness: 0.8, color: GOLD });
  txt("A prestadora dos servi\u00e7os,", sigX, sigY + 18, { font: FO, size: 9, color: MUTE });
  txtCenter("Dra. Vyvian Avena", sigX, RX, sigY - 12, { font: FB, size: 11, color: FOREST });
  txtCenter("Advogada", sigX, RX, sigY - 25, { font: F, size: 8.5, color: MUTE });

  function txtCenter(s, x1, x2, yy, o = {}) {
    const f = o.font || F, sz = o.size || 10;
    const w = f.widthOfTextAtSize(String(s), sz);
    txt(s, x1 + (x2 - x1 - w) / 2, yy, o);
  }

  // ===== OBSERVAÇÃO FISCAL (rodapé) =====
  const obs = country === "BR"
    ? "Observa\u00e7\u00e3o: O presente recibo comprova o recebimento da quantia acima indicada e a respetiva quita\u00e7\u00e3o."
    : "Observa\u00e7\u00e3o: O presente recibo comprova o recebimento da quantia acima indicada e a respetiva quita\u00e7\u00e3o, n\u00e3o substituindo, quando legalmente exig\u00edvel, a emiss\u00e3o de fatura-recibo atrav\u00e9s do Portal das Finan\u00e7as ou de sistema de fatura\u00e7\u00e3o certificado.";
  page.drawLine({ start: { x: MX, y: 64 }, end: { x: RX, y: 64 }, thickness: 0.5, color: LIGHT });
  let oy = 54;
  for (const ln of softWrap(obs, RX - MX, FO, 7.5)) { txt(ln, MX, oy, { font: FO, size: 7.5, color: MUTE }); oy -= 10; }

  function softWrap(str, mw, font, size) {
    const out = []; let line = "";
    for (const w of str.split(" ")) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) > mw) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  return await doc.save();
}
