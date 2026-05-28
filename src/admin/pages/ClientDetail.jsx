// src/admin/pages/ClientDetail.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi } from '../apiClient';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ installment }) {
  if (installment.status === 'paid') return <span className="adm-badge adm-badge-paid">Pago</span>;
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.due_date));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.due_date);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">Pendente</span>;
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const [activeTab, setActiveTab] = useState('plan');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await clientsApi.get(clientId);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [clientId]);

  const handleMarkPaid = async (installmentId) => {
    if (!confirm('Marcar esta parcela como paga (hoje)?')) return;
    setMarkingPaid(installmentId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await installmentsApi.markPaid(installmentId, today);
      await loadData();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setMarkingPaid(null);
    }
  };

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar cliente…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;
  if (!data?.client) {
    return <div className="adm-empty">Cliente não encontrado. <Link to="/admin/clientes">Voltar à lista</Link></div>;
  }

  const client = data.client;
  const installments = (data.installments || []).slice().sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const paid = installments.filter((i) => i.status === 'paid');
  const pending = installments.filter((i) => i.status !== 'paid');

  const initials = (client.name || '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const isMonthly = !client.honorarios_total || client.honorarios_total === 0;
  const currency = client.country === 'BR' ? 'BRL' : 'EUR';

  let summary;
  if (!isMonthly) {
    const totalPaid = paid.reduce((s, i) => s + Number(i.amount), 0);
    const totalRemaining = pending.reduce((s, i) => s + Number(i.amount), 0);
    summary = {
      contracted: client.honorarios_total,
      paid: totalPaid,
      remaining: totalRemaining,
      progress: `${paid.length} de ${client.honorarios_parcelas}`,
    };
  } else {
    const monthlyValue = installments[0]?.amount || 0;
    const startDate = client.contract_start_date ? new Date(client.contract_start_date) : new Date();
    const monthsActive = Math.max(1, Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24 * 30)));
    summary = {
      monthlyValue,
      paid: paid.reduce((s, i) => s + Number(i.amount), 0),
      progress: `${monthsActive} meses ativo`,
    };
  }

  return (
    <>
      <div className="adm-client-head">
        <div className="adm-client-avatar">{initials || 'C'}</div>
        <div>
          <h1>{client.name}</h1>
          <div className="adm-client-meta">
            {client.phone && <span>📞 {client.phone}</span>}
            {client.email && <span>✉ {client.email}</span>}
            {client.identification && (
              <span>{client.country === 'BR' ? 'CPF/CNPJ' : 'NIF'} {client.identification}</span>
            )}
          </div>
          <div className="adm-client-meta" style={{ marginTop: '0.4rem' }}>
            <span>{client.practice_area || '—'} · {client.country}</span>
          </div>
        </div>
        <div className="adm-client-actions">
          <button onClick={() => alert('Edição completa na próxima iteração')}>Editar</button>
          <button className="primary" onClick={() => alert('Registo de pagamento avulso — em desenvolvimento')}>+ Pagamento</button>
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
                {!isMonthly ? 'Total contratado' : 'Avença mensal'}
              </div>
              <div className="adm-plan-item-value">
                {!isMonthly
                  ? fmtMoney(summary.contracted, currency)
                  : fmtMoney(summary.monthlyValue, currency)}
              </div>
            </div>
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">Já recebido</div>
              <div className="adm-plan-item-value adm-plan-item-value-success">
                {fmtMoney(summary.paid, currency)}
              </div>
            </div>
            {!isMonthly ? (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Em aberto</div>
                <div className="adm-plan-item-value adm-plan-item-value-warn">
                  {fmtMoney(summary.remaining, currency)}
                </div>
              </div>
            ) : (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Início da avença</div>
                <div className="adm-plan-item-value">{fmtDate(client.contract_start_date)}</div>
              </div>
            )}
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {!isMonthly ? 'Progresso' : 'Tempo ativo'}
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
                const isTomorrow = !isToday && i.status !== 'paid' && daysUntil(i.due_date) === 1;
                const highlight = isToday || isTomorrow;
                return (
                  <tr key={i.id} className={highlight ? 'adm-row-highlight' : ''}>
                    <td>{i.installment_number}/{i.total_installments}</td>
                    <td><strong>{fmtDate(i.due_date)}</strong></td>
                    <td className="adm-text-right adm-val">{fmtMoney(i.amount, i.currency)}</td>
                    <td>{i.paid_date ? fmtDate(i.paid_date) : '—'}</td>
                    <td><StatusBadge installment={i} /></td>
                    <td>
                      {i.status === 'paid' ? (
                        <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); alert('Geração de recibo PDF — em desenvolvimento'); }}>
                          Recibo
                        </a>
                      ) : (
                        <a
                          href="#"
                          style={{ fontSize: '0.75rem' }}
                          onClick={(e) => { e.preventDefault(); handleMarkPaid(i.id); }}
                        >
                          {markingPaid === i.id ? 'A marcar…' : 'Marcar pago'}
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
            <strong>{client.name}</strong> é cliente desde {fmtDate(client.contract_start_date)},
            na área de <strong>{client.practice_area || 'geral'}</strong>.
          </p>
          <p>
            Plano contratado: {isMonthly
              ? `avença mensal de ${fmtMoney(summary.monthlyValue, currency)}`
              : `parcelado em ${client.honorarios_parcelas} prestações (total ${fmtMoney(client.honorarios_total, currency)})`}.
          </p>
          {data.rules?.length > 0 && (
            <p>
              Lembretes configurados: {data.rules.map(r => `${r.days_before}d antes via ${r.channel}`).join(', ')}.
            </p>
          )}
        </div>
      )}

      {activeTab === 'comms' && (
        <div className="adm-empty">Histórico de comunicações — em desenvolvimento.</div>
      )}

      {activeTab === 'docs' && (
        <div className="adm-empty">Gestão de documentos — em desenvolvimento.</div>
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
