// tests/worker/recibos.test.js
// Arquivo de recibos por parcela — worker/routes/recibos.js.
// A Dra. anexa o Recibo Verde emitido na AT; o sistema guarda-o no R2 e envia-o
// ao cliente. Rasto financeiro: enganos aqui chegam ao cliente por e-mail.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleRecibos } from '../../worker/routes/recibos.js';
import { criarEnv, req, json, mockFetch } from '../helpers/env.js';

const SESSAO = { sub: 1, name: 'Victor' };
const ID = 'parc-1';

const pdf = (n = 32) => {
  const u8 = new Uint8Array(Math.max(n, 8));
  u8.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
  return u8.buffer;
};
const naoPdf = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer; // ZIP

const rota = (caminho, opts) => handleRecibos(req(opts?.metodo || 'GET', caminho, opts), env, caminho.split('?')[0], SESSAO);
const enviarPdf = (caminho, corpo = pdf(), ct = 'application/pdf', extra = {}) =>
  handleRecibos(
    req('PUT', caminho, { binario: corpo, headers: { 'Content-Type': ct, ...extra } }),
    env, caminho.split('?')[0], SESSAO);

let env;
beforeEach(async () => {
  env = criarEnv();
  await env.DB.prepare(`INSERT INTO clients (id, name, email, country) VALUES (?,?,?,?)`)
    .bind('cli-1', 'Maria Silva', 'maria@exemplo.pt', 'PT').run();
  await env.DB.prepare(
    `INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
     VALUES (?,?,?,?,?,?)`
  ).bind(ID, 'cli-1', 2, 6, 250.5, '2026-09-10').run();
});
afterEach(() => { vi.unstubAllGlobals(); });

