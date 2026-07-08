// src/admin/pages/Calendar.jsx
// Calendário jurídico configurável:
//  - tipos de data (nativos + personalizados) com cores próprias
//  - filtros por tipo (persistidos em localStorage)
//  - eventos manuais (criar/editar/apagar) e eventos de sistema (seed 2026)
//  - eventos de vários dias, vistas mensal/lista/próximos 30 dias
//  - vencimentos (parcelas) continuam a alimentar o resumo financeiro
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { installments as installmentsApi, calendar as calendarApi } from '../apiClient';

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const DAYS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const VIS_KEY = 'vyvian_cal_visibility';

function fmtMoney(amount, currency = 'EUR', compact = false) {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  if (compact && n >= 1000) {
    return symbol + ' ' + (n / 1000).toFixed(1).replace('.0', '') + 'k';
  }
  return symbol + ' ' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// chave local-safe (evita o desvio de dia do toISOString em horário de verão)
function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(key, n) {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// lista de dias (keys) de um evento, limitada para segurança
function eventDays(ev) {
  const days = [ev.start_date];
  if (ev.end_date && ev.end_date > ev.start_date) {
    let cur = ev.start_date;
    let guard = 0;
    while (cur < ev.end_date && guard < 370) {
      cur = addDays(cur, 1);
      days.push(cur);
      guard++;
    }
  }
  return days;
}

function loadVisibility() {
  try { return JSON.parse(localStorage.getItem(VIS_KEY) || '{}'); } catch { return {}; }
}

const EMPTY_EVENT = {
  title: '', description: '', type_id: 'evento_pessoal',
  start_date: '', end_date: '', is_all_day: true,
  amount: '', currency: 'EUR', status: 'none',
  client_name: '', case_reference: '',
};

export default function Calendar() {
  const TODAY_REAL = new Date();
  TODAY_REAL.setHours(0, 0, 0, 0);

  const [currentDate, setCurrentDate] = useState(new Date(TODAY_REAL));
  const [selectedDate, setSelectedDate] = useState(null);
  const dayDetailRef = React.useRef(null);
  const [allInstallments, setAllInstallments] = useState([]);
  const [types, setTypes] = useState([]);
  const [events, setEvents] = useState([]);
  const [visOverride, setVisOverride] = useState(loadVisibility);
  const [view, setView] = useState('month'); // 'month' | 'list' | 'next30'
  const [showFilters, setShowFilters] = useState(false);
  const [typeMgrOpen, setTypeMgrOpen] = useState(false);
  const [typeForm, setTypeForm] = useState(null); // {mode:'create'|'edit', id?, label, color, description}
  const [typeDeleting, setTypeDeleting] = useState(null); // type object pendente de decisão
  const [evModal, setEvModal] = useState(null); // {mode:'create'|'edit', id?, form:{...}}
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCalendar = async () => {
    const r = await calendarApi.getAll();
    setTypes(r.types || []);
    setEvents(r.events || []);
  };

  useEffect(() => {
    Promise.all([
      installmentsApi.list().then((res) => setAllInstallments(res.installments || [])),
      loadCalendar(),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // visibilidade efetiva: override do browser > default do tipo
  const isVisible = (t) => (visOverride[t.id] !== undefined ? !!visOverride[t.id] : !!t.is_visible);
  const typeById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);
  const visibleEvents = useMemo(
    () => events.filter((ev) => { const t = typeById[ev.type_id]; return t ? isVisible(t) : true; }),
    [events, typeById, visOverride],
  );

  const toggleType = (id) => {
    const t = typeById[id];
    const next = { ...visOverride, [id]: !(visOverride[id] !== undefined ? visOverride[id] : !!(t && t.is_visible)) };
    setVisOverride(next);
    try { localStorage.setItem(VIS_KEY, JSON.stringify(next)); } catch {}
  };

  const grid = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstWeekday = (firstDay.getDay() + 6) % 7;
    const cells = [];
    for (let i = firstWeekday - 1; i >= 0; i--) cells.push({ date: new Date(year, month, -i), current: false });
    for (let i = 1; i <= lastDay.getDate(); i++) cells.push({ date: new Date(year, month, i), current: true });
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last);
      next.setDate(next.getDate() + 1);
      cells.push({ date: next, current: false });
    }
    return cells;
  }, [year, month]);

  const installmentsByDate = useMemo(() => {
    const map = {};
    allInstallments.forEach((i) => { (map[i.due_date] = map[i.due_date] || []).push(i); });
    return map;
  }, [allInstallments]);

  const eventsByDate = useMemo(() => {
    const map = {};
    visibleEvents.forEach((ev) => {
      eventDays(ev).forEach((k) => { (map[k] = map[k] || []).push(ev); });
    });
    return map;
  }, [visibleEvents]);

  // ── Resumo financeiro do mês: parcelas + eventos financeiros visíveis (pending/overdue)
  const monthKeyPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthInstallments = allInstallments.filter((i) => (i.due_date || '').startsWith(monthKeyPrefix));
  const finEvents = visibleEvents.filter((ev) =>
    ev.type_id === 'financeiro' && (ev.status === 'pending' || ev.status === 'overdue') &&
    (ev.start_date || '').startsWith(monthKeyPrefix));
  const totalEur = monthInstallments.filter((i) => i.currency === 'EUR').reduce((s, i) => s + Number(i.amount), 0)
    + finEvents.filter((e) => e.currency === 'EUR').reduce((s, e) => s + Number(e.amount || 0), 0);
  const numVenc = monthInstallments.length + finEvents.length;

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDate(null); };
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDate(null); };
  const goToday = () => { setCurrentDate(new Date(TODAY_REAL)); setSelectedDate(null); };

  // ao escolher um dia, scroll suave até ao início da relação de compromissos
  useEffect(() => {
    if (selectedDate && view === 'month' && dayDetailRef.current) {
      dayDetailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDate, view]);

  const selectedKey = selectedDate ? dateKey(selectedDate) : null;
  const selectedInstallments = selectedKey ? (installmentsByDate[selectedKey] || []) : [];
  const selectedEvents = selectedKey ? (eventsByDate[selectedKey] || []) : [];

  // ── Eventos: criar/editar/apagar
  const openCreateEvent = (dayKey) => {
    setEvModal({ mode: 'create', form: { ...EMPTY_EVENT, start_date: dayKey || dateKey(TODAY_REAL) } });
  };
  const openEditEvent = (ev) => {
    setEvModal({
      mode: 'edit', id: ev.id, source: ev.source,
      form: {
        title: ev.title || '', description: ev.description || '', type_id: ev.type_id,
        start_date: ev.start_date || '', end_date: ev.end_date || '', is_all_day: !!ev.is_all_day,
        amount: ev.amount || '', currency: ev.currency || 'EUR', status: ev.status || 'none',
        client_name: ev.client_name || '', case_reference: ev.case_reference || '',
      },
    });
  };
  const evField = (k) => (e) => setEvModal((m) => ({ ...m, form: { ...m.form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));

  const saveEvent = async () => {
    const f = evModal.form;
    if (!f.title.trim() || !f.start_date || !f.type_id) { alert('Título, tipo e data inicial são obrigatórios.'); return; }
    if (f.end_date && f.end_date < f.start_date) { alert('A data final não pode ser anterior à inicial.'); return; }
    setBusy(true);
    try {
      const payload = {
        title: f.title, description: f.description || null, type_id: f.type_id,
        start_date: f.start_date, end_date: f.end_date || null, is_all_day: !!f.is_all_day,
        amount: parseFloat(String(f.amount).replace(',', '.')) || 0, currency: f.currency,
        status: f.status, client_name: f.client_name || null, case_reference: f.case_reference || null,
      };
      if (evModal.mode === 'create') await calendarApi.createEvent(payload);
      else await calendarApi.updateEvent(evModal.id, payload);
      await loadCalendar();
      setEvModal(null);
    } catch (err) { alert('Erro: ' + err.message); }
    finally { setBusy(false); }
  };

  const deleteEvent = async (ev) => {
    if (!confirm(`Apagar o evento "${ev.title}"?`)) return;
    try { await calendarApi.deleteEvent(ev.id); await loadCalendar(); }
    catch (err) { alert('Erro: ' + err.message); }
  };

  // ── Tipos: criar/editar/apagar
  const saveType = async () => {
    if (!typeForm.label.trim()) { alert('A label é obrigatória.'); return; }
    setBusy(true);
    try {
      if (typeForm.mode === 'create') await calendarApi.createType({ label: typeForm.label, color: typeForm.color, description: typeForm.description });
      else await calendarApi.updateType(typeForm.id, { label: typeForm.label, color: typeForm.color, description: typeForm.description });
      await loadCalendar();
      setTypeForm(null);
    } catch (err) { alert('Erro: ' + err.message); }
    finally { setBusy(false); }
  };

  const confirmDeleteType = async (strategy) => {
    setBusy(true);
    try {
      await calendarApi.deleteType(typeDeleting.id, strategy);
      await loadCalendar();
      setTypeDeleting(null);
    } catch (err) { alert('Erro: ' + err.message); }
    finally { setBusy(false); }
  };

  // ── Listas (vista lista do mês / próximos 30 dias)
  const listItems = useMemo(() => {
    const items = [];
    const inRange = (k) => {
      if (view === 'list') return k.startsWith(monthKeyPrefix);
      const t0 = dateKey(TODAY_REAL);
      return k >= t0 && k <= addDays(t0, 30);
    };
    visibleEvents.forEach((ev) => {
      if (inRange(ev.start_date) || (ev.end_date && inRange(ev.end_date))) {
        items.push({ kind: 'event', key: ev.start_date, ev });
      }
    });
    allInstallments.forEach((i) => {
      if (i.due_date && inRange(i.due_date)) items.push({ kind: 'installment', key: i.due_date, inst: i });
    });
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }, [view, visibleEvents, allInstallments, monthKeyPrefix]);

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar calendário…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  const activeTypes = types.filter(isVisible);
  const focusType = evModal ? (typeById[evModal.form.type_id] || null) : null;
  const isFin = evModal && evModal.form.type_id === 'financeiro';
  const isCli = evModal && evModal.form.type_id === 'cliente';
  const isProc = evModal && evModal.form.type_id === 'processo';

  const badgeStyle = (color) => ({
    display: 'block', fontSize: '0.62rem', lineHeight: 1.25, padding: '0.08rem 0.3rem',
    borderRadius: 3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    background: color + '22', color: color, borderLeft: `3px solid ${color}`, textAlign: 'left',
  });

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Calendário</h1>
          <div className="adm-sub">Agenda jurídica, prazos e vencimentos do mês</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="adm-btn" onClick={() => setShowFilters((v) => !v)}>Filtros{activeTypes.length < types.length ? ` (${activeTypes.length}/${types.length})` : ''}</button>
          <button className="adm-btn" onClick={() => setTypeMgrOpen(true)}>Tipos de data</button>
          <button className="adm-btn adm-btn-gold" onClick={() => openCreateEvent(selectedKey)}>+ Evento</button>
        </div>
      </header>

      {showFilters && (
        <div style={{ background: 'var(--cream, #f5f0e8)', borderRadius: 8, padding: '0.9rem 1rem', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {types.map((t) => {
            const on = isVisible(t);
            return (
              <button
                key={t.id}
                onClick={() => toggleType(t.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer',
                  border: `1px solid ${on ? t.color : 'rgba(0,0,0,0.15)'}`, borderRadius: 999,
                  padding: '0.25rem 0.7rem', fontSize: '0.78rem',
                  background: on ? t.color + '18' : 'transparent',
                  color: on ? t.color : 'var(--muted, #888)',
                  opacity: on ? 1 : 0.7,
                }}
                title={t.description || ''}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: on ? t.color : 'rgba(0,0,0,0.2)' }} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="adm-cal-head">
        <div>
          <h2>{MONTHS_PT[month]} · {year}</h2>
          <div className="adm-sub">
            {numVenc} vencimentos · {fmtMoney(totalEur)} previstos (EUR)
          </div>
        </div>
        <div className="adm-cal-nav" style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <button onClick={() => setView('month')} style={view === 'month' ? { fontWeight: 700 } : {}}>Mês</button>
          <button onClick={() => setView('list')} style={view === 'list' ? { fontWeight: 700 } : {}}>Lista</button>
          <button onClick={() => setView('next30')} style={view === 'next30' ? { fontWeight: 700 } : {}}>30 dias</button>
          <span style={{ width: 10 }} />
          <button onClick={prevMonth}>‹</button>
          <button onClick={goToday}>Hoje</button>
          <button onClick={nextMonth}>›</button>
        </div>
      </div>

      {view === 'month' && (
        <div className="adm-cal-grid">
          {DAYS_PT.map((d) => <div key={d} className="adm-cal-dh">{d}</div>)}
          {grid.map((cell, idx) => {
            const k = dateKey(cell.date);
            const inst = installmentsByDate[k] || [];
            const evs = eventsByDate[k] || [];
            const isToday = isSameDay(cell.date, TODAY_REAL);
            const isSelected = selectedDate && isSameDay(cell.date, selectedDate);
            const dayCurrency = inst[0]?.currency || 'EUR';
            const dayTotal = inst.reduce((s, i) => (i.currency === dayCurrency ? s + Number(i.amount) : s), 0);
            const hasLate = inst.some((i) => i.status === 'late');

            const maxBadges = inst.length > 0 ? 2 : 3;
            const shown = evs.slice(0, maxBadges);
            const extra = evs.length - shown.length;

            return (
              <div
                key={idx}
                className={
                  'adm-cal-day' +
                  (cell.current ? '' : ' adm-cal-day-muted') +
                  (isToday ? ' adm-cal-day-today' : '') +
                  (isSelected ? ' adm-row-highlight' : '')
                }
                onClick={() => cell.current && setSelectedDate(cell.date)}
                style={isSelected ? { background: 'var(--cream-soft)' } : {}}
              >
                <div className="adm-cal-day-num">{cell.date.getDate()}</div>
                {inst.length > 0 && (
                  <>
                    <div className="adm-cal-dots">
                      {inst.slice(0, 6).map((i) => (
                        <span key={i.id} className={'adm-cal-dot ' + (i.status === 'paid' ? 'adm-cal-dot-paid' : i.status === 'late' ? 'adm-cal-dot-late' : 'adm-cal-dot-pend')} />
                      ))}
                    </div>
                    <div className={'adm-cal-amount' + (hasLate ? ' adm-cal-amount-late' : '')}>
                      {fmtMoney(dayTotal, dayCurrency, true)}
                    </div>
                  </>
                )}
                {shown.map((ev) => {
                  const t = typeById[ev.type_id];
                  const multi = ev.end_date && ev.end_date > ev.start_date;
                  return (
                    <span key={ev.id} style={badgeStyle(t?.color || '#888')} title={ev.title + (ev.description ? ' — ' + ev.description : '')}>
                      {multi && k !== ev.start_date ? '· ' : ''}{ev.title}
                    </span>
                  );
                })}
                {extra > 0 && (
                  <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--muted, #888)', marginTop: 2 }}>
                    +{extra} evento{extra > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(view === 'list' || view === 'next30') && (
        <div className="adm-card" style={{ marginBottom: '1rem' }}>
          <div className="adm-card-title">{view === 'list' ? `Lista de ${MONTHS_PT[month]} ${year}` : 'Próximos 30 dias'}</div>
          {listItems.length === 0 ? (
            <div className="adm-empty" style={{ padding: '1rem 0' }}>Sem eventos no período.</div>
          ) : (
            <table className="adm-table adm-table-small">
              <thead>
                <tr><th>Data</th><th>Evento</th><th>Tipo</th><th className="adm-text-right">Valor</th><th></th></tr>
              </thead>
              <tbody>
                {listItems.map((item, i) => item.kind === 'event' ? (
                  <tr key={'e' + item.ev.id + i}>
                    <td>{fmtDate(item.ev.start_date)}{item.ev.end_date ? ` → ${fmtDate(item.ev.end_date)}` : ''}</td>
                    <td>
                      <strong>{item.ev.title}</strong>
                      {item.ev.client_name ? <span style={{ color: 'var(--muted)' }}> · {item.ev.client_name}</span> : null}
                      {item.ev.case_reference ? <span style={{ color: 'var(--muted)' }}> · {item.ev.case_reference}</span> : null}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: typeById[item.ev.type_id]?.color || '#888' }} />
                        {typeById[item.ev.type_id]?.label || item.ev.type_id}
                      </span>
                    </td>
                    <td className="adm-text-right adm-val">{Number(item.ev.amount) > 0 ? fmtMoney(item.ev.amount, item.ev.currency) : '—'}</td>
                    <td className="adm-text-right">
                      {item.ev.source === 'manual' && (
                        <>
                          <a href="#" onClick={(e) => { e.preventDefault(); openEditEvent(item.ev); }} style={{ fontSize: '0.75rem', marginRight: 8 }}>Editar</a>
                          <a href="#" onClick={(e) => { e.preventDefault(); deleteEvent(item.ev); }} style={{ fontSize: '0.75rem', color: '#b00' }}>Apagar</a>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={'i' + item.inst.id}>
                    <td>{fmtDate(item.inst.due_date)}</td>
                    <td>
                      <Link to={`/admin/clientes/${item.inst.client_id}`} style={{ color: 'inherit' }}>
                        <strong>{item.inst.client_name}</strong>
                      </Link>
                      <span style={{ color: 'var(--muted)' }}> · parcela {item.inst.installment_number}/{item.inst.total_installments}</span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: typeById['financeiro']?.color || '#4F8A67' }} />
                        Financeiro
                      </span>
                    </td>
                    <td className="adm-text-right adm-val">{fmtMoney(item.inst.amount, item.inst.currency)}</td>
                    <td className="adm-text-right">
                      {item.inst.status === 'paid' && <span className="adm-badge adm-badge-paid">Pago</span>}
                      {item.inst.status === 'pending' && <span className="adm-badge adm-badge-pending">Pendente</span>}
                      {item.inst.status === 'due_today' && <span className="adm-badge adm-badge-warn">Hoje</span>}
                      {item.inst.status === 'late' && <span className="adm-badge adm-badge-late">Vencido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Legenda: estados financeiros + tipos ativos */}
      <div className="adm-cal-legend" style={{ flexWrap: 'wrap', rowGap: '0.4rem' }}>
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--success)' }} />Pago</span>
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--gold)' }} />A vencer</span>
        <span><span className="adm-cal-legend-dot" style={{ background: 'var(--danger)' }} />Atrasado</span>
        <span style={{ opacity: 0.35, margin: '0 0.25rem' }}>|</span>
        {activeTypes.map((t) => (
          <span key={t.id}><span className="adm-cal-legend-dot" style={{ background: t.color }} />{t.label}</span>
        ))}
      </div>

      {view === 'month' && selectedDate && (
        <div className="adm-day-detail" ref={dayDetailRef} style={{ scrollMarginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Dia {fmtDate(selectedKey)}</h3>
            <button className="adm-btn" onClick={() => openCreateEvent(selectedKey)}>+ Adicionar evento neste dia</button>
          </div>

          {selectedEvents.length > 0 && (
            <div style={{ margin: '0.9rem 0 0.5rem' }}>
              {selectedEvents.map((ev) => {
                const t = typeById[ev.type_id];
                return (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: t?.color || '#888', marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <strong>{ev.title}</strong>
                      <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}> · {t?.label || ev.type_id}</span>
                      {ev.end_date && ev.end_date > ev.start_date && (
                        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}> · {fmtDate(ev.start_date)} → {fmtDate(ev.end_date)}</span>
                      )}
                      {ev.description && <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 2 }}>{ev.description}</div>}
                      {(ev.client_name || ev.case_reference || Number(ev.amount) > 0) && (
                        <div style={{ fontSize: '0.8rem', marginTop: 2 }}>
                          {ev.client_name && <span>👤 {ev.client_name} </span>}
                          {ev.case_reference && <span>📁 {ev.case_reference} </span>}
                          {Number(ev.amount) > 0 && <span className="adm-val">{fmtMoney(ev.amount, ev.currency)}</span>}
                          {ev.status === 'paid' && <span className="adm-badge adm-badge-paid" style={{ marginLeft: 6 }}>Pago</span>}
                          {ev.status === 'pending' && <span className="adm-badge adm-badge-pending" style={{ marginLeft: 6 }}>A vencer</span>}
                          {ev.status === 'overdue' && <span className="adm-badge adm-badge-late" style={{ marginLeft: 6 }}>Atrasado</span>}
                        </div>
                      )}
                    </div>
                    {ev.source === 'manual' && (
                      <div style={{ flexShrink: 0, fontSize: '0.75rem' }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); openEditEvent(ev); }} style={{ marginRight: 8 }}>Editar</a>
                        <a href="#" onClick={(e) => { e.preventDefault(); deleteEvent(ev); }} style={{ color: '#b00' }}>Apagar</a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <h4 style={{ margin: '1rem 0 0.4rem' }}>Vencimentos</h4>
          {selectedInstallments.length === 0 ? (
            <div className="adm-empty" style={{ padding: '0.5rem 0' }}>Sem vencimentos neste dia.</div>
          ) : (
            <table className="adm-table adm-table-small">
              <thead>
                <tr><th>Cliente</th><th>Parcela</th><th className="adm-text-right">Valor</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {selectedInstallments.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link to={`/admin/clientes/${i.client_id}`} style={{ color: 'inherit' }}><strong>{i.client_name}</strong></Link>
                    </td>
                    <td>{i.installment_number}/{i.total_installments}</td>
                    <td className="adm-text-right adm-val">{fmtMoney(i.amount, i.currency)}</td>
                    <td>
                      {i.status === 'paid' && <span className="adm-badge adm-badge-paid">Pago</span>}
                      {i.status === 'pending' && <span className="adm-badge adm-badge-pending">Pendente</span>}
                      {i.status === 'due_today' && <span className="adm-badge adm-badge-warn">Hoje</span>}
                      {i.status === 'late' && <span className="adm-badge adm-badge-late">Vencido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Modal: criar/editar evento ── */}
      {evModal && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setEvModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 560, padding: '1.6rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 1.1rem', fontFamily: 'var(--serif)' }}>
              {evModal.mode === 'create' ? 'Novo evento' : 'Editar evento'}
              {focusType && (
                <span style={{ fontSize: '0.8rem', fontFamily: 'inherit', marginLeft: 10, color: focusType.color }}>● {focusType.label}</span>
              )}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Título *</span>
                <input type="text" value={evModal.form.title} onChange={evField('title')} disabled={busy} />
              </label>
              <label className="adm-field">
                <span>Tipo de data *</span>
                <select value={evModal.form.type_id} onChange={evField('type_id')} disabled={busy}>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label className="adm-field" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.55rem' }}>
                  <input type="checkbox" checked={!!evModal.form.is_all_day} onChange={evField('is_all_day')} disabled={busy} style={{ width: 'auto' }} />
                  Dia inteiro
                </span>
              </label>
              <label className="adm-field">
                <span>Data inicial *</span>
                <input type="date" value={evModal.form.start_date} onChange={evField('start_date')} disabled={busy} />
              </label>
              <label className="adm-field">
                <span>Data final (opcional)</span>
                <input type="date" value={evModal.form.end_date} onChange={evField('end_date')} disabled={busy} />
              </label>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Descrição</span>
                <textarea rows={3} value={evModal.form.description} onChange={evField('description')} disabled={busy} />
              </label>
              <label className="adm-field" style={isCli ? { gridColumn: '1 / -1' } : {}}>
                <span>Cliente {isCli ? '(recomendado)' : '(opcional)'}</span>
                <input type="text" value={evModal.form.client_name} onChange={evField('client_name')} disabled={busy} style={isCli ? { borderColor: focusType?.color } : {}} />
              </label>
              <label className="adm-field" style={isProc ? { gridColumn: '1 / -1' } : {}}>
                <span>Referência do processo {isProc ? '(recomendado)' : '(opcional)'}</span>
                <input type="text" value={evModal.form.case_reference} onChange={evField('case_reference')} disabled={busy} placeholder="Ex.: 1289/26 · ABACO 202699378" style={isProc ? { borderColor: focusType?.color } : {}} />
              </label>
              {(isFin || Number(evModal.form.amount) > 0 || evModal.form.status !== 'none') && (
                <>
                  <label className="adm-field">
                    <span>Valor</span>
                    <input type="text" value={evModal.form.amount} onChange={evField('amount')} placeholder="0" disabled={busy} style={isFin ? { borderColor: focusType?.color } : {}} />
                  </label>
                  <label className="adm-field">
                    <span>Moeda</span>
                    <select value={evModal.form.currency} onChange={evField('currency')} disabled={busy}>
                      <option value="EUR">€ EUR</option>
                      <option value="BRL">R$ BRL</option>
                    </select>
                  </label>
                </>
              )}
              <label className="adm-field" style={{ gridColumn: isFin ? '1 / -1' : 'auto' }}>
                <span>Estado financeiro</span>
                <select value={evModal.form.status} onChange={evField('status')} disabled={busy}>
                  <option value="none">Nenhum</option>
                  <option value="paid">Pago</option>
                  <option value="pending">A vencer</option>
                  <option value="overdue">Atrasado</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.7rem', marginTop: '1.4rem' }}>
              <button className="adm-btn" onClick={() => setEvModal(null)} disabled={busy}>Cancelar</button>
              <button className="adm-btn adm-btn-gold" onClick={saveEvent} disabled={busy}>
                {busy ? 'A guardar…' : (evModal.mode === 'create' ? 'Criar evento' : 'Guardar alterações')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: gestão de tipos de data ── */}
      {typeMgrOpen && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) { setTypeMgrOpen(false); setTypeForm(null); setTypeDeleting(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 640, padding: '1.6rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 0.4rem', fontFamily: 'var(--serif)' }}>Tipos de data</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Ative/desative os tipos visíveis no calendário. Os tipos nativos não podem ser apagados; pode criar tipos personalizados.
            </p>

            {types.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <input type="checkbox" checked={isVisible(t)} onChange={() => toggleType(t.id)} style={{ width: 'auto' }} />
                <span style={{ width: 12, height: 12, borderRadius: 3, background: t.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.9rem' }}>{t.label}</strong>
                  {!t.is_default && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 6 }}>personalizado</span>}
                  {t.description && <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{t.description}</div>}
                </div>
                {!t.is_default && (
                  <div style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setTypeForm({ mode: 'edit', id: t.id, label: t.label, color: t.color, description: t.description || '' }); setTypeDeleting(null); }} style={{ marginRight: 8 }}>Editar</a>
                    <a href="#" onClick={(e) => { e.preventDefault(); setTypeDeleting(t); setTypeForm(null); }} style={{ color: '#b00' }}>Apagar</a>
                  </div>
                )}
              </div>
            ))}

            {typeDeleting && (
              <div style={{ background: 'rgba(176,0,0,0.06)', border: '1px solid rgba(176,0,0,0.25)', borderRadius: 8, padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Apagar o tipo "{typeDeleting.label}" — o que fazer aos eventos deste tipo?</div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button className="adm-btn" onClick={() => confirmDeleteType('delete')} disabled={busy} style={{ color: '#b00' }}>Apagar eventos também</button>
                  <button className="adm-btn" onClick={() => confirmDeleteType('move')} disabled={busy}>Mover para "Eventos pessoais"</button>
                  <button className="adm-btn" onClick={() => setTypeDeleting(null)} disabled={busy}>Cancelar</button>
                </div>
              </div>
            )}

            {typeForm ? (
              <div style={{ background: 'var(--cream, #f5f0e8)', borderRadius: 8, padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.6rem' }}>{typeForm.mode === 'create' ? 'Novo tipo de data' : `Editar "${typeForm.label}"`}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.7rem' }}>
                  <label className="adm-field">
                    <span>Label *</span>
                    <input type="text" value={typeForm.label} onChange={(e) => setTypeForm((f) => ({ ...f, label: e.target.value }))} disabled={busy} placeholder="Ex.: Conservatória, Notário…" />
                  </label>
                  <label className="adm-field">
                    <span>Cor</span>
                    <input type="color" value={typeForm.color} onChange={(e) => setTypeForm((f) => ({ ...f, color: e.target.value }))} disabled={busy} style={{ width: 60, height: 38, padding: 2 }} />
                  </label>
                  <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                    <span>Descrição</span>
                    <input type="text" value={typeForm.description} onChange={(e) => setTypeForm((f) => ({ ...f, description: e.target.value }))} disabled={busy} />
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.7rem' }}>
                  <button className="adm-btn" onClick={() => setTypeForm(null)} disabled={busy}>Cancelar</button>
                  <button className="adm-btn adm-btn-gold" onClick={saveType} disabled={busy}>{busy ? 'A guardar…' : 'Guardar tipo'}</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <button className="adm-btn" onClick={() => { setTypeForm({ mode: 'create', label: '', color: '#59788E', description: '' }); setTypeDeleting(null); }}>＋ Criar tipo personalizado</button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.2rem' }}>
              <button className="adm-btn" onClick={() => { setTypeMgrOpen(false); setTypeForm(null); setTypeDeleting(null); }}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
