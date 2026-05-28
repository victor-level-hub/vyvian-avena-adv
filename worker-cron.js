// worker/cron.js
// Cron diário — executa todos os dias às 07:00 UTC.
// Tarefas:
//   1. Atualizar status de parcelas: pending/due_today → late quando passa a data
//   2. Atualizar pending → due_today quando hoje é a data de vencimento
//   3. Identificar parcelas que precisam de lembrete (segundo notification_rules)
//   4. Registar em notification_log com status='queued' (envio efetivo virá depois)

export async function runDailyCron(env, scheduledTime) {
  const log = [];

  // ===== 1. Atualizar status: marcar como `late` parcelas pendentes cuja data passou =====
  const lateResult = await env.DB.prepare(`
    UPDATE installments
    SET status = 'late', updated_at = datetime('now')
    WHERE status IN ('pending', 'due_today')
      AND date(due_date) < date('now')
  `).run();
  log.push(`pending→late: ${lateResult.meta.changes} parcelas`);

  // ===== 2. Atualizar status: marcar como `due_today` parcelas cuja data é hoje =====
  const todayResult = await env.DB.prepare(`
    UPDATE installments
    SET status = 'due_today', updated_at = datetime('now')
    WHERE status = 'pending'
      AND date(due_date) = date('now')
  `).run();
  log.push(`pending→due_today: ${todayResult.meta.changes} parcelas`);

  // ===== 3. Identificar parcelas que precisam de lembrete =====
  // Para cada regra ativa, ver se há parcela do cliente que vence em exatamente N dias
  const toNotify = await env.DB.prepare(`
    SELECT
      i.id as installment_id,
      i.client_id,
      i.due_date,
      i.amount,
      i.currency,
      i.installment_number,
      i.total_installments,
      c.name as client_name,
      c.email as client_email,
      c.phone as client_phone,
      r.channel,
      r.template_id,
      r.days_before
    FROM notification_rules r
    JOIN installments i ON i.client_id = r.client_id
    JOIN clients c ON c.id = i.client_id
    WHERE r.enabled = 1
      AND i.status IN ('pending', 'due_today')
      AND date(i.due_date) = date('now', '+' || r.days_before || ' days')
      AND NOT EXISTS (
        SELECT 1 FROM notification_log nl
        WHERE nl.installment_id = i.id
          AND nl.channel = r.channel
          AND date(nl.sent_at) = date('now')
      )
  `).all();

  log.push(`notificações a enviar: ${toNotify.results.length}`);

  // ===== 4. Registar como `queued` no log (envio real virá depois) =====
  for (const n of toNotify.results) {
    const logId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO notification_log (id, installment_id, client_id, channel, status, sent_at, message_preview)
      VALUES (?, ?, ?, ?, 'queued', datetime('now'), ?)
    `).bind(
      logId,
      n.installment_id,
      n.client_id,
      n.channel,
      `Lembrete ${n.days_before}d antes do vencimento ${n.due_date} (${n.amount} ${n.currency})`
    ).run();
  }

  return {
    scheduledTime: new Date(scheduledTime).toISOString(),
    summary: log,
    queued: toNotify.results.length,
  };
}
