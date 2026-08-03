// tests/helpers/harness.test.js
// Testa o próprio harness — se o D1 falso mentir, todos os outros testes mentem.
import { describe, it, expect } from 'vitest';
import { FakeD1 } from './d1.js';
import { FakeR2, FakeKV, criarEnv, mockFetch, req, json } from './env.js';

describe('FakeD1 (SQLite real)', () => {
  it('aplica todas as migrações do projeto sem erro', () => {
    const db = new FakeD1();
    const tabelas = db.linhas(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tabelas).toEqual(expect.arrayContaining(['tickets', 'ticket_anexos', 'ticket_log', 'keyword_bank', 'ig_posts']));
  });

  it('first() devolve null quando não há linha', async () => {
    const db = new FakeD1();
    expect(await db.prepare(`SELECT * FROM tickets WHERE id = ?`).bind('AT-9999-999').first()).toBe(null);
  });

  it('all() devolve { results: [] } e não undefined', async () => {
    const db = new FakeD1();
    expect(await db.prepare(`SELECT * FROM tickets`).all()).toMatchObject({ results: [] });
  });

  it('run() reporta as linhas alteradas', async () => {
    const db = new FakeD1();
    await db.prepare(`INSERT INTO tickets (id, titulo, criado_por) VALUES (?, ?, ?)`).bind('AT-2026-001', 'T', 'Victor').run();
    const r = await db.prepare(`UPDATE tickets SET titulo = ? WHERE id = ?`).bind('T2', 'AT-2026-001').run();
    expect(r.meta.changes).toBe(1);
  });

  it('suporta RETURNING * no run()', async () => {
    const db = new FakeD1();
    await db.prepare(`INSERT INTO tickets (id, titulo, criado_por) VALUES ('AT-2026-001','T','V')`).run();
    const row = await db.prepare(
      `INSERT INTO ticket_anexos (ticket_id, tipo, nome, r2_key) VALUES (?,?,?,?) RETURNING *`
    ).bind('AT-2026-001', 'anexo', 'a.png', 'k').first();
    expect(row).toMatchObject({ ticket_id: 'AT-2026-001', tipo: 'anexo', nome: 'a.png' });
    expect(row.id).toBeTypeOf('number');
  });

  it('converte undefined em NULL como o D1 faz', async () => {
    const db = new FakeD1();
    await db.prepare(`INSERT INTO tickets (id, titulo, criado_por, data_prazo) VALUES (?,?,?,?)`)
      .bind('AT-2026-001', 'T', 'V', undefined).run();
    expect(db.linha(`SELECT data_prazo FROM tickets`).data_prazo).toBe(null);
  });

  it('impõe restrições reais (NOT NULL rebenta)', async () => {
    const db = new FakeD1();
    await expect(
      db.prepare(`INSERT INTO tickets (id, criado_por) VALUES (?, ?)`).bind('AT-2026-001', 'V').run()
    ).rejects.toThrow();
  });

  it('impõe chaves estrangeiras', async () => {
    const db = new FakeD1();
    await expect(
      db.prepare(`INSERT INTO ticket_log (ticket_id, evento) VALUES ('AT-0000-000','x')`).run()
    ).rejects.toThrow();
  });

  it('batch() aplica tudo e reverte em bloco se falhar', async () => {
    const db = new FakeD1();
    await db.prepare(`INSERT INTO tickets (id, titulo, criado_por) VALUES ('AT-2026-001','T','V')`).run();
    await expect(db.batch([
      db.prepare(`INSERT INTO ticket_log (ticket_id, evento) VALUES ('AT-2026-001','ok')`),
      db.prepare(`INSERT INTO ticket_log (ticket_id, evento) VALUES ('AT-INEXISTENTE','mau')`),
    ])).rejects.toThrow();
    expect(db.conta('ticket_log')).toBe(0);
  });
});

describe('FakeR2', () => {
  it('guarda e devolve os mesmos bytes', async () => {
    const r2 = new FakeR2();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await r2.put('k', bytes.buffer, { httpMetadata: { contentType: 'image/png' } });
    const obj = await r2.get('k');
    expect(new Uint8Array(await obj.arrayBuffer())).toEqual(bytes);
    expect(obj.httpMetadata.contentType).toBe('image/png');
  });

  it('devolve null para chave inexistente', async () => {
    expect(await new FakeR2().get('nao-existe')).toBe(null);
  });

  it('body é legível como stream', async () => {
    const r2 = new FakeR2();
    await r2.put('k', 'olá');
    const res = new Response((await r2.get('k')).body);
    expect(await res.text()).toBe('olá');
  });

  it('delete remove mesmo', async () => {
    const r2 = new FakeR2();
    await r2.put('k', 'x');
    await r2.delete('k');
    expect(await r2.get('k')).toBe(null);
  });
});

describe('FakeKV', () => {
  it('get com "json" desserializa', async () => {
    const kv = new FakeKV();
    await kv.put('ig:token', JSON.stringify({ access_token: 'abc' }));
    expect(await kv.get('ig:token', 'json')).toEqual({ access_token: 'abc' });
  });

  it('get com "json" sobre lixo devolve null em vez de rebentar', async () => {
    const kv = new FakeKV({ 'x': 'não é json' });
    expect(await kv.get('x', 'json')).toBe(null);
  });

  it('chave inexistente devolve null', async () => {
    expect(await new FakeKV().get('nada')).toBe(null);
  });
});

describe('utilitários de pedido', () => {
  it('req monta o URL absoluto e o corpo JSON', async () => {
    const r = req('POST', '/api/apoio/tickets', { body: { titulo: 'x' } });
    expect(r.method).toBe('POST');
    expect(new URL(r.url).pathname).toBe('/api/apoio/tickets');
    expect(await r.json()).toEqual({ titulo: 'x' });
  });

  it('json() não rebenta com respostas não-JSON', async () => {
    expect(await json(new Response('texto solto'))).toEqual({ __texto: 'texto solto' });
  });

  it('mockFetch consome respostas por ordem e regista chamadas', async () => {
    const f = mockFetch([{ json: { a: 1 } }, { status: 500, texto: 'boom' }]);
    expect(await (await f('https://x/1')).json()).toEqual({ a: 1 });
    const r2 = await f('https://x/2');
    expect(r2.status).toBe(500);
    expect(f.chamadas.map((c) => c.url)).toEqual(['https://x/1', 'https://x/2']);
  });
});

describe('criarEnv', () => {
  it('traz DB, R2, KV e segredos prontos', () => {
    const env = criarEnv();
    expect(env.DB).toBeInstanceOf(FakeD1);
    expect(env.JWT_SECRET).toBeTruthy();
  });

  it('deixa sobrepor/remover bindings (ex.: simular AI em falta)', () => {
    expect(criarEnv({ AI: undefined }).AI).toBeUndefined();
  });
});