// ─── encaminhamento e validações ─────────────────────────────────────────────
describe('encaminhamento', () => {
  it('sem ID de parcela devolve 400', async () => {
    const r = await handleRecibos(req('GET', '/api/recibos'), env, '/api/recibos', SESSAO);
    expect(r.status).toBe(400);
  });

  it('404 para parcela inexistente', async () => {
    expect((await rota('/api/recibos/nao-existe?info=true')).status).toBe(404);
  });

  it('404 quando a parcela existe mas o cliente desapareceu', async () => {
    // Só possível com as chaves estrangeiras desligadas — é o cenário que a
    // guarda do código cobre (dados legados ou uma limpeza feita à mão).
    env.DB.exec('PRAGMA foreign_keys = OFF');
    await env.DB.prepare(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, due_date)
      VALUES ('orfa','cli-fantasma',1,1,10,'2026-01-01')`).run();
    env.DB.exec('PRAGMA foreign_keys = ON');
    const r = await rota('/api/recibos/orfa?info=true');
    expect(r.status).toBe(404);
    expect((await json(r)).error).toContain('Cliente');
  });

  it.each(['PATCH', 'HEAD'])('método %s devolve 405', async (m) => {
    expect((await rota(`/api/recibos/${ID}`, { metodo: m })).status).toBe(405);
  });
});

// ─── upload ──────────────────────────────────────────────────────────────────
describe('PUT — anexar documento', () => {
  it('aceita um PDF e regista a chave na parcela', async () => {
    const r = await enviarPdf(`/api/recibos/${ID}`);
    const b = await json(r);
    expect(b.ok).toBe(true);
    expect(b.r2_key).toBe(`recibos/cli-1/${ID}.pdf`);
    expect(env.DB.linha(`SELECT receipt_path FROM installments WHERE id = ?`, ID).receipt_path)
      .toBe(`recibos/cli-1/${ID}.pdf`);
    expect(await env.RECIBOS.get(`recibos/cli-1/${ID}.pdf`)).not.toBe(null);
  });

  it.each(['fatura-recibo', 'fatura'])('o tipo %s usa uma chave própria', async (tipo) => {
    const b = await json(await enviarPdf(`/api/recibos/${ID}?tipo=${tipo}`));
    expect(b.r2_key).toBe(`recibos/cli-1/${ID}-${tipo}.pdf`);
  });

  it('só o tipo recibo escreve em receipt_path', async () => {
    await enviarPdf(`/api/recibos/${ID}?tipo=fatura`);
    expect(env.DB.linha(`SELECT receipt_path FROM installments WHERE id = ?`, ID).receipt_path).toBe(null);
  });

  it('tipo desconhecido recai em recibo em vez de rebentar', async () => {
    const b = await json(await enviarPdf(`/api/recibos/${ID}?tipo=inventado`));
    expect(b.tipo).toBe('recibo');
  });

  it('os três tipos convivem sem se sobrepor', async () => {
    for (const t of ['recibo', 'fatura-recibo', 'fatura']) await enviarPdf(`/api/recibos/${ID}?tipo=${t}`);
    expect(env.RECIBOS.store.size).toBe(3);
  });

  it('reenviar o mesmo tipo substitui o anterior', async () => {
    await enviarPdf(`/api/recibos/${ID}`, pdf(100));
    await enviarPdf(`/api/recibos/${ID}`, pdf(200));
    expect(env.RECIBOS.store.size).toBe(1);
    expect((await env.RECIBOS.head(`recibos/cli-1/${ID}.pdf`)).size).toBe(200);
  });

  it.each(['image/png', 'text/plain', 'application/zip', ''])('recusa o content-type "%s" com 415', async (ct) => {
    expect((await enviarPdf(`/api/recibos/${ID}`, pdf(), ct || 'application/octet-stream')).status).toBe(415);
  });

  it('recusa um ficheiro que não é PDF apesar do content-type correto', async () => {
    const r = await enviarPdf(`/api/recibos/${ID}`, naoPdf());
    expect(r.status).toBe(415);
    expect((await json(r)).error).toContain('não é um PDF');
  });

  it('nada é gravado quando o ficheiro é recusado', async () => {
    await enviarPdf(`/api/recibos/${ID}`, naoPdf());
    expect(env.RECIBOS.store.size).toBe(0);
    expect(env.DB.linha(`SELECT receipt_path FROM installments WHERE id = ?`, ID).receipt_path).toBe(null);
  });

  it('recusa ficheiro vazio com 400', async () => {
    expect((await enviarPdf(`/api/recibos/${ID}`, new ArrayBuffer(0))).status).toBe(400);
  });

  it('aceita exatamente no limite de 10 MB', async () => {
    expect((await enviarPdf(`/api/recibos/${ID}`, pdf(10 * 1024 * 1024))).status).toBe(200);
  });

  it('recusa 1 byte acima do limite com 413', async () => {
    expect((await enviarPdf(`/api/recibos/${ID}`, pdf(10 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it('guarda o nome original enviado pelo browser', async () => {
    await enviarPdf(`/api/recibos/${ID}`, pdf(), 'application/pdf', { 'X-Filename': 'RV 2026-09.pdf' });
    expect((await env.RECIBOS.head(`recibos/cli-1/${ID}.pdf`)).customMetadata.original_name).toBe('RV 2026-09.pdf');
  });

  it('sem nome original guarda um nome derivado do tipo', async () => {
    await enviarPdf(`/api/recibos/${ID}?tipo=fatura`);
    expect((await env.RECIBOS.head(`recibos/cli-1/${ID}-fatura.pdf`)).customMetadata.original_name).toBe('fatura.pdf');
  });

  it('sem armazenamento configurado devolve 500', async () => {
    env.RECIBOS = null;
    expect((await enviarPdf(`/api/recibos/${ID}`)).status).toBe(500);
  });
});

// ─── consulta ────────────────────────────────────────────────────────────────
describe('GET — servir e consultar', () => {
  it('serve o PDF anexado com o nome certo', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    const r = await rota(`/api/recibos/${ID}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(r.headers.get('Content-Disposition')).toContain(`recibo-${ID}.pdf`);
    expect(r.headers.get('Cache-Control')).toContain('private');
  });

  it('404 quando não há nada anexado', async () => {
    expect((await rota(`/api/recibos/${ID}`)).status).toBe(404);
  });

  it('info=true diz que não existe sem rebentar', async () => {
    const b = await json(await rota(`/api/recibos/${ID}?info=true`));
    expect(b).toMatchObject({ exists: false, size: null, uploaded_at: null, filename: null });
  });

  it('info=true devolve tamanho, data e nome depois do upload', async () => {
    await enviarPdf(`/api/recibos/${ID}`, pdf(4096), 'application/pdf', { 'X-Filename': 'RV.pdf' });
    const b = await json(await rota(`/api/recibos/${ID}?info=true`));
    expect(b.exists).toBe(true);
    expect(b.size).toBe(4096);
    expect(b.filename).toBe('RV.pdf');
    expect(b.uploaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('info=all devolve os três tipos de uma vez', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    await enviarPdf(`/api/recibos/${ID}?tipo=fatura`, pdf(64));
    const b = await json(await rota(`/api/recibos/${ID}?info=all`));
    expect(b.docs.recibo.exists).toBe(true);
    expect(b.docs.fatura.exists).toBe(true);
    expect(b.docs['fatura-recibo'].exists).toBe(false);
  });

  it('info=all com nada anexado devolve os três a false', async () => {
    const b = await json(await rota(`/api/recibos/${ID}?info=all`));
    expect(Object.values(b.docs).every((d) => d.exists === false)).toBe(true);
  });

  it('respeita o receipt_path guardado quando difere da chave por omissão', async () => {
    await env.RECIBOS.put('recibos/antigo/caminho.pdf', pdf(999), { customMetadata: {} });
    await env.DB.prepare(`UPDATE installments SET receipt_path = 'recibos/antigo/caminho.pdf' WHERE id = ?`).bind(ID).run();
    const b = await json(await rota(`/api/recibos/${ID}?info=true`));
    expect(b.r2_key).toBe('recibos/antigo/caminho.pdf');
    expect(b.size).toBe(999);
  });

  it('info=true funciona mesmo sem armazenamento configurado', async () => {
    env.RECIBOS = null;
    const r = await rota(`/api/recibos/${ID}?info=true`);
    expect(r.status).toBe(200);
    expect((await json(r)).exists).toBe(false);
  });

  it('servir sem armazenamento configurado devolve 500', async () => {
    env.RECIBOS = null;
    expect((await rota(`/api/recibos/${ID}`)).status).toBe(500);
  });
});

// ─── remoção ─────────────────────────────────────────────────────────────────
describe('DELETE — remover', () => {
  it('remove do R2 e limpa o receipt_path', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    const r = await rota(`/api/recibos/${ID}`, { metodo: 'DELETE' });
    expect(r.status).toBe(200);
    expect(env.RECIBOS.store.size).toBe(0);
    expect(env.DB.linha(`SELECT receipt_path FROM installments WHERE id = ?`, ID).receipt_path).toBe(null);
  });

  it('remover uma fatura não mexe no recibo nem no receipt_path', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    await enviarPdf(`/api/recibos/${ID}?tipo=fatura`);
    await rota(`/api/recibos/${ID}?tipo=fatura`, { metodo: 'DELETE' });
    expect(await env.RECIBOS.get(`recibos/cli-1/${ID}.pdf`)).not.toBe(null);
    expect(env.DB.linha(`SELECT receipt_path FROM installments WHERE id = ?`, ID).receipt_path).toBeTruthy();
  });

  it('remover duas vezes é idempotente', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    for (let i = 0; i < 2; i++) {
      expect((await rota(`/api/recibos/${ID}`, { metodo: 'DELETE' })).status).toBe(200);
    }
  });

  it('remover sem nada anexado devolve ok na mesma', async () => {
    expect((await rota(`/api/recibos/${ID}`, { metodo: 'DELETE' })).status).toBe(200);
  });
});

