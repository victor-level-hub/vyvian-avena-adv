// @vitest-environment jsdom
// tests/admin/novo-cliente.test.jsx
// Ecrã de cadastro de cliente (src/admin/pages/NewClient.jsx) e os editores que
// ele usa: ContactsEditor, AddressEditor, PersonFields.
// É o ecrã com mais campos da Área Privada — se algo aqui partir, a Dra. perde
// o cadastro todo. Testa-se o que ela vê: rótulos, botões, abas e mensagens.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { renderizar, screen, within, waitFor } from '../helpers/dom.jsx';

// ─── espia da navegação ──────────────────────────────────────────────────────
const { navegou } = vi.hoisted(() => ({ navegou: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navegou };
});

// ─── API mockada (a rede está fechada em tests/setup.js) ─────────────────────
const api = vi.hoisted(() => ({
  criarCliente: vi.fn(),
  criarRegra: vi.fn(),
  listarParcelas: vi.fn(),
}));
vi.mock('../../src/admin/apiClient.js', () => ({
  clients: {
    create: api.criarCliente,
    list: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(),
  },
  installments: { create: vi.fn(), list: api.listarParcelas },
  notifications: { createRule: api.criarRegra },
  getToken: () => 'tok', setToken: vi.fn(), clearToken: vi.fn(),
}));

import NewClient from '../../src/admin/pages/NewClient.jsx';
import ContactsEditor, { cleanContacts, parseContacts } from '../../src/admin/ContactsEditor.jsx';
import AddressEditor, { EMPTY_ADDRESS, composeAddress, hasAddress, parseAddressParts } from '../../src/admin/AddressEditor.jsx';
import PersonFields, { PersonPills, EMPTY_PERSON, personHasData } from '../../src/admin/PersonFields.jsx';
import { gerarParcelas, somaParcelas, parseValor, addMonthsISO } from '../../src/admin/ParcelasEditor.jsx';

// ─── utilitários ─────────────────────────────────────────────────────────────
beforeAll(() => {
  // jsdom não implementa scrollIntoView e o focusField do ecrã chama-o
  Element.prototype.scrollIntoView = function () {};
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.criarCliente.mockResolvedValue({ ok: true });
  api.criarRegra.mockResolvedValue({ ok: true });
  // o ecrã cria as parcelas com fetch direto (NewClient.jsx:509)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
});
afterEach(async () => {
  // O focusField do ecrã (NewClient.jsx:155) agenda um setTimeout(80) para pôr o
  // cursor no campo em falta. Se não o deixarmos disparar aqui, ele acorda já
  // dentro do teste seguinte e rouba o cursor a meio da escrita.
  if (document.querySelector('.adm-login-error')) {
    await new Promise((r) => setTimeout(r, 120));
  }
  vi.unstubAllGlobals();
});

const porId = (id) => document.getElementById(id);
const rotulo = (texto) => screen.getByText(texto, { selector: 'label' });
const existeRotulo = (texto) => screen.queryByText(texto, { selector: 'label' }) !== null;
const caixa = (texto) => rotulo(texto).closest('.adm-field');
const campo = (texto) => caixa(texto).querySelector('input, select, textarea');
const campoData = (texto) => caixa(texto).querySelector('.adm-date-btn');
const cartao = (titulo) => screen.getByText(titulo, { selector: '.adm-radio-card-title' });
const erro = () => document.querySelector('.adm-login-error');
const submeter = () => screen.getByRole('button', { name: /^(Criar cliente|A criar…)/ });
const modal = () => document.querySelector('.adm-overlay');

const irPara = (u, aba) => u.click(screen.getByRole('button', { name: aba }));

async function escolherData(u, botao, dia = 5) {
  await u.click(botao);
  const pop = document.querySelector('.adm-date-pop');
  await u.click(within(pop).getByRole('button', { name: String(dia) }));
}

// Preenche o mínimo aceite pela validação com plano Pro bono (sem data/valores).
async function preencherProBono(u) {
  await u.type(porId('f-name'), 'Maria Silva');
  await u.type(porId('f-email'), 'maria@exemplo.pt');
  await u.type(porId('f-phone'), '+351911222333');
  await irPara(u, 'Dados Financeiros');
  await u.click(cartao('Pro bono'));
}

// Preenche um plano parcelado completo e válido.
async function preencherParcelado(u, { total = '1200', n = '3', dia = 5 } = {}) {
  await u.type(porId('f-name'), 'Maria Silva');
  await u.type(porId('f-email'), 'maria@exemplo.pt');
  await u.type(porId('f-phone'), '+351911222333');
  await irPara(u, 'Dados Financeiros');
  await escolherData(u, porId('f-startDate'), dia);
  await u.type(porId('f-totalValue'), total);
  await u.type(porId('f-installments'), n);
}

const corposDasParcelas = () =>
  globalThis.fetch.mock.calls
    .filter(([url]) => url === '/api/installments')
    .map(([, opt]) => JSON.parse(opt.body));

// ═════════════════════════════════════════════════════════════════════════════
// cleanContacts — limpar entradas vazias antes de guardar
// ═════════════════════════════════════════════════════════════════════════════
describe('cleanContacts', () => {
  it('deita fora as entradas sem valor', () => {
    expect(cleanContacts([{ label: 'Pessoal', value: '' }])).toEqual([]);
  });

  it('mantém as que têm valor', () => {
    expect(cleanContacts([{ label: 'Pessoal', value: 'a@b.pt' }])).toEqual([{ label: 'Pessoal', value: 'a@b.pt' }]);
  });

  it('tira os espaços do valor', () => {
    expect(cleanContacts([{ label: 'Pessoal', value: '  a@b.pt  ' }])[0].value).toBe('a@b.pt');
  });

  it('só espaços conta como vazio', () => {
    expect(cleanContacts([{ label: 'Pessoal', value: '   ' }])).toEqual([]);
  });

  it('tira os espaços da etiqueta', () => {
    expect(cleanContacts([{ label: '  Empresa  ', value: 'x@y.pt' }])[0].label).toBe('Empresa');
  });

  it('etiqueta vazia recai em Pessoal', () => {
    expect(cleanContacts([{ label: '', value: 'x@y.pt' }])[0].label).toBe('Pessoal');
  });

  it('etiqueta em falta recai em Pessoal', () => {
    expect(cleanContacts([{ value: 'x@y.pt' }])[0].label).toBe('Pessoal');
  });

  it('mantém a ordem das entradas boas', () => {
    const r = cleanContacts([
      { label: 'A', value: '1' }, { label: 'B', value: '' }, { label: 'C', value: '3' },
    ]);
    expect(r.map((c) => c.value)).toEqual(['1', '3']);
  });

  it('lista vazia dá lista vazia', () => {
    expect(cleanContacts([])).toEqual([]);
  });

  it('valor nulo não rebenta', () => {
    expect(cleanContacts([{ label: 'Pessoal', value: null }])).toEqual([]);
  });
});

describe('parseContacts', () => {
  it('JSON válido devolve a lista', () => {
    expect(parseContacts('[{"label":"Empresa","value":"a@b.pt"}]')).toEqual([{ label: 'Empresa', value: 'a@b.pt' }]);
  });

  it('JSON inválido recai no valor antigo', () => {
    expect(parseContacts('não é json', 'velho@b.pt')).toEqual([{ label: 'Pessoal', value: 'velho@b.pt' }]);
  });

  it('sem nada devolve uma linha vazia', () => {
    expect(parseContacts(null)).toEqual([{ label: 'Pessoal', value: '' }]);
  });

  it('lista vazia recai no valor antigo', () => {
    expect(parseContacts('[]', 'velho@b.pt')[0].value).toBe('velho@b.pt');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// composeAddress / hasAddress — morada numa linha
// ═════════════════════════════════════════════════════════════════════════════
describe('composeAddress', () => {
  it('sem morada dá string vazia', () => expect(composeAddress(null)).toBe(''));
  it('undefined dá string vazia', () => expect(composeAddress(undefined)).toBe(''));
  it('objeto vazio dá string vazia', () => expect(composeAddress({})).toBe(''));
  // BUG: AddressEditor.jsx:20-21 — o tipo de via entra sozinho na morada quando
  // o nome da via está vazio. Uma morada só com código postal é composta como
  // "Rua, 1700-001" e aparece assim na pré-visualização e nos PDFs.
  it.fails('morada por estrear devia dar string vazia', () => {
    expect(composeAddress(EMPTY_ADDRESS)).toBe('');
  });

  it.fails('sem nome da via, o tipo de via não devia aparecer sozinho', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, cp: '1700-001' })).toBe('1700-001');
  });

  it('PT junta via, número e localizações pela ordem certa', () => {
    expect(composeAddress({
      ...EMPTY_ADDRESS, via_type: 'Rua', via_name: 'das Flores', number: '12',
      complement: '3º Dto', freguesia: 'Alvalade', concelho: 'Lisboa', distrito: 'Lisboa', cp: '1700-001',
    })).toBe('Rua das Flores, Nº 12, 3º Dto, Alvalade, Lisboa, Lisboa, 1700-001');
  });

  it('BR usa bairro, cidade - estado e CEP', () => {
    expect(composeAddress({
      ...EMPTY_ADDRESS, country: 'BR', via_type: 'Avenida', via_name: 'Paulista', number: '1000',
      bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP', cep: '01310-100',
    })).toBe('Avenida Paulista, Nº 1000, Bela Vista, São Paulo - SP, CEP 01310-100');
  });

  it('tipo de via "Outro" mostra só o que foi escrito', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, via_type: 'Outro', via_name: 'Quinta do Lago, lote 4' }))
      .toBe('Quinta do Lago, lote 4');
  });

  it('só número dá "Nº 12"', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, via_type: '', via_name: '', number: '12' })).toBe('Nº 12');
  });

  it('BR sem cidade mostra só o estado', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, country: 'BR', via_type: '', estado: 'RJ' })).toBe('RJ');
  });

  it('BR com cidade sem estado não deixa traço solto', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, country: 'BR', via_type: '', cidade: 'Recife' })).toBe('Recife');
  });

  it('PT ignora os campos brasileiros', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, via_name: 'A', bairro: 'X', cidade: 'Y' })).toBe('Rua A');
  });

  it('BR ignora os campos portugueses', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, country: 'BR', via_name: 'A', freguesia: 'X', cp: '1000' })).toBe('Rua A');
  });

  it('sem via mas com complemento mostra o complemento', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, via_type: '', complement: 'Loja 3' })).toBe('Loja 3');
  });

  it('código postal sozinho aparece', () => {
    expect(composeAddress({ ...EMPTY_ADDRESS, via_type: '', cp: '1700-001' })).toBe('1700-001');
  });
});

