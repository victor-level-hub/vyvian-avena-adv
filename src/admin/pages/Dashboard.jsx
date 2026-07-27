// src/admin/pages/Dashboard.jsx
// Painel — redesign «Vyvian Avena Design System v3» (rollout à Área Privada).
// Mesmo shell/tema das Redes Sociais (RsShell); lógica e endpoints inalterados.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSession } from '../auth';
import { dashboard as dashboardApi } from '../apiClient';
import { SkeletonPage } from '../skeletons';
import { RsShell, Icon, Ticker, Reveal, Seg, PanelHead } from '../rs/ui';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + ' ' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysUntilDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / 86400000);
}

function whenLabel(i) {
  if (i.status === 'late') return `${Math.abs(daysUntilDate(i.due_date))}d atraso`;
  const days = daysUntilDate(i.due_date);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days < 0) return `${Math.abs(days)}d atraso`;
  return `${days} dias`;
}

// cores do selo de prazo (paleta rs)
function corPrazo(i) {
  if (i.status === 'late') return { bg: 'rgba(160,75,60,.18)', bd: 'rgba(200,110,90,.45)', fg: '#e0a294' };
  const d = daysUntilDate(i.due_date);
  if (d <= 1) return { bg: 'rgba(200,150,86,.16)', bd: 'rgba(212,181,133,.45)', fg: 'var(--gold-soft)' };
  if (d <= 5) return { bg: 'rgba(200,150,86,.10)', bd: 'var(--edge-2)', fg: 'var(--fg-2)' };
  return { bg: 'var(--panel)', bd: 'var(--edge)', fg: 'var(--fg-3)' };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 19) return 'Boa tarde';
  return 'Boa noite';
}

const hojeLongo = () => new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });

const JANELAS = [
  { k: 7, label: '7D' }, { k: 15, label: '15D' }, { k: 30, label: '30D' },
  { k: 60, label: '60D' }, { k: 90, label: '90D' }, { k: 180, label: '180D' },
];

