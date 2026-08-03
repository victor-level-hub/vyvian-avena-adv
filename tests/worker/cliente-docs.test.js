// tests/worker/cliente-docs.test.js
// Documentos enviados pelo CLIENTE por link tokenizado — worker/routes/cliente_docs.js.
// Área sensível: qualquer pessoa com o link escreve no R2 do escritório.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleUploadTokens, handleClientDocuments, handlePublicUpload } from '../../worker/routes/cliente_docs.js';
import { criarEnv, req, json, mockFetch } from '../helpers/env.js';

const SESSAO = { sub: 1, name: 'Victor', email: 'v@exemplo.pt', role: 'admin' };

// bytes com a assinatura certa de cada formato
const PDF = () => bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = () => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = () => bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = () => bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const LIXO = () => bytes([0, 1, 2, 3, 4, 5, 6, 7]);
function bytes(arr, tamanho = 0) {
  const u8 = new Uint8Array(Math.max(arr.length, tamanho));
  u8.set(arr);
  return u8.buffer;
}

// ATENÇÃO — LACUNA NO REPOSITÓRIO (descoberta por estes testes):
// `upload_tokens` e `client_documents` NÃO têm migração em migrations/. As tabelas
// só existem na base de dados de produção (criadas à mão em algum momento). Se o D1
// fosse reconstruído a partir de migrations/, o envio de documentos pelo cliente
// deixava de funcionar. O esquema abaixo foi deduzido das colunas que
// worker/routes/cliente_docs.js lê e escreve — serve para os testes correrem, mas a
// correção certa é criar uma migração a sério (ver o resumo da sessão).
const ESQUEMA_EM_FALTA = `
CREATE TABLE IF NOT EXISTS upload_tokens (
  token        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id),
  instructions TEXT,
  expires_at   TEXT NOT NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  used_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS client_documents (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id),
  filename     TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_via TEXT,
  token        TEXT
);`;

