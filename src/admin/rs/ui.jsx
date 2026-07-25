// src/admin/rs/ui.jsx
// Primitivas de UI do redesign «Redes Sociais» (handoff Claude Design, jul 2026).
// Portadas de prototypes/redes-sociais/rs-ui.jsx — React puro, sem dependências.
// Keyframes renomeados com prefixo rs (ver rs-theme.css).
import React, { useState, useEffect, useRef } from 'react';

/* ---------------- ícones ---------------- */
const RS_ICONS = {
  instagram: 'M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z|M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4Z|M17.2 7.1h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M3.6 9h16.8|M3.6 15h16.8|M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3Z',
  spark: 'M12 3l1.6 4.7L18.5 9l-4.9 1.3L12 15l-1.6-4.7L5.5 9l4.9-1.3L12 3Z|M18 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2',
  library: 'M4 20V6.5A2.5 2.5 0 0 1 6.5 4H19v16|M4 20h15|M8 8h7|M8 12h7|M8 16h4',
  users: 'M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19|M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z|M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4',
  heart: 'M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z',
  comment: 'M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20.5l1.4-4.4A7.5 7.5 0 1 1 20 12.5Z',
  ext: 'M14 4h6v6|M20 4l-8.5 8.5|M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9|M20 4v5h-5',
  back: 'M10 5l-7 7 7 7|M3 12h17',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  save: 'M5 4h11l3 3v13H5V4Z|M8 4v6h8V4|M8 15h8',
  plus: 'M12 5v14|M5 12h14',
  edit: 'M4 20h4L20 8l-4-4L4 16v4Z|M14 6l4 4',
  trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  check: 'M4 12.5l5 5L20 6.5',
  chev: 'M9 6l6 6-6 6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z|M12 2v2|M12 20v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M2 12h2|M20 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z',
  close: 'M6 6l12 12|M18 6L6 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 7.5V12l3 2',
  image: 'M3 5h18v14H3V5Z|M3 15.5l4.5-4.5 4 4 3-3L21 16|M8.5 9.5h.01',
  link: 'M10.5 13.5a4 4 0 0 0 5.6 0l2.3-2.3a4 4 0 0 0-5.6-5.6l-.9.9|M13.5 10.5a4 4 0 0 0-5.6 0l-2.3 2.3a4 4 0 0 0 5.6 5.6l.9-.9',
  filter: 'M4 6h16|M7 12h10|M10 18h4',
  trend: 'M4 16l5-5 3.5 3.5L20 7|M20 12V7h-5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z|M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  gov: 'M4 20h16|M6 20V10l6-4 6 4v10|M10 20v-5h4v5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 11v5|M12 7.8h.01',
  expand: 'M9 4H4v5|M15 4h5v5|M9 20H4v-5|M15 20h5v-5',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
};
export function Icon({ name, size = 18, s = 1.6, style, cls }) {
  const d = RS_ICONS[name];
  if (!d) return null;
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={s} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ---------------- número a contar (1200 ms, easeOutQuart, dispara ao entrar no ecrã) ---------------- */
export function Ticker({ value, dur = 1200, dec = 0, prefix = '', suffix = '' }) {
  const [v, setV] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    let raf, t0, done = false;
    const run = () => {
      const step = (t) => {
        if (!t0) t0 = t;
        const p = Math.min(1, (t - t0) / dur);
        setV(value * (1 - Math.pow(1 - p, 4)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const go = () => { if (!done) { done = true; run(); } };
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) go(); }, { threshold: .3 });
    if (ref.current) io.observe(ref.current);
    const fb = setTimeout(go, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(fb); io.disconnect(); };
  }, [value, dur]);
  const n = dec ? v.toFixed(dec) : String(Math.round(v));
  const out = !dec ? Number(n).toLocaleString('pt-PT') : n.replace('.', ',');
  return <span ref={ref} className="mono">{prefix}{out}{suffix}</span>;
}

/* ---------------- revelar em cascata (IntersectionObserver a 12%) ---------------- */
export function Reveal({ children, d = 0, y = 14, cls = '', style, tag = 'div', ...rest }) {
  const ref = useRef(null); const [on, setOn] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: .12 });
    if (ref.current) io.observe(ref.current);
    const fb = setTimeout(() => setOn(true), 700);
    return () => { clearTimeout(fb); io.disconnect(); };
  }, []);
  const T = tag;
  return (
    <T ref={ref} className={cls}
       style={{ opacity: on ? 1 : 0, transform: on ? 'none' : `translateY(${y}px)`,
                transition: `opacity .6s var(--ease-out) ${d}ms, transform .6s var(--ease-out) ${d}ms`, ...style }}
       {...rest}>
      {children}
    </T>
  );
}

