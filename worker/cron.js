// worker/cron.js — Fase 2 (job diário)
// 1) Atualiza estados das parcelas por data (pending -> due_today / late)
// 2) Despacha notificações conforme notification_rules (+ templates), com log e dedupe.
// Idempotente no dia: não reenvia o mesmo canal/parcela duas vezes na mesma data.
import { sendEmail, sendWhatsApp, renderTemplate } from "./lib/senders.js";
import { runOwnerDailyAlerts } from "./lib/owner_alerts.js";

function fmtMoney(amount, currency) {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  const [int, dec] = n.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = `${grouped},${dec}`;
  return currency === "BRL" ? `R$ ${body}` : currency === "EUR" ? `${body} \u20ac` : `${body} ${currency || ""}`.trim();
}
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export async function runDailyCron(env, ctx) {
  const summary = { updated_late: 0, updated_due_today: 0, notified: 0, skipped: 0, errors: 0, details: [] };

  // ── 1. Atualizar estados ────────────────────────────
  const late = await env.DB.prepare(`
    UPDATE installments SET status = 'late', updated_at = datetime('now')
    WHERE status IN ('pending', 'due_today') AND date(due_date) < date('now')
  `).run();
  summary.updated_late = late.meta.changes || 0;

  const dueToday = await env.DB.prepare(`
    UPDATE installments SET status = 'due_today', updated_at = datetime('now')
    WHERE status = 'pending' AND date(due_date) = date('now')
  `).run();
  summary.updated_due_today = dueToday.meta.changes || 0;

  // ── 2. Notificações por regra ───────────────────────
  // Para cada regra ativa, parcelas do cliente que vencem em exatamente days_before dias.
  const rules = await env.DB.prepare(
    "SELECT * FROM notification_rules WHERE enabled = 1"
  ).all();

  for (const rule of rules.results || []) {
    try {
      const parcelas = await env.DB.prepare(`
        SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.country AS client_country
        FROM installments i JOIN clients c ON c.id = i.client_id
        WHERE i.client_id = ?
          AND i.status IN ('pending', 'due_today', 'late')
          AND date(i.due_date) = date('now', '+' || ? || ' days')
      `).bind(rule.client_id, rule.days_before).all();

      for (const p of parcelas.results || []) {
        // dedupe: já houve envio deste canal para esta parcela hoje?
        const already = await env.DB.prepare(`
          SELECT 1 FROM notification_log
          WHERE installment_id = ? AND channel = ? AND date(sent_at) = date('now') LIMIT 1
        `).bind(p.id, rule.channel).first();
        if (already) { summary.skipped++; continue; }

        // template
        let tpl = null;
        if (rule.template_id) {
          tpl = await env.DB.prepare("SELECT * FROM message_templates WHERE id = ?").bind(rule.template_id).first();
        }
        if (!tpl) {
          tpl = await env.DB.prepare(
            "SELECT * FROM message_templates WHERE channel = ? AND is_default = 1 LIMIT 1"
          ).bind(rule.channel).first();
        }
        const vars = {
          nome: p.client_name,
          valor: fmtMoney(p.amount, p.currency),
          vencimento: fmtDate(p.due_date),
          parcela: `${p.installment_number}/${p.total_installments}`,
          dias: rule.days_before,
        };
        const bodyMsg = tpl
          ? renderTemplate(tpl.body, vars)
          : `Ol\u00e1 ${vars.nome}, lembramos que a parcela ${vars.parcela} no valor de ${vars.valor} vence a ${vars.vencimento}.`;
        const subject = tpl?.subject ? renderTemplate(tpl.subject, vars) : "Lembrete de pagamento \u2014 Vyvian Avena Advogada";

        let result;
        if (rule.channel === "email") result = await sendEmail(env, { to: p.client_email, subject, text: bodyMsg });
        else if (rule.channel === "whatsapp") result = await sendWhatsApp(env, { phone: p.client_phone, message: bodyMsg });
        else result = { channel: rule.channel, skipped: true, reason: "canal desconhecido" };

        const status = result.ok ? "sent" : result.skipped ? "skipped" : "error";
        if (result.ok) summary.notified++;
        else if (result.skipped) summary.skipped++;
        else summary.errors++;

        await env.DB.prepare(`
          INSERT INTO notification_log (id, installment_id, client_id, channel, status, message_preview, error_message, external_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), p.id, p.client_id, rule.channel, status,
          bodyMsg.slice(0, 140), result.error || null, result.external_id || null
        ).run().catch(() => {});
      }
    } catch (e) {
      summary.errors++;
      summary.details.push({ rule: rule.id, error: e.message });
    }
  }

  // Alertas para a Dra. Vyvian (preferências em owner_alert_prefs)
  try {
    summary.owner_alerts = await runOwnerDailyAlerts(env);
  } catch (e) {
    console.error("owner alerts:", e);
    summary.owner_alerts = { error: String(e).slice(0, 200) };
  }

  // Limpeza de privacidade (Fase A): apaga hashes de visitantes com mais de 35 dias.
  try {
    const pr = await env.DB.prepare(
      `DELETE FROM site_visitors_daily WHERE day < date('now', '-35 days')`
    ).run();
    summary.visitors_pruned = pr.meta.changes || 0;
  } catch (e) {
    summary.visitors_pruned = 0;
  }

  return summary;
}
