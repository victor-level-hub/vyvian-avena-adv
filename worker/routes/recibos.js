// worker/routes/recibos.js — Fase 3
// Endpoints /api/recibos/:installmentId  (GET serve|gera, POST regenera, DELETE apaga)
// Cache no R2 (env.RECIBOS). Atualiza installments.receipt_path.
import { jsonResponse, jsonError } from "../lib/response.js";
import { generateReciboPDF } from "../lib/pdfgen.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function handleRecibos(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','recibos',':id']
  const installmentId = segments[2];
  if (!installmentId) return jsonError("ID da parcela em falta", 400);

  switch (request.method) {
    case "GET":    return getRecibo(request, env, installmentId, false);
    case "POST":   return getRecibo(request, env, installmentId, true); // força regenerar
    case "DELETE": return deleteRecibo(env, installmentId);
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

// Nº sequencial estável por ordem de pagamento: AAAA-NNNN
async function receiptNumber(env, installment) {
  const paid = (installment.paid_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const year = paid.slice(0, 4);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS seq FROM installments
    WHERE status = 'paid' AND paid_date IS NOT NULL
      AND strftime('%Y', paid_date) = ?
      AND (paid_date < ? OR (paid_date = ? AND id <= ?))
  `).bind(year, paid, paid, installment.id).first();
  const seq = (row?.seq || 1);
  return `${year}-${String(seq).padStart(4, "0")}`;
}

async function getRecibo(request, env, installmentId, force) {
  const url = new URL(request.url);
  const infoOnly = url.searchParams.get("info") === "true";

  const { installment, client, error } = await loadData(env, installmentId);
  if (error) return error;

  if (installment.status !== "paid" || !installment.paid_date) {
    return jsonError("Recibo s\u00f3 dispon\u00edvel para parcelas pagas.", 409);
  }

  const key = `recibos/${client.id}/${installment.id}.pdf`;

  // info=true → metadados, sem gerar/descarregar o PDF
  if (infoOnly) {
    let exists = false;
    if (env.RECIBOS) {
      const head = await env.RECIBOS.head(key).catch(() => null);
      exists = !!head;
    }
    return jsonResponse({
      installment_id: installment.id,
      client_id: client.id,
      receipt_number: await receiptNumber(env, installment),
      r2_key: key,
      exists,
    });
  }

  // Servir do cache R2 (se existir e não for regeneração forçada)
  if (!force && env.RECIBOS) {
    const cached = await env.RECIBOS.get(key).catch(() => null);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="recibo-${installment.id}.pdf"`,
          "Cache-Control": "private, max-age=300",
          ...CORS,
        },
      });
    }
  }

  // Gerar
  const number = await receiptNumber(env, installment);
  const bytes = await generateReciboPDF({ client, installment, receiptNumber: number });

  // Guardar no R2 + registar a chave na parcela
  if (env.RECIBOS) {
    await env.RECIBOS.put(key, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    }).catch((e) => console.error("R2 put falhou:", e.message));
    await env.DB.prepare(
      "UPDATE installments SET receipt_path = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(key, installment.id).run().catch(() => {});
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${number}.pdf"`,
      ...CORS,
    },
  });
}

async function deleteRecibo(env, installmentId) {
  const { installment, error } = await loadData(env, installmentId);
  if (error) return error;
  const key = installment.receipt_path || `recibos/${installment.client_id}/${installment.id}.pdf`;
  if (env.RECIBOS) await env.RECIBOS.delete(key).catch(() => {});
  await env.DB.prepare(
    "UPDATE installments SET receipt_path = NULL, updated_at = datetime('now') WHERE id = ?"
  ).bind(installmentId).run();
  return jsonResponse({ ok: true, deleted: key });
}
