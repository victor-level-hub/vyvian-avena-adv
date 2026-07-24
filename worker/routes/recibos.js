// worker/routes/recibos.js — Arquivo de Recibos Verdes (por parcela)
// A Dra. Vyvian anexa o RV oficial (PDF) emitido na AT; guardamos no R2 e
// registamos a chave em installments.receipt_path. Sem geração automática.
//
// Endpoints (sob /api/recibos/:installmentId):
//   GET    /api/recibos/:id            -> serve o RV anexado (PDF) | 404 se não houver
//   GET    /api/recibos/:id?info=true  -> metadados { exists, filename, size, uploaded_at }
//   PUT    /api/recibos/:id            -> upload do RV (corpo = PDF binário)
//   DELETE /api/recibos/:id            -> remove o RV anexado
//   POST   /api/recibos/:id/send       -> envia o RV anexado ao cliente por email
import { jsonResponse, jsonError } from "../lib/response.js";
import { sendEmail } from "../lib/senders.js";

const CORS = { "Access-Control-Allow-Origin": "*" };
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Tipos de documento por parcela. "recibo" usa a chave R2 antiga (retrocompatível
// com os Recibos Verdes já anexados); os restantes têm sufixo próprio.
const TIPOS = ["recibo", "fatura-recibo", "fatura"];

function tipoFromRequest(request) {
  const t = new URL(request.url).searchParams.get("tipo");
  return TIPOS.includes(t) ? t : "recibo";
}

export async function handleRecibos(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','recibos',':id','send'?]
  const installmentId = segments[2];
  const sub = segments[3];
  if (!installmentId) return jsonError("ID da parcela em falta", 400);

  if (sub === "send" && request.method === "POST") {
    return sendRecibo(env, installmentId);
  }

  switch (request.method) {
    case "GET":    return getRecibo(request, env, installmentId);
    case "PUT":    return uploadRecibo(request, env, installmentId);
    case "DELETE": return deleteRecibo(request, env, installmentId);
    default:       return jsonError("Method not allowed", 405);
  }
}

async function loadData(env, installmentId) {
  const installment = await env.DB.prepare(
    "SELECT * FROM installments WHERE id = ?"
  ).bind(installmentId).first();
  if (!installment) return { error: jsonError("Parcela n\u00e3o encontrada", 404) };
  const client = await env.DB.prepare(
    "SELECT * FROM clients WHERE id = ?"
  ).bind(installment.client_id).first();
  if (!client) return { error: jsonError("Cliente n\u00e3o encontrado", 404) };
  return { installment, client };
}

function r2Key(clientId, installmentId, tipo = "recibo") {
  return tipo === "recibo"
    ? `recibos/${clientId}/${installmentId}.pdf`
    : `recibos/${clientId}/${installmentId}-${tipo}.pdf`;
}

// ── Upload do RV (PDF) ──────────────────────────────
async function uploadRecibo(request, env, installmentId) {
  const { installment, client, error } = await loadData(env, installmentId);
  if (error) return error;
  if (!env.RECIBOS) return jsonError("Armazenamento R2 indispon\u00edvel", 500);

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/pdf")) {
    return jsonError("Apenas ficheiros PDF s\u00e3o aceites.", 415);
  }
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return jsonError("Ficheiro vazio.", 400);
  if (buf.byteLength > MAX_BYTES) return jsonError("Ficheiro demasiado grande (m\u00e1x. 10 MB).", 413);

  // validar assinatura PDF (%PDF)
  const head = new Uint8Array(buf.slice(0, 5));
  const magic = String.fromCharCode(...head);
  if (!magic.startsWith("%PDF")) return jsonError("O ficheiro n\u00e3o \u00e9 um PDF v\u00e1lido.", 415);

  const tipo = tipoFromRequest(request);
  const key = r2Key(client.id, installment.id, tipo);
  await env.RECIBOS.put(key, buf, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { uploaded_at: new Date().toISOString(), tipo, original_name: request.headers.get("x-filename") || `${tipo}.pdf` },
  });
  if (tipo === "recibo") {
    await env.DB.prepare(
      "UPDATE installments SET receipt_path = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(key, installment.id).run().catch(() => {});
  }

  return jsonResponse({ ok: true, installment_id: installment.id, tipo, r2_key: key, size: buf.byteLength });
}

