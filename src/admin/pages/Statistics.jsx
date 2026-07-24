// src/admin/pages/Statistics.jsx
// Estatísticas das Redes Sociais — Área Privada.
// Duas secções (abas): "Instagram" (Fase B — em breve) e "Site" (Fase A — acessos, no ar).
import React, { useEffect, useRef, useState } from 'react';
import { stats as statsApi } from '../apiClient';
import { CountUp } from '../numbers';
import SlidingTabs from '../tabs';
import { IconInstagram } from '../icons';

const SECTIONS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'site', label: 'Site' },
];

const RANGES = [
  { id: '1d', label: '1 dia' },
  { id: '7d', label: '7 dias' },
  { id: '15d', label: '15 dias' },
  { id: '30d', label: '30 dias' },
];

const nf = (n) => Number(n || 0).toLocaleString('pt-PT');

function pctDelta(cur, prev) {
  if (!prev) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

export default function Statistics() {
  const [section, setSection] = useState('site');

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Estatísticas das Redes Sociais</h1>
          <div className="adm-sub">
            {section === 'site' ? 'Acessos ao site · vyavenaadv.com' : 'Instagram · @vyvianavenaadv'}
          </div>
        </div>
      </header>

      <SlidingTabs
        className="adm-stat-sectiontabs"
        items={SECTIONS}
        active={section}
        onChange={setSection}
        variant="underline"
      />

      {section === 'site' ? <SiteSection /> : <InstagramSection />}
    </>
  );
}

// ============ Secção INSTAGRAM (Fase B — em breve) ============
function InstagramSection() {
  return (
    <div className="adm-stat-coming">
      <div className="adm-stat-coming-icon"><IconInstagram size={26} /></div>
      <div className="adm-stat-coming-badge">Em breve · Fase B</div>
      <h3>Estatísticas do Instagram</h3>
      <p>
        Aqui vão aparecer os seguidores e os novos seguidores do período, além das curtidas e
        comentários das últimas publicações do @vyvianavenaadv. Falta apenas ligar a conta à API
        oficial do Instagram — uns minutos de configuração.
      </p>
    </div>
  );
}

