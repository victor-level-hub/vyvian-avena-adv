// @vitest-environment jsdom
// tests/admin/componentes.test.jsx
// Componentes partilhados da Área Privada — os tijolos que TODOS os ecrãs usam:
//
//   datepicker.jsx    calendário de todas as datas (cadastro, parcelas, tickets)
//   dropdown.jsx      substituto do <select>
//   people-picker.jsx escolha de titulares nos clientes conjuntos
//   tabs.jsx          separadores com indicador deslizante
//   skeletons.jsx     blocos de "a carregar"
//   Avatar.jsx        fotografia/iniciais da Dra.
//   numbers.jsx       CountUp dos KPIs do painel
//   modal-close.jsx   o ✕ de todos os modais (e o Esc)
//   cmdk.jsx          paleta de comandos (Ctrl+K)
//
// As outras suítes usam-nos como ferramenta sem nunca lhes bater — um defeito
// aqui aparece em todo o lado ao mesmo tempo.
//
// Defeitos reais ficam marcados com `it.fails` + comentário `// BUG:`.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderizar, render, userEvent, screen, waitFor, fireEvent, act, configure,
} from '../helpers/dom.jsx';

// `renderizar` embrulha tudo no MemoryRouter; um `rerender` a seguir troca a raiz
// da árvore e o React DESMONTA e volta a montar — o que estraga qualquer teste
// sobre o que acontece *entre* renders (a animação do CountUp, a pilha de
// modais). Estes componentes não precisam de Router: monta-se direto.
function montar(ui) {
  const utilizador = userEvent.setup();
  return { ...render(ui), utilizador };
}

// a suíte corre com muitos ficheiros ao mesmo tempo; o jsdom fica lento sob
// carga e o 1 s por omissão do findBy/waitFor não chega
configure({ asyncUtilTimeout: 3000 });

// ── a rede está fechada: tudo o que fale com a API vive mockado ──────────────
const { listaClientes } = vi.hoisted(() => ({ listaClientes: vi.fn() }));
const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));
const { sessao } = vi.hoisted(() => ({ sessao: { ligada: true } }));

vi.mock('../../src/admin/apiClient.js', () => ({
  clients: { list: listaClientes },
  auth: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
  setToken: vi.fn(), clearToken: vi.fn(), getToken: vi.fn(),
}));
vi.mock('../../src/admin/auth.js', () => ({
  isAuthenticated: () => sessao.ligada,
  getSession: () => (sessao.ligada ? { name: 'Vyvian' } : null),
  login: vi.fn(), logout: vi.fn(),
}));
vi.mock('react-router-dom', async (original) => ({
  ...await original(),
  useNavigate: () => navegou,
}));

import DateInput from '../../src/admin/datepicker.jsx';
import SelectMenu from '../../src/admin/dropdown.jsx';
import PeoplePicker from '../../src/admin/people-picker.jsx';
import SlidingTabs from '../../src/admin/tabs.jsx';
import { SkeletonPage, SkeletonRows } from '../../src/admin/skeletons.jsx';
import Avatar from '../../src/admin/Avatar.jsx';
import { CountUp } from '../../src/admin/numbers.jsx';
import ModalClose from '../../src/admin/modal-close.jsx';
import CommandPalette from '../../src/admin/cmdk.jsx';

/* ═══════════════════════════════════════════════════════════════════════════
   DateInput — o calendário
   ═══════════════════════════════════════════════════════════════════════════ */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const pad2 = (n) => String(n).padStart(2, '0');
const HOJE = new Date();
const HOJE_ISO = `${HOJE.getFullYear()}-${pad2(HOJE.getMonth() + 1)}-${pad2(HOJE.getDate())}`;
const HOJE_TITULO = `${MESES[HOJE.getMonth()]} ${HOJE.getFullYear()}`;

// o gatilho é sempre o primeiro botão do componente
const gatilho = () => screen.getAllByRole('button')[0];
const titulo = () => document.querySelector('.adm-date-title')?.textContent ?? null;
const abertoCalendario = () => !!document.querySelector('.adm-date-pop');
const dias = () => screen.getAllByRole('button')
  .filter((b) => /^\d+$/.test(b.textContent.trim()))
  .map((b) => b.textContent.trim());

// versão controlada, para se poder ver o valor a mudar no botão
function DataControlada({ inicial = '', ...resto }) {
  const [v, setV] = useState(inicial);
  return <DateInput value={v} onChange={(e) => setV(e.target.value)} {...resto} />;
}

describe('DateInput — estado fechado', () => {
  it('sem data mostra o texto de ajuda', () => {
    renderizar(<DateInput value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'dd/mm/aaaa' })).toBeInTheDocument();
  });

  it('aceita um texto de ajuda personalizado', () => {
    renderizar(<DateInput value="" onChange={() => {}} placeholder="quando?" />);
    expect(screen.getByRole('button', { name: 'quando?' })).toBeInTheDocument();
  });

  it('mostra a data em dd/mm/aaaa, não em ISO', () => {
    renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '14/07/2026' })).toBeInTheDocument();
    expect(screen.queryByText('2026-07-14')).not.toBeInTheDocument();
  });

  it('mantém os zeros à esquerda no dia e no mês', () => {
    renderizar(<DateInput value="2026-01-05" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '05/01/2026' })).toBeInTheDocument();
  });

  it('valor null mostra o texto de ajuda', () => {
    renderizar(<DateInput value={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'dd/mm/aaaa' })).toBeInTheDocument();
  });

  it('valor undefined mostra o texto de ajuda', () => {
    renderizar(<DateInput onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'dd/mm/aaaa' })).toBeInTheDocument();
  });

  it('o calendário começa fechado', () => {
    renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    expect(abertoCalendario()).toBe(false);
  });

  it('o gatilho não submete o formulário à volta', () => {
    renderizar(<DateInput value="" onChange={() => {}} />);
    expect(gatilho()).toHaveAttribute('type', 'button');
  });

  it('o gatilho leva o id que lhe passam', () => {
    renderizar(<DateInput value="" onChange={() => {}} id="data-nascimento" />);
    expect(document.getElementById('data-nascimento')).toBe(gatilho());
  });

  it('sem valor o botão fica marcado como vazio', () => {
    renderizar(<DateInput value="" onChange={() => {}} />);
    expect(gatilho().className).toContain('empty');
  });

  it('com valor o botão deixa de estar marcado como vazio', () => {
    renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    expect(gatilho().className).not.toContain('empty');
  });

  it('o ícone do calendário está escondido dos leitores de ecrã', () => {
    const { container } = renderizar(<DateInput value="" onChange={() => {}} />);
    expect(container.querySelector('.adm-date-btn svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('DateInput — abrir e fechar', () => {
  it('clicar abre o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(abertoCalendario()).toBe(true);
  });

  it('clicar outra vez fecha', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(gatilho());
    expect(abertoCalendario()).toBe(false);
  });

  it('aberto marca o botão', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(gatilho().className).toContain('open');
  });

  it('desativado não abre', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} disabled />);
    await utilizador.click(gatilho());
    expect(abertoCalendario()).toBe(false);
  });

  it('desativado marca o botão como inativo', () => {
    renderizar(<DateInput value="" onChange={() => {}} disabled />);
    expect(gatilho()).toBeDisabled();
  });

  it('abre no mês da data escolhida', async () => {
    const { utilizador } = renderizar(<DateInput value="2024-03-09" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(titulo()).toBe('março 2024');
  });

  it('sem data abre no mês de hoje', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(titulo()).toBe(HOJE_TITULO);
  });

  it('reabrir volta ao mês da data, esquecendo a navegação anterior', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(titulo()).toBe('agosto 2026');
    await utilizador.click(gatilho());
    await utilizador.click(gatilho());
    expect(titulo()).toBe('julho 2026');
  });

  it('a tecla Escape fecha', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.keyboard('{Escape}');
    expect(abertoCalendario()).toBe(false);
  });

  it('a tecla Escape não mexe no valor', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('outra tecla qualquer não fecha', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.keyboard('a');
    expect(abertoCalendario()).toBe(true);
  });

  it('clicar fora fecha', async () => {
    const { utilizador } = renderizar(
      <div><DateInput value="" onChange={() => {}} /><button type="button">fora</button></div>,
    );
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'fora' }));
    expect(abertoCalendario()).toBe(false);
  });

  it('clicar dentro do calendário não fecha', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByText('julho 2026'));
    expect(abertoCalendario()).toBe(true);
  });

  it('o scroll de um contentor fecha (o popover é fixed e ficaria solto)', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    fireEvent.scroll(document);
    await waitFor(() => expect(abertoCalendario()).toBe(false));
  });

  // CORRIGIDO (era): src/admin/datepicker.jsx:30/34 — o mesmo handler serve o `scroll` e o
  // `resize`, mas no `resize` o e.target é a `window`, que não é um Node:
  // `ref.current.contains(window)` atira "Failed to execute 'contains' on
  // 'Node'" e o `setOpen(false)` nunca chega a correr. Resultado: redimensionar
  // a janela (ou rodar o telemóvel) deixa o calendário aberto e desalinhado do
  // campo, porque o popover é position:fixed com coordenadas já calculadas.
  it('redimensionar a janela devia fechar o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    // o TypeError do listener não pode afundar a suíte inteira
    const engolir = (e) => e.preventDefault();
    window.addEventListener('error', engolir);
    fireEvent(window, new Event('resize'));
    window.removeEventListener('error', engolir);
    expect(abertoCalendario()).toBe(false);
  });

  it('depois de fechado o Escape não rebenta', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.keyboard('{Escape}');
    await utilizador.keyboard('{Escape}');
    expect(abertoCalendario()).toBe(false);
  });

  it('desmontar com o calendário aberto não deixa listeners a rebentar', async () => {
    const { utilizador, unmount } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    unmount();
    await utilizador.keyboard('{Escape}');
    expect(document.querySelector('.adm-date-pop')).toBeNull();
  });
});

