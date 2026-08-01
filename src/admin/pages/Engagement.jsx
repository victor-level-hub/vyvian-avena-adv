// src/admin/pages/Engagement.jsx
// Aba "Engajamento" (Redes Sociais) — como o público reage ao conteúdo, por plataforma.
// Escrita sobre o design system do redesign v3 (../rs/ui) para ficar igual às restantes
// abas: mesmas primitivas (Reveal, Seg, Chart, Icon, Ticker, Tilt) e o mesmo tema.
//
// Instagram vem de /api/stats/engagement, alimentado pelo cron diário (migração 0027).
// O Facebook mostra o estado da ligação: o token atual é do fluxo "Instagram API with
// Instagram login" e não dá acesso à Página, por isso não há números a mostrar.
import React, { useEffect, useMemo, useState } from 'react';
import { stats as statsApi } from '../apiClient';
import { Icon, Ticker, Reveal, Seg, Chart, Tilt, PanelHead } from '../rs/ui';

const PLATAFORMAS = [
  { k: 'instagram', label: 'INSTAGRAM' },
  { k: 'facebook', label: 'FACEBOOK' },
];

const RANGES = [
  { k: '7d', label: '7 DIAS' },
  { k: '15d', label: '15 DIAS' },
  { k: '30d', label: '30 DIAS' },
  { k: '60d', label: '60 DIAS' },
  { k: '90d', label: '90 DIAS' },
];

const C = { gold: '#d4b585', gold2: '#b8935a', sage: '#9fc4b6', warm: '#c89656' };
const nf = (n) => Number(n || 0).toLocaleString('pt-PT');
const pct = (n, d = 1) => `${Number(n || 0).toFixed(d).replace('.', ',')}%`;

// Rótulos legíveis para os códigos que a Meta devolve na demografia.
const GENERO = { F: 'Feminino', M: 'Masculino', U: 'Não indicado' };
const PAIS = {
  BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', ES: 'Espanha', FR: 'França',
  GB: 'Reino Unido', DE: 'Alemanha', IT: 'Itália', CH: 'Suíça', IE: 'Irlanda',
  AO: 'Angola', MZ: 'Moçambique', CV: 'Cabo Verde', LU: 'Luxemburgo', BE: 'Bélgica',
  NL: 'Países Baixos', CA: 'Canadá', AR: 'Argentina', PY: 'Paraguai', UY: 'Uruguai',
};

function delta(cur, prev) {
  if (cur == null) return null;
  if (!prev) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

// A API devolve tempo de visualização em milissegundos.
function fmtWatch(ms) {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function fmtData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtQuando(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

export default function EngagementSection() {
  const [plataforma, setPlataforma] = useState('instagram');
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    statsApi.engagement(range)
      .then((d) => { if (vivo) setData(d); })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [range]);

  const ig = data?.platforms?.instagram;

  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="overline">Plataforma</span>
          <Seg items={PLATAFORMAS} value={plataforma} onChange={setPlataforma} small />
        </div>
        {plataforma === 'instagram' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="overline">Período</span>
            <Seg items={RANGES} value={range} onChange={setRange} small />
            {ig?.updated_at && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-3)', letterSpacing: '.04em' }}>
                <span style={{ width: 6, height: 6, borderRadius: 9, background: 'var(--success)', boxShadow: '0 0 0 3px rgba(74,124,89,.22)', animation: 'rsPulseGold 2.4s infinite' }} />
                Atualizado a {fmtQuando(ig.updated_at)} · sincronização diária
              </span>
            )}
          </div>
        )}
      </div>

      {plataforma === 'facebook' ? <Facebook fb={data?.platforms?.facebook} />
        : loading && !data ? <Esqueleto />
        : erro ? <div className="glass" style={{ padding: 20, color: 'var(--danger)' }}>{erro}</div>
        : ig ? <Instagram ig={ig} dias={data.period_days} />
        : null}
    </>
  );
}

function Esqueleto() {
  return (
    <div className="bento">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass kpi" style={{ padding: '20px 22px' }}>
          <div style={{ width: '58%', height: 11, marginBottom: 14, borderRadius: 6, background: 'var(--line)', opacity: .6 }} />
          <div style={{ width: '42%', height: 26, borderRadius: 6, background: 'var(--line)', opacity: .6 }} />
        </div>
      ))}
    </div>
  );
}