// ============ Secção SITE (Fase A — acessos, no ar) ============
function SiteSection() {
  const [range, setRange] = useState('7d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    statsApi.site(range)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]);

  const delta = data ? pctDelta(data.total_views, data.prev_total_views) : 0;
  const nDays = range === '1d' ? 1 : Number(range.replace('d', ''));
  const avgPerDay = data ? Math.round(data.total_views / nDays) : 0;

  return (
    <>
      <div className="adm-stat-toolbar">
        <SlidingTabs items={RANGES} active={range} onChange={setRange} variant="pills" />
      </div>

      {loading && !data ? (
        <div className="adm-kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="adm-kpi">
              <span className="adm-skel" style={{ width: '60%', height: 9, display: 'block', marginBottom: 10 }} />
              <span className="adm-skel" style={{ width: '45%', height: 22, display: 'block' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="adm-login-error">{error}</div>
      ) : data ? (
        <>
          <div className="adm-kpi-grid">
            <div className="adm-kpi">
              <div className="adm-kpi-label">Visitas no período</div>
              <div className="adm-kpi-value"><CountUp value={data.total_views} /></div>
              <div className={'adm-kpi-delta ' + (delta > 0 ? '' : delta < 0 ? 'adm-kpi-delta-danger' : 'adm-kpi-delta-muted')}>
                {delta > 0 ? '▲ ' : delta < 0 ? '▼ ' : ''}
                {Math.abs(delta).toFixed(0)}% vs. período anterior
              </div>
            </div>

            <div className="adm-kpi">
              <div className="adm-kpi-label">
                {data.granularity === 'hour' ? 'Média por hora' : 'Média por dia'}
              </div>
              <div className="adm-kpi-value">
                <CountUp value={data.granularity === 'hour' ? Math.round(data.total_views / 24) : avgPerDay} />
              </div>
              <div className="adm-kpi-delta adm-kpi-delta-muted">
                {data.granularity === 'hour' ? 'nas últimas 24h' : `ao longo de ${nDays} dias`}
              </div>
            </div>

            <div className="adm-kpi">
              <div className="adm-kpi-label">Visitantes únicos</div>
              <div className="adm-kpi-value">
                {data.total_visitors == null
                  ? <span style={{ color: 'var(--muted)' }}>—</span>
                  : <CountUp value={data.total_visitors} />}
              </div>
              <div className="adm-kpi-delta adm-kpi-delta-muted">
                {data.total_visitors == null ? 'contado por dia' : 'soma por dia (sem cookies)'}
              </div>
            </div>

            <div className="adm-kpi">
              <div className="adm-kpi-label">Pico</div>
              <div className="adm-kpi-value"><CountUp value={Math.max(0, ...data.series.map((p) => p.views))} /></div>
              <div className="adm-kpi-delta adm-kpi-delta-muted">{peakLabel(data.series, data.granularity)}</div>
            </div>
          </div>

          <div className="adm-card adm-glow">
            <div className="adm-card-title">
              {data.granularity === 'hour' ? 'Acessos por hora (últimas 24h)' : `Acessos por dia (${nDays} dias)`}
              <span className="adm-stat-legend"><span className="adm-stat-legend-dot" /> visitas</span>
            </div>
            <AreaChart series={data.series} granularity={data.granularity} />
            {data.total_views === 0 && (
              <div className="adm-stat-note">
                Ainda sem acessos registados neste período. A contagem começa a partir da entrada
                desta funcionalidade no ar — os primeiros acessos aparecem aqui em breve.
              </div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

function peakLabel(series, granularity) {
  if (!series || !series.length) return '—';
  let best = series[0];
  for (const p of series) if (p.views > best.views) best = p;
  if (best.views === 0) return 'sem dados ainda';
  return granularity === 'hour' ? `às ${best.label}` : `em ${best.label}`;
}

// ============ Gráfico de área (SVG próprio, sem libs) ============
function AreaChart({ series, granularity }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const W = 760, H = 240;
  const padL = 40, padR = 16, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const n = series.length;
  const maxRaw = Math.max(1, ...series.map((p) => p.views));
  const maxV = niceMax(maxRaw);

  const xAt = (i) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - (v / maxV) * plotH;

  const linePts = series.map((p, i) => `${xAt(i)},${yAt(p.views)}`);
  const linePath = 'M' + linePts.join(' L');
  const areaPath = `M${xAt(0)},${baseY} L` + linePts.join(' L') + ` L${xAt(n - 1)},${baseY} Z`;

  const step = Math.max(1, Math.ceil(n / 8));
  const yTicks = [0, 0.5, 1].map((f) => ({ v: Math.round(maxV * f), y: yAt(maxV * f) }));

  const onMove = (e) => {
    const svg = wrapRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = n === 1 ? 0 : Math.round(((vbX - padL) / plotW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  };

  const hv = hover != null ? series[hover] : null;
  const hvX = hover != null ? xAt(hover) : 0;
  const hvY = hover != null ? yAt(hv.views) : 0;

  return (
    <div className="adm-stat-chart-wrap">
      <svg
        ref={wrapRef}
        className="adm-stat-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Gráfico de acessos ao site"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="statFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--forest)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--forest)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" className="adm-stat-axis">{nf(t.v)}</text>
          </g>
        ))}

        <path d={areaPath} fill="url(#statFill)" />
        <path d={linePath} fill="none" stroke="var(--forest)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {series.map((p, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(p.views)} r={hover === i ? 4 : 2.5}
                  fill={hover === i ? 'var(--gold)' : 'var(--forest)'} />
        ))}

        {series.map((p, i) => (
          (i % step === 0 || i === n - 1) ? (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" className="adm-stat-axis">{p.label}</text>
          ) : null
        ))}

        {hv && (
          <line x1={hvX} y1={padT} x2={hvX} y2={baseY} stroke="var(--gold)" strokeWidth="1" strokeDasharray="3 3" />
        )}
      </svg>

      {hv && (
        <div className="adm-stat-tip" style={{ left: `${(hvX / W) * 100}%`, top: `${(hvY / H) * 100}%` }}>
          <strong>{nf(hv.views)}</strong> visita{hv.views === 1 ? '' : 's'}
          {typeof hv.visitors === 'number' && <> · {nf(hv.visitors)} visitante{hv.visitors === 1 ? '' : 's'}</>}
          <span className="adm-stat-tip-label">{hv.label}</span>
        </div>
      )}
    </div>
  );
}

function niceMax(v) {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.ceil(v / (step * pow / 5)) * (step * pow / 5);
}
