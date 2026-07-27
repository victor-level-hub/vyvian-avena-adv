// src/admin/pages/Clients.jsx
// Clientes — redesign «Vyvian Avena Design System v3» (rollout 2/5).
// Lógica intacta: filtros sincronizados com o URL, ordenação, paginação.
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, clientLogo } from '../apiClient';
import { RsShell, Icon, Reveal, Seg, PanelHead } from '../rs/ui';
import { SkeletonPage } from '../skeletons';

const logoCache = new Map();

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
  const base = { width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 };
  if (url) {
    return (
      <span style={{ ...base, background: 'radial-gradient(circle at 32% 26%, #fff 0%, #f4ecdf 55%, #e4d5bd 100%)',
                     boxShadow: 'inset 0 2px 5px rgba(255,255,255,.9), inset 0 -3px 6px rgba(0,0,0,.14), 0 3px 9px rgba(0,0,0,.16)',
                     border: '1px solid rgba(184,147,90,.4)', overflow: 'hidden' }}>
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '9%', boxSizing: 'border-box' }} />
      </span>
    );
  }
  return <span style={{ ...base, background: 'var(--grad-gold)', color: '#1a1208' }}>{initials || 'C'}</span>;
}

const fmtMoney = (a, c = 'EUR') => (c === 'BRL' ? 'R$ ' : '€ ') + Number(a || 0).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / 86400000);
}

function ChipEstado({ installment, client }) {
  const chip = (fg, bg, bd, txt) => (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', padding: '4px 9px', borderRadius: 999,
                   background: bg, border: `1px solid ${bd}`, color: fg, whiteSpace: 'nowrap' }}>{txt}</span>
  );
  const pt = client?.plan_type;
  if (pt === 'probono') return chip('var(--fg-2)', 'var(--panel)', 'var(--edge-2)', 'PRO BONO');
  if (pt === 'oficioso' && !installment) return chip('var(--gold-soft)', 'rgba(200,150,86,.12)', 'var(--edge-2)', 'AGUARDA TRÂNSITO');
  if (!installment) return chip('#9fd0ae', 'rgba(74,124,89,.16)', 'rgba(143,208,162,.4)', 'CONCLUÍDO');
  if (installment.status === 'late') return chip('#e0a294', 'rgba(160,75,60,.18)', 'rgba(200,110,90,.45)', `${Math.abs(daysUntil(installment.due_date))}D ATRASO`);
  if (installment.status === 'due_today') return chip('var(--gold-soft)', 'rgba(200,150,86,.16)', 'rgba(212,181,133,.45)', 'HOJE');
  if (daysUntil(installment.due_date) === 1) return chip('var(--gold-soft)', 'rgba(200,150,86,.16)', 'rgba(212,181,133,.45)', 'AMANHÃ');
  return chip('var(--fg-3)', 'var(--panel)', 'var(--edge)', 'A VENCER');
}

const payRank = (n) => (!n ? 2 : n.status === 'late' ? 0 : 1);

const AREAS = ['Família', 'Cível', 'Trabalhista', 'Empresarial', 'Nacionalidade', 'Administrativo', 'Criminal'];
const SITUACOES = [
  { k: 'all', label: 'TODAS' }, { k: 'late', label: 'ATRASO' }, { k: 'pending', label: 'A VENCER' },
  { k: 'quitado', label: 'QUITADO' }, { k: 'oficioso', label: 'OFICIOSO' }, { k: 'probono', label: 'PRO BONO' },
];
const PAISES = [{ k: 'all', label: 'TODOS' }, { k: 'PT', label: 'PT' }, { k: 'BR', label: 'BR' }];

