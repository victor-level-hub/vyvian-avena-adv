// tests/worker/extracao.test.js
// Extração de dados de documentos por IA — worker/routes/extracao.js.
// É o que preenche o cadastro do cliente a partir de um Cartão de Cidadão,
// procuração ou e-mail colado. Documentos não são armazenados: só passam no pedido.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleExtracao } from '../../worker/routes/extracao.js';
import { criarEnv, req, json, mockFetch, geminiJson } from '../helpers/env.js';

const ROTA = '/api/cadastro/extrair-documento';
const SESSAO = { sub: 1, name: 'Victor' };

const CAMPOS = {
  person_type: 'singular', name: 'Maria Silva', identification: '123456789',
  country: 'PT', doc_type: 'Cartão de Cidadão', birth_date: '1980-05-14',
};

// resposta do Gemini com metadados de utilização
function geminiComUsage(objeto, um = { promptTokenCount: 120, candidatesTokenCount: 45 }) {
  return { json: {
    candidates: [{ content: { parts: [{ text: JSON.stringify(objeto) }] } }],
    usageMetadata: um,
  } };
}

const imagem = (n = 64) => new Uint8Array(n).fill(7).buffer;
const enviar = (env, opts) => handleExtracao(req('POST', ROTA, opts), env, ROTA, SESSAO);
const corpoEnviado = (f) => JSON.parse(f.chamadas[0].body);
const partes = (f) => corpoEnviado(f).contents[0].parts;
const prompt = (f) => partes(f).map((p) => p.text || '').join('\n');

let env;
beforeEach(() => {
  env = criarEnv();
  // Rede fechada por omissão: um teste que chegue ao fetch sem o ter mockado
  // falha aqui em vez de bater mesmo na API do Google.
  vi.stubGlobal('fetch', async (url) => { throw new Error('fetch não mockado neste teste: ' + url); });
});
afterEach(() => { vi.unstubAllGlobals(); });

// ─── porta de entrada ────────────────────────────────────────────────────────
describe('validações de entrada', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('recusa o método %s com 405', async (m) => {
    const r = await handleExtracao(req(m, ROTA), env, ROTA, SESSAO);
    expect(r.status).toBe(405);
  });

  it('503 quando a chave do Gemini não está configurada', async () => {
    env.GEMINI_API_KEY = '';
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(503);
    expect((await json(r)).error).toContain('não configurado');
  });

  it('não chega a chamar a IA quando falta a chave', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    env.GEMINI_API_KEY = '';
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    expect(f.chamadas).toHaveLength(0);
  });

  it.each([
    'application/zip', 'text/html', 'image/gif', 'image/svg+xml',
    'application/octet-stream', 'video/mp4',
  ])('recusa o tipo %s com 415', async (ct) => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS)));
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': ct } });
    expect(r.status).toBe(415);
  });

  it('recusa pedido sem Content-Type com 415', async () => {
    // corpo binário: ao contrário de uma string, não faz o Request inventar text/plain
    const r = await handleExtracao(
      new Request('https://x' + ROTA, { method: 'POST', body: new Uint8Array([1, 2, 3]) }), env, ROTA, SESSAO);
    expect(r.status).toBe(415);
  });

  it('recusa ficheiro vazio com 400', async () => {
    const r = await enviar(env, { binario: new ArrayBuffer(0), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(400);
  });

  it('aceita exatamente no limite de 8 MB', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS)));
    const r = await enviar(env, { binario: imagem(8 * 1024 * 1024), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(200);
  });

  it('recusa 1 byte acima de 8 MB com 413', async () => {
    const r = await enviar(env, { binario: imagem(8 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(413);
  });
});

// ─── tipos de documento ──────────────────────────────────────────────────────
describe('tipos aceites', () => {
  it.each([
    ['image/png', 'image/png'],
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/webp', 'image/webp'],
    ['application/pdf', 'application/pdf'],
  ])('%s é enviado ao Gemini como %s', async (ct, esperado) => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': ct } });
    expect(partes(f)[0].inline_data.mime_type).toBe(esperado);
  });

  it('tolera o content-type com charset e maiúsculas', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'IMAGE/PNG; charset=binary' } });
    expect(r.status).toBe(200);
    expect(partes(f)[0].inline_data.mime_type).toBe('image/png');
  });

  it('o binário segue em base64 válido', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    await enviar(env, { binario: bytes.buffer, headers: { 'Content-Type': 'image/png' } });
    const b64 = partes(f)[0].inline_data.data;
    expect(new Uint8Array([...atob(b64)].map((c) => c.charCodeAt(0)))).toEqual(bytes);
  });

  it('um ficheiro grande é codificado por blocos sem se corromper', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const n = 0x8000 * 3 + 17; // força vários blocos
    const bytes = new Uint8Array(n).map((_, i) => i % 256);
    await enviar(env, { binario: bytes.buffer, headers: { 'Content-Type': 'application/pdf' } });
    const b64 = partes(f)[0].inline_data.data;
    expect(atob(b64).length).toBe(n);
  });
});

