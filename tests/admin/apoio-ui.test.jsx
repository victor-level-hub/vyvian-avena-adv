// @vitest-environment jsdom
// tests/admin/apoio-ui.test.jsx
// Ecrã de Apoio Técnico (src/admin/pages/Apoio.jsx) — o sítio onde a Dra. reporta
// erros e pede alterações. Aqui testa-se o que ela VÊ e CLICA: a lista, os filtros,
// o modal do ticket, as regras de quando cada botão aparece, os anexos e as
// mensagens de erro. A API vive mockada (a rede está fechada em tests/setup.js).
//
// Os diálogos (admAlert/admConfirm) e os toasts são montados a sério ao lado da
// página: assim uma mensagem de erro só passa no teste se aparecer mesmo no ecrã.
//
// Defeitos reais do componente ficam marcados com `it.fails` + comentário BUG.
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderizar, screen, within, waitFor, fireEvent } from '../helpers/dom.jsx';

vi.mock('../../src/admin/apiClient.js', () => ({
  apoio: {
    list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), abrir: vi.fn(),
    analisar: vi.fn(), executar: vi.fn(), aprovar: vi.fn(),
    uploadAnexo: vi.fn(), deleteAnexo: vi.fn(), setTranscricao: vi.fn(),
    anexoObjectUrl: vi.fn(), transcrever: vi.fn(),
  },
}));

import { apoio } from '../../src/admin/apiClient.js';
import Apoio from '../../src/admin/pages/Apoio.jsx';
import { DialogHost } from '../../src/admin/dialogs.jsx';
import { ToastHost } from '../../src/admin/toasts.jsx';

/* ───────────────────────── ambiente que o jsdom não tem ───────────────────── */

class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ isIntersecting: true }]); }   // revela já (Reveal/RsShell)
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  URL.createObjectURL = () => 'blob:falso';
  URL.revokeObjectURL = () => {};
});

/* ───────────────────────────────── fixtures ───────────────────────────────── */

const ticket = (over = {}) => ({
  id: 'AT-2026-001',
  titulo: 'Erro ao gerar o PDF do plano de pagamento',
  descricao: 'Ao clicar em imprimir o ficheiro sai em branco.',
  criado_por: 'Victor',
  status: 'aberto',
  urgencia: 'media',
  complexidade: null,
  complexidade_justificacao: null,
  plano_ia: '',
  impedimentos: '',
  resolucao: '',
  data_abertura: '2026-08-01',
  hora_abertura: '10:30',
  data_prazo: null,
  n_anexos: 0,
  created_at: '2026-08-01 10:30:00',
  updated_at: '2026-08-01 10:30:00',
  ...over,
});

const anexo = (over = {}) => ({
  id: 1, ticket_id: 'AT-2026-001', tipo: 'anexo', nome: 'ficheiro.pdf',
  content_type: 'application/pdf', size: 1024, transcricao: null,
  created_at: '2026-08-01 10:31:00', ...over,
});

const evento = (over = {}) => ({
  evento: 'criado', detalhe: '', autor: 'Victor', created_at: '2026-08-01 10:30:00', ...over,
});