export default function Dashboard() {
  const session = getSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [upcomingDays, setUpcomingDays] = useState(30);

  useEffect(() => {
    dashboardApi.get(upcomingDays)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [upcomingDays]);

  if (loading) return <SkeletonPage kpis={4} rows={5} />;
  if (error) return <div className="adm-login-error">{error}</div>;
  if (!data) return null;

  const { counts, upcoming_revenue, upcoming, alerts } = data;
  const eurRev = upcoming_revenue.find((r) => r.currency === 'EUR');
  const brlRev = upcoming_revenue.find((r) => r.currency === 'BRL');

  const kpis = [
    { icon: 'trend', label: `Receita prevista (${upcomingDays}d)`, valor: <Ticker value={eurRev?.total || 0} prefix={'€ '} />, nota: brlRev ? `+ ${fmtMoney(brlRev.total, 'BRL')} em BRL` : 'Apenas EUR este período' },
    { icon: 'users', label: 'Clientes ativos', valor: <Ticker value={counts.active_clients} />, nota: `${counts.paid_last_30d} parcelas pagas (30d)` },
    { icon: 'info', label: 'Em atraso', valor: <Ticker value={counts.late} />, nota: counts.late === 0 ? 'Sem atrasos 🌿' : 'Requer ação', danger: counts.late > 0 },
    { icon: 'clock', label: 'Próximos vencimentos', valor: <Ticker value={counts.pending + counts.due_today} />, nota: `${counts.due_today} hoje · ${counts.pending} a vir` },
  ];

  return (
    <RsShell overline="Área privada · Painel"
             titulo={`${greeting()}, Dra. Vyvian`}
             sub={`${hojeLongo()} · ${counts.due_today} vencimento${counts.due_today === 1 ? '' : 's'} hoje · ${session?.name || 'Vyvian Avena'}`}>

      {/* KPIs */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 26 }}>
        {kpis.map((k, i) => (
          <Reveal key={k.label} d={i * 70}>
            <div className="glass" style={{ padding: '18px 20px 17px', borderColor: k.danger ? 'rgba(200,110,90,.4)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flex: 'none',
                               background: k.danger ? 'rgba(160,75,60,.18)' : 'var(--grad-gold-soft)',
                               border: '1px solid var(--edge-2)', color: k.danger ? '#e0a294' : 'var(--gold-soft)' }}>
                  <Icon name={k.icon} size={15} />
                </span>
                <span className="overline" style={{ fontSize: 9.5, letterSpacing: '.18em' }}>{k.label}</span>
              </div>
              <div className="num" style={{ fontSize: 38, lineHeight: 1.1, marginTop: 12, color: 'var(--fg)' }}>{k.valor}</div>
              <div style={{ fontSize: 11.5, color: k.danger ? '#e0a294' : 'var(--fg-3)', marginTop: 6 }}>{k.nota}</div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Próximos vencimentos + Atenção */}
      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Reveal d={100}>
          <div className="glass" style={{ padding: '20px 22px 18px' }}>
            <PanelHead over="Agenda financeira" title="Próximos vencimentos"
                       right={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Seg small items={JANELAS} value={upcomingDays} onChange={(v) => setUpcomingDays(Number(v))} />
                                <Link to="/admin/parcelas" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
                                  Ver todos<Icon name="chev" size={12} />
                                </Link>
                              </span>} />
            {upcoming.length === 0 ? (
              <div style={{ padding: '26px 4px', fontSize: 13, color: 'var(--fg-3)' }}>Nada nos próximos {upcomingDays} dias.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {upcoming.map((i, k) => {
                  const c = corPrazo(i);
                  return (
                    <Reveal key={i.id} d={k * 40} y={10}>
                      <Link to={`/admin/clientes/${i.client_id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12,
                                     border: '1px solid var(--edge)', background: 'var(--panel)', textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.client_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>Parcela {i.installment_number}/{i.total_installments}</div>
                        </div>
                        <span className="mono" style={{ fontSize: 13.5, color: 'var(--fg-2)', flex: 'none' }}>{fmtMoney(i.amount, i.currency)}</span>
                        <span style={{ flex: 'none', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', padding: '4px 9px', borderRadius: 999,
                                       background: c.bg, border: `1px solid ${c.bd}`, color: c.fg }}>{whenLabel(i)}</span>
                      </Link>
                    </Reveal>
                  );
                })}
              </div>
            )}
          </div>
        </Reveal>

        <Reveal d={160}>
          <div className="glass" style={{ padding: '20px 22px 18px', borderColor: alerts.length ? 'rgba(200,110,90,.4)' : undefined }}>
            <PanelHead over="Atenção" title="Parcelas vencidas"
                       note={alerts.length ? 'Clique num cliente para tratar a cobrança.' : undefined} />
            {alerts.length === 0 ? (
              <div style={{ padding: '26px 4px', fontSize: 13, color: 'var(--fg-3)' }}>Sem atrasos. 🌿</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {alerts.map((i, k) => (
                  <Reveal key={i.id} d={k * 40} y={10}>
                    <Link to={`/admin/clientes/${i.client_id}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12,
                                   border: '1px solid rgba(200,110,90,.35)', background: 'rgba(160,75,60,.08)', textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.client_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>Parcela {i.installment_number}/{i.total_installments}</div>
                      </div>
                      <span className="mono" style={{ fontSize: 13.5, color: 'var(--fg-2)', flex: 'none' }}>{fmtMoney(i.amount, i.currency)}</span>
                      <span style={{ flex: 'none', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', padding: '4px 9px', borderRadius: 999,
                                     background: 'rgba(160,75,60,.18)', border: '1px solid rgba(200,110,90,.45)', color: '#e0a294' }}>{whenLabel(i)}</span>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </RsShell>
  );
}