/* ============ INSTAGRAM ============ */
function Instagram({ ig, dias }) {
  const t = ig.totals || {};
  const p = ig.prev_totals || {};

  // Série do gráfico: interações e alcance por dia, no formato que o Chart espera.
  const serie = useMemo(() => (ig.series || []).map((s) => ({
    label: s.label, inter: s.interactions, alc: s.reach,
  })), [ig.series]);

  const demo = ig.demographics || {};
  const mapDemo = (rows, dic) => (rows || []).map((r) => ({
    label: (dic && dic[r.bucket]) || r.bucket, value: r.value,
  }));

  if (!ig.has_data) {
    return (
      <Reveal cls="glass" style={{ padding: '46px 30px', textAlign: 'center' }}>
        <span style={{ color: C.gold, display: 'inline-flex' }}><Icon name="spark" size={26} /></span>
        <h3 style={{ fontSize: 22, marginTop: 12 }}>Engajamento a caminho</h3>
        <p style={{ fontSize: 13, color: 'var(--fg-3)', maxWidth: 470, margin: '10px auto 0', lineHeight: 1.7 }}>
          A conta {ig.handle} está ligada, mas ainda não houve uma recolha de métricas de
          engajamento. A primeira corre no próximo ciclo automático — a partir daí os
          números aparecem aqui e o histórico enche-se sozinho ao longo dos dias.
        </p>
      </Reveal>
    );
  }

  return (
    <>
      {/* ── KPIs ── */}
      <div className="bento" style={{ marginBottom: 22 }}>
        <Kpi d={0} icon="users" color={C.gold2} label="Contas com engajamento"
             period={`últimos ${dias} dias`} value={t.accounts_engaged} delta={delta(t.accounts_engaged, p.accounts_engaged)}
             foot="pessoas distintas que reagiram" />
        <Kpi d={60} icon="heart" color={C.warm} label="Interações totais"
             period={`últimos ${dias} dias`} value={t.total_interactions} delta={delta(t.total_interactions, p.total_interactions)}
             foot="curtidas + comentários + guardados + partilhas" />
        <Kpi d={120} icon="target" color={C.sage} label="Contas alcançadas"
             period={`últimos ${dias} dias`} value={t.reach} delta={delta(t.reach, p.reach)}
             foot="soma diária — repete quem viu em dias diferentes" />
        <Kpi d={180} icon="trend" color={C.gold} label="Taxa de engajamento"
             period="interações por conta alcançada"
             text={ig.engagement_rate == null ? '—' : pct(ig.engagement_rate)}
             foot="quanto do alcance se converte em reação" />
      </div>

      {/* ── Decomposição ── */}
      <Reveal cls="glass" style={{ padding: '22px 24px', marginBottom: 22 }}>
        <PanelHead over="Composição" title="Do que é feito o engajamento" />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <Metrica icon="heart" label="Curtidas" value={t.likes} total={t.total_interactions} />
          <Metrica icon="comment" label="Comentários" value={t.comments} total={t.total_interactions} />
          <Metrica icon="save" label="Guardados" value={t.saves} total={t.total_interactions} />
          <Metrica icon="ext" label="Partilhas" value={t.shares} total={t.total_interactions} />
          <Metrica icon="comment" label="Respostas" value={t.replies} total={t.total_interactions} />
          <Metrica icon="link" label="Toques no link" value={t.profile_links_taps} />
        </div>
        <Nota>
          Guardados e partilhas valem mais do que curtidas: são o sinal que o algoritmo usa
          para mostrar a publicação a quem ainda não segue a página.
        </Nota>
      </Reveal>

      {/* ── Evolução ── */}
      <Reveal cls="glass" style={{ padding: '22px 24px', marginBottom: 22 }}>
        <PanelHead over="Evolução" title="Interações e alcance por dia"
                   note={`${ig.days_collected} ${ig.days_collected === 1 ? 'dia recolhido' : 'dias recolhidos'} no período`} />
        <Chart
          series={serie}
          keys={[
            { k: 'inter', label: 'interações', color: C.gold },
            { k: 'alc', label: 'alcance', color: C.sage },
          ]}
          id="eng"
          h={210}
          xLabel="Dia"
          yLabel="Total"
          flatNote={serie.length < 2
            ? 'O gráfico precisa de pelo menos dois dias recolhidos — desenha-se sozinho nos próximos ciclos.'
            : serie.length <= 7
              ? `Só ${serie.length} dias recolhidos até agora — a série ganha relevo com o passar das semanas.`
              : null}
        />
      </Reveal>

      {/* ── Publicação em destaque ── */}
      {ig.best && <Destaque post={ig.best} />}

      {/* ── Ranking ── */}
      <Reveal cls="glass" style={{ padding: '22px 24px', marginBottom: 22 }}>
        <PanelHead over="Conteúdo" title="Ranking das publicações"
                   note="ordenado por interações; a taxa é sobre o alcance de cada peça" />
        {!ig.ranking?.length ? (
          <Nota>Ainda sem publicações recolhidas.</Nota>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rs-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 660 }}>
              <thead>
                <tr>
                  {['Publicação', 'Formato', 'Alcance', 'Interações', 'Guardados', 'Partilhas', 'Taxa'].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i > 1 ? 'right' : 'left', padding: '0 10px 10px',
                      fontSize: 9.5, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase',
                      color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ig.ranking.map((r, i) => (
                  <tr key={r.id}>
                    <td style={td}>
                      <a href={r.permalink || '#'} target="_blank" rel="noopener noreferrer"
                         style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', minWidth: 230 }}>
                        <span className="num" style={{ width: 18, fontSize: 12, color: 'var(--fg-3)' }}>{i + 1}</span>
                        {r.thumb_url
                          ? <img src={r.thumb_url} alt="" loading="lazy" style={thumb} />
                          : <span style={{ ...thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold2 }}><Icon name="image" size={14} /></span>}
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', maxWidth: 250, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.caption || 'Sem legenda'}
                          </span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)' }}>{fmtData(r.timestamp)}</span>
                        </span>
                      </a>
                    </td>
                    <td style={td}><span className="chip chip-gold">{r.format}</span></td>
                    <td style={tdNum}>{r.reach == null ? '—' : nf(r.reach)}</td>
                    <td style={{ ...tdNum, fontWeight: 700 }}>{nf(r.interactions)}</td>
                    <td style={tdNum}>{r.saved == null ? '—' : nf(r.saved)}</td>
                    <td style={tdNum}>{r.shares == null ? '—' : nf(r.shares)}</td>
                    <td style={tdNum}>{r.rate == null ? '—' : pct(r.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ig.ranking?.some((r) => !r.has_insights) && (
          <Nota>
            As linhas com “—” são publicações cujas métricas detalhadas ainda não foram
            recolhidas; aí as interações contam apenas curtidas e comentários.
          </Nota>
        )}
      </Reveal>

      {/* ── Formato e ritmo ── */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 22 }}>
        <Reveal cls="glass" style={{ padding: '22px 24px' }}>
          <PanelHead over="Formato" title="Que formato funciona" note="média de interações por publicação" />
          <Barras
            items={(ig.by_format || []).map((f) => ({
              label: `${f.format} · ${f.posts} ${f.posts === 1 ? 'peça' : 'peças'}`, value: f.avg_interactions,
            }))}
            share={false}
            vazio="Sem publicações suficientes para comparar formatos."
          />
        </Reveal>

        <Reveal d={80} cls="glass" style={{ padding: '22px 24px' }}>
          <PanelHead over="Ritmo" title="Melhor dia para publicar" note="média de interações, pelo dia em que a peça saiu" />
          <Barras
            items={(ig.by_weekday || []).map((w) => ({
              label: `${w.day} · ${w.posts} ${w.posts === 1 ? 'peça' : 'peças'}`, value: w.avg,
            }))}
            share={false}
            vazio="Sem histórico suficiente."
          />
          <Nota>Com poucas peças por dia da semana, isto é indicação e não regra.</Nota>
        </Reveal>
      </div>

      {/* ── Demografia ── */}
      <Reveal cls="glass" style={{ padding: '22px 24px' }}>
        <PanelHead
          over="Audiência" title="Quem está do outro lado"
          note={ig.demographics_day ? `fotografia de ${ig.demographics_day.slice(8, 10)}/${ig.demographics_day.slice(5, 7)}` : null}
        />
        {!Object.keys(demo).length ? (
          <Nota>
            A Meta só disponibiliza demografia em contas com 100 seguidores ou mais. Assim que
            o perfil passar essa marca, país, cidade, idade e género aparecem aqui.
          </Nota>
        ) : (
          <>
            <div style={{ display: 'grid', gap: '22px 26px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <BlocoDemo titulo="País — quem segue" items={mapDemo(demo.follower_country, PAIS)} />
              <BlocoDemo titulo="País — quem interage" items={mapDemo(demo.engaged_country, PAIS)} />
              <BlocoDemo titulo="Cidade" items={mapDemo(demo.follower_city)} />
              <BlocoDemo titulo="Idade — quem segue" items={mapDemo(demo.follower_age)} />
              <BlocoDemo titulo="Idade — quem interage" items={mapDemo(demo.engaged_age)} />
              <BlocoDemo titulo="Género" items={mapDemo(demo.follower_gender, GENERO)} />
            </div>
            {(demo.follower_country || demo.engaged_country) && (
              <Nota>
                Compare as duas colunas de país: se quem interage não está onde estão os
                seguidores, o conteúdo chega a um público diferente do que já tem — útil saber
                antes de decidir onde investir em anúncios.
              </Nota>
            )}
          </>
        )}
      </Reveal>
    </>
  );
}

const td = { padding: '10px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
const tdNum = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const thumb = { width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)', flex: '0 0 auto' };

/* ---------------- peças ---------------- */

// KPI no padrão da aba Instagram: ou conta um número (value) ou mostra texto (text).
function Kpi({ label, period, value, text, delta: dl, foot, icon, color, d = 0 }) {
  return (
    <Reveal d={d} cls="glass kpi" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color, display: 'flex' }}><Icon name={icon} size={17} /></span>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{label}</span>
      </div>
      <div className="lbl" style={{ marginTop: 14, whiteSpace: 'nowrap' }}>{period}</div>
      <div className="val num" style={{ marginTop: 6, fontSize: 'clamp(28px,2.9vw,36px)' }}>
        {text != null ? text : value == null ? <span style={{ color: 'var(--fg-3)' }}>—</span> : <Ticker value={value} />}
      </div>
      {dl != null && value != null && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: dl > 0 ? 'var(--success)' : dl < 0 ? 'var(--danger)' : 'var(--fg-3)' }}>
          {dl > 0 ? '▲ ' : dl < 0 ? '▼ ' : ''}{Math.abs(dl).toFixed(0)}% vs. período anterior
        </div>
      )}
      {foot && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>{foot}</div>}
    </Reveal>
  );
}

