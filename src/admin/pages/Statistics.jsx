// src/admin/pages/Statistics.jsx
// Redes Sociais — Área Privada, com o redesign do handoff «Vyvian Avena Design System v3».
// Três abas (Instagram · Site · Insights) sobre um fundo vivo (aurora + grelha + spotlight),
// escuro por defeito com modo claro opcional. Dados e endpoints inalterados.
// Filtros: período (1/7/15/30/60/90/120 dias) + agrupamento (dias/semanas/meses),
// com legenda e rótulos de eixo X/Y em todos os gráficos.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { stats as statsApi } from '../apiClient';
import InsightsSection from '../insights/InsightsSection';
import { Icon, Ticker, Reveal, Tip, TipLayer, Tabs, Seg, Sparkles, Chart, Spark, Tilt, Thumb, PanelHead } from '../rs/ui';
import '../rs/rs-theme.css';

const SECTIONS = [
  { k: 'instagram', label: 'Instagram', icon: 'instagram' },
  { k: 'site', label: 'Site', icon: 'globe' },
  { k: 'insights', label: 'Insights', icon: 'spark' },
];

const RANGES = [
  { k: '1d', label: '1 DIA' },
  { k: '7d', label: '7 DIAS' },
  { k: '15d', label: '15 DIAS' },
  { k: '30d', label: '30 DIAS' },
  { k: '60d', label: '60 DIAS' },
  { k: '90d', label: '90 DIAS' },
  { k: '120d', label: '120 DIAS' },
];

const GRUPOS = [
  { k: 'day', label: 'DIAS' },
  { k: 'week', label: 'SEMANAS' },
  { k: 'month', label: 'MESES' },
];
const GRUPO_SING = { day: 'dia', week: 'semana', month: 'mês', hour: 'hora' };
const GRUPO_PLUR = { day: 'dias', week: 'semanas', month: 'meses', hour: 'horas' };
const MES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const RS_C = { gold: '#d4b585', gold2: '#b8935a', sage: '#9fc4b6', warm: '#c89656' };
const nf = (n) => Number(n || 0).toLocaleString('pt-PT');

function pctDelta(cur, prev) {
  if (!prev) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

/* ---------------- agrupamento temporal (dias → semanas/meses) ----------------
   Os pontos da API trazem `key` ISO ('YYYY-MM-DD'). Semana = segunda-feira ISO. */
function chaveGrupo(iso, grupo) {
  if (grupo === 'month') return iso.slice(0, 7);
  if (grupo === 'week') {
    const d = new Date(iso + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
    return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  }
  return iso;
}
function rotuloGrupo(key, grupo) {
  if (grupo === 'month') { const [y, m] = key.split('-'); return MES_PT[+m - 1] + '/' + y.slice(2); }
  const lbl = key.slice(8, 10) + '/' + key.slice(5, 7);
  return grupo === 'week' ? 'sem. ' + lbl : lbl;
}
/* campos: { views: 'sum', followers: 'last', … } — pontos chegam por ordem cronológica */
function agrupar(series, grupo, campos) {
  if (!series || !series.length) return [];
  if (grupo === 'day') {
    return series.map((p) => {
      const o = { key: p.key, d: p.label };
      for (const campo of Object.keys(campos)) o[campo] = Number(p[campo] || 0);
      return o;
    });
  }
  const map = new Map();
  for (const p of series) {
    const k = chaveGrupo(p.key, grupo);
    let b = map.get(k);
    if (!b) { b = { key: k, d: rotuloGrupo(k, grupo) }; map.set(k, b); }
    for (const [campo, modo] of Object.entries(campos)) {
      const v = Number(p[campo] || 0);
      b[campo] = modo === 'sum' ? (b[campo] || 0) + v : v; // 'last'
    }
  }
  return [...map.values()];
}
/* publicações do Instagram → curtidas e nº de posts por dia/semana/mês */
function agruparPosts(posts, grupo) {
  const map = new Map();
  for (const p of posts) {
    const iso = (p.timestamp || '').slice(0, 10);
    if (!iso) continue;
    const k = chaveGrupo(iso, grupo);
    const b = map.get(k) || { likes: 0, count: 0 };
    b.likes += p.like_count || 0;
    b.count += 1;
    map.set(k, b);
  }
  const arr = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    likes: arr.map(([, b]) => ({ v: b.likes })),
    pubs: arr.map(([, b]) => ({ v: b.count })),
  };
}

export default function Statistics() {
  const [section, setSection] = useState('instagram');
  const [theme, setTheme] = useState(() => localStorage.getItem('rs-theme') || 'dark');
  const scopeRef = useRef(null);

  useEffect(() => { localStorage.setItem('rs-theme', theme); }, [theme]);

  // spotlight de pontos segue o rato (atualiza --mx/--my via rAF)
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
      });
    };
    el.addEventListener('mousemove', onMove);
    return () => { el.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <div ref={scopeRef} className="rs-scope" data-rs-theme={theme}>
      <TipLayer />
      <div className="rs-bg" aria-hidden="true">
        <span className="aur a1" /><span className="aur a2" /><span className="aur a3" />
        <span className="grid" /><span className="dots" /><span className="vig" />
      </div>

      <div className="rs-wrap">
        <header className="hdr">
          <Sparkles />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <span className="overline">Área privada · Redes Sociais</span>
              <h1 style={{ marginTop: 10 }}>Redes Sociais</h1>
              <span className="rule-s" style={{ display: 'block', marginTop: 14 }} />
              <p className="sub">
                {section === 'site'
                  ? 'Acessos ao site · vyavenaadv.com — dados próprios, sem cookies.'
                  : section === 'insights'
                    ? 'Motor editorial — temas com potencial de engajamento, artigos e fontes.'
                    : 'Instagram · @vyvianavenaadv — sincronização diária automática.'}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
                    onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                    data-tip={theme === 'dark' ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
                    aria-label="Alternar tema">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Claro' : 'Escuro'}
            </button>
          </div>
        </header>

        <div style={{ marginBottom: 26, overflowX: 'auto', paddingBottom: 4 }}>
          <Tabs items={SECTIONS} value={section} onChange={setSection} />
        </div>

        {section === 'site' ? <SiteSection goInsights={() => setSection('insights')} />
          : section === 'insights' ? <InsightsSection />
          : <InstagramSection />}
      </div>
    </div>
  );
}