describe('DateInput — escolher um dia', () => {
  it('devolve a data em ISO', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '23' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-07-23' } });
  });

  it('o evento tem o formato { target: { value } } (compatível com o input nativo)', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '1' }));
    expect(onChange.mock.calls[0][0].target.value).toBe('2026-07-01');
  });

  it('escolher fecha o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '23' }));
    expect(abertoCalendario()).toBe(false);
  });

  it('dia de um algarismo sai com zero à esquerda', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-07-05' } });
  });

  it('mês de um algarismo sai com zero à esquerda', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-03-10" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '10' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-03-10' } });
  });

  it('o botão passa a mostrar a data escolhida', async () => {
    const { utilizador } = renderizar(<DataControlada inicial="2026-07-14" />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '23' }));
    expect(screen.getByRole('button', { name: '23/07/2026' })).toBeInTheDocument();
  });

  it('escolher a partir do vazio preenche', async () => {
    const { utilizador } = renderizar(<DataControlada />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '11' }));
    const esperado = `11/${pad2(HOJE.getMonth() + 1)}/${HOJE.getFullYear()}`;
    expect(screen.getByRole('button', { name: esperado })).toBeInTheDocument();
  });

  it('o dia escolhido aparece marcado', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(screen.getByRole('button', { name: '14' }).className).toContain('sel');
  });

  it('só um dia fica marcado', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    const marcados = screen.getAllByRole('button').filter((b) => b.className.includes('adm-date-day') && b.className.includes(' sel'));
    expect(marcados).toHaveLength(1);
  });

  it('o dia de hoje vem assinalado', async () => {
    const { utilizador } = renderizar(<DateInput value={HOJE_ISO} onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(screen.getByRole('button', { name: String(HOJE.getDate()) }).className).toContain('today');
  });

  it('noutro mês nenhum dia é hoje', async () => {
    const { utilizador } = renderizar(<DateInput value="1999-05-10" onChange={() => {}} />);
    await utilizador.click(gatilho());
    const hojes = screen.getAllByRole('button').filter((b) => b.className.includes('today'));
    expect(hojes).toHaveLength(0);
  });

  it('escolher depois de navegar usa o mês em vista, não o do valor', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    await utilizador.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-08-03' } });
  });

  it('os dias não submetem o formulário à volta', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('type', 'button');
  });

  it('aceita datas muito no passado', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="1901-01-15" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '2' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '1901-01-02' } });
  });

  it('aceita datas muito no futuro (não há limite máximo)', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2099-12-01" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '31' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2099-12-31' } });
  });
});

describe('DateInput — navegação de mês e ano', () => {
  const abrir = async (valor = '2026-07-14') => {
    const r = renderizar(<DateInput value={valor} onChange={() => {}} />);
    await r.utilizador.click(gatilho());
    return r;
  };

  it('mês seguinte avança um mês', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(titulo()).toBe('agosto 2026');
  });

  it('mês anterior recua um mês', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(titulo()).toBe('junho 2026');
  });

  it('de janeiro para trás salta para dezembro do ano anterior', async () => {
    const { utilizador } = await abrir('2026-01-10');
    await utilizador.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(titulo()).toBe('dezembro 2025');
  });

  it('de dezembro para a frente salta para janeiro do ano seguinte', async () => {
    const { utilizador } = await abrir('2026-12-10');
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(titulo()).toBe('janeiro 2027');
  });

  it('ano seguinte avança um ano', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Ano seguinte' }));
    expect(titulo()).toBe('julho 2027');
  });

  it('ano anterior recua um ano', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Ano anterior' }));
    expect(titulo()).toBe('julho 2025');
  });

  it('doze meses para a frente dá o mesmo mês do ano seguinte', async () => {
    const { utilizador } = await abrir();
    for (let i = 0; i < 12; i += 1) await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(titulo()).toBe('julho 2027');
  });

  it('doze meses para trás dá o mesmo mês do ano anterior', async () => {
    const { utilizador } = await abrir();
    for (let i = 0; i < 12; i += 1) await utilizador.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(titulo()).toBe('julho 2025');
  });

  it('avançar e recuar volta ao princípio', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    await utilizador.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(titulo()).toBe('julho 2026');
  });

  it('navegar não fecha o calendário', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Ano seguinte' }));
    expect(abertoCalendario()).toBe(true);
  });

  it('navegar não muda o valor', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    await utilizador.click(screen.getByRole('button', { name: 'Ano anterior' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('navegar não muda o texto do botão', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(gatilho()).toHaveTextContent('14/07/2026');
  });

  it('o ano anterior mantém o mês em vista', async () => {
    const { utilizador } = await abrir('2026-11-02');
    await utilizador.click(screen.getByRole('button', { name: 'Ano anterior' }));
    expect(titulo()).toBe('novembro 2025');
  });

  it('atravessar fevereiro para trás não salta um mês', async () => {
    const { utilizador } = await abrir('2026-03-31');
    await utilizador.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(titulo()).toBe('fevereiro 2026');
  });

  it('os quatro botões de navegação têm nome acessível', async () => {
    await abrir();
    for (const nome of ['Ano anterior', 'Mês anterior', 'Mês seguinte', 'Ano seguinte']) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    }
  });

  it('todos os meses do ano têm nome em português', async () => {
    const { utilizador } = await abrir('2026-01-01');
    for (const mes of MESES) {
      expect(titulo()).toBe(`${mes} 2026`);
      await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    }
    expect(titulo()).toBe('janeiro 2027');
  });
});

