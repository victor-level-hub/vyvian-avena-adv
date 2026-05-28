// src/admin/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSession } from '../auth';
import { dashboard as dashboardApi } from '../apiClient';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysUntilDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

function whenLabel(installment) {
  if (installment.status === 'late') {
    return `${Math.abs(daysUntilDate(installment.due_date))}d atraso`;
  }
  const days = daysUntilDate(installment.due_date);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days < 0) return `${Math.abs(days)}d atraso`;
  return `${days} dias`;
}

function whenClass(installment) {
  if (installment.status === 'late') return 'adm-badge adm-badge-over';
  const days = daysUntilDate(installment.due_date);
  if (days <= 1) return 'adm-badge adm-badge-warn';
  if (days <= 5) return 'adm-badge adm-badge-soon';
  return 'adm-badge adm-badge-pending';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 19) return 'Boa tarde';
  return 'Boa noite';
}

function formatTodayLong() {
  return new Date().toLocaleDateString('pt-PT', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export default function Dashboard() {
  const session = getSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    dashboardApi.get()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar painel…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;
  if (!data) return null;

  const { counts, upcoming_revenue, upcoming, alerts } = data;

  // Receita prevista em EUR (próximos 30d)
  const eurRev = upcoming_revenue.find((r) => r.currency === 'EUR');
  const brlRev = upcoming_revenue.find((r) => r.currency === 'BRL');

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>{greeting()}, Dra. Vyvian</h1>
          <div className="adm-sub">
            {formatTodayLong()} · {counts.due_today} vencimento{counts.due_today === 1 ? '' : 's'} hoje
          </div>
        </div>
        <div className="adm-user-pill">
          <span>{session?.name || 'Vyvian Avena'}</span>
          <div className="adm-user-avatar">{session?.initials || 'V'}</div>
        </div>
      </header>

      <div className="adm-kpi-grid">
        <div className="adm-kpi">
          <div className="adm-kpi-label">Receita prevista (30d) · EUR</div>
          <div className="adm-kpi-value">{fmtMoney(eurRev?.total || 0, 'EUR')}</div>
          <div className="adm-kpi-delta adm-kpi-delta-muted">
            {brlRev ? `+ ${fmtMoney(brlRev.total, 'BRL')} em BRL` : 'Apenas EUR este período'}
          </div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">Clientes ativos</div>
          <div className="adm-kpi-value">{counts.active_clients}</div>
          <div className="adm-kpi-delta adm-kpi-delta-muted">
            {counts.paid_last_30d} parcelas pagas (30d)
          </div>
        </div>
        <div className="adm-kpi adm-kpi-alert">
          <div className="adm-kpi-label">Em atraso</div>
          <div className="adm-kpi-value">{counts.late}</div>
          <div className="adm-kpi-delta adm-kpi-delta-danger">
            {counts.late === 0 ? 'Sem atrasos 🌿' : 'Requer ação'}
          </div>
        </div>
        <div className="adm-kpi adm-kpi-warn">
          <div className="adm-kpi-label">Próximos vencimentos</div>
          <div className="adm-kpi-value">{counts.pending + counts.due_today}</div>
          <div className="adm-kpi-delta adm-kpi-delta-warn">
            {counts.due_today} hoje · {counts.pending} a vir
          </div>
        </div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <div className="adm-card-title">
            Próximos vencimentos
            <Link to="/admin/parcelas" className="adm-card-title-link">Ver todos →</Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="adm-empty">Nada nos próximos dias.</div>
          ) : (
            <ul className="adm-due-list">
              {upcoming.map((i) => (
                <li key={i.id}>
                  <Link to={`/admin/clientes/${i.client_id}`} style={{ color: 'inherit' }}>
                    <div className="adm-due-name">
                      {i.client_name}
                      <small>
                        Parcela {i.installment_number}/{i.total_installments}
                      </small>
                    </div>
                  </Link>
                  <div className="adm-due-val">{fmtMoney(i.amount, i.currency)}</div>
                  <div className={whenClass(i)}>{whenLabel(i)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="adm-card adm-card-alert">
          <div className="adm-card-title adm-card-title-danger">
            ⚠ Atenção — vencidas
          </div>
          {alerts.length === 0 ? (
            <div className="adm-empty">Sem atrasos. 🌿</div>
          ) : (
            <ul className="adm-due-list">
              {alerts.map((i) => (
                <li key={i.id}>
                  <Link to={`/admin/clientes/${i.client_id}`} style={{ color: 'inherit' }}>
                    <div className="adm-due-name">
                      {i.client_name}
                      <small>
                        Parcela {i.installment_number}/{i.total_installments}
                      </small>
                    </div>
                  </Link>
                  <div className="adm-due-val">{fmtMoney(i.amount, i.currency)}</div>
                  <div className="adm-badge adm-badge-over">{whenLabel(i)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