/* ---------------- barra de filtros: período + agrupamento + legenda ---------------- */
function PeriodBar({ range, setRange, grupo, setGrupo, updated, nDays }) {
  const hourly = range === '1d';
  const legenda = hourly
    ? 'Últimas 24 horas · agrupado por hora'
    : `Últimos ${nDays} dias · agrupado por ${GRUPO_SING[grupo]}`;
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Período</span>
        <Seg items={RANGES} value={range} onChange={setRange} small />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!hourly && <>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Agrupar por</span>
          <Seg items={GRUPOS} value={grupo} onChange={setGrupo} small />
        </>}
        <span className="chip chip-gold" style={{ textTransform: 'none', letterSpacing: '.02em', fontWeight: 600 }}>
          <Icon name="filter" size={11} />{legenda}
        </span>
        {updated && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-3)', letterSpacing: '.04em' }}>
            <span style={{ width: 6, height: 6, borderRadius: 9, background: 'var(--success)', boxShadow: '0 0 0 3px rgba(74,124,89,.22)', animation: 'rsPulseGold 2.4s infinite' }} />
            Atualizado a {updated} · sincronização diária
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- cartão KPI (padrão sean0205/area-charts-1) ---------------- */
function Kpi({ label, period, value, prefix, suffix, foot, delta, hero, hi, icon, color, spark, sparkId, fmt, d = 0, span = 1, eixoX, eixoY }) {
  const c = color || RS_C.gold2;
  return (
    <Reveal d={d} cls={'glass kpi' + (hi ? ' hi' : '') + (span > 1 ? ' b-' + span : '')}
            style={{ padding: hero ? '24px 26px 22px' : '20px 22px' }}>
      {hero && <><span className="beam" /><span className="beam-mask" /></>}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: c, display: 'flex' }}><Icon name={icon} size={17} /></span>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{label}</span>
        </div>
        {hero
          ? <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, marginTop: 15 }}>
              <div style={{ minWidth: 0 }}>
                <div className="lbl" style={{ whiteSpace: 'nowrap' }}>{period}</div>
                <div className="val num" style={{ marginTop: 7, fontSize: 'clamp(40px,4.4vw,58px)' }}>
                  <Ticker value={value} prefix={prefix} suffix={suffix} />
                </div>
              </div>
              {spark && spark.length >= 2 && (
                <div style={{ flex: 1, minWidth: 120, maxWidth: 240 }}>
                  <Spark series={spark} accent={c} id={sparkId} h={78} fmt={fmt} />
                </div>
              )}
            </div>
          : <>
              <div className="lbl" style={{ whiteSpace: 'nowrap', marginTop: 14 }}>{period}</div>
              <div className="val num" style={{ marginTop: 6, fontSize: 'clamp(28px,2.9vw,36px)' }}>
                <Ticker value={value} prefix={prefix} suffix={suffix} />
              </div>
              {spark && spark.length >= 2 && (
                <div style={{ marginTop: 10, marginInline: -4 }}>
                  <Spark series={spark} accent={c} id={sparkId} h={50} fmt={fmt} />
                </div>
              )}
            </>}
        {(foot || delta != null) && (
          <div className="foot">
            {delta != null && <span className={'delta ' + (delta >= 0 ? 'up' : 'dn')}>{delta >= 0 ? '+' : ''}{Math.round(delta)}%</span>}
            {foot}
          </div>
        )}
        {(eixoX || eixoY) && (
          <div style={{ marginTop: 8, fontSize: 9, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--fg-3)', opacity: .85 }}>
            {eixoX && <>X · {eixoX}</>}{eixoX && eixoY && <span style={{ opacity: .5 }}> &nbsp;—&nbsp; </span>}{eixoY && <>Y · {eixoY}</>}
          </div>
        )}
      </div>
    </Reveal>
  );
}