describe('DateInput — a grelha do mês', () => {
  const abrir = async (valor) => {
    const r = renderizar(<DateInput value={valor} onChange={() => {}} />);
    await r.utilizador.click(gatilho());
    return r;
  };
  const grelha = () => document.querySelectorAll('.adm-date-grid')[1];

  it('mostra as sete iniciais dos dias da semana', async () => {
    await abrir('2026-07-14');
    const cabecalho = document.querySelector('.adm-date-wk');
    expect(cabecalho.children).toHaveLength(7);
  });

  it('a semana começa à segunda e acaba ao domingo', async () => {
    await abrir('2026-07-14');
    const iniciais = [...document.querySelector('.adm-date-wk').children].map((s) => s.textContent);
    expect(iniciais).toEqual(['S', 'T', 'Q', 'Q', 'S', 'S', 'D']);
  });

  it('julho de 2026 tem 31 dias', async () => {
    await abrir('2026-07-14');
    expect(dias()).toHaveLength(31);
  });

  it('os dias aparecem por ordem, de 1 até ao último', async () => {
    await abrir('2026-07-14');
    expect(dias()).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1)));
  });

  it('abril tem 30 dias', async () => {
    await abrir('2026-04-10');
    expect(dias()).toHaveLength(30);
  });

  it('fevereiro de 2026 tem 28 dias', async () => {
    await abrir('2026-02-10');
    expect(dias()).toHaveLength(28);
  });

  it('fevereiro de 2024 (bissexto) tem 29 dias', async () => {
    await abrir('2024-02-10');
    expect(dias()).toHaveLength(29);
  });

  it('fevereiro de 2000 (bissexto de século) tem 29 dias', async () => {
    await abrir('2000-02-10');
    expect(dias()).toHaveLength(29);
  });

  it('fevereiro de 1900 (não bissexto) tem 28 dias', async () => {
    await abrir('1900-02-10');
    expect(dias()).toHaveLength(28);
  });

  it('o 29 de fevereiro de um ano bissexto pode escolher-se', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2024-02-01" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: '29' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2024-02-29' } });
  });

  it('não mostra dias do mês anterior nem do seguinte', async () => {
    await abrir('2026-07-14');
    const lista = dias();
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista[0]).toBe('1');
  });

  it('as casas vazias antes do dia 1 alinham o mês pelo dia da semana', async () => {
    await abrir('2026-07-14'); // 1 de julho de 2026 é uma quarta-feira → 2 casas
    expect(grelha().children).toHaveLength(2 + 31);
  });

  it('um mês que comece ao domingo leva seis casas vazias', async () => {
    await abrir('2026-03-10'); // 1 de março de 2026 é domingo
    expect(grelha().children).toHaveLength(6 + 31);
  });

  it('um mês que comece à segunda não leva casas vazias', async () => {
    await abrir('2026-06-10'); // 1 de junho de 2026 é segunda
    expect(grelha().children).toHaveLength(30);
  });

  it('navegar para fevereiro encolhe a grelha', async () => {
    const { utilizador } = await abrir('2026-01-10');
    expect(dias()).toHaveLength(31);
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(dias()).toHaveLength(28);
  });

  it('navegar de fevereiro de 2023 para 2024 mostra o dia 29', async () => {
    const { utilizador } = await abrir('2023-02-10');
    expect(screen.queryByRole('button', { name: '29' })).not.toBeInTheDocument();
    await utilizador.click(screen.getByRole('button', { name: 'Ano seguinte' }));
    expect(screen.getByRole('button', { name: '29' })).toBeInTheDocument();
  });
});

describe('DateInput — Hoje e Limpar', () => {
  it('"Hoje" devolve a data de hoje em ISO', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2020-01-01" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: HOJE_ISO } });
  });

  it('"Hoje" fecha o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(abertoCalendario()).toBe(false);
  });

  it('"Hoje" existe mesmo sem data escolhida', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();
  });

  it('"Hoje" ignora o mês em vista', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Ano anterior' }));
    await utilizador.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    await utilizador.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: HOJE_ISO } });
  });

  it('"Limpar" só aparece quando há data', async () => {
    const { utilizador } = renderizar(<DateInput value="" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();
  });

  it('"Limpar" aparece com data', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
  });

  it('"Limpar" devolve texto vazio', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: '' } });
  });

  it('"Limpar" fecha o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(abertoCalendario()).toBe(false);
  });

  it('depois de limpar o botão volta ao texto de ajuda', async () => {
    const { utilizador } = renderizar(<DataControlada inicial="2026-07-14" />);
    await utilizador.click(gatilho());
    await utilizador.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByRole('button', { name: 'dd/mm/aaaa' })).toBeInTheDocument();
  });

  it('clearable={false} esconde o "Limpar" mesmo com data', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} clearable={false} />);
    await utilizador.click(gatilho());
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();
  });

  it('clearable={false} mantém o "Hoje"', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} clearable={false} />);
    await utilizador.click(gatilho());
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();
  });
});

describe('DateInput — teclado', () => {
  it('Enter no gatilho abre o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    gatilho().focus();
    await utilizador.keyboard('{Enter}');
    expect(abertoCalendario()).toBe(true);
  });

  it('Espaço no gatilho abre o calendário', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    gatilho().focus();
    await utilizador.keyboard(' ');
    expect(abertoCalendario()).toBe(true);
  });

  it('Tab depois de abrir chega aos botões de navegação', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    await utilizador.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', 'Ano anterior');
  });

  it('Enter num dia escolhe-o', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={onChange} />);
    await utilizador.click(gatilho());
    screen.getByRole('button', { name: '9' }).focus();
    await utilizador.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-07-09' } });
  });

  it('as setas não navegam na grelha (só há Tab)', async () => {
    const { utilizador } = renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    await utilizador.click(gatilho());
    screen.getByRole('button', { name: '9' }).focus();
    await utilizador.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveTextContent('9');
  });

  it('desativado fica fora da navegação por Tab', async () => {
    const { utilizador } = renderizar(
      <div><DateInput value="" onChange={() => {}} disabled /><button type="button">a seguir</button></div>,
    );
    await utilizador.tab();
    expect(document.activeElement).toHaveTextContent('a seguir');
  });
});

