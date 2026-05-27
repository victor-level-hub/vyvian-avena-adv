// src/admin/pages/Clients.jsx
import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CLIENTS, getNextInstallmentByClientId, TODAY } from '../mockData';

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
  if (!installment) return <span className="adm-badge adm-badge-paid">Concluído</span>;
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.dueDate));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.dueDate);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">A vencer</span>;
}

export default function Clients() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');

  const filtered = useMemo(() => {
    return CLIENTS.filter((c) => {
      if (areaFilter !== 'all' && c.area !== areaFilter) return false;
      if (planFilter !== 'all' && c.planType !== planFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.taxId.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
          c.process.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [search, areaFilter, planFilter]);

  const totalActive = CLIENTS.filter((c) => {
    const next = getNextInstallmentByClientId(c.id);
    return next !== null;
  }).length;

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Clientes</h1>
          <div className="adm-sub">
            {CLIENTS.length} clientes · {totalActive} com plano ativo
          </div>
        </div>
        <button className="adm-btn adm-btn-gold" onClick={() => navigate('/admin/clientes/novo')}>
          + Novo cliente
        </button>
      </header>

      <div className="adm-filter-bar">
        <input
          type="search"
          placeholder="🔍 Pesquisar por nome, NIF/CPF, e-mail ou processo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
          <option value="all">Todas as áreas</option>
          <option value="Família">Família</option>
          <option value="Cível">Cível</option>
          <option value="Trabalhista">Trabalhista</option>
          <option value="Empresarial">Empresarial</option>
        </select>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="all">Todos os planos</option>
          <option value="monthly">Avença mensal</option>
          <option value="installment">Parcelado</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty">Nenhum cliente encontrado com esses filtros.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Área</th>
              <th>Plano</th>
              <th>Próx. vencimento</th>
              <th className="adm-text-right">Valor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const next = getNextInstallmentByClientId(c.id);
              const planLabel =
                c.planType === 'monthly'
                  ? 'Avença mensal'
                  : `Parcelado ${next ? next.label : c.planInstallments + '/' + c.planInstallments + ' ✓'}`;
              return (
                <tr
                  key={c.id}
                  className="adm-row-link"
                  onClick={() => navigate(`/admin/clientes/${c.id}`)}
                >
                  <td>
                    <strong>{c.name}</strong>
                    <br />
                    <small style={{ color: 'var(--muted)' }}>
                      {c.country === 'BR' ? c.phone : c.email}
                    </small>
                  </td>
                  <td>{c.area}</td>
                  <td>{planLabel}</td>
                  <td>{next ? fmtDate(next.dueDate) : '—'}</td>
                  <td className="adm-text-right adm-val">
                    {next ? fmtMoney(next.amount, c.currency) : (
                      <span style={{ color: 'var(--success)' }}>Quitado</span>
                    )}
                  </td>
                  <td><StatusBadge installment={next} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