// ─── envio ao cliente ────────────────────────────────────────────────────────
describe('POST /send — enviar o recibo ao cliente', () => {
  const enviar = () => handleRecibos(
    req('POST', `/api/recibos/${ID}/send`), env, `/api/recibos/${ID}/send`, SESSAO);

  it('envia o PDF em anexo para o e-mail do cliente', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    const f = mockFetch({ json: { id: 'email-9' } });
    vi.stubGlobal('fetch', f);
    const b = await json(await enviar());
    expect(b).toMatchObject({ ok: true, sent_to: 'maria@exemplo.pt' });
    const corpo = JSON.parse(f.chamadas[0].body);
    expect(corpo.to).toEqual(['maria@exemplo.pt']);
    expect(corpo.attachments[0].filename).toBe(`recibo-${ID}.pdf`);
    expect(corpo.attachments[0].content.length).toBeGreaterThan(0);
  });

  it('a mensagem identifica a parcela pelo número correto', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    const f = mockFetch({ json: { id: 'e' } });
    vi.stubGlobal('fetch', f);
    await enviar();
    expect(JSON.parse(f.chamadas[0].body).text).toContain('parcela 2/6');
  });

  it('trata o cliente pelo nome', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    const f = mockFetch({ json: { id: 'e' } });
    vi.stubGlobal('fetch', f);
    await enviar();
    expect(JSON.parse(f.chamadas[0].body).text).toContain('Maria Silva');
  });

  it('regista o envio no histórico de notificações', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'email-9' } }));
    await enviar();
    const log = env.DB.linha(`SELECT * FROM notification_log`);
    expect(log).toMatchObject({ installment_id: ID, client_id: 'cli-1', channel: 'email', status: 'sent' });
    expect(log.external_id).toBe('email-9');
  });

  it('404 quando não há recibo anexado', async () => {
    const r = await enviar();
    expect(r.status).toBe(404);
    expect((await json(r)).error).toContain('Nenhum Recibo Verde');
  });

  it('400 quando o cliente não tem e-mail', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    await env.DB.prepare(`UPDATE clients SET email = NULL WHERE id = 'cli-1'`).run();
    const r = await enviar();
    expect(r.status).toBe(400);
    expect((await json(r)).error).toContain('sem email');
  });

  it('não tenta enviar nada quando o cliente não tem e-mail', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    await env.DB.prepare(`UPDATE clients SET email = '' WHERE id = 'cli-1'`).run();
    const f = mockFetch({ json: {} });
    vi.stubGlobal('fetch', f);
    await enviar();
    expect(f.chamadas).toHaveLength(0);
  });

  it('502 e registo de erro quando o envio falha', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    vi.stubGlobal('fetch', mockFetch({ status: 422, json: { message: 'destinatário inválido' } }));
    const r = await enviar();
    expect(r.status).toBe(502);
    expect(env.DB.linha(`SELECT status, error_message FROM notification_log`))
      .toMatchObject({ status: 'error', error_message: 'destinatário inválido' });
  });

  it('sem chave de e-mail configurada devolve skipped em vez de erro', async () => {
    await enviarPdf(`/api/recibos/${ID}`);
    env.RESEND_API_KEY = '';
    const b = await json(await enviar());
    expect(b).toMatchObject({ ok: false, skipped: true });
    expect(env.DB.linha(`SELECT status FROM notification_log`).status).toBe('skipped');
  });

  it('um PDF grande é codificado em base64 sem se corromper', async () => {
    await enviarPdf(`/api/recibos/${ID}`, pdf(0x8000 * 2 + 5));
    const f = mockFetch({ json: { id: 'e' } });
    vi.stubGlobal('fetch', f);
    await enviar();
    const b64 = JSON.parse(f.chamadas[0].body).attachments[0].content;
    expect(atob(b64).length).toBe(0x8000 * 2 + 5);
  });

  it('envia mesmo quando o recibo está numa chave antiga (receipt_path)', async () => {
    await env.RECIBOS.put('recibos/legado/x.pdf', pdf(64));
    await env.DB.prepare(`UPDATE installments SET receipt_path = 'recibos/legado/x.pdf' WHERE id = ?`).bind(ID).run();
    vi.stubGlobal('fetch', mockFetch({ json: { id: 'e' } }));
    expect((await json(await enviar())).ok).toBe(true);
  });

  it('sem armazenamento configurado devolve 500', async () => {
    env.RECIBOS = null;
    expect((await enviar()).status).toBe(500);
  });
});
