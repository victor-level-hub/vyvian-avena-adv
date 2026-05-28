// worker/routes/recibos.js
import { jsonResponse, jsonError } from '../lib/response.js';
import { generateReceiptPdf } from '../lib/pdfgen.js';

export async function handleRecibos(request, env, path, session) {
  const segments = path.split('/').filter(Boolean); // ['api', 'recibos', ':installmentId']
  const installmentId = segments[2];
  const method = request.method;

  if (!installmentId) return jsonError('installment_id obrigatório', 400);

  // GET → retornar PDF (ou gerar se não existe ainda)
  if (method === 'GET') {
    return servePdf(env, installmentId, request);
  }
  // POST → forçar regeneração
  if (method === 'POST') {
    return generateAndStore(env, installmentId, { force: true });
  }
  // DELETE → apagar do R2 e desligar receipt_path
  if (method === 'DELETE') {
    return deleteReceipt(env, installmentId);
  }
  return jsonError('Method not allowed', 405);
}

async function servePdf(env, installmentId, request) {
  // Buscar parcela
  const inst = await env.DB.prepare('SELECT * FROM installments WHERE id = ?').bind(installmentId).first();
  if (!inst) return jsonError('Parcela não encontrada', 404);
  if (inst.status !== 'paid') {
    return jsonError('Recibo só pode ser gerado para parcelas pagas', 400);
  }

  const url = new URL(request.url);
  const wantsInfo = url.searchParams.get('info') === 'true';

  const key = receiptKey(inst);

  // Verifica se já existe em R2
  let object = await env.RECIBOS.get(key);

  if (!object) {
    // Gera e armazena
    const result = await generateAndStore(env, installmentId, { force: false });
    if (!result || result.status >= 400) return result;
    object = await env.RECIBOS.get(key);
    if (!object) return jsonError('Falha a gerar recibo', 500);
  }

  if (wantsInfo) {
    return jsonResponse({
      installment_id: installmentId,
      key,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      receipt_path: inst.receipt_path,
    });
  }

  // Retornar PDF como download
  const filename = `recibo-${inst.id}.pdf`;
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

async function generateAndStore(env, installmentId, { force }) {
  const inst = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
           c.country as client_country, c.identification as client_identification
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ?
  `).bind(installmentId).first();

  if (!inst) return jsonError('Parcela não encontrada', 404);
  if (inst.status !== 'paid') {
    return jsonError('Recibo só para parcelas pagas', 400);
  }

  const key = receiptKey(inst);

  if (!force) {
    const existing = await env.RECIBOS.head(key);
    if (existing) {
      return jsonResponse({
        ok: true,
        key,
        message: 'Recibo já existe — use POST para forçar regeneração',
      });
    }
  }

  // Gera número de recibo determinístico
  const receiptNumber = makeReceiptNumber(inst);

  // Gera PDF
  const pdfBytes = await generateReceiptPdf({
    installment: inst,
    client: {
      name: inst.client_name,
      email: inst.client_email,
      phone: inst.client_phone,
      country: inst.client_country,
      identification: inst.client_identification,
    },
    receiptNumber,
  });

  // Guarda em R2
  await env.RECIBOS.put(key, pdfBytes, {
    httpMetadata: {
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="recibo-${inst.id}.pdf"`,
    },
    customMetadata: {
      installmentId: inst.id,
      clientId: inst.client_id,
      receiptNumber,
      generatedAt: new Date().toISOString(),
    },
  });

  // Atualiza receipt_path em D1
  await env.DB.prepare(`
    UPDATE installments SET receipt_path = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(key, installmentId).run();

  return jsonResponse({
    ok: true,
    key,
    receiptNumber,
    size: pdfBytes.byteLength,
  });
}

async function deleteReceipt(env, installmentId) {
  const inst = await env.DB.prepare('SELECT * FROM installments WHERE id = ?').bind(installmentId).first();
  if (!inst) return jsonError('Parcela não encontrada', 404);
  if (!inst.receipt_path) return jsonResponse({ ok: true, message: 'Sem recibo para apagar' });

  await env.RECIBOS.delete(inst.receipt_path);
  await env.DB.prepare(`UPDATE installments SET receipt_path = NULL WHERE id = ?`).bind(installmentId).run();
  return jsonResponse({ ok: true });
}

// ============ HELPERS ============

function receiptKey(installment) {
  return `recibos/${installment.client_id}/${installment.id}.pdf`;
}

function makeReceiptNumber(installment) {
  // Formato: YYYY-NNNN onde YYYY é ano de pagamento e NNNN derivado do id da parcela
  const year = (installment.paid_date || new Date().toISOString().slice(0, 10)).slice(0, 4);
  // Hash determinístico simples a partir do id
  let hash = 0;
  for (const ch of installment.id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const num = Math.abs(hash) % 10000;
  return `${year}-${num.toString().padStart(4, '0')}`;
}