function adiar() {
  let resolver, rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

/* ────────────────────────────── montagem/atalhos ──────────────────────────── */

const montar = () => renderizar(<><Apoio /><DialogHost /><ToastHost /></>);

async function montarCom(tickets) {
  apoio.list.mockResolvedValue({ tickets });
  const r = montar();
  await screen.findByRole('button', { name: 'Novo ticket' });
  return r;
}

const dlg = () => screen.getByRole('dialog');
// o rodapé é o bloco do «Cancelar» — único no modal e com nome estável (o
// «Salvar» passa a «A guardar…» enquanto grava)
const rodape = () => within(dlg()).getByRole('button', { name: 'Cancelar' }).parentElement;
// as etiquetas do cabeçalho são <span> (a barra de status usa <button> com o
// mesmo texto — o seletor evita a ambiguidade)
const etiqueta = (texto) => within(dlg()).getByText(texto, { selector: 'span' });

async function modalPronto() {
  await screen.findByRole('heading', { name: /ticket de apoio$/i });
  return dlg();
}

const linhaDe = (id) => screen.getByRole('row', { name: new RegExp(id) });

async function editar(u, id = 'AT-2026-001') {
  await u.click(within(linhaDe(id)).getAllByRole('button')[1]);
  return modalPronto();
}

async function abrirLeitura(u, id = 'AT-2026-001') {
  await u.click(within(linhaDe(id)).getByRole('button', { name: 'Abrir' }));
  return modalPronto();
}

// abre o modal em edição já com um ticket num dado estado
async function comTicket(campos = {}) {
  const t = ticket(campos);
  apoio.list.mockResolvedValue({ tickets: [t] });
  apoio.get.mockResolvedValue({ ticket: t, anexos: campos._anexos || [], log: campos._log || [] });
  const { utilizador } = montar();
  await screen.findByRole('button', { name: 'Novo ticket' });
  await editar(utilizador, t.id);
  return { utilizador, t };
}

async function novoTicket() {
  apoio.list.mockResolvedValue({ tickets: [] });
  const { utilizador } = montar();
  await utilizador.click(await screen.findByRole('button', { name: 'Novo ticket' }));
  await screen.findByRole('heading', { name: 'Novo ticket de apoio' });
  return { utilizador };
}

const campo = {
  titulo: () => screen.getByPlaceholderText(/Ex.: Erro ao gerar o PDF/),
  descricao: () => screen.getByPlaceholderText(/Descreva o erro/),
  plano: () => screen.getByPlaceholderText(/Preenchido pela análise da IA/),
  impedimentos: () => screen.getByPlaceholderText(/Preenchido por quem não conseguir avançar/),
  resolucao: () => screen.getByPlaceholderText(/Explicação da resolução/),
  pesquisa: () => screen.getByPlaceholderText(/Pesquisar por ID/),
};

// zona de colar (PasteZone): o <div tabIndex=0> é o irmão seguinte da etiqueta
const zona = (rotulo) => screen.getByText(rotulo).nextElementSibling;
const inputFicheiro = (rotulo) => screen.getByText(rotulo).parentElement.querySelector('input[type="file"]');
const ROT_PEDIDO = 'Prints e ficheiros do pedido (Ctrl+V para colar)';
const ROT_CONCLUSAO = 'Prints de evidência da conclusão (Ctrl+V)';

const colar = (elemento, ficheiros) => fireEvent.paste(elemento, {
  clipboardData: { items: ficheiros.map((f) => ({ kind: 'file', getAsFile: () => f })) },
});

const png = (nome = 'print.png') => new File([new Uint8Array([1, 2, 3])], nome, { type: 'image/png' });

const confirmarDialogo = (u) => screen.findByRole('button', { name: 'OK' }).then((b) => u.click(b));
// o «Cancelar» do diálogo de confirmação (o do rodapé do modal tem o mesmo nome)
async function recusarDialogo(u) {
  const bs = await screen.findAllByRole('button', { name: 'Cancelar' });
  await u.click(bs.find((b) => b.className.includes('adm-btn')));
}

/* ─────────────────────────────── ciclo de vida ────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  apoio.list.mockResolvedValue({ tickets: [] });
  apoio.get.mockResolvedValue({ ticket: ticket(), anexos: [], log: [] });
  apoio.create.mockResolvedValue({ ticket: ticket({ id: 'AT-2026-009' }) });
  apoio.update.mockResolvedValue({ ticket: ticket() });
  apoio.abrir.mockResolvedValue({ ticket: ticket() });
  apoio.analisar.mockResolvedValue({ ticket: ticket({ complexidade: 'media', plano_ia: 'Passo 1…' }) });
  apoio.executar.mockResolvedValue({ ticket: ticket({ status: 'em_execucao' }) });
  apoio.aprovar.mockResolvedValue({ ticket: ticket({ status: 'em_aprovacao' }) });
  apoio.uploadAnexo.mockResolvedValue({ anexo: { id: 77 } });
  apoio.deleteAnexo.mockResolvedValue({ ok: true });
  apoio.setTranscricao.mockResolvedValue({ ok: true });
  apoio.anexoObjectUrl.mockResolvedValue('blob:anexo');
  apoio.transcrever.mockResolvedValue({ text: 'texto ditado' });
});

afterEach(() => { vi.useRealTimers(); });

/* ═══════════════════════════════ 1. A LISTA ═══════════════════════════════ */

describe('lista de tickets — carregamento', () => {
  it('mostra o esqueleto enquanto a lista não chega', () => {
    const { promessa } = adiar();
    apoio.list.mockReturnValue(promessa);
    montar();
    expect(screen.getByLabelText('A carregar')).toBeInTheDocument();
  });

  it('pede a lista à API assim que entra no ecrã', async () => {
    await montarCom([]);
    expect(apoio.list).toHaveBeenCalledTimes(1);
  });

  it('pede a lista inteira sem filtros — a filtragem é toda no cliente', async () => {
    await montarCom([ticket()]);
    expect(apoio.list).toHaveBeenCalledWith();
  });

  it('troca o esqueleto pelo ecrã quando a lista chega', async () => {
    await montarCom([]);
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('mostra o título do ecrã', async () => {
    await montarCom([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Apoio Técnico' })).toBeInTheDocument();
  });

  it('lista vazia convida a criar o primeiro ticket', async () => {
    await montarCom([]);
    expect(screen.getByText(/Ainda não há tickets/)).toBeInTheDocument();
  });

  it('lista vazia não desenha tabela nenhuma', async () => {
    await montarCom([]);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lista vazia conta zero tickets no subtítulo', async () => {
    await montarCom([]);
    expect(screen.getByText(/^0 tickets · 0 em curso/)).toBeInTheDocument();
  });
});

describe('lista de tickets — conteúdo', () => {
  it('mostra o ID do ticket', async () => {
    await montarCom([ticket()]);
    expect(screen.getByText('AT-2026-001')).toBeInTheDocument();
  });

  it('mostra o título do ticket', async () => {
    await montarCom([ticket()]);
    expect(screen.getByText('Erro ao gerar o PDF do plano de pagamento')).toBeInTheDocument();
  });

  it('mostra quem criou o ticket', async () => {
    await montarCom([ticket({ criado_por: 'Dra. Vyvian' })]);
    expect(screen.getByText('Dra. Vyvian')).toBeInTheDocument();
  });

  it('mostra o estado por extenso', async () => {
    await montarCom([ticket({ status: 'em_execucao' })]);
    expect(within(linhaDe('AT-2026-001')).getByText('Em execução')).toBeInTheDocument();
  });

  it('mostra a urgência por extenso', async () => {
    await montarCom([ticket({ urgencia: 'critica' })]);
    expect(within(linhaDe('AT-2026-001')).getByText('Crítica')).toBeInTheDocument();
  });

  it('urgência desconhecida cai em «Média» em vez de rebentar', async () => {
    await montarCom([ticket({ urgencia: 'urgentissima' })]);
    expect(within(linhaDe('AT-2026-001')).getByText('Média')).toBeInTheDocument();
  });

  it('estado desconhecido cai em «Aberto» em vez de rebentar', async () => {
    await montarCom([ticket({ status: 'inventado' })]);
    expect(within(linhaDe('AT-2026-001')).getByText('Aberto')).toBeInTheDocument();
  });

  it('mostra a complexidade quando a IA já analisou', async () => {
    await montarCom([ticket({ complexidade: 'alta' })]);
    expect(within(linhaDe('AT-2026-001')).getByText('Alta')).toBeInTheDocument();
  });

  it('sem complexidade mostra um travessão', async () => {
    await montarCom([ticket()]);
    expect(within(linhaDe('AT-2026-001')).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('mostra a data e a hora de abertura em português', async () => {
    await montarCom([ticket()]);
    expect(screen.getByText('01/08/2026 10:30')).toBeInTheDocument();
  });

  it('rascunho sem abertura mostra travessão na coluna Abertura', async () => {
    await montarCom([ticket({ status: 'rascunho', data_abertura: null, hora_abertura: null })]);
    expect(within(linhaDe('AT-2026-001')).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('mostra o prazo em DD/MM/AAAA', async () => {
    await montarCom([ticket({ data_prazo: '2026-08-20' })]);
    expect(screen.getByText('20/08/2026')).toBeInTheDocument();
  });

  it('conta os anexos de cada ticket', async () => {
    await montarCom([ticket({ n_anexos: 3 })]);
    expect(screen.getByText('Victor · 3 anexos')).toBeInTheDocument();
  });

  it('um único anexo fica no singular', async () => {
    await montarCom([ticket({ n_anexos: 1 })]);
    expect(screen.getByText('Victor · 1 anexo')).toBeInTheDocument();
  });

  it('sem anexos não escreve nada sobre anexos', async () => {
    await montarCom([ticket({ n_anexos: 0 })]);
    expect(screen.getByText('Victor')).toBeInTheDocument();
    expect(screen.queryByText(/anexo/)).not.toBeInTheDocument();
  });

  it('mostra vários tickets, um por linha', async () => {
    await montarCom([ticket(), ticket({ id: 'AT-2026-002' }), ticket({ id: 'AT-2026-003' })]);
    expect(screen.getAllByRole('row')).toHaveLength(4); // cabeçalho + 3
  });

  it('respeita a ordem que a API devolve (mais recente primeiro)', async () => {
    await montarCom([ticket({ id: 'AT-2026-003' }), ticket({ id: 'AT-2026-001' }), ticket({ id: 'AT-2026-002' })]);
    const ids = screen.getAllByRole('row').slice(1).map((l) => within(l).getAllByRole('cell')[0].textContent);
    expect(ids).toEqual(['AT-2026-003', 'AT-2026-001', 'AT-2026-002']);
  });

  it('a tabela tem as colunas que a Dra. espera', async () => {
    await montarCom([ticket()]);
    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(cabecalhos).toEqual(['ID', 'Título', 'Status', 'Urgência', 'Compl.', 'Abertura', 'Prazo', 'Ações']);
  });

  it('o subtítulo conta os tickets e os que estão em curso', async () => {
    await montarCom([ticket(), ticket({ id: 'AT-2026-002', status: 'resolvido' }), ticket({ id: 'AT-2026-003', status: 'em_execucao' })]);
    expect(screen.getByText(/^3 tickets · 2 em curso/)).toBeInTheDocument();
  });

  it('um só ticket usa o singular no subtítulo', async () => {
    await montarCom([ticket()]);
    expect(screen.getByText(/^1 ticket · 1 em curso/)).toBeInTheDocument();
  });

  it('rascunhos, resolvidos e cancelados não contam como «em curso»', async () => {
    await montarCom([
      ticket({ id: 'AT-2026-001', status: 'rascunho' }),
      ticket({ id: 'AT-2026-002', status: 'resolvido' }),
      ticket({ id: 'AT-2026-003', status: 'cancelado' }),
    ]);
    expect(screen.getByText(/^3 tickets · 0 em curso/)).toBeInTheDocument();
  });

  it('cada linha tem o botão de abrir o ticket', async () => {
    await montarCom([ticket()]);
    expect(within(linhaDe('AT-2026-001')).getByRole('button', { name: 'Abrir' })).toBeInTheDocument();
  });

  it('«Efetuar Alteração» não aparece na lista — vive só dentro do ticket', async () => {
    await montarCom([ticket({ status: 'em_analise' })]);
    expect(screen.queryByRole('button', { name: /Efetuar Alteração/ })).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════ 2. FILTROS ═══════════════════════════════ */

describe('filtros', () => {
  const TRES = [
    ticket({ id: 'AT-2026-001', status: 'aberto', urgencia: 'baixa', titulo: 'PDF em branco' }),
    ticket({ id: 'AT-2026-002', status: 'resolvido', urgencia: 'critica', titulo: 'Recibo duplicado' }),
    ticket({ id: 'AT-2026-003', status: 'aberto', urgencia: 'alta', titulo: 'Calendário lento', descricao: 'demora a abrir' }),
  ];
  const idsVisiveis = () => screen.getAllByRole('row').slice(1).map((l) => within(l).getAllByRole('cell')[0].textContent);

  it('começa em «Todos»', async () => {
    await montarCom(TRES);
    expect(screen.getByRole('button', { name: 'Todos' }).className).toContain('on');
  });

  it('há um botão de filtro por cada estado', async () => {
    await montarCom(TRES);
    for (const nome of ['Todos', 'Rascunho', 'Aberto', 'Em análise', 'Em execução', 'Em aprovação', 'Impedimento', 'Resolvido', 'Cancelado']) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    }
  });

  it('filtrar por «Aberto» deixa só os abertos', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Aberto' }));
    expect(idsVisiveis()).toEqual(['AT-2026-001', 'AT-2026-003']);
  });

  it('filtrar por «Resolvido» deixa só o resolvido', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Resolvido' }));
    expect(idsVisiveis()).toEqual(['AT-2026-002']);
  });

  it('o filtro escolhido fica marcado', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Resolvido' }));
    expect(screen.getByRole('button', { name: 'Resolvido' }).className).toContain('on');
  });

  it('só um filtro fica marcado de cada vez', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Resolvido' }));
    expect(screen.getByRole('button', { name: 'Todos' }).className).not.toContain('on');
  });

  it('filtro sem resultados explica que é dos filtros', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Cancelado' }));
    expect(screen.getByText('Nenhum ticket com esses filtros.')).toBeInTheDocument();
  });

  it('voltar a «Todos» limpa o filtro', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Cancelado' }));
    await utilizador.click(screen.getByRole('button', { name: 'Todos' }));
    expect(idsVisiveis()).toHaveLength(3);
  });

  it('o filtro não volta a chamar a API', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Aberto' }));
    expect(apoio.list).toHaveBeenCalledTimes(1);
  });

  it('o subtítulo continua a contar TODOS os tickets, mesmo filtrado', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Resolvido' }));
    expect(screen.getByText(/^3 tickets/)).toBeInTheDocument();
  });

  it('pesquisa pelo título', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'recibo');
    expect(idsVisiveis()).toEqual(['AT-2026-002']);
  });

  it('pesquisa pelo ID', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'AT-2026-003');
    expect(idsVisiveis()).toEqual(['AT-2026-003']);
  });

  it('pesquisa pela descrição', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'demora a abrir');
    expect(idsVisiveis()).toEqual(['AT-2026-003']);
  });

  it('a pesquisa não distingue maiúsculas de minúsculas', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'PDF EM BRANCO');
    expect(idsVisiveis()).toEqual(['AT-2026-001']);
  });

  it('pesquisa parcial (um pedaço do título) chega', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'lent');
    expect(idsVisiveis()).toEqual(['AT-2026-003']);
  });

  it('pesquisa sem correspondência mostra a mensagem dos filtros', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'zzzz');
    expect(screen.getByText('Nenhum ticket com esses filtros.')).toBeInTheDocument();
  });

  it('apagar a pesquisa devolve a lista completa', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'zzzz');
    await utilizador.clear(campo.pesquisa());
    expect(idsVisiveis()).toHaveLength(3);
  });

  it('pesquisa e estado combinam-se (E lógico)', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Aberto' }));
    await utilizador.type(campo.pesquisa(), 'calendário');
    expect(idsVisiveis()).toEqual(['AT-2026-003']);
  });

  it('combinação impossível de estado e pesquisa não devolve nada', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.click(screen.getByRole('button', { name: 'Resolvido' }));
    await utilizador.type(campo.pesquisa(), 'calendário');
    expect(screen.getByText('Nenhum ticket com esses filtros.')).toBeInTheDocument();
  });

  it('ticket sem título não parte a pesquisa', async () => {
    const { utilizador } = await montarCom([ticket({ titulo: null, descricao: null })]);
    await utilizador.type(campo.pesquisa(), 'seja o que for');
    expect(screen.getByText('Nenhum ticket com esses filtros.')).toBeInTheDocument();
  });

  it('a lista com filtro vazio não fica em branco — explica sempre o que se passa', async () => {
    const { utilizador } = await montarCom(TRES);
    await utilizador.type(campo.pesquisa(), 'zzzz');
    expect(screen.getByRole('heading', { level: 1, name: 'Apoio Técnico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo ticket' })).toBeInTheDocument();
  });
});

