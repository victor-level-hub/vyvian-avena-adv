// worker/routes/dashboard.js
import { jsonResponse, jsonError } from '../lib/response.js';

export async function handleDashboard(request, env, path, session) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405);

  // KPIs gerais
  const counts = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM clients WHERE status = 'active') as active_clients,
      (SELECT COUNT(*) FROM installments WHERE status = 'pending') as pending,
      (SELECT COUNT(*) FROM installments WHERE status = 'due_today') as due_today,
      (SELECT COUNT(*) FROM installments WHERE status = 'late') as late,
      (SELECT COUNT(*) FROM installments WHERE status = 'paid' AND date(paid_date) >= date('now', '-30 days')) as paid_last_30d
  `).first();

  // Receita prevista próximos 30 dias
  const upcomingRevenue = await env.DB.prepare(`
    SELECT
      currency,
      SUM(amount) as total
    FROM installments
    WHERE status IN ('pending', 'due_today', 'late')
      AND date(due_date) <= date('now', '+30 days')
    GROUP BY currency
  `).all();

  // Próximos vencimentos
  const upcoming = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.country as client_country
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('pending', 'due_today', 'late')
    ORDER BY i.due_date ASC
    LIMIT 6
  `).all();

  // Alertas: parcelas atrasadas
  const alerts = await env.DB.prepare(`
    SELECT i.*, c.name as client_name, c.country as client_country,
           julianday('now') - julianday(i.due_date) as days_late
    FROM installments i
    JOIN clients c ON c.id = i.client_id
    WHERE i.status = 'late'
    ORDER BY i.due_date ASC
  `).all();

  return jsonResponse({
    counts,
    upcoming_revenue: upcomingRevenue.results,
    upcoming: upcoming.results,
    alerts: alerts.results,
  });
}
