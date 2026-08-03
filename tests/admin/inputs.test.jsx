// @vitest-environment jsdom
// tests/admin/inputs.test.jsx
// Campos partilhados da Área Privada (src/admin/inputs.jsx). São usados no
// cadastro, nas parcelas e nas configurações — um defeito aqui aparece em todo o lado.
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderizar, screen, within } from '../helpers/dom.jsx';
import {
  moneySymbol, MoneyInput, StepperInput, SearchInput,
  TagsInput, PasswordInput, RadioCards, IconInput,
} from '../../src/admin/inputs.jsx';

// ─── símbolo de moeda ────────────────────────────────────────────────────────
describe('moneySymbol', () => {
  it('BRL dá R$', () => expect(moneySymbol('BRL')).toBe('R$'));
  it('EUR dá €', () => expect(moneySymbol('EUR')).toBe('€'));
  it.each([undefined, null, '', 'USD', 'brl'])('%s recai no euro', (m) => {
    expect(moneySymbol(m)).toBe('€');
  });
});

// ─── MoneyInput ──────────────────────────────────────────────────────────────
describe('MoneyInput', () => {
  it('mostra o euro por omissão', () => {
    renderizar(<MoneyInput value="" onChange={() => {}} aria-label="valor" />);
    expect(screen.getByText('€')).toBeInTheDocument();
  });

  it('mostra o real quando a moeda é BRL', () => {
    renderizar(<MoneyInput currency="BRL" value="" onChange={() => {}} aria-label="valor" />);
    expect(screen.getByText('R$')).toBeInTheDocument();
  });

  it('abre o teclado decimal no telemóvel', () => {
    renderizar(<MoneyInput value="" onChange={() => {}} aria-label="valor" />);
    expect(screen.getByLabelText('valor')).toHaveAttribute('inputMode', 'decimal');
  });

  it('deixa escrever o valor', async () => {
    function Campo() {
      const [v, setV] = useState('');
      return <MoneyInput value={v} onChange={(e) => setV(e.target.value)} aria-label="valor" />;
    }
    const { utilizador } = renderizar(<Campo />);
    await utilizador.type(screen.getByLabelText('valor'), '1250,50');
    expect(screen.getByLabelText('valor')).toHaveValue('1250,50');
  });

  it('o símbolo largo (R$) marca o input com a classe própria', () => {
    renderizar(<MoneyInput currency="BRL" value="" onChange={() => {}} aria-label="valor" />);
    expect(screen.getByLabelText('valor').className).toContain('adm-in-prefix-wide');
  });

  it('mantém as classes que lhe passam', () => {
    renderizar(<MoneyInput value="" onChange={() => {}} className="minha" aria-label="valor" />);
    expect(screen.getByLabelText('valor').className).toContain('minha');
  });
});

// ─── StepperInput ────────────────────────────────────────────────────────────
describe('StepperInput', () => {
  const montar = (props = {}) => {
    const onChange = vi.fn();
    const r = renderizar(<StepperInput value={props.value ?? '3'} onChange={onChange} aria-label="n" {...props} />);
    return { ...r, onChange, campo: screen.getByLabelText('n') };
  };

  it('sobe de um em um', async () => {
    const { utilizador, onChange } = montar();
    await utilizador.click(screen.getByRole('button', { name: /aumentar|mais|\+/i }) ?? screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '4' } });
  });

  it('desce de um em um', async () => {
    const { utilizador, onChange } = montar();
    await utilizador.click(screen.getAllByRole('button')[1]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2' } });
  });

  it('não passa abaixo do mínimo', async () => {
    const { utilizador, onChange } = montar({ value: '1', min: 1 });
    await utilizador.click(screen.getAllByRole('button')[1]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '1' } });
  });

  it('não passa acima do máximo', async () => {
    const { utilizador, onChange } = montar({ value: '999', max: 999 });
    await utilizador.click(screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '999' } });
  });

  it('valor vazio conta como zero e sobe para o mínimo', async () => {
    const { utilizador, onChange } = montar({ value: '', min: 1 });
    await utilizador.click(screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '1' } });
  });

  it('valor não numérico não rebenta', async () => {
    const { utilizador, onChange } = montar({ value: 'abc', min: 1 });
    await utilizador.click(screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '1' } });
  });

  it('desativado ignora os cliques', async () => {
    const { utilizador, onChange } = montar({ disabled: true });
    for (const b of screen.getAllByRole('button')) await utilizador.click(b);
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── SearchInput ─────────────────────────────────────────────────────────────
describe('SearchInput', () => {
  it('mostra o texto de ajuda quando está vazio', () => {
    renderizar(<SearchInput value="" onChange={() => {}} placeholder="Procurar cliente" />);
    expect(screen.getByPlaceholderText('Procurar cliente')).toBeInTheDocument();
  });

  it('o botão de limpar só aparece com texto escrito', () => {
    const { rerender } = renderizar(<SearchInput value="" onChange={() => {}} placeholder="p" />);
    const antes = screen.queryAllByRole('button').length;
    rerender(<SearchInput value="maria" onChange={() => {}} placeholder="p" />);
    expect(screen.queryAllByRole('button').length).toBeGreaterThan(antes);
  });

  it('limpar devolve string vazia', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<SearchInput value="maria" onChange={onChange} placeholder="p" />);
    await utilizador.click(screen.getAllByRole('button')[0]);
    expect(onChange.mock.calls.at(-1)[0].target.value).toBe('');
  });
});