/* ---------------- tooltip ---------------- */
export function Tip({ label, children, w = 230 }) {
  const [on, setOn] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
          onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}
          onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
      {children}
      <span role="tooltip" style={{
        position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%', width: w,
        transform: `translateX(-50%) translateY(${on ? 0 : 5}px) scale(${on ? 1 : .96})`,
        opacity: on ? 1 : 0, pointerEvents: 'none', transition: 'all .22s var(--ease-out)',
        background: 'var(--panel-flat)', border: '1px solid var(--edge-2)', borderRadius: 12,
        padding: '10px 13px', fontSize: 12, lineHeight: 1.5, color: 'var(--fg-2)',
        boxShadow: 'var(--shadow)', zIndex: 60, textTransform: 'none', letterSpacing: 0, fontWeight: 400,
      }}>{label}</span>
    </span>
  );
}

/* ---------------- abas tubelight ---------------- */
export function Tabs({ items, value, onChange }) {
  const wrap = useRef(null); const [pill, setPill] = useState({ left: 5, width: 0 });
  useEffect(() => {
    const el = wrap.current && wrap.current.querySelector(`[data-k="${value}"]`);
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, items]);
  return (
    <div className="tabs" ref={wrap} role="tablist">
      <span className="tab-pill" style={{ left: pill.left, width: pill.width }} />
      {items.map((it) => (
        <button key={it.k} data-k={it.k} type="button" role="tab" aria-selected={value === it.k}
                className={'tab' + (value === it.k ? ' on' : '')} onClick={() => onChange(it.k)}>
          <Icon name={it.icon} size={15} />{it.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- segmentado ---------------- */
export function Seg({ items, value, onChange, small }) {
  return (
    <div className="seg">
      {items.map((i) => (
        <button key={i.k} type="button" className={value === i.k ? 'on' : ''}
                style={small ? { padding: '6px 11px', fontSize: 11 } : null}
                onClick={() => onChange(i.k)}>{i.label}</button>
      ))}
    </div>
  );
}

/* ---------------- partículas douradas no header ---------------- */
const RS_SPK = [[6, 22, 0], [15, 68, .7], [28, 12, 1.4], [42, 80, 2.1], [57, 30, .35], [70, 62, 1.75], [82, 18, 2.5], [92, 72, 1.1], [36, 44, 3.1], [64, 8, .9]];
export function Sparkles() {
  return <>{RS_SPK.map(([l, t, d], i) => (
    <svg key={i} className="spk" width={i % 3 ? 9 : 13} height={i % 3 ? 9 : 13} viewBox="0 0 24 24" fill="currentColor"
         style={{ left: l + '%', top: t + '%', animation: `rsSparkle ${2.6 + (i % 4) * .5}s var(--ease-in-out) ${d}s infinite`, opacity: 0 }}>
      <path d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4L12 0Z" />
    </svg>
  ))}</>;
}

/* ---------------- medição do contentor ---------------- */
export function useMeasure() {
  const ref = useRef(null); const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(ref.current); setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* escala com folga mínima — séries curtas e planas nunca colam ao eixo */
function rsBounds(series, ks) {
  const vals = []; series.forEach((s) => ks.forEach((k) => vals.push(s[k.k])));
  let min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min, pad = span < max * .08 ? Math.max(2, max * .05) : span * .3;
  min = Math.max(0, min - pad); max = max + pad * .6;
  return { min, max };
}
function rsScale(series, ks, h, pt, pb) {
  const { min, max } = rsBounds(series, ks);
  return (v) => pt + (1 - (v - min) / (max - min || 1)) * (h - pt - pb);
}
/* curva monotone-ish */
function rsPath(pts) {
  return pts.map((p, i) => {
    if (!i) return `M${p[0]},${p[1]}`;
    const q = pts[i - 1], cx = (q[0] + p[0]) / 2;
    return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
  }).join(' ');
}

/* ---------------- gráfico grande (padrão bklitai/area-chart: grid horizontal, fadeEdges, tooltip de linhas) ---------------- */
export function Chart({ series, keys, h = 200, id = 'c', unit = '', flatNote, accent = '#d4b585', xLabel, yLabel }) {
  const ks = keys || [{ k: 'v', label: '', color: accent }];
  const [ref, W] = useMeasure();
  const [hi, setHi] = useState(null);
  const PT = 16, PB = 8;
  if (!series || series.length < 2) {
    return flatNote
      ? <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, color: 'var(--fg-3)', padding: '18px 0' }}><Icon name="info" size={13} />{flatNote}</div>
      : null;
  }
  const bounds = rsBounds(series, ks);
  const fmtTick = (v) => {
    const n = Math.round(v);
    return n >= 10000 ? (n / 1000).toFixed(1).replace('.', ',') + ' mil' : n.toLocaleString('pt-PT');
  };
  const y = rsScale(series, ks, h, PT, PB);
  const x = (i) => (i / Math.max(1, series.length - 1)) * W;
  const geo = ks.map((k) => {
    const pts = series.map((s, i) => [x(i), y(s[k.k])]);
    return { k, pts, line: rsPath(pts), area: rsPath(pts) + ` L${W},${h} L0,${h} Z` };
  });
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
    setHi(Math.max(0, Math.min(series.length - 1, i)));
  };
  const ticks = series.filter((_, i) => series.length <= 10 || i % Math.ceil(series.length / 7) === 0 || i === series.length - 1);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {ks.length > 1 && (
        <div style={{ position: 'absolute', top: -6, right: 0, display: 'flex', gap: 15, zIndex: 3 }}>
          {ks.map((k) => (
            <span key={k.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-2)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 9, background: k.color }} />{k.label}
            </span>
          ))}
        </div>
      )}
      <svg width={W || '100%'} height={h} style={{ display: 'block', overflow: 'visible' }} onMouseMove={move} onMouseLeave={() => setHi(null)}>
        <defs>
          {geo.map((g) => (
            <linearGradient key={g.k.k} id={id + g.k.k + 'f'} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={g.k.color} stopOpacity=".30" /><stop offset="100%" stopColor={g.k.color} stopOpacity=".02" />
            </linearGradient>
          ))}
          <linearGradient id={id + 'edge'} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" /><stop offset="7%" stopColor="#fff" stopOpacity="1" />
            <stop offset="93%" stopColor="#fff" stopOpacity="1" /><stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={id + 'em'}><rect x="0" y="0" width={W} height={h} fill={'url(#' + id + 'edge)'} /></mask>
          <filter id={id + 'ds'} x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,.55)" /></filter>
        </defs>
        {[0, .5, 1].map((f) => (
          <g key={f}>
            <line x1="0" x2={W} y1={PT + f * (h - PT - PB)} y2={PT + f * (h - PT - PB)}
                  stroke="var(--edge)" strokeWidth="1" strokeDasharray={f ? '3 7' : ''} />
            {/* rótulo do eixo Y sobre cada linha-guia */}
            <text x="0" y={PT + f * (h - PT - PB) - 5} fontSize="9.5" fill="var(--fg-3)"
                  style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '.04em' }}>
              {fmtTick(bounds.max - f * (bounds.max - bounds.min))}
            </text>
          </g>
        ))}
        <g mask={'url(#' + id + 'em)'}>
          {geo.map((g) => <path key={g.k.k} d={g.area} fill={'url(#' + id + g.k.k + 'f)'} style={{ animation: 'rsFadeIn 1.1s .35s var(--ease-out) both' }} />)}
        </g>
        {geo.map((g, gi) => (
          <path key={g.k.k} d={g.line} fill="none" stroke={g.k.color} strokeWidth="2" strokeLinecap="round"
                pathLength="1" strokeDasharray="1" strokeDashoffset="1"
                style={{ animation: `rsDrawLine 1.5s ${gi * .18}s var(--ease-out) forwards` }} />
        ))}
        {series.length <= 12 && geo.map((g) => g.pts.map((p, i) => (
          <circle key={g.k.k + i} cx={p[0]} cy={p[1]} r="3.2" fill={g.k.color} stroke="var(--bg-2)" strokeWidth="2"
                  style={{ animation: `rsScaleIn .4s ${.9 + i * .05}s var(--ease-spring) both`, transformOrigin: `${p[0]}px ${p[1]}px` }} />
        )))}
        {hi != null && <>
          <line x1={x(hi)} x2={x(hi)} y1={PT} y2={h - PB} stroke={ks[0].color} strokeWidth="1" strokeDasharray="2 2" opacity=".7" />
          {geo.map((g) => <circle key={g.k.k} cx={g.pts[hi][0]} cy={g.pts[hi][1]} r="6" fill={g.k.color} stroke="#fff" strokeWidth="2" filter={'url(#' + id + 'ds)'} />)}
        </>}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--fg-3)', letterSpacing: '.06em', marginTop: 8 }}>
        {ticks.map((s, i) => <span key={i}>{s.d}</span>)}
      </div>
      {(xLabel || yLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 9, fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
          {xLabel && <span>Eixo X · {xLabel}</span>}
          {yLabel && <span>Eixo Y · {yLabel}</span>}
        </div>
      )}
      {hi != null && (
        <div style={{ position: 'absolute', left: x(hi), top: 0,
                      transform: `translate(${hi > series.length - 3 ? '-92%' : hi < 2 ? '-8%' : '-50%'},-56%)`,
                      pointerEvents: 'none', background: 'var(--panel-flat)', border: '1px solid var(--edge-2)',
                      borderRadius: 11, padding: '9px 12px', boxShadow: 'var(--shadow)', whiteSpace: 'nowrap',
                      zIndex: 5, backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>{series[hi].d}</div>
          <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
            {ks.map((k) => (
              <div key={k.k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 9, background: k.color, flex: 'none' }} />
                {k.label && <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{k.label}</span>}
                <span className="num" style={{ fontSize: 15, marginLeft: 'auto', paddingLeft: 10, color: 'var(--fg)' }}>
                  {Number(series[hi][k.k] || 0).toLocaleString('pt-PT')}{unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {flatNote && (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5, color: 'var(--fg-3)', marginTop: 14 }}>
          <Icon name="info" size={13} />{flatNote}
        </div>
      )}
    </div>
  );
}

/* ---------------- sparkline do cartão KPI (padrão sean0205/area-charts-1) ---------------- */
export function Spark({ series, accent = '#b8935a', id = 's', h = 60, fmt }) {
  const [ref, W] = useMeasure();
  const [hi, setHi] = useState(null);
  const P = 5, ks = [{ k: 'v' }];
  if (!series || series.length < 2) return <div style={{ height: h }} />;
  const y = rsScale(series, ks, h, P, P);
  const x = (i) => P + (i / Math.max(1, series.length - 1)) * (W - P * 2);
  const pts = series.map((s, i) => [x(i), y(s.v)]);
  const line = rsPath(pts);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - P) / (r.width - P * 2)) * (series.length - 1));
    setHi(Math.max(0, Math.min(series.length - 1, i)));
  };
  return (
    <div ref={ref} style={{ position: 'relative', height: h }}>
      <svg width={W || '100%'} height={h} style={{ display: 'block', overflow: 'visible' }} onMouseMove={move} onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id={id + 'g'} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity=".30" /><stop offset="100%" stopColor={accent} stopOpacity=".05" />
          </linearGradient>
          <filter id={id + 'd'} x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="1" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,.5)" /></filter>
        </defs>
        <path d={line + ` L${x(series.length - 1)},${h} L${x(0)},${h} Z`} fill={'url(#' + id + 'g)'} style={{ animation: 'rsFadeIn .9s .4s var(--ease-out) both' }} />
        <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset="1"
              style={{ animation: 'rsDrawLine 1.3s .15s var(--ease-out) forwards' }} />
        {hi != null && <>
          <line x1={x(hi)} x2={x(hi)} y1={0} y2={h} stroke={accent} strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={pts[hi][0]} cy={pts[hi][1]} r="6" fill={accent} stroke="#fff" strokeWidth="2" filter={'url(#' + id + 'd)'} />
        </>}
      </svg>
      {hi != null && (
        <div style={{ position: 'absolute', left: pts[hi][0], bottom: h - pts[hi][1] + 12,
                      transform: `translateX(${hi > series.length - 3 ? '-88%' : hi < 2 ? '-12%' : '-50%'})`,
                      pointerEvents: 'none', background: 'var(--panel-flat)', border: '1px solid var(--edge)',
                      borderRadius: 9, padding: '5px 9px', boxShadow: 'var(--shadow)', backdropFilter: 'blur(8px)',
                      whiteSpace: 'nowrap', zIndex: 6 }}>
          <span className="num" style={{ fontSize: 13.5, color: 'var(--fg)' }}>
            {fmt ? fmt(series[hi].v) : Number(series[hi].v || 0).toLocaleString('pt-PT')}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------- loader narrado (3 momentos lentos) ----------------
   Em produção os passos avançam por tempo estimado (prop per) mas o ÚLTIMO
   passo fica em loop até `open` passar a false — a chamada real à API é que manda.
   `error` mostra o passo ativo a vermelho com «Tentar novamente». */
export function StepLoader({ open, steps, per = 15000, title, error, onRetry, onCancel }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) { setI(0); return; }
    let k = 0;
    const t = setInterval(() => {
      k = Math.min(k + 1, steps.length - 1); // o último passo espera pela resposta real
      setI(k);
    }, per);
    return () => clearInterval(t);
  }, [open, per, steps.length]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center',
                  background: 'rgba(4,12,10,.72)', backdropFilter: 'blur(14px)', animation: 'rsFadeIn .3s both', padding: 20 }}>
      <div className="glass" style={{ width: 'min(520px,100%)', padding: '34px 32px', animation: 'rsScaleIn .45s var(--ease-spring) both' }}>
        <div className="beam" style={{ opacity: .8 }}><span /></div><div className="beam-mask" style={{ opacity: .97 }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--grad-gold-soft)', border: '1px solid var(--edge-2)',
                           display: 'grid', placeItems: 'center', color: 'var(--gold-soft)', animation: 'rsFloatY 2.6s var(--ease-in-out) infinite' }}>
              <Icon name="spark" size={17} />
            </span>
            <div>
              <span className="overline">Inteligência editorial</span>
              <div style={{ fontSize: 14.5, marginTop: 3 }}>{title}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 3 }}>
            {steps.map((s, k) => {
              const st = k < i ? 'done' : k === i ? 'now' : 'wait';
              const isErr = error && st === 'now';
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12,
                                      background: st === 'now' ? (isErr ? 'rgba(160,69,69,.14)' : 'rgba(184,147,90,.12)') : 'transparent',
                                      transition: 'background .4s', opacity: st === 'wait' ? .38 : 1 }}>
                  <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center',
                                 border: '1.5px solid ' + (isErr ? 'var(--danger)' : st === 'wait' ? 'var(--edge-2)' : 'var(--gold-soft)'),
                                 background: st === 'done' ? 'var(--grad-gold)' : 'transparent',
                                 color: st === 'done' ? '#1a1208' : isErr ? 'var(--danger)' : 'var(--gold-soft)',
                                 animation: st === 'now' && !isErr ? 'rsPulseGold 1.6s infinite' : 'none' }}>
                    {st === 'done' ? <Icon name="check" size={11} s={3} />
                      : st === 'now' ? <span style={{ width: 6, height: 6, borderRadius: 9, background: isErr ? 'var(--danger)' : 'var(--gold-soft)' }} /> : null}
                  </span>
                  <span style={{ fontSize: 13.5, color: isErr ? '#e39b9b' : st === 'now' ? 'var(--fg)' : 'var(--fg-2)' }}>{s}</span>
                  {st === 'now' && !isErr && (
                    <span style={{ marginLeft: 'auto', width: 46, height: 3, borderRadius: 9, overflow: 'hidden', background: 'var(--edge)' }}>
                      <span className="shimmer" style={{ display: 'block', height: '100%' }} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {error ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12.5, color: '#e39b9b', lineHeight: 1.5 }}>{error}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {onRetry && <button type="button" className="btn btn-gold btn-sm" onClick={onRetry}><Icon name="refresh" size={13} />Tentar novamente</button>}
                {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Fechar</button>}
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginTop: 20, height: 3, borderRadius: 9, background: 'var(--edge)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${((i + .5) / steps.length) * 100}%`, background: 'var(--grad-gold)', transition: 'width .6s var(--ease-out)' }} />
              </div>
              <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 7, alignItems: 'center' }}>
                <Icon name="clock" size={12} />Pode fechar o portátil — o processo continua no servidor.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- confetti dourado (90 partículas, gravidade .3, ~1,4 s) ---------------- */