/* ══════════════════════════════ 3. CRIAR TICKET ═══════════════════════════ */

describe('criar ticket', () => {
  it('«Novo ticket» abre o modal de criação', async () => {
    await novoTicket();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('o modal novo não mostra ID nem estado', async () => {
    await novoTicket();
    expect(within(dlg()).queryByText(/^AT-\d{4}-\d{3}$/)).not.toBeInTheDocument();
  });

  it('o modal novo não vai buscar nada à API', async () => {
    await novoTicket();
    expect(apoio.get).not.toHaveBeenCalled();
  });

  it('o título começa vazio', async () => {
    await novoTicket();
    expect(campo.titulo()).toHaveValue('');
  });

  it('a urgência por omissão é Média', async () => {
    await novoTicket();
    expect(within(dlg()).getByRole('button', { name: 'Média' }).className).toContain('on');
  });

  it('o autor por omissão é o Victor', async () => {
    await novoTicket();
    expect(within(dlg()).getByRole('button', { name: 'Criado por' })).toHaveTextContent('Victor');
  });

  it('o prazo começa por preencher', async () => {
    await novoTicket();
    expect(within(dlg()).getByText('dd/mm/aaaa')).toBeInTheDocument();
  });

  it('sem título recusa guardar e diz porquê', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Indique o título do pedido.')).toBeInTheDocument();
  });

  it('sem título não chega a chamar a API', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Indique o título do pedido.');
    expect(apoio.create).not.toHaveBeenCalled();
  });

  it('título só com espaços conta como vazio', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), '    ');
    await utilizador.click(within(dlg()).getByRole('button', { name: /Abrir ticket/ }));
    expect(await screen.findByText('Indique o título do pedido.')).toBeInTheDocument();
  });

  it('«Salvar» cria como rascunho', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'rascunho' })));
  });

  it('«Abrir ticket» cria já aberto', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: /Abrir ticket/ }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'aberto' })));
  });

  it('envia o título e a descrição escritos', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Recibo errado');
    await utilizador.type(campo.descricao(), 'O valor sai a dobrar.');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: 'Recibo errado', descricao: 'O valor sai a dobrar.' }),
    ));
  });

  it('sem prazo envia data_prazo a null', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Sem prazo');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ data_prazo: null })));
  });

  it('o prazo é opcional mas segue quando é escolhido', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Com prazo');
    await utilizador.click(within(dlg()).getByText('dd/mm/aaaa'));
    await utilizador.click(screen.getByRole('button', { name: 'Hoje' }));
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ data_prazo: iso })));
  });

  it('muda a urgência para Crítica', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Urgente');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Crítica' }));
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ urgencia: 'critica' })));
  });

  it('muda o autor para a Dra. Vyvian', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Pedido da Dra.');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Criado por' }));
    await utilizador.click(screen.getByRole('option', { name: 'Dra. Vyvian' }));
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.create).toHaveBeenCalledWith(expect.objectContaining({ criado_por: 'Dra. Vyvian' })));
  });

  it('avisa com o número do rascunho guardado', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Rascunho AT-2026-009 guardado.')).toBeInTheDocument();
  });

  it('avisa com o número do ticket aberto', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: /Abrir ticket/ }));
    expect(await screen.findByText('Ticket AT-2026-009 aberto.')).toBeInTheDocument();
  });

  it('depois de criar fecha o modal', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('depois de criar recarrega a lista', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'Novo pedido');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.list).toHaveBeenCalledTimes(2));
  });

  it('«Cancelar» num ticket novo fecha sem perguntar nada', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apoio.create).not.toHaveBeenCalled();
  });

  it('o ✕ fecha o modal', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a tecla Esc fecha o modal', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

/* ═════════════════════════ 4. ABRIR UM TICKET (DETALHE) ═══════════════════ */

describe('abrir um ticket', () => {
  it('«Abrir» na linha vai buscar o ticket à API', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(apoio.get).toHaveBeenCalledWith('AT-2026-001');
  });

  it('mostra «A carregar…» enquanto o ticket não chega', async () => {
    const { promessa } = adiar();
    apoio.get.mockReturnValue(promessa);
    const { utilizador } = await montarCom([ticket()]);
    await utilizador.click(within(linhaDe('AT-2026-001')).getByRole('button', { name: 'Abrir' }));
    expect(await screen.findByText('A carregar…')).toBeInTheDocument();
  });

  it('mostra o ID no cabeçalho do modal', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).getByText('AT-2026-001')).toBeInTheDocument();
  });

  it('mostra o estado no cabeçalho', async () => {
    await comTicket({ status: 'impedimento' });
    expect(etiqueta('Impedimento')).toBeInTheDocument();
  });

  it('mostra a urgência no cabeçalho', async () => {
    await comTicket({ urgencia: 'alta' });
    expect(etiqueta('Urgência Alta')).toBeInTheDocument();
  });

  it('mostra a complexidade no cabeçalho quando existe', async () => {
    await comTicket({ complexidade: 'baixa' });
    expect(etiqueta('Complexidade Baixa')).toBeInTheDocument();
  });

  it('sem complexidade não mostra a etiqueta de complexidade', async () => {
    await comTicket({});
    expect(within(dlg()).queryByText(/^Complexidade /, { selector: 'span' })).not.toBeInTheDocument();
  });

  it('mostra quem criou e quando abriu', async () => {
    await comTicket({});
    expect(within(dlg()).getByText(/Criado por/, { selector: 'div' })).toHaveTextContent('aberto a 01/08/2026 às 10:30');
  });

  it('um rascunho diz que é rascunho em vez da data de abertura', async () => {
    await comTicket({ status: 'rascunho', data_abertura: null });
    expect(within(dlg()).getByText(/Criado por/, { selector: 'div' })).toHaveTextContent('rascunho');
  });

  it('mostra o prazo no cabeçalho quando existe', async () => {
    await comTicket({ data_prazo: '2026-09-01' });
    expect(within(dlg()).getByText(/Criado por/, { selector: 'div' })).toHaveTextContent('prazo 01/09/2026');
  });

  it('preenche o título com o que está guardado', async () => {
    await comTicket({});
    expect(campo.titulo()).toHaveValue('Erro ao gerar o PDF do plano de pagamento');
  });

  it('preenche a descrição com o que está guardado', async () => {
    await comTicket({});
    expect(campo.descricao()).toHaveValue('Ao clicar em imprimir o ficheiro sai em branco.');
  });

  it('mostra a justificação da complexidade dada pela IA', async () => {
    await comTicket({ complexidade: 'alta', complexidade_justificacao: 'Mexe no gerador de PDF' });
    expect(within(dlg()).getByText(/Mexe no gerador de PDF/)).toBeInTheDocument();
  });

  it('mostra o plano da IA no campo próprio', async () => {
    await comTicket({ plano_ia: '1. Corrigir o cabeçalho\n2. Testar' });
    expect(campo.plano()).toHaveValue('1. Corrigir o cabeçalho\n2. Testar');
  });

  it('mostra os impedimentos', async () => {
    await comTicket({ impedimentos: 'Falta o token da API' });
    expect(campo.impedimentos()).toHaveValue('Falta o token da API');
  });

  it('mostra a resolução', async () => {
    await comTicket({ resolucao: 'Corrigido o cálculo do total.' });
    expect(campo.resolucao()).toHaveValue('Corrigido o cálculo do total.');
  });

  it('campos vazios no servidor não aparecem como «null»', async () => {
    await comTicket({ descricao: null, plano_ia: null, impedimentos: null, resolucao: null });
    expect(campo.descricao()).toHaveValue('');
    expect(campo.resolucao()).toHaveValue('');
  });

  it('abrir pela lista entra em modo leitura (sem rodapé de ações)', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('em leitura os campos estão bloqueados', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(campo.titulo()).toBeDisabled();
  });

  it('em leitura há um botão «Editar»', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).getByRole('button', { name: /Editar/ })).toBeInTheDocument();
  });

  it('«Editar» desbloqueia os campos', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    await utilizador.click(within(dlg()).getByRole('button', { name: /Editar/ }));
    expect(campo.titulo()).toBeEnabled();
  });

  it('«Editar» faz aparecer o rodapé de ações', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    await utilizador.click(within(dlg()).getByRole('button', { name: /Editar/ }));
    expect(within(dlg()).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('o lápis da linha entra logo em edição', async () => {
    await comTicket({});
    expect(campo.titulo()).toBeEnabled();
    expect(within(dlg()).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('em leitura não há botão de gravar voz', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).queryByRole('button', { name: /Ditar por voz/ })).not.toBeInTheDocument();
  });

  it('em leitura não há botão de analisar com IA', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).queryByRole('button', { name: /Analisar com IA/ })).not.toBeInTheDocument();
  });

  it('em leitura não há barra de mudança de status', async () => {
    const { utilizador } = await montarCom([ticket()]);
    await abrirLeitura(utilizador);
    expect(within(dlg()).queryByRole('button', { name: 'Em execução' })).not.toBeInTheDocument();
  });
});

