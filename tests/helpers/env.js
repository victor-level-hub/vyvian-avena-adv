// tests/helpers/env.js
// Ambiente falso do Worker: D1 (SQLite real), R2, KV, Workers AI e um pedido HTTP.

import { FakeD1 } from './d1.js';

// ─── R2 ──────────────────────────────────────────────────────────────────────
export class FakeR2 {
  constructor() { this.store = new Map(); this.falhaNoPut = null; }
  async put(key, value, opts = {}) {
    if (this.falhaNoPut) throw new Error(this.falhaNoPut);
    let buf;
    if (value instanceof ArrayBuffer) buf = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) buf = new Uint8Array(value.buffer.slice(0));
    else if (typeof value === 'string') buf = new TextEncoder().encode(value);
    else if (value && typeof value.getReader === 'function') buf = await lerStream(value);
    else buf = new Uint8Array(0);
    this.store.set(key, {
      bytes: buf,
      contentType: opts?.httpMetadata?.contentType || null,
      customMetadata: opts?.customMetadata || {},
    });
    return { key, size: buf.byteLength };
  }
  async get(key) {
    const rec = this.store.get(key);
    if (!rec) return null;
    return {
      key,
      size: rec.bytes.byteLength,
      httpMetadata: { contentType: rec.contentType },
      customMetadata: rec.customMetadata || {},
      get body() { return novoStream(rec.bytes); },
      arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength),
      text: async () => new TextDecoder().decode(rec.bytes),
    };
  }
  // metadados sem corpo (o R2 real devolve null quando a chave não existe)
  async head(key) {
    const rec = this.store.get(key);
    if (!rec) return null;
    return {
      key,
      size: rec.bytes.byteLength,
      httpMetadata: { contentType: rec.contentType },
      customMetadata: rec.customMetadata || {},
    };
  }
  async delete(key) { this.store.delete(key); }
  async list() { return { objects: [...this.store.keys()].map((key) => ({ key })) }; }
}

function novoStream(bytes) {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}
async function lerStream(rs) {
  const partes = []; const reader = rs.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; partes.push(value); }
  const total = partes.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total); let off = 0;
  for (const p of partes) { out.set(p, off); off += p.byteLength; }
  return out;
}

// ─── KV ──────────────────────────────────────────────────────────────────────
export class FakeKV {
  constructor(inicial = {}) {
    this.store = new Map(Object.entries(inicial));
    this.puts = [];
  }
  async get(key, tipo) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    if (tipo === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value, opts) {
    this.puts.push({ key, value, opts });
    this.store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  async delete(key) { this.store.delete(key); }
}

// ─── Workers AI ──────────────────────────────────────────────────────────────
export class FakeAI {
  constructor(resposta = { text: 'transcrição de teste' }) {
    this.resposta = resposta; this.chamadas = [];
  }
  async run(modelo, args) {
    this.chamadas.push({ modelo, args });
    if (this.resposta instanceof Error) throw this.resposta;
    return typeof this.resposta === 'function' ? this.resposta(modelo, args) : this.resposta;
  }
}

// ─── env completo ────────────────────────────────────────────────────────────
export function criarEnv(extra = {}) {
  return {
    DB: new FakeD1(),
    RECIBOS: new FakeR2(),
    SESSIONS: new FakeKV(),
    AI: new FakeAI(),
    JWT_SECRET: 'segredo-de-teste-1234567890',
    ADMIN_EMAIL: 'dra@exemplo.pt',
    GEMINI_API_KEY: 'chave-gemini-de-teste',
    RESEND_API_KEY: 'chave-resend-de-teste',
    ...extra,
  };
}

// ─── pedidos HTTP ────────────────────────────────────────────────────────────
export function req(metodo, caminho, { body, headers = {}, binario } = {}) {
  const url = caminho.startsWith('http') ? caminho : `https://exemplo.pt${caminho}`;
  const init = { method: metodo, headers: { ...headers } };
  if (binario !== undefined) {
    init.body = binario;
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
  }
  return new Request(url, init);
}

export async function json(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { __texto: txt }; }
}

// ─── fetch controlado ────────────────────────────────────────────────────────
// respostas: array de { status?, json?, texto?, erro? } consumidas por ordem,
// ou uma função (url, init) => resposta.
export function mockFetch(respostas) {
  const chamadas = [];
  let i = 0;
  const fn = async (url, init = {}) => {
    chamadas.push({ url: String(url), init, body: init.body });
    const r = typeof respostas === 'function'
      ? respostas(String(url), init)
      : (Array.isArray(respostas) ? respostas[Math.min(i++, respostas.length - 1)] : respostas);
    if (!r) throw new Error('mockFetch: sem resposta configurada para ' + url);
    if (r.erro) throw new Error(r.erro);
    const corpo = r.texto !== undefined ? r.texto : JSON.stringify(r.json ?? {});
    return new Response(corpo, {
      status: r.status ?? 200,
      headers: { 'Content-Type': r.texto !== undefined ? 'text/plain' : 'application/json', ...(r.headers || {}) },
    });
  };
  fn.chamadas = chamadas;
  return fn;
}

// Resposta do Gemini no formato que as rotas esperam.
export function geminiJson(objeto) {
  return { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(objeto) }] } }] } };
}