function KpiSkeleton() {
  return (
    <div className="bento">
      {[2, 1, 1].map((s, i) => (
        <div key={i} className={'glass kpi' + (s > 1 ? ' b-2' : '')} style={{ minHeight: 150 }}>
          <span className="adm-skel" style={{ width: '55%', height: 10, display: 'block', marginTop: 6 }} />
          <span className="adm-skel" style={{ width: '40%', height: 34, display: 'block', marginTop: 22 }} />
        </div>
      ))}
      <div className="glass b-4" style={{ minHeight: 180 }}>
        <span className="adm-skel" style={{ width: '30%', height: 12, display: 'block', margin: '24px 26px' }} />
      </div>
    </div>
  );
}

/* ============ Aba INSTAGRAM ============ */
function InstagramSection() {
  const [range, setRange] = useState('30d');
  const [grupo, setGrupo] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    statsApi.instagram(range)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]);

  const nDays = range === '1d' ? 1 : Number(range.replace('d', ''));
  const gEfetivo = range === '1d' ? 'day' : grupo;
  const xPlur = GRUPO_PLUR[gEfetivo];

  // agregações derivadas (agrupamento é só apresentação — os dados são os mesmos)
  const gseries = useMemo(
    () => agrupar(data?.series || [], gEfetivo, { followers: 'last' }),
    [data, gEfetivo]
  );
  const chartSeries = useMemo(() => gseries.map((p) => ({ d: p.d, v: p.followers })), [gseries]);
  const novosSerie = useMemo(
    () => gseries.map((p, i, a) => ({ v: i ? p.followers - a[i - 1].followers : 0 })),
    [gseries]
  );
  const postBuckets = useMemo(() => agruparPosts(data?.posts || [], gEfetivo), [data, gEfetivo]);

  if (loading && !data) return <><PeriodBar range={range} setRange={setRange} grupo={grupo} setGrupo={setGrupo} nDays={nDays} /><KpiSkeleton /></>;
  if (error) return <div className="glass" style={{ padding: 22, color: '#e39b9b', fontSize: 13.5 }}>{error}</div>;
  if (!data) return null;

  const posts = data.posts || [];
  const totalLikes = posts.reduce((s, p) => s + (p.like_count || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments_count || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const nd = data.new_followers;
  const period = nDays === 1 ? 'Último dia' : `Últimos ${nDays} dias`;
  const growPct = nd != null && data.followers_count > nd && nd !== 0
    ? ((nd / (data.followers_count - nd)) * 100).toFixed(1) : null;
  const diasRecolha = (data.series || []).length;

  return (
    <>
      <PeriodBar range={range} setRange={setRange} grupo={grupo} setGrupo={setGrupo}
                 nDays={nDays} updated={data.updated_at ? fmtWhen(data.updated_at) : null} />

      {!data.has_data ? (
        <Reveal cls="glass" style={{ padding: '44px 30px', textAlign: 'center' }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto', background: 'var(--grad-gold-soft)', border: '1px solid var(--edge-2)', display: 'grid', placeItems: 'center', color: 'var(--gold-soft)' }}>
            <Icon name="instagram" size={24} />
          </span>
          <div className="chip chip-ok" style={{ marginTop: 18 }}>Ligado · a recolher dados</div>
          <h3 style={{ fontSize: 24, marginTop: 14 }}>Conta ligada com sucesso</h3>
          <p style={{ fontSize: 13.5, color: 'var(--fg-2)', maxWidth: '52ch', margin: '12px auto 0', lineHeight: 1.6 }}>
            A conta @vyvianavenaadv já está ligada à API oficial do Instagram. A primeira recolha corre
            no próximo ciclo automático — os números aparecem aqui a partir de amanhã.
          </p>
        </Reveal>
      ) : (
        <>
          <div className="bento">
            <Kpi hero hi span={2} icon="instagram" label="Seguidores" period={period}
                 value={data.followers_count || 0} color={RS_C.gold}
                 spark={chartSeries.map((s) => ({ v: s.v }))} sparkId="rsk1"
                 eixoX={xPlur} eixoY="seguidores"
                 foot={nd == null ? '@vyvianavenaadv'
                   : <><span className={'delta ' + (nd >= 0 ? 'up' : 'dn')}>{nd >= 0 ? '+' : ''}{nf(nd)}</span> desde o início do período</>} />
            <Kpi d={70} icon="trend" label="Novos" period={period}
                 value={Math.abs(nd || 0)} prefix={nd < 0 ? '−' : ''} color={RS_C.gold2}
                 spark={novosSerie.length >= 2 ? novosSerie : null} sparkId="rsk2"
                 eixoX={xPlur} eixoY="novos seguidores"
                 foot={nd == null ? 'sem histórico ainda' : nd === 0 ? 'estável no período' : `≈ ${(Math.abs(nd) / nDays).toFixed(1)}/dia`} />
            <Kpi d={140} icon="image" label="Publicações" period="Total no perfil"
                 value={data.media_count || 0} color={RS_C.warm}
                 spark={postBuckets.pubs.length >= 2 ? postBuckets.pubs : null} sparkId="rsk3"
                 eixoX={xPlur + ' (posts recentes)'} eixoY="publicações"
                 foot={`${posts.length} recentes recolhidas`} />
            <Reveal d={200} cls="glass b-3" style={{ padding: '24px 26px 20px' }}>
              <PanelHead over="Crescimento" title="Evolução de seguidores"
                note={`Últimos ${nDays} dias · agrupado por ${GRUPO_SING[gEfetivo]} (último valor de cada ${GRUPO_SING[gEfetivo]})`}
                right={growPct != null && <span className="chip chip-gold"><Icon name="trend" size={12} />+{growPct}%</span>} />
              <Chart series={chartSeries} id="rsig" h={210}
                     keys={[{ k: 'v', label: 'Seguidores', color: RS_C.gold }]}
                     xLabel={xPlur} yLabel="seguidores"
                     flatNote={diasRecolha < 2
                       ? 'O gráfico precisa de pelo menos dois dias de recolha — a linha começa a desenhar-se nos próximos dias.'
                       : chartSeries.length < 2
                         ? `Com este agrupamento o período só tem ${chartSeries.length} ponto — escolha um período maior ou um agrupamento mais fino.`
                         : diasRecolha <= 14
                           ? `A recolha começou há ${diasRecolha} dias — a série ganha relevo com o passar das semanas.`
                           : null} />
            </Reveal>
            <Kpi d={260} icon="heart" label="Curtidas" period="Publicações recentes"
                 value={totalLikes} color={RS_C.gold}
                 spark={postBuckets.likes.length >= 2 ? postBuckets.likes : null} sparkId="rsk4"
                 eixoX={xPlur + ' (posts recentes)'} eixoY="curtidas"
                 foot={<><span>{avgLikes}/publicação</span><span style={{ opacity: .4 }}>·</span><span>{nf(totalComments)} comentário{totalComments === 1 ? '' : 's'}</span></>} />
          </div>

          <div style={{ marginTop: 42 }}>
            <PanelHead over="Conteúdo" title="Últimas publicações" note="Clique para abrir no Instagram."
              right={<a className="btn btn-ghost btn-sm" href="https://www.instagram.com/vyvianavenaadv/" target="_blank" rel="noreferrer">@vyvianavenaadv<Icon name="ext" size={13} /></a>} />
            {posts.length === 0 ? (
              <div className="glass" style={{ padding: 22, fontSize: 13, color: 'var(--fg-3)' }}>Ainda sem publicações recolhidas.</div>
            ) : (
              <div onMouseLeave={() => setFocus(null)}
                   style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill,minmax(186px,1fr))' }}>
                {posts.map((p, i) => (
                  <Reveal key={p.id} d={i * 45} y={18}>
                    <a href={p.permalink || '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'block', color: 'inherit' }}>
                      <Tilt onMouseEnter={() => setFocus(i)} max={7}
                            style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--edge)', background: 'var(--panel)', cursor: 'pointer',
                                     filter: focus != null && focus !== i ? 'brightness(.62) saturate(.7)' : 'none',
                                     transitionProperty: 'transform,filter', transitionDuration: '.45s,.4s' }}>
                        <Thumb hue={i} src={p.thumb_url} style={{ aspectRatio: '1/1' }}>
                          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(6,18,15,.86) 0%,transparent 52%)' }} />
                          {(p.media_type === 'CAROUSEL_ALBUM' || p.media_type === 'VIDEO') && (
                            <span style={{ position: 'absolute', top: 9, right: 9, padding: '3px 8px', borderRadius: 6, fontSize: 8.5, fontWeight: 800, letterSpacing: '.14em',
                                           background: 'rgba(6,18,15,.62)', border: '1px solid rgba(212,181,133,.4)', color: '#d4b585', backdropFilter: 'blur(6px)' }}>
                              {p.media_type === 'VIDEO' ? 'VÍDEO' : 'ÁLBUM'}
                            </span>
                          )}
                          <span className="mono" style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 10.5, color: 'rgba(244,238,226,.68)', letterSpacing: '.08em' }}>
                            {fmtPostDate(p.timestamp)}
                          </span>
                          <span style={{ position: 'absolute', bottom: 8, right: 10, display: 'flex', gap: 10, fontSize: 11, color: '#f4eee2', alignItems: 'center' }}>
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="heart" size={12} />{nf(p.like_count)}</span>
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="comment" size={12} />{nf(p.comments_count)}</span>
                          </span>
                        </Thumb>
                        {p.caption && (
                          <div style={{ padding: '12px 13px 14px' }}>
                            <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--fg-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textWrap: 'pretty' }}>
                              {p.caption}
                            </p>
                          </div>
                        )}
                      </Tilt>
                    </a>
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function fmtPostDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// captured_at chega como 'YYYY-MM-DD HH:MM:SS' (UTC, do SQLite).
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

/* ============ Aba SITE ============ */
function SiteSection({ goInsights }) {
  const [range, setRange] = useState('7d');
  const [grupo, setGrupo] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    statsApi.site(range)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]);

  const nDays = range === '1d' ? 1 : Number(range.replace('d', ''));
  const hourly = data?.granularity === 'hour';
  const gEfetivo = hourly ? 'hour' : grupo;
  const xPlur = GRUPO_PLUR[gEfetivo];
  const hasVisitors = (data?.series || []).some((p) => typeof p.visitors === 'number' && !hourly);

  // série agrupada (soma de visitas/únicos por dia/semana/mês; por hora fica como vem)
  const gseries = useMemo(() => {
    if (!data?.series) return [];
    if (hourly) return data.series.map((p) => ({ d: p.label, v: p.views }));
    return agrupar(data.series, grupo, { views: 'sum', visitors: 'sum' })
      .map((p) => ({ d: p.d, v: p.views, ...(hasVisitors ? { u: p.visitors } : {}) }));
  }, [data, grupo, hourly, hasVisitors]);

  if (loading && !data) return <><PeriodBar range={range} setRange={setRange} grupo={grupo} setGrupo={setGrupo} nDays={nDays} /><KpiSkeleton /></>;
  if (error) return <div className="glass" style={{ padding: 22, color: '#e39b9b', fontSize: 13.5 }}>{error}</div>;
  if (!data) return null;

  const delta = pctDelta(data.total_views, data.prev_total_views);
  const avgPerDay = hourly ? Math.round(data.total_views / 24) : Math.round(data.total_views / nDays);
  const spark = gseries.map((s) => ({ v: s.v }));
  const peak = gseries.reduce((a, b) => (b.v > (a?.v ?? -1) ? b : a), gseries[0] || null);
  const period = nDays === 1 ? 'Últimas 24 h' : `Últimos ${nDays} dias`;
  const avgMovel = gseries.map((x, i, a) => ({ v: Math.round(a.slice(Math.max(0, i - 2), i + 1).reduce((m, n) => m + n.v, 0) / Math.min(3, i + 1)) }));

  const keys = hasVisitors
    ? [{ k: 'v', label: 'Visitas', color: RS_C.gold }, { k: 'u', label: 'Únicos', color: RS_C.sage }]
    : [{ k: 'v', label: 'Visitas', color: RS_C.gold }];

  return (
    <>
      <PeriodBar range={range} setRange={setRange} grupo={grupo} setGrupo={setGrupo} nDays={nDays} />
      <div className="bento">
        <Kpi hero hi span={2} icon="globe" label="Visitas" period={period}
             value={data.total_views || 0} delta={delta} color={RS_C.gold}
             spark={spark.length >= 2 ? spark : null} sparkId="rss1"
             eixoX={xPlur} eixoY="visitas"
             foot="vs. período anterior" />
        <Kpi d={70} icon="trend" label={hourly ? 'Média por hora' : 'Média por dia'} period={hourly ? 'nas últimas 24 h' : `${nDays} dias`}
             value={avgPerDay} color={RS_C.sage}
             spark={avgMovel.length >= 2 ? avgMovel : null} sparkId="rss2"
             eixoX={xPlur} eixoY={`média de visitas/${GRUPO_SING[gEfetivo]}`}
             foot={`média móvel de 3 ${xPlur}`} />
        <Kpi d={140} icon="users" label="Visitantes únicos" period={period}
             value={data.total_visitors || 0} color={RS_C.sage}
             spark={hasVisitors && gseries.length >= 2 ? gseries.map((x) => ({ v: x.u })) : null} sparkId="rss3"
             eixoX={xPlur} eixoY="visitantes únicos"
             foot={<Tip label="Contagem própria no Worker (D1), por impressão diária — sem cookies e sem Google Analytics.">
               <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'help', borderBottom: '1px dotted var(--edge-2)' }}>
                 sem cookies <Icon name="info" size={12} />
               </span>
             </Tip>} />
        <Reveal d={200} cls="glass b-3" style={{ padding: '24px 26px 20px' }}>
          <PanelHead over="Tráfego" title={hourly ? 'Acessos por hora (últimas 24 h)' : `Acessos por ${GRUPO_SING[gEfetivo]}`}
            note={hourly
              ? 'Últimas 24 horas · um ponto por hora. Dados próprios do Worker — sem Google Analytics.'
              : `Últimos ${nDays} dias · agrupado por ${GRUPO_SING[gEfetivo]} (soma de cada ${GRUPO_SING[gEfetivo]}). Dados próprios do Worker — sem Google Analytics.`}
            right={peak && peak.v > 0 && <span className="chip"><Icon name="target" size={12} />pico {nf(peak.v)} · {peak.d}</span>} />
          <Chart series={gseries} id="rsst" h={218} keys={keys}
                 xLabel={xPlur} yLabel={hasVisitors ? 'visitas / únicos' : 'visitas'}
                 flatNote={data.total_views === 0
                   ? 'Ainda sem acessos registados neste período — os primeiros aparecem aqui em breve.'
                   : gseries.length < 2
                     ? `Com este agrupamento o período só tem ${gseries.length} ponto — escolha um período maior ou um agrupamento mais fino.`
                     : null} />
        </Reveal>
        <Kpi d={260} icon="target" label="Pico"
             period={peak && peak.v > 0 ? `melhor ${GRUPO_SING[gEfetivo]} · ${peak.d}` : 'sem dados ainda'}
             value={peak ? peak.v : 0} color={RS_C.warm}
             spark={spark.length >= 2 ? spark : null} sparkId="rss4"
             eixoX={xPlur} eixoY="visitas"
             foot={`máximo entre os ${xPlur} do período`} />
      </div>
      <Reveal d={120} cls="glass" style={{ marginTop: 22, padding: '20px 24px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--gold)', display: 'flex' }}><Icon name="info" size={17} /></span>
        <p style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55, flex: 1, minWidth: 220, textWrap: 'pretty' }}>
          Conteúdo novo no blogue é o que mais move estas curvas. A aba <strong style={{ color: 'var(--fg)', fontWeight: 700 }}>Insights</strong> sugere
          os 10 temas com maior potencial de engajamento para o público da Dra.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={goInsights}>Ver sugestões<Icon name="chev" size={13} /></button>
      </Reveal>
    </>
  );
}
