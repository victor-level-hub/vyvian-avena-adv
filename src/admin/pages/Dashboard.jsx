// src/admin/pages/Dashboard.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { CLIENTS, INSTALLMENTS, TODAY, getClientById } from '../mockData';
import { getSession } from '../auth';

// ===== helpers =====
function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  return symbol + '\u00A0' + amount.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  return Math.round((d - TODAY) / (1000 * 60 * 60 * 24));
}

function whenLabel(installment) {
  const days = daysUntil(installment.dueDate);
  if (installment.status === 'late') return `${Math.abs(days)}d atraso`;
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days < 0) return `${Math.abs(days)}d atraso`;
  return `${days} dias`;
}

function whenClass(installment) {
  if (installment.status === 'late') return 'adm-badge adm-badge-over';
  const days = daysUntil(installment.dueDate);
  if (days <= 1) return 'adm-badge adm-badge-warn';
  if (days <= 5) return 'adm-badge adm-badge-soon';
  return 'adm-badge adm-badge-pending';
}

function monthGreeting(date) {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 19) return 'Boa tarde';
  return 'Boa noite';
}

export default function Dashboard() {
  const session = getSession();
  const currentMonth = TODAY.getMonth();
  const currentYear = TODAY.getFullYear();

  // Parcelas do mês corrente (em EUR — para o painel principal)
  const monthInstallments = INSTALLMENTS.filter((i) => {
    const c = getClientById(i.clientId);
    const d = new Date(i.dueDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && c.currency === 'EUR';
  });

  const totalForecast = monthInstallments.reduce((s, i) => s + i.amount, 0);
  const totalReceived = monthInstallments.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const lateInstallments = INSTALLMENTS.filter((i) => i.status === 'late' && getClientById(i.clientId).currency === 'EUR');
  const totalLate = lateInstallments.reduce((s, i) => s + i.amount, 0);

  // Próximos 7 dias (inclui hoje)
  const next7 = INSTALLMENTS.filter((i) => {
    if (i.status === 'paid') return false;
    const days = daysUntil(i.dueDate);
    return days >= 0 && days <= 7;
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const next7EurTotal = next7
    .filter((i) => getClientById(i.clientId).currency === 'EUR')
    .reduce((s, i) => s + i.amount, 0);

  const todayCount = INSTALLMENTS.filter((i) => i.status === 'due_today').length;

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>{monthGreeting(TODAY)}, Dra. Vyvian</h1>
          <div className="adm-sub">
            Quarta-feira, 27 de maio · {todayCount} vencimento{todayCount === 1 ? '' : 's'} hoje
          </div>
        </div>
        <div className="adm-user-pill">
          <span>{session?.name || 'Vyvian Avena'}</span>
          <div className="adm-user-avatar">{session?.initials || 'V'}</div>
        </div>
      </header>

      {/* ===== KPIs ===== */}
      <div className="adm-kpi-grid">
        <div className="adm-kpi">
          <div className="adm-kpi-label">Receita prevista · Maio</div>
          <div className="adm-kpi-value">{fmtMoney(totalForecast)}</div>
          <div className="adm-kpi-delta">+12% vs. abril</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">Já recebido</div>
          <div className="adm-kpi-value">{fmtMoney(totalReceived)}</div>
          <div className="adm-kpi-delta adm-kpi-delta-muted">
            {Math.round((totalReceived / totalForecast) * 100)}% do previsto
          </div>
        </div>
        <div className="adm-kpi adm-kpi-alert">
          <div className="adm-kpi-label">Em atraso</div>
          <div className="adm-kpi-value">{fmtMoney(totalLate)}</div>
          <div className="adm-kpi-delta adm-kpi-delta-danger">
            {lateInstallments.length} parcela{lateInstallments.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="adm-kpi adm-kpi-warn">
          <div className="adm-kpi-label">Próximos 7 dias</div>
          <div className="adm-kpi-value">{next7.length}</div>
          <div className="adm-kpi-delta adm-kpi-delta-warn">{fmtMoney(next7EurTotal)}</div>
        </div>
      </div>

      {/* ===== Listas ===== */}
      <div className="adm-grid-2">
        {/* Próximos vencimentos */}
        <div className="adm-card">
          <div className="adm-card-title">
            Próximos vencimentos
            <Link to="/admin/parcelas" className="adm-card-title-link">Ver todos →</Link>
          </div>
          {next7.length === 0 ? (
            <div className="adm-empty">Nada nos próximos 7 dias.</div>
          ) : (
            <ul className="adm-due-list">
              {next7.slice(0, 6).map((i) => {
                const client = getClientById(i.clientId);
                return (
                  <li key={i.id}>
                    <Link to={`/admin/clientes/${client.id}`} style={{ color: 'inherit' }}>
                      <div className="adm-due-name">
                        {client.name}
                        <small>
                          {client.planType === 'monthly' ? 'Avença' : `Parcela ${i.label}`} · {client.area}
                        </small>
                      </div>
                    </Link>
                    <div className="adm-due-val">{fmtMoney(i.amount, client.currency)}</div>
                    <div className={whenClass(i)}>{whenLabel(i)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Em atraso */}
        <div className="adm-card adm-card-alert">
          <div className="adm-card-title adm-card-title-danger">
            ⚠ Atenção — vencidas
          </div>
          {lateInstallments.length === 0 ? (
            <div className="adm-empty">Sem atrasos. 🌿</div>
          ) : (
            <>
              <ul className="adm-due-list">
                {lateInstallments.map((i) => {
                  const client = getClientById(i.clientId);
                  return (
                    <li key={i.id}>
                      <Link to={`/admin/clientes/${client.id}`} style={{ color: 'inherit' }}>
                        <div className="adm-due-name">
                          {client.name}
                          <small>
                            {client.planType === 'monthly' ? 'Avença' : `Parcela ${i.label}`} · {client.area}
                          </small>
                        </div>
                      </Link>
                      <div className="adm-due-val">{fmtMoney(i.amount, client.currency)}</div>
                      <div className="adm-badge adm-badge-over">{whenLabel(i)}</div>
                    </li>
                  );
                })}
              </ul>
              <div style={{
                marginTop: '0.9rem',
                paddingTop: '0.85rem',
                borderTop: '1px dashed var(--line)',
                display: 'flex',
                gap: '0.45rem'
              }}>
                <button className="adm-chip danger" onClick={() => alert('Função no Plano de Fase 2')}>
                  Enviar lembrete
                </button>
                <button className="adm-chip" onClick={() => alert('Função no Plano de Fase 2')}>
                  Adiar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
