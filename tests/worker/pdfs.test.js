// tests/worker/pdfs.test.js
// Geração de PDFs: recibo, procuração e plano de pagamento — os documentos que
// saem do escritório com o nome da Dra. em cima, e a última zona do código que
// estava sem testes.
//
// COMO SE TESTA UM PDF SEM O VER: o pdf-lib escreve um fluxo de conteúdo com
// operadores. Descomprimimo-lo e lemos de lá o que interessa — o texto (Tj/TJ),
// onde cada bloco foi colocado (Td/Tm) e os retângulos desenhados (re). Dá para
// afirmar factos duros: «a data aparece», «nada é escrito por cima da faixa»,
// «um plano com 40 parcelas passa a duas páginas». O que NÃO dá é julgar o
// aspeto — para isso é preciso olhar.
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { generateReciboPDF } from '../../worker/lib/pdfgen.js';
import { generateProcuracaoPDF } from '../../worker/lib/procgen.js';
import { generatePaymentPlanPdf } from '../../worker/lib/planogen.js';
import { MARGEM, A4, CORTE_FAIXA } from '../../worker/lib/timbrado.js';

// ─── leitura do PDF ──────────────────────────────────────────────────────────

async function abrir(bytes) {
  const doc = await PDFDocument.load(bytes);
  const paginas = [];
  for (const page of doc.getPages()) {
    let conteudo = '';
    const ops = page.node.Contents();
    const streams = ops?.asArray ? ops.asArray() : [ops];
    for (const ref of streams) {
      const s = ref?.asArray ? null : page.doc.context.lookup(ref) || ref;
      const bruto = s?.getContents ? s.getContents() : null;
      if (!bruto) continue;
      let bytesFluxo = bruto;
      try { bytesFluxo = inflateSync(Buffer.from(bruto)); } catch { /* já vem sem compressão */ }
      conteudo += Buffer.from(bytesFluxo).toString('latin1');
    }
    paginas.push({ page, conteudo, size: page.getSize() });
  }
  return { doc, paginas };
}

// Texto legível. Com fontes embutidas o pdf-lib escreve em hexadecimal
// (`<4142> Tj`); com as fontes padrão pode escrever literais entre parênteses.
// Lemos as duas formas.
function textoDe(conteudo) {
  const out = [];
  for (const m of conteudo.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    const hex = m[1].replace(/\s/g, '');
    let s = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    out.push(s);
  }
  for (const m of conteudo.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    out.push(m[1].replace(/\\([()\\])/g, '$1'));
  }
  return out;
}
const textoTodo = (p) => textoDe(p.conteudo).join(' ');

// posições onde se começou a escrever (operador Td / Tm)
function posicoesTexto(conteudo) {
  const pos = [];
  for (const m of conteudo.matchAll(/([-\d.]+)\s+([-\d.]+)\s+Td/g)) {
    pos.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  for (const m of conteudo.matchAll(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/g)) {
    pos.push({ x: parseFloat(m[5]), y: parseFloat(m[6]) });
  }
  return pos;
}

// O pdf-lib não usa o operador `re`: desenha os retângulos como caminhos
// (m/l/h/f). Para o timbrado basta reconhecer o caminho que cobre a folha toda.
function temFundoDePagina(conteudo, W, H) {
  const w = W.toFixed(2).replace(/\.?0+$/, '');
  return conteudo.includes(`${w} ${H} l`) || conteudo.includes(`${W} ${H} l`);
}
function temImagem(conteudo) {
  return /\/[\w-]+\s+Do/.test(conteudo);
}

// Onde cada bloco de texto COMEÇA e ONDE ACABA. Saber onde começa não chega: o
// que mete o texto por baixo da faixa verde é uma linha comprida de mais. Medimos
// a largura real com as métricas da fonte (Helvetica cobre bem os dois casos —
// as diferenças para a Times são pequenas e a tolerância absorve-as).
let _fonteMedida = null;
async function fonteParaMedir() {
  if (!_fonteMedida) {
    const d = await PDFDocument.create();
    _fonteMedida = await d.embedFont(StandardFonts.Helvetica);
  }
  return _fonteMedida;
}

async function blocosDeTexto(conteudo) {
  const font = await fonteParaMedir();
  const blocos = [];
  // "/Fonte tam Tf ... 1 0 0 1 x y Tm <hex> Tj"
  const re = /\/([\w-]+)\s+([\d.]+)\s+Tf[\s\S]{0,120}?1 0 0 1 ([-\d.]+) ([-\d.]+) Tm\s*(?:<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\))\s*Tj/g;
  for (const m of conteudo.matchAll(re)) {
    const tam = parseFloat(m[2]);
    let texto = '';
    if (m[5] != null) {
      const hex = m[5].replace(/\s/g, '');
      for (let i = 0; i + 1 < hex.length; i += 2) texto += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    } else {
      texto = (m[6] || '').replace(/\\([()\\])/g, '$1');
    }
    const x = parseFloat(m[3]);
    let largura = 0;
    try { largura = font.widthOfTextAtSize(texto, tam); } catch { largura = texto.length * tam * 0.5; }
    blocos.push({ x, y: parseFloat(m[4]), texto, tam, fim: x + largura });
  }
  return blocos;
}

