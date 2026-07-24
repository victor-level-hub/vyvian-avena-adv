// src/admin/pages/Installments.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { installments as installmentsApi } from '../apiClient';
import { admAlert, admConfirm } from '../dialogs';
import { SearchInput } from '../inputs';
import SlidingTabs from '../tabs';
import { admToast } from '../toasts';
import SelectMenu from '../dropdown';
import { IconDownload, IconPhone, IconCheck } from '../icons';
import { SkeletonPage } from '../skeletons';

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
        if (i.due_date.slice(0, 7) !== currentMonth()) return false;
      } else if (monthFilter === 'all-future') {
        if (new Date(i.due_date) < today && i.status !== 'late') return false;
      }
      // filtro de estado
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending') return i.status === 'pending' || i.status === 'due_today';
      return i.status === statusFilter;
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [statusFilter, monthFilter, search, all]);

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

  if (loading) return <SkeletonPage kpis={0} rows={7} />;
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
        <button className="adm-btn" onClick={handleExport}><IconDownload size={13} /> Exportar CSV</button>
      </header>

      <div className="adm-filter-bar" style={{ marginBottom: '0.9rem' }}>
        <SearchInput
          placeholder="Pesquisar por cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <SlidingTabs
          variant="pills"
          items={STATUS_OPTIONS.map((s) => ({
            id: s.id,
            danger: s.id === 'late',
            label: `${s.label} (${counts[s.id] !== undefined ? counts[s.id] : '—'})`,
          }))}
          active={statusFilter}
          onChange={setStatusFilter}
        />
        <SelectMenu
          value={monthFilter}
          onChange={setMonthFilter}
          ariaLabel="Período"
          style={{ marginLeft: 'auto' }}
          options={[
            { value: 'current', label: monthLabel },
            { value: 'all-future', label: 'Todas a vencer' },
            { value: 'all', label: 'Todo o histórico' },
          ]}
        />
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
              <th>Enviar WhatsApp</th>
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
                    {(i.status === 'pending' || i.status === 'due_today' || i.status === 'late') && (
                      <button
                        type="button"
                        className="adm-btn"
                        data-tip={i.wa_sent_at ? `Enviado a ${fmtSentStamp(i.wa_sent_at)} — clique para reenviar` : 'Abre o WhatsApp do cliente com a mensagem de lembrete já escrita'}
                        style={{
                          fontSize: '0.72rem', padding: '0.3rem 0.8rem', whiteSpace: 'nowrap', lineHeight: 1.25,
                          ...(i.wa_sent_at ? { background: '#1f8a4c', borderColor: '#1f8a4c', color: '#fff' } : {}),
                        }}
                        onClick={() => openWaModal(i)}
                      >
                        <span style={{ display: 'block' }}>
                          {i.wa_sent_at ? <IconCheck size={11} /> : <IconPhone size={11} />} WhatsApp
                        </span>
                        {i.wa_sent_at && (
                          <span style={{ display: 'block', fontSize: '0.58rem', opacity: 0.85, fontWeight: 400 }}>
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
      )}

      {/* Modal: enviar lembrete por WhatsApp (mensagem editável + link wa.me) */}
      {waFor && (
        <div
          className="adm-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setWaFor(null); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', zIndex: 1500,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 1rem 2rem', overflowY: 'auto',
          }}
        >
          <div style={{
            background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 560,
            padding: '1.6rem 1.7rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            borderTop: '3px solid var(--gold, #b8935a)',
          }}>
            <h2 style={{ margin: '0 0 0.3rem', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--forest, #12302a)' }}>
              Enviar WhatsApp — {waFor.client_name}
            </h2>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--muted, #777)', marginBottom: '0.9rem' }}>
              Parcela {waFor.installment_number}/{waFor.total_installments} · {fmtMoney(waFor.amount, waFor.currency)} · vence a {fmtDateLong(waFor.due_date)}
              {waFor.client_phone ? ` · ${waFor.client_phone}` : ''}
            </div>
            <textarea
              rows={9}
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              style={{
                width: '100%', resize: 'vertical', padding: '0.7rem 0.8rem',
                border: '1px solid rgba(0,0,0,0.18)', borderRadius: 6, background: '#fff',
                fontFamily: 'var(--sans)', fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--ink, #333)',
              }}
            />
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.74rem', color: 'var(--muted, #777)', marginTop: '0.4rem' }}>
              Edite à vontade — ao abrir o WhatsApp, a conversa do cliente aparece com esta mensagem já escrita; só falta carregar em enviar.
            </div>
            {!waFor.client_phone && (
              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.82rem', color: '#8e1f1f', marginTop: '0.8rem' }}>
                Este cliente não tem telefone registado.{' '}
                <Link to={`/admin/clientes/${waFor.client_id}`} style={{ color: '#8e1f1f', textDecoration: 'underline' }}>
                  Abrir a ficha para adicionar →
                </Link>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button type="button" className="adm-btn" onClick={() => setWaFor(null)}>Cancelar</button>
              {waFor.client_phone ? (
                <a
                  className="adm-btn adm-btn-gold"
                  style={{ textDecoration: 'none' }}
                  href={`https://wa.me/${String(waFor.client_phone).replace(/[^\d]/g, '')}?text=${encodeURIComponent(waText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleWaSent(waFor)}
                >
                  Abrir no WhatsApp →
                </a>
              ) : (
                <button type="button" className="adm-btn adm-btn-gold" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                  Abrir no WhatsApp →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