let env;
beforeEach(async () => {
  env = criarEnv();
  env.DB.exec(ESQUEMA_EM_FALTA);
  await env.DB.prepare(`INSERT INTO clients (id, name, email, country) VALUES (?, ?, ?, ?)`)
    .bind('cli-1', 'Maria Silva', 'maria@exemplo.pt', 'PT').run();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// cria um token de upload válido e devolve-o
async function criarToken(extra = {}) {
  const r = await handleUploadTokens(
    req('POST', '/api/upload-tokens', { body: { client_id: 'cli-1', ...extra } }), env, '/api/upload-tokens', SESSAO);
  return (await json(r)).token;
}
const upload = (token, corpo, ct, nome) =>
  handlePublicUpload(
    req('POST', `/api/public/upload/${token}`, {
      binario: corpo,
      headers: { 'Content-Type': ct, ...(nome ? { 'X-Filename': nome } : {}) },
    }),
    env, `/api/public/upload/${token}`);

// ─── geração de tokens (admin) ───────────────────────────────────────────────
describe('POST /api/upload-tokens', () => {
  it('gera um token para um cliente existente', async () => {
    const r = await handleUploadTokens(
      req('POST', '/api/upload-tokens', { body: { client_id: 'cli-1' } }), env, '/api/upload-tokens', SESSAO);
    const b = await json(r);
    expect(b.ok).toBe(true);
    expect(b.client).toEqual({ id: 'cli-1', name: 'Maria Silva' });
    expect(b.days).toBe(30);
  });

  it('o token é longo e imprevisível (base64url de 32 bytes)', async () => {
    const t1 = await criarToken();
    const t2 = await criarToken();
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t1).not.toBe(t2);
  });

  it('recusa sem client_id', async () => {
    const r = await handleUploadTokens(
      req('POST', '/api/upload-tokens', { body: {} }), env, '/api/upload-tokens', SESSAO);
    expect(r.status).toBe(400);
  });

  it('404 para cliente inexistente', async () => {
    const r = await handleUploadTokens(
      req('POST', '/api/upload-tokens', { body: { client_id: 'nao-existe' } }), env, '/api/upload-tokens', SESSAO);
    expect(r.status).toBe(404);
  });

  it('recusa JSON inválido com 400', async () => {
    const r = await handleUploadTokens(
      req('POST', '/api/upload-tokens', { body: '{isto não é json', headers: { 'Content-Type': 'application/json' } }),
      env, '/api/upload-tokens', SESSAO);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Invalid JSON');
  });

  it.each([
    [1, 1], [45, 45], [90, 90],
    [0, 30],        // 0 é falsy → cai no default
    [-5, 1],        // negativo é limitado ao mínimo
    [1000, 90],     // acima do máximo é limitado a 90
    ['abc', 30],    // não numérico → default
    [null, 30],
  ])('dias=%s guarda validade de %i dias', async (dias, esperado) => {
    const r = await handleUploadTokens(
      req('POST', '/api/upload-tokens', { body: { client_id: 'cli-1', days: dias } }), env, '/api/upload-tokens', SESSAO);
    expect((await json(r)).days).toBe(esperado);
  });

  it('guarda as instruções para o cliente', async () => {
    await criarToken({ instructions: 'Envie o cartão de cidadão, frente e verso.' });
    expect(env.DB.linha(`SELECT instructions FROM upload_tokens`).instructions)
      .toBe('Envie o cartão de cidadão, frente e verso.');
  });

  it('instruções vazias ficam NULL', async () => {
    await criarToken({ instructions: '' });
    expect(env.DB.linha(`SELECT instructions FROM upload_tokens`).instructions).toBe(null);
  });

  // BUG: o payload do JWT tem sub/email/name/initials/role (worker/routes/auth.js:63-71),
  // nunca `user`. Logo `session?.user` é sempre undefined e o created_by fica NULL —
  // perde-se o rasto de quem criou o link de upload. Devia ser session?.email ou session?.sub.
  it.fails('regista quem criou o link (created_by)', async () => {
    await criarToken();
    expect(env.DB.linha(`SELECT created_by FROM upload_tokens`).created_by).toBe('v@exemplo.pt');
  });
});

describe('GET /api/upload-tokens', () => {
  it('lista os tokens do cliente, mais recentes primeiro', async () => {
    await criarToken({ instructions: 'primeiro' });
    await criarToken({ instructions: 'segundo' });
    const r = await handleUploadTokens(
      req('GET', '/api/upload-tokens?client_id=cli-1'), env, '/api/upload-tokens', SESSAO);
    expect((await json(r)).tokens).toHaveLength(2);
  });

  it('não devolve tokens de outro cliente', async () => {
    await criarToken();
    const r = await handleUploadTokens(
      req('GET', '/api/upload-tokens?client_id=cli-outro'), env, '/api/upload-tokens', SESSAO);
    expect((await json(r)).tokens).toEqual([]);
  });

  it('exige client_id', async () => {
    const r = await handleUploadTokens(req('GET', '/api/upload-tokens'), env, '/api/upload-tokens', SESSAO);
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/upload-tokens/:token', () => {
  it('revoga o token', async () => {
    const t = await criarToken();
    const r = await handleUploadTokens(
      req('DELETE', `/api/upload-tokens/${t}`), env, `/api/upload-tokens/${t}`, SESSAO);
    expect(r.status).toBe(200);
    expect(env.DB.linha(`SELECT revoked FROM upload_tokens WHERE token = ?`, t).revoked).toBe(1);
  });

  it('revogar duas vezes é idempotente', async () => {
    const t = await criarToken();
    for (let i = 0; i < 2; i++) {
      await handleUploadTokens(req('DELETE', `/api/upload-tokens/${t}`), env, `/api/upload-tokens/${t}`, SESSAO);
    }
    expect(env.DB.linha(`SELECT revoked FROM upload_tokens WHERE token = ?`, t).revoked).toBe(1);
  });

  it('responde ok mesmo para um token que não existe (documenta o comportamento)', async () => {
    const r = await handleUploadTokens(
      req('DELETE', '/api/upload-tokens/inexistente'), env, '/api/upload-tokens/inexistente', SESSAO);
    expect(r.status).toBe(200);
  });

  it('método não suportado devolve 405', async () => {
    const r = await handleUploadTokens(req('PUT', '/api/upload-tokens'), env, '/api/upload-tokens', SESSAO);
    expect(r.status).toBe(405);
  });
});

// ─── página pública do link ──────────────────────────────────────────────────
describe('GET /api/public/upload/:token (info)', () => {
  it('devolve o destinatário e os limites, sem sessão', async () => {
    const t = await criarToken({ instructions: 'Envie o CC' });
    const r = await handlePublicUpload(req('GET', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`);
    const b = await json(r);
    expect(b).toMatchObject({ ok: true, client_name: 'Maria Silva', instructions: 'Envie o CC' });
    expect(b.max_bytes).toBe(15 * 1024 * 1024);
    expect(b.allowed).toContain('application/pdf');
  });

  it('não expõe dados do cliente além do nome', async () => {
    const t = await criarToken();
    const b = await json(await handlePublicUpload(req('GET', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`));
    expect(JSON.stringify(b)).not.toContain('maria@exemplo.pt');
  });

  it('404 para token inexistente', async () => {
    const r = await handlePublicUpload(req('GET', '/api/public/upload/xyz'), env, '/api/public/upload/xyz');
    expect(r.status).toBe(404);
  });

  it('400 quando não vem token nenhum', async () => {
    const r = await handlePublicUpload(req('GET', '/api/public/upload/'), env, '/api/public/upload/');
    expect(r.status).toBe(400);
  });

  it('410 para token revogado', async () => {
    const t = await criarToken();
    await env.DB.prepare(`UPDATE upload_tokens SET revoked = 1 WHERE token = ?`).bind(t).run();
    const r = await handlePublicUpload(req('GET', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`);
    expect(r.status).toBe(410);
  });

  it('410 para token expirado', async () => {
    const t = await criarToken();
    await env.DB.prepare(`UPDATE upload_tokens SET expires_at = ? WHERE token = ?`)
      .bind('2020-01-01T00:00:00.000Z', t).run();
    const r = await handlePublicUpload(req('GET', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`);
    expect(r.status).toBe(410);
  });

  it('lista os ficheiros já enviados com aquele link', async () => {
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'contrato.pdf');
    const b = await json(await handlePublicUpload(req('GET', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`));
    expect(b.uploaded).toHaveLength(1);
    expect(b.uploaded[0].filename).toBe('contrato.pdf');
  });

  it('OPTIONS responde com os cabeçalhos CORS públicos', async () => {
    const r = await handlePublicUpload(req('OPTIONS', '/api/public/upload/x'), env, '/api/public/upload/x');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('X-Filename');
  });

  it('método não suportado devolve 405 com CORS', async () => {
    const t = await criarToken();
    const r = await handlePublicUpload(req('DELETE', `/api/public/upload/${t}`), env, `/api/public/upload/${t}`);
    expect(r.status).toBe(405);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ─── envio de ficheiro ───────────────────────────────────────────────────────
describe('POST /api/public/upload/:token', () => {
  it('aceita um PDF e grava no R2 e na base de dados', async () => {
    const t = await criarToken();
    const r = await upload(t, PDF(), 'application/pdf', 'procuracao.pdf');
    const b = await json(r);
    expect(b.ok).toBe(true);
    expect(b.filename).toBe('procuracao.pdf');
    const doc = env.DB.linha(`SELECT * FROM client_documents`);
    expect(doc).toMatchObject({ client_id: 'cli-1', content_type: 'application/pdf', uploaded_via: 'client-link' });
    expect(await env.RECIBOS.get(doc.r2_key)).not.toBe(null);
  });

  it.each([
    ['application/pdf', PDF],
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ])('aceita %s com a assinatura correta', async (ct, fabrica) => {
    const t = await criarToken();
    expect((await upload(t, fabrica(), ct, 'f')).status).toBe(200);
  });

  it('aceita o content-type com parâmetros (charset) e maiúsculas', async () => {
    const t = await criarToken();
    expect((await upload(t, PDF(), 'APPLICATION/PDF; charset=binary', 'f.pdf')).status).toBe(200);
  });

  it.each(['text/html', 'application/zip', 'application/x-msdownload', 'text/plain', ''])(
    'recusa o tipo %s com 415', async (ct) => {
      const t = await criarToken();
      expect((await upload(t, PDF(), ct || 'application/octet-stream', 'x')).status).toBe(415);
    });

  it('recusa conteúdo que não bate com o tipo declarado (415)', async () => {
    const t = await criarToken();
    const r = await upload(t, LIXO(), 'application/pdf', 'falso.pdf');
    expect(r.status).toBe(415);
    expect((await json(r)).error).toContain('não corresponde');
  });

  it('recusa um executável disfarçado de PNG', async () => {
    const t = await criarToken();
    const mz = bytes([0x4d, 0x5a, 0x90, 0x00]); // cabeçalho MZ de .exe
    expect((await upload(t, mz, 'image/png', 'foto.png')).status).toBe(415);
  });

  it('recusa ficheiro vazio com 400', async () => {
    const t = await criarToken();
    expect((await upload(t, new ArrayBuffer(0), 'application/pdf', 'v.pdf')).status).toBe(400);
  });

  it('aceita exatamente no limite de 15 MB', async () => {
    const t = await criarToken();
    const b = bytes([0x25, 0x50, 0x44, 0x46], 15 * 1024 * 1024);
    expect((await upload(t, b, 'application/pdf', 'grande.pdf')).status).toBe(200);
  });

  it('recusa 1 byte acima do limite com 413', async () => {
    const t = await criarToken();
    const b = bytes([0x25, 0x50, 0x44, 0x46], 15 * 1024 * 1024 + 1);
    expect((await upload(t, b, 'application/pdf', 'enorme.pdf')).status).toBe(413);
  });

  it('não aceita envios com token revogado', async () => {
    const t = await criarToken();
    await env.DB.prepare(`UPDATE upload_tokens SET revoked = 1 WHERE token = ?`).bind(t).run();
    expect((await upload(t, PDF(), 'application/pdf', 'x.pdf')).status).toBe(410);
    expect(env.DB.conta('client_documents')).toBe(0);
  });

  it('não aceita envios com token expirado', async () => {
    const t = await criarToken();
    await env.DB.prepare(`UPDATE upload_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token = ?`).bind(t).run();
    expect((await upload(t, PDF(), 'application/pdf', 'x.pdf')).status).toBe(410);
  });

  it('incrementa o contador de utilizações do link', async () => {
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'a.pdf');
    await upload(t, PNG(), 'image/png', 'b.png');
    const row = env.DB.linha(`SELECT used_count, last_used_at FROM upload_tokens WHERE token = ?`, t);
    expect(row.used_count).toBe(2);
    expect(row.last_used_at).toBeTruthy();
  });

  it.each([
    ['../../etc/passwd', '.._.._etc_passwd'],
    ['contrato final.pdf', 'contrato final.pdf'],
    ['certidão-de-nascimento.pdf', 'certidão-de-nascimento.pdf'],
    ['a<script>b.pdf', 'a_script_b.pdf'],
    ['ficheiro"aspas".pdf', 'ficheiro_aspas_.pdf'],
    ['C:\\Users\\x\\doc.pdf', 'C__Users_x_doc.pdf'],
  ])('sanitiza o nome %s', async (dado, esperado) => {
    const t = await criarToken();
    const b = await json(await upload(t, PDF(), 'application/pdf', dado));
    expect(b.filename).toBe(esperado);
  });

  it('corta nomes muito longos aos 120 caracteres', async () => {
    const t = await criarToken();
    const b = await json(await upload(t, PDF(), 'application/pdf', 'a'.repeat(300) + '.pdf'));
    expect(b.filename).toHaveLength(120);
  });

  it('sem X-Filename usa um nome derivado do tipo', async () => {
    const t = await criarToken();
    const b = await json(await upload(t, PNG(), 'image/png'));
    expect(b.filename).toBe('documento.png');
  });

  it('a chave do R2 fica dentro da pasta do cliente', async () => {
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', '../../fuga.pdf');
    expect(env.DB.linha(`SELECT r2_key FROM client_documents`).r2_key).toMatch(/^documentos\/cli-1\//);
  });

  it('dois ficheiros com o mesmo nome não se sobrepõem no R2', async () => {
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'igual.pdf');
    await upload(t, PDF(), 'application/pdf', 'igual.pdf');
    expect(env.RECIBOS.store.size).toBe(2);
  });

  it('avisa a Dra. por e-mail quando o cliente envia', async () => {
    const f = mockFetch({ json: { id: 'email-1' } });
    vi.stubGlobal('fetch', f);
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'contrato.pdf');
    await new Promise((r) => setTimeout(r, 0)); // o envio é disparado sem await
    expect(f.chamadas.some((c) => c.url.includes('resend.com'))).toBe(true);
  });

  it('não avisa quando não há e-mail de administração configurado', async () => {
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    env.ADMIN_EMAIL = '';
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'x.pdf');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.chamadas).toHaveLength(0);
  });

  it('falha no e-mail não estraga o upload', async () => {
    vi.stubGlobal('fetch', mockFetch({ erro: 'rede em baixo' }));
    const t = await criarToken();
    const r = await upload(t, PDF(), 'application/pdf', 'x.pdf');
    expect(r.status).toBe(200);
    expect(env.DB.conta('client_documents')).toBe(1);
  });

  it('sem armazenamento configurado devolve 500 e não grava metadados órfãos', async () => {
    const t = await criarToken();
    env.RECIBOS = null;
    expect((await upload(t, PDF(), 'application/pdf', 'x.pdf')).status).toBe(500);
    expect(env.DB.conta('client_documents')).toBe(0);
  });
});

// ─── consulta dos documentos (admin) ─────────────────────────────────────────
describe('/api/client-documents', () => {
  async function comDocumento() {
    const t = await criarToken();
    await upload(t, PDF(), 'application/pdf', 'contrato.pdf');
    return env.DB.linha(`SELECT * FROM client_documents`);
  }

  it('lista os documentos de um cliente', async () => {
    await comDocumento();
    const r = await handleClientDocuments(
      req('GET', '/api/client-documents?client_id=cli-1'), env, '/api/client-documents', SESSAO);
    expect((await json(r)).documents).toHaveLength(1);
  });

  it('a listagem não expõe a chave do R2', async () => {
    await comDocumento();
    const b = await json(await handleClientDocuments(
      req('GET', '/api/client-documents?client_id=cli-1'), env, '/api/client-documents', SESSAO));
    expect(b.documents[0].r2_key).toBeUndefined();
  });

  it('exige client_id na listagem', async () => {
    const r = await handleClientDocuments(req('GET', '/api/client-documents'), env, '/api/client-documents', SESSAO);
    expect(r.status).toBe(400);
  });

  it('serve o ficheiro com o tipo e o nome originais', async () => {
    const doc = await comDocumento();
    const r = await handleClientDocuments(
      req('GET', `/api/client-documents/${doc.id}`), env, `/api/client-documents/${doc.id}`, SESSAO);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(r.headers.get('Content-Disposition')).toContain('contrato.pdf');
    expect(r.headers.get('Cache-Control')).toContain('private');
  });

  it('404 para documento inexistente', async () => {
    const r = await handleClientDocuments(
      req('GET', '/api/client-documents/nao-existe'), env, '/api/client-documents/nao-existe', SESSAO);
    expect(r.status).toBe(404);
  });

  it('404 quando o registo existe mas o ficheiro desapareceu do R2', async () => {
    const doc = await comDocumento();
    await env.RECIBOS.delete(doc.r2_key);
    const r = await handleClientDocuments(
      req('GET', `/api/client-documents/${doc.id}`), env, `/api/client-documents/${doc.id}`, SESSAO);
    expect(r.status).toBe(404);
  });

  it('apagar remove do R2 e da base de dados', async () => {
    const doc = await comDocumento();
    const r = await handleClientDocuments(
      req('DELETE', `/api/client-documents/${doc.id}`), env, `/api/client-documents/${doc.id}`, SESSAO);
    expect(r.status).toBe(200);
    expect(env.DB.conta('client_documents')).toBe(0);
    expect(await env.RECIBOS.get(doc.r2_key)).toBe(null);
  });

  it('apagar um documento inexistente devolve 404', async () => {
    const r = await handleClientDocuments(
      req('DELETE', '/api/client-documents/nada'), env, '/api/client-documents/nada', SESSAO);
    expect(r.status).toBe(404);
  });

  it('método não suportado devolve 405', async () => {
    const r = await handleClientDocuments(
      req('PATCH', '/api/client-documents/1'), env, '/api/client-documents/1', SESSAO);
    expect(r.status).toBe(405);
  });
});
