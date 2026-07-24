// src/admin/numbers.jsx
// CountUp — número que "conta" até ao valor (ease-out), usado nos KPIs do painel.
// <CountUp value={1234} format={(v) => fmtMoney(v)} />
import React, { useEffect, useRef, useState } from 'react';

export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('pt-PT'), duration = 850 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(0);        // primeira montagem anima a partir de 0
  const rafRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const from = mountedRef.current ? fromRef.current : 0;
    mountedRef.current = true;
    if (from === target) { setShown(target); fromRef.current = target; return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      const cur = from + (target - from) * eased;
      setShown(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return <>{format(shown)}</>;
}
