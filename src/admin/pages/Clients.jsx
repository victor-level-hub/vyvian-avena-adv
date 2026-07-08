// src/admin/pages/Clients.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, clientLogo } from '../apiClient';

// cache de logos (objectURL) para não refazer o fetch a cada render
const logoCache = new Map();

// Avatar discreto da lista: logo (contain, sem corte) ou iniciais
function RowAvatar({ client }) {
  const [url, setUrl] = useState(logoCache.get(client.id) || null);
  useEffect(() => {
    if (!client.logo_key || logoCache.has(client.id)) return;
    let alive = true;
    clientLogo.fetchUrl(client.id).then((u) => {
      if (u) logoCache.set(client.id, u);
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [client.id, client.logo_key]);

  const initials = (client.name || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const base = {
    width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.78rem', fontWeight: 700,
  };
  if (url) {
    return (
      // 3D em tom creme (a cor do fundo da página), com relevo e aro dourado subtil
      <span style={{
        ...base,
        background: 'radial-gradient(circle at 32% 26%, #ffffff 0%, #f4ecdf 55%, #e4d5bd 100%)',
        boxShadow: 'inset 0 2px 5px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(0,0,0,0.14), 0 3px 9px rgba(0,0,0,0.16)',
        border: '1px solid rgba(184,147,90,0.35)',
        overflow: 'hidden',
      }}>
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '9%', boxSizing: 'border-box', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))' }} />
      </span>
    );
  }
  return (
    <span style={{ ...base, background: 'var(--gold, #b8935a)', color: '#fff' }}>{initials || 'C'}</span>
  );
}

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

// Peso de ordenação por estado de pagamento: atraso primeiro, depois a vencer, depois quitado
function payRank(next) {
  if (!next) return 2;            // quitado / sem plano
  if (next.status === 'late') return 0;
  return 1;                        // a vencer / hoje / amanhã
}

export default function Clients() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Estado inicial lido do URL (permite guardar/partilhar uma vista filtrada)
  const [search, setSearch] = useState(params.get('q') || '');
  const [areaFilter, setAreaFilter] = useState(params.get('area') || 'all');
  const [countryFilter, setCountryFilter] = useState(params.get('pais') || 'all');
  const [payFilter, setPayFilter] = useState(params.get('sit') || 'all');
  const [sortBy, setSortBy] = useState(params.get('sort') || 'due'); // due | name | amount
  const [sortDir, setSortDir] = useState(params.get('dir') || 'asc'); // asc | desc

  const [allClients, setAllClients] = useState([]);
  const [nextByClient, setNextByClient] = useState({}); // { clientId: installment | null }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sincroniza filtros/ordenação com o URL (sem poluir o histórico)
  useEffect(() => {
    const p = {};
    if (search) p.q = search;
    if (areaFilter !== 'all') p.area = areaFilter;
    if (countryFilter !== 'all') p.pais = countryFilter;
    if (payFilter !== 'all') p.sit = payFilter;
    if (sortBy !== 'due') p.sort = sortBy;
    if (sortDir !== 'asc') p.dir = sortDir;
    setParams(p, { replace: true });
  }, [search, areaFilter, countryFilter, payFilter, sortBy, sortDir, setParams]);

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
    const out = allClients.filter((c) => {
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

    const dir = sortDir === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      const na = nextByClient[a.id];
      const nb = nextByClient[b.id];
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name, 'pt');
      } else if (sortBy === 'amount') {
        cmp = Number(na?.amount || 0) - Number(nb?.amount || 0);
      } else { // 'due' — por estado de pagamento e depois data de vencimento
        const r = payRank(na) - payRank(nb);
        if (r !== 0) cmp = r;
        else {
          const da = na ? new Date(na.due_date).getTime() : Infinity;
          const db = nb ? new Date(nb.due_date).getTime() : Infinity;
          cmp = da - db;
        }
      }
      return cmp * dir;
    });
    return out;
  }, [search, areaFilter, countryFilter, payFilter, sortBy, sortDir, allClients, nextByClient]);

  const hasFilters = search || areaFilter !== 'all' || countryFilter !== 'all' || payFilter !== 'all';
  const clearFilters = () => { setSearch(''); setAreaFilter('all'); setCountryFilter('all'); setPayFilter('all'); };

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };
  const sortArrow = (col) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

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
          placeholder="Pesquisar por nome, NIF/CPF ou e-mail…"
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
              <th className="adm-th-sort" onClick={() => toggleSort('name')}>Cliente{sortArrow('name')}</th>
              <th>Área</th>
              <th>País</th>
              <th className="adm-th-sort" onClick={() => toggleSort('due')}>Próx. vencimento{sortArrow('due')}</th>
              <th className="adm-text-right adm-th-sort" onClick={() => toggleSort('amount')}>Valor{sortArrow('amount')}</th>
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <RowAvatar client={c} />
                      <span>
                        <strong>{c.name}</strong>
                        <br />
                        <small style={{ color: 'var(--muted)' }}>
                          {c.country === 'BR' ? c.phone : c.email}
                        </small>
                      </span>
                    </span>
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
