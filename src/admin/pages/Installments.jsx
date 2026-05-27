// src/admin/pages/Installments.jsx
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { INSTALLMENTS, getClientById, TODAY } from '../mockData';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  return symbol + '\u00A0' + amount.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - TODAY) / (1000 * 60 * 60 * 24));
}

const STATUS_OPTIONS = [
  { id: 'all', label: 'Todas' },
  { id: 'paid', label: 'Pagas' },
  { id: 'pending', label: 'A vencer' },
  { id: 'late', label: 'Atrasadas' },
];

export default function Installments() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('current');

  const filtered = useMemo(() => {
    return INSTALLMENTS.filter((i) => {
      // filtro de mês
      if (monthFilter === 'current') {
        const d = new Date(i.dueDate);
        if (d.getFullYear() !== TODAY.getFullYear() || d.getMonth() !== TODAY.getMonth()) {
          return false;
        }
      } else if (monthFilter === 'all-future') {
        if (new Date(i.dueDate) < TODAY && i.status !== 'late') return false;
      }
      // filtro de estado
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending') return i.status === 'pending' || i.status === 'due_today';
      return i.status === statusFilter;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [statusFilter, monthFilter]);

  // contagens
  const monthAll = INSTALLMENTS.filter((i) => {
    const d = new Date(i.dueDate);
    return d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth();
  });
  const counts = {
    all: monthAll.length,
    paid: monthAll.filter((i) => i.status === 'paid').length,
    pending: monthAll.filter((i) => i.status === 'pending' || i.status === 'due_today').length,
    late: monthAll.filter((i) => i.status === 'late').length,
  };

  const monthTotal = monthAll
    .filter((i) => getClientById(i.clientId).currency === 'EUR')
    .reduce((s, i) => s + i.amount, 0);

  function handleExport() {
    const headers = ['Cliente', 'Tipo', 'Parcela', 'Vencimento', 'Valor', 'Moeda', 'Estado'];
    const rows = filtered.map((i) => {
      const c = getClientById(i.clientId);
      return [
        c.name,
        c.planType === 'monthly' ? 'Avença' : 'Parcelado',
        i.label,
        i.dueDate,
        i.amount,
        c.currency,
        i.status,
      ].join(';');
    });
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parcelas-${TODAY.toISOString().slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Parcelas e mensalidades</h1>
          <div className="adm-sub">
            Maio de 2026 · {monthAll.length} lançamentos · {fmtMoney(monthTotal)} total (EUR)
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
          <option value="current">Maio · 2026</option>
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
              <th>Tipo</th>
              <th>Parcela</th>
              <th>Vencimento</th>
              <th className="adm-text-right">Valor</th>
              <th>Estado</th>
              <th>Lembrete</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const c = getClientById(i.clientId);
              const isToday = i.status === 'due_today';
              return (
                <tr key={i.id} className={isToday ? 'adm-row-highlight' : ''}>
                  <td>
                    <Link to={`/admin/clientes/${c.id}`} style={{ color: 'inherit' }}>
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.planType === 'monthly' ? (c.country === 'BR' ? 'Avença BR' : 'Avença') : 'Parcelado'}</td>
                  <td>{i.label}</td>
                  <td><strong>{fmtDate(i.dueDate)}</strong></td>
                  <td className="adm-text-right adm-val">{fmtMoney(i.amount, c.currency)}</td>
                  <td>
                    {i.status === 'paid' && <span className="adm-badge adm-badge-paid">Pago</span>}
                    {i.status === 'pending' && <span className="adm-badge adm-badge-pending">A vencer</span>}
                    {i.status === 'due_today' && <span className="adm-badge adm-badge-warn">Hoje</span>}
                    {i.status === 'late' && <span className="adm-badge adm-badge-late">Vencido</span>}
                  </td>
                  <td>
                    {i.status === 'paid' && <small style={{ color: 'var(--muted)' }}>enviado</small>}
                    {i.status === 'late' && (
                      <a
                        href="#"
                        style={{ fontSize: '0.74rem', color: 'var(--danger)' }}
                        onClick={(e) => { e.preventDefault(); alert('Reenvio de lembrete na Fase 2'); }}
                      >
                        Reenviar
                      </a>
                    )}
                    {(i.status === 'pending' || i.status === 'due_today') && (
                      <small style={{ color: 'var(--muted)' }}>
                        {daysUntil(i.dueDate) <= 5 ? 'agendado' : '—'}
                      </small>
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