describe('hasAddress', () => {
  it('nada é falso', () => expect(hasAddress(null)).toBe(false));
  it('morada por estrear é falso', () => expect(hasAddress(EMPTY_ADDRESS)).toBe(false));
  it('nome da via conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, via_name: 'A' })).toBe(true));
  it('número conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, number: '3' })).toBe(true));
  it('freguesia conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, freguesia: 'Alvalade' })).toBe(true));
  it('concelho conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, concelho: 'Lisboa' })).toBe(true));
  it('código postal conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, cp: '1700-001' })).toBe(true));
  it('bairro conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, bairro: 'Botafogo' })).toBe(true));
  it('cidade conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, cidade: 'Recife' })).toBe(true));
  it('CEP conta', () => expect(hasAddress({ ...EMPTY_ADDRESS, cep: '01310-100' })).toBe(true));

  // BUG: AddressEditor.jsx:48-50 — hasAddress não olha para distrito, estado nem
  // complemento. Uma morada em que só o distrito está preenchido é tratada como
  // inexistente: o ecrã não mostra a pré-visualização e o cadastro guarda
  // address = null, perdendo o que a Dra. escreveu.
  it.fails('distrito preenchido devia contar como morada', () => {
    expect(hasAddress({ ...EMPTY_ADDRESS, distrito: 'Faro' })).toBe(true);
  });

  it.fails('estado (UF) preenchido devia contar como morada', () => {
    expect(hasAddress({ ...EMPTY_ADDRESS, country: 'BR', estado: 'SP' })).toBe(true);
  });
});

describe('parseAddressParts', () => {
  it('JSON válido reconstrói a morada', () => {
    expect(parseAddressParts('{"via_name":"das Flores"}').via_name).toBe('das Flores');
  });
  it('sem JSON mas com string antiga guarda-a como "Outro"', () => {
    const a = parseAddressParts(null, 'Rua Velha, 3');
    expect(a.via_type).toBe('Outro');
    expect(a.via_name).toBe('Rua Velha, 3');
  });
  it('sem nada devolve a morada vazia', () => {
    expect(parseAddressParts(null, null)).toEqual({ ...EMPTY_ADDRESS });
  });
  it('respeita o país de origem', () => {
    expect(parseAddressParts(null, null, 'BR').country).toBe('BR');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// personHasData
// ═════════════════════════════════════════════════════════════════════════════
describe('personHasData', () => {
  const semMorada = { ...EMPTY_PERSON, addrParts: {} };

  it('pessoa completamente vazia não tem dados', () => {
    expect(personHasData(semMorada)).toBe(false);
  });
  it('só o nome não conta como dados', () => {
    expect(personHasData({ ...semMorada, name: 'João' })).toBe(false);
  });
  it('identificação conta', () => expect(personHasData({ ...semMorada, identification: '123' })).toBe(true));
  it('nacionalidade conta', () => expect(personHasData({ ...semMorada, nationality: 'portuguesa' })).toBe(true));
  it('estado civil conta', () => expect(personHasData({ ...semMorada, marital_status: 'casado(a)' })).toBe(true));
  it('data de nascimento conta', () => expect(personHasData({ ...semMorada, birth_date: '1990-01-01' })).toBe(true));
  it('nº do documento conta', () => expect(personHasData({ ...semMorada, doc_number: 'X1' })).toBe(true));
  it('nome do pai conta', () => expect(personHasData({ ...semMorada, father_name: 'Zé' })).toBe(true));
  it('só espaços não conta', () => expect(personHasData({ ...semMorada, rg: '   ' })).toBe(false));
  it('morada preenchida conta', () => {
    expect(personHasData({ ...semMorada, addrParts: { country: 'PT', via_name: 'das Flores' } })).toBe(true);
  });
  it('só o país da morada não conta', () => {
    expect(personHasData({ ...semMorada, addrParts: { country: 'BR' } })).toBe(false);
  });

  // BUG: PersonFields.jsx:37-42 — personHasData olha para todas as chaves de
  // addrParts menos country, e o EMPTY_ADDRESS traz via_type: 'Rua' por omissão.
  // Uma pessoa acabada de adicionar e nunca tocada é dada como tendo dados.
  it.fails('pessoa acabada de adicionar (EMPTY_PERSON) não tem dados', () => {
    expect(personHasData({ ...EMPTY_PERSON })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AddressEditor
// ═════════════════════════════════════════════════════════════════════════════
describe('AddressEditor', () => {
  function Morada({ inicial = { ...EMPTY_ADDRESS }, ...resto }) {
    const [a, setA] = useState(inicial);
    return <AddressEditor label="Morada / Endereço" value={a} onChange={setA} {...resto} />;
  }
  const box = () => rotulo('Morada / Endereço').closest('.adm-field');
  const pais = () => within(box()).getAllByRole('combobox')[0];
  const via = () => within(box()).getAllByRole('combobox')[1];

  it('mostra o rótulo que lhe passam', () => {
    renderizar(<Morada />);
    expect(rotulo('Morada / Endereço')).toBeInTheDocument();
  });

  it('começa em Portugal', () => {
    renderizar(<Morada />);
    expect(pais()).toHaveValue('PT');
  });

  it('em Portugal mostra freguesia, concelho, distrito e código postal', () => {
    renderizar(<Morada />);
    for (const p of ['Freguesia', 'Concelho', 'Distrito', 'Código Postal']) {
      expect(within(box()).getByPlaceholderText(p)).toBeInTheDocument();
    }
  });

  it('em Portugal não mostra os campos brasileiros', () => {
    renderizar(<Morada />);
    for (const p of ['Bairro', 'Cidade', 'Estado (UF)', 'CEP']) {
      expect(within(box()).queryByPlaceholderText(p)).not.toBeInTheDocument();
    }
  });

  it('trocar para o Brasil mostra bairro, cidade, estado e CEP', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.selectOptions(pais(), 'BR');
    for (const p of ['Bairro', 'Cidade', 'Estado (UF)', 'CEP']) {
      expect(within(box()).getByPlaceholderText(p)).toBeInTheDocument();
    }
  });

  it('trocar para o Brasil esconde os campos portugueses', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.selectOptions(pais(), 'BR');
    for (const p of ['Freguesia', 'Concelho', 'Distrito', 'Código Postal']) {
      expect(within(box()).queryByPlaceholderText(p)).not.toBeInTheDocument();
    }
  });

  it('voltar a Portugal traz de volta os campos portugueses', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.selectOptions(pais(), 'BR');
    await utilizador.selectOptions(pais(), 'PT');
    expect(within(box()).getByPlaceholderText('Freguesia')).toBeInTheDocument();
  });

  it('a lista de tipos de via muda com o país (Rodovia só no Brasil)', async () => {
    const { utilizador } = renderizar(<Morada />);
    expect(within(via()).queryByRole('option', { name: 'Rodovia' })).not.toBeInTheDocument();
    await utilizador.selectOptions(pais(), 'BR');
    expect(within(via()).getByRole('option', { name: 'Rodovia' })).toBeInTheDocument();
  });

  it('Urbanização existe em Portugal e não no Brasil', async () => {
    const { utilizador } = renderizar(<Morada />);
    expect(within(via()).getByRole('option', { name: 'Urbanização' })).toBeInTheDocument();
    await utilizador.selectOptions(pais(), 'BR');
    expect(within(via()).queryByRole('option', { name: 'Urbanização' })).not.toBeInTheDocument();
  });

  it('escrever o nome da via mostra a morada composta numa linha', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.type(within(box()).getByPlaceholderText('Nome da via'), 'das Flores');
    expect(within(box()).getByText(/Rua das Flores/)).toBeInTheDocument();
  });

  it('a linha composta acompanha o número', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.type(within(box()).getByPlaceholderText('Nome da via'), 'das Flores');
    await utilizador.type(within(box()).getByPlaceholderText('Número'), '12');
    expect(within(box()).getByText(/Rua das Flores, Nº 12/)).toBeInTheDocument();
  });

  it('morada vazia não mostra a linha composta', () => {
    renderizar(<Morada />);
    expect(box().querySelector('.adm-field-helper')).toBeNull();
  });

  it('tipo de via "Outro" muda o texto de ajuda do campo do nome', async () => {
    const { utilizador } = renderizar(<Morada />);
    await utilizador.selectOptions(via(), 'Outro');
    expect(within(box()).getByPlaceholderText('Morada')).toBeInTheDocument();
  });

  it('tipo de via desconhecido cai em "Outro"', () => {
    renderizar(<Morada inicial={{ ...EMPTY_ADDRESS, via_type: 'Viela' }} />);
    expect(via()).toHaveValue('Outro');
  });

  it('desativado bloqueia todos os campos', () => {
    renderizar(<Morada disabled />);
    for (const el of box().querySelectorAll('input, select')) expect(el).toBeDisabled();
  });

  it('sem valor não rebenta e usa a morada vazia', () => {
    renderizar(<AddressEditor label="Morada / Endereço" value={null} onChange={() => {}} />);
    expect(pais()).toHaveValue('PT');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ContactsEditor
// ═════════════════════════════════════════════════════════════════════════════
describe('ContactsEditor', () => {
  function Contactos({ kind = 'email', inicial = [{ label: 'Pessoal', value: '' }], ...resto }) {
    const [items, setItems] = useState(inicial);
    return <ContactsEditor kind={kind} items={items} onChange={setItems} inputId="c0" {...resto} />;
  }
  const linhas = () => document.querySelectorAll('.adm-input-wrap');

  it('e-mails têm o rótulo E-mails', () => {
    renderizar(<Contactos />);
    expect(screen.getByText('E-mails')).toBeInTheDocument();
  });

  it('telefones dizem que servem para WhatsApp', () => {
    renderizar(<Contactos kind="phone" />);
    expect(screen.getByText('Telefones (WhatsApp)')).toBeInTheDocument();
  });

  it('começa com uma linha', () => {
    renderizar(<Contactos />);
    expect(linhas()).toHaveLength(1);
  });

  it('acrescentar e-mail cria uma linha nova', async () => {
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    expect(linhas()).toHaveLength(2);
  });

  it('acrescentar telefone diz "adicionar telefone"', () => {
    renderizar(<Contactos kind="phone" />);
    expect(screen.getByRole('button', { name: /adicionar telefone/ })).toBeInTheDocument();
  });

  it('com uma só linha não há botão de remover', () => {
    renderizar(<Contactos />);
    expect(screen.queryByTitle('Remover')).not.toBeInTheDocument();
  });

  it('com duas linhas aparecem os botões de remover', async () => {
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    expect(screen.getAllByTitle('Remover')).toHaveLength(2);
  });

  it('remover tira a linha certa', async () => {
    const { utilizador } = renderizar(<Contactos inicial={[
      { label: 'Pessoal', value: 'um@x.pt' },
      { label: 'Empresa', value: 'dois@x.pt' },
    ]} />);
    await utilizador.click(screen.getAllByTitle('Remover')[0]);
    expect(screen.getByDisplayValue('dois@x.pt')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('um@x.pt')).not.toBeInTheDocument();
  });

  it('remover até sobrar uma esconde outra vez os botões', async () => {
    const { utilizador } = renderizar(<Contactos inicial={[
      { label: 'Pessoal', value: 'a@x.pt' }, { label: 'Empresa', value: 'b@x.pt' },
    ]} />);
    await utilizador.click(screen.getAllByTitle('Remover')[0]);
    expect(screen.queryByTitle('Remover')).not.toBeInTheDocument();
  });

  it('deixa escrever o e-mail', async () => {
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.type(porId('c0'), 'maria@exemplo.pt');
    expect(porId('c0')).toHaveValue('maria@exemplo.pt');
  });

  it('o primeiro campo recebe o id que lhe passam (para o foco na validação)', () => {
    renderizar(<Contactos inicial={[{ label: 'Pessoal', value: '' }, { label: 'Empresa', value: '' }]} />);
    const inputs = document.querySelectorAll('.adm-in-icon');
    expect(inputs[0]).toHaveAttribute('id', 'c0');
    expect(inputs[1]).not.toHaveAttribute('id');
  });

  it('e-mails usam o teclado de e-mail', () => {
    renderizar(<Contactos />);
    expect(porId('c0')).toHaveAttribute('type', 'email');
  });

  it('telefones usam o teclado de telefone', () => {
    renderizar(<Contactos kind="phone" />);
    expect(porId('c0')).toHaveAttribute('type', 'tel');
  });

  it('as etiquetas predefinidas estão todas disponíveis', () => {
    renderizar(<Contactos />);
    const sel = screen.getAllByRole('combobox')[0];
    for (const l of ['Pessoal', 'Empresa', 'Responsável', 'Sócio-gerente', 'Financeiro', 'Trabalho', 'Outro']) {
      expect(within(sel).getByRole('option', { name: l })).toBeInTheDocument();
    }
  });

  it('mudar a etiqueta guarda-a na linha', async () => {
    const { utilizador } = renderizar(<Contactos />);
    const sel = screen.getAllByRole('combobox')[0];
    await utilizador.selectOptions(sel, 'Financeiro');
    expect(sel).toHaveValue('Financeiro');
  });

  it('etiqueta vinda do servidor que não está na lista continua a aparecer', () => {
    renderizar(<Contactos inicial={[{ label: 'Contabilista', value: 'c@x.pt' }]} />);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('Contabilista');
  });

  it('nova etiqueta escrita pela utilizadora fica na linha', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Contabilista');
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.selectOptions(screen.getAllByRole('combobox')[0], '__nova__');
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('Contabilista'));
  });

  it('nova etiqueta fica guardada para a próxima vez', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Contabilista');
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.selectOptions(screen.getAllByRole('combobox')[0], '__nova__');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vyvian_contact_labels'))).toContain('Contabilista'));
  });

  it('cancelar a nova etiqueta não mexe na linha', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.selectOptions(screen.getAllByRole('combobox')[0], '__nova__');
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('Pessoal'));
  });

  it('etiqueta nova só com espaços é ignorada', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const { utilizador } = renderizar(<Contactos />);
    await utilizador.selectOptions(screen.getAllByRole('combobox')[0], '__nova__');
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('Pessoal'));
  });

  it('requiredFirst marca o rótulo com asterisco', () => {
    renderizar(<Contactos requiredFirst />);
    expect(screen.getByText(/E-mails\s*\*/)).toBeInTheDocument();
  });

  it('invalid escreve "obrigatório" ao lado do rótulo', () => {
    renderizar(<Contactos invalid />);
    expect(screen.getByText(/obrigatório/)).toBeInTheDocument();
  });

  it('invalid pinta o primeiro campo de vermelho', () => {
    renderizar(<Contactos invalid inicial={[{ label: 'Pessoal', value: '' }, { label: 'Empresa', value: '' }]} />);
    const inputs = document.querySelectorAll('.adm-in-icon');
    expect(inputs[0]).toHaveStyle({ borderColor: '#c00000' });
    expect(inputs[1]).not.toHaveStyle({ borderColor: '#c00000' });
  });

  it('desativado bloqueia campos, etiquetas e botões', () => {
    renderizar(<Contactos disabled inicial={[{ label: 'Pessoal', value: 'a@x.pt' }, { label: 'Empresa', value: 'b@x.pt' }]} />);
    for (const el of document.querySelectorAll('input, select, button')) expect(el).toBeDisabled();
  });

  it('a linha acrescentada nasce vazia e com etiqueta Pessoal', async () => {
    const { utilizador } = renderizar(<Contactos inicial={[{ label: 'Empresa', value: 'a@x.pt' }]} />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    const sels = screen.getAllByRole('combobox');
    expect(sels[1]).toHaveValue('Pessoal');
    expect(document.querySelectorAll('.adm-in-icon')[1]).toHaveValue('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PersonFields
// ═════════════════════════════════════════════════════════════════════════════
describe('PersonFields', () => {
  function Pessoa({ inicial = { ...EMPTY_PERSON }, country = 'PT', ...resto }) {
    const [p, setP] = useState(inicial);
    return <div className="adm-form-grid"><PersonFields value={p} onChange={setP} country={country} {...resto} /></div>;
  }

  it('o nome é o único campo marcado como obrigatório', () => {
    renderizar(<Pessoa />);
    expect(screen.getByText('Nome completo *')).toBeInTheDocument();
  });

  it('deixa escrever o nome', async () => {
    const { utilizador } = renderizar(<Pessoa />);
    await utilizador.type(screen.getByLabelText('Nome completo *'), 'João Silva');
    expect(screen.getByLabelText('Nome completo *')).toHaveValue('João Silva');
  });

  it('em Portugal pede NIF', () => {
    renderizar(<Pessoa />);
    expect(screen.getByText('NIF')).toBeInTheDocument();
  });

  it('no Brasil pede CPF', () => {
    renderizar(<Pessoa country="BR" />);
    expect(screen.getByText('CPF')).toBeInTheDocument();
  });

  it('em Portugal mostra NISS e não RG', () => {
    renderizar(<Pessoa />);
    expect(screen.getByText('NISS (opcional)')).toBeInTheDocument();
    expect(screen.queryByText('RG')).not.toBeInTheDocument();
  });

  it('no Brasil mostra RG e não NISS', () => {
    renderizar(<Pessoa country="BR" />);
    expect(screen.getByText('RG')).toBeInTheDocument();
    expect(screen.queryByText('NISS (opcional)')).not.toBeInTheDocument();
  });

  it('o estado civil tem as cinco opções', async () => {
    renderizar(<Pessoa />);
    const sel = screen.getByLabelText('Estado civil');
    for (const o of ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável / convivente']) {
      expect(within(sel).getByRole('option', { name: o })).toBeInTheDocument();
    }
  });

  it('escolher o estado civil guarda o valor', async () => {
    const { utilizador } = renderizar(<Pessoa />);
    await utilizador.selectOptions(screen.getByLabelText('Estado civil'), 'casado(a)');
    expect(screen.getByLabelText('Estado civil')).toHaveValue('casado(a)');
  });

  it('o tipo de documento tem os quatro tipos aceites', () => {
    renderizar(<Pessoa />);
    const sel = screen.getByLabelText('Tipo de documento');
    for (const o of ['Título de Residência', 'Cartão de Cidadão', 'Passaporte', 'BI / RG']) {
      expect(within(sel).getByRole('option', { name: o })).toBeInTheDocument();
    }
  });

  it('traz a morada da pessoa', () => {
    renderizar(<Pessoa />);
    expect(screen.getByText('Morada / Endereço')).toBeInTheDocument();
  });

  it('a morada da pessoa é independente', async () => {
    const { utilizador } = renderizar(<Pessoa />);
    await utilizador.type(screen.getByPlaceholderText('Nome da via'), 'do Ouro');
    expect(screen.getByText(/Rua do Ouro/)).toBeInTheDocument();
  });

  it('mostra os valores que já vêm preenchidos', () => {
    renderizar(<Pessoa inicial={{ ...EMPTY_PERSON, name: 'Ana', identification: '123 456 789' }} />);
    expect(screen.getByLabelText('Nome completo *')).toHaveValue('Ana');
    expect(screen.getByLabelText('NIF')).toHaveValue('123 456 789');
  });

  it('desativado bloqueia tudo', () => {
    renderizar(<Pessoa disabled />);
    for (const el of document.querySelectorAll('input, select')) expect(el).toBeDisabled();
  });
});

describe('PersonPills', () => {
  it('mostra uma pílula por pessoa', () => {
    renderizar(<PersonPills names={['Ana', 'Bruno']} active={0} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bruno' })).toBeInTheDocument();
  });

  it('pessoa sem nome fica "Pessoa N"', () => {
    renderizar(<PersonPills names={['Ana', '']} active={0} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pessoa 2' })).toBeInTheDocument();
  });

  it('clicar avisa qual foi escolhida', async () => {
    const onSelect = vi.fn();
    const { utilizador } = renderizar(<PersonPills names={['Ana', 'Bruno']} active={0} onSelect={onSelect} />);
    await utilizador.click(screen.getByRole('button', { name: 'Bruno' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('o botão de adicionar só existe quando há onAdd', () => {
    const { rerender } = renderizar(<PersonPills names={['Ana']} active={0} onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: /Adicionar pessoa/ })).not.toBeInTheDocument();
    rerender(<PersonPills names={['Ana']} active={0} onSelect={() => {}} onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: /Adicionar pessoa/ })).toBeInTheDocument();
  });

  it('as pílulas não submetem o formulário à volta', () => {
    renderizar(<PersonPills names={['Ana']} active={0} onSelect={() => {}} onAdd={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('type', 'button');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — separadores
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — separadores', () => {
  it('abre no separador do Cliente', () => {
    renderizar(<NewClient />);
    expect(existeRotulo('Nome completo')).toBe(true);
  });

  it('tem os três separadores', () => {
    renderizar(<NewClient />);
    for (const t of ['Dados do Cliente', 'Dados do Processo', 'Dados Financeiros']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
  });

  it('ir para o Processo mostra o resumo e esconde os dados pessoais', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados do Processo');
    expect(existeRotulo('Resumo do processo')).toBe(true);
    expect(existeRotulo('Nome completo')).toBe(false);
  });

  it('ir para o Financeiro mostra o tipo de plano', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(existeRotulo('Tipo de plano')).toBe(true);
  });

  it('o nome escrito sobrevive a passear pelos separadores', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await irPara(utilizador, 'Dados do Processo');
    await irPara(utilizador, 'Dados Financeiros');
    await irPara(utilizador, 'Dados do Cliente');
    expect(porId('f-name')).toHaveValue('Maria Silva');
  });

  it('o resumo do processo sobrevive a mudar de separador', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados do Processo');
    await utilizador.type(campo('Resumo do processo'), 'Divórcio consensual');
    await irPara(utilizador, 'Dados do Cliente');
    await irPara(utilizador, 'Dados do Processo');
    expect(campo('Resumo do processo')).toHaveValue('Divórcio consensual');
  });

  it('o valor total sobrevive a mudar de separador', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.type(porId('f-totalValue'), '3120');
    await irPara(utilizador, 'Dados do Cliente');
    await irPara(utilizador, 'Dados Financeiros');
    expect(porId('f-totalValue')).toHaveValue('3120');
  });

  it('os contactos escritos sobrevivem a mudar de separador', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await irPara(utilizador, 'Dados Financeiros');
    await irPara(utilizador, 'Dados do Cliente');
    expect(porId('f-email')).toHaveValue('maria@exemplo.pt');
  });

  it('o separador ativo fica marcado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(screen.getByRole('button', { name: 'Dados Financeiros' })).toHaveAttribute('data-tab-active', '1');
  });

  it('os botões dos separadores não submetem o formulário', () => {
    renderizar(<NewClient />);
    for (const t of ['Dados do Cliente', 'Dados do Processo', 'Dados Financeiros']) {
      expect(screen.getByRole('button', { name: t })).toHaveAttribute('type', 'button');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — pessoa singular vs coletiva
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — pessoa singular vs coletiva', () => {
  const paraColetiva = (u) => u.selectOptions(campo('Tipo de cliente'), 'coletiva');
  const paraSingular = (u) => u.selectOptions(campo('Tipo de cliente'), 'singular');

  it('começa em pessoa singular', () => {
    renderizar(<NewClient />);
    expect(campo('Tipo de cliente')).toHaveValue('singular');
  });

  it('singular pede o nome completo', () => {
    renderizar(<NewClient />);
    expect(existeRotulo('Nome completo')).toBe(true);
  });

  it('coletiva pede a denominação da empresa', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    expect(existeRotulo('Denominação da empresa')).toBe(true);
    expect(existeRotulo('Nome completo')).toBe(false);
  });

  it('coletiva troca o título da secção para "Dados da empresa"', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    expect(screen.getByText('Dados da empresa')).toBeInTheDocument();
  });

  it('coletiva mostra o DUNS', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(existeRotulo('DUNS (opcional)')).toBe(false);
    await paraColetiva(utilizador);
    expect(existeRotulo('DUNS (opcional)')).toBe(true);
  });

  it('singular pede NIF, coletiva pede NIFC (Portugal)', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(existeRotulo('NIF')).toBe(true);
    await paraColetiva(utilizador);
    expect(existeRotulo('NIFC')).toBe(true);
  });

  it('no Brasil singular pede CPF e coletiva pede CNPJ', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    expect(existeRotulo('CPF')).toBe(true);
    await paraColetiva(utilizador);
    expect(existeRotulo('CNPJ')).toBe(true);
  });

  it('coletiva troca as etiquetas por um campo único de nacionalidade da empresa', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(existeRotulo('Nacionalidade')).toBe(true);
    await paraColetiva(utilizador);
    expect(existeRotulo('Nacionalidade da empresa')).toBe(true);
    expect(existeRotulo('Nacionalidade')).toBe(false);
  });

  it('coletiva esconde os campos pessoais do titular', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(existeRotulo('Naturalidade')).toBe(true);
    await paraColetiva(utilizador);
    // continua a existir, mas já como campo do responsável (secção própria)
    expect(screen.getByText('Dados do responsável')).toBeInTheDocument();
  });

  it('coletiva esconde os documentos de identificação em lista', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(existeRotulo('Documento de identificação')).toBe(true);
    await paraColetiva(utilizador);
    expect(existeRotulo('Documento de identificação')).toBe(false);
  });

  it('só a coletiva tem dados do representante', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(screen.queryByText('Dados do responsável')).not.toBeInTheDocument();
    await paraColetiva(utilizador);
    for (const l of ['Nome do responsável', 'Cargo', 'NIF do responsável', 'Nacionalidade do responsável']) {
      expect(existeRotulo(l)).toBe(true);
    }
  });

  it('a coletiva tem morada própria para a sede e para o responsável', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    expect(existeRotulo('Sede da empresa')).toBe(true);
    expect(existeRotulo('Morada do responsável')).toBe(true);
  });

  it('voltar a singular apaga os dados do representante do ecrã', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    await utilizador.type(campo('Nome do responsável'), 'António Costa');
    await paraSingular(utilizador);
    expect(screen.queryByText('Dados do responsável')).not.toBeInTheDocument();
  });

  it('voltar a singular devolve o nome que já lá estava', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await paraColetiva(utilizador);
    await paraSingular(utilizador);
    expect(porId('f-name')).toHaveValue('Maria Silva');
  });

  it('passar a coletiva com contactos vazios muda a etiqueta para Empresa', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    expect(screen.getAllByRole('combobox').find((s) => s.value === 'Empresa')).toBeTruthy();
  });

  it('passar a coletiva com contactos preenchidos não mexe nas etiquetas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-email'), 'a@b.pt');
    await paraColetiva(utilizador);
    const sels = screen.getAllByRole('combobox');
    expect(sels.filter((s) => s.value === 'Empresa')).toHaveLength(1); // só o dos telefones
  });

  it('só a singular tem as pílulas do cliente conjunto', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(screen.getByRole('button', { name: /Adicionar pessoa/ })).toBeInTheDocument();
    await paraColetiva(utilizador);
    expect(screen.queryByRole('button', { name: /Adicionar pessoa/ })).not.toBeInTheDocument();
  });

  it('coletiva no Brasil pede RG do responsável em vez de NISS', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await paraColetiva(utilizador);
    expect(existeRotulo('NISS (opcional)')).toBe(true);
    await utilizador.click(cartao('Brasil'));
    expect(existeRotulo('RG')).toBe(true);
    expect(existeRotulo('NISS (opcional)')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — jurisdição
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — jurisdição', () => {
  it('começa em Portugal', () => {
    renderizar(<NewClient />);
    expect(cartao('Portugal').closest('button').className).toContain('sel');
  });

  it('escolher o Brasil marca o cartão do Brasil', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    expect(cartao('Brasil').closest('button').className).toContain('sel');
    expect(cartao('Portugal').closest('button').className).not.toContain('sel');
  });

  it('Portugal mostra NISS e esconde RG', () => {
    renderizar(<NewClient />);
    expect(existeRotulo('NISS (opcional)')).toBe(true);
    expect(existeRotulo('RG')).toBe(false);
  });

  it('Brasil mostra RG e esconde NISS', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    expect(existeRotulo('RG')).toBe(true);
    expect(existeRotulo('NISS (opcional)')).toBe(false);
  });

  it('Brasil troca o símbolo do valor total para R$', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    await irPara(utilizador, 'Dados Financeiros');
    expect(screen.getByText('R$')).toBeInTheDocument();
  });

  it('Portugal usa o euro no valor total', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(screen.getByText('€')).toBeInTheDocument();
  });

  it('a morada tem país próprio e não muda com a jurisdição', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    const box = rotulo('Morada / Endereço').closest('.adm-field');
    expect(within(box).getAllByRole('combobox')[0]).toHaveValue('PT');
  });

  it('o exemplo do NIF muda com o país', async () => {
    const { utilizador } = renderizar(<NewClient />);
    expect(campo('NIF')).toHaveAttribute('placeholder', '123 456 789');
    await utilizador.click(cartao('Brasil'));
    expect(campo('CPF')).toHaveAttribute('placeholder', '12.345.678/0001-00');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — validação
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — validação', () => {
  it('submeter em branco mostra a mensagem de campos em falta', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    expect(await screen.findByText('Faltam campos obrigatórios (assinalados a vermelho).')).toBeInTheDocument();
  });

  it('submeter em branco não chama a API', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(erro()).not.toBeNull());
    expect(api.criarCliente).not.toHaveBeenCalled();
  });

  it('submeter em branco não navega', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(erro()).not.toBeNull());
    expect(navegou).not.toHaveBeenCalled();
  });

  it('submeter em branco pinta o campo do nome a vermelho', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(porId('f-name')).toHaveStyle({ borderColor: '#c00000' }));
  });

  it('submeter em branco pinta o rótulo do nome', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(rotulo('Nome completo')).toHaveStyle({ color: '#c00000' }));
  });

  it('o cursor vai parar ao campo do nome', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(document.activeElement).toBe(porId('f-name')));
  });

  it('nome só com espaços conta como vazio', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), '    ');
    await utilizador.click(submeter());
    await waitFor(() => expect(porId('f-name')).toHaveStyle({ borderColor: '#c00000' }));
    expect(api.criarCliente).not.toHaveBeenCalled();
  });

  it('escrever no nome tira-lhe o vermelho', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(submeter());
    await waitFor(() => expect(porId('f-name')).toHaveStyle({ borderColor: '#c00000' }));
    await utilizador.type(porId('f-name'), 'M');
    expect(porId('f-name')).not.toHaveStyle({ borderColor: '#c00000' });
  });

  it('com nome mas sem e-mail continua a não passar', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.click(submeter());
    await waitFor(() => expect(erro()).not.toBeNull());
    expect(api.criarCliente).not.toHaveBeenCalled();
  });

  it('sem e-mail o cursor vai para o campo do e-mail', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.click(submeter());
    await waitFor(() => expect(document.activeElement).toBe(porId('f-email')));
  });

  it('sem telefone o cursor vai para o campo do telefone', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.click(submeter());
    await waitFor(() => expect(document.activeElement).toBe(porId('f-phone')));
  });

  it('e-mail só com espaços não conta', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), '   ');
    await utilizador.click(submeter());
    await waitFor(() => expect(document.activeElement).toBe(porId('f-email')));
  });

  // BUG: NewClient.jsx:713-714 — o ContactsEditor nunca recebe `invalid`, por
  // isso o e-mail em falta não fica assinalado a vermelho apesar de a mensagem
  // dizer "assinalados a vermelho" (NewClient.jsx:372). Só o nome é pintado.
  it.fails('e-mail em falta devia ficar assinalado a vermelho', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.click(submeter());
    await waitFor(() => expect(document.activeElement).toBe(porId('f-email')));
    expect(porId('f-email')).toHaveStyle({ borderColor: '#c00000' });
  });

  it('sem data de vencimento salta para o separador financeiro', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await utilizador.click(submeter());
    await waitFor(() => expect(existeRotulo('Tipo de plano')).toBe(true));
  });

  it('sem data de vencimento pinta o rótulo da data', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await utilizador.click(submeter());
    await waitFor(() => expect(rotulo('Data de Vencimento')).toHaveStyle({ color: '#c00000' }));
  });

  it('sem valor total pinta o rótulo do valor', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await escolherData(utilizador, porId('f-startDate'), 5);
    await utilizador.click(submeter());
    await waitFor(() => expect(rotulo('Valor total contratado')).toHaveStyle({ color: '#c00000' }));
  });

  it('sem número de parcelas pinta o rótulo das parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await escolherData(utilizador, porId('f-startDate'), 5);
    await utilizador.type(porId('f-totalValue'), '1200');
    await utilizador.click(submeter());
    await waitFor(() => expect(rotulo('Número de parcelas')).toHaveStyle({ color: '#c00000' }));
  });

  it('avença sem valor mensal pinta o rótulo do valor mensal', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Avença mensal'));
    await escolherData(utilizador, porId('f-startDate'), 5);
    await utilizador.click(submeter());
    await waitFor(() => expect(rotulo('Valor mensal')).toHaveStyle({ color: '#c00000' }));
  });

  it('pro bono não exige data nem valores', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
  });

  it('oficioso não exige data nem valores', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Oficioso'));
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
  });

  it('um plano válido passa a validação toda', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(erro()).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — contactos dentro do cadastro
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — contactos', () => {
  it('começa com um e-mail e um telefone', () => {
    renderizar(<NewClient />);
    expect(porId('f-email')).toBeInTheDocument();
    expect(porId('f-phone')).toBeInTheDocument();
  });

  it('acrescenta um segundo e-mail', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    expect(document.querySelectorAll('input[type="email"]')).toHaveLength(2);
  });

  it('acrescenta um segundo telefone', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar telefone/ }));
    expect(document.querySelectorAll('input[type="tel"]')).toHaveLength(2);
  });

  it('remove o e-mail que sobra', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    await utilizador.click(screen.getAllByTitle('Remover')[1]);
    expect(document.querySelectorAll('input[type="email"]')).toHaveLength(1);
  });

  it('guarda os dois e-mails escritos', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    const mails = document.querySelectorAll('input[type="email"]');
    await utilizador.type(mails[0], 'um@x.pt');
    await utilizador.type(mails[1], 'dois@x.pt');
    expect(mails[0]).toHaveValue('um@x.pt');
    expect(mails[1]).toHaveValue('dois@x.pt');
  });

  it('a linha de e-mail vazia é deitada fora ao guardar', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar e-mail/ }));
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(JSON.parse(api.criarCliente.mock.calls[0][0].emails)).toHaveLength(1);
  });

  it('uma etiqueta criada antes reaparece na lista', async () => {
    localStorage.setItem('vyvian_contact_labels', JSON.stringify(['Contabilista']));
    renderizar(<NewClient />);
    const sel = screen.getAllByRole('combobox').find((s) => s.querySelector('option[value="__nova__"]'));
    expect(within(sel).getByRole('option', { name: 'Contabilista' })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — documentos de identificação
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — documentos de identificação', () => {
  const docs = () => rotulo('Documento de identificação').closest('.adm-field');
  const numeros = () => screen.getAllByPlaceholderText(/Nº do documento/);

  it('começa com um documento', () => {
    renderizar(<NewClient />);
    expect(numeros()).toHaveLength(1);
  });

  it('com um documento não há botão de remover', () => {
    renderizar(<NewClient />);
    expect(screen.queryByTitle('Remover documento')).not.toBeInTheDocument();
  });

  it('adicionar cria uma segunda linha', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar documento/ }));
    expect(numeros()).toHaveLength(2);
  });

  it('com dois documentos o rótulo fica no plural', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar documento/ }));
    expect(existeRotulo('Documentos de identificação')).toBe(true);
  });

  it('remover deita fora a linha certa', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: /adicionar documento/ }));
    await utilizador.type(numeros()[0], 'PRIMEIRO');
    await utilizador.type(numeros()[1], 'SEGUNDO');
    await utilizador.click(screen.getAllByTitle('Remover documento')[0]);
    expect(numeros()).toHaveLength(1);
    expect(numeros()[0]).toHaveValue('SEGUNDO');
  });

  it('o tipo de documento tem os quatro tipos aceites', () => {
    renderizar(<NewClient />);
    const sel = within(docs()).getAllByRole('combobox')[0];
    for (const o of ['Título de Residência', 'Cartão de Cidadão', 'Passaporte', 'BI / RG']) {
      expect(within(sel).getByRole('option', { name: o })).toBeInTheDocument();
    }
  });

  it('o documento preenchido vai no cadastro', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.selectOptions(within(docs()).getAllByRole('combobox')[0], 'Passaporte');
    await utilizador.type(numeros()[0], 'X6D997798');
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    const p = api.criarCliente.mock.calls[0][0];
    expect(p).toMatchObject({ doc_type: 'Passaporte', doc_number: 'X6D997798' });
    expect(JSON.parse(p.documents)).toHaveLength(1);
  });

  it('documento em branco não é enviado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(api.criarCliente.mock.calls[0][0].documents).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — cliente conjunto (casal)
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — cliente conjunto', () => {
  const adicionar = (u) => u.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));

  it('começa só com o titular', () => {
    renderizar(<NewClient />);
    expect(screen.getByRole('button', { name: 'Pessoa 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pessoa 2' })).not.toBeInTheDocument();
  });

  it('adicionar cria a segunda pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    expect(screen.getByRole('button', { name: 'Pessoa 2' })).toBeInTheDocument();
  });

  it('adicionar mostra os campos da pessoa nova', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    expect(screen.getByLabelText('Nome completo *')).toBeInTheDocument();
  });

  it('adicionar esconde os campos do titular', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    expect(existeRotulo('Nome completo')).toBe(false);
  });

  it('a pessoa nova traz o botão de a remover', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    expect(screen.getByRole('button', { name: 'Remover esta pessoa' })).toBeInTheDocument();
  });

  it('voltar ao titular pela pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Pessoa 1' }));
    expect(existeRotulo('Nome completo')).toBe(true);
  });

  it('no titular aparece o aviso de cliente conjunto', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Pessoa 1' }));
    expect(screen.getByText(/Cliente conjunto: os contactos, a área e o plano/)).toBeInTheDocument();
  });

  it('sem pessoas adicionais não há aviso de cliente conjunto', () => {
    renderizar(<NewClient />);
    expect(screen.queryByText(/Cliente conjunto:/)).not.toBeInTheDocument();
  });

  it('o nome da pessoa nova aparece na pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.type(screen.getByLabelText('Nome completo *'), 'Bruno');
    expect(screen.getByRole('button', { name: 'Bruno' })).toBeInTheDocument();
  });

  it('o nome do titular aparece na primeira pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Ana');
    await adicionar(utilizador);
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
  });

  it('dá para ter três pessoas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await adicionar(utilizador);
    expect(screen.getByRole('button', { name: 'Pessoa 3' })).toBeInTheDocument();
  });

  it('os dados da pessoa adicional sobrevivem a alternar de pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.type(screen.getByLabelText('NIF'), '111222333');
    await utilizador.click(screen.getByRole('button', { name: 'Pessoa 1' }));
    await utilizador.click(screen.getByRole('button', { name: 'Pessoa 2' }));
    expect(screen.getByLabelText('NIF')).toHaveValue('111222333');
  });

  it('cada pessoa tem a sua morada', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.type(screen.getByPlaceholderText('Nome da via'), 'do Ouro');
    await utilizador.click(screen.getByRole('button', { name: 'Pessoa 1' }));
    expect(screen.getByPlaceholderText('Nome da via')).toHaveValue('');
  });

  it('remover a pessoa tira-lhe a pílula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Remover esta pessoa' }));
    expect(screen.queryByRole('button', { name: 'Pessoa 2' })).not.toBeInTheDocument();
  });

  it('remover devolve o ecrã ao titular', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.click(screen.getByRole('button', { name: 'Remover esta pessoa' }));
    expect(existeRotulo('Nome completo')).toBe(true);
  });

  it('passar a coletiva esconde as pessoas adicionais', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await adicionar(utilizador);
    await utilizador.selectOptions(campo('Tipo de cliente'), 'coletiva');
    expect(screen.queryByRole('button', { name: 'Pessoa 2' })).not.toBeInTheDocument();
    expect(existeRotulo('Denominação da empresa')).toBe(true);
  });

  it('pessoa com dados mas sem nome bloqueia a submissão', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await adicionar(utilizador);
    await utilizador.type(screen.getByLabelText('NIF'), '111222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    await utilizador.click(submeter());
    expect(await screen.findByText('A pessoa 2 tem dados preenchidos mas falta o nome.')).toBeInTheDocument();
    expect(api.criarCliente).not.toHaveBeenCalled();
  });

  // BUG: NewClient.jsx:379 + PersonFields.jsx:37-42 — personHasData dá true para
  // uma pessoa acabada de adicionar (o via_type 'Rua' do EMPTY_ADDRESS conta como
  // dado preenchido). Basta clicar em "Adicionar pessoa" sem escrever nada para o
  // cadastro ficar bloqueado com "A pessoa 2 tem dados preenchidos mas falta o nome".
  it.fails('pessoa acabada de adicionar e nunca tocada não devia bloquear', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await adicionar(utilizador);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — plano financeiro
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — plano financeiro', () => {
  async function planoParcelado(u, { total = '1200', n = '3' } = {}) {
    await irPara(u, 'Dados Financeiros');
    await escolherData(u, porId('f-startDate'), 5);
    await u.type(porId('f-totalValue'), total);
    await u.type(porId('f-installments'), n);
  }
  const btnAjustar = () => screen.getByRole('button', { name: /Ajustar valores das parcelas/ });
  const valoresNoModal = () => [...modal().querySelectorAll('input[type="text"]')];

  it('oferece os quatro tipos de plano', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    for (const p of ['Parcelado', 'Avença mensal', 'Oficioso', 'Pro bono']) {
      expect(cartao(p)).toBeInTheDocument();
    }
  });

  it('começa no plano parcelado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(cartao('Parcelado').closest('button').className).toContain('sel');
  });

  it('parcelado pede data, valor total e número de parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(existeRotulo('Data de Vencimento')).toBe(true);
    expect(existeRotulo('Valor total contratado')).toBe(true);
    expect(existeRotulo('Número de parcelas')).toBe(true);
  });

  it('avença troca o valor total pelo valor mensal', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Avença mensal'));
    expect(existeRotulo('Valor mensal')).toBe(true);
    expect(existeRotulo('Valor total contratado')).toBe(false);
    expect(existeRotulo('Número de parcelas')).toBe(false);
  });

  it('avença continua a pedir a data de vencimento', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Avença mensal'));
    expect(existeRotulo('Data de Vencimento')).toBe(true);
  });

  it('oficioso esconde datas e valores', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Oficioso'));
    expect(existeRotulo('Data de Vencimento')).toBe(false);
    expect(existeRotulo('Valor total contratado')).toBe(false);
  });

  it('oficioso explica que os honorários vêm no trânsito em julgado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Oficioso'));
    expect(screen.getByText(/trânsito em julgado/)).toBeInTheDocument();
  });

  it('pro bono explica que não há componente financeira', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    expect(screen.getByText(/sem parcelas, cobranças ou lembretes/)).toBeInTheDocument();
  });

  it('pro bono esconde o lembrete automático', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    expect(existeRotulo('Lembrete automático antes do vencimento')).toBe(false);
  });

  it('pro bono muda o texto do botão para "Criar cliente"', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    expect(screen.getByRole('button', { name: 'Criar cliente' })).toBeInTheDocument();
  });

  it('parcelado promete gerar as parcelas no botão', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(screen.getByRole('button', { name: 'Criar cliente e gerar parcelas' })).toBeInTheDocument();
  });

  it('sem valores não há pré-visualização do plano', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(screen.queryByText(/parcelas de/)).not.toBeInTheDocument();
  });

  it('mostra a pré-visualização das parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    expect(screen.getByText(/3 parcelas de € 400\.00, mensais/)).toBeInTheDocument();
  });

  it('a pré-visualização acompanha o número de parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador, { total: '1200', n: '4' });
    expect(screen.getByText(/4 parcelas de € 300\.00, mensais/)).toBeInTheDocument();
  });

  it('a pré-visualização usa o real no Brasil', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    await planoParcelado(utilizador);
    expect(screen.getByText(/3 parcelas de R\$ 400\.00, mensais/)).toBeInTheDocument();
  });

  it('a avença mostra a sua própria pré-visualização', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Avença mensal'));
    await utilizador.type(porId('f-monthlyValue'), '450');
    expect(screen.getByText(/avença de € 450\.00\/mês, recorrente \(12 meses iniciais\)/)).toBeInTheDocument();
  });

  it('o lembrete vem predefinido a 5 dias por e-mail e WhatsApp', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(campo('Lembrete automático antes do vencimento')).toHaveValue('5:email+whatsapp');
  });

  it('dá para desligar o lembrete', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.selectOptions(campo('Lembrete automático antes do vencimento'), '0:none');
    expect(campo('Lembrete automático antes do vencimento')).toHaveValue('0:none');
  });

  it('ajustar parcelas está desligado enquanto faltam dados', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    expect(btnAjustar()).toBeDisabled();
  });

  it('ajustar parcelas só com a data ainda está desligado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await irPara(utilizador, 'Dados Financeiros');
    await escolherData(utilizador, porId('f-startDate'), 5);
    expect(btnAjustar()).toBeDisabled();
  });

  it('ajustar parcelas liga quando há data, valor e número', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    expect(btnAjustar()).toBeEnabled();
  });

  it('abrir o ajuste mostra uma linha por parcela', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    expect(valoresNoModal()).toHaveLength(3);
  });

  it('as parcelas nascem com a divisão igual', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    expect(valoresNoModal().map((i) => i.value)).toEqual(['400.00', '400.00', '400.00']);
  });

  it('a última parcela absorve o arredondamento', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador, { total: '100', n: '3' });
    await utilizador.click(btnAjustar());
    expect(valoresNoModal().map((i) => i.value)).toEqual(['33.33', '33.33', '33.34']);
  });

  it('a soma fecha com o total logo à partida', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    expect(modal().textContent).toContain('✓');
  });

  it('mexer numa parcela à mão quebra a soma', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    expect(modal().textContent).toMatch(/faltam/);
  });

  it('com a soma a mais, o ecrã diz que está a mais', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '900');
    expect(modal().textContent).toMatch(/a mais/);
  });

  it('Aplicar fica desligado enquanto a soma não fechar', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    expect(within(modal()).getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  });

  it('acertar a diferença noutra parcela volta a ligar o Aplicar', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.clear(valoresNoModal()[2]);
    await utilizador.type(valoresNoModal()[2], '700');
    expect(within(modal()).getByRole('button', { name: 'Aplicar' })).toBeEnabled();
  });

  it('repor divisão igual desfaz as alterações', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.click(within(modal()).getByRole('button', { name: /Repor divisão igual/ }));
    expect(valoresNoModal().map((i) => i.value)).toEqual(['400.00', '400.00', '400.00']);
  });

  it('Cancelar fecha o ajuste sem guardar nada', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Cancelar' }));
    expect(modal()).toBeNull();
    expect(screen.queryByText(/valores personalizados definidos/)).not.toBeInTheDocument();
  });

  it('Aplicar fecha o ajuste e avisa que os valores são personalizados', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.clear(valoresNoModal()[2]);
    await utilizador.type(valoresNoModal()[2], '700');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Aplicar' }));
    expect(modal()).toBeNull();
    expect(screen.getByText(/valores personalizados definidos/)).toBeInTheDocument();
  });

  it('eliminar uma parcela no ajuste sincroniza o número de parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.click(within(modal()).getAllByRole('button', { name: '✕' })[2]);
    await utilizador.clear(valoresNoModal()[1]);
    await utilizador.type(valoresNoModal()[1], '800');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Aplicar' }));
    expect(porId('f-installments')).toHaveValue(2);
  });

  it('mexer no número de parcelas deita fora a personalização', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.clear(valoresNoModal()[2]);
    await utilizador.type(valoresNoModal()[2], '700');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Aplicar' }));
    await utilizador.type(porId('f-installments'), '0');
    expect(screen.queryByText(/valores personalizados definidos/)).not.toBeInTheDocument();
  });

  it('mexer no valor total também deita fora a personalização', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await planoParcelado(utilizador);
    await utilizador.click(btnAjustar());
    await utilizador.clear(valoresNoModal()[0]);
    await utilizador.type(valoresNoModal()[0], '100');
    await utilizador.clear(valoresNoModal()[2]);
    await utilizador.type(valoresNoModal()[2], '700');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Aplicar' }));
    await utilizador.type(porId('f-totalValue'), '0');
    expect(screen.queryByText(/valores personalizados definidos/)).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — submissão
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — submissão', () => {
  const payload = () => api.criarCliente.mock.calls[0][0];

  it('cria o cliente com o nome escrito', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().name).toBe('Maria Silva');
  });

  it('o id do cliente sai do nome', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().id).toMatch(/^maria-silva-[a-z0-9]{4}$/);
  });

  it('envia o primeiro e-mail e o primeiro telefone em campos próprios', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().email).toBe('maria@exemplo.pt');
    expect(payload().phone).toBe('+351911222333');
  });

  it('envia a lista completa de contactos em JSON', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(JSON.parse(payload().emails)).toEqual([{ label: 'Pessoal', value: 'maria@exemplo.pt' }]);
    expect(JSON.parse(payload().phones)).toEqual([{ label: 'Pessoal', value: '+351911222333' }]);
  });

  it('envia o país e o tipo de pessoa', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({ country: 'PT', person_type: 'singular', plan_type: 'probono' });
  });

  it('pro bono vai sem honorários nem data de contrato', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({ honorarios_total: 0, honorarios_parcelas: 0, contract_start_date: null });
  });

  it('navega para a ficha do cliente criado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/clientes\/maria-silva-/)));
  });

  it('o botão diz "A criar…" e fica bloqueado durante a gravação', async () => {
    let libertar;
    api.criarCliente.mockImplementation(() => new Promise((r) => { libertar = () => r({}); }));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    const btn = await screen.findByRole('button', { name: 'A criar…' });
    expect(btn).toBeDisabled();
    libertar();
    await waitFor(() => expect(navegou).toHaveBeenCalled());
  });

  it('o Cancelar também fica bloqueado durante a gravação', async () => {
    let libertar;
    api.criarCliente.mockImplementation(() => new Promise((r) => { libertar = () => r({}); }));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await screen.findByRole('button', { name: 'A criar…' });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    libertar();
    await waitFor(() => expect(navegou).toHaveBeenCalled());
  });

  it('os campos ficam bloqueados durante a gravação', async () => {
    let libertar;
    api.criarCliente.mockImplementation(() => new Promise((r) => { libertar = () => r({}); }));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await screen.findByRole('button', { name: 'A criar…' });
    await irPara(utilizador, 'Dados do Cliente');
    expect(porId('f-name')).toBeDisabled();
    libertar();
    await waitFor(() => expect(navegou).toHaveBeenCalled());
  });

  it('o Cancelar leva de volta à lista de clientes', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(navegou).toHaveBeenCalledWith('/admin/clientes');
  });

  it('plano parcelado envia o total e o número de parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({ plan_type: 'installment', honorarios_total: 1200, honorarios_parcelas: 3 });
  });

  it('plano parcelado envia a data de vencimento', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().contract_start_date).toMatch(/^\d{4}-\d{2}-05$/);
  });

  it('plano parcelado cria uma parcela por prestação', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas()).toHaveLength(3);
  });

  it('as parcelas somam exatamente o valor total', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador, { total: '100', n: '3' });
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    const soma = corposDasParcelas().reduce((s, p) => s + p.amount, 0);
    expect(Math.round(soma * 100) / 100).toBe(100);
  });

  it('as parcelas são numeradas e sabem quantas são no total', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas().map((p) => p.installment_number)).toEqual([1, 2, 3]);
    expect(corposDasParcelas().every((p) => p.total_installments === 3)).toBe(true);
  });

  it('as parcelas vencem de mês a mês, no mesmo dia', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    const datas = corposDasParcelas().map((p) => p.due_date);
    expect(datas.every((d) => d.endsWith('-05'))).toBe(true);
    const meses = datas.map((d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)));
    expect(meses[1] - meses[0]).toBe(1);
    expect(meses[2] - meses[1]).toBe(1);
  });

  it('as parcelas ficam ligadas ao cliente criado', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    const id = payload().id;
    expect(corposDasParcelas().map((p) => p.client_id)).toEqual([id, id, id]);
    expect(corposDasParcelas()[0].id).toBe(`${id}-p1`);
  });

  it('em Portugal as parcelas são em euros', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas().every((p) => p.currency === 'EUR')).toBe(true);
  });

  it('no Brasil as parcelas são em reais', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.click(cartao('Brasil'));
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas().every((p) => p.currency === 'BRL')).toBe(true);
  });

  it('os valores personalizados são os que vão para as parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(screen.getByRole('button', { name: /Ajustar valores das parcelas/ }));
    const campos = () => [...modal().querySelectorAll('input[type="text"]')];
    await utilizador.clear(campos()[0]);
    await utilizador.type(campos()[0], '100');
    await utilizador.clear(campos()[2]);
    await utilizador.type(campos()[2], '700');
    await utilizador.click(within(modal()).getByRole('button', { name: 'Aplicar' }));
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas().map((p) => p.amount)).toEqual([100, 400, 700]);
  });

  it('a avença cria as 12 primeiras parcelas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Avença mensal'));
    await escolherData(utilizador, porId('f-startDate'), 5);
    await utilizador.type(porId('f-monthlyValue'), '450');
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    const parcelas = corposDasParcelas();
    expect(parcelas).toHaveLength(12);
    expect(parcelas.every((p) => p.amount === 450)).toBe(true);
  });

  it('pro bono não cria parcelas nenhumas', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(corposDasParcelas()).toHaveLength(0);
  });

  it('cria as regras de lembrete por e-mail e WhatsApp', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(api.criarRegra).toHaveBeenCalledTimes(2);
    expect(api.criarRegra.mock.calls.map(([r]) => r.channel)).toEqual(['email', 'whatsapp']);
  });

  it('a regra de lembrete guarda os dias de antecedência', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(api.criarRegra.mock.calls[0][0]).toMatchObject({ days_before: 5, enabled: true });
  });

  it('desligar o lembrete não cria regras', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.selectOptions(campo('Lembrete automático antes do vencimento'), '0:none');
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(api.criarRegra).not.toHaveBeenCalled();
  });

  it('pro bono não cria regras de lembrete', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(api.criarRegra).not.toHaveBeenCalled();
  });

  it('a morada vai composta numa linha e também estruturada', async () => {
    const { utilizador } = renderizar(<NewClient />);
    const box = rotulo('Morada / Endereço').closest('.adm-field');
    await utilizador.type(within(box).getByPlaceholderText('Nome da via'), 'das Flores');
    await utilizador.type(within(box).getByPlaceholderText('Número'), '12');
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().address).toBe('Rua das Flores, Nº 12');
    expect(JSON.parse(payload().address_parts).via_name).toBe('das Flores');
  });

  it('sem morada, o cliente vai com morada nula', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().address).toBeNull();
    expect(payload().address_parts).toBeNull();
  });

  it('as nacionalidades escritas em etiquetas vão na lista', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(document.querySelector('.adm-tags input'), 'portuguesa{Enter}');
    await utilizador.type(document.querySelector('.adm-tags input'), 'brasileira{Enter}');
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(JSON.parse(payload().nationalities)).toEqual(['portuguesa', 'brasileira']);
    expect(payload().nationality).toBe('portuguesa');
  });

  it('a filiação junta o pai e a mãe', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(campo('Pai (opcional)'), 'José Silva');
    await utilizador.type(campo('Mãe (opcional)'), 'Ana Silva');
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().filiation).toBe('José Silva e Ana Silva');
  });

  it('o processo escrito vai com referência, área e resumo', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await irPara(utilizador, 'Dados do Processo');
    await utilizador.type(campo('Processo / referência interna'), '1289/26');
    await utilizador.type(campo('Resumo do processo'), 'Divórcio consensual');
    await utilizador.selectOptions(campo('Área de atuação'), 'Cível');
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      practice_area: 'Cível',
      process_summary: 'Divórcio consensual',
      notes: 'Processo: 1289/26',
    });
    expect(JSON.parse(payload().processes)).toHaveLength(1);
  });

  it('dois processos vão os dois na lista', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await irPara(utilizador, 'Dados do Processo');
    await utilizador.click(screen.getByRole('button', { name: /adicionar processo/ }));
    const refs = screen.getAllByPlaceholderText(/1289\/26/);
    await utilizador.type(refs[0], 'A/1');
    await utilizador.type(refs[1], 'B/2');
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(JSON.parse(payload().processes).map((p) => p.ref)).toEqual(['A/1', 'B/2']);
  });

  it('processos em branco não são enviados', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().processes).toBeNull();
  });

  it('a coletiva envia os dados do representante legal', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.selectOptions(campo('Tipo de cliente'), 'coletiva');
    await utilizador.type(porId('f-name'), 'Avena Lda');
    await utilizador.type(campo('Nome do responsável'), 'António Costa');
    await utilizador.type(campo('Cargo'), 'sócio-gerente');
    await utilizador.type(campo('DUNS (opcional)'), '449683786');
    await utilizador.type(porId('f-email'), 'geral@avena.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      person_type: 'coletiva',
      rep_name: 'António Costa',
      rep_role: 'sócio-gerente',
      duns: '449683786',
    });
  });

  it('a singular não envia dados de representante', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload()).toMatchObject({ rep_name: null, rep_role: null, duns: null });
  });

  it('o cliente conjunto envia as pessoas adicionais', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await utilizador.type(porId('f-name'), 'Maria Silva');
    await utilizador.type(porId('f-email'), 'maria@exemplo.pt');
    await utilizador.type(porId('f-phone'), '+351911222333');
    await utilizador.click(screen.getByRole('button', { name: /Adicionar pessoa/ }));
    await utilizador.type(screen.getByLabelText('Nome completo *'), 'Bruno Silva');
    await utilizador.type(screen.getByLabelText('NIF'), '111222333');
    await irPara(utilizador, 'Dados Financeiros');
    await utilizador.click(cartao('Pro bono'));
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().people).toHaveLength(1);
    expect(payload().people[0]).toMatchObject({ name: 'Bruno Silva', identification: '111222333' });
  });

  it('sem pessoas adicionais a lista vai vazia', async () => {
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(payload().people).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Novo cliente — quando a API falha
// ═════════════════════════════════════════════════════════════════════════════
describe('Novo cliente — quando a API falha', () => {
  it('mostra a mensagem devolvida pelo servidor', async () => {
    api.criarCliente.mockRejectedValue(new Error('Já existe um cliente com esse NIF'));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    expect(await screen.findByText('Já existe um cliente com esse NIF')).toBeInTheDocument();
  });

  it('não navega quando a gravação falha', async () => {
    api.criarCliente.mockRejectedValue(new Error('HTTP 500'));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await screen.findByText('HTTP 500');
    expect(navegou).not.toHaveBeenCalled();
  });

  it('devolve o botão à utilizadora para ela tentar outra vez', async () => {
    api.criarCliente.mockRejectedValue(new Error('HTTP 500'));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await screen.findByText('HTTP 500');
    expect(screen.getByRole('button', { name: 'Criar cliente' })).toBeEnabled();
  });

  it('falha de rede aparece com a mensagem do browser', async () => {
    api.criarCliente.mockRejectedValue(new TypeError('Failed to fetch'));
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });

  it('um pedido que expira acaba por mostrar o erro', async () => {
    api.criarCliente.mockImplementation(
      () => new Promise((_, rej) => setTimeout(() => rej(new Error('A ligação expirou')), 40))
    );
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    expect(await screen.findByText('A ligação expirou')).toBeInTheDocument();
    expect(navegou).not.toHaveBeenCalled();
  });

  it('tentar outra vez com sucesso limpa a mensagem de erro', async () => {
    api.criarCliente.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue({ ok: true });
    const { utilizador } = renderizar(<NewClient />);
    await preencherProBono(utilizador);
    await utilizador.click(submeter());
    await screen.findByText('HTTP 500');
    await utilizador.click(submeter());
    await waitFor(() => expect(navegou).toHaveBeenCalled());
    expect(erro()).toBeNull();
  });

  it('falha ao criar as regras de lembrete mostra o erro', async () => {
    api.criarRegra.mockRejectedValue(new Error('Regra recusada'));
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    expect(await screen.findByText('Regra recusada')).toBeInTheDocument();
    expect(navegou).not.toHaveBeenCalled();
  });

  // BUG: NewClient.jsx:507-517 — as parcelas são gravadas com um fetch direto e
  // ninguém olha para o res.ok. Se o servidor recusar, a Dra. é levada para a
  // ficha do cliente como se estivesse tudo bem — e o plano fica sem parcelas.
  it.fails('parcela recusada pelo servidor devia travar a navegação', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })));
    const { utilizador } = renderizar(<NewClient />);
    await preencherParcelado(utilizador);
    await utilizador.click(submeter());
    await waitFor(() => expect(api.criarCliente).toHaveBeenCalled());
    expect(navegou).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cálculo das parcelas (funções usadas pelo separador financeiro)
// ═════════════════════════════════════════════════════════════════════════════
describe('cálculo das parcelas', () => {
  it('divide o total em partes iguais', () => {
    expect(gerarParcelas(1200, 3, '2026-01-15').map((r) => r.amount)).toEqual(['400.00', '400.00', '400.00']);
  });

  it('a última parcela absorve os cêntimos que sobram', () => {
    expect(gerarParcelas(100, 3, '2026-01-15').map((r) => r.amount)).toEqual(['33.33', '33.33', '33.34']);
  });

  it('a soma bate sempre certo com o total', () => {
    expect(somaParcelas(gerarParcelas(100, 3, '2026-01-15'))).toBe(100);
  });

  it('numera as parcelas a partir de 1', () => {
    expect(gerarParcelas(300, 3, '2026-01-15').map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('as datas são mensais e consecutivas', () => {
    expect(gerarParcelas(300, 3, '2026-01-15').map((r) => r.due_date))
      .toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('uma parcela só devolve o total inteiro', () => {
    expect(gerarParcelas(999.99, 1, '2026-01-15')[0].amount).toBe('999.99');
  });

  it('parseValor aceita a vírgula portuguesa', () => expect(parseValor('1250,50')).toBe(1250.5));
  it('parseValor aceita o ponto', () => expect(parseValor('1250.50')).toBe(1250.5));
  it('parseValor de lixo dá zero', () => expect(parseValor('abc')).toBe(0));
  it('parseValor de vazio dá zero', () => expect(parseValor('')).toBe(0));
  it('somaParcelas de lista vazia dá zero', () => expect(somaParcelas([])).toBe(0));

  it('addMonthsISO avança um mês', () => expect(addMonthsISO('2026-01-15', 1)).toBe('2026-02-15'));
  it('addMonthsISO atravessa o ano', () => expect(addMonthsISO('2026-12-10', 1)).toBe('2027-01-10'));

  // BUG: ParcelasEditor.jsx:9-13 e NewClient.jsx:25-29 — o addMonths usa
  // Date.setMonth, que transborda quando o dia não existe no mês seguinte. Uma
  // 1.ª parcela a 31 de janeiro gera a 2.ª a 3 de março (saltando fevereiro).
  it.fails('um vencimento a 31 devia cair no último dia do mês seguinte', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
  });
});
