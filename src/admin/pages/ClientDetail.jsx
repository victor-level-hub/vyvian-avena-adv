// src/admin/pages/ClientDetail.jsx
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getClientById, getInstallmentsByClientId, TODAY } from '../mockData';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  return symbol + '\u00A0' + amount.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - TODAY) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ installment }) {
  if (installment.status === 'paid') return <span className="adm-badge adm-badge-paid">Pago</span>;
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.dueDate));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.dueDate);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">Pendente</span>;
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('plan');

  const client = getClientById(clientId);

  if (!client) {
    return (
      <div className="adm-empty">
        Cliente não encontrado. <Link to="/admin/clientes">Voltar à lista</Link>
      </div>
    );
  }

  const installments = getInstallmentsByClientId(client.id);
  const paid = installments.filter((i) => i.status === 'paid');
  const pending = installments.filter((i) => i.status !== 'paid');

  // ===== resumo do plano =====
  let summary;
  if (client.planType === 'installment') {
    const totalPaid = paid.reduce((s, i) => s + i.amount, 0);
    const totalRemaining = pending.reduce((s, i) => s + i.amount, 0);
    summary = {
      contracted: client.planTotal,
      paid: totalPaid,
      remaining: totalRemaining,
      progress: `${paid.length} de ${client.planInstallments}`,
    };
  } else {
    const startDate = new Date(client.startDate);
    const monthsActive = Math.round((TODAY - startDate) / (1000 * 60 * 60 * 24 * 30));
    summary = {
      contracted: null,
      paid: paid.reduce((s, i) => s + i.amount, 0),
      remaining: null,
      progress: `${monthsActive} meses ativo`,
    };
  }

  return (
    <>
      <div className="adm-client-head">
        <div className="adm-client-avatar">{client.initials}</div>
        <div>
          <h1>{client.name}</h1>
          <div className="adm-client-meta">
            <span>📞 {client.phone}</span>
            <span>✉ {client.email}</span>
            <span>{client.country === 'BR' ? 'CPF/CNPJ' : 'NIF'} {client.taxId}</span>
          </div>
          <div className="adm-client-meta" style={{ marginTop: '0.4rem' }}>
            <span>Processo {client.process} · {client.area} · {client.location}</span>
          </div>
        </div>
        <div className="adm-client-actions">
          <button onClick={() => alert('Função no Plano de Fase 2')}>Editar</button>
          <button className="primary" onClick={() => alert('Função no Plano de Fase 2')}>+ Registar pagamento</button>
        </div>
      </div>

      <div className="adm-tabs">
        {[
          { id: 'plan', label: 'Plano de pagamento' },
          { id: 'summary', label: 'Resumo' },
          { id: 'comms', label: 'Comunicações' },
          { id: 'docs', label: 'Documentos' },
          { id: 'notes', label: 'Notas privadas' },
        ].map((t) => (
          <button
            key={t.id}
            className={'adm-tab' + (activeTab === t.id ? ' active' : '')}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'plan' && (
        <>
          <div className="adm-plan-summary">
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {client.planType === 'installment' ? 'Total contratado' : 'Avença mensal'}
              </div>
              <div className="adm-plan-item-value">
                {client.planType === 'installment'
                  ? fmtMoney(summary.contracted, client.currency)
                  : fmtMoney(client.monthlyValue, client.currency)}
              </div>
            </div>
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">Já recebido</div>
              <div className="adm-plan-item-value adm-plan-item-value-success">
                {fmtMoney(summary.paid, client.currency)}
              </div>
            </div>
            {client.planType === 'installment' && (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Em aberto</div>
                <div className="adm-plan-item-value adm-plan-item-value-warn">
                  {fmtMoney(summary.remaining, client.currency)}
                </div>
              </div>
            )}
            {client.planType === 'monthly' && (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Início da avença</div>
                <div className="adm-plan-item-value">{fmtDate(client.startDate)}</div>
              </div>
            )}
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {client.planType === 'installment' ? 'Progresso' : 'Tempo ativo'}
              </div>
              <div className="adm-plan-item-value">{summary.progress}</div>
            </div>
          </div>

          <table className="adm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Vencimento</th>
                <th className="adm-text-right">Valor</th>
                <th>Pago em</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => {
                const isToday = i.status === 'due_today';
                const isTomorrow = !isToday && i.status !== 'paid' && daysUntil(i.dueDate) === 1;
                const highlight = isToday || isTomorrow;
                return (
                  <tr key={i.id} className={highlight ? 'adm-row-highlight' : ''}>
                    <td>{i.label}</td>
                    <td><strong>{fmtDate(i.dueDate)}</strong></td>
                    <td className="adm-text-right adm-val">{fmtMoney(i.amount, client.currency)}</td>
                    <td>{i.paidDate ? fmtDate(i.paidDate) : '—'}</td>
                    <td><StatusBadge installment={i} /></td>
                    <td>
                      {i.status === 'paid' ? (
                        <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); alert('Geração de recibo na Fase 3'); }}>
                          Recibo
                        </a>
                      ) : (
                        <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); alert('Marcação de pagamento na integração com BD'); }}>
                          Marcar pago
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {activeTab === 'summary' && (
        <div className="adm-card">
          <div className="adm-card-title">Resumo</div>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>{client.name}</strong> é cliente desde {fmtDate(client.startDate)},
            na área de <strong>{client.area}</strong>.
          </p>
          <p>
            Plano contratado: {client.planType === 'monthly'
              ? `avença mensal de ${fmtMoney(client.monthlyValue, client.currency)}`
              : `parcelado em ${client.planInstallments} prestações de ${fmtMoney(client.monthlyValue, client.currency)} (total ${fmtMoney(client.planTotal, client.currency)})`}.
          </p>
          <p>
            Lembretes configurados: {client.reminderDays} dias antes do vencimento via {client.reminderChannels.join(' + ')}.
          </p>
        </div>
      )}

      {activeTab === 'comms' && (
        <div className="adm-empty">Histórico de comunicações disponível na Fase 2.</div>
      )}

      {activeTab === 'docs' && (
        <div className="adm-empty">Gestão de documentos disponível na Fase 3.</div>
      )}

      {activeTab === 'notes' && (
        <div className="adm-card">
          <div className="adm-card-title">Notas privadas</div>
          <p style={{ fontStyle: client.notes ? 'normal' : 'italic', color: client.notes ? 'var(--ink)' : 'var(--muted)' }}>
            {client.notes || 'Sem notas registadas para este cliente.'}
          </p>
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <Link to="/admin/clientes" className="adm-btn adm-btn-ghost adm-btn-sm">
          ← Voltar à lista
        </Link>
      </div>
    </>
  );
}
