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
afterEach(() => { vi.unstubAllGlobals(); });

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
