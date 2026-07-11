// worker/lib/owner_alerts.js
// Alertas para a Dra. Vyvian (dona do sistema), distintos dos lembretes aos
// clientes (notification_rules). Preferências em owner_alert_prefs, destino em
// owner_alert_contacts, log/dedupe em owner_alert_log.
import { sendEmail, sendWhatsApp } from "./senders.js";

const fmtMoney = (amount, currency) =>
  new Intl.NumberFormat(currency === "BRL" ? "pt-BR" : "pt-PT", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);

const hoje = () => new Date().toISOString().slice(0, 10);

export async function loadOwnerAlertConfig(env) {
  const [prefs, contacts] = await Promise.all([
    env.DB.prepare("SELECT * FROM owner_alert_prefs").all(),
    env.DB.prepare("SELECT * FROM owner_alert_contacts WHERE id = 1").first(),
  ]);
  const map = {};
  for (const p of prefs.results || []) map[p.alert_type] = p;
  return { prefs: map, contacts: contacts || { email: null, whatsapp: null } };
}

async function jaEnviadoHoje(env, alertType, channel) {
  const r = await env.DB.prepare(
    "SELECT 1 FROM owner_alert_log WHERE alert_type = ? AND channel = ? AND sent_date = ? AND status = 'sent' LIMIT 1"
  ).bind(alertType, channel, hoje()).first();
  return !!r;
}

async function registar(env, alertType, channel, status, preview, errorMsg) {
  await env.DB.prepare(
    `INSERT INTO owner_alert_log (id, alert_type, channel, status, sent_date, message_preview, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    `oal_${alertType}_${channel}_${Date.now()}`,
    alertType, channel, status, hoje(), (preview || "").slice(0, 200), errorMsg || null
  ).run();
}

/**
 * Envia um alerta à Dra. pelos canais ativos na preferência, com dedupe diário
 * (exceto quando dedupe=false, p.ex. pagamento recebido, que é por evento).
 */
export async function dispatchOwnerAlert(env, config, alertType, { subject, text, dedupe = true }) {
  const pref = config.prefs[alertType];
  if (!pref) return { skipped: "sem preferencia" };
  const resultados = {};

  const canais = [
    ["email", pref.email_enabled, config.contacts.email],
    ["whatsapp", pref.whatsapp_enabled, config.contacts.whatsapp],
  ];

  for (const [canal, enabled, destino] of canais) {
    if (!enabled) continue;
    if (!destino) { resultados[canal] = "sem destino configurado"; continue; }
    if (dedupe && (await jaEnviadoHoje(env, alertType, canal))) { resultados[canal] = "dedupe"; continue; }
    try {
      const r = canal === "email"
        ? await sendEmail(env, { to: destino, subject, text })
        : await sendWhatsApp(env, { phone: destino, message: `${subject}\n\n${text}` });
      const ok = r && (r.ok === undefined ? true : r.ok);
      await registar(env, alertType, canal, ok ? "sent" : "error", text, ok ? null : JSON.stringify(r).slice(0, 300));
      resultados[canal] = ok ? "sent" : "error";
    } catch (e) {
      await registar(env, alertType, canal, "error", text, String(e).slice(0, 300));
      resultados[canal] = "error";
    }
  }
  return resultados;
}

/** Bloco diário: corre dentro do cron, depois dos lembretes aos clientes. */
export async function runOwnerDailyAlerts(env) {
  const config = await loadOwnerAlertConfig(env);
  const out = {};

  // Vencem hoje
  const dueToday = await env.DB.prepare(`
    SELECT i.amount, i.currency, i.due_date, c.name AS client_name
    FROM installments i JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('pending','due_today') AND date(i.due_date) = date('now')
    ORDER BY c.name`).all();
  if ((dueToday.results || []).length) {
    const linhas = dueToday.results.map((p) => `• ${p.client_name}: ${fmtMoney(p.amount, p.currency)}`);
    out.vence_hoje = await dispatchOwnerAlert(env, config, "vence_hoje", {
      subject: `Vencem hoje: ${linhas.length} pagamento(s)`,
      text: `Pagamentos de clientes que vencem hoje:\n\n${linhas.join("\n")}\n\nÁrea Privada: https://vyavenaadv.com/admin/installments`,
    });
  }

  // Ficaram em atraso (venceram ontem e continuam pendentes) — alerta na transição
  const novasAtrasadas = await env.DB.prepare(`
    SELECT i.amount, i.currency, i.due_date, c.name AS client_name
    FROM installments i JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('pending','due_today','late') AND date(i.due_date) = date('now','-1 day')
    ORDER BY c.name`).all();
  if ((novasAtrasadas.results || []).length) {
    const linhas = novasAtrasadas.results.map((p) => `• ${p.client_name}: ${fmtMoney(p.amount, p.currency)} (venceu ontem)`);
    out.em_atraso = await dispatchOwnerAlert(env, config, "em_atraso", {
      subject: `Em atraso: ${linhas.length} pagamento(s) novo(s)`,
      text: `Pagamentos que entraram em atraso:\n\n${linhas.join("\n")}\n\nÁrea Privada: https://vyavenaadv.com/admin/installments`,
    });
  }

  // Resumo diário: hoje + próximos 7 dias + total em atraso
  const resumo = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN due_date = date('now') THEN 1 ELSE 0 END) AS hoje,
      SUM(CASE WHEN due_date > date('now') AND due_date <= date('now','+7 day') THEN 1 ELSE 0 END) AS semana,
      SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) AS atrasadas
    FROM installments WHERE status IN ('pending','due_today','late')`).first();
  if (resumo && (resumo.hoje || resumo.semana || resumo.atrasadas)) {
    out.resumo_diario = await dispatchOwnerAlert(env, config, "resumo_diario", {
      subject: "Resumo diário de vencimentos",
      text:
        `Situação dos pagamentos pendentes:\n\n` +
        `• Vencem hoje: ${resumo.hoje || 0}\n` +
        `• Próximos 7 dias: ${resumo.semana || 0}\n` +
        `• Em atraso: ${resumo.atrasadas || 0}\n\n` +
        `Área Privada: https://vyavenaadv.com/admin/installments`,
    });
  }

  return out;
}

/** Evento: um pagamento foi marcado como pago (chamado pela rota de installments). */
export async function ownerPaymentReceivedAlert(env, installmentId) {
  try {
    const config = await loadOwnerAlertConfig(env);
    const pref = config.prefs.pagamento_recebido;
    if (!pref || (!pref.email_enabled && !pref.whatsapp_enabled)) return;
    const p = await env.DB.prepare(`
      SELECT i.amount, i.currency, i.paid_date, i.payment_method, c.name AS client_name
      FROM installments i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`).bind(installmentId).first();
    if (!p) return;
    await dispatchOwnerAlert(env, config, "pagamento_recebido", {
      subject: `Pagamento recebido: ${p.client_name}`,
      text:
        `Foi registado um pagamento:\n\n` +
        `• Cliente: ${p.client_name}\n` +
        `• Valor: ${fmtMoney(p.amount, p.currency)}\n` +
        (p.payment_method ? `• Método: ${p.payment_method}\n` : "") +
        `• Data: ${p.paid_date || hoje()}`,
      dedupe: false, // por evento, não por dia
    });
  } catch (e) {
    // alerta nunca pode partir a operação principal
    console.error("ownerPaymentReceivedAlert:", e);
  }
}
