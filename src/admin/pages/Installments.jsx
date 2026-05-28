// src/admin/pages/Installments.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { installments as installmentsApi } from '../apiClient';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / (1000 * 60 * 60 * 24));
}

const STATUS_OPTIONS = [
  { id: 'all', label: 'Todas' },
  { id: 'paid', label: 'Pagas' },
  { id: 'pending', label: 'A vencer' },
  { id: 'late', label: 'Atrasadas' },
];

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export default function Installments() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('current'); // 'current' | 'all-future' | 'all'
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await installmentsApi.list();
      setAll(res.installments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

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

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return all.filter((i) => {
      // filtro de mês
      if (monthFilter === 'current') {
        if (i.due_date.slice(0, 7) !== currentMonth()) return false;
      } else if (monthFilter === 'all-future') {
        if (new Date(i.due_date) < today && i.status !== 'late') return false;
      }
      // filtro de estado
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending') return i.status === 'pending' || i.status === 'due_today';
      return i.status === statusFilter;
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [statusFilter, monthFilter, all]);

  const monthAll = all.filter((i) => i.due_date.slice(0, 7) === currentMonth());
  const counts = {
    all: monthAll.length,
    paid: monthAll.filter((i) => i.status === 'paid').length,
    pending: monthAll.filter((i) => i.status === 'pending' || i.status === 'due_today').length,
    late: monthAll.filter((i) => i.status === 'late').length,
  };

  const monthTotalEur = monthAll
    .filter((i) => i.currency === 'EUR')
    .reduce((s, i) => s + Number(i.amount), 0);

  function handleExport() {
    const headers = ['Cliente', 'Parcela', 'Vencimento', 'Valor', 'Moeda', 'Estado'];
    const rows = filtered.map((i) => [
      i.client_name, `${i.installment_number}/${i.total_installments}`,
      i.due_date, i.amount, i.currency, i.status,
    ].join(';'));
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parcelas-${new Date().toISOString().slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar parcelas…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  const monthLabel = new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Parcelas e mensalidades</h1>
          <div className="adm-sub">
            {monthLabel} · {monthAll.length} lançamentos · {fmtMoney(monthTotalEur)} total (EUR)
          </div>
        </div>
        <button className="adm-btn" onClick={handleExport}>⤓ Exportar CSV</button>
      </header>

      <div className="adm-chip-row" style={{ marginBottom: '1.25rem' }}>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.id}
            className={
              'adm-chip' +
              (statusFilter === s.id ? ' active' : '') +
              (s.id === 'late' ? ' danger' : '')
            }
            onClick={() => setStatusFilter(s.id)}
          >
            {s.label} ({counts[s.id] !== undefined ? counts[s.id] : '—'})
          </button>
        ))}
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          style={{
            marginLeft: 'auto',
            padding: '0.4rem 0.95rem',
            border: '1px solid var(--line)',
            fontSize: '0.75rem',
            background: 'white',
          }}
        >
          <option value="current">{monthLabel}</option>
          <option value="all-future">Todas a vencer</option>
          <option value="all">Todo o histórico</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty">Nenhuma parcela com estes filtros.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>País</th>
              <th>Parcela</th>
              <th>Vencimento</th>
              <th className="adm-text-right">Valor</th>
              <th>Estado</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const isToday = i.status === 'due_today';
              return (
                <tr key={i.id} className={isToday ? 'adm-row-highlight' : ''}>
                  <td>
                    <Link to={`/admin/clientes/${i.client_id}`} style={{ color: 'inherit' }}>
                      {i.client_name}
                    </Link>
                  </td>
                  <td>{i.client_country}</td>
                  <td>{i.installment_number}/{i.total_installments}</td>
                  <td><strong>{fmtDate(i.due_date)}</strong></td>
                  <td className="adm-text-right adm-val">{fmtMoney(i.amount, i.currency)}</td>
                  <td>
                    {i.status === 'paid' && <span className="adm-badge adm-badge-paid">Pago</span>}
                    {i.status === 'pending' && <span className="adm-badge adm-badge-pending">A vencer</span>}
                    {i.status === 'due_today' && <span className="adm-badge adm-badge-warn">Hoje</span>}
                    {i.status === 'late' && <span className="adm-badge adm-badge-late">Vencido</span>}
                  </td>
                  <td>
                    {i.status !== 'paid' && (
                      <a
                        href="#"
                        style={{ fontSize: '0.74rem' }}
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
      )}
    </>
  );
}
