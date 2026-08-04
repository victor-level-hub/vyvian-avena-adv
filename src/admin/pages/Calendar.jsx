// src/admin/pages/Calendar.jsx
// Calendário jurídico — redesign «Vyvian Avena Design System v3» (rollout 4/5).
// Funcionalidades intactas (pesquisa, filtros, vistas Mês/Semana/Dia/Lista,
// hover com detalhes, CRUD de eventos e tipos); visual agora no RsShell com
// tema claro/escuro partilhado e tooltips no padrão do site (data-tip).
// Dados: tipos/eventos em D1 (API /api/calendar) + vencimentos (parcelas).
import React, { useState, useEffect, useMemo } from 'react';
import ModalClose from '../modal-close.jsx';
import { Link } from 'react-router-dom';
import { installments as installmentsApi, calendar as calendarApi } from '../apiClient';
import { IconUser, IconFolder, IconFilter, IconSearch } from '../icons';
import { admAlert, admConfirm } from '../dialogs';
import { SkeletonPage } from '../skeletons';
import { RsShell, Icon, Reveal, Seg } from '../rs/ui';

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const DAYS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const VIS_KEY = 'vyvian_cal_visibility';

// Aceita o que a Dra. escreve em português: "1.200,50", "1200,50", "1200.50".
// A versão anterior só trocava a primeira vírgula e deixava o ponto dos milhares,
// por isso "1.200,50" virava parseFloat("1.200.50") = 1.2 — mil vezes menos.
function parseValorPT(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const t = String(v ?? '').trim().replace(/\s/g, '');
  if (!t) return 0;
  // se tem vírgula, ela é o separador decimal e os pontos são de milhares
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = parseFloat(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(amount, currency = 'EUR', compact = false) {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const bruto = Number(amount);
  const n = Number.isFinite(bruto) ? bruto : 0;
  // compacto em português: "1,2 mil" e não "1.2k" (onde 1.200 se lê mil e duzentos)
  if (compact && n >= 1000) {
    return symbol + ' ' + (n / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' mil';
  }
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

// ── Estilos glass (scoped gcal-*) — agora nas variáveis do design system rs,
//    cientes do tema claro/escuro (.rs-scope[data-rs-theme]) ──
const GLASS_CSS = `
.rs-scope .gcal-glass {
  background: var(--panel);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--edge);
  border-radius: 16px;
}
.rs-scope .gcal-title { font-size: 1.45rem; font-weight: 600; letter-spacing: 0.01em; color: var(--fg); }
.rs-scope .gcal-sub { font-size: 0.82rem; color: var(--fg-3); }
.adm-root .rs-scope .gcal-btn {
  background: var(--panel); color: var(--fg-2); border: 1px solid var(--edge-2);
  border-radius: 10px; padding: 0.42rem 0.85rem; font-size: 0.82rem; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.adm-root .rs-scope .gcal-btn:hover { background: var(--panel-2); color: var(--fg); }
.adm-root .rs-scope .gcal-btn-gold {
  background: var(--grad-gold); color: #1a1208;
  border: none; font-weight: 700; box-shadow: 0 6px 18px rgba(184,147,90,0.35);
}
.adm-root .rs-scope .gcal-btn-gold:hover { filter: brightness(1.06); background: var(--grad-gold); color: #1a1208; }
/* minmax(0,1fr): sem isto o nowrap dos chips fixa o mínimo da coluna e a grelha
   transborda do painel em janelas estreitas (fundo creme a aparecer à direita) */
.rs-scope .gcal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.rs-scope .gcal-dh { text-align: center; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-3); padding: 0.35rem 0; }
.rs-scope .gcal-day {
  min-height: 96px; border-radius: 12px; padding: 0.4rem 0.45rem; cursor: pointer;
  background: var(--panel); border: 1px solid var(--edge);
  transition: background 0.15s, transform 0.12s, border-color 0.15s; position: relative;
}
.rs-scope .gcal-day:hover { background: var(--panel-2); border-color: var(--edge-2); }
.rs-scope .gcal-day.muted { opacity: 0.38; }
.rs-scope .gcal-day.today { border-color: rgba(213,177,124,0.75); box-shadow: inset 0 0 0 1px rgba(213,177,124,0.5); }
.rs-scope .gcal-day.sel { background: rgba(213,177,124,0.15); border-color: rgba(213,177,124,0.6); }
.rs-scope .gcal-daynum { font-size: 0.82rem; font-weight: 600; color: var(--fg-2); }
.rs-scope .gcal-day.today .gcal-daynum {
  display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--grad-gold); color: #1a1208;
}
.rs-scope .gcal-chip { position: relative; display: block; margin-top: 3px; }
.rs-scope .gcal-chip-label {
  display: block; font-size: 0.63rem; line-height: 1.3; padding: 0.1rem 0.35rem; border-radius: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); cursor: pointer;
  transition: transform 0.12s;
}
.rs-scope .gcal-chip:hover .gcal-chip-label { transform: scale(1.04); }
.rs-scope .gcal-pop {
  display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 80; width: 250px;
  max-width: 78vw;
  background: var(--panel-flat); border: 1px solid var(--edge-2); border-radius: 12px;
  padding: 0.7rem 0.8rem; box-shadow: var(--shadow); cursor: default; text-align: left;
}
.rs-scope .gcal-chip:hover .gcal-pop { display: block; }
/* popover não pode sair do painel: nas 2 últimas colunas alinha à direita,
   e com .up (últimas linhas da grelha) abre para cima */
.rs-scope .gcal-day:nth-child(7n) .gcal-pop, .rs-scope .gcal-day:nth-child(7n-1) .gcal-pop { left: auto; right: 0; }
.rs-scope .gcal-pop.up { top: auto; bottom: calc(100% + 4px); }
.rs-scope .gcal-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 2px; }
.rs-scope .gcal-amount { font-size: 0.66rem; font-weight: 700; color: var(--gold); margin-top: 2px; }
.rs-scope[data-rs-theme="dark"] .gcal-amount { color: var(--gold-soft); }
.rs-scope[data-rs-theme="dark"] .gcal-amount.late { color: #e0a294; }
.rs-scope[data-rs-theme="light"] .gcal-amount.late { color: var(--danger); }
.rs-scope .gcal-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.72rem; color: var(--fg-3); margin-top: 0.9rem; }
.rs-scope .gcal-legend span { display: inline-flex; align-items: center; gap: 5px; }
.adm-root .rs-scope .gcal-filterchip {
  display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 999px; padding: 0.26rem 0.75rem;
  font-size: 0.75rem; cursor: pointer; border: 1px solid var(--edge-2); background: var(--panel);
  color: var(--fg-2); transition: all 0.15s;
}
.adm-root .rs-scope .gcal-filterchip.off { opacity: 0.45; }
.rs-scope .gcal-row { border-radius: 12px; padding: 0.7rem 0.9rem; background: var(--panel); border: 1px solid var(--edge); transition: background 0.15s, transform 0.12s; }
.rs-scope .gcal-row:hover { background: var(--panel-2); transform: translateY(-1px); }
.rs-scope .gcal-modal-bg { position: fixed; inset: 0; background: rgba(6,16,13,0.6); backdrop-filter: blur(6px); display: flex; align-items: flex-start; justify-content: center; padding: 3rem 1rem; z-index: 1000; overflow-y: auto; animation: rsFadeIn .25s both; }
.rs-scope .gcal-modal {
  position: relative;
  background: var(--panel-flat);
  border: 1px solid var(--edge-2); border-radius: 18px; width: 100%; padding: 1.6rem;
  box-shadow: var(--shadow); color: var(--fg);
  animation: rsRiseInSm .3s var(--ease-out) both;
}
.adm-root .rs-scope .gcal-modal h2 { color: var(--fg); }
.rs-scope .gcal-modal label span { display: block; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-3); margin-bottom: 0.3rem; }
.adm-root .rs-scope .gcal-modal input, .adm-root .rs-scope .gcal-modal select, .adm-root .rs-scope .gcal-modal textarea {
  width: 100%; background: var(--panel); border: 1px solid var(--edge-2);
  border-radius: 9px; color: var(--fg); caret-color: var(--fg); padding: 0.5rem 0.7rem; font-size: 0.88rem; line-height: 1.5; font-family: 'Arial Unicode MS', Arial, 'Helvetica Neue', sans-serif;
}
.adm-root .rs-scope .gcal-modal input:focus, .adm-root .rs-scope .gcal-modal select:focus, .adm-root .rs-scope .gcal-modal textarea:focus { outline: none; border-color: rgba(213,177,124,0.6); }
.rs-scope .gcal-modal select option { background: var(--panel-flat); color: var(--fg); }
.adm-root .rs-scope .gcal-modal input[type="checkbox"] { width: auto; }
.adm-root .rs-scope .gcal-modal input[type="color"] { padding: 2px; height: 38px; }
.rs-scope .gcal-badge { display: inline-block; border-radius: 999px; padding: 0.1rem 0.55rem; font-size: 0.68rem; font-weight: 700; letter-spacing: .04em; }
.rs-scope .gcal-badge.paid { background: rgba(74,124,89,0.16); color: #2e6b46; border: 1px solid rgba(80,160,110,0.35); }
.rs-scope[data-rs-theme="dark"] .gcal-badge.paid { color: #9fd0ae; }
.rs-scope .gcal-badge.pending { background: rgba(200,150,86,0.16); color: var(--gold); border: 1px solid rgba(212,181,133,0.45); }
.rs-scope[data-rs-theme="dark"] .gcal-badge.pending { color: var(--gold-soft); }
.rs-scope .gcal-badge.late { background: rgba(160,75,60,0.16); color: var(--danger); border: 1px solid rgba(200,110,90,0.4); }
.rs-scope[data-rs-theme="dark"] .gcal-badge.late { color: #e0a294; }
.rs-scope .gcal-a { color: var(--gold); text-decoration: none; }
.rs-scope[data-rs-theme="dark"] .gcal-a { color: var(--gold-soft); }
.rs-scope .gcal-a:hover { text-decoration: underline; }
.rs-scope .gcal-del { color: var(--danger); text-decoration: none; }
.rs-scope[data-rs-theme="dark"] .gcal-del { color: #e0a294; }
@media (max-width: 760px) { .rs-scope .gcal-day { min-height: 70px; } .rs-scope .gcal-title { font-size: 1.15rem; } }
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

  const setAllTypes = (visible) => {
    const next = Object.fromEntries(types.map((t) => [t.id, visible]));
    setVisOverride(next);
    try { localStorage.setItem(VIS_KEY, JSON.stringify(next)); } catch {}
  };

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
    // dia 1 antes de mudar de mes: setMonth num dia 31 transborda (31/ago + 1 = 1/out)
    else { d.setDate(1); d.setMonth(d.getMonth() + dir); }
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
    if (!f.title.trim() || !f.start_date || !f.type_id) { admAlert('Título, tipo e data inicial são obrigatórios.'); return; }
    if (f.end_date && f.end_date < f.start_date) { admAlert('A data final não pode ser anterior à inicial.'); return; }
    setBusy(true);
    try {
      const payload = {
        title: f.title, description: f.description || null, type_id: f.type_id,
        start_date: f.start_date, end_date: f.end_date || null, is_all_day: !!f.is_all_day,
        amount: parseValorPT(f.amount), currency: f.currency,
        status: f.status, client_name: f.client_name || null, case_reference: f.case_reference || null,
      };
      if (evModal.mode === 'create') await calendarApi.createEvent(payload);
      else await calendarApi.updateEvent(evModal.id, payload);
      await loadCalendar();
      setEvModal(null);
    } catch (err) { admAlert('Erro: ' + err.message); }
    finally { setBusy(false); }
  };

  const deleteEvent = async (ev) => {
    if (!await admConfirm(`Apagar o evento "${ev.title}"?`)) return;
    try { await calendarApi.deleteEvent(ev.id); await loadCalendar(); }
    catch (err) { admAlert('Erro: ' + err.message); }
  };

  // ── CRUD tipos
  const saveType = async () => {
    if (!typeForm.label.trim()) { admAlert('A label é obrigatória.'); return; }
    setBusy(true);
    try {
      if (typeForm.mode === 'create') await calendarApi.createType({ label: typeForm.label, color: typeForm.color, description: typeForm.description });
      else await calendarApi.updateType(typeForm.id, { label: typeForm.label, color: typeForm.color, description: typeForm.description });
      await loadCalendar();
      setTypeForm(null);
    } catch (err) { admAlert('Erro: ' + err.message); }
    finally { setBusy(false); }
  };

  const confirmDeleteType = async (strategy) => {
    setBusy(true);
    try {
      await calendarApi.deleteType(typeDeleting.id, strategy);
      await loadCalendar();
      setTypeDeleting(null);
    } catch (err) { admAlert('Erro: ' + err.message); }
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

  if (loading) return <SkeletonPage kpis={0} rows={6} />;
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
  const EventChip = ({ ev, k, popUp }) => {
    const t = typeById[ev.type_id];
    const color = t?.color || '#888';
    const multi = ev.end_date && ev.end_date > ev.start_date;
    return (
      <span className="gcal-chip" onClick={(e) => { e.stopPropagation(); if (ev.source === 'manual') openEditEvent(ev); }}>
        <span className="gcal-chip-label" style={{ background: color + '55', borderLeft: `3px solid ${color}` }}>
          {multi && k && k !== ev.start_date ? '· ' : ''}{ev.title}
        </span>
        <span className={'gcal-pop' + (popUp ? ' up' : '')}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--fg)' }}>{ev.title}</strong>
            <span className="gcal-dot" style={{ background: color, width: 10, height: 10, flexShrink: 0, marginTop: 3 }} />
          </span>
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--fg-2)', marginTop: 3 }}>
            {t?.label || ev.type_id} · {fmtDateShort(ev.start_date)}{ev.end_date ? ` → ${fmtDateShort(ev.end_date)}` : ''}
          </span>
          {ev.description && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--fg-3)', marginTop: 5 }}>{ev.description.slice(0, 140)}{ev.description.length > 140 ? '…' : ''}</span>}
          {(ev.client_name || ev.case_reference || Number(ev.amount) > 0) && (
            <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 5, color: 'var(--fg-2)' }}>
              {ev.client_name && <><IconUser size={11} /> {ev.client_name}  </>}
              {ev.case_reference && <><IconFolder size={11} /> {ev.case_reference}  </>}
              {Number(ev.amount) > 0 && <strong className="gcal-a">{fmtMoney(ev.amount, ev.currency)}</strong>}
            </span>
          )}
          {ev.source === 'manual' && <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--gold)', marginTop: 6, opacity: 0.85 }}>clique para editar</span>}
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
    ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-3)' }}>Sem eventos no período.</div>
    : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => item.kind === 'event' ? (
          <div key={'e' + item.ev.id + i} className="gcal-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="gcal-dot" style={{ background: typeById[item.ev.type_id]?.color || '#888', width: 10, height: 10, marginTop: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: 'var(--fg)' }}>{item.ev.title}</strong>
              <span className="gcal-sub"> · {typeById[item.ev.type_id]?.label}</span>
              <div className="gcal-sub" style={{ marginTop: 2 }}>
                {fmtDate(item.ev.start_date)}{item.ev.end_date ? ` → ${fmtDate(item.ev.end_date)}` : ''}
                {item.ev.client_name ? <> · <IconUser size={11} /> {item.ev.client_name}</> : ''}
                {item.ev.case_reference ? <> · <IconFolder size={11} /> {item.ev.case_reference}</> : ''}
              </div>
              {item.ev.description && <div className="gcal-sub" style={{ marginTop: 2, fontSize: '0.76rem' }}>{item.ev.description.slice(0, 160)}{item.ev.description.length > 160 ? '…' : ''}</div>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {Number(item.ev.amount) > 0 && <div className="gcal-a" style={{ fontWeight: 700, fontSize: '0.85rem' }}>{fmtMoney(item.ev.amount, item.ev.currency)}</div>}
              {item.ev.status !== 'none' && <div style={{ marginTop: 3 }}><StatusBadge s={item.ev.status} /></div>}
              {item.ev.source === 'manual' && (
                <div style={{ fontSize: '0.72rem', marginTop: 5 }}>
                  <a href="#" className="gcal-a" onClick={(e) => { e.preventDefault(); openEditEvent(item.ev); }} style={{ marginRight: 8 }}>Editar</a>
                  <a href="#" className="gcal-del" onClick={(e) => { e.preventDefault(); deleteEvent(item.ev); }}>Apagar</a>
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
              <div className="gcal-a" style={{ fontWeight: 700, fontSize: '0.85rem' }}>{fmtMoney(item.inst.amount, item.inst.currency)}</div>
              <div style={{ marginTop: 3 }}><StatusBadge s={item.inst.status} /></div>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <RsShell overline="Área privada · Calendário" titulo="Calendário"
             sub="Agenda jurídica, prazos e vencimentos"
             right={<button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 4 }}
                            onClick={() => openCreateEvent(selectedKey)}>
                      <Icon name="plus" size={13} />Evento
                    </button>}>
      <style>{GLASS_CSS}</style>

      <div>
        {/* topo: título da vista + navegação + vistas + ações */}
        <Reveal>
          <div className="glass" style={{ padding: '16px 18px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
              <div>
                <div className="gcal-title">{viewTitle}</div>
                <div className="gcal-sub">{numVenc} vencimentos · {fmtMoney(totalEur)} previstos (EUR)</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="gcal-btn" onClick={() => navigate(-1)} data-tip="Período anterior" aria-label="Período anterior"><Icon name="chevL" size={13} /></button>
                <button className="gcal-btn" onClick={goToday}>Hoje</button>
                <button className="gcal-btn" onClick={() => navigate(1)} data-tip="Período seguinte" aria-label="Período seguinte"><Icon name="chevR" size={13} /></button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Seg small value={view}
                   onChange={(v) => { setView(v); setSelectedDate(null); }}
                   items={[{ k: 'month', label: 'MÊS' }, { k: 'week', label: 'SEMANA' }, { k: 'day', label: 'DIA' }, { k: 'list', label: 'LISTA' }, { k: 'next30', label: '30 DIAS' }]} />
              <button className="gcal-btn" onClick={() => setShowFilters((v) => !v)} data-tip="Mostrar ou ocultar tipos de data no calendário">
                <IconFilter size={12} /> Filtros{hiddenTypes.length > 0 ? ` (${activeTypes.length}/${types.length})` : ''}
              </button>
              <button className="gcal-btn" onClick={() => setTypeMgrOpen(true)} data-tip="Gerir os tipos de data (criar, editar, ocultar)">Tipos de data</button>
            </div>
          </div>
        </Reveal>

        {/* pesquisa */}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.9rem', display: 'flex', color: 'var(--fg-3)', pointerEvents: 'none' }}><IconSearch /></span>
          <input
            className="field"
            placeholder="Pesquisar eventos, clientes, processos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 34px 10px 38px', fontSize: 13.5 }}
          />
          {search && (
            <button onClick={() => setSearch('')} data-tip="Limpar pesquisa" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          )}
        </div>

        {/* painel de filtros */}
        {showFilters && (
          <div className="gcal-glass" style={{ marginTop: '0.8rem', padding: '0.8rem 0.9rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button className="gcal-filterchip" onClick={() => setAllTypes(true)} style={{ borderColor: 'rgba(213,177,124,0.6)', color: 'var(--gold)', fontWeight: 600 }}>
              ✓ Selecionar todos
            </button>
            <button className="gcal-filterchip" onClick={() => setAllTypes(false)} style={{ fontWeight: 600 }}>
              ✕ Desselecionar todos
            </button>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--edge-2)', margin: '0 2px' }} />
            {types.map((t) => {
              const on = isVisible(t);
              return (
                <button key={t.id} className={'gcal-filterchip' + (on ? '' : ' off')} onClick={() => toggleType(t.id)} data-tip={t.description || undefined}
                  style={on ? { borderColor: t.color, background: t.color + '2e' } : {}}>
                  <span className="gcal-dot" style={{ background: on ? t.color : 'var(--fg-3)' }} />
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
              <button key={t.id} className="gcal-filterchip off" onClick={() => toggleType(t.id)} data-tip="Clique para voltar a mostrar">
                <span className="gcal-dot" style={{ background: t.color }} />{t.label} ✕
              </button>
            ))}
            {hiddenTypes.length > 1 && (
              <button className="gcal-filterchip" onClick={() => setAllTypes(true)} style={{ borderColor: 'rgba(213,177,124,0.6)', color: 'var(--gold)', fontWeight: 600 }}>
                ✓ Mostrar todos
              </button>
            )}
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
                    {shown.map((ev) => <EventChip key={ev.id} ev={ev} k={k} popUp={idx >= grid.length - 14} />)}
                    {extra > 0 && <span style={{ display: 'block', fontSize: '0.62rem', color: 'rgba(244,239,230,0.5)', marginTop: 2 }}>+{extra} evento{extra > 1 ? 's' : ''}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── vista SEMANA ── */}
        {view === 'week' && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
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
                        <div key={i.id} className="gcal-a" style={{ fontSize: '0.63rem', fontWeight: 700 }}>
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
              <strong style={{ fontSize: '1.05rem', color: 'var(--fg)' }}>Dia {fmtDate(selectedKey)}</strong>
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
            <ModalClose onClose={() => setEvModal(null)} disabled={busy} />
            <h2 style={{ margin: '0 0 1.1rem', paddingRight: '2.5rem' }}>
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
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', textTransform: 'none', fontSize: '0.85rem', color: 'var(--fg-2)', marginBottom: '0.5rem' }}>
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
                  <button className="gcal-btn gcal-del" style={{ borderColor: 'rgba(200,110,90,0.5)' }} onClick={() => { const ev = events.find((x) => x.id === evModal.id); if (ev) deleteEvent(ev); setEvModal(null); }} disabled={busy}>Apagar</button>
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
            <ModalClose onClose={() => { setTypeMgrOpen(false); setTypeForm(null); setTypeDeleting(null); }} disabled={busy} />
            <h2 style={{ margin: '0 0 0.4rem', paddingRight: '2.5rem' }}>Tipos de data</h2>
            <p className="gcal-sub" style={{ margin: '0 0 1rem' }}>
              Ative/desative os tipos visíveis no calendário. Os tipos nativos não podem ser apagados; pode criar tipos personalizados.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: '0.6rem' }}>
              <button className="gcal-btn" onClick={() => setAllTypes(true)} style={{ fontSize: '0.75rem' }}>✓ Selecionar todos</button>
              <button className="gcal-btn" onClick={() => setAllTypes(false)} style={{ fontSize: '0.75rem' }}>✕ Desselecionar todos</button>
            </div>
            {types.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <input type="checkbox" checked={isVisible(t)} onChange={() => toggleType(t.id)} style={{ width: 'auto' }} />
                <span style={{ width: 12, height: 12, borderRadius: 3, background: t.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--fg)' }}>{t.label}</strong>
                  {!t.is_default && <span className="gcal-sub" style={{ marginLeft: 6, fontSize: '0.7rem' }}>personalizado</span>}
                  {t.description && <div className="gcal-sub" style={{ fontSize: '0.74rem' }}>{t.description}</div>}
                </div>
                {!t.is_default && (
                  <div style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    <a href="#" className="gcal-a" onClick={(e) => { e.preventDefault(); setTypeForm({ mode: 'edit', id: t.id, label: t.label, color: t.color, description: t.description || '' }); setTypeDeleting(null); }} style={{ marginRight: 8 }}>Editar</a>
                    <a href="#" className="gcal-del" onClick={(e) => { e.preventDefault(); setTypeDeleting(t); setTypeForm(null); }}>Apagar</a>
                  </div>
                )}
              </div>
            ))}

            {typeDeleting && (
              <div style={{ background: 'rgba(160,75,60,0.1)', border: '1px solid rgba(200,110,90,0.4)', borderRadius: 12, padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--fg)' }}>Apagar o tipo "{typeDeleting.label}" — o que fazer aos eventos deste tipo?</div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button className="gcal-btn gcal-del" onClick={() => confirmDeleteType('delete')} disabled={busy}>Apagar eventos também</button>
                  <button className="gcal-btn" onClick={() => confirmDeleteType('move')} disabled={busy}>Mover para "Eventos pessoais"</button>
                  <button className="gcal-btn" onClick={() => setTypeDeleting(null)} disabled={busy}>Cancelar</button>
                </div>
              </div>
            )}

            {typeForm ? (
              <div className="gcal-glass" style={{ padding: '0.9rem 1rem', marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.6rem', color: 'var(--fg)' }}>{typeForm.mode === 'create' ? 'Novo tipo de data' : `Editar "${typeForm.label}"`}</div>
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
    </RsShell>
  );
}
