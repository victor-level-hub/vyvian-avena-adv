// src/admin/pages/Clients.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  if (!installment) return <span className="adm-badge adm-badge-paid">Concluído</span>;
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.due_date));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.due_date);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">A vencer</span>;
}

export default function Clients() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [payFilter, setPayFilter] = useState('all');
  const [allClients, setAllClients] = useState([]);
  const [nextByClient, setNextByClient] = useState({}); // { clientId: installment | null }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, upcoming] = await Promise.all([
          clientsApi.list(),
          installmentsApi.list({ status: 'pending' }), // pega pending
        ]);
        // Para "próximo vencimento", também precisamos due_today + late
        const [dueToday, late] = await Promise.all([
          installmentsApi.list({ status: 'due_today' }),
          installmentsApi.list({ status: 'late' }),
        ]);
        const all = [
          ...(dueToday.installments || []),
          ...(late.installments || []),
          ...(upcoming.installments || []),
        ];
        // Para cada cliente, encontrar a parcela mais próxima
        const byClient = {};
        for (const inst of all) {
          const existing = byClient[inst.client_id];
          if (!existing || new Date(inst.due_date) < new Date(existing.due_date)) {
            byClient[inst.client_id] = inst;
          }
        }
        setAllClients(c.clients || []);
        setNextByClient(byClient);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return allClients.filter((c) => {
      if (areaFilter !== 'all' && c.practice_area !== areaFilter) return false;
      if (countryFilter !== 'all' && c.country !== countryFilter) return false;
      if (payFilter !== 'all') {
        const next = nextByClient[c.id];
        const situ = !next ? 'quitado' : (next.status === 'late' ? 'late' : 'pending');
        if (situ !== payFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.identification || '').replace(/\s/g, '').toLowerCase().includes(q.replace(/\s/g, ''))
        );
      }
      return true;
    });
  }, [search, areaFilter, countryFilter, payFilter, allClients, nextByClient]);

  const hasFilters = search || areaFilter !== 'all' || countryFilter !== 'all' || payFilter !== 'all';
  const clearFilters = () => { setSearch(''); setAreaFilter('all'); setCountryFilter('all'); setPayFilter('all'); };

  const totalActive = Object.keys(nextByClient).length;

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar clientes…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Clientes</h1>
          <div className="adm-sub">
            {allClients.length} clientes · {totalActive} com plano ativo
          </div>
        </div>
        <button className="adm-btn adm-btn-gold" onClick={() => navigate('/admin/clientes/novo')}>
          + Novo cliente
        </button>
      </header>

      <div className="adm-filter-bar">
        <input
          type="search"
          placeholder="🔍 Pesquisar por nome, NIF/CPF ou e-mail…"
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
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
          <option value="all">Todos os países</option>
          <option value="PT">Portugal</option>
          <option value="BR">Brasil</option>
        </select>
        <select value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option value="all">Todas as situações</option>
          <option value="late">Em atraso</option>
          <option value="pending">A vencer</option>
          <option value="quitado">Quitado</option>
        </select>
        {hasFilters && (
          <button type="button" className="adm-btn" onClick={clearFilters}>Limpar filtros</button>
        )}
      </div>

      <div className="adm-sub" style={{ marginBottom: '0.75rem' }}>
        {filtered.length} {filtered.length === 1 ? 'cliente' : 'clientes'}
        {hasFilters ? ` de ${allClients.length}` : ''}
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty">Nenhum cliente encontrado com esses filtros.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Área</th>
              <th>País</th>
              <th>Próx. vencimento</th>
              <th className="adm-text-right">Valor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const next = nextByClient[c.id];
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
                  <td>{c.practice_area || '—'}</td>
                  <td>{c.country}</td>
                  <td>{next ? fmtDate(next.due_date) : '—'}</td>
                  <td className="adm-text-right adm-val">
                    {next ? fmtMoney(next.amount, next.currency) : (
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

