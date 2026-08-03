// tests/worker/response.test.js — jsonResponse / jsonError
import { describe, it, expect } from 'vitest';
import { jsonResponse, jsonError } from '../../worker/lib/response.js';
import { json } from '../helpers/env.js';

describe('jsonResponse', () => {
  it('devolve 200 por omissão', async () => {
    const r = jsonResponse({ ok: true });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true });
  });

  it('respeita o status indicado', () => {
    expect(jsonResponse({}, 201).status).toBe(201);
    expect(jsonResponse({}, 202).status).toBe(202);
    expect(jsonResponse({}, 200).status).toBe(200);
  });

  // Mina por armar: jsonResponse escreve sempre corpo, e 204/304 proíbem-no.
  // Nenhuma rota usa 204 hoje; este teste avisa quem for tentado a usá-lo.
  it('rebenta com 204/304 porque escreve sempre corpo', () => {
    expect(() => jsonResponse({}, 204)).toThrow(/status code/i);
    expect(() => jsonResponse({}, 304)).toThrow(/status code/i);
  });

  it('declara JSON em UTF-8 (acentos não saem partidos)', async () => {
    const r = jsonResponse({ msg: 'Título com acentuação e ç' });
    expect(r.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect((await json(r)).msg).toBe('Título com acentuação e ç');
  });

  it('inclui os cabeçalhos CORS', () => {
    const r = jsonResponse({});
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('deixa acrescentar cabeçalhos extra', () => {
    const r = jsonResponse({}, 200, { 'X-Teste': 'sim' });
    expect(r.headers.get('X-Teste')).toBe('sim');
  });

  it('cabeçalhos extra sobrepõem-se aos CORS por omissão', () => {
    const r = jsonResponse({}, 200, { 'Access-Control-Allow-Origin': 'https://vyavenaadv.com' });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://vyavenaadv.com');
  });

  it('serializa null, arrays e objetos aninhados', async () => {
    expect(await json(jsonResponse(null))).toBe(null);
    expect(await json(jsonResponse([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(await json(jsonResponse({ a: { b: [{ c: 1 }] } }))).toEqual({ a: { b: [{ c: 1 }] } });
  });

  it('descarta undefined tal como o JSON.stringify (documenta o comportamento)', async () => {
    const body = await json(jsonResponse({ a: undefined, b: 1 }));
    expect(body).toEqual({ b: 1 });
    expect('a' in body).toBe(false);
  });
});

describe('jsonError', () => {
  it('devolve 400 por omissão com a mensagem no campo error', async () => {
    const r = jsonError('Título obrigatório.');
    expect(r.status).toBe(400);
    expect(await json(r)).toEqual({ error: 'Título obrigatório.' });
  });

  it.each([401, 403, 404, 405, 413, 502, 503])('propaga o status %i', async (s) => {
    expect(jsonError('x', s).status).toBe(s);
  });

  it('junta campos extra ao corpo', async () => {
    const r = jsonError('Falhou', 502, { detalhe: 'timeout', tentativas: 3 });
    expect(await json(r)).toEqual({ error: 'Falhou', detalhe: 'timeout', tentativas: 3 });
  });

  it('um campo extra chamado error sobrepõe a mensagem (armadilha conhecida)', async () => {
    const r = jsonError('original', 400, { error: 'substituída' });
    expect((await json(r)).error).toBe('substituída');
  });

  it('mantém os CORS nas respostas de erro', () => {
    expect(jsonError('x', 500).headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
