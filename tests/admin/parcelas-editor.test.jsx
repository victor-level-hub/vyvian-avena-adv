// @vitest-environment jsdom
// tests/admin/parcelas-editor.test.jsx
// Editor de parcelas (src/admin/ParcelasEditor.jsx) — o plano de honorários.
// É aqui que se divide o valor acordado com o cliente: enganos nos cêntimos ou na
// soma que "fecha" acabam num plano de pagamento errado.
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderizar, screen } from '../helpers/dom.jsx';
import ParcelasEditor, {
  addMonthsISO, parseValor, fmtValor, gerarParcelas, somaParcelas,
} from '../../src/admin/ParcelasEditor.jsx';

// O fmtValor separa o símbolo do valor com um espaço INSEPARÁVEL ( ), de
// propósito: impede que "€ 200,00" se parta em duas linhas. Os testes normalizam-no
// para espaço normal — assim as expectativas ficam legíveis, sem caracteres
// invisíveis no ficheiro, e continuam a apanhar uma mudança real de formato.
const norm = (s) => String(s ?? '').replace(/ /g, ' ');
const valor = (v, moeda) => norm(fmtValor(v, moeda));
// getByText que compara o texto do elemento já normalizado
const porTexto = (padrao) => (_conteudo, el) =>
  el?.children.length === 0 && padrao.test(norm(el.textContent));
// A linha da soma é montada com vários nós de texto soltos ("Soma: ", o valor, " de ",
// o outro valor), por isso não há um elemento único que a contenha — lê-se o quadro todo.
const textoDoQuadro = (container) => norm(container.textContent);