export function Confetti({ fire }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!fire || !ref.current) return;
    const c = ref.current, ctx = c.getContext('2d');
    c.width = c.offsetWidth; c.height = c.offsetHeight;
    const cols = ['#d4b585', '#b8935a', '#f0dcb8', '#8e6f3f'];
    const ps = Array.from({ length: 90 }, () => ({
      x: c.width / 2, y: c.height * .34, vx: (Math.random() - .5) * 13, vy: Math.random() * -11 - 3,
      s: 2 + Math.random() * 4, c: cols[(Math.random() * 4) | 0], r: Math.random() * 6, vr: (Math.random() - .5) * .3, a: 1,
    }));
    let raf;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = 0;
      ps.forEach((p) => {
        p.vy += .3; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.a -= .012;
        if (p.a > 0) {
          alive++; ctx.save(); ctx.globalAlpha = Math.max(0, p.a); ctx.translate(p.x, p.y); ctx.rotate(p.r);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 2.4); ctx.restore();
        }
      });
      if (alive) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [fire]);
  if (!fire) return null;
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none', width: '100%', height: '100%' }} />;
}

/* ---------------- cartão com tilt 3D ---------------- */
export function Tilt({ children, max = 8, cls = '', style, ...rest }) {
  const ref = useRef(null);
  const move = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
    el.style.transform = `perspective(760px) rotateY(${px * max * 2}deg) rotateX(${-py * max * 2}deg) translateY(-5px) scale(1.02)`;
    el.style.setProperty('--gx', `${(px + .5) * 100}%`); el.style.setProperty('--gy', `${(py + .5) * 100}%`);
  };
  const out = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <div ref={ref} className={cls} onMouseMove={move} onMouseLeave={out}
         style={{ transition: 'transform .45s var(--ease-out)', willChange: 'transform', ...style }} {...rest}>
      {children}
    </div>
  );
}

