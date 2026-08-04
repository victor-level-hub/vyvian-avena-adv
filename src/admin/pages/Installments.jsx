// src/admin/pages/Installments.jsx
// Parcelas — redesign «Vyvian Avena Design System v3» (rollout 3/5).
// Lógica intacta: filtros, contadores do mês, exportar CSV, lembrete WhatsApp.
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { installments as installmentsApi } from '../apiClient';
import { admAlert, admConfirm } from '../dialogs';
import { admToast } from '../toasts';
import { SkeletonPage } from '../skeletons';
import { RsShell, Icon, Reveal, Seg, Ticker } from '../rs/ui';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const bruto = Number(amount);
  const n = Number.isFinite(bruto) ? bruto : 0;
  return symbol + ' ' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// valor numérico seguro para somas — evita NaN nos cartões de totais
function valorDe(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

// aaaa-mm de uma data; null se não prestar. Sem esta guarda, uma parcela sem
// due_date rebentava o ecrã inteiro no .slice(), antes de qualquer filtro.
function mesDe(dateStr) {
  return typeof dateStr === 'string' && dateStr.length >= 7 ? dateStr.slice(0, 7) : null;
}

// data ilegível mostra travessão, nunca "Invalid Date"
function fmtDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
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

function fmtDateLong(dateStr) {
  return new Date(dateStr).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Mensagem padrão do lembrete — montada com os dados do cadastro; editável no modal.
function buildWaMessage(i) {
  const nome = String(i.client_name || '').trim().split(/\s+/)[0];
  const valor = fmtMoney(i.amount, i.currency);
  const venc = fmtDateLong(i.due_date);
  const parcela = `${i.installment_number}/${i.total_installments}`;
  if (i.status === 'late') {
    return `Olá ${nome}, tudo bem?\nVerifiquei que a parcela ${parcela} dos honorários, no valor de ${valor}, venceu a ${venc} e ainda não consta como paga. Se o pagamento já foi efetuado, por favor ignore esta mensagem.\nQualquer questão, estou à disposição.\nDra. Vyvian Avena — Advogada`;
  }
  return `Olá ${nome}, tudo bem?\nPasso apenas para lembrar que a parcela ${parcela} dos honorários, no valor de ${valor}, vence a ${venc}.\nQualquer questão, estou à disposição.\nDra. Vyvian Avena — Advogada`;
}

function fmtSentStamp(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

// selo de estado no padrão rs
function ChipEstado({ status }) {
  const chip = (fg, bg, bd, txt) => (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', padding: '4px 9px', borderRadius: 999,
                   background: bg, border: `1px solid ${bd}`, color: fg, whiteSpace: 'nowrap' }}>{txt}</span>
  );
  if (status === 'paid') return chip('#9fd0ae', 'rgba(74,124,89,.16)', 'rgba(143,208,162,.4)', 'PAGO');
  if (status === 'due_today') return chip('var(--gold-soft)', 'rgba(200,150,86,.16)', 'rgba(212,181,133,.45)', 'HOJE');
  if (status === 'late') return chip('#e0a294', 'rgba(160,75,60,.18)', 'rgba(200,110,90,.45)', 'VENCIDO');
  return chip('var(--fg-3)', 'var(--panel)', 'var(--edge)', 'A VENCER');
}

export default function Installments() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('current'); // 'current' | 'all-future' | 'all'
  const [search, setSearch] = useState('');
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);
  const [waFor, setWaFor] = useState(null);   // parcela do modal de WhatsApp
  const [waText, setWaText] = useState('');

  const openWaModal = (i) => { setWaFor(i); setWaText(buildWaMessage(i)); };

  // Ao abrir o WhatsApp, considera-se a mensagem enviada: regista data-hora na parcela.
  const handleWaSent = (i) => {
    const now = new Date().toISOString();
    setAll((prev) => prev.map((x) => (x.id === i.id ? { ...x, wa_sent_at: now } : x)));
    installmentsApi.update(i.id, { wa_sent_at: now }).catch(() => {});
    setWaFor(null);
    admToast('Envio por WhatsApp registado');
  };

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
    if (!await admConfirm('Marcar esta parcela como paga (hoje)?')) return;
    setMarkingPaid(installmentId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await installmentsApi.markPaid(installmentId, today);
      await loadData();
      admToast('Parcela marcada como paga');
    } catch (err) {
      admAlert('Erro: ' + err.message);
    } finally {
      setMarkingPaid(null);
    }
  };

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const q = search.trim().toLowerCase();
    return all.filter((i) => {
      // filtro de pesquisa por cliente
      if (q && !(i.client_name || '').toLowerCase().includes(q)) return false;
      // filtro de mês
      if (monthFilter === 'current') {
        if (mesDe(i.due_date) !== currentMonth()) return false;
      } else if (monthFilter === 'all-future') {
        if (new Date(i.due_date) < today && i.status !== 'late') return false;
      }
      // filtro de estado
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending') return i.status === 'pending' || i.status === 'due_today';
      return i.status === statusFilter;
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [statusFilter, monthFilter, search, all]);

  const monthAll = all.filter((i) => mesDe(i.due_date) === currentMonth());
  const counts = {
    all: monthAll.length,
    paid: monthAll.filter((i) => i.status === 'paid').length,
    pending: monthAll.filter((i) => i.status === 'pending' || i.status === 'due_today').length,
    late: monthAll.filter((i) => i.status === 'late').length,
  };

  const monthTotalEur = monthAll
    .filter((i) => i.currency === 'EUR')
    .reduce((s, i) => s + valorDe(i.amount), 0);

  const monthPaidEur = monthAll
    .filter((i) => i.currency === 'EUR' && i.status === 'paid')
    .reduce((s, i) => s + valorDe(i.amount), 0);

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

  if (loading) return <SkeletonPage kpis={0} rows={7} />;
  if (error) return <div className="adm-login-error">{error}</div>;

  const monthLabel = new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--gold)', borderBottom: '1px solid var(--edge-2)', whiteSpace: 'nowrap' };
  const td = { padding: '12px 12px', borderBottom: '1px solid var(--edge)', fontSize: 13.5, color: 'var(--fg-2)', verticalAlign: 'middle' };

  const kpis = [
    { icon: 'trend', label: `Previsto (${monthLabel})`, valor: <Ticker value={monthTotalEur} prefix={'€ '} />, nota: `${monthAll.length} lançamentos este mês` },
    { icon: 'check', label: 'Já recebido', valor: <Ticker value={monthPaidEur} prefix={'€ '} />, nota: `${counts.paid} ${counts.paid === 1 ? 'parcela paga' : 'parcelas pagas'}` },
    { icon: 'clock', label: 'A vencer', valor: <Ticker value={counts.pending} />, nota: 'Neste mês' },
    { icon: 'info', label: 'Em atraso', valor: <Ticker value={counts.late} />, nota: counts.late === 0 ? 'Sem atrasos 🌿' : 'Requer ação', danger: counts.late > 0 },
  ];

  return (
    <RsShell overline="Área privada · Parcelas" titulo="Parcelas e mensalidades"
             sub={`${monthLabel} · ${monthAll.length} lançamentos · ${fmtMoney(monthTotalEur)} previstos (EUR)`}
             right={<button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
                            onClick={handleExport} data-tip="Descarrega um CSV com as parcelas filtradas">
                      <Icon name="download" size={13} />Exportar CSV
                    </button>}>

      {/* KPIs do mês */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 20 }}>
        {kpis.map((k, i) => (
          <Reveal key={k.label} d={i * 60}>
            <div className="glass" style={{ padding: '15px 18px 14px', borderColor: k.danger ? 'rgba(200,110,90,.4)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flex: 'none',
                               background: k.danger ? 'rgba(160,75,60,.18)' : 'var(--grad-gold-soft)',
                               border: '1px solid var(--edge-2)', color: k.danger ? '#e0a294' : 'var(--gold-soft)' }}>
                  <Icon name={k.icon} size={13} />
                </span>
                <span className="overline" style={{ fontSize: 9, letterSpacing: '.16em' }}>{k.label}</span>
              </div>
              <div className="num" style={{ fontSize: 28, lineHeight: 1.1, marginTop: 9, color: 'var(--fg)' }}>{k.valor}</div>
              <div style={{ fontSize: 11, color: k.danger ? '#e0a294' : 'var(--fg-3)', marginTop: 4 }}>{k.nota}</div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* barra de filtros */}
      <Reveal d={80}>
        <div className="glass" style={{ padding: '16px 18px', marginBottom: 18, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="field" placeholder="Pesquisar por cliente…" value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 200, maxWidth: 380, padding: '10px 14px', fontSize: 13.5 }} />
          <Seg small value={statusFilter} onChange={setStatusFilter}
               items={STATUS_OPTIONS.map((s) => ({ k: s.id, label: `${s.label.toUpperCase()} (${counts[s.id] !== undefined ? counts[s.id] : '—'})` }))} />
          <select className="field" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
                  aria-label="Período" data-tip="Escolher o período das parcelas listadas"
                  style={{ marginLeft: 'auto', padding: '10px 12px', fontSize: 13, cursor: 'pointer' }}>
            <option value="current">{monthLabel}</option>
            <option value="all-future">Todas a vencer</option>
            <option value="all">Todo o histórico</option>
          </select>
        </div>
      </Reveal>

      {filtered.length === 0 ? (
        <Reveal cls="glass" style={{ padding: '40px 30px', textAlign: 'center', fontSize: 13.5, color: 'var(--fg-3)' }}>
          Nenhuma parcela com estes filtros.
        </Reveal>
      ) : (
        <Reveal d={120}>
          <div className="glass" style={{ padding: '6px 8px 4px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th}>Cliente</th>
                  <th style={th}>País</th>
                  <th style={th}>Parcela</th>
                  <th style={th}>Vencimento</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Lembrete</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const isToday = i.status === 'due_today';
                  return (
                    <tr key={i.id}
                        style={{ transition: 'background .2s', background: isToday ? 'rgba(200,150,86,.07)' : 'transparent' }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--panel)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = isToday ? 'rgba(200,150,86,.07)' : 'transparent'; }}>
                      <td style={td}>
                        <Link to={`/admin/clientes/${i.client_id}`}
                              style={{ color: 'var(--fg)', fontWeight: 600, textDecoration: 'none' }}>
                          {i.client_name}
                        </Link>
                      </td>
                      <td style={td}>{i.client_country}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }} className="mono">{i.installment_number}/{i.total_installments}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--fg)', fontWeight: 600 }}>{fmtDate(i.due_date)}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="mono">{fmtMoney(i.amount, i.currency)}</td>
                      <td style={td}><ChipEstado status={i.status} /></td>
                      <td style={td}>
                        {(i.status === 'pending' || i.status === 'due_today' || i.status === 'late') && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            data-tip={i.wa_sent_at ? `Enviado a ${fmtSentStamp(i.wa_sent_at)} — clique para reenviar` : 'Abre o WhatsApp do cliente com a mensagem de lembrete já escrita'}
                            style={{
                              whiteSpace: 'nowrap', lineHeight: 1.25, padding: '6px 12px', fontSize: 11,
                              ...(i.wa_sent_at
                                ? { background: 'rgba(74,124,89,.16)', border: '1px solid rgba(143,208,162,.4)', color: '#9fd0ae' }
                                : { background: 'var(--panel)', border: '1px solid var(--edge-2)', color: 'var(--fg-2)' }),
                              borderRadius: 999, cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                            }}
                            onClick={() => openWaModal(i)}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Icon name={i.wa_sent_at ? 'check' : 'phone'} size={11} /> WhatsApp
                            </span>
                            {i.wa_sent_at && (
                              <span style={{ display: 'block', fontSize: 9, opacity: 0.85, fontWeight: 400 }}>
                                {fmtSentStamp(i.wa_sent_at)}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {/* Modal: enviar lembrete por WhatsApp (mensagem editável + link wa.me) */}
      {waFor && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setWaFor(null); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,16,13,0.6)', backdropFilter: 'blur(6px)', zIndex: 1500,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 1rem 2rem', overflowY: 'auto',
            animation: 'rsFadeIn .25s both',
          }}
        >
          <div className="glass" style={{
            background: 'var(--panel-flat)', borderRadius: 18, width: '100%', maxWidth: 560,
            padding: '26px 28px 24px', boxShadow: 'var(--shadow)', border: '1px solid var(--edge-2)',
            animation: 'rsRiseInSm .3s var(--ease-out) both',
          }}>
            <div className="overline" style={{ fontSize: 9.5, letterSpacing: '.18em', marginBottom: 6 }}>Lembrete de honorários</div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, color: 'var(--fg)' }}>
              Enviar WhatsApp — {waFor.client_name}
            </h2>
            <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginBottom: 14 }}>
              Parcela {waFor.installment_number}/{waFor.total_installments} · {fmtMoney(waFor.amount, waFor.currency)} · vence a {fmtDateLong(waFor.due_date)}
              {waFor.client_phone ? ` · ${waFor.client_phone}` : ''}
            </div>
            <textarea
              className="field"
              rows={9}
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              autoFocus
              style={{ width: '100%', resize: 'vertical', padding: '12px 14px', fontSize: 13.5, lineHeight: 1.55, boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 7 }}>
              Edite à vontade — ao abrir o WhatsApp, a conversa do cliente aparece com esta mensagem já escrita; só falta carregar em enviar.
            </div>
            {!waFor.client_phone && (
              <div style={{ fontSize: 12.5, color: '#e0a294', marginTop: 12 }}>
                Este cliente não tem telefone registado.{' '}
                <Link to={`/admin/clientes/${waFor.client_id}`} style={{ color: '#e0a294', textDecoration: 'underline' }}>
                  Abrir a ficha para adicionar →
                </Link>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 20 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWaFor(null)}>Cancelar</button>
              {waFor.client_phone ? (
                <a
                  className="btn btn-gold btn-sm"
                  style={{ textDecoration: 'none' }}
                  href={`https://wa.me/${String(waFor.client_phone).replace(/[^\d]/g, '')}?text=${encodeURIComponent(waText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleWaSent(waFor)}
                >
                  Abrir no WhatsApp →
                </a>
              ) : (
                <button type="button" className="btn btn-gold btn-sm" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                  Abrir no WhatsApp →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </RsShell>
  );
}