// ─── texto colado ────────────────────────────────────────────────────────────
describe('texto colado (modal "Ler com IA")', () => {
  it('aceita texto simples e envia-o como parte textual', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const r = await enviar(env, { body: 'Exmo. Senhor, venho por este meio…', headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(200);
    expect(partes(f)[0].text).toContain('venho por este meio');
    expect(partes(f)[0].inline_data).toBeUndefined();
  });

  it('recusa texto vazio com 400', async () => {
    const r = await enviar(env, { body: '   \n  ', headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(400);
  });

  it('aceita exatamente 30 000 caracteres', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS)));
    const r = await enviar(env, { body: 'a'.repeat(30000), headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(200);
  });

  it('recusa acima de 30 000 caracteres com 413', async () => {
    const r = await enviar(env, { body: 'a'.repeat(30001), headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(413);
  });

  it('texto com acentos e emoji sobrevive intacto', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { body: 'Ação de cobrança — 1.º Juízo ⚖️', headers: { 'Content-Type': 'text/plain' } });
    expect(partes(f)[0].text).toContain('Ação de cobrança — 1.º Juízo ⚖️');
  });
});

// ─── contexto dos processos existentes ───────────────────────────────────────
describe('contexto de processos já registados (X-Processos)', () => {
  const cabecalho = (lista) => ({ 'Content-Type': 'image/png', 'X-Processos': encodeURIComponent(JSON.stringify(lista)) });

  it('acrescenta a nota com os processos ao prompt', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: cabecalho([{ ref: '1289/26', area: 'Cível', resumo: 'Colisão em 2025.' }]) });
    const p = prompt(f);
    expect(p).toContain('já tem 1 processo(s) registado(s)');
    expect(p).toContain('1289/26');
    expect(p).toContain('Colisão em 2025.');
  });

  it('envia no máximo 10 processos', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const lista = Array.from({ length: 15 }, (_, i) => ({ ref: `P-${i}`, area: 'Cível', resumo: 'x' }));
    await enviar(env, { binario: imagem(), headers: cabecalho(lista) });
    expect(prompt(f)).toContain('[9]');
    expect(prompt(f)).not.toContain('[10]');
  });

  it('corta resumos muito longos aos 900 caracteres', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: cabecalho([{ ref: 'X', area: 'Cível', resumo: 'z'.repeat(2000) }]) });
    expect(prompt(f)).not.toContain('z'.repeat(901));
  });

  it('lista vazia não acrescenta nota nenhuma', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: cabecalho([]) });
    expect(prompt(f)).not.toContain('já tem');
  });

  it('cabeçalho corrompido é ignorado em vez de rebentar', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png', 'X-Processos': '%%%isto-nao-e-json' } });
    expect(r.status).toBe(200);
    expect(prompt(f)).not.toContain('NOTA:');
  });

  it('JSON que não é array é ignorado', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png', 'X-Processos': encodeURIComponent('{"a":1}') } });
    expect(prompt(f)).not.toContain('NOTA:');
  });

  it('sem X-Processos usa o resumo atual (retrocompatibilidade)', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, {
      binario: imagem(),
      headers: { 'Content-Type': 'image/png', 'X-Resumo-Atual': encodeURIComponent('Resumo anterior do caso.') },
    });
    expect(prompt(f)).toContain('Resumo anterior do caso.');
    expect(prompt(f)).toContain('versão MELHORADA');
  });

  it('X-Processos tem precedência sobre X-Resumo-Atual', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, {
      binario: imagem(),
      headers: {
        'Content-Type': 'image/png',
        'X-Processos': encodeURIComponent(JSON.stringify([{ ref: 'A', area: 'Cível', resumo: 'novo' }])),
        'X-Resumo-Atual': encodeURIComponent('resumo antigo'),
      },
    });
    expect(prompt(f)).toContain('já tem 1 processo(s)');
    expect(prompt(f)).not.toContain('resumo antigo');
  });

  it('corta o resumo atual aos 6000 caracteres', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, {
      binario: imagem(),
      headers: { 'Content-Type': 'image/png', 'X-Resumo-Atual': encodeURIComponent('y'.repeat(9000)) },
    });
    expect(prompt(f)).not.toContain('y'.repeat(6001));
  });
});