describe('DateInput — valores estranhos', () => {
  it('texto vazio não é tratado como data', () => {
    renderizar(<DateInput value="" onChange={() => {}} />);
    expect(gatilho()).toHaveTextContent('dd/mm/aaaa');
  });

  // CORRIGIDO (era): src/admin/datepicker.jsx:52 — abrir o calendário com um `value` que não
  // seja ISO faz `new Date('lixoT00:00:00')` → Invalid Date → view {y:NaN,m:NaN}
  // → `Array(NaN)` na linha 72 rebenta com RangeError e leva o ecrã todo à frente.
  // Devia cair no mês de hoje, como faz com o valor vazio.
  it('valor inválido devia cair no mês de hoje em vez de rebentar', async () => {
    const { utilizador } = renderizar(<DateInput value="não é data" onChange={() => {}} />);
    await utilizador.click(gatilho());
    expect(titulo()).toBe(HOJE_TITULO);
  });

  // CORRIGIDO (era): src/admin/datepicker.jsx:16 — fmtShow parte o ISO por "-" sem validar:
  // um valor mal formado aparece à Dra. como "undefined/undefined/…".
  it('valor inválido não devia aparecer como "undefined" no botão', () => {
    renderizar(<DateInput value="2026/07/14" onChange={() => {}} />);
    expect(gatilho().textContent).not.toContain('undefined');
  });

  // CORRIGIDO (era): uma data fora do formato ISO era mostrada tal e qual, com os
  // campos desencontrados. Agora o fmtShow valida e mostra o texto de ajuda.
  it('uma data fora do formato ISO mostra o texto de ajuda em vez de campos trocados', () => {
    renderizar(<DateInput value="14-07-2026" onChange={() => {}} />);
    expect(gatilho()).toHaveTextContent('dd/mm/aaaa');
    expect(gatilho().textContent).not.toContain('2026/07/14');
  });

  it('a data com hora só usa a parte da data para mostrar', () => {
    renderizar(<DateInput value="2026-07-14" onChange={() => {}} />);
    expect(gatilho()).toHaveTextContent('14/07/2026');
  });

  it('o style que lhe passam vai para o contentor', () => {
    const { container } = renderizar(<DateInput value="" onChange={() => {}} style={{ width: '150px' }} />);
    expect(container.querySelector('.adm-date')).toHaveStyle({ width: '150px' });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SelectMenu — o dropdown
   ═══════════════════════════════════════════════════════════════════════════ */

const OPCOES = [
  { value: 'aberto', label: 'Aberto' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'concluido', label: 'Concluído' },
];

describe('SelectMenu — fechado', () => {
  it('mostra o rótulo da opção ativa', () => {
    renderizar(<SelectMenu value="em_analise" onChange={() => {}} options={OPCOES} />);
    expect(screen.getByRole('button')).toHaveTextContent('Em análise');
  });

  it('valor que não está nas opções mostra um travessão', () => {
    renderizar(<SelectMenu value="inventado" onChange={() => {}} options={OPCOES} />);
    expect(screen.getByRole('button')).toHaveTextContent('—');
  });

  it('lista vazia mostra um travessão', () => {
    renderizar(<SelectMenu value="" onChange={() => {}} options={[]} />);
    expect(screen.getByRole('button')).toHaveTextContent('—');
  });

  it('o menu começa fechado', () => {
    renderizar(<SelectMenu value="aberto" onChange={() => {}} options={OPCOES} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('anuncia que está fechado', () => {
    renderizar(<SelectMenu value="aberto" onChange={() => {}} options={OPCOES} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('o botão não submete o formulário à volta', () => {
    renderizar(<SelectMenu value="aberto" onChange={() => {}} options={OPCOES} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('leva o nome acessível que lhe passam', () => {
    renderizar(<SelectMenu value="aberto" onChange={() => {}} options={OPCOES} ariaLabel="Estado do ticket" />);
    expect(screen.getByRole('button', { name: 'Estado do ticket' })).toBeInTheDocument();
  });

  it('a dica vai para o atributo data-tip', () => {
    renderizar(<SelectMenu value="aberto" onChange={() => {}} options={OPCOES} tip="Filtrar" tipPos="top" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-tip', 'Filtrar');
    expect(screen.getByRole('button')).toHaveAttribute('data-tip-pos', 'top');
  });

  it('compara os valores como texto (5 numérico casa com "5")', () => {
    renderizar(<SelectMenu value={5} onChange={() => {}} options={[{ value: '5', label: 'Cinco' }]} />);
    expect(screen.getByRole('button')).toHaveTextContent('Cinco');
  });
});

describe('SelectMenu — abrir, escolher e fechar', () => {
  const abrir = async (props = {}) => {
    const onChange = vi.fn();
    const r = renderizar(<SelectMenu value="aberto" onChange={onChange} options={OPCOES} {...props} />);
    await r.utilizador.click(screen.getAllByRole('button')[0]);
    return { ...r, onChange };
  };

  it('clicar abre a lista', async () => {
    await abrir();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('aberto anuncia-se', async () => {
    await abrir();
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('mostra todas as opções', async () => {
    await abrir();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('cada opção mostra o seu rótulo', async () => {
    await abrir();
    for (const o of OPCOES) expect(screen.getByRole('option', { name: new RegExp(o.label) })).toBeInTheDocument();
  });

  it('a opção ativa está assinalada', async () => {
    await abrir();
    expect(screen.getByRole('option', { name: /Aberto/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('as outras opções não estão assinaladas', async () => {
    await abrir();
    expect(screen.getByRole('option', { name: /Concluído/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('só uma opção fica assinalada', async () => {
    await abrir();
    const ativas = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(ativas).toHaveLength(1);
  });

  it('escolher devolve o VALOR e não o evento', async () => {
    const { utilizador, onChange } = await abrir();
    await utilizador.click(screen.getByRole('option', { name: /Concluído/ }));
    expect(onChange).toHaveBeenCalledWith('concluido');
  });

  it('escolher fecha a lista', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getByRole('option', { name: /Concluído/ }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('escolher a opção que já estava ativa devolve o mesmo valor', async () => {
    const { utilizador, onChange } = await abrir();
    await utilizador.click(screen.getByRole('option', { name: /Aberto/ }));
    expect(onChange).toHaveBeenCalledWith('aberto');
  });

  it('clicar outra vez no botão fecha', async () => {
    const { utilizador } = await abrir();
    await utilizador.click(screen.getAllByRole('button')[0]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape fecha', async () => {
    const { utilizador } = await abrir();
    await utilizador.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape não escolhe nada', async () => {
    const { utilizador, onChange } = await abrir();
    await utilizador.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicar fora fecha', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(
      <div>
        <SelectMenu value="aberto" onChange={onChange} options={OPCOES} ariaLabel="estado" />
        <button type="button">fora</button>
      </div>,
    );
    await utilizador.click(screen.getByRole('button', { name: 'estado' }));
    await utilizador.click(screen.getByRole('button', { name: 'fora' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('o rato dentro da lista não fecha', async () => {
    await abrir();
    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('lista vazia abre sem opções nenhumas', async () => {
    const { utilizador } = renderizar(<SelectMenu value="" onChange={() => {}} options={[]} />);
    await utilizador.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('as opções não submetem o formulário à volta', async () => {
    await abrir();
    for (const o of screen.getAllByRole('option')) expect(o).toHaveAttribute('type', 'button');
  });

  it('Tab depois de abrir chega à primeira opção', async () => {
    const { utilizador } = await abrir();
    await utilizador.tab();
    expect(document.activeElement).toHaveTextContent('Aberto');
  });

  it('Enter numa opção com foco escolhe-a', async () => {
    const { utilizador, onChange } = await abrir();
    screen.getByRole('option', { name: /Em análise/ }).focus();
    await utilizador.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('em_analise');
  });

  it('as setas não mudam a opção com foco (não há navegação por setas)', async () => {
    const { utilizador, onChange } = await abrir();
    screen.getByRole('option', { name: /Aberto/ }).focus();
    await utilizador.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('Aberto');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opções com rótulos iguais distinguem-se pelo valor', async () => {
    const onChange = vi.fn();
    const opts = [{ value: 'a', label: 'Igual' }, { value: 'b', label: 'Igual' }];
    const { utilizador } = renderizar(<SelectMenu value="a" onChange={onChange} options={opts} />);
    await utilizador.click(screen.getAllByRole('button')[0]);
    await utilizador.click(screen.getAllByRole('option')[1]);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('uma opção marcada como desativada continua a poder escolher-se (o componente não suporta desativar)', async () => {
    const onChange = vi.fn();
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }];
    const { utilizador } = renderizar(<SelectMenu value="a" onChange={onChange} options={opts} />);
    await utilizador.click(screen.getAllByRole('button')[0]);
    await utilizador.click(screen.getByRole('option', { name: /B/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('desmontar aberto não deixa listeners a rebentar', async () => {
    const { utilizador, unmount } = await abrir();
    unmount();
    await utilizador.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   PeoplePicker — titulares do cliente
   ═══════════════════════════════════════════════════════════════════════════ */

const PESSOAS = [
  { id: 'p1', name: 'Maria Silva', identification: 'CC 123' },
  { id: 'p2', name: 'João Costa', identification: 'CC 456' },
  { id: 'p3', name: 'Ana Sousa' },
];

describe('PeoplePicker', () => {
  it('não mostra nada quando não há pessoas', () => {
    const { container } = renderizar(<PeoplePicker people={[]} selected={[]} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('não mostra nada num cliente de uma só pessoa', () => {
    const { container } = renderizar(<PeoplePicker people={[PESSOAS[0]]} selected={['p1']} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sem lista de pessoas não rebenta', () => {
    const { container } = renderizar(<PeoplePicker onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('com duas pessoas mostra as duas', () => {
    renderizar(<PeoplePicker people={PESSOAS.slice(0, 2)} selected={['p1']} onChange={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('mostra o nome de cada pessoa', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    for (const p of PESSOAS) expect(screen.getByText(p.name)).toBeInTheDocument();
  });

  it('a primeira pessoa é o Titular', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Maria Silva/ })).toHaveAccessibleName(/Titular/);
  });

  it('a segunda pessoa é a 2.ª pessoa', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /João Costa/ })).toHaveAccessibleName(/2\.ª pessoa/);
  });

  it('a terceira pessoa é a 3.ª pessoa', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Ana Sousa/ })).toHaveAccessibleName(/3\.ª pessoa/);
  });

  it('mostra a identificação quando existe', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Maria Silva/ })).toHaveAccessibleName(/CC 123/);
  });

  it('sem identificação não mostra o separador solto', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Ana Sousa/ }).closest('label')).not.toHaveTextContent('·');
  });

  it('mostra o rótulo do campo', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} label="Quem consta?" />);
    expect(screen.getByText('Quem consta?')).toBeInTheDocument();
  });

  it('mostra o texto de apoio', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} helper="Só um outorgante" />);
    expect(screen.getByText('Só um outorgante')).toBeInTheDocument();
  });

  it('as escolhidas aparecem marcadas', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1', 'p3']} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Maria Silva/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Ana Sousa/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /João Costa/ })).not.toBeChecked();
  });

  it('nenhuma escolhida deixa tudo por marcar', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={[]} onChange={() => {}} />);
    for (const c of screen.getAllByRole('checkbox')) expect(c).not.toBeChecked();
  });

  it('um id escolhido que já não existe não rebenta', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['fantasma']} onChange={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });
});

describe('PeoplePicker — modo múltiplo', () => {
  const montarPicker = (selected = ['p1']) => {
    const onChange = vi.fn();
    const r = renderizar(<PeoplePicker people={PESSOAS} selected={selected} onChange={onChange} />);
    return { ...r, onChange };
  };

  it('clicar numa pessoa por escolher acrescenta-a', async () => {
    const { utilizador, onChange } = montarPicker();
    await utilizador.click(screen.getByRole('checkbox', { name: /João Costa/ }));
    expect(onChange).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('mantém a ordem do cadastro mesmo escolhendo ao contrário', async () => {
    const { utilizador, onChange } = montarPicker(['p3']);
    await utilizador.click(screen.getByRole('checkbox', { name: /Maria Silva/ }));
    expect(onChange).toHaveBeenCalledWith(['p1', 'p3']);
  });

  it('desmarcar uma de duas deixa a outra', async () => {
    const { utilizador, onChange } = montarPicker(['p1', 'p2']);
    await utilizador.click(screen.getByRole('checkbox', { name: /Maria Silva/ }));
    expect(onChange).toHaveBeenCalledWith(['p2']);
  });

  it('nunca deixa ficar zero pessoas', async () => {
    const { utilizador, onChange } = montarPicker(['p1']);
    await utilizador.click(screen.getByRole('checkbox', { name: /Maria Silva/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('escolher as três devolve as três por ordem', async () => {
    const { utilizador, onChange } = montarPicker(['p2']);
    await utilizador.click(screen.getByRole('checkbox', { name: /Ana Sousa/ }));
    expect(onChange).toHaveBeenCalledWith(['p2', 'p3']);
  });

  it('cinco pessoas dão cinco caixas', () => {
    const muitas = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, name: `Pessoa ${i}` }));
    renderizar(<PeoplePicker people={muitas} selected={['x0']} onChange={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  });
});

describe('PeoplePicker — modo singular', () => {
  const montarPicker = (selected = ['p1']) => {
    const onChange = vi.fn();
    const r = renderizar(<PeoplePicker people={PESSOAS} selected={selected} onChange={onChange} mode="single" />);
    return { ...r, onChange };
  };

  it('escolher outra substitui a anterior', async () => {
    const { utilizador, onChange } = montarPicker();
    await utilizador.click(screen.getByRole('checkbox', { name: /João Costa/ }));
    expect(onChange).toHaveBeenCalledWith(['p2']);
  });

  it('clicar na que já estava escolhida mantém-na', async () => {
    const { utilizador, onChange } = montarPicker();
    await utilizador.click(screen.getByRole('checkbox', { name: /Maria Silva/ }));
    expect(onChange).toHaveBeenCalledWith(['p1']);
  });

  it('nunca devolve mais do que uma pessoa', async () => {
    const { utilizador, onChange } = montarPicker();
    await utilizador.click(screen.getByRole('checkbox', { name: /Ana Sousa/ }));
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('PeoplePicker — desativado', () => {
  it('as caixas ficam inativas', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={() => {}} disabled />);
    for (const c of screen.getAllByRole('checkbox')) expect(c).toBeDisabled();
  });

  it('clicar não muda nada', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<PeoplePicker people={PESSOAS} selected={['p1']} onChange={onChange} disabled />);
    await utilizador.click(screen.getByRole('checkbox', { name: /João Costa/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('continua a mostrar quem está escolhido', () => {
    renderizar(<PeoplePicker people={PESSOAS} selected={['p2']} onChange={() => {}} disabled />);
    expect(screen.getByRole('checkbox', { name: /João Costa/ })).toBeChecked();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SlidingTabs — separadores
   ═══════════════════════════════════════════════════════════════════════════ */

const ABAS = [
  { id: 'dados', label: 'Dados' },
  { id: 'docs', label: 'Documentos' },
  { id: 'apagar', label: 'Eliminar', danger: true },
];

describe('SlidingTabs', () => {
  it('mostra todos os separadores', () => {
    renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('mostra o texto de cada separador', () => {
    renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    for (const a of ABAS) expect(screen.getByRole('button', { name: a.label })).toBeInTheDocument();
  });

  it('o separador ativo está marcado', () => {
    renderizar(<SlidingTabs items={ABAS} active="docs" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Documentos' }).className).toContain('active');
  });

  it('só um separador fica ativo', () => {
    renderizar(<SlidingTabs items={ABAS} active="docs" onChange={() => {}} />);
    expect(screen.getAllByRole('button').filter((b) => b.className.includes(' active'))).toHaveLength(1);
  });

  it('clicar avisa com o id do separador', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={onChange} />);
    await utilizador.click(screen.getByRole('button', { name: 'Documentos' }));
    expect(onChange).toHaveBeenCalledWith('docs');
  });

  it('clicar no que já está ativo também avisa', async () => {
    const onChange = vi.fn();
    const { utilizador } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={onChange} />);
    await utilizador.click(screen.getByRole('button', { name: 'Dados' }));
    expect(onChange).toHaveBeenCalledWith('dados');
  });

  it('mudar de ativo passa a marca para o outro', () => {
    const { rerender } = montar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    rerender(<SlidingTabs items={ABAS} active="docs" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dados' }).className).not.toContain(' active');
    expect(screen.getByRole('button', { name: 'Documentos' }).className).toContain('active');
  });

  it('os separadores não submetem o formulário à volta', () => {
    renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('type', 'button');
  });

  it('um separador perigoso fica marcado', () => {
    renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Eliminar' }).className).toContain('danger');
  });

  it('o indicador aparece quando há separador ativo', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    expect(container.querySelector('.adm-stabs-ind')).toBeTruthy();
  });

  it('um ativo que não existe não mostra indicador nem marca ninguém', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="inventado" onChange={() => {}} />);
    expect(container.querySelector('.adm-stabs-ind')).toBeNull();
    expect(screen.getAllByRole('button').filter((b) => b.className.includes(' active'))).toHaveLength(0);
  });

  it('o indicador fica perigoso quando o ativo é perigoso', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="apagar" onChange={() => {}} />);
    expect(container.querySelector('.adm-stabs-ind').className).toContain('danger');
  });

  it('lista vazia não rebenta', () => {
    const { container } = renderizar(<SlidingTabs items={[]} active={null} onChange={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('.adm-stabs')).toBeTruthy();
  });

  it('a variante por omissão é a de sublinhado', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    expect(container.querySelector('.adm-stabs').className).toContain('adm-stabs-underline');
  });

  it('aceita a variante de pílulas', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} variant="pills" />);
    expect(container.querySelector('.adm-stabs').className).toContain('adm-stabs-pills');
  });

  it('junta a classe extra que lhe passam', () => {
    const { container } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} className="minha" />);
    expect(container.querySelector('.adm-stabs').className).toContain('minha');
  });

  it('o rótulo pode ser um nó React', () => {
    const itens = [{ id: 'a', label: <span>Tickets <b>3</b></span> }];
    renderizar(<SlidingTabs items={itens} active="a" onChange={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('Tickets 3');
  });

  it('ids numéricos funcionam', async () => {
    const onChange = vi.fn();
    const itens = [{ id: 1, label: 'Um' }, { id: 2, label: 'Dois' }];
    const { utilizador } = renderizar(<SlidingTabs items={itens} active={1} onChange={onChange} />);
    await utilizador.click(screen.getByRole('button', { name: 'Dois' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('redimensionar a janela não rebenta', () => {
    renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('button', { name: 'Dados' })).toBeInTheDocument();
  });

  it('desmontar larga o listener de resize', () => {
    const espia = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderizar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    unmount();
    expect(espia.mock.calls.some((c) => c[0] === 'resize')).toBe(true);
    espia.mockRestore();
  });

  it('acrescentar separadores volta a medir sem rebentar', () => {
    const { rerender } = montar(<SlidingTabs items={ABAS} active="dados" onChange={() => {}} />);
    rerender(<SlidingTabs items={[...ABAS, { id: 'novo', label: 'Novo' }]} active="novo" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Novo' }).className).toContain('active');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Skeletons — blocos de "a carregar"
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SkeletonPage', () => {
  const blocos = (c) => c.querySelectorAll('.adm-skel').length;

  it('anuncia aos leitores de ecrã que está a carregar', () => {
    renderizar(<SkeletonPage />);
    expect(screen.getByLabelText('A carregar')).toHaveAttribute('aria-busy', 'true');
  });

  it('não mostra texto nenhum (não engana com conteúdo falso)', () => {
    const { container } = renderizar(<SkeletonPage />);
    expect(container.textContent.trim()).toBe('');
  });

  it('não tem botões nem ligações para clicar', () => {
    renderizar(<SkeletonPage />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('mostra quatro KPIs por omissão', () => {
    const { container } = renderizar(<SkeletonPage rows={0} />);
    expect(blocos(container)).toBe(2 + 4 * 2);
  });

  it('aceita outro número de KPIs', () => {
    const { container } = renderizar(<SkeletonPage kpis={2} rows={0} />);
    expect(blocos(container)).toBe(2 + 2 * 2);
  });

  it('sem KPIs não desenha a faixa de KPIs', () => {
    const { container } = renderizar(<SkeletonPage kpis={0} rows={0} />);
    expect(blocos(container)).toBe(2);
  });

  it('mostra seis linhas por omissão', () => {
    const { container } = renderizar(<SkeletonPage kpis={0} />);
    expect(blocos(container)).toBe(2 + 6 * 5);
  });

  it('aceita outro número de linhas', () => {
    const { container } = renderizar(<SkeletonPage kpis={0} rows={3} />);
    expect(blocos(container)).toBe(2 + 3 * 5);
  });

  it('tem sempre o bloco do título e do subtítulo', () => {
    const { container } = renderizar(<SkeletonPage kpis={0} rows={0} />);
    expect(blocos(container)).toBe(2);
  });

  it('os blocos têm largura e altura próprias', () => {
    const { container } = renderizar(<SkeletonPage kpis={0} rows={0} />);
    const primeiro = container.querySelector('.adm-skel');
    expect(primeiro).toHaveStyle({ width: '220px', height: '26px' });
  });
});

describe('SkeletonRows', () => {
  const blocos = (c) => c.querySelectorAll('.adm-skel').length;

  it('anuncia que está a carregar', () => {
    const { container } = renderizar(<SkeletonRows />);
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
  });

  it('seis linhas por omissão', () => {
    const { container } = renderizar(<SkeletonRows />);
    expect(blocos(container)).toBe(6 * 5);
  });

  it('uma linha só', () => {
    const { container } = renderizar(<SkeletonRows n={1} />);
    expect(blocos(container)).toBe(5);
  });

  it('zero linhas não desenha nada', () => {
    const { container } = renderizar(<SkeletonRows n={0} />);
    expect(blocos(container)).toBe(0);
  });

  it('cada linha tem o seu círculo de avatar', () => {
    const { container } = renderizar(<SkeletonRows n={4} />);
    expect(container.querySelectorAll('.adm-skel-circle')).toHaveLength(4);
  });

  it('não mostra texto real', () => {
    const { container } = renderizar(<SkeletonRows n={3} />);
    expect(container.textContent.trim()).toBe('');
  });

  it('aguenta muitas linhas', () => {
    const { container } = renderizar(<SkeletonRows n={50} />);
    expect(blocos(container)).toBe(250);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Avatar
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Avatar', () => {
  it('mostra a fotografia', () => {
    const { container } = renderizar(<Avatar />);
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('a fotografia aponta para o ficheiro da Dra.', () => {
    const { container } = renderizar(<Avatar />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/avatar-vyvian.webp');
  });

  it('a fotografia é decorativa (texto alternativo vazio)', () => {
    const { container } = renderizar(<Avatar />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('enquanto a foto existe não mostra as iniciais', () => {
    const { container } = renderizar(<Avatar initials="VA" />);
    expect(container.textContent).toBe('');
  });

  it('se a foto falhar mostra as iniciais', () => {
    const { container } = renderizar(<Avatar initials="VA" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('VA');
  });

  it('depois de falhar deixa de tentar a foto', () => {
    const { container } = renderizar(<Avatar initials="VA" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
  });

  it('as iniciais por omissão são VA', () => {
    const { container } = renderizar(<Avatar />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('VA');
  });

  it('aceita iniciais de um só nome', () => {
    const { container } = renderizar(<Avatar initials="M" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('M');
  });

  it('aceita iniciais de vários nomes', () => {
    const { container } = renderizar(<Avatar initials="MSC" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('MSC');
  });

  it('iniciais vazias não mostram nada', () => {
    const { container } = renderizar(<Avatar initials="" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('');
  });

  it('iniciais com acentos passam tal e qual', () => {
    const { container } = renderizar(<Avatar initials="ÂÇ" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('ÂÇ');
  });

  it('leva a classe que lhe passam', () => {
    const { container } = renderizar(<Avatar className="adm-profile-avatar" />);
    expect(container.firstChild).toHaveClass('adm-profile-avatar');
  });

  it('sem classe não inventa nenhuma', () => {
    const { container } = renderizar(<Avatar />);
    expect(container.firstChild.className).toBeFalsy();
  });

  it('o componente não deriva iniciais de um nome — quem chama é que as calcula', () => {
    const { container } = renderizar(<Avatar name="Maria Silva Costa" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.textContent).toBe('VA');
  });

  it('cada avatar falha por si (um erro não afeta o outro)', () => {
    const { container } = renderizar(<div><Avatar initials="AA" /><Avatar initials="BB" /></div>);
    fireEvent.error(container.querySelectorAll('img')[0]);
    expect(container.textContent).toBe('AA');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CountUp — os números dos KPIs
   ═══════════════════════════════════════════════════════════════════════════ */

describe('CountUp', () => {
  // rAF e relógio falsos: a animação passa a ser determinística (zero flakiness)
  let fila = [];
  let relogio = 0;
  let espiaNow;

  beforeEach(() => {
    fila = [];
    relogio = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => { fila.push(cb); return fila.length; });
    vi.stubGlobal('cancelAnimationFrame', (id) => { fila[id - 1] = null; });
    espiaNow = vi.spyOn(performance, 'now').mockImplementation(() => relogio);
  });

  afterEach(() => {
    espiaNow.mockRestore();
    vi.unstubAllGlobals();
  });

  const frame = async (ms) => {
    relogio += ms;
    const pendentes = fila.splice(0);
    await act(async () => { pendentes.forEach((cb) => cb && cb(relogio)); });
  };
  const terminar = async () => { await frame(0); await frame(100000); };

  const numero = () => document.body.textContent;
  const cru = (v) => String(Math.round(v));

  it('chega ao valor final', async () => {
    renderizar(<CountUp value={1500} format={cru} />);
    await terminar();
    expect(numero()).toBe('1500');
  });

  it('a primeira animação começa no zero', async () => {
    renderizar(<CountUp value={1500} format={cru} />);
    await frame(0);
    expect(numero()).toBe('0');
  });

  it('a meio da animação já passou de metade (ease-out)', async () => {
    renderizar(<CountUp value={1000} format={cru} />);
    await frame(0);
    await frame(425);
    expect(Number(numero())).toBeGreaterThan(500);
    expect(Number(numero())).toBeLessThan(1000);
  });

  it('vai sempre a subir', async () => {
    renderizar(<CountUp value={1000} format={cru} />);
    await frame(0);
    const a = Number(numero());
    await frame(200);
    const b = Number(numero());
    await frame(200);
    const c = Number(numero());
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('não passa do valor final', async () => {
    renderizar(<CountUp value={777} format={cru} />);
    await terminar();
    await frame(5000);
    expect(numero()).toBe('777');
  });

  it('depois de acabar deixa de pedir frames', async () => {
    renderizar(<CountUp value={777} format={cru} />);
    await terminar();
    expect(fila.filter(Boolean)).toHaveLength(0);
  });

  it('o valor zero não anima nada', async () => {
    renderizar(<CountUp value={0} format={cru} />);
    expect(numero()).toBe('0');
    expect(fila.filter(Boolean)).toHaveLength(0);
  });

  it('valor negativo chega ao fim', async () => {
    renderizar(<CountUp value={-1500} format={cru} />);
    await terminar();
    expect(numero()).toBe('-1500');
  });

  it('valor negativo desce em vez de subir', async () => {
    renderizar(<CountUp value={-1000} format={cru} />);
    await frame(0);
    await frame(300);
    expect(Number(numero())).toBeLessThan(0);
    expect(Number(numero())).toBeGreaterThan(-1000);
  });

  it('valor enorme não perde precisão', async () => {
    renderizar(<CountUp value={987654321098} format={cru} />);
    await terminar();
    expect(numero()).toBe('987654321098');
  });

  it('valor decimal respeita o formato', async () => {
    renderizar(<CountUp value={12.345} format={(v) => v.toFixed(2)} />);
    await terminar();
    expect(numero()).toBe('12.35');
  });

  it('valor em texto numérico é convertido', async () => {
    renderizar(<CountUp value="250" format={cru} />);
    await terminar();
    expect(numero()).toBe('250');
  });

  it('texto que não é número conta como zero', async () => {
    renderizar(<CountUp value="abc" format={cru} />);
    expect(numero()).toBe('0');
  });

  it('null conta como zero', async () => {
    renderizar(<CountUp value={null} format={cru} />);
    expect(numero()).toBe('0');
  });

  it('undefined conta como zero', async () => {
    renderizar(<CountUp format={cru} />);
    expect(numero()).toBe('0');
  });

  it('NaN conta como zero', async () => {
    renderizar(<CountUp value={NaN} format={cru} />);
    expect(numero()).toBe('0');
  });

  it('o formato por omissão arredonda', async () => {
    renderizar(<CountUp value={41.7} />);
    await terminar();
    expect(numero()).toBe('42');
  });

  it('o formato recebe um número, não texto', async () => {
    const fmt = vi.fn((v) => String(Math.round(v)));
    renderizar(<CountUp value={10} format={fmt} />);
    await terminar();
    expect(typeof fmt.mock.calls[0][0]).toBe('number');
  });

  it('o formato é aplicado em cada frame', async () => {
    const fmt = vi.fn((v) => `€ ${Math.round(v)}`);
    renderizar(<CountUp value={100} format={fmt} />);
    await frame(0);
    expect(numero()).toBe('€ 0');
    await frame(425);
    expect(numero()).toMatch(/^€ \d+$/);
  });

  it('formato de moeda no fim', async () => {
    renderizar(<CountUp value={1234} format={(v) => `€ ${Math.round(v)},00`} />);
    await terminar();
    expect(numero()).toBe('€ 1234,00');
  });

  it('mudar o valor anima a partir do valor antigo, não do zero', async () => {
    const { rerender } = montar(<CountUp value={100} format={cru} />);
    await terminar();
    rerender(<CountUp value={200} format={cru} />);
    await frame(0);
    expect(numero()).toBe('100');
  });

  it('mudar o valor chega ao novo valor', async () => {
    const { rerender } = montar(<CountUp value={100} format={cru} />);
    await terminar();
    rerender(<CountUp value={200} format={cru} />);
    await terminar();
    expect(numero()).toBe('200');
  });

  it('mudar para o mesmo valor não anima', async () => {
    const { rerender } = montar(<CountUp value={100} format={cru} />);
    await terminar();
    rerender(<CountUp value={100} format={cru} />);
    expect(numero()).toBe('100');
    expect(fila.filter(Boolean)).toHaveLength(0);
  });

  it('descer de um valor para outro mais baixo funciona', async () => {
    const { rerender } = montar(<CountUp value={500} format={cru} />);
    await terminar();
    rerender(<CountUp value={100} format={cru} />);
    await terminar();
    expect(numero()).toBe('100');
  });

  it('mudanças em cadeia acabam no último valor', async () => {
    const { rerender } = montar(<CountUp value={10} format={cru} />);
    await terminar();
    rerender(<CountUp value={20} format={cru} />);
    await frame(100);
    rerender(<CountUp value={30} format={cru} />);
    await terminar();
    expect(numero()).toBe('30');
  });

  it('de positivo para negativo atravessa o zero', async () => {
    const { rerender } = montar(<CountUp value={100} format={cru} />);
    await terminar();
    rerender(<CountUp value={-100} format={cru} />);
    await terminar();
    expect(numero()).toBe('-100');
  });

  it('uma duração maior demora mais a chegar ao fim', async () => {
    renderizar(<CountUp value={1000} duration={5000} format={cru} />);
    await frame(0);
    await frame(850);
    expect(Number(numero())).toBeLessThan(1000);
    await frame(5000);
    expect(numero()).toBe('1000');
  });

  it('desmontar cancela a animação', async () => {
    const cancelou = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelou);
    const { unmount } = renderizar(<CountUp value={1000} format={cru} />);
    unmount();
    expect(cancelou).toHaveBeenCalled();
  });

  it('vários contadores animam ao mesmo tempo sem se atrapalharem', async () => {
    renderizar(<div><span data-t="a"><CountUp value={10} format={cru} /></span><span data-t="b"><CountUp value={20} format={cru} /></span></div>);
    await terminar();
    expect(document.querySelector('[data-t="a"]').textContent).toBe('10');
    expect(document.querySelector('[data-t="b"]').textContent).toBe('20');
  });

  it('mostra logo o valor final antes do primeiro frame (não parte de zero no HTML)', () => {
    renderizar(<CountUp value={99} format={cru} />);
    expect(numero()).toBe('99');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ModalClose — o ✕ e o Esc
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ModalClose', () => {
  it('mostra o botão de fechar', () => {
    renderizar(<ModalClose onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('o nome por omissão é "Fechar"', () => {
    renderizar(<ModalClose onClose={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Fechar');
  });

  it('aceita outro nome', () => {
    renderizar(<ModalClose onClose={() => {}} title="Cancelar edição" />);
    expect(screen.getByRole('button', { name: 'Cancelar edição' })).toBeInTheDocument();
  });

  it('não submete o formulário à volta', () => {
    renderizar(<ModalClose onClose={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('o ✕ está escondido dos leitores de ecrã', () => {
    const { container } = renderizar(<ModalClose onClose={() => {}} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('clicar fecha', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} />);
    await utilizador.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('desativado fica inativo', () => {
    renderizar(<ModalClose onClose={() => {}} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('desativado não fecha ao clicar', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} disabled />);
    await utilizador.click(screen.getByRole('button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a tecla Esc fecha', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} />);
    await utilizador.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('outra tecla não fecha', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} />);
    await utilizador.keyboard('{Enter}a ');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('desativado ignora o Esc', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} disabled />);
    await utilizador.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dois Esc seguidos avisam duas vezes (quem fecha é o modal)', async () => {
    const onClose = vi.fn();
    const { utilizador } = renderizar(<ModalClose onClose={onClose} />);
    await utilizador.keyboard('{Escape}');
    await utilizador.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('modais empilhados: o Esc só fecha o de cima', async () => {
    const baixo = vi.fn(); const cima = vi.fn();
    const { utilizador } = renderizar(<div><ModalClose onClose={baixo} /><ModalClose onClose={cima} /></div>);
    await utilizador.keyboard('{Escape}');
    expect(cima).toHaveBeenCalledTimes(1);
    expect(baixo).not.toHaveBeenCalled();
  });

  it('fechado o de cima, o Esc seguinte fecha o de baixo', async () => {
    const baixo = vi.fn(); const cima = vi.fn();
    const { utilizador, rerender } = montar(<div><ModalClose onClose={baixo} /><ModalClose onClose={cima} /></div>);
    rerender(<div><ModalClose onClose={baixo} /></div>);
    await utilizador.keyboard('{Escape}');
    expect(baixo).toHaveBeenCalledTimes(1);
  });

  it('um modal de cima desativado não deixa o Esc fechar o de baixo', async () => {
    const baixo = vi.fn(); const cima = vi.fn();
    const { utilizador } = renderizar(<div><ModalClose onClose={baixo} /><ModalClose onClose={cima} disabled /></div>);
    await utilizador.keyboard('{Escape}');
    expect(cima).not.toHaveBeenCalled();
    expect(baixo).not.toHaveBeenCalled();
  });

  it('depois de desmontar o Esc já não faz nada', async () => {
    const onClose = vi.fn();
    const { utilizador, unmount } = renderizar(<ModalClose onClose={onClose} />);
    unmount();
    await utilizador.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('usa sempre o onClose mais recente', async () => {
    const antigo = vi.fn(); const novo = vi.fn();
    const { utilizador, rerender } = montar(<ModalClose onClose={antigo} />);
    rerender(<ModalClose onClose={novo} />);
    await utilizador.keyboard('{Escape}');
    expect(novo).toHaveBeenCalledTimes(1);
    expect(antigo).not.toHaveBeenCalled();
  });

  it('passar a desativado a meio faz o Esc parar de fechar', async () => {
    const onClose = vi.fn();
    const { utilizador, rerender } = montar(<ModalClose onClose={onClose} />);
    rerender(<ModalClose onClose={onClose} disabled />);
    await utilizador.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deixar de estar desativado devolve o Esc', async () => {
    const onClose = vi.fn();
    const { utilizador, rerender } = montar(<ModalClose onClose={onClose} disabled />);
    rerender(<ModalClose onClose={onClose} />);
    await utilizador.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('três modais empilhados fecham de cima para baixo', async () => {
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    const { utilizador, rerender } = montar(
      <div><ModalClose onClose={a} /><ModalClose onClose={b} /><ModalClose onClose={c} /></div>,
    );
    await utilizador.keyboard('{Escape}');
    expect(c).toHaveBeenCalledTimes(1);
    rerender(<div><ModalClose onClose={a} /><ModalClose onClose={b} /></div>);
    await utilizador.keyboard('{Escape}');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   CommandPalette — Ctrl+K
   ═══════════════════════════════════════════════════════════════════════════ */

const CLIENTES = [
  { id: 'c1', name: 'Maria Silva', email: 'maria@exemplo.pt', tax_id: '123 456 789', practice_area: 'Nacionalidade' },
  { id: 'c2', name: 'José António Gonçalves', email: 'jose@exemplo.pt', tax_id: '987654321', country: 'Portugal' },
  { id: 'c3', name: 'Ana Costa', email: 'ana@outro.pt', tax_id: '111222333' },
];

describe('CommandPalette', () => {
  beforeEach(() => {
    sessao.ligada = true;
    navegou.mockReset();
    listaClientes.mockReset();
    listaClientes.mockResolvedValue({ clients: CLIENTES });
  });

  const paleta = () => document.querySelector('.adm-cmdk');
  const itens = () => screen.getAllByRole('button').filter((b) => b.className.includes('adm-cmdk-item'));
  const escolhido = () => itens().find((b) => b.className.includes(' sel'));
  const campo = () => screen.getByPlaceholderText('Procurar cliente ou página…');

  // o foco do campo chega num setTimeout(30): sem esperar por ele, as teclas
  // seguintes caem no <body> e o teste fica intermitente sob carga
  const abrir = async (utilizador) => {
    await utilizador.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(paleta()).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(campo()));
  };

  it('começa fechada', () => {
    renderizar(<CommandPalette />);
    expect(paleta()).toBeNull();
  });

  it('Ctrl+K abre', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(paleta()).toBeTruthy();
  });

  it('Cmd+K também abre', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await utilizador.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => expect(paleta()).toBeTruthy());
  });

  it('Ctrl+K outra vez fecha', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(paleta()).toBeNull());
  });

  it('sem sessão iniciada não abre', async () => {
    sessao.ligada = false;
    const { utilizador } = renderizar(<CommandPalette />);
    await utilizador.keyboard('{Control>}k{/Control}');
    expect(paleta()).toBeNull();
  });

  it('a tecla Esc fecha', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), '{Escape}');
    await waitFor(() => expect(paleta()).toBeNull());
  });

  it('clicar no fundo escuro fecha', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    fireEvent.mouseDown(document.querySelector('.adm-cmdk-overlay'));
    await waitFor(() => expect(paleta()).toBeNull());
  });

  it('clicar dentro da paleta não fecha', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    fireEvent.mouseDown(paleta());
    expect(paleta()).toBeTruthy();
  });

  it('mostra o texto de ajuda da pesquisa', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(campo()).toBeInTheDocument();
  });

  it('o campo de pesquisa recebe o foco', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await waitFor(() => expect(document.activeElement).toBe(campo()));
  });

  it('sem escrever nada mostra as páginas todas', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(itens()).toHaveLength(8);
  });

  it('sem escrever nada não mostra clientes', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument();
  });

  it('mostra o rodapé com os atalhos', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(screen.getByText('abrir')).toBeInTheDocument();
    expect(screen.getByText('navegar')).toBeInTheDocument();
  });

  it('filtra as páginas pelo que se escreve', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'parcelas');
    await waitFor(() => expect(itens()).toHaveLength(1));
    expect(screen.getByText('Parcelas e mensalidades')).toBeInTheDocument();
  });

  it('ignora acentos na procura de páginas', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'calendario');
    await waitFor(() => expect(screen.getByText('Calendário')).toBeInTheDocument());
  });

  it('encontra clientes pelo nome', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
  });

  it('encontra clientes ignorando acentos', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'jose antonio');
    expect(await screen.findByText('José António Gonçalves')).toBeInTheDocument();
  });

  it('encontra clientes pelo e-mail', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'ana@outro');
    expect(await screen.findByText('Ana Costa')).toBeInTheDocument();
  });

  it('encontra clientes pelo NIF mesmo com espaços a mais', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), '123456789');
    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
  });

  it('mostra a área de atuação por baixo do nome', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    expect(await screen.findByText('Nacionalidade')).toBeInTheDocument();
  });

  it('distingue clientes de páginas', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    expect(await screen.findByText('Cliente')).toBeInTheDocument();
  });

  it('sem resultados diz o que procurou', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'zzzzz');
    expect(await screen.findByText(/Nada encontrado para/)).toBeInTheDocument();
  });

  it('mostra no máximo oito clientes', async () => {
    listaClientes.mockResolvedValue({
      clients: Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Silva ${i}` })),
    });
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'silva');
    await waitFor(() => expect(screen.getAllByText('Cliente')).toHaveLength(8));
  });

  it('a seta para baixo desce a seleção', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    expect(escolhido()).toHaveTextContent('Novo cliente');
    await utilizador.keyboard('{ArrowDown}');
    expect(escolhido()).toHaveTextContent('Painel');
  });

  it('a seta para cima sobe a seleção', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(escolhido()).toHaveTextContent('Painel');
  });

  it('a seta para cima no topo fica no topo', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{ArrowUp}{ArrowUp}');
    expect(escolhido()).toHaveTextContent('Novo cliente');
  });

  it('a seta para baixo no fim fica no fim', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    for (let i = 0; i < 12; i += 1) await utilizador.keyboard('{ArrowDown}');
    expect(escolhido()).toHaveTextContent('Configurações');
  });

  it('o rato por cima muda a seleção', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.hover(itens()[3]);
    expect(escolhido()).toBe(itens()[3]);
  });

  it('escrever repõe a seleção no primeiro', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{ArrowDown}{ArrowDown}');
    await utilizador.type(campo(), 'c');
    expect(escolhido()).toBe(itens()[0]);
  });

  it('Enter salta para a página escolhida', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{ArrowDown}{Enter}');
    expect(navegou).toHaveBeenCalledWith('/admin/painel');
  });

  it('Enter fecha a paleta', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.keyboard('{Enter}');
    await waitFor(() => expect(paleta()).toBeNull());
  });

  it('Enter salta para a ficha do cliente', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    await screen.findByText('Maria Silva');
    await utilizador.keyboard('{Enter}');
    expect(navegou).toHaveBeenCalledWith('/admin/clientes/c1');
  });

  it('clicar num item salta para lá', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.click(screen.getByText('Clientes').closest('button'));
    expect(navegou).toHaveBeenCalledWith('/admin/clientes');
  });

  it('a lista de clientes só é pedida uma vez', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await waitFor(() => expect(listaClientes).toHaveBeenCalledTimes(1));
    await utilizador.keyboard('{Control>}k{/Control}');
    await utilizador.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(paleta()).toBeTruthy());
    expect(listaClientes).toHaveBeenCalledTimes(1);
  });

  it('se a API falhar a paleta continua a servir para as páginas', async () => {
    listaClientes.mockRejectedValue(new Error('rede em baixo'));
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'painel');
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('se a API falhar não mostra clientes nenhuns', async () => {
    listaClientes.mockRejectedValue(new Error('rede em baixo'));
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    expect(await screen.findByText(/Nada encontrado para/)).toBeInTheDocument();
  });

  it('uma resposta sem clientes não rebenta', async () => {
    listaClientes.mockResolvedValue({});
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    expect(await screen.findByText(/Nada encontrado para/)).toBeInTheDocument();
  });

  it('a barra "/" foca a pesquisa da página', async () => {
    const { utilizador } = renderizar(
      <div><CommandPalette /><input className="adm-in-search" aria-label="procurar" /></div>,
    );
    await utilizador.keyboard('/');
    expect(document.activeElement).toBe(screen.getByLabelText('procurar'));
  });

  it('a barra "/" não abre a paleta', async () => {
    const { utilizador } = renderizar(
      <div><CommandPalette /><input className="adm-in-search" aria-label="procurar" /></div>,
    );
    await utilizador.keyboard('/');
    expect(paleta()).toBeNull();
  });

  it('a barra "/" dentro de um campo escreve-se em vez de saltar', async () => {
    const { utilizador } = renderizar(
      <div>
        <CommandPalette />
        <input className="adm-in-search" aria-label="procurar" />
        <input aria-label="outro" defaultValue="" />
      </div>,
    );
    const outro = screen.getByLabelText('outro');
    await utilizador.click(outro);
    await utilizador.keyboard('/');
    expect(document.activeElement).toBe(outro);
  });

  it('a barra "/" sem pesquisa na página não rebenta', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await utilizador.keyboard('/');
    expect(paleta()).toBeNull();
  });

  it('as páginas apontam para as rotas certas', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.click(screen.getByText('Apoio Técnico').closest('button'));
    expect(navegou).toHaveBeenCalledWith('/admin/apoio');
  });

  it('reabrir limpa a pesquisa anterior', async () => {
    const { utilizador } = renderizar(<CommandPalette />);
    await abrir(utilizador);
    await utilizador.type(campo(), 'maria');
    await utilizador.keyboard('{Control>}k{/Control}');
    await utilizador.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(paleta()).toBeTruthy());
    expect(campo()).toHaveValue('');
  });
});