/* ══════════════════════════════ 5. HISTÓRICO ══════════════════════════════ */

describe('histórico do ticket', () => {
  const comLog = (log) => comTicket({ _log: log });

  it('sem eventos não mostra secção de histórico', async () => {
    await comLog([]);
    expect(screen.queryByText(/^Histórico/)).not.toBeInTheDocument();
  });

  it('mostra o número de eventos', async () => {
    await comLog([evento(), evento({ evento: 'status', detalhe: 'status: rascunho → aberto' })]);
    expect(screen.getByText('Histórico (2)')).toBeInTheDocument();
  });

  it('vem fechado por defeito', async () => {
    await comLog([evento({ detalhe: 'Ticket criado' })]);
    expect(screen.queryByText(/Ticket criado/)).not.toBeInTheDocument();
  });

  it('o botão diz que está fechado (aria-expanded)', async () => {
    await comLog([evento()]);
    expect(screen.getByText('Histórico (1)').closest('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicar abre o histórico', async () => {
    const { utilizador } = await comLog([evento({ detalhe: 'Ticket criado' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Ticket criado/)).toBeInTheDocument();
  });

  it('clicar outra vez volta a fechar', async () => {
    const { utilizador } = await comLog([evento({ detalhe: 'Ticket criado' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.queryByText(/Ticket criado/)).not.toBeInTheDocument();
  });

  it('aberto, o aria-expanded passa a true', async () => {
    const { utilizador } = await comLog([evento()]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText('Histórico (1)').closest('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('mostra o autor de cada evento', async () => {
    const { utilizador } = await comLog([evento({ autor: 'Dra. Vyvian' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText('Dra. Vyvian')).toBeInTheDocument();
  });

  it('evento sem autor mostra travessão', async () => {
    const { utilizador } = await comLog([evento({ autor: null })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(within(dlg()).getByText('—')).toBeInTheDocument();
  });

  it('mostra a data e hora do evento', async () => {
    const { utilizador } = await comLog([evento({ created_at: '2026-08-01 10:30:00' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/01\/08\/26/)).toBeInTheDocument();
  });

  it('traduz a mudança de status para linguagem da Dra.', async () => {
    const { utilizador } = await comLog([evento({ evento: 'status', detalhe: 'status: aberto → em_execucao' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Status alterado de «Aberto» para «Em execução»/)).toBeInTheDocument();
  });

  it('traduz também a seta ASCII (->)', async () => {
    const { utilizador } = await comLog([evento({ evento: 'status', detalhe: 'status: rascunho -> aberto' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Status alterado de «Rascunho» para «Aberto»/)).toBeInTheDocument();
  });

  it('um campo alterado fica no singular e com o nome legível', async () => {
    const { utilizador } = await comLog([evento({ evento: 'editado', detalhe: 'titulo' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Campo alterado: Título/)).toBeInTheDocument();
  });

  it('vários campos alterados ficam no plural', async () => {
    const { utilizador } = await comLog([evento({ evento: 'editado', detalhe: 'titulo; descricao; urgencia' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Campos alterados: Título, Descrição, Grau de urgência/)).toBeInTheDocument();
  });

  it('mistura de status e campos aparece nas duas frases', async () => {
    const { utilizador } = await comLog([evento({ evento: 'status', detalhe: 'status: aberto → resolvido; resolucao' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Status alterado de «Aberto» para «Resolvido» · Campo alterado: Como foi efetuada a resolução/)).toBeInTheDocument();
  });

  it('campo desconhecido aparece tal como veio', async () => {
    const { utilizador } = await comLog([evento({ evento: 'editado', detalhe: 'campo_novo' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Campo alterado: campo_novo/)).toBeInTheDocument();
  });

  it('anexo de print do pedido fica legível', async () => {
    const { utilizador } = await comLog([evento({ evento: 'anexo', detalhe: 'print_abertura: erro.png (12 KB)' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Print do pedido anexado: erro.png \(12 KB\)/)).toBeInTheDocument();
  });

  it('anexo de print de conclusão fica legível', async () => {
    const { utilizador } = await comLog([evento({ evento: 'anexo', detalhe: 'print_conclusao: ok.png (3 KB)' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Print de evidência da conclusão anexado: ok.png/)).toBeInTheDocument();
  });

  it('gravação de voz não expõe o nome técnico do ficheiro', async () => {
    const { utilizador } = await comLog([evento({ evento: 'anexo', detalhe: 'audio: gravacao-123.webm (40 KB)' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Gravação de voz anexada \(40 KB\)/)).toBeInTheDocument();
  });

  it('remoção de anexo fica legível', async () => {
    const { utilizador } = await comLog([evento({ evento: 'anexo', detalhe: 'Removido: erro.png' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Anexo removido: erro.png/)).toBeInTheDocument();
  });

  it('análise da IA mostra a complexidade por extenso', async () => {
    const { utilizador } = await comLog([evento({ evento: 'analise_ia', detalhe: 'Complexidade: alta' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Análise da IA concluída — complexidade Alta/)).toBeInTheDocument();
  });

  it('evento de criação sem detalhe diz «Ticket criado»', async () => {
    const { utilizador } = await comLog([evento({ evento: 'criado', detalhe: '' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/Ticket criado/)).toBeInTheDocument();
  });

  it('evento desconhecido mostra o detalhe cru em vez de rebentar', async () => {
    const { utilizador } = await comLog([evento({ evento: 'aprovacao', detalhe: 'E-mail enviado a dra@exemplo.pt' })]);
    await utilizador.click(screen.getByText('Histórico (1)'));
    expect(screen.getByText(/E-mail enviado a dra@exemplo.pt/)).toBeInTheDocument();
  });

  it('mostra todos os eventos pela ordem em que vêm', async () => {
    const { utilizador } = await comLog([
      evento({ evento: 'status', detalhe: 'status: aberto → resolvido' }),
      evento({ evento: 'criado', detalhe: 'Ticket criado' }),
    ]);
    await utilizador.click(screen.getByText('Histórico (2)'));
    const linhas = within(dlg()).getAllByText(/·/).map((n) => n.textContent);
    expect(linhas.join('|')).toMatch(/Resolvido[\s\S]*Ticket criado/);
  });
});

/* ═════════════════ 6. AÇÕES E REGRAS DE APRESENTAÇÃO DOS BOTÕES ═══════════ */

describe('regras dos botões do rodapé', () => {
  it('ticket novo mostra Cancelar, Salvar e Abrir ticket', async () => {
    await novoTicket();
    const nomes = within(rodape()).getAllByRole('button').map((b) => b.textContent.trim());
    expect(nomes).toEqual(['Cancelar', 'Salvar', 'Abrir ticket']);
  });

  it('«Abrir ticket» só aparece em rascunho', async () => {
    await comTicket({ status: 'rascunho' });
    expect(within(dlg()).getByRole('button', { name: /Abrir ticket/ })).toBeInTheDocument();
  });

  it.each(['aberto', 'em_analise', 'em_execucao', 'em_aprovacao', 'impedimento', 'resolvido', 'cancelado'])(
    '«Abrir ticket» não aparece com o estado %s', async (status) => {
      await comTicket({ status });
      expect(within(dlg()).queryByRole('button', { name: /Abrir ticket/ })).not.toBeInTheDocument();
    });

  it.each(['aberto', 'em_analise', 'em_execucao', 'em_aprovacao', 'impedimento'])(
    '«Efetuar Alteração» aparece com o estado %s', async (status) => {
      await comTicket({ status });
      expect(within(rodape()).getByRole('button', { name: /Efetuar Alteração|Em execução/ })).toBeInTheDocument();
    });

  it.each(['rascunho', 'resolvido', 'cancelado'])(
    '«Efetuar Alteração» não aparece com o estado %s', async (status) => {
      await comTicket({ status });
      expect(within(rodape()).queryByRole('button', { name: /Efetuar Alteração/ })).not.toBeInTheDocument();
    });

  it('com o ticket já em execução o botão fica desativado e muda de nome', async () => {
    await comTicket({ status: 'em_execucao' });
    const b = within(rodape()).getByRole('button', { name: /Em execução/ });
    expect(b).toBeDisabled();
  });

  it('«Enviar para Aprovação» só aparece com o estado Em aprovação', async () => {
    await comTicket({ status: 'em_aprovacao' });
    expect(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ })).toBeInTheDocument();
  });

  it.each(['rascunho', 'aberto', 'em_analise', 'em_execucao', 'impedimento', 'resolvido', 'cancelado'])(
    '«Enviar para Aprovação» não aparece com o estado %s', async (status) => {
      await comTicket({ status });
      expect(within(dlg()).queryByRole('button', { name: /Enviar para Aprovação/ })).not.toBeInTheDocument();
    });

  it('«Enviar para Aprovação» não aparece num ticket ainda por criar', async () => {
    await novoTicket();
    expect(screen.queryByRole('button', { name: /Enviar para Aprovação/ })).not.toBeInTheDocument();
  });

  it('«Enviar para Aprovação» vive no rodapé', async () => {
    await comTicket({ status: 'em_aprovacao' });
    const b = within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ });
    expect(rodape()).toContainElement(b);
  });

  it('«Enviar para Aprovação» é o último botão do rodapé', async () => {
    await comTicket({ status: 'em_aprovacao' });
    expect(rodape().lastElementChild.textContent).toContain('Enviar para Aprovação');
  });

  it('«Enviar para Aprovação» é dourado', async () => {
    await comTicket({ status: 'em_aprovacao' });
    expect(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }).className).toContain('btn-gold');
  });

  it('em modo leitura não há rodapé nenhum, nem com Em aprovação', async () => {
    const t = ticket({ status: 'em_aprovacao' });
    apoio.list.mockResolvedValue({ tickets: [t] });
    apoio.get.mockResolvedValue({ ticket: t, anexos: [], log: [] });
    const { utilizador } = montar();
    await screen.findByRole('button', { name: 'Novo ticket' });
    await abrirLeitura(utilizador);
    expect(screen.queryByRole('button', { name: /Enviar para Aprovação/ })).not.toBeInTheDocument();
  });

  it('«Salvar» está sempre disponível num ticket existente', async () => {
    await comTicket({ status: 'resolvido' });
    expect(within(rodape()).getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('«Analisar com IA» aparece em edição', async () => {
    await comTicket({});
    expect(within(dlg()).getByRole('button', { name: /Analisar com IA/ })).toBeInTheDocument();
  });

  it('«Analisar com IA» está desativado enquanto o ticket não existir', async () => {
    await novoTicket();
    expect(screen.getByRole('button', { name: /Analisar com IA/ })).toBeDisabled();
  });

  it('a barra de status não oferece «Rascunho» a um ticket já aberto', async () => {
    await comTicket({ status: 'aberto' });
    expect(within(dlg()).queryByRole('button', { name: 'Rascunho' })).not.toBeInTheDocument();
  });

  it('a barra de status oferece «Rascunho» a um rascunho', async () => {
    await comTicket({ status: 'rascunho' });
    expect(within(dlg()).getByRole('button', { name: 'Rascunho' })).toBeInTheDocument();
  });

  it('a barra de status marca o estado atual', async () => {
    await comTicket({ status: 'impedimento' });
    expect(within(dlg()).getByRole('button', { name: 'Impedimento' }).className).toContain('on');
  });
});

describe('ações sobre o ticket', () => {
  it('«Analisar com IA» guarda o texto antes de chamar a IA', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Analisar com IA/ }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({
      titulo: 'Erro ao gerar o PDF do plano de pagamento',
    })));
  });

  it('«Analisar com IA» chama mesmo a análise', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Analisar com IA/ }));
    await waitFor(() => expect(apoio.analisar).toHaveBeenCalledWith('AT-2026-001'));
  });

  it('a análise preenche o plano e avisa a complexidade', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Analisar com IA/ }));
    expect(await screen.findByText(/Análise concluída — complexidade Média/)).toBeInTheDocument();
    expect(campo.plano()).toHaveValue('Passo 1…');
  });

  it('a análise não fecha o modal', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Analisar com IA/ }));
    await screen.findByText(/Análise concluída/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('«Efetuar Alteração» pede confirmação antes de tudo', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Efetuar Alteração/ }));
    expect(await screen.findByText(/Efetuar a alteração do ticket AT-2026-001/)).toBeInTheDocument();
    expect(apoio.executar).not.toHaveBeenCalled();
  });

  it('recusar a confirmação não executa nada', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Efetuar Alteração/ }));
    await recusarDialogo(utilizador);
    await waitFor(() => expect(screen.queryByText(/Efetuar a alteração do ticket/)).not.toBeInTheDocument());
    expect(apoio.executar).not.toHaveBeenCalled();
  });

  it('confirmar executa e explica o passo seguinte', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Efetuar Alteração/ }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.executar).toHaveBeenCalledWith('AT-2026-001'));
    expect(await screen.findByText(/diga «resolver ticket AT-2026-001»/)).toBeInTheDocument();
  });

  it('executar guarda primeiro o que estiver escrito', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.type(campo.impedimentos(), 'falta token');
    await utilizador.click(within(dlg()).getByRole('button', { name: /Efetuar Alteração/ }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({ impedimentos: 'falta token' })));
  });

  it('«Enviar para Aprovação» pede confirmação', async () => {
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    expect(await screen.findByText(/Enviar o ticket AT-2026-001 para aprovação da Dra\./)).toBeInTheDocument();
    expect(apoio.aprovar).not.toHaveBeenCalled();
  });

  it('confirmar envia o e-mail à Dra.', async () => {
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.aprovar).toHaveBeenCalledWith('AT-2026-001'));
    expect(await screen.findByText(/E-mail enviado à Dra\. — AT-2026-001 em aprovação\./)).toBeInTheDocument();
  });

  it('enviar para aprovação guarda a resolução escrita antes', async () => {
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    await utilizador.type(campo.resolucao(), 'ficou resolvido assim');
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({ resolucao: 'ficou resolvido assim' })));
  });

  it('mudar o status pela barra grava logo', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Resolvido' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', { status: 'resolvido' }));
    expect(await screen.findByText('Status atualizado.')).toBeInTheDocument();
  });

  it('mudar o status recarrega a lista por trás', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Em análise' }));
    await waitFor(() => expect(apoio.list).toHaveBeenCalledTimes(2));
  });

  it('«Cancelar» num ticket existente pergunta antes de cancelar', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(/Cancelar o ticket AT-2026-001\?/)).toBeInTheDocument();
  });

  it('confirmar o cancelamento muda o status e fecha', async () => {
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Cancelar' }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', { status: 'cancelado' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('«Cancelar» num ticket já resolvido fecha sem perguntar', async () => {
    const { utilizador } = await comTicket({ status: 'resolvido' });
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apoio.update).not.toHaveBeenCalled();
  });

  it('«Cancelar» num ticket já cancelado fecha sem perguntar', async () => {
    const { utilizador } = await comTicket({ status: 'cancelado' });
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════ 7. EDIÇÃO E GRAVAÇÃO DE CAMPOS ══════════════════ */

describe('edição e gravação', () => {
  it('deixa reescrever o título', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.clear(campo.titulo());
    await utilizador.type(campo.titulo(), 'Título novo');
    expect(campo.titulo()).toHaveValue('Título novo');
  });

  it('grava o título alterado', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.clear(campo.titulo());
    await utilizador.type(campo.titulo(), 'Título novo');
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({ titulo: 'Título novo' })));
  });

  it('grava a resolução escrita', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.type(campo.resolucao(), 'Resolvido com um ajuste no cálculo.');
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({
      resolucao: 'Resolvido com um ajuste no cálculo.',
    })));
  });

  it('grava os impedimentos', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.type(campo.impedimentos(), 'Falta a chave da API.');
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({
      impedimentos: 'Falta a chave da API.',
    })));
  });

  it('grava o plano da IA editado à mão', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.type(campo.plano(), 'Plano meu');
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalledWith('AT-2026-001', expect.objectContaining({ plano_ia: 'Plano meu' })));
  });

  it('não cria um ticket novo ao gravar um existente', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.update).toHaveBeenCalled());
    expect(apoio.create).not.toHaveBeenCalled();
  });

  it('avisa que as alterações ficaram guardadas', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Alterações guardadas.')).toBeInTheDocument();
  });

  it('gravar um ticket existente NÃO fecha o modal', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Alterações guardadas.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('gravar recarrega o ticket do servidor', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.get).toHaveBeenCalledTimes(2));
  });

  it('gravar recarrega também a lista', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.list).toHaveBeenCalledTimes(2));
  });

  it('«Abrir ticket» a partir de um rascunho abre-o mesmo', async () => {
    const { utilizador } = await comTicket({ status: 'rascunho' });
    await utilizador.click(within(rodape()).getByRole('button', { name: /Abrir ticket/ }));
    await waitFor(() => expect(apoio.abrir).toHaveBeenCalledWith('AT-2026-001'));
  });

  it('abrir um rascunho fecha o modal no fim', async () => {
    const { utilizador } = await comTicket({ status: 'rascunho' });
    await utilizador.click(within(rodape()).getByRole('button', { name: /Abrir ticket/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('o botão Salvar avisa que está a gravar e fica desativado', async () => {
    const { promessa } = adiar();
    const { utilizador } = await comTicket({});
    apoio.update.mockReturnValue(promessa);
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    const b = await within(rodape()).findByRole('button', { name: 'A guardar…' });
    expect(b).toBeDisabled();
  });

  it('enquanto grava, os outros botões do rodapé também ficam desativados', async () => {
    const { promessa } = adiar();
    const { utilizador } = await comTicket({ status: 'aberto' });
    apoio.update.mockReturnValue(promessa);
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await within(rodape()).findByRole('button', { name: 'A guardar…' });
    for (const b of within(rodape()).getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('enquanto grava, os campos ficam bloqueados', async () => {
    const { promessa } = adiar();
    const { utilizador } = await comTicket({});
    apoio.update.mockReturnValue(promessa);
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await within(rodape()).findByRole('button', { name: 'A guardar…' });
    expect(campo.titulo()).toBeDisabled();
  });

  it('o botão «Enviar para Aprovação» avisa que está a enviar', async () => {
    const { promessa } = adiar();
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    apoio.update.mockReturnValue(promessa);
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    await confirmarDialogo(utilizador);
    expect(await within(rodape()).findByRole('button', { name: 'A enviar…' })).toBeDisabled();
  });
});

/* ═══════════════════════════════ 8. ANEXOS ════════════════════════════════ */

describe('anexos', () => {
  it('mostra a imagem guardada com o nome no alt', async () => {
    await comTicket({ _anexos: [anexo({ tipo: 'print_abertura', nome: 'erro.png', content_type: 'image/png' })] });
    expect(await screen.findByAltText('erro.png')).toBeInTheDocument();
  });

  it('vai buscar o conteúdo do anexo autenticado', async () => {
    await comTicket({ _anexos: [anexo({ id: 42 })] });
    await waitFor(() => expect(apoio.anexoObjectUrl).toHaveBeenCalledWith(42));
  });

  it('um ficheiro que não é imagem aparece como ligação com o nome', async () => {
    await comTicket({ _anexos: [anexo({ tipo: 'anexo', nome: 'relatorio.pdf', content_type: 'application/pdf' })] });
    expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
  });

  it('ficheiro sem nome não deixa a ligação vazia', async () => {
    await comTicket({ _anexos: [anexo({ nome: '', content_type: 'application/pdf' })] });
    expect(screen.getByText('ficheiro')).toBeInTheDocument();
  });

  it('a gravação de voz aparece com leitor de áudio', async () => {
    const { t } = await comTicket({ _anexos: [anexo({ tipo: 'audio', nome: 'gravacao.webm', content_type: 'audio/webm' })] });
    expect(t).toBeTruthy();
    await waitFor(() => expect(dlg().querySelector('audio')).toBeTruthy());
  });

  it('a transcrição do áudio aparece entre aspas', async () => {
    await comTicket({ _anexos: [anexo({ tipo: 'audio', content_type: 'audio/webm', transcricao: 'o pdf sai em branco' })] });
    expect(await screen.findByText('«o pdf sai em branco»')).toBeInTheDocument();
  });

  it('prints do pedido, ficheiros e áudio ficam todos na zona do pedido', async () => {
    await comTicket({ _anexos: [
      anexo({ id: 1, tipo: 'print_abertura', nome: 'a.png', content_type: 'image/png' }),
      anexo({ id: 2, tipo: 'anexo', nome: 'b.pdf', content_type: 'application/pdf' }),
      anexo({ id: 3, tipo: 'audio', nome: 'c.webm', content_type: 'audio/webm' }),
    ] });
    const z = zona(ROT_PEDIDO);
    expect(await within(z).findByAltText('a.png')).toBeInTheDocument();
    expect(within(z).getByText('b.pdf')).toBeInTheDocument();
  });

  it('os prints de conclusão ficam na zona da conclusão', async () => {
    await comTicket({ _anexos: [anexo({ id: 5, tipo: 'print_conclusao', nome: 'ok.png', content_type: 'image/png' })] });
    expect(await within(zona(ROT_CONCLUSAO)).findByAltText('ok.png')).toBeInTheDocument();
  });

  it('um print de conclusão não aparece na zona do pedido', async () => {
    await comTicket({ _anexos: [anexo({ id: 5, tipo: 'print_conclusao', nome: 'ok.png', content_type: 'image/png' })] });
    expect(within(zona(ROT_PEDIDO)).queryByAltText('ok.png')).not.toBeInTheDocument();
  });

  it('zona vazia explica como colar um print', async () => {
    await comTicket({});
    expect(screen.getByText(/Clique aqui e cole um print com Ctrl\+V, ou escolha ficheiros/)).toBeInTheDocument();
  });

  it('colar um print sobe-o logo para o ticket', async () => {
    await comTicket({});
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledWith(
      'AT-2026-001', expect.any(File), { tipo: 'print_abertura', nome: 'erro.png' },
    ));
  });

  it('colar na zona da conclusão marca o print como evidência', async () => {
    await comTicket({});
    colar(zona(ROT_CONCLUSAO), [png('ok.png')]);
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledWith(
      'AT-2026-001', expect.any(File), { tipo: 'print_conclusao', nome: 'ok.png' },
    ));
  });

  it('colar dois prints sobe os dois', async () => {
    await comTicket({});
    colar(zona(ROT_PEDIDO), [png('a.png'), png('b.png')]);
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledTimes(2));
  });

  it('colar texto (sem ficheiros) não sobe nada', async () => {
    await comTicket({});
    fireEvent.paste(zona(ROT_PEDIDO), { clipboardData: { items: [{ kind: 'string', getAsFile: () => null }] } });
    expect(apoio.uploadAnexo).not.toHaveBeenCalled();
  });

  it('escolher um ficheiro sobe-o como anexo', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.upload(inputFicheiro(ROT_PEDIDO), png('mapa.png'));
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledWith(
      'AT-2026-001', expect.any(File), { tipo: 'anexo', nome: 'mapa.png' },
    ));
  });

  it('depois de subir, refresca o ticket sem apagar o texto por gravar', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.type(campo.resolucao(), 'já tinha escrito isto');
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await waitFor(() => expect(apoio.get).toHaveBeenCalledTimes(2));
    expect(campo.resolucao()).toHaveValue('já tinha escrito isto');
  });

  it('depois de subir atualiza também a lista por trás', async () => {
    await comTicket({});
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await waitFor(() => expect(apoio.list).toHaveBeenCalledTimes(2));
  });

  it('cada anexo guardado tem botão de remover com nome acessível', async () => {
    await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    expect(await screen.findByRole('button', { name: 'Remover anexo' })).toBeInTheDocument();
  });

  it('remover pergunta antes, com o nome do ficheiro', async () => {
    const { utilizador } = await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    await utilizador.click(await screen.findByRole('button', { name: 'Remover anexo' }));
    expect(await screen.findByText('Remover «erro.png»?')).toBeInTheDocument();
    expect(apoio.deleteAnexo).not.toHaveBeenCalled();
  });

  it('confirmar remove mesmo o anexo', async () => {
    const { utilizador } = await comTicket({ _anexos: [anexo({ id: 9, nome: 'erro.png', content_type: 'image/png' })] });
    await utilizador.click(await screen.findByRole('button', { name: 'Remover anexo' }));
    await confirmarDialogo(utilizador);
    await waitFor(() => expect(apoio.deleteAnexo).toHaveBeenCalledWith(9));
  });

  it('recusar a remoção não apaga nada', async () => {
    const { utilizador } = await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    await utilizador.click(await screen.findByRole('button', { name: 'Remover anexo' }));
    await recusarDialogo(utilizador);
    await waitFor(() => expect(screen.queryByText('Remover «erro.png»?')).not.toBeInTheDocument());
    expect(apoio.deleteAnexo).not.toHaveBeenCalled();
  });

  it('em modo leitura não há botões de remover anexos', async () => {
    const t = ticket();
    apoio.list.mockResolvedValue({ tickets: [t] });
    apoio.get.mockResolvedValue({ ticket: t, anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })], log: [] });
    const { utilizador } = montar();
    await screen.findByRole('button', { name: 'Novo ticket' });
    await abrirLeitura(utilizador);
    await screen.findByAltText('erro.png');
    expect(screen.queryByRole('button', { name: 'Remover anexo' })).not.toBeInTheDocument();
  });

  it('ficheiro grande demais: mostra o erro do servidor e não perde o ticket', async () => {
    const { utilizador } = await comTicket({});
    apoio.uploadAnexo.mockRejectedValue(new Error('ficheiro demasiado grande (máx 20 MB)'));
    await utilizador.upload(inputFicheiro(ROT_PEDIDO), png('enorme.png'));
    expect(await screen.findByText(/Erro no anexo: ficheiro demasiado grande \(máx 20 MB\)/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('num ticket novo os prints ficam pendentes até guardar', async () => {
    await novoTicket();
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    expect(await screen.findByAltText('erro.png')).toBeInTheDocument();
    expect(apoio.uploadAnexo).not.toHaveBeenCalled();
  });

  it('os pendentes sobem depois de o ticket ser criado', async () => {
    const { utilizador } = await novoTicket();
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await screen.findByAltText('erro.png');
    await utilizador.type(campo.titulo(), 'Com print');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledWith(
      'AT-2026-009', expect.any(File), { tipo: 'print_abertura', nome: 'erro.png' },
    ));
  });

  it('um pendente pode ser removido antes de guardar', async () => {
    const { utilizador } = await novoTicket();
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await screen.findByAltText('erro.png');
    await utilizador.click(screen.getByRole('button', { name: 'Remover' }));
    expect(screen.queryByAltText('erro.png')).not.toBeInTheDocument();
  });

  it('remover um pendente não pergunta nada (ainda não está guardado)', async () => {
    const { utilizador } = await novoTicket();
    colar(zona(ROT_PEDIDO), [png('erro.png')]);
    await screen.findByAltText('erro.png');
    await utilizador.click(screen.getByRole('button', { name: 'Remover' }));
    expect(screen.queryByText(/Remover «/)).not.toBeInTheDocument();
  });
});

/* ═══════════════════════ 9. GRAVAÇÃO DE VOZ (Whisper) ════════════════════ */

describe('ditar por voz', () => {
  let paragem;

  class FakeMediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, opts) {
      this.stream = stream;
      this.mimeType = opts?.mimeType || 'audio/webm';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }

  beforeEach(() => {
    paragem = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true, writable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: paragem }] }) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  it('há um botão para ditar por voz', async () => {
    await comTicket({});
    expect(within(dlg()).getByRole('button', { name: /Ditar por voz/ })).toBeInTheDocument();
  });

  it('gravar pede o microfone', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('a gravar mostra o cronómetro e o botão de parar', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    expect(await screen.findByText(/A gravar 00:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Parar/ })).toBeInTheDocument();
  });

  it('parar envia o áudio para transcrição', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(apoio.transcrever).toHaveBeenCalled());
  });

  it('o texto ditado junta-se à descrição', async () => {
    const { utilizador } = await comTicket({ descricao: '' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(campo.descricao()).toHaveValue('texto ditado'));
  });

  it('o texto ditado não apaga a descrição que já lá estava', async () => {
    const { utilizador } = await comTicket({ descricao: 'primeira linha' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(campo.descricao()).toHaveValue('primeira linha\n\ntexto ditado'));
  });

  it('o áudio fica guardado como anexo do ticket', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalledWith(
      'AT-2026-001', expect.any(File), expect.objectContaining({ tipo: 'audio' }),
    ));
  });

  it('a transcrição fica colada ao anexo de áudio', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(apoio.setTranscricao).toHaveBeenCalledWith(77, 'texto ditado'));
  });

  it('avisa que a fala foi transcrita', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    expect(await screen.findByText('Fala transcrita e adicionada à descrição.')).toBeInTheDocument();
  });

  it('larga o microfone no fim', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(paragem).toHaveBeenCalled());
  });

  it('sem microfone explica o problema em vez de falhar em silêncio', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('Permission denied'));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    expect(await screen.findByText(/Não foi possível aceder ao microfone: Permission denied/)).toBeInTheDocument();
  });

  it('transcrição falhada avisa mas guarda o áudio na mesma', async () => {
    apoio.transcrever.mockRejectedValue(new Error('IA indisponível'));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    expect(await screen.findByText(/Transcrição falhou \(IA indisponível\)/)).toBeInTheDocument();
    await waitFor(() => expect(apoio.uploadAnexo).toHaveBeenCalled());
  });

  it('em modo leitura não se pode ditar', async () => {
    const t = ticket();
    apoio.list.mockResolvedValue({ tickets: [t] });
    apoio.get.mockResolvedValue({ ticket: t, anexos: [], log: [] });
    const { utilizador } = montar();
    await screen.findByRole('button', { name: 'Novo ticket' });
    await abrirLeitura(utilizador);
    expect(screen.queryByRole('button', { name: /Ditar por voz/ })).not.toBeInTheDocument();
  });

  // BUG: Apoio.jsx:530 — a zona de anexos só desenha `pend.print_abertura` e
  // `pend.anexo`. Num ticket AINDA POR CRIAR, o áudio ditado vai para `pend.audio`
  // e não aparece em lado nenhum: a Dra. não vê que a gravação ficou anexada
  // (só a transcrição entra na descrição). Devia aparecer na zona do pedido,
  // como aparece depois de o ticket existir.
  it('o áudio ditado num ticket novo fica visível na zona de anexos', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(screen.getByRole('button', { name: /Ditar por voz/ }));
    await utilizador.click(await screen.findByRole('button', { name: /Parar/ }));
    await waitFor(() => expect(campo.descricao()).toHaveValue('texto ditado'));
    expect(within(zona(ROT_PEDIDO)).getByText(/gravacao-/)).toBeInTheDocument();
  });
});