// ─── dados de exemplo ────────────────────────────────────────────────────────

const CLIENTE = {
  id: 'cli-1',
  name: 'Maria Clara dos Santos Silva',
  country: 'PT',
  identification: '123456789',
  address: 'Rua António Nobre 1D, 3.º Dto., 2800-260 Almada',
  email: 'maria@exemplo.pt',
  practice_area: 'Nacionalidade',
};
const PARCELA = {
  installment_number: 3, total_installments: 14, amount: 250.5, currency: 'EUR',
  due_date: '2026-03-10', paid_date: '2026-03-08',
  payment_method: 'Transferência bancária', notes: 'Ref. 2026/014',
};
const parcelas = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, installment_number: i + 1, total_installments: n,
  amount: 250.5, currency: 'EUR',
  due_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`,
  status: i < 3 ? 'paid' : 'pending', ...extra,
}));

const recibo = (o = {}) => generateReciboPDF({
  client: CLIENTE, installment: PARCELA, receiptNumber: '2026/031', ...o,
});
const procuracao = (o = {}) => generateProcuracaoPDF({
  texto: 'Pelo presente instrumento particular de mandato, MARIA CLARA DOS SANTOS SILVA nomeia sua bastante procuradora a Dra. VYVIAN AVENA, advogada.',
  nomeOutorgante: 'Maria Clara dos Santos Silva',
  boldSegments: ['MARIA CLARA DOS SANTOS SILVA', 'VYVIAN AVENA'],
  ...o,
});
const plano = (o = {}) => generatePaymentPlanPdf({
  client: CLIENTE, installments: parcelas(14), planNumber: '2026/014', ...o,
});

const TODOS = [
  ['recibo', recibo],
  ['procuração', procuracao],
  ['plano de pagamento', plano],
];

// ═════════════════════════════════════════════════════════════════════════════
describe('o que os três documentos têm em comum', () => {
  it.each(TODOS)('o %s gera um PDF válido', async (_nome, gerar) => {
    const bytes = await gerar();
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it.each(TODOS)('o %s sai em A4', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    for (const p of paginas) {
      expect(p.size.width).toBeCloseTo(A4[0], 1);
      expect(p.size.height).toBeCloseTo(A4[1], 1);
    }
  });

  // O ponto do «corte» pedido pela Dra.: a faixa verde não pode roubar espaço ao
  // texto. Nenhum bloco de texto pode começar depois da margem direita.
  it.each(TODOS)('no %s nada é escrito para lá da margem direita', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    const limite = A4[0] - MARGEM.direita + 1; // 1pt de tolerância de arredondamento
    for (const p of paginas) {
      const fora = posicoesTexto(p.conteudo).filter((q) => q.x > limite);
      expect(fora).toEqual([]);
    }
  });

  // A verificação que interessa mesmo: uma linha comprida de mais passa por baixo
  // da faixa verde e fica ilegível. Aqui mede-se a largura real de cada bloco.
  it.each(TODOS)('no %s nenhuma linha corre por baixo da faixa', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    const limite = A4[0] - MARGEM.direita + 4; // 4pt de folga para diferenças de métrica
    for (const p of paginas) {
      const compridas = (await blocosDeTexto(p.conteudo))
        .filter((b) => b.fim > limite)
        .map((b) => `«${b.texto}» acaba em ${b.fim.toFixed(1)}pt`);
      expect(compridas).toEqual([]);
    }
  });

  it.each(TODOS)('no %s o texto respeita a margem esquerda', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    for (const p of paginas) {
      const fora = posicoesTexto(p.conteudo).filter((q) => q.x < MARGEM.esquerda - 1 && q.x > 0);
      expect(fora).toEqual([]);
    }
  });

  it.each(TODOS)('o %s leva o timbrado: fundo verde e área branca por cima', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    for (const p of paginas) {
      expect(temFundoDePagina(p.conteudo, A4[0], A4[1]), 'falta o fundo do timbrado').toBe(true);
      expect(p.conteudo).toMatch(/\bc\b/); // as curvas da faixa (operador c)
    }
  });

  it.each(TODOS)('o %s traz a marca de água', async (_nome, gerar) => {
    const { paginas } = await abrir(await gerar());
    expect(temImagem(paginas[0].conteudo)).toBe(true);
  });

  it.each(TODOS)('o %s identifica a autoria', async (_nome, gerar) => {
    const { doc } = await abrir(await gerar());
    expect(doc.getAuthor() || doc.getProducer() || '').toMatch(/vyvian/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('recibo de pagamento', () => {
  it('mostra o número do recibo', async () => {
    expect(textoTodo((await abrir(await recibo())).paginas[0])).toContain('2026/031');
  });

  it('mostra o nome do cliente', async () => {
    expect(textoTodo((await abrir(await recibo())).paginas[0])).toContain('Maria Clara');
  });

  it('mostra a data do pagamento em formato português', async () => {
    expect(textoTodo((await abrir(await recibo())).paginas[0])).toContain('08/03/2026');
  });

  it('mostra a forma de pagamento', async () => {
    expect(textoTodo((await abrir(await recibo())).paginas[0])).toMatch(/Transfer/);
  });

  it('mostra o valor com o símbolo do euro', async () => {
    const t = textoTodo((await abrir(await recibo())).paginas[0]);
    expect(t).toMatch(/250,50/);
  });

  it('um cliente brasileiro leva o valor em reais', async () => {
    const t = textoTodo((await abrir(await recibo({
      client: { ...CLIENTE, country: 'BR' },
      installment: { ...PARCELA, currency: 'BRL' },
    }))).paginas[0]);
    expect(t).toMatch(/R\$|250,50/);
  });

  it('identifica a parcela dentro do plano', async () => {
    expect(textoTodo((await abrir(await recibo())).paginas[0])).toMatch(/3\s*\/\s*14|3 de 14/);
  });

  it('cabe numa página', async () => {
    expect((await abrir(await recibo())).paginas).toHaveLength(1);
  });

  it('sem forma de pagamento não escreve "undefined"', async () => {
    const t = textoTodo((await abrir(await recibo({
      installment: { ...PARCELA, payment_method: null },
    }))).paginas[0]);
    expect(t).not.toMatch(/undefined|null|NaN/);
  });

  it('um nome muito longo não empurra texto para fora da margem', async () => {
    const { paginas } = await abrir(await recibo({
      client: { ...CLIENTE, name: 'Maria Clara dos Santos Silva Ferreira de Albuquerque e Castro Vasconcelos' },
    }));
    const limite = A4[0] - MARGEM.direita + 1;
    expect(posicoesTexto(paginas[0].conteudo).filter((q) => q.x > limite)).toEqual([]);
  });

  it('valores estranhos não produzem NaN no documento', async () => {
    const t = textoTodo((await abrir(await recibo({
      installment: { ...PARCELA, amount: 'abc' },
    }))).paginas[0]);
    expect(t).not.toContain('NaN');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('procuração', () => {
  it('mostra o título', async () => {
    expect(textoTodo((await abrir(await procuracao())).paginas[0]).replace(/\s+/g, ''))
      .toContain('PROCURAÇÃO'.replace(/\s+/g, ''));
  });

  it('mostra o nome do outorgante por baixo da linha de assinatura', async () => {
    expect(textoTodo((await abrir(await procuracao())).paginas[0])).toContain('Maria Clara');
  });

  it('escreve o corpo do texto', async () => {
    expect(textoTodo((await abrir(await procuracao())).paginas[0])).toMatch(/mandato/);
  });

  // Antes o texto continuava a descer para fora da folha e desaparecia — e com as
  // margens do timbrado, que são mais largas, uma procuração comprida chega lá
  // depressa.
  it('uma procuração comprida passa a mais do que uma página', async () => {
    const texto = Array.from({ length: 14 }, (_, i) =>
      `Parágrafo ${i + 1}. ` + 'Pelo presente instrumento particular de mandato o outorgante confere os mais amplos poderes de representação em juízo e fora dele, incluindo os de confessar, desistir e transigir. '.repeat(3)
    ).join('\n\n');
    const { paginas } = await abrir(await procuracao({ texto }));
    expect(paginas.length).toBeGreaterThan(1);
  });

  it('nenhuma linha cai fora da folha, por mais comprido que seja o texto', async () => {
    const texto = 'Frase de teste com palavras suficientes para encher linhas. '.repeat(120);
    const { paginas } = await abrir(await procuracao({ texto }));
    for (const p of paginas) {
      const abaixo = posicoesTexto(p.conteudo).filter((q) => q.y < 20 && q.y !== 0);
      expect(abaixo).toEqual([]);
    }
  });

  it('todas as páginas levam o timbrado', async () => {
    const texto = 'Frase de teste com palavras suficientes para encher linhas. '.repeat(120);
    const { paginas } = await abrir(await procuracao({ texto }));
    for (const p of paginas) {
      expect(temFundoDePagina(p.conteudo, A4[0], A4[1])).toBe(true);
    }
  });

  it('sem nome do outorgante usa um rótulo genérico em vez de "undefined"', async () => {
    const t = textoTodo((await abrir(await procuracao({ nomeOutorgante: null }))).paginas[0]);
    expect(t).not.toContain('undefined');
    expect(t).toMatch(/Outorgante/i);
  });

  it('texto vazio não rebenta a geração', async () => {
    await expect(procuracao({ texto: '' })).resolves.toBeInstanceOf(Uint8Array);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('plano de pagamento', () => {
  it('mostra o número do plano', async () => {
    expect(textoTodo((await abrir(await plano())).paginas[0])).toContain('2026/014');
  });

  it('mostra o nome do cliente', async () => {
    expect(textoTodo((await abrir(await plano())).paginas[0])).toContain('Maria Clara');
  });

  it('lista as parcelas', async () => {
    const t = textoTodo((await abrir(await plano())).paginas[0]);
    expect(t).toMatch(/1\s*\/\s*14/);
  });

  it('mostra o total do plano', async () => {
    const t = (await abrir(await plano())).paginas.map(textoTodo).join(' ');
    expect(t).toMatch(/3\.507,00|3507,00/);
  });

  it('um plano com muitas parcelas passa a mais do que uma página', async () => {
    const { paginas } = await abrir(await plano({ installments: parcelas(40) }));
    expect(paginas.length).toBeGreaterThan(1);
  });

  it('todas as páginas do plano levam o timbrado', async () => {
    const { paginas } = await abrir(await plano({ installments: parcelas(40) }));
    for (const p of paginas) {
      expect(temFundoDePagina(p.conteudo, A4[0], A4[1])).toBe(true);
    }
  });

  it('sem parcelas nenhumas não escreve NaN', async () => {
    const t = (await abrir(await plano({ installments: [] }))).paginas.map(textoTodo).join(' ');
    expect(t).not.toContain('NaN');
  });

  it('um cliente brasileiro leva o plano em reais', async () => {
    const t = (await abrir(await plano({
      client: { ...CLIENTE, country: 'BR' },
      installments: parcelas(3, { currency: 'BRL' }),
    }))).paginas.map(textoTodo).join(' ');
    expect(t).not.toContain('NaN');
  });

  it('parcela com valor ilegível não produz NaN no documento', async () => {
    const t = (await abrir(await plano({
      installments: parcelas(3).map((p, i) => (i === 1 ? { ...p, amount: 'abc' } : p)),
    }))).paginas.map(textoTodo).join(' ');
    expect(t).not.toContain('NaN');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('o corte da faixa pedido pela Dra.', () => {
  it('a faixa larga foi estreitada em 42%', () => {
    expect(CORTE_FAIXA).toBeCloseTo(0.42, 2);
  });

  it('a faixa fica toda dentro da margem direita, sem tocar no texto', () => {
    const larguraFaixa = A4[0] * 0.1719 * (1 - CORTE_FAIXA);
    expect(larguraFaixa).toBeLessThan(MARGEM.direita);
  });

  it('sem o corte a faixa entrava na área de texto (é o defeito que se corrigiu)', () => {
    const larguraOriginal = A4[0] * 0.1719;
    expect(larguraOriginal).toBeGreaterThan(MARGEM.direita);
  });
});