// ─── addMonthsISO ────────────────────────────────────────────────────────────
describe('addMonthsISO — datas de vencimento mensais', () => {
  it('soma um mês', () => expect(addMonthsISO('2026-01-10', 1)).toBe('2026-02-10'));
  it('zero devolve o mesmo dia', () => expect(addMonthsISO('2026-01-10', 0)).toBe('2026-01-10'));
  it('atravessa o ano', () => expect(addMonthsISO('2026-11-15', 3)).toBe('2027-02-15'));
  it('aceita meses negativos', () => expect(addMonthsISO('2026-03-10', -2)).toBe('2026-01-10'));

  // CORRIGIDO (era): o Date.setMonth transbordava — 31/01 + 1 mês dava 03/03 e o
  // plano saltava fevereiro inteiro. Agora o dia é limitado ao último do mês de
  // destino, que é o que uma pessoa espera de «todo o dia 31, ou o último».
  it('dia 31 cai no último dia do mês seguinte, sem saltar meses', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2026-01-31', 3)).toBe('2026-04-30');
  });

  it('29 de fevereiro de ano bissexto cai em 28 no ano seguinte', () => {
    expect(addMonthsISO('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('um dia que existe nos dois meses mantém-se igual', () => {
    expect(addMonthsISO('2026-01-15', 1)).toBe('2026-02-15');
  });
});

// ─── parseValor ──────────────────────────────────────────────────────────────
describe('parseValor — aceitar o que a Dra. escreve', () => {
  it('aceita ponto decimal', () => expect(parseValor('1250.50')).toBe(1250.5));
  it('aceita vírgula decimal (formato português)', () => expect(parseValor('1250,50')).toBe(1250.5));
  it('aceita número já numérico', () => expect(parseValor(300)).toBe(300));
  it.each([null, undefined, '', '   ', 'abc'])('%s vale zero em vez de NaN', (v) => {
    expect(parseValor(v)).toBe(0);
  });
  it('valor negativo é preservado', () => expect(parseValor('-50')).toBe(-50));
  it('só a primeira vírgula é convertida', () => expect(parseValor('1,250,50')).toBe(1.25));
});

// ─── fmtValor ────────────────────────────────────────────────────────────────
describe('fmtValor — apresentação', () => {
  it('euro com duas casas', () => expect(valor(1250.5)).toBe('€ 1250,50'));
  it('real quando a moeda é BRL', () => expect(valor(100,'BRL')).toBe('R$ 100,00'));
  it('zero mostra 0,00 e não vazio', () => expect(valor(0)).toBe('€ 0,00'));
  it.each([null, undefined, NaN])('%s mostra 0,00 em vez de NaN', (v) => {
    expect(valor(v)).toBe('€ 0,00');
  });
  it('arredonda a duas casas', () => expect(valor(33.336)).toBe('€ 33,34'));
});

// ─── gerarParcelas ───────────────────────────────────────────────────────────
describe('gerarParcelas — dividir o total', () => {
  it('divide em partes iguais quando dá certo', () => {
    const r = gerarParcelas(1200, 12, '2026-01-10');
    expect(r).toHaveLength(12);
    expect(r.every((p) => p.amount === '100.00')).toBe(true);
  });

  it('a última parcela absorve o arredondamento', () => {
    const r = gerarParcelas(100, 3, '2026-01-10');
    expect(r.map((p) => p.amount)).toEqual(['33.33', '33.33', '33.34']);
  });

  it('a soma bate sempre certo com o total', () => {
    for (const [total, n] of [[100, 3], [1000, 7], [250.5, 4], [99.99, 6], [1, 3]]) {
      expect(somaParcelas(gerarParcelas(total, n, '2026-01-10'))).toBe(total);
    }
  });

  it('as datas são mensais consecutivas', () => {
    const r = gerarParcelas(300, 3, '2026-01-10');
    expect(r.map((p) => p.due_date)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('numera a partir de 1 por omissão', () => {
    expect(gerarParcelas(300, 3, '2026-01-10').map((p) => p.n)).toEqual([1, 2, 3]);
  });

  it('aceita começar noutro número (acrescentar a um plano existente)', () => {
    expect(gerarParcelas(200, 2, '2026-01-10', 5).map((p) => p.n)).toEqual([5, 6]);
  });

  it('uma só parcela leva o total inteiro', () => {
    expect(gerarParcelas(999.99, 1, '2026-01-10')[0].amount).toBe('999.99');
  });

  it('total zero gera parcelas a zero sem rebentar', () => {
    const r = gerarParcelas(0, 3, '2026-01-10');
    expect(somaParcelas(r)).toBe(0);
  });

  it('zero parcelas devolve lista vazia', () => {
    expect(gerarParcelas(100, 0, '2026-01-10')).toEqual([]);
  });
});

// ─── somaParcelas ────────────────────────────────────────────────────────────
describe('somaParcelas', () => {
  it('lista vazia soma zero e não NaN', () => expect(somaParcelas([])).toBe(0));
  it('soma valores com vírgula', () => {
    expect(somaParcelas([{ amount: '100,50' }, { amount: '99,50' }])).toBe(200);
  });
  it('ignora entradas ilegíveis em vez de dar NaN', () => {
    expect(somaParcelas([{ amount: '100' }, { amount: 'abc' }, { amount: null }])).toBe(100);
  });
  it('não acumula erro de vírgula flutuante', () => {
    expect(somaParcelas(Array(10).fill({ amount: '0.1' }))).toBe(1);
  });
});

// ─── componente ──────────────────────────────────────────────────────────────
describe('ParcelasEditor — o quadro que a Dra. vê', () => {
  const LINHAS = [
    { n: 1, due_date: '2026-01-10', amount: '100.00' },
    { n: 2, due_date: '2026-02-10', amount: '100.00' },
  ];

  function Editor({ inicial = LINHAS, total = 200, ...props }) {
    const [rows, setRows] = useState(inicial);
    return <ParcelasEditor rows={rows} onChange={setRows} currency="EUR" targetTotal={total} {...props} />;
  }

  it('mostra uma linha por parcela, numerada', () => {
    renderizar(<Editor />);
    expect(screen.getByText('Parcela 1')).toBeInTheDocument();
    expect(screen.getByText('Parcela 2')).toBeInTheDocument();
  });

  it('a soma que fecha com o total aparece com o visto', () => {
    const { container } = renderizar(<Editor />);
    expect(textoDoQuadro(container)).toContain('Soma: € 200,00 de € 200,00');
    expect(textoDoQuadro(container)).toContain('✓');
  });

  it('a soma a menos diz quanto falta', () => {
    const { container } = renderizar(<Editor total={300} />);
    expect(textoDoQuadro(container)).toContain('faltam € 100,00');
  });

  it('a soma a mais diz quanto está a mais', () => {
    const { container } = renderizar(<Editor total={150} />);
    expect(textoDoQuadro(container)).toContain('€ 50,00 a mais');
  });

  it('uma diferença de cêntimos ainda conta como fechada (tolerância)', () => {
    const { container } = renderizar(<Editor total={200.004} />);
    expect(textoDoQuadro(container)).toContain('✓');
  });

  it('uma diferença de um cêntimo NÃO conta como fechada', () => {
    const { container } = renderizar(<Editor total={200.01} />);
    expect(textoDoQuadro(container)).not.toContain('✓');
  });

  it('escrever um valor atualiza a soma', async () => {
    const { utilizador, container } = renderizar(<Editor total={200} />);
    const campos = screen.getAllByRole('textbox').filter((i) => i.inputMode === 'decimal');
    await utilizador.clear(campos[0]);
    await utilizador.type(campos[0], '150');
    expect(textoDoQuadro(container)).toContain('Soma: € 250,00');
  });

  it('aceita vírgula decimal no campo', async () => {
    const { utilizador, container } = renderizar(<Editor total={200} />);
    const campos = screen.getAllByRole('textbox').filter((i) => i.inputMode === 'decimal');
    await utilizador.clear(campos[0]);
    await utilizador.type(campos[0], '99,50');
    expect(textoDoQuadro(container)).toContain('Soma: € 199,50');
  });

  it('conta o valor já pago quando existe uma base', () => {
    const { container } = renderizar(<Editor total={500} baseSum={300} baseLabel="Já pago: € 300,00" />);
    expect(screen.getByText(porTexto(/Já pago: € 300,00/))).toBeInTheDocument();
    expect(textoDoQuadro(container)).toContain('Soma: € 500,00 de € 500,00');
  });

  it('marca visualmente a parcela já paga', () => {
    renderizar(<Editor inicial={[{ n: 1, due_date: '2026-01-10', amount: '200.00', paid: true }]} />);
    expect(screen.getByText(/Paga/)).toBeInTheDocument();
  });

  it('a parcela paga não pode ser eliminada', () => {
    renderizar(<Editor
      inicial={[{ n: 1, due_date: '2026-01-10', amount: '100', paid: true }, { n: 2, due_date: '2026-02-10', amount: '100' }]}
      onRemove={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '✕' })).toHaveLength(1);
  });

  it('eliminar avisa qual a linha', async () => {
    const onRemove = vi.fn();
    const { utilizador } = renderizar(<Editor onRemove={onRemove} />);
    await utilizador.click(screen.getAllByRole('button', { name: '✕' })[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('não deixa eliminar a última parcela que resta', () => {
    renderizar(<Editor inicial={[LINHAS[0]]} total={100} onRemove={vi.fn()} />);
    expect(screen.getByRole('button', { name: '✕' })).toBeDisabled();
  });

  it('desmarcar uma parcela paga avisa qual', async () => {
    const onUnmark = vi.fn();
    const { utilizador } = renderizar(<Editor
      inicial={[{ n: 1, due_date: '2026-01-10', amount: '200.00', paid: true }]} onUnmark={onUnmark} />);
    await utilizador.click(screen.getByRole('button', { name: /Paga/ }));
    expect(onUnmark).toHaveBeenCalledWith(0);
  });

  it('desativado impede escrever nos valores', () => {
    renderizar(<Editor disabled />);
    for (const c of screen.getAllByRole('textbox').filter((i) => i.inputMode === 'decimal')) {
      expect(c).toBeDisabled();
    }
  });

  it('desativado ignora o desmarcar', async () => {
    const onUnmark = vi.fn();
    const { utilizador } = renderizar(<Editor
      inicial={[{ n: 1, due_date: '2026-01-10', amount: '200.00', paid: true }]} onUnmark={onUnmark} disabled />);
    await utilizador.click(screen.getByRole('button', { name: /Paga/ }));
    expect(onUnmark).not.toHaveBeenCalled();
  });

  it('mostra o real quando o plano é em BRL', () => {
    const { container } = renderizar(<Editor total={200} currency="BRL" />);
    expect(textoDoQuadro(container)).toContain('R$ 200,00');
  });

  it('lista vazia não rebenta e mostra soma zero', () => {
    const { container } = renderizar(<Editor inicial={[]} total={0} />);
    expect(textoDoQuadro(container)).toContain('Soma: € 0,00 de € 0,00');
  });

  it('sem onRemove não mostra botões de eliminar', () => {
    renderizar(<Editor />);
    expect(screen.queryByRole('button', { name: '✕' })).not.toBeInTheDocument();
  });
});