/* ═════════════════════════ 10. ESTADOS DE ERRO DA API ════════════════════ */

describe('erros da API', () => {
  it('falha ao carregar a lista mostra a mensagem do servidor', async () => {
    apoio.list.mockRejectedValue(new Error('Sessão expirada'));
    montar();
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
  });

  it('falha ao carregar a lista não deixa o esqueleto para sempre', async () => {
    apoio.list.mockRejectedValue(new Error('HTTP 500'));
    montar();
    await screen.findByText('HTTP 500');
    expect(screen.queryByLabelText('A carregar')).not.toBeInTheDocument();
  });

  it('falha ao carregar o ticket explica e fecha o modal', async () => {
    apoio.get.mockRejectedValue(new Error('HTTP 404'));
    const { utilizador } = await montarCom([ticket()]);
    await utilizador.click(within(linhaDe('AT-2026-001')).getByRole('button', { name: 'Abrir' }));
    expect(await screen.findByText(/Erro ao carregar o ticket: HTTP 404/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('falha ao carregar o ticket deixa a lista de pé', async () => {
    apoio.get.mockRejectedValue(new Error('HTTP 404'));
    const { utilizador } = await montarCom([ticket()]);
    await utilizador.click(within(linhaDe('AT-2026-001')).getByRole('button', { name: 'Abrir' }));
    await screen.findByText(/Erro ao carregar o ticket/);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('falha ao criar mostra o erro e mantém o modal aberto', async () => {
    apoio.create.mockRejectedValue(new Error('titulo obrigatório'));
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'x');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Erro ao guardar: titulo obrigatório/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('falha ao criar não perde o que já estava escrito', async () => {
    apoio.create.mockRejectedValue(new Error('boom'));
    const { utilizador } = await novoTicket();
    await utilizador.type(campo.titulo(), 'texto importante');
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Erro ao guardar: boom/);
    expect(campo.titulo()).toHaveValue('texto importante');
  });

  it('falha ao gravar mostra o erro', async () => {
    apoio.update.mockRejectedValue(new Error('HTTP 500'));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Erro ao guardar: HTTP 500/)).toBeInTheDocument();
  });

  it('falha ao gravar volta a ligar os botões', async () => {
    apoio.update.mockRejectedValue(new Error('HTTP 500'));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Erro ao guardar/);
    expect(within(rodape()).getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('falha na análise da IA explica o problema', async () => {
    apoio.analisar.mockRejectedValue(new Error('sem créditos na Gemini'));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(dlg()).getByRole('button', { name: /Analisar com IA/ }));
    expect(await screen.findByText(/Erro na análise: sem créditos na Gemini/)).toBeInTheDocument();
  });

  it('falha ao executar explica o problema', async () => {
    apoio.executar.mockRejectedValue(new Error('ticket fechado'));
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Efetuar Alteração/ }));
    await confirmarDialogo(utilizador);
    expect(await screen.findByText(/Erro: ticket fechado/)).toBeInTheDocument();
  });

  it('falha ao enviar para aprovação diz que o e-mail não saiu', async () => {
    apoio.aprovar.mockRejectedValue(new Error('falha no envio do e-mail'));
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    await confirmarDialogo(utilizador);
    expect(await screen.findByText(/Erro ao enviar para aprovação: falha no envio do e-mail/)).toBeInTheDocument();
  });

  it('falha ao enviar para aprovação não fecha o ticket nem o deixa em branco', async () => {
    apoio.aprovar.mockRejectedValue(new Error('502'));
    const { utilizador } = await comTicket({ status: 'em_aprovacao' });
    await utilizador.click(within(dlg()).getByRole('button', { name: /Enviar para Aprovação/ }));
    await confirmarDialogo(utilizador);
    await screen.findByText(/Erro ao enviar para aprovação/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(campo.titulo()).toHaveValue('Erro ao gerar o PDF do plano de pagamento');
  });

  it('falha ao mudar o status explica o problema', async () => {
    apoio.update.mockRejectedValue(new Error('status inválido'));
    const { utilizador } = await comTicket({ status: 'aberto' });
    await utilizador.click(within(dlg()).getByRole('button', { name: 'Resolvido' }));
    expect(await screen.findByText(/Erro: status inválido/)).toBeInTheDocument();
  });

  it('falha ao remover um anexo explica o problema', async () => {
    apoio.deleteAnexo.mockRejectedValue(new Error('anexo inexistente'));
    const { utilizador } = await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    await utilizador.click(await screen.findByRole('button', { name: 'Remover anexo' }));
    await confirmarDialogo(utilizador);
    expect(await screen.findByText(/Erro: anexo inexistente/)).toBeInTheDocument();
  });

  it('anexo que não descarrega não parte o modal', async () => {
    apoio.anexoObjectUrl.mockRejectedValue(new Error('HTTP 404'));
    await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    await waitFor(() => expect(apoio.anexoObjectUrl).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(campo.titulo()).toBeInTheDocument();
  });

  it('erro sem mensagem não mostra «undefined» à Dra.', async () => {
    apoio.update.mockRejectedValue(new Error(''));
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Erro ao guardar:/)).not.toHaveTextContent('undefined');
  });
});

/* ═══════════════════════════ 11. ACESSIBILIDADE ══════════════════════════ */

describe('acessibilidade', () => {
  it('o modal anuncia-se como diálogo modal', async () => {
    await novoTicket();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('o botão de fechar tem nome acessível', async () => {
    await novoTicket();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('o seletor de autor tem etiqueta', async () => {
    await novoTicket();
    expect(screen.getByRole('button', { name: 'Criado por' })).toBeInTheDocument();
  });

  it('o menu de autor anuncia-se como lista de opções', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(screen.getByRole('button', { name: 'Criado por' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('a opção escolhida está marcada como selecionada', async () => {
    const { utilizador } = await novoTicket();
    await utilizador.click(screen.getByRole('button', { name: 'Criado por' }));
    expect(screen.getByRole('option', { name: 'Victor' })).toHaveAttribute('aria-selected', 'true');
  });

  it('o botão de remover anexo diz o que faz', async () => {
    await comTicket({ _anexos: [anexo({ nome: 'erro.png', content_type: 'image/png' })] });
    expect(await screen.findByRole('button', { name: 'Remover anexo' })).toHaveAccessibleName();
  });

  it('todos os botões do rodapé têm nome acessível', async () => {
    await comTicket({ status: 'em_aprovacao' });
    for (const b of within(rodape()).getAllByRole('button')) expect(b).toHaveAccessibleName();
  });

  it('o botão do histórico diz se está aberto ou fechado', async () => {
    await comTicket({ _log: [evento()] });
    expect(screen.getByText('Histórico (1)').closest('button')).toHaveAttribute('aria-expanded');
  });

  it('a tabela de tickets é uma tabela a sério (leitores de ecrã)', async () => {
    await montarCom([ticket()]);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
  });

  it('o botão de criar ticket tem nome acessível', async () => {
    await montarCom([]);
    expect(screen.getByRole('button', { name: 'Novo ticket' })).toHaveAccessibleName();
  });

  it('os avisos aparecem numa região anunciada (role=status)', async () => {
    const { utilizador } = await comTicket({});
    await utilizador.click(within(rodape()).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Alterações guardadas.');
    expect(screen.getByRole('status')).toHaveTextContent('Alterações guardadas.');
  });

  // BUG: Apoio.jsx:495-497 (e os restantes campos do modal) — o rótulo é um
  // <span> solto, não um <label htmlFor> nem um aria-label. Um leitor de ecrã
  // (e a Dra. com lupa/teclado) não sabe a que campo pertence «Título do pedido».
  // Devia ser possível chegar ao campo por getByLabelText('Título do pedido *').
  it('o campo Título tem etiqueta associada', async () => {
    await novoTicket();
    expect(screen.getByLabelText(/Título do pedido/)).toBeInTheDocument();
  });

  // BUG: Apoio.jsx:695 — a caixa de pesquisa da lista só tem placeholder,
  // que desaparece assim que se escreve; não tem etiqueta nem aria-label.
  it('a caixa de pesquisa tem etiqueta', async () => {
    await montarCom([ticket()]);
    expect(screen.getByLabelText(/Pesquisar/)).toBeInTheDocument();
  });

  // BUG: Apoio.jsx:744-746 — o botão do lápis (editar ticket) só tem um <svg>
  // aria-hidden e um data-tip; fica sem nome acessível nenhum. Devia ter
  // aria-label="Editar o ticket" (o data-tip só serve o rato).
  it('o botão de editar da linha tem nome acessível', async () => {
    await montarCom([ticket()]);
    expect(within(linhaDe('AT-2026-001')).getAllByRole('button')[1]).toHaveAccessibleName();
  });
});