// ── Servir / metadados ──────────────────────────────
async function getRecibo(request, env, installmentId) {
  const url = new URL(request.url);
  const info = url.searchParams.get("info");
  const infoOnly = info === "true";
  const tipo = tipoFromRequest(request);

  const { installment, client, error } = await loadData(env, installmentId);
  if (error) return error;
  const key = tipo === "recibo"
    ? (installment.receipt_path || r2Key(client.id, installment.id, "recibo"))
    : r2Key(client.id, installment.id, tipo);

  // info=all -> metadados dos 3 tipos de uma vez { docs: { recibo: {...}, ... } }
  if (info === "all") {
    const docs = {};
    for (const t of TIPOS) {
      const k = t === "recibo"
        ? (installment.receipt_path || r2Key(client.id, installment.id, "recibo"))
        : r2Key(client.id, installment.id, t);
      let d = { exists: false };
      if (env.RECIBOS) {
        const head = await env.RECIBOS.head(k).catch(() => null);
        if (head) d = { exists: true, size: head.size, uploaded_at: head.customMetadata?.uploaded_at || null, filename: head.customMetadata?.original_name || null };
      }
      docs[t] = d;
    }
    return jsonResponse({ installment_id: installment.id, client_id: client.id, docs });
  }

  if (infoOnly) {
    let exists = false, size = null, uploaded_at = null, filename = null;
    if (env.RECIBOS) {
      const head = await env.RECIBOS.head(key).catch(() => null);
      if (head) { exists = true; size = head.size; uploaded_at = head.customMetadata?.uploaded_at || null; filename = head.customMetadata?.original_name || null; }
    }
    return jsonResponse({ installment_id: installment.id, client_id: client.id, r2_key: key, exists, size, uploaded_at, filename });
  }

  if (!env.RECIBOS) return jsonError("Armazenamento R2 indispon\u00edvel", 500);
  const obj = await env.RECIBOS.get(key).catch(() => null);
  if (!obj) return jsonError("Nenhum documento deste tipo anexado a esta parcela.", 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${tipo}-${installment.id}.pdf"`,
      "Cache-Control": "private, max-age=300",
      ...CORS,
    },
  });
}

// ── Remover ─────────────────────────────────────────
async function deleteRecibo(request, env, installmentId) {
  const { installment, error } = await loadData(env, installmentId);
  if (error) return error;
  const tipo = tipoFromRequest(request);
  const key = tipo === "recibo"
    ? (installment.receipt_path || r2Key(installment.client_id, installment.id, "recibo"))
    : r2Key(installment.client_id, installment.id, tipo);
  if (env.RECIBOS) await env.RECIBOS.delete(key).catch(() => {});
  if (tipo === "recibo") {
    await env.DB.prepare(
      "UPDATE installments SET receipt_path = NULL, updated_at = datetime('now') WHERE id = ?"
    ).bind(installmentId).run();
  }
  return jsonResponse({ ok: true, deleted: key });
}

// ── Enviar o RV anexado ao cliente ──────────────────
function u8ToBase64(u8) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(s);
}

async function sendRecibo(env, installmentId) {
  const { installment, client, error } = await loadData(env, installmentId);
  if (error) return error;
  if (!client.email) return jsonError("Cliente sem email registado.", 400);
  if (!env.RECIBOS) return jsonError("Armazenamento R2 indispon\u00edvel", 500);

  const key = installment.receipt_path || r2Key(client.id, installment.id);
  const obj = await env.RECIBOS.get(key).catch(() => null);
  if (!obj) return jsonError("Nenhum Recibo Verde anexado para enviar.", 404);
  const bytes = new Uint8Array(await obj.arrayBuffer());

  const subject = `Recibo \u2014 Vyvian Avena Advogada`;
  const text =
    `Caro(a) ${client.name},\n\n` +
    `Segue em anexo o recibo referente \u00e0 parcela ${installment.installment_number}/${installment.total_installments} dos honor\u00e1rios.\n\n` +
    `Com os melhores cumprimentos,\nVyvian Avena Advogada`;

  const result = await sendEmail(env, {
    to: client.email, subject, text,
    attachments: [{ filename: `recibo-${installment.id}.pdf`, content: u8ToBase64(bytes) }],
  });

  await env.DB.prepare(`
    INSERT INTO notification_log (id, installment_id, client_id, channel, status, message_preview, error_message, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), installment.id, client.id, "email",
    result.ok ? "sent" : result.skipped ? "skipped" : "error",
    `Recibo Verde -> ${client.email}`, result.error || null, result.external_id || null
  ).run().catch(() => {});

  if (result.skipped) return jsonResponse({ ok: false, skipped: true, reason: result.reason, sent_to: client.email });
  if (!result.ok) return jsonError(result.error || "Falha no envio do email", 502);
  return jsonResponse({ ok: true, sent_to: client.email });
}
