// src/admin/dropdown.jsx
// SelectMenu — substituto estilizado do <select> nativo (padrão 21st/Origin UI).
// Chevron que roda, menu com sombra e check dourado na opção ativa.
// options: [{ value, label }]. onChange recebe o VALUE (não o evento).
import React, { useState, useRef, useEffect } from 'react';

export default function SelectMenu({ value, onChange, options, style, tip, tipPos, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const cur = options.find((o) => String(o.value) === String(value));

  return (
    <div className="adm-select" ref={ref} style={style}>
      <button
        type="button"
        className={'adm-select-btn' + (open ? ' open' : '')}
        data-tip={tip}
        data-tip-pos={tipPos}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{cur ? cur.label : '—'}</span>
        <svg className="adm-select-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="adm-select-menu" role="listbox">
          {options.map((o) => {
            const sel = String(o.value) === String(value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={sel}
                className={'adm-select-opt' + (sel ? ' sel' : '')}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {sel && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