// ─── chamada ao Gemini ───────────────────────────────────────────────────────
describe('chamada ao modelo', () => {
  it('envia a chave no cabeçalho e não no URL', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    const c = f.chamadas[0];
    expect(c.init.headers['x-goog-api-key']).toBe('chave-gemini-de-teste');
    expect(c.url).not.toContain('chave-gemini-de-teste');
  });

  it('pede JSON determinístico (temperatura 0)', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    expect(corpoEnviado(f).generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
  });

  it('o prompt inclui o esquema dos campos esperados', async () => {
    const f = mockFetch(geminiComUsage(CAMPOS));
    vi.stubGlobal('fetch', f);
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    const p = prompt(f);
    expect(p).toContain('person_type');
    expect(p).toContain('process_summary');
    expect(p).toContain('practice_area');
  });
});

// ─── resposta ────────────────────────────────────────────────────────────────
describe('interpretação da resposta', () => {
  it('devolve os campos extraídos', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS)));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.ok).toBe(true);
    expect(b.fields).toEqual(CAMPOS);
  });

  it('normaliza a contagem de tokens para input/output', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS, { promptTokenCount: 900, candidatesTokenCount: 120 })));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.usage).toEqual({ input_tokens: 900, output_tokens: 120 });
  });

  it('sem metadados de utilização devolve zeros em vez de undefined', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiJson(CAMPOS)));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('aceita JSON embrulhado em ```json', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {
      candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(CAMPOS) + '\n```' }] } }],
    } }));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.ok).toBe(true);
    expect(b.fields.name).toBe('Maria Silva');
  });

  it('junta várias partes de texto antes de interpretar', async () => {
    const txt = JSON.stringify(CAMPOS);
    vi.stubGlobal('fetch', mockFetch({ json: {
      candidates: [{ content: { parts: [{ text: txt.slice(0, 20) }, { text: txt.slice(20) }] } }],
    } }));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.fields).toEqual(CAMPOS);
  });

  it('resposta ilegível devolve ok:false com o texto cru (200, para o ecrã mostrar)', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {
      candidates: [{ content: { parts: [{ text: 'Desculpe, não consigo ler este documento.' }] } }],
    } }));
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.ok).toBe(false);
    expect(b.raw).toContain('não consigo ler');
  });

  it('resposta sem candidatos devolve ok:false em vez de rebentar', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: {} }));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.ok).toBe(false);
  });

  it('candidato sem partes (corte por segurança) devolve ok:false', async () => {
    vi.stubGlobal('fetch', mockFetch({ json: { candidates: [{ finishReason: 'SAFETY' }] } }));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.ok).toBe(false);
  });

  it('502 quando o Gemini responde com erro HTTP', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 429, texto: 'Rate limit exceeded' }));
    const r = await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } });
    expect(r.status).toBe(502);
    expect((await json(r)).error).toContain('429');
  });

  it('a mensagem de erro do Gemini é truncada aos 200 caracteres', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 500, texto: 'x'.repeat(5000) }));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.error.length).toBeLessThan(260);
  });

  it('campos nulos do documento chegam como null e não desaparecem', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage({ ...CAMPOS, email: null, phone: null, process_summary: null })));
    const b = await json(await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'image/png' } }));
    expect(b.fields.email).toBe(null);
    expect('process_summary' in b.fields).toBe(true);
  });

  it('não guarda o documento em lado nenhum (nem R2 nem base de dados)', async () => {
    vi.stubGlobal('fetch', mockFetch(geminiComUsage(CAMPOS)));
    await enviar(env, { binario: imagem(), headers: { 'Content-Type': 'application/pdf' } });
    expect(env.RECIBOS.store.size).toBe(0);
    expect(env.DB.queries).toHaveLength(0);
  });
});
