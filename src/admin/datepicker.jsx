// src/admin/datepicker.jsx
// DateInput — substituto do <input type="date"> nativo com calendário
// no padrão do site (verde-floresta/dourado). API compatível:
//   <DateInput value="2026-07-14" onChange={(e) => ... e.target.value ...} />
// value em ISO (YYYY-MM-DD); onChange recebe um evento sintético { target: { value } }.
import React, { useState, useRef, useEffect } from 'react';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']; // semana a começar à segunda

const pad = (n) => String(n).padStart(2, '0');
const toISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function fmtShow(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function DateInput({ value, onChange, disabled, id, style, placeholder = 'dd/mm/aaaa', clearable = true }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: 2026, m: 0 });
  const [pos, setPos] = useState(null); // posição fixed do popover (escapa contentores com scroll)
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // fecha se algum contentor fizer scroll (o popover é fixed e ficaria "solto")
    const onScroll = (e) => { if (ref.current && ref.current.contains(e.target)) return; setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  const POP_W = 258;
  const POP_H = 336; // estimativa para decidir se abre para cima

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      const base = value ? new Date(value + 'T00:00:00') : today;
      setView({ y: base.getFullYear(), m: base.getMonth() });
      // popover em position:fixed — funciona dentro de blocos com scroll interno
      const r = ref.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
      const abre_cima = r.bottom + POP_H + 8 > window.innerHeight && r.top - POP_H - 8 > 0;
      setPos(abre_cima ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };

  const pick = (d) => { onChange({ target: { value: toISO(view.y, view.m, d) } }); setOpen(false); };
  const nav = (deltaM, deltaY = 0) => setView((v) => {
    const dt = new Date(v.y, v.m + deltaM, 1);
    return { y: dt.getFullYear() + deltaY, m: dt.getMonth() };
  });

  // grelha do mês em vista
  const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // seg = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const NavBtn = ({ onClick, label, children }) => (
    <button type="button" className="adm-date-nav" onClick={onClick} aria-label={label}>{children}</button>
  );

  return (
    <div className="adm-date" ref={ref} style={style}>
      <button
        type="button"
        id={id}
        className={'adm-date-btn' + (open ? ' open' : '') + (!value ? ' empty' : '')}
        onClick={toggle}
        disabled={disabled}
      >
        <span>{value ? fmtShow(value) : placeholder}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      {open && (
        <div className="adm-date-pop" style={pos || undefined}>
          <div className="adm-date-head">
            <span>
              <NavBtn onClick={() => nav(0, -1)} label="Ano anterior">«</NavBtn>
              <NavBtn onClick={() => nav(-1)} label="Mês anterior">‹</NavBtn>
            </span>
            <span className="adm-date-title">{MONTHS[view.m]} {view.y}</span>
            <span>
              <NavBtn onClick={() => nav(1)} label="Mês seguinte">›</NavBtn>
              <NavBtn onClick={() => nav(0, 1)} label="Ano seguinte">»</NavBtn>
            </span>
          </div>
          <div className="adm-date-grid adm-date-wk">
            {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="adm-date-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={'x' + i} />;
              const iso = toISO(view.y, view.m, d);
              return (
                <button
                  key={iso}
                  type="button"
                  className={'adm-date-day' + (iso === value ? ' sel' : '') + (iso === todayISO ? ' today' : '')}
                  onClick={() => pick(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="adm-date-foot">
            <button type="button" onClick={() => { onChange({ target: { value: todayISO } }); setOpen(false); }}>Hoje</button>
            {clearable && value && (
              <button type="button" onClick={() => { onChange({ target: { value: '' } }); setOpen(false); }}>Limpar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