export default function Clients() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState(params.get('q') || '');
  const [areaFilter, setAreaFilter] = useState(params.get('area') || 'all');
  const [countryFilter, setCountryFilter] = useState(params.get('pais') || 'all');
  const [payFilter, setPayFilter] = useState(params.get('sit') || 'all');
  const [sortBy, setSortBy] = useState(params.get('sort') || 'due');
  const [sortDir, setSortDir] = useState(params.get('dir') || 'asc');

  const [allClients, setAllClients] = useState([]);
  const [nextByClient, setNextByClient] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 25;

  useEffect(() => { setPage(1); }, [search, areaFilter, countryFilter, payFilter]);

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
        const [c, upcoming] = await Promise.all([clientsApi.list(), installmentsApi.list({ status: 'pending' })]);
        const [dueToday, late] = await Promise.all([installmentsApi.list({ status: 'due_today' }), installmentsApi.list({ status: 'late' })]);
        const all = [...(dueToday.installments || []), ...(late.installments || []), ...(upcoming.installments || [])];
        const byClient = {};
        for (const inst of all) {
          const existing = byClient[inst.client_id];
          if (!existing || new Date(inst.due_date) < new Date(existing.due_date)) byClient[inst.client_id] = inst;
        }
        setAllClients(c.clients || []);
        setNextByClient(byClient);
      } catch (err) { setError(err.message); } finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    const out = allClients.filter((c) => {
      if (areaFilter !== 'all' && c.practice_area !== areaFilter) return false;
      if (countryFilter !== 'all' && c.country !== countryFilter) return false;
      if (payFilter !== 'all') {
        const next = nextByClient[c.id];
        const situ = c.plan_type === 'probono' ? 'probono'
          : (c.plan_type === 'oficioso' && !next) ? 'oficioso'
          : !next ? 'quitado' : (next.status === 'late' ? 'late' : 'pending');
        if (situ !== payFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.extra_names || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.identification || '').replace(/\s/g, '').toLowerCase().includes(q.replace(/\s/g, ''))
        );
      }
      return true;
    });
    const dir = sortDir === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      const na = nextByClient[a.id], nb = nextByClient[b.id];
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name, 'pt');
      else if (sortBy === 'amount') cmp = Number(na?.amount || 0) - Number(nb?.amount || 0);
      else {
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
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };
  const sortArrow = (col) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const totalActive = Object.keys(nextByClient).length;

  if (loading) return <SkeletonPage kpis={0} rows={7} />;
  if (error) return <div className="adm-login-error">{error}</div>;

  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--gold)', borderBottom: '1px solid var(--edge-2)', whiteSpace: 'nowrap' };
  const td = { padding: '12px 12px', borderBottom: '1px solid var(--edge)', fontSize: 13.5, color: 'var(--fg-2)', verticalAlign: 'middle' };

  return (
    <RsShell overline="Área privada · Clientes" titulo="Clientes"
             sub={`${allClients.length} clientes · ${totalActive} com plano ativo`}
             right={<button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 4 }}
                            onClick={() => navigate('/admin/clientes/novo')}>
                      <Icon name="plus" size={13} />Novo cliente
                    </button>}>

      {/* barra de filtros */}
      <Reveal>
        <div className="glass" style={{ padding: '16px 18px', marginBottom: 18, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="field" placeholder="Pesquisar por nome, NIF/CPF ou e-mail…" value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 220, padding: '10px 14px', fontSize: 13.5 }} />
          <select className="field" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}
                  aria-label="Filtrar por área" data-tip="Filtrar por área de atuação"
                  style={{ padding: '10px 12px', fontSize: 13, cursor: 'pointer' }}>
            <option value="all">Todas as áreas</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="overline" style={{ fontSize: 9, letterSpacing: '.16em' }}>País</span>
            <Seg small items={PAISES} value={countryFilter} onChange={setCountryFilter} />
          </span>
          {hasFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              <Icon name="close" size={12} />Limpar
            </button>
          )}
        </div>
      </Reveal>

      <Reveal d={60}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="overline" style={{ fontSize: 9, letterSpacing: '.16em' }}>Situação</span>
          <Seg small items={SITUACOES} value={payFilter} onChange={setPayFilter} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-3)' }}>
            {filtered.length} {filtered.length === 1 ? 'cliente' : 'clientes'}{hasFilters ? ` de ${allClients.length}` : ''}
          </span>
        </div>
      </Reveal>

      {filtered.length === 0 ? (
        <Reveal cls="glass" style={{ padding: '40px 30px', textAlign: 'center', fontSize: 13.5, color: 'var(--fg-3)' }}>
          Nenhum cliente encontrado com esses filtros.
        </Reveal>
      ) : (
        <Reveal d={100}>
          <div className="glass" style={{ padding: '6px 8px 4px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')} data-tip="Ordenar por nome">Cliente{sortArrow('name')}</th>
                  <th style={th}>Área</th>
                  <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('due')} data-tip="Ordenar por vencimento (atrasos primeiro)">Próx. vencimento{sortArrow('due')}</th>
                  <th style={{ ...th, cursor: 'pointer', textAlign: 'right' }} onClick={() => toggleSort('amount')} data-tip="Ordenar por valor">Valor{sortArrow('amount')}</th>
                  <th style={th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((c) => {
                  const next = nextByClient[c.id];
                  return (
                    <tr key={c.id} onClick={() => navigate(`/admin/clientes/${c.id}`)}
                        style={{ cursor: 'pointer', transition: 'background .2s' }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--panel)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={td}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <RowAvatar client={c} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{c.name}</span>
                            {Number(c.extra_people) > 0 && (
                              <span data-tip={`Cliente conjunto · com ${c.extra_names || ''}`}
                                    style={{ marginLeft: 7, fontSize: 9.5, fontWeight: 800, color: 'var(--gold-soft)',
                                             background: 'rgba(184,147,90,.14)', border: '1px solid var(--edge-2)',
                                             borderRadius: 999, padding: '1px 7px', verticalAlign: 'middle' }}>
                                +{c.extra_people}
                              </span>
                            )}
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                              {(c.country === 'BR' ? c.phone : c.email) || '—'} · {c.country}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td style={td}>{c.practice_area || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{next ? fmtDate(next.due_date) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="mono">
                        {next ? fmtMoney(next.amount, next.currency)
                          : c.plan_type === 'probono' ? '—'
                          : c.plan_type === 'oficioso' ? 'A fixar'
                          : <span style={{ color: '#9fd0ae' }}>Quitado</span>}
                      </td>
                      <td style={td}><ChipEstado installment={next} client={c} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {filtered.length > PER_PAGE && (() => {
        const totalPages = Math.ceil(filtered.length / PER_PAGE);
        const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1);
        const withGaps = pages.flatMap((p, i) => (i > 0 && p - pages[i - 1] > 1 ? ['…', p] : [p]));
        return (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">‹</button>
            {withGaps.map((p, i) => p === '…'
              ? <span key={'g' + i} style={{ color: 'var(--fg-3)', fontSize: 12 }}>…</span>
              : <button key={p} type="button" className={'btn btn-sm ' + (p === page ? 'btn-gold' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>)}
            <button type="button" className="btn btn-ghost btn-sm" disabled={page === totalPages} onClick={() => setPage(page + 1)} aria-label="Página seguinte">›</button>
            <span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 6 }}>{filtered.length} clientes</span>
          </div>
        );
      })()}
    </RsShell>
  );
}