/* ---------------- miniatura com gradiente da marca (fallback sem imagem) ---------------- */
const RS_THUMB = [
  'linear-gradient(150deg,#1c4138,#0a1c18 62%,#2a3f38)',
  'linear-gradient(150deg,#3a3226,#12302a 68%)',
  'linear-gradient(150deg,#2d3b34,#8e6f3f 130%)',
  'linear-gradient(150deg,#13332c,#4a5a4e 120%)',
  'linear-gradient(150deg,#2a2520,#1c4138 78%)',
];
export function Thumb({ hue = 0, src, dim = .30, children, style }) {
  return (
    <div style={{ position: 'relative', background: RS_THUMB[hue % 5], overflow: 'hidden', ...style }}>
      {src && <img src={src} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(.86) contrast(1.04)' }} />}
      <span style={{ position: 'absolute', inset: 0, background: src
        ? `linear-gradient(155deg,rgba(18,48,42,${dim}),rgba(10,28,24,.14) 60%,rgba(184,147,90,.14))`
        : 'radial-gradient(120% 90% at var(--gx,30%) var(--gy,20%),rgba(212,181,133,.30),transparent 62%)' }} />
      {!src && <>
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 34, height: 44, border: '1.4px solid rgba(212,181,133,.42)', borderTop: 0, borderBottom: 0 }} />
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 46, height: 2, background: 'rgba(212,181,133,.42)' }} />
      </>}
      {children}
    </div>
  );
}

