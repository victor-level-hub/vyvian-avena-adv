// src/admin/pages/Calendar.jsx
// Calendário jurídico — merge de funcionalidades "event-manager" (pesquisa,
// filtros, vistas Mês/Semana/Dia/Lista, hover com detalhes) com visual
// glassmorphism, adaptado à paleta do site (verde-floresta + dourado).
// Dados: tipos/eventos em D1 (API /api/calendar) + vencimentos (parcelas).
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
  if (compact && n >= 1000) return symbol + ' ' + (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return symbol + ' ' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
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

// ── Estilos glass (scoped gcal-*) — paleta do site: floresta + dourado ──
const GLASS_CSS = `
.gcal-wrap {
  background:
    radial-gradient(1100px 500px at 85% -10%, rgba(184,147,90,0.22), transparent 60%),
    radial-gradient(800px 420px at -10% 110%, rgba(184,147,90,0.12), transparent 55%),
    linear-gradient(140deg, #0d241e 0%, #123a2f 48%, #16463a 100%);
  border-radius: 22px;
  padding: 1.4rem;
  color: #f4efe6;
  box-shadow: 0 24px 70px rgba(10,30,25,0.45);
}
.gcal-glass {
  background: rgba(255,255,255,0.07);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 16px;
}
.gcal-title { font-family: var(--serif, Fraunces, serif); font-size: 2rem; font-weight: 600; letter-spacing: 0.01em; color: #fff; }
.gcal-sub { font-size: 0.82rem; color: rgba(244,239,230,0.65); }
.gcal-btn {
  background: rgba(255,255,255,0.09); color: #f4efe6; border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 0.42rem 0.85rem; font-size: 0.82rem; cursor: pointer;
  transition: background 0.15s, border-color 0.15s; white-space: nowrap;
}
.gcal-btn:hover { background: rgba(255,255,255,0.16); }
.gcal-btn-gold {
  background: linear-gradient(135deg, var(--gold, #b8935a), #d5b17c); color: #12302a;
  border: none; font-weight: 600; box-shadow: 0 6px 18px rgba(184,147,90,0.35);
}
.gcal-btn-gold:hover { filter: brightness(1.06); background: linear-gradient(135deg, var(--gold, #b8935a), #d5b17c); }
.gcal-pill { border-radius: 999px; padding: 0.32rem 0.9rem; font-size: 0.78rem; cursor: pointer; border: 1px solid transparent; color: rgba(244,239,230,0.7); background: transparent; transition: all 0.15s; }
.gcal-pill:hover { color: #fff; }
.gcal-pill.on { background: rgba(255,255,255,0.92); color: #12302a; font-weight: 700; box-shadow: 0 3px 10px rgba(0,0,0,0.25); }
.gcal-input {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); border-radius: 10px;
  color: #f4efe6; padding: 0.5rem 0.8rem 0.5rem 2.1rem; font-size: 0.85rem; width: 100%;
}
.gcal-input::placeholder { color: rgba(244,239,230,0.45); }
.gcal-input:focus { outline: none; border-color: rgba(213,177,124,0.6); }
.gcal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.gcal-dh { text-align: center; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(244,239,230,0.5); padding: 0.35rem 0; }
.gcal-day {
  min-height: 96px; border-radius: 12px; padding: 0.4rem 0.45rem; cursor: pointer;
  background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.07);
  transition: background 0.15s, transform 0.12s, border-color 0.15s; position: relative;
}
.gcal-day:hover { background: rgba(255,255,255,0.11); }
.gcal-day.muted { opacity: 0.38; }
.gcal-day.today { border-color: rgba(213,177,124,0.75); box-shadow: inset 0 0 0 1px rgba(213,177,124,0.5); }
.gcal-day.sel { background: rgba(213,177,124,0.18); border-color: rgba(213,177,124,0.6); }
.gcal-daynum { font-size: 0.82rem; font-weight: 600; color: rgba(255,255,255,0.85); }
.gcal-day.today .gcal-daynum {
  display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center;
  border-radius: 50%; background: linear-gradient(135deg, var(--gold,#b8935a), #d5b17c); color: #12302a;
}
.gcal-chip { position: relative; display: block; margin-top: 3px; }
.gcal-chip-label {
  display: block; font-size: 0.63rem; line-height: 1.3; padding: 0.1rem 0.35rem; border-radius: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; cursor: pointer;
  transition: transform 0.12s;
}
.gcal-chip:hover .gcal-chip-label { transform: scale(1.04); }
.gcal-pop {
  display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 80; width: 250px;
  background: rgba(13,36,30,0.97); border: 1px solid rgba(213,177,124,0.4); border-radius: 12px;
  padding: 0.7rem 0.8rem; box-shadow: 0 16px 40px rgba(0,0,0,0.5); cursor: default; text-align: left;
}
.gcal-chip:hover .gcal-pop { display: block; }
.gcal-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 2px; }
.gcal-amount { font-size: 0.66rem; font-weight: 700; color: #d5b17c; margin-top: 2px; }
.gcal-amount.late { color: #e88; }
.gcal-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.72rem; color: rgba(244,239,230,0.72); margin-top: 0.9rem; }
.gcal-legend span { display: inline-flex; align-items: center; gap: 5px; }
.gcal-filterchip {
  display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 999px; padding: 0.26rem 0.75rem;
  font-size: 0.75rem; cursor: pointer; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.06);
  color: rgba(244,239,230,0.85); transition: all 0.15s;
}
.gcal-filterchip.off { opacity: 0.45; }
.gcal-row { border-radius: 12px; padding: 0.7rem 0.9rem; background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.08); transition: background 0.15s, transform 0.12s; }
.gcal-row:hover { background: rgba(255,255,255,0.1); transform: translateY(-1px); }
.gcal-modal-bg { position: fixed; inset: 0; background: rgba(8,22,18,0.72); backdrop-filter: blur(6px); display: flex; align-items: flex-start; justify-content: center; padding: 3rem 1rem; z-index: 1000; overflow-y: auto; }
.gcal-modal {
  background: linear-gradient(150deg, rgba(19,50,41,0.96), rgba(13,36,30,0.98));
  border: 1px solid rgba(213,177,124,0.35); border-radius: 18px; width: 100%; padding: 1.6rem;
  box-shadow: 0 30px 80px rgba(0,0,0,0.55); color: #f4efe6;
}
.gcal-modal h2 { font-family: var(--serif, Fraunces, serif); color: #fff; }
.gcal-modal label span { display: block; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(244,239,230,0.6); margin-bottom: 0.3rem; }
.gcal-modal input, .gcal-modal select, .gcal-modal textarea {
  width: 100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 9px; color: #f4efe6; padding: 0.5rem 0.7rem; font-size: 0.88rem; font-family: inherit;
}
.gcal-modal input:focus, .gcal-modal select:focus, .gcal-modal textarea:focus { outline: none; border-color: rgba(213,177,124,0.6); }
.gcal-modal select option { background: #12302a; color: #f4efe6; }
.gcal-modal input[type="checkbox"] { width: auto; }
.gcal-modal input[type="color"] { padding: 2px; height: 38px; }
.gcal-badge { display: inline-block; border-radius: 999px; padding: 0.1rem 0.55rem; font-size: 0.68rem; font-weight: 600; }
.gcal-badge.paid { background: rgba(80,160,110,0.25); color: #8fd6ae; }
.gcal-badge.pending { background: rgba(213,177,124,0.22); color: #e8cfa4; }
.gcal-badge.late { background: rgba(200,80,80,0.25); color: #f0a0a0; }
.gcal-a { color: #d5b17c; text-decoration: none; }
.gcal-a:hover { text-decoration: underline; }
@media (max-width: 760px) { .gcal-day { min-height: 70px; } .gcal-title { font-size: 1.4rem; } }
`;

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
  const [view, setView] = useState('month'); // 'month' | 'week' | 'day' | 'list' | 'next30'
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [typeMgrOpen, setTypeMgrOpen] = useState(false);
  const [typeForm, setTypeForm] = useState(null);
  const [typeDeleting, setTypeDeleting] = useState(null);
  const [evModal, setEvModal] = useState(null);
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

  const isVisible = (t) => (visOverride[t.id] !== undefined ? !!visOverride[t.id] : !!t.is_visible);
  const typeById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);

  // pesquisa (event-manager): título, descrição, cliente, referência, tipo
  const matchesSearch = (ev) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (ev.title || '').toLowerCase().includes(q)
      || (ev.description || '').toLowerCase().includes(q)
      || (ev.client_name || '').toLowerCase().includes(q)
      || (ev.case_reference || '').toLowerCase().includes(q)
      || (typeById[ev.type_id]?.label || '').toLowerCase().includes(q);
  };
  const instMatchesSearch = (i) => !search || (i.client_name || '').toLowerCase().includes(search.toLowerCase());

  const visibleEvents = useMemo(
    () => events.filter((ev) => { const t = typeById[ev.type_id]; return (t ? isVisible(t) : true) && matchesSearch(ev); }),
    [events, typeById, visOverride, search],
  );
  const visibleInstallments = useMemo(
    () => allInstallments.filter(instMatchesSearch),
    [allInstallments, search],
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

  const weekDays = useMemo(() => {
    const d = new Date(currentDate);
    const dow = (d.getDay() + 6) % 7; // 0 = segunda
    d.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; });
  }, [currentDate]);

  const installmentsByDate = useMemo(() => {
    const map = {};
    visibleInstallments.forEach((i) => { (map[i.due_date] = map[i.due_date] || []).push(i); });
    return map;
  }, [visibleInstallments]);

  const eventsByDate = useMemo(() => {
    const map = {};
    visibleEvents.forEach((ev) => { eventDays(ev).forEach((k) => { (map[k] = map[k] || []).push(ev); }); });
    return map;
  }, [visibleEvents]);

  // resumo financeiro do mês
  const monthKeyPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthInstallments = visibleInstallments.filter((i) => (i.due_date || '').startsWith(monthKeyPrefix));
  const finEvents = visibleEvents.filter((ev) =>
    ev.type_id === 'financeiro' && (ev.status === 'pending' || ev.status === 'overdue') &&
    (ev.start_date || '').startsWith(monthKeyPrefix));
  const totalEur = monthInstallments.filter((i) => i.currency === 'EUR').reduce((s, i) => s + Number(i.amount), 0)
    + finEvents.filter((e) => e.currency === 'EUR').reduce((s, e) => s + Number(e.amount || 0), 0);
  const numVenc = monthInstallments.length + finEvents.length;

  // navegação adapta-se à vista (event-manager)
  const navigate = (dir) => {
    const d = new Date(currentDate);
    if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else if (view === 'day') d.setDate(d.getDate() + dir);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
    setSelectedDate(null);
  };
  const goToday = () => { setCurrentDate(new Date(TODAY_REAL)); setSelectedDate(null); };

  useEffect(() => {
    if (selectedDate && (view === 'month' || view === 'week') && dayDetailRef.current) {
      dayDetailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDate, view]);

  const selectedKey = selectedDate ? dateKey(selectedDate) : null;
  const selectedInstallments = selectedKey ? (installmentsByDate[selectedKey] || []) : [];
  const selectedEvents = selectedKey ? (eventsByDate[selectedKey] || []) : [];

  // ── CRUD eventos
  const openCreateEvent = (dayKey) => setEvModal({ mode: 'create', form: { ...EMPTY_EVENT, start_date: dayKey || dateKey(TODAY_REAL) } });
  const openEditEvent = (ev) => setEvModal({
    mode: 'edit', id: ev.id, source: ev.source,
    form: {
      title: ev.title || '', description: ev.description || '', type_id: ev.type_id,
      start_date: ev.start_date || '', end_date: ev.end_date || '', is_all_day: !!ev.is_all_day,
      amount: ev.amount || '', currency: ev.currency || 'EUR', status: ev.status || 'none',
      client_name: ev.client_name || '', case_reference: ev.case_reference || '',
    },
  });
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

  // ── CRUD tipos
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

  // ── listas (Lista do mês / 30 dias / Dia)
  const listItems = useMemo(() => {
    const items = [];
    const t0 = dateKey(TODAY_REAL);
    const inRange = (k) => {
      if (view === 'list') return k.startsWith(monthKeyPrefix);
      if (view === 'day') return k === dateKey(currentDate);
      return k >= t0 && k <= addDays(t0, 30);
    };
    visibleEvents.forEach((ev) => {
      const days = eventDays(ev);
      if (days.some(inRange)) items.push({ kind: 'event', key: ev.start_date, ev });
    });
    visibleInstallments.forEach((i) => {
      if (i.due_date && inRange(i.due_date)) items.push({ kind: 'installment', key: i.due_date, inst: i });
    });
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }, [view, visibleEvents, visibleInstallments, monthKeyPrefix, currentDate]);

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar calendário…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  const activeTypes = types.filter(isVisible);
  const hiddenTypes = types.filter((t) => !isVisible(t));
  const focusType = evModal ? (typeById[evModal.form.type_id] || null) : null;
  const isFin = evModal && evModal.form.type_id === 'financeiro';
  const isCli = evModal && evModal.form.type_id === 'cliente';
  const isProc = evModal && evModal.form.type_id === 'processo';

  const viewTitle =
    view === 'week' ? `Semana de ${fmtDateShort(dateKey(weekDays[0]))}` :
    view === 'day' ? new Date(currentDate).toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) :
    view === 'next30' ? 'Próximos 30 dias' :
    `${MONTHS_PT[month]} · ${year}`;

  // chip de evento com popover hover (EventCard do event-manager)
  const EventChip = ({ ev, k }) => {
    const t = typeById[ev.type_id];
    const color = t?.color || '#888';
    const multi = ev.end_date && ev.end_date > ev.start_date;
    return (
      <span className="gcal-chip" onClick={(e) => { e.stopPropagation(); if (ev.source === 'manual') openEditEvent(ev); }}>
        <span className="gcal-chip-label" style={{ background: color + '55', borderLeft: `3px solid ${color}` }}>
          {multi && k && k !== ev.start_date ? '· ' : ''}{ev.title}
        </span>
        <span className="gcal-pop">
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{ev.title}</strong>
            <span className="gcal-dot" style={{ background: color, width: 10, height: 10, flexShrink: 0, marginTop: 3 }} />
          </span>
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(244,239,230,0.75)', marginTop: 3 }}>
            {t?.label || ev.type_id} · {fmtDateShort(ev.start_date)}{ev.end_date ? ` → ${fmtDateShort(ev.end_date)}` : ''}
          </span>
          {ev.description && <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(244,239,230,0.62)', marginTop: 5 }}>{ev.description.slice(0, 140)}{ev.description.length > 140 ? '…' : ''}</span>}
          {(ev.client_name || ev.case_reference || Number(ev.amount) > 0) && (
            <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 5, color: 'rgba(244,239,230,0.85)' }}>
              {ev.client_name && <>👤 {ev.client_name}  </>}
              {ev.case_reference && <>📁 {ev.case_reference}  </>}
              {Number(ev.amount) > 0 && <strong style={{ color: '#d5b17c' }}>{fmtMoney(ev.amount, ev.currency)}</strong>}
            </span>
          )}
          {ev.source === 'manual' && <span style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(213,177,124,0.8)', marginTop: 6 }}>clique para editar</span>}
        </span>
      </span>
    );
  };

  const StatusBadge = ({ s }) => (
    s === 'paid' ? <span className="gcal-badge paid">Pago</span> :
    s === 'late' || s === 'overdue' ? <span className="gcal-badge late">Atrasado</span> :
    s === 'due_today' ? <span className="gcal-badge pending">Hoje</span> :
    <span className="gcal-badge pending">Pendente</span>
  );

  const renderListRows = (items) => items.length === 0
    ? <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(244,239,230,0.55)' }}>Sem eventos no período.</div>
    : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => item.kind === 'event' ? (
          <div key={'e' + item.ev.id + i} className="gcal-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="gcal-dot" style={{ background: typeById[item.ev.type_id]?.color || '#888', width: 10, height: 10, marginTop: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: '#fff' }}>{item.ev.title}</strong>
              <span className="gcal-sub"> · {typeById[item.ev.type_id]?.label}</span>
              <div className="gcal-sub" style={{ marginTop: 2 }}>
                {fmtDate(item.ev.start_date)}{item.ev.end_date ? ` → ${fmtDate(item.ev.end_date)}` : ''}
                {item.ev.client_name ? ` · 👤 ${item.ev.client_name}` : ''}
                {item.ev.case_reference ? ` · 📁 ${item.ev.case_reference}` : ''}
              </div>
              {item.ev.description && <div className="gcal-sub" style={{ marginTop: 2, fontSize: '0.76rem' }}>{item.ev.description.slice(0, 160)}{item.ev.description.length > 160 ? '…' : ''}</div>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {Number(item.ev.amount) > 0 && <div style={{ color: '#d5b17c', fontWeight: 700, fontSize: '0.85rem' }}>{fmtMoney(item.ev.amount, item.ev.currency)}</div>}
              {item.ev.status !== 'none' && <div style={{ marginTop: 3 }}><StatusBadge s={item.ev.status} /></div>}
              {item.ev.source === 'manual' && (
                <div style={{ fontSize: '0.72rem', marginTop: 5 }}>
                  <a href="#" className="gcal-a" onClick={(e) => { e.preventDefault(); openEditEvent(item.ev); }} style={{ marginRight: 8 }}>Editar</a>
                  <a href="#" onClick={(e) => { e.preventDefault(); deleteEvent(item.ev); }} style={{ color: '#f0a0a0', textDecoration: 'none' }}>Apagar</a>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div key={'i' + item.inst.id} className="gcal-row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="gcal-dot" style={{ background: typeById['financeiro']?.color || '#4F8A67', width: 10, height: 10, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/admin/clientes/${item.inst.client_id}`} className="gcal-a"><strong>{item.inst.client_name}</strong></Link>
              <span className="gcal-sub"> · parcela {item.inst.installment_number}/{item.inst.total_installments}</span>
              <div className="gcal-sub" style={{ marginTop: 2 }}>{fmtDate(item.inst.due_date)}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ color: '#d5b17c', fontWeight: 700, fontSize: '0.85rem' }}>{fmtMoney(item.inst.amount, item.inst.currency)}</div>
              <div style={{ marginTop: 3 }}><StatusBadge s={item.inst.status} /></div>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <>
      <style>{GLASS_CSS}</style>
      <header className="adm-page-header">
        <div>
          <h1>Calendário</h1>
          <div className="adm-sub">Agenda jurídica, prazos e vencimentos</div>
        </div>
      </header>

      <div className="gcal-wrap">
        {/* topo: título + navegação + vistas + ações */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
            <div>
              <div className="gcal-title">{viewTitle}</div>
              <div className="gcal-sub">{numVenc} vencimentos · {fmtMoney(totalEur)} previstos (EUR)</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="gcal-btn" onClick={() => navigate(-1)}>‹</button>
              <button className="gcal-btn" onClick={goToday}>Hoje</button>
              <button className="gcal-btn" onClick={() => navigate(1)}>›</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="gcal-glass" style={{ display: 'flex', gap: 2, padding: 4, borderRadius: 999 }}>
              {[['month', 'Mês'], ['week', 'Semana'], ['day', 'Dia'], ['list', 'Lista'], ['next30', '30 dias']].map(([k, l]) => (
                <button key={k} className={'gcal-pill' + (view === k ? ' on' : '')} onClick={() => { setView(k); setSelectedDate(null); }}>{l}</button>
              ))}
            </div>
            <button className="gcal-btn" onClick={() => setShowFilters((v) => !v)}>
              ⚙ Filtros{hiddenTypes.length > 0 ? ` (${activeTypes.length}/${types.length})` : ''}
            </button>
            <button className="gcal-btn" onClick={() => setTypeMgrOpen(true)}>Tipos de data</button>
            <button className="gcal-btn gcal-btn-gold" onClick={() => openCreateEvent(selectedKey)}>＋ Evento</button>
          </div>
        </div>

        {/* pesquisa */}
        <div style={{ position: 'relative', marginTop: '1rem' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.9rem' }}>🔍</span>
          <input
            className="gcal-input"
            placeholder="Pesquisar eventos, clientes, processos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(244,239,230,0.6)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          )}
        </div>

        {/* painel de filtros */}
        {showFilters && (
          <div className="gcal-glass" style={{ marginTop: '0.8rem', padding: '0.8rem 0.9rem', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {types.map((t) => {
              const on = isVisible(t);
              return (
                <button key={t.id} className={'gcal-filterchip' + (on ? '' : ' off')} onClick={() => toggleType(t.id)} title={t.description || ''}
                  style={on ? { borderColor: t.color, background: t.color + '2e' } : {}}>
                  <span className="gcal-dot" style={{ background: on ? t.color : 'rgba(255,255,255,0.3)' }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* filtros ativos (tipos ocultos) — badges com X, estilo event-manager */}
        {hiddenTypes.length > 0 && !showFilters && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: '0.7rem', alignItems: 'center' }}>
            <span className="gcal-sub">Ocultos:</span>
            {hiddenTypes.map((t) => (
              <button key={t.id} className="gcal-filterchip off" onClick={() => toggleType(t.id)} title="Clique para voltar a mostrar">
                <span className="gcal-dot" style={{ background: t.color }} />{t.label} ✕
              </button>
            ))}
          </div>
        )}

        {/* ── vista MÊS ── */}
        {view === 'month' && (
          <div style={{ marginTop: '1rem' }}>
            <div className="gcal-grid" style={{ marginBottom: 4 }}>
              {DAYS_PT.map((d) => <div key={d} className="gcal-dh">{d}</div>)}
            </div>
            <div className="gcal-grid">
              {grid.map((cell, idx) => {
                const k = dateKey(cell.date);
                const inst = installmentsByDate[k] || [];
                const evs = eventsByDate[k] || [];
                const isToday = isSameDay(cell.date, TODAY_REAL);
                const isSel = selectedDate && isSameDay(cell.date, selectedDate);
                const dayCurrency = inst[0]?.currency || 'EUR';
                const dayTotal = inst.reduce((s, i) => (i.currency === dayCurrency ? s + Number(i.amount) : s), 0);
                const hasLate = inst.some((i) => i.status === 'late');
                const maxBadges = inst.length > 0 ? 2 : 3;
                const shown = evs.slice(0, maxBadges);
                const extra = evs.length - shown.length;

                return (
                  <div key={idx}
                    className={'gcal-day' + (cell.current ? '' : ' muted') + (isToday ? ' today' : '') + (isSel ? ' sel' : '')}
                    onClick={() => cell.current && setSelectedDate(cell.date)}>
                    <div className="gcal-daynum">{cell.date.getDate()}</div>
                    {inst.length > 0 && (
                      <>
                        <div style={{ marginTop: 3 }}>
                          {inst.slice(0, 6).map((i) => (
                            <span key={i.id} className="gcal-dot" style={{ background: i.status === 'paid' ? '#5fae7f' : i.status === 'late' ? '#d97b7b' : '#d5b17c' }} />
                          ))}
                        </div>
                        <div className={'gcal-amount' + (hasLate ? ' late' : '')}>{fmtMoney(dayTotal, dayCurrency, true)}</div>
                      </>
                    )}
                    {shown.map((ev) => <EventChip key={ev.id} ev={ev} k={k} />)}
                    {extra > 0 && <span style={{ display: 'block', fontSize: '0.62rem', color: 'rgba(244,239,230,0.5)', marginTop: 2 }}>+{extra} evento{extra > 1 ? 's' : ''}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── vista SEMANA ── */}
        {view === 'week' && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {weekDays.map((d) => {
              const k = dateKey(d);
              const inst = installmentsByDate[k] || [];
              const evs = eventsByDate[k] || [];
              const isToday = isSameDay(d, TODAY_REAL);
              return (
                <div key={k} className={'gcal-day' + (isToday ? ' today' : '')} style={{ minHeight: 190, cursor: 'pointer' }} onClick={() => setSelectedDate(new Date(d))}>
                  <div className="gcal-dh" style={{ padding: 0, textAlign: 'left' }}>{DAYS_PT[(d.getDay() + 6) % 7]}</div>
                  <div className="gcal-daynum" style={{ marginTop: 2 }}>{d.getDate()}</div>
                  {inst.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {inst.map((i) => (
                        <div key={i.id} style={{ fontSize: '0.63rem', color: '#d5b17c', fontWeight: 700 }}>
                          <span className="gcal-dot" style={{ background: i.status === 'paid' ? '#5fae7f' : i.status === 'late' ? '#d97b7b' : '#d5b17c' }} />
                          {fmtMoney(i.amount, i.currency, true)} · {(i.client_name || '').split(' ')[0]}
                        </div>
                      ))}
                    </div>
                  )}
                  {evs.map((ev) => <EventChip key={ev.id} ev={ev} k={k} />)}
                </div>
              );
            })}
          </div>
        )}

        {/* ── vistas DIA / LISTA / 30 DIAS ── */}
        {(view === 'day' || view === 'list' || view === 'next30') && (
          <div className="gcal-glass" style={{ marginTop: '1rem', padding: '1rem' }}>
            {renderListRows(listItems)}
          </div>
        )}

        {/* legenda */}
        <div className="gcal-legend">
          <span><span className="gcal-dot" style={{ background: '#5fae7f' }} />Pago</span>
          <span><span className="gcal-dot" style={{ background: '#d5b17c' }} />A vencer</span>
          <span><span className="gcal-dot" style={{ background: '#d97b7b' }} />Atrasado</span>
          <span style={{ opacity: 0.3 }}>|</span>
          {activeTypes.map((t) => (
            <span key={t.id}><span className="gcal-dot" style={{ background: t.color }} />{t.label}</span>
          ))}
        </div>

        {/* detalhe do dia (Mês/Semana) */}
        {(view === 'month' || view === 'week') && selectedDate && (
          <div ref={dayDetailRef} className="gcal-glass" style={{ marginTop: '1rem', padding: '1.1rem', scrollMarginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
              <strong style={{ fontFamily: 'var(--serif, Fraunces, serif)', fontSize: '1.1rem', color: '#fff' }}>Dia {fmtDate(selectedKey)}</strong>
              <button className="gcal-btn gcal-btn-gold" onClick={() => openCreateEvent(selectedKey)}>＋ Adicionar evento neste dia</button>
            </div>
            {renderListRows([
              ...selectedEvents.map((ev) => ({ kind: 'event', key: ev.start_date, ev })),
              ...selectedInstallments.map((inst) => ({ kind: 'installment', key: inst.due_date, inst })),
            ])}
          </div>
        )}
      </div>

      {/* ── Modal: evento ── */}
      {evModal && (
        <div className="gcal-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setEvModal(null); }}>
          <div className="gcal-modal" style={{ maxWidth: 560 }}>
            <h2 style={{ margin: '0 0 1.1rem' }}>
              {evModal.mode === 'create' ? 'Novo evento' : 'Editar evento'}
              {focusType && <span style={{ fontSize: '0.78rem', marginLeft: 10, color: focusType.color, fontFamily: 'inherit' }}>● {focusType.label}</span>}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label style={{ gridColumn: '1 / -1' }}><span>Título *</span>
                <input type="text" value={evModal.form.title} onChange={evField('title')} disabled={busy} />
              </label>
              <label><span>Tipo de data *</span>
                <select value={evModal.form.type_id} onChange={evField('type_id')} disabled={busy}>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-end' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', textTransform: 'none', fontSize: '0.85rem', color: '#f4efe6', marginBottom: '0.5rem' }}>
                  <input type="checkbox" checked={!!evModal.form.is_all_day} onChange={evField('is_all_day')} disabled={busy} />
                  Dia inteiro
                </span>
              </label>
              <label><span>Data inicial *</span>
                <input type="date" value={evModal.form.start_date} onChange={evField('start_date')} disabled={busy} />
              </label>
              <label><span>Data final (opcional)</span>
                <input type="date" value={evModal.form.end_date} onChange={evField('end_date')} disabled={busy} />
              </label>
              <label style={{ gridColumn: '1 / -1' }}><span>Descrição</span>
                <textarea rows={3} value={evModal.form.description} onChange={evField('description')} disabled={busy} />
              </label>
              <label style={isCli ? { gridColumn: '1 / -1' } : {}}><span>Cliente {isCli ? '(recomendado)' : '(opcional)'}</span>
                <input type="text" value={evModal.form.client_name} onChange={evField('client_name')} disabled={busy} style={isCli ? { borderColor: focusType?.color } : {}} />
              </label>
              <label style={isProc ? { gridColumn: '1 / -1' } : {}}><span>Referência do processo {isProc ? '(recomendado)' : '(opcional)'}</span>
                <input type="text" value={evModal.form.case_reference} onChange={evField('case_reference')} disabled={busy} placeholder="Ex.: 1289/26 · ABACO 202699378" style={isProc ? { borderColor: focusType?.color } : {}} />
              </label>
              {(isFin || Number(evModal.form.amount) > 0 || evModal.form.status !== 'none') && (
                <>
                  <label><span>Valor</span>
                    <input type="text" value={evModal.form.amount} onChange={evField('amount')} placeholder="0" disabled={busy} style={isFin ? { borderColor: focusType?.color } : {}} />
                  </label>
                  <label><span>Moeda</span>
                    <select value={evModal.form.currency} onChange={evField('currency')} disabled={busy}>
                      <option value="EUR">€ EUR</option>
                      <option value="BRL">R$ BRL</option>
                    </select>
                  </label>
                </>
              )}
              <label style={{ gridColumn: isFin ? '1 / -1' : 'auto' }}><span>Estado financeiro</span>
                <select value={evModal.form.status} onChange={evField('status')} disabled={busy}>
                  <option value="none">Nenhum</option>
                  <option value="paid">Pago</option>
                  <option value="pending">A vencer</option>
                  <option value="overdue">Atrasado</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.7rem', marginTop: '1.4rem' }}>
              <div>
                {evModal.mode === 'edit' && evModal.source === 'manual' && (
                  <button className="gcal-btn" style={{ borderColor: 'rgba(217,123,123,0.5)', color: '#f0a0a0' }} onClick={() => { const ev = events.find((x) => x.id === evModal.id); if (ev) deleteEvent(ev); setEvModal(null); }} disabled={busy}>Apagar</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.7rem' }}>
                <button className="gcal-btn" onClick={() => setEvModal(null)} disabled={busy}>Cancelar</button>
                <button className="gcal-btn gcal-btn-gold" onClick={saveEvent} disabled={busy}>
                  {busy ? 'A guardar…' : (evModal.mode === 'create' ? 'Criar evento' : 'Guardar')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: tipos de data ── */}
      {typeMgrOpen && (
        <div className="gcal-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) { setTypeMgrOpen(false); setTypeForm(null); setTypeDeleting(null); } }}>
          <div className="gcal-modal" style={{ maxWidth: 640 }}>
            <h2 style={{ margin: '0 0 0.4rem' }}>Tipos de data</h2>
            <p className="gcal-sub" style={{ margin: '0 0 1rem' }}>
              Ative/desative os tipos visíveis no calendário. Os tipos nativos não podem ser apagados; pode criar tipos personalizados.
            </p>

            {types.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <input type="checkbox" checked={isVisible(t)} onChange={() => toggleType(t.id)} style={{ width: 'auto' }} />
                <span style={{ width: 12, height: 12, borderRadius: 3, background: t.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{t.label}</strong>
                  {!t.is_default && <span className="gcal-sub" style={{ marginLeft: 6, fontSize: '0.7rem' }}>personalizado</span>}
                  {t.description && <div className="gcal-sub" style={{ fontSize: '0.74rem' }}>{t.description}</div>}
                </div>
                {!t.is_default && (
                  <div style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    <a href="#" className="gcal-a" onClick={(e) => { e.preventDefault(); setTypeForm({ mode: 'edit', id: t.id, label: t.label, color: t.color, description: t.description || '' }); setTypeDeleting(null); }} style={{ marginRight: 8 }}>Editar</a>
                    <a href="#" onClick={(e) => { e.preventDefault(); setTypeDeleting(t); setTypeForm(null); }} style={{ color: '#f0a0a0', textDecoration: 'none' }}>Apagar</a>
                  </div>
                )}
              </div>
            ))}

            {typeDeleting && (
              <div style={{ background: 'rgba(217,123,123,0.12)', border: '1px solid rgba(217,123,123,0.4)', borderRadius: 12, padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#fff' }}>Apagar o tipo "{typeDeleting.label}" — o que fazer aos eventos deste tipo?</div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button className="gcal-btn" style={{ color: '#f0a0a0' }} onClick={() => confirmDeleteType('delete')} disabled={busy}>Apagar eventos também</button>
                  <button className="gcal-btn" onClick={() => confirmDeleteType('move')} disabled={busy}>Mover para "Eventos pessoais"</button>
                  <button className="gcal-btn" onClick={() => setTypeDeleting(null)} disabled={busy}>Cancelar</button>
                </div>
              </div>
            )}

            {typeForm ? (
              <div className="gcal-glass" style={{ padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.6rem', color: '#fff' }}>{typeForm.mode === 'create' ? 'Novo tipo de data' : `Editar "${typeForm.label}"`}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.7rem' }}>
                  <label><span>Label *</span>
                    <input type="text" value={typeForm.label} onChange={(e) => setTypeForm((f) => ({ ...f, label: e.target.value }))} disabled={busy} placeholder="Ex.: Conservatória, Notário…" />
                  </label>
                  <label><span>Cor</span>
                    <input type="color" value={typeForm.color} onChange={(e) => setTypeForm((f) => ({ ...f, color: e.target.value }))} disabled={busy} style={{ width: 60 }} />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}><span>Descrição</span>
                    <input type="text" value={typeForm.description} onChange={(e) => setTypeForm((f) => ({ ...f, description: e.target.value }))} disabled={busy} />
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.7rem' }}>
                  <button className="gcal-btn" onClick={() => setTypeForm(null)} disabled={busy}>Cancelar</button>
                  <button className="gcal-btn gcal-btn-gold" onClick={saveType} disabled={busy}>{busy ? 'A guardar…' : 'Guardar tipo'}</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <button className="gcal-btn" onClick={() => { setTypeForm({ mode: 'create', label: '', color: '#59788E', description: '' }); setTypeDeleting(null); }}>＋ Criar tipo personalizado</button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.2rem' }}>
              <button className="gcal-btn" onClick={() => { setTypeMgrOpen(false); setTypeForm(null); setTypeDeleting(null); }}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