function Metrica({ icon, label, value, total }) {
  const quota = total && value != null ? Math.round((value / total) * 100) : null;
  return (
    <div style={{ position: 'relative', padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2, rgba(255,255,255,.02))' }}>
      <span style={{ color: C.gold2, display: 'flex' }}><Icon name={icon} size={15} /></span>
      <div className="num" style={{ fontSize: 22, marginTop: 6, fontWeight: 700 }}>
        {value == null ? <span style={{ color: 'var(--fg-3)' }}>—</span> : nf(value)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>{label}</div>
      {quota != null && (
        <span style={{ position: 'absolute', top: 12, right: 14, fontSize: 11, fontWeight: 700, color: C.gold }}>{quota}%</span>
      )}
    </div>
  );
}

function Destaque({ post }) {
  const watch = fmtWatch(post.avg_watch_time);
  return (
    <Reveal cls="glass" style={{ padding: '22px 24px', marginBottom: 22 }}>
      <PanelHead over="Destaque" title="Publicação com mais engajamento" />
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Tilt cls="" style={{ flex: '0 0 168px', width: 168 }}>
          <a href={post.permalink || '#'} target="_blank" rel="noopener noreferrer"
             style={{ position: 'relative', display: 'block', width: 168, aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {post.thumb_url
              ? <img src={post.thumb_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <span style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold2 }}><Icon name="image" size={24} /></span>}
            <span className="chip chip-gold" style={{ position: 'absolute', top: 8, right: 8 }}>{post.format}</span>
          </a>
        </Tilt>

        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{fmtData(post.timestamp)}</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: '6px 0 16px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {post.caption || 'Sem legenda'}
          </p>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' }}>
            <Stat icon="target" label="Alcance" value={post.reach} />
            <Stat icon="eye" label="Visualizações" value={post.views} />
            <Stat icon="heart" label="Curtidas" value={post.likes} />
            <Stat icon="comment" label="Comentários" value={post.comments} />
            <Stat icon="save" label="Guardados" value={post.saved} />
            <Stat icon="ext" label="Partilhas" value={post.shares} />
            {post.profile_visits != null && <Stat icon="instagram" label="Visitas ao perfil" value={post.profile_visits} />}
            {post.follows != null && <Stat icon="users" label="Novos seguidores" value={post.follows} />}
            {watch && <Stat icon="clock" label="Tempo médio" text={watch} />}
            {post.rate != null && <Stat icon="trend" label="Taxa" text={pct(post.rate)} />}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function Stat({ icon, label, value, text }) {
  return (
    <div style={{ padding: '9px 12px', borderLeft: `2px solid ${C.gold}`, background: 'rgba(184,147,90,.07)', borderRadius: '0 8px 8px 0' }}>
      <span style={{ color: C.gold2, display: 'flex' }}><Icon name={icon} size={13} /></span>
      <div className="num" style={{ fontSize: 17, marginTop: 3, fontWeight: 700 }}>
        {text != null ? text : value == null ? '—' : nf(value)}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{label}</div>
    </div>
  );
}

// Barras horizontais. 'share' liga a percentagem — só faz sentido quando as linhas são
// partes de um todo (países, idades, género). Numa lista de médias, somar as linhas não
// dá total nenhum e a percentagem seria um número inventado.
function Barras({ items, share = true, vazio = 'Sem dados ainda.' }) {
  if (!items || !items.length) return <Nota>{vazio}</Nota>;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {items.map((i) => (
        <div key={i.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(78px,36%) 1fr auto', alignItems: 'center', gap: 10 }}>
          <span title={i.label} style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</span>
          <span style={{ height: 7, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', borderRadius: 99, width: `${(i.value / max) * 100}%`, background: `linear-gradient(90deg, ${C.gold2}, ${C.gold})`, transition: 'width .5s ease' }} />
          </span>
          <span className="num" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {nf(i.value)}
            {share && total > 0 && <em style={{ fontStyle: 'normal', color: 'var(--fg-3)', fontWeight: 400, marginLeft: 6 }}>{Math.round((i.value / total) * 100)}%</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

function BlocoDemo({ titulo, items }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <span className="overline">{titulo}</span>
      <div style={{ marginTop: 10 }}><Barras items={items} /></div>
    </div>
  );
}

function Nota({ children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.6, marginTop: 14 }}>
      <span style={{ flex: '0 0 auto', marginTop: 2 }}><Icon name="info" size={13} /></span>
      <span>{children}</span>
    </div>
  );
}

/* ============ FACEBOOK ============ */
// Estado honesto da ligação em vez de números inventados: a integração existente
// autentica-se pelo Instagram e não tem acesso à Página.
function Facebook({ fb }) {
  const passos = [
    ['Autorizar a Página', <>Facebook Login com as permissões <code>pages_read_engagement</code> e <code>pages_show_list</code>, para obter um token de Página de longa duração.</>],
    ['Guardar o token', <>Como segredo do Worker (à semelhança do <code>IG_SEED_TOKEN</code>), passando depois a viver no KV para poder renovar-se sozinho.</>],
    ['Recolher as métricas', <>O cron passa a ler alcance, interações e novos gostos da Página, e esta aba enche-se com os mesmos blocos do Instagram.</>],
  ];
  return (
    <Reveal cls="glass" style={{ padding: '40px 30px', textAlign: 'center' }}>
      <span style={{ color: C.gold, display: 'inline-flex' }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      </span>
      <div style={{ marginTop: 10 }}><span className="chip chip-gold">Por ligar</span></div>
      <h3 style={{ fontSize: 22, marginTop: 12 }}>{fb?.page || 'Página do Facebook'}</h3>
      <p style={{ fontSize: 13, color: 'var(--fg-3)', maxWidth: 500, margin: '10px auto 0', lineHeight: 1.7 }}>
        {fb?.reason || 'A ligação atual é só do Instagram.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '26px auto 0', textAlign: 'left' }}>
        {passos.map(([titulo, texto], i) => (
          <div key={titulo} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="num" style={{
              flex: '0 0 auto', width: 24, height: 24, borderRadius: 99, display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 12,
              border: `1px solid ${C.gold}`, color: C.gold,
            }}>{i + 1}</span>
            <div>
              <strong style={{ display: 'block', fontSize: 13.5 }}>{titulo}</strong>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.65, marginTop: 2 }}>{texto}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 26, fontSize: 12.5, color: 'var(--fg-3)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <Icon name="info" size={13} /> Enquanto isto não estiver feito, os números da Página vêem-se no Meta Business Suite.
      </div>
    </Reveal>
  );
}