/* ---------------- barra de nível (fiabilidade / engajamento) ----------------
   `onChange` torna a barra editável: clicar define o nível 1..max pela posição. */
export function Level({ n, max = 5, label, onChange }) {
  const click = (e) => {
    if (!onChange) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.max(1, Math.min(max, Math.ceil(((e.clientX - r.left) / r.width) * max)));
    onChange(v);
  };
  return (
    <Tip label={label + (onChange ? ' Clique na barra para alterar.' : '')} w={210}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: onChange ? 'pointer' : 'help' }}>
        <span className="bar" onClick={click} role={onChange ? 'slider' : undefined}
              aria-valuemin={onChange ? 1 : undefined} aria-valuemax={onChange ? max : undefined} aria-valuenow={onChange ? n : undefined}
              style={onChange ? { cursor: 'pointer' } : null}>
          <i style={{ width: `${(n / max) * 100}%` }} />
        </span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{n}/{max}</span>
      </span>
    </Tip>
  );
}

/* ---------------- cabeçalho de painel ---------------- */
export function PanelHead({ over, title, right, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
      <div>
        <span className="overline">{over}</span>
        <h3 style={{ fontSize: 22, marginTop: 7 }}>{title}</h3>
        {note && <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginTop: 6 }}>{note}</div>}
      </div>
      {right}
    </div>
  );
}
