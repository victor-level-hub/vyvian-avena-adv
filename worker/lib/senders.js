// worker/lib/senders.js — Fase 2 (skeleton de envio)
// Resend (email) + Z-API (WhatsApp). Nunca lançam exceção — devolvem {ok|skipped|error}
// para o cron poder continuar mesmo que um canal falhe.

// Escapa o texto ao derivar o HTML: um «<» ou «&» vindo do nome do cliente ou da
// descricao da parcela partia a mensagem (ou injetava marcacao).
function escaparHtml(t) {
  return String(t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function sendEmail(env, { to, subject, html, text, attachments }) {
  if (!env.RESEND_API_KEY) return { channel: "email", skipped: true, reason: "RESEND_API_KEY n\u00e3o definido" };
  if (!to) return { channel: "email", skipped: true, reason: "sem destinat\u00e1rio" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Vyvian Avena Advogada <no-reply@vyavenaadv.com>",
        to: [to],
        reply_to: env.RESEND_REPLY_TO || undefined,
        subject: subject || "Vyvian Avena Advogada",
        html: html || (text ? `<p>${escaparHtml(text)}</p>` : ""),
        text: text || undefined,
        attachments: attachments && attachments.length ? attachments : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { channel: "email", ok: false, error: data?.message || `HTTP ${res.status}` };
    return { channel: "email", ok: true, external_id: data?.id || null };
  } catch (e) {
    return { channel: "email", ok: false, error: e.message };
  }
}

export async function sendWhatsApp(env, { phone, message }) {
  const { ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN } = env;
  if (!ZAPI_INSTANCE_ID || !ZAPI_INSTANCE_TOKEN) {
    return { channel: "whatsapp", skipped: true, reason: "credenciais Z-API n\u00e3o definidas" };
  }
  if (!phone) return { channel: "whatsapp", skipped: true, reason: "sem telefone" };
  try {
    const cleaned = String(phone).replace(/[^\d]/g, "");
    // `!phone` so apanhava o vazio: um telefone so com letras chegava aqui e era
    // enviado a Z-API como string vazia em vez de ser ignorado.
    if (!cleaned) return { channel: "whatsapp", skipped: true, reason: "telefone sem digitos" };
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}/send-text`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ZAPI_CLIENT_TOKEN ? { "Client-Token": ZAPI_CLIENT_TOKEN } : {}),
        },
        body: JSON.stringify({ phone: cleaned, message }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { channel: "whatsapp", ok: false, error: data?.error || `HTTP ${res.status}` };
    return { channel: "whatsapp", ok: true, external_id: data?.messageId || data?.id || null };
  } catch (e) {
    return { channel: "whatsapp", ok: false, error: e.message };
  }
}

// Render simples de template: substitui {{nome}}, {{valor}}, {{vencimento}}, {{parcela}}
export function renderTemplate(body, vars) {
  // Object.hasOwn: sem isto, {{constructor}} ou {{toString}} apanhavam as
  // propriedades herdadas do Object.prototype e escreviam lixo na mensagem.
  return String(body || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars && Object.hasOwn(vars, k) ? vars[k] : null;
    return v != null ? String(v) : "";
  });
}