// ─── TagsInput ───────────────────────────────────────────────────────────────
describe('TagsInput — etiquetas (nacionalidades, áreas)', () => {
  function Etiquetas({ inicial = [] }) {
    const [tags, setTags] = useState(inicial);
    return <TagsInput tags={tags} onChange={setTags} placeholder="escreva e Enter" id="tags" />;
  }
  const campo = () => document.getElementById('tags');

  it('Enter acrescenta a etiqueta', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), 'portuguesa{Enter}');
    expect(screen.getByText('portuguesa')).toBeInTheDocument();
  });

  it('a vírgula também acrescenta', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), 'brasileira,');
    expect(screen.getByText('brasileira')).toBeInTheDocument();
  });

  it('o campo fica limpo depois de acrescentar', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), 'portuguesa{Enter}');
    expect(campo()).toHaveValue('');
  });

  it('não repete uma etiqueta já existente', async () => {
    const { utilizador } = renderizar(<Etiquetas inicial={['portuguesa']} />);
    await utilizador.type(campo(), 'portuguesa{Enter}');
    expect(screen.getAllByText('portuguesa')).toHaveLength(1);
  });

  it('ignora espaços à volta', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), '   angolana   {Enter}');
    expect(screen.getByText('angolana')).toBeInTheDocument();
  });

  it('só espaços não acrescenta nada', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), '    {Enter}');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('Backspace no campo vazio remove a última', async () => {
    const { utilizador } = renderizar(<Etiquetas inicial={['a', 'b']} />);
    await utilizador.click(campo());
    await utilizador.keyboard('{Backspace}');
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('Backspace com texto escrito não remove etiquetas', async () => {
    const { utilizador } = renderizar(<Etiquetas inicial={['a']} />);
    await utilizador.type(campo(), 'xy{Backspace}');
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('o botão de remover diz o que remove (acessibilidade)', () => {
    renderizar(<Etiquetas inicial={['portuguesa']} />);
    expect(screen.getByRole('button', { name: 'Remover portuguesa' })).toBeInTheDocument();
  });

  it('remover tira só aquela etiqueta', async () => {
    const { utilizador } = renderizar(<Etiquetas inicial={['a', 'b', 'c']} />);
    await utilizador.click(screen.getByRole('button', { name: 'Remover b' }));
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('sair do campo confirma o que estava escrito', async () => {
    const { utilizador } = renderizar(<Etiquetas />);
    await utilizador.type(campo(), 'cabo-verdiana');
    await utilizador.tab();
    expect(screen.getByText('cabo-verdiana')).toBeInTheDocument();
  });

  it('desativado não mostra botões de remover', () => {
    renderizar(<TagsInput tags={['a']} onChange={() => {}} disabled id="tags" />);
    expect(screen.queryByRole('button', { name: 'Remover a' })).not.toBeInTheDocument();
  });

  it('o texto de ajuda desaparece quando já há etiquetas', () => {
    renderizar(<TagsInput tags={['a']} onChange={() => {}} placeholder="ajuda" id="tags" />);
    expect(screen.queryByPlaceholderText('ajuda')).not.toBeInTheDocument();
  });
});

// ─── PasswordInput ───────────────────────────────────────────────────────────
describe('PasswordInput', () => {
  it('esconde a password por omissão', () => {
    renderizar(<PasswordInput value="segredo" onChange={() => {}} aria-label="pw" />);
    expect(screen.getByLabelText('pw')).toHaveAttribute('type', 'password');
  });

  it('o olho mostra e volta a esconder', async () => {
    const { utilizador } = renderizar(<PasswordInput value="segredo" onChange={() => {}} aria-label="pw" />);
    await utilizador.click(screen.getByRole('button', { name: 'Mostrar palavra-passe' }));
    expect(screen.getByLabelText('pw')).toHaveAttribute('type', 'text');
    await utilizador.click(screen.getByRole('button', { name: 'Ocultar palavra-passe' }));
    expect(screen.getByLabelText('pw')).toHaveAttribute('type', 'password');
  });

  it('o olho fica fora da navegação por Tab', () => {
    renderizar(<PasswordInput value="" onChange={() => {}} aria-label="pw" />);
    expect(screen.getByRole('button')).toHaveAttribute('tabIndex', '-1');
  });

  it('o olho não submete o formulário à volta', () => {
    renderizar(<PasswordInput value="" onChange={() => {}} aria-label="pw" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

// ─── RadioCards ──────────────────────────────────────────────────────────────
describe('RadioCards', () => {
  const OPCOES = [
    { value: 'singular', title: 'Pessoa singular', desc: 'Cliente particular' },
    { value: 'coletiva', title: 'Pessoa coletiva', desc: 'Empresa' },
  ];

  it('mostra todas as opções com título e descrição', () => {
    renderizar(<RadioCards options={OPCOES} value="singular" onChange={() => {}} />);
    expect(screen.getByText('Pessoa singular')).toBeInTheDocument();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
  });

  it('marca visualmente a opção escolhida', () => {
    renderizar(<RadioCards options={OPCOES} value="coletiva" onChange={() => {}} />);
    const cartao = screen.getByText('Pessoa coletiva').closest('button');
    expect(cartao.className).toContain('sel');
  });

  it('só uma opção fica marcada', () => {
    renderizar(<RadioCards options={OPCOES} value="coletiva" onChange={() => {}} />);
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('sel'))).toHaveLength(1);
  });

  it('clicar devolve o valor da opção', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<RadioCards options={OPCOES} value="singular" onChange={onChange} />);
    await utilizador.click(screen.getByText('Pessoa coletiva'));
    expect(onChange).toHaveBeenCalledWith('coletiva');
  });

  it('desativado ignora os cliques', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<RadioCards options={OPCOES} value="singular" onChange={onChange} disabled />);
    await utilizador.click(screen.getByText('Pessoa coletiva'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opção sem descrição não deixa buraco', () => {
    renderizar(<RadioCards options={[{ value: 'a', title: 'Só título' }]} value="a" onChange={() => {}} />);
    const cartao = screen.getByText('Só título').closest('button');
    expect(within(cartao).queryByText('', { selector: '.adm-radio-card-desc' })).not.toBeInTheDocument();
  });

  it('lista vazia não rebenta', () => {
    renderizar(<RadioCards options={[]} value={null} onChange={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('os cartões não submetem o formulário à volta', () => {
    renderizar(<RadioCards options={OPCOES} value="singular" onChange={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('type', 'button');
  });
});

// ─── IconInput ───────────────────────────────────────────────────────────────
describe('IconInput', () => {
  it('mostra o ícone de e-mail por omissão', () => {
    const { container } = renderizar(<IconInput value="" onChange={() => {}} aria-label="mail" />);
    expect(container.querySelector('.adm-input-icon svg')).toBeTruthy();
  });

  it('aceita o ícone de telefone', () => {
    const { container } = renderizar(<IconInput icon="phone" value="" onChange={() => {}} aria-label="tel" />);
    expect(container.querySelector('.adm-input-icon svg')).toBeTruthy();
  });

  it('deixa escrever normalmente', async () => {
    function Campo() {
      const [v, setV] = useState('');
      return <IconInput value={v} onChange={(e) => setV(e.target.value)} aria-label="mail" />;
    }
    const { utilizador } = renderizar(<Campo />);
    await utilizador.type(screen.getByLabelText('mail'), 'maria@exemplo.pt');
    expect(screen.getByLabelText('mail')).toHaveValue('maria@exemplo.pt');
  });
});
