// worker/routes/planos.js — Plano de Pagamento (PDF + envio ao cliente)
// Um "plano" é o conjunto de installments de um cliente (mesmo total_installments).
//
// Endpoints (sob /api/planos):
//   POST /api/planos/gerar          body { client_id, local?, issue_date? }  -> PDF (stream)
//   POST /api/planos/enviar         body { client_id, channel?, local? }     -> envia ao cliente
//   GET  /api/planos/:clientId/info                                          -> resumo { total, paid, outstanding, count }
import { jsonResponse, jsonError } from "../lib/response.js";
import { generatePaymentPlanPdf } from "../lib/planogen.js";
import { sendEmail } from "../lib/senders.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function handlePlanos(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','planos', sub, ...]
  const sub = segments[2];

  if (sub === "gerar" && request.method === "POST") return gerarPlano(request, env, false);
  if (sub === "enviar" && request.method === "POST") return enviarPlano(request, env);
  if (segments[3] === "info" && request.method === "GET") return infoPlano(env, sub);

  return jsonError("Not found", 404);
}

async function loadPlan(env, clientId) {
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return { error: jsonError("Cliente não encontrado", 404) };
  const r = await env.DB.prepare(
    "SELECT * FROM installments WHERE client_id = ? ORDER BY installment_number ASC"
  ).bind(clientId).all();
  const installments = r.results || [];
  if (!installments.length) return { error: jsonError("Este cliente não tem parcelas registadas.", 400) };
  // Cliente conjunto (várias pessoas): o PDF do plano lista todos os titulares
  try {
    const pp = await env.DB.prepare(
      "SELECT name, identification FROM client_people WHERE client_id = ? ORDER BY position ASC"
    ).bind(clientId).all();
    client.people = pp.results || [];
  } catch { client.people = []; }
  return { client, installments };
}

function planNumberFor(client, installments) {
  // Número estável e legível: VA-<ano>-<6 primeiros do client id em maiúsculas>
  const year = (installments[0]?.due_date || new Date().toISOString()).slice(0, 4);
  const suffix = String(client.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return `VA-${year}-${suffix}`;
}

function u8ToBase64(u8) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(s);
}

async function gerarPlano(request, env, _unused) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON", 400); }
  const { client_id, local, issue_date } = body || {};
  if (!client_id) return jsonError("client_id é obrigatório", 400);

  const { client, installments, error } = await loadPlan(env, client_id);
  if (error) return error;

  const bytes = await generatePaymentPlanPdf({
    client,
    installments,
    planNumber: planNumberFor(client, installments),
    local: local || (client.country === "BR" ? "Rio de Janeiro" : "Cacilhas"),
    issueDate: issue_date || new Date().toISOString().slice(0, 10),
  });

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="plano-pagamento-${client.id}.pdf"`,
      ...CORS,
    },
  });
}

async function enviarPlano(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON", 400); }
  const { client_id, channel = "email", local } = body || {};
  if (!client_id) return jsonError("client_id é obrigatório", 400);

  const { client, installments, error } = await loadPlan(env, client_id);
  if (error) return error;

  const planNumber = planNumberFor(client, installments);
  const bytes = await generatePaymentPlanPdf({
    client, installments, planNumber,
    local: local || (client.country === "BR" ? "Rio de Janeiro" : "Cacilhas"),
    issueDate: new Date().toISOString().slice(0, 10),
  });

  const firstInstId = installments[0]?.id || null;

  // ── EMAIL ──
  if (channel === "email") {
    if (!client.email) return jsonError("Cliente sem email registado.", 400);
    const subject = `Plano de Pagamento — Vyvian Avena Advogada`;
    const html =
      `<p>Caro(a) ${client.name},</p>` +
      `<p>Segue em anexo o seu plano de pagamento de honorários (${installments.length} ` +
      `${installments.length === 1 ? "parcela" : "parcelas"}), referente ao acompanhamento jurídico.</p>` +
      `<p>Em caso de dúvida, estamos ao seu dispor.</p>` +
      `<p>Com os melhores cumprimentos,<br>Vyvian Avena Advogada</p>`;
    const result = await sendEmail(env, {
      to: client.email, subject, html,
      attachments: [{ filename: `plano-pagamento-${planNumber}.pdf`, content: u8ToBase64(bytes) }],
    });

    await env.DB.prepare(`
      INSERT INTO notification_log (id, installment_id, client_id, channel, status, message_preview, error_message, external_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), firstInstId, client.id, "email",
      result.ok ? "sent" : result.skipped ? "skipped" : "error",
      `Plano de Pagamento ${planNumber} -> ${client.email}`,
      result.error || null, result.external_id || null
    ).run().catch(() => {});

    if (result.skipped) return jsonResponse({ ok: false, skipped: true, reason: result.reason, sent_to: client.email });
    if (!result.ok) return jsonError(result.error || "Falha no envio do email", 502);
    return jsonResponse({ ok: true, channel: "email", sent_to: client.email, plan_number: planNumber });
  }

  // ── WHATSAPP (Z-API send-text não envia anexo binário; mandamos aviso de texto) ──
  // O PDF por WhatsApp exige send-document com URL pública; deixamos como melhoria
  // futura (servir o PDF via R2 com link assinado). Por agora, channel=email é o canal de anexo.
  return jsonError("Canal não suportado para anexo. Use channel='email'.", 400);
}

async function infoPlano(env, clientId) {
  const { client, installments, error } = await loadPlan(env, clientId);
  if (error) return error;
  const total = installments.reduce((s, i) => s + Number(i.amount || 0), 0);
  const paid = installments.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount || 0), 0);
  return jsonResponse({
    client_id: client.id,
    client_name: client.name,
    count: installments.length,
    total, paid, outstanding: total - paid,
    currency: installments[0]?.currency || (client.country === "BR" ? "BRL" : "EUR"),
    plan_number: planNumberFor(client, installments),
    has_email: !!client.email,
  });
}
