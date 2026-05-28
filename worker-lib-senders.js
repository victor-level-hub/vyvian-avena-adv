// worker/lib/senders.js
// Adapters para envio de email e WhatsApp.
// As keys vêm de env.RESEND_API_KEY e env.ZAPI_INSTANCE_ID/TOKEN (a configurar).

// ============================================================
// RESEND (email)
// https://resend.com/docs/api-reference/emails/send-email
// ============================================================
export async function sendEmailViaResend(env, { to, subject, html, text, fromName }) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY não configurada' };
  }
  if (!env.RESEND_FROM_ADDRESS) {
    return { ok: false, error: 'RESEND_FROM_ADDRESS não configurada' };
  }

  const from = fromName
    ? `${fromName} <${env.RESEND_FROM_ADDRESS}>`
    : env.RESEND_FROM_ADDRESS;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, externalId: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Z-API (WhatsApp)
// https://developer.z-api.io/en/message/send-message-text
// ============================================================
export async function sendWhatsappViaZapi(env, { to, message }) {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    return { ok: false, error: 'Z-API não configurada (faltam ZAPI_INSTANCE_ID/INSTANCE_TOKEN/CLIENT_TOKEN)' };
  }

  // Z-API espera número internacional sem '+' e sem espaços
  const phone = to.replace(/[^\d]/g, '');

  try {
    const url = `https://api.z-api.io/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_INSTANCE_TOKEN}/send-text`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': env.ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || `HTTP ${res.status}` };
    }
    return { ok: true, externalId: data.messageId || data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
// TEMPLATE RENDERING
// Substitui {{var.path}} pelos valores do contexto
// ============================================================
export function renderTemplate(template, ctx) {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const keys = path.trim().split('.');
    let value = ctx;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) return `{{${path}}}`;
    }
    return String(value);
  });
}
