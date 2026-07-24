// src/admin/tabs.jsx
// SlidingTabs — tabs com indicador que desliza suavemente até à ativa.
// variant "underline": barra dourada por baixo (tabs do cadastro / ficha do cliente)
// variant "pills":     pílula de fundo que desliza atrás do botão ativo (chips de estado)
// items: [{ id, label, danger? }] — label pode ser texto ou nó React.
import React, { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react';

export default function SlidingTabs({ items, active, onChange, variant = 'underline', className = '', style }) {
  const wrapRef = useRef(null);
  const [ind, setInd] = useState(null);
  const activeItem = items.find((i) => i.id === active);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const el = wrap.querySelector('[data-tab-active="1"]');
    if (el) setInd({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  }, []);

  useLayoutEffect(measure, [active, items.length, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <div ref={wrapRef} className={`adm-stabs adm-stabs-${variant} ${className}`.trim()} style={style}>
      {ind && (
        <span
          className={'adm-stabs-ind' + (activeItem?.danger ? ' danger' : '')}
          style={variant === 'underline'
            ? { left: ind.left, width: ind.width }
            : { left: ind.left, top: ind.top, width: ind.width, height: ind.height }}
        />
      )}
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          data-tab-active={active === t.id ? '1' : undefined}
          className={'adm-stab' + (active === t.id ? ' active' : '') + (t.danger ? ' danger' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
