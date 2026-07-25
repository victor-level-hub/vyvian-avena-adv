// src/admin/insights/InsightsSection.jsx
// Aba "Insights" das Redes Sociais — redesign «Vyvian Avena Design System v3».
//  · Sugestões — Atualizar → StepLoader narrado → 10 temas em cartões de vidro
//    com numeral fantasma, score em gradiente e cruzamento de fontes.
//  · Fontes — campo «AI input» com shimmer, tabela em vidro no desktop e
//    cartões no telemóvel; barras animadas de fiabilidade/engajamento.
// Dados e endpoints inalterados.
import React, { useEffect, useRef, useState } from 'react';
import { insights as api } from '../apiClient';
import { admToast } from '../toasts';
import { admConfirm, admPrompt } from '../dialogs';
import { POSTS } from '../../data/blog';
import ArticleStudio from './ArticleStudio';
import { Icon, Reveal, Tip, Seg, StepLoader, Confetti, Level, PanelHead } from '../rs/ui';

const VISTAS = [
  { k: 'sugestoes', label: 'SUGESTÕES' },
  { k: 'fontes', label: 'FONTES' },
];

const AREAS_LABEL = {
  familia: 'Família', civil: 'Civil', comercial: 'Comercial',
  cobranca: 'Cobrança', nacionalidade: 'Nacionalidade', notarial: 'Notarial',
};
const AREA_COLOR = {
  nacionalidade: '#d4b585', familia: '#c89656', civil: '#a9b6d4',
  comercial: '#9fc4b6', cobranca: '#c9a6bd', notarial: '#9fc4b6',
};

const TIPO_LABEL = {
  governo: 'Governo', site: 'Site', blogue: 'Blogue',
  instagram: 'Instagram', midia: 'Mídia', escritorio: 'Escritório',
};
const TIPO_ICON = {
  governo: 'gov', site: 'globe', blogue: 'edit',
  instagram: 'instagram', midia: 'library', escritorio: 'library',
};

const PASSOS_PESQUISA = [
  'A consultar o diretório de fontes…',
  'A pesquisar a web por alterações legislativas…',
  'A cruzar notícias e a validar nas fontes oficiais…',
  'A medir potencial de engajamento por tema…',
  'A ordenar os 10 temas finais…',
];
const PASSOS_ARTIGO = [
  'A reunir as fontes do tema…',
  'A estruturar o artigo no padrão do blogue…',
  'A escrever com aviso legal…',
  'A calcular tempo de leitura e descrição SEO…',
];
const PASSOS_FONTE = [
  'A abrir o link e a ler o canal…',
  'A classificar tipo e fiabilidade…',
  'A estimar engajamento e a resumir…',
];

const fmtDataHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) +
    ' às ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
};

export default function InsightsSection() {
  const [vista, setVista] = useState('sugestoes');
  const [artigoId, setArtigoId] = useState(null);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <Seg items={VISTAS} value={vista} onChange={setVista} />
      </div>
      {vista === 'sugestoes'
        ? <Sugestoes onAbrirArtigo={setArtigoId} />
        : <Fontes />}
      {artigoId != null && (
        <ArticleStudio articleId={artigoId} onClose={() => setArtigoId(null)} />
      )}
    </>
  );
}

// ============================================================ SUGESTÕES

function ScoreMeter({ score, n }) {
  return (
    <Tip w={250} label={`Potencial de engajamento ${score}/100 — combina volume de pesquisa, frescura da notícia e número de fontes que a confirmam.`}>
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, cursor: 'help' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span className="num" style={{ fontSize: 26, lineHeight: 1, background: 'var(--grad-gold)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{score}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '.12em', fontWeight: 800 }}>/100</span>
        </span>
        <span className="bar" style={{ width: 86 }}><i style={{ width: score + '%', animationDelay: (n * .06 + .2) + 's' }} /></span>
      </span>
    </Tip>
  );
}

function TopicCard({ topic, pos, gerando, bloqueado, onGerar }) {
  const [hover, setHover] = useState(false);
  const col = AREA_COLOR[topic.area] || 'var(--gold-soft)';
  const fontes = Array.isArray(topic.fontes) ? topic.fontes : [];
  const nomesFontes = fontes.map((f) => f.nome || f.url).filter(Boolean);
  const gerado = topic.estado === 'artigo_gerado' || !!topic.artigo_id;
  return (
    <div className="glass" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
         style={{ padding: 0, overflow: 'hidden', animation: `rsRiseIn .6s var(--ease-out) ${(pos - 1) * 85}ms both`,
                  transform: hover ? 'translateY(-3px)' : 'none',
                  transition: 'transform .4s var(--ease-out),box-shadow .4s',
                  boxShadow: hover ? '0 30px 64px -28px rgba(0,0,0,.8),0 0 0 1px rgba(212,181,133,.28)' : 'var(--shadow)' }}>
      {pos === 1 && <><span className="beam" /><span className="beam-mask" /></>}
      <div style={{ position: 'relative', padding: '24px 26px 22px' }}>
        <span className="num" aria-hidden="true"
              style={{ position: 'absolute', right: 18, top: -6, fontSize: 108, lineHeight: 1, color: 'var(--edge)',
                       opacity: hover ? .9 : .55, transition: 'opacity .4s,transform .5s var(--ease-out)',
                       transform: hover ? 'translateY(2px) scale(1.04)' : 'none', pointerEvents: 'none' }}>
          {String(pos).padStart(2, '0')}
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {topic.area && <span className="chip" style={{ borderColor: col + '66', background: col + '1f', color: col }}>{AREAS_LABEL[topic.area] || topic.area}</span>}
              {pos === 1 && <span className="chip chip-gold"><Icon name="spark" size={11} />Maior potencial</span>}
              {gerado && <span className="chip chip-ok"><Icon name="check" size={11} s={3} />Artigo gerado</span>}
            </div>
            <h3 style={{ fontSize: 'clamp(19px,1.65vw,23px)', lineHeight: 1.24, marginTop: 13, maxWidth: '46ch', textWrap: 'pretty' }}>{topic.titulo}</h3>
            {topic.resumo && <p style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--fg-2)', marginTop: 11, maxWidth: '62ch', textWrap: 'pretty' }}>{topic.resumo}</p>}
            {topic.justificacao && (
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--fg-2)', marginTop: 13, paddingLeft: 13, borderLeft: '2px solid var(--edge-2)', fontStyle: 'italic', maxWidth: '62ch' }}>
                <strong style={{ fontStyle: 'normal', fontWeight: 800, letterSpacing: '.04em', color: 'var(--gold)', fontSize: 11.5, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Porquê agora</strong>
                {topic.justificacao}
              </p>
            )}
          </div>
          {topic.score != null && (
            <div className="only-desk" style={{ flex: 'none', textAlign: 'right', paddingTop: 4 }}>
              <ScoreMeter score={topic.score} n={pos} />
            </div>
          )}
        </div>
        {topic.score != null && <div className="only-mob" style={{ marginTop: 16 }}><ScoreMeter score={topic.score} n={pos} /></div>}
        <hr className="rule" style={{ margin: '20px 0 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {fontes.length > 0 && (
            <Tip w={260} label={`Cruzamento de ${fontes.length} fontes: ${nomesFontes.join(' · ')}. Quanto mais fontes independentes, maior a fiabilidade do tema.`}>
              <span className="chip" style={{ cursor: 'help' }}><Icon name="library" size={12} />Fontes ({fontes.length})</span>
            </Tip>
          )}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
            {fontes.slice(0, 3).map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer"
                 title={(f.titulo ? `«${f.titulo}» — ` : '') + (f.url || '')}
                 style={{ fontSize: 11.5, color: 'var(--fg-3)', padding: '4px 9px', borderRadius: 7, background: 'var(--panel)', border: '1px solid var(--edge)' }}>
                {f.nome || f.url}
              </a>
            ))}
            {fontes.length > 3 && <span style={{ fontSize: 11.5, color: 'var(--fg-3)', padding: '4px 9px' }}>+{fontes.length - 3}</span>}
          </div>
          <button type="button" className={'btn btn-sm ' + (gerado ? 'btn-ghost' : 'btn-gold')} onClick={onGerar} disabled={bloqueado}>
            <Icon name={gerado ? 'edit' : 'spark'} size={13} />
            {gerando ? 'A escrever…' : gerado ? 'Abrir artigo' : 'Gerar artigo'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sugestoes({ onAbrirArtigo }) {
  const [dados, setDados] = useState(null);   // { batch, topics }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erroRefresh, setErroRefresh] = useState(null);
  const [gerando, setGerando] = useState(null);      // topic em geração
  const [erroArtigo, setErroArtigo] = useState(null);
  const [fire, setFire] = useState(0);

  const carregar = () => api.topics().then(setDados).catch((e) => admToast(e.message, { kind: 'error' }));

  useEffect(() => { carregar().finally(() => setLoading(false)); }, []);

  const atualizar = async () => {
    setRefreshing(true);
    setErroRefresh(null);
    try {
      const d = await api.refresh(POSTS.map((p) => p.titulo));
      setDados(d);
      setRefreshing(false);
      setFire(Date.now());
      admToast('Sugestões atualizadas — 10 novos temas.');
    } catch (e) {
      setErroRefresh(e.message || 'Não foi possível atualizar.');
    }
  };

  const gerarArtigo = async (topic) => {
    if (topic.artigo_id) { onAbrirArtigo(topic.artigo_id); return; }
    setGerando(topic);
    setErroArtigo(null);
    try {
      const d = await api.generateArticle(topic.id);
      await carregar();
      setGerando(null);
      setFire(Date.now());
      setTimeout(() => onAbrirArtigo(d.article.id), 380);
    } catch (e) {
      setErroArtigo(e.message || 'Falha ao gerar o artigo.');
    }
  };

  const topics = dados?.topics || [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <span className="overline">Motor editorial</span>
          <div style={{ fontSize: 13.5, color: 'var(--fg-2)', marginTop: 6 }}>
            {dados?.batch
              ? <>10 temas ordenados por potencial de engajamento · última atualização <strong style={{ color: 'var(--fg)', fontWeight: 700 }}>{fmtDataHora(dados.batch.criado_em)}</strong></>
              : 'Ainda sem sugestões — clique em Atualizar para a primeira pesquisa.'}
          </div>
        </div>
        <button type="button" className="btn btn-gold" style={{ marginLeft: 'auto' }} onClick={atualizar} disabled={refreshing}>
          <Icon name="refresh" size={14} />Atualizar
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass" style={{ padding: 26, minHeight: 120 }}>
              <span className="adm-skel" style={{ width: '30%', height: 10, display: 'block' }} />
              <span className="adm-skel" style={{ width: '65%', height: 18, display: 'block', marginTop: 16 }} />
            </div>
          ))}
        </div>
      ) : !refreshing && !topics.length ? (
        <Reveal cls="glass" style={{ padding: '44px 30px', textAlign: 'center' }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto', background: 'var(--grad-gold-soft)', border: '1px solid var(--edge-2)', display: 'grid', placeItems: 'center', color: 'var(--gold-soft)' }}>
            <Icon name="spark" size={24} />
          </span>
          <h3 style={{ fontSize: 24, marginTop: 18 }}>Descubra o que vai engajar</h3>
          <p style={{ fontSize: 13.5, color: 'var(--fg-2)', maxWidth: '54ch', margin: '12px auto 0', lineHeight: 1.6 }}>
            Ao clicar em <strong style={{ color: 'var(--fg)' }}>Atualizar</strong>, a IA pesquisa nas fontes jurídicas,
            oficiais e de imigração de Portugal e traz 10 assuntos com grande potencial de engajamento —
            cada um com as fontes que o confirmam.
          </p>
        </Reveal>
      ) : (
        <div style={{ display: 'grid', gap: 16 }} key={dados?.batch?.criado_em || 'lista'}>
          {topics.map((t, i) => (
            <TopicCard key={t.id} topic={t} pos={i + 1}
                       gerando={gerando?.id === t.id} bloqueado={gerando != null}
                       onGerar={() => gerarArtigo(t)} />
          ))}
        </div>
      )}

      <StepLoader open={refreshing} steps={PASSOS_PESQUISA} per={18000}
                  title="A pesquisar temas com potencial (1–2 min)"
                  error={erroRefresh}
                  onRetry={() => atualizar()}
                  onCancel={() => { setRefreshing(false); setErroRefresh(null); }} />
      <StepLoader open={gerando != null} steps={PASSOS_ARTIGO} per={14000}
                  title={gerando ? `A gerar artigo · ${AREAS_LABEL[gerando.area] || 'Blogue'} (~1 min)` : ''}
                  error={erroArtigo}
                  onRetry={() => gerarArtigo(gerando)}
                  onCancel={() => { setGerando(null); setErroArtigo(null); }} />
      <Confetti fire={fire} key={fire} />
    </>
  );
}

// ============================================================ FONTES

function SourceHover({ s, children }) {
  const [on, setOn] = useState(false);
  let host = '';
  try { host = s.url ? new URL(s.url).host.replace('www.', '') : ''; } catch { host = s.url || ''; }
  return (
    <span style={{ position: 'relative', display: 'inline-block' }} onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}>
      {children}
      <span style={{ position: 'absolute', left: 0, top: 'calc(100% + 9px)', width: 290, opacity: on ? 1 : 0,
                     transform: `translateY(${on ? 0 : 6}px)`, pointerEvents: 'none', transition: 'all .24s var(--ease-out)', zIndex: 50 }}>
        <span style={{ display: 'block', background: 'var(--panel-flat)', border: '1px solid var(--edge-2)', borderRadius: 14, padding: 14, boxShadow: 'var(--shadow)' }}>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--grad-gold-soft)', border: '1px solid var(--edge)', display: 'grid', placeItems: 'center', color: 'var(--gold-soft)', flex: 'none' }}>
              <Icon name={TIPO_ICON[s.tipo] || 'globe'} size={15} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nome}</span>
              <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)' }}>{host}</span>
            </span>
          </span>
          {s.resumo && <span style={{ display: 'block', fontSize: 12, lineHeight: 1.55, color: 'var(--fg-2)', marginTop: 10 }}>{s.resumo}</span>}
          <span style={{ display: 'flex', gap: 16, marginTop: 11, fontSize: 10.5, letterSpacing: '.1em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>
            <span>Fiabilidade {s.fiabilidade}/5</span><span>Engajamento {s.engajamento}/5</span><span>{s.indicados} temas</span>
          </span>
        </span>
      </span>
    </span>
  );
}

function Fontes() {
  const [fontes, setFontes] = useState(null);
  const [url, setUrl] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [novaId, setNovaId] = useState(null);
  const [fire, setFire] = useState(0);

  const carregar = () => api.sources().then((d) => setFontes(d.sources)).catch((e) => admToast(e.message, { kind: 'error' }));
  useEffect(() => { carregar(); }, []);

  const adicionar = async (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    setAdicionando(true);
    try {
      const d = await api.addSource(u);
      setUrl('');
      await carregar();
      setNovaId(d.source?.id ?? null);
      setFire(Date.now());
      admToast(d.preenchido_por_ia
        ? `Fonte «${d.source.nome}» adicionada — campos preenchidos pela IA.`
        : 'Fonte adicionada. Não consegui identificar o canal; reveja os campos.',
        { kind: d.preenchido_por_ia ? 'success' : 'info' });
    } catch (err) {
      admToast(err.message, { kind: 'error' });
    } finally {
      setAdicionando(false);
    }
  };

  const mudarNivel = async (fonte, campo, valor) => {
    try {
      await api.updateSource(fonte.id, { [campo]: valor });
      setFontes((fs) => fs.map((f) => (f.id === fonte.id ? { ...f, [campo]: valor } : f)));
    } catch (err) { admToast(err.message, { kind: 'error' }); }
  };

  const editarResumo = async (fonte) => {
    const novo = await admPrompt('Resumo do canal (que temas costuma tratar):', {
      title: fonte.nome, defaultValue: fonte.resumo || '',
    });
    if (novo == null) return;
    try {
      await api.updateSource(fonte.id, { resumo: novo });
      setFontes((fs) => fs.map((f) => (f.id === fonte.id ? { ...f, resumo: novo } : f)));
    } catch (err) { admToast(err.message, { kind: 'error' }); }
  };

  const remover = async (fonte) => {
    const ok = await admConfirm(`Remover a fonte «${fonte.nome}» da lista?`, { danger: true, okLabel: 'Remover' });
    if (!ok) return;
    try {
      await api.removeSource(fonte.id);
      setFontes((fs) => fs.filter((f) => f.id !== fonte.id));
      admToast('Fonte removida.');
    } catch (err) { admToast(err.message, { kind: 'error' }); }
  };

  const adicionadas = (fontes || []).filter((f) => f.origem === 'manual').length;

  return (
    <>
      <div className="glass" style={{ padding: '22px 24px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        {adicionando && <span className="shimmer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
        <div style={{ position: 'relative' }}>
          <span className="overline">Adicionar fonte</span>
          <form onSubmit={adicionar} style={{ display: 'flex', gap: 12, marginTop: 13, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
              <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)',
                             color: adicionando ? 'var(--gold-soft)' : 'var(--fg-3)', display: 'flex',
                             animation: adicionando ? 'rsFloatY 1.6s infinite' : 'none' }}>
                <Icon name={adicionando ? 'spark' : 'link'} size={16} />
              </span>
              <input type="url" className="field" style={{ paddingLeft: 43 }} value={url} disabled={adicionando} required
                     onChange={(e) => setUrl(e.target.value)}
                     placeholder="Cole o link de um site, blogue ou perfil de Instagram — a IA preenche o resto" />
            </div>
            <button type="submit" className="btn btn-gold" disabled={adicionando || !url.trim()}>
              {adicionando ? 'A analisar…' : <><Icon name="plus" size={14} />Adicionar fonte</>}
            </button>
          </form>
          {adicionando
            ? <div style={{ display: 'grid', gap: 4, marginTop: 15 }}>
                {PASSOS_FONTE.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, color: 'var(--fg-2)', animation: `rsRiseInSm .4s ${i * 6}s var(--ease-out) both` }}>
                    <Icon name="check" size={12} s={3} style={{ color: 'var(--gold)' }} />{s}
                  </div>
                ))}
              </div>
            : <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12 }}>A classificação automática leva 20–40 s: nome, tipo, fiabilidade, engajamento e resumo.</div>}
        </div>
      </div>

      {!fontes ? (
        <div className="glass" style={{ padding: 24 }}>
          <span className="adm-skel" style={{ width: '55%', height: 12, display: 'block' }} />
        </div>
      ) : (
        <>
          <PanelHead over={`Diretório · ${fontes.length} ${fontes.length === 1 ? 'canal' : 'canais'}`} title="Fontes"
            note="Indicados = número de temas que citaram esta fonte."
            right={adicionadas > 0 && <span className="chip chip-gold"><Icon name="spark" size={12} />{adicionadas} adicionada{adicionadas === 1 ? '' : 's'} pela Dra.</span>} />

          <div className="glass only-desk" style={{ padding: '20px 8px 10px', overflow: 'visible' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Canal</th><th>Tipo</th><th>Fiabilidade</th><th>Engajamento</th>
                  <th style={{ textAlign: 'center' }}>Indicados</th><th>Sobre o canal</th><th />
                </tr>
              </thead>
              <tbody>
                {fontes.map((f, i) => {
                  const manual = f.origem === 'manual';
                  return (
                    <tr key={f.id} style={{ background: f.id === novaId ? 'rgba(184,147,90,.10)' : undefined,
                                            animation: f.id === novaId ? 'rsRiseInSm .5s var(--ease-out) both' : `rsFadeIn .5s ${Math.min(i, 8) * 45}ms both` }}>
                      <td style={{ maxWidth: 250 }}>
                        <SourceHover s={f}>
                          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center',
                                           border: '1px solid ' + (manual ? 'rgba(184,147,90,.5)' : 'var(--edge)'),
                                           background: manual ? 'rgba(184,147,90,.14)' : 'var(--panel)',
                                           color: manual ? 'var(--gold-soft)' : 'var(--fg-3)' }}>
                              <Icon name={TIPO_ICON[f.tipo] || 'globe'} size={14} />
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                                <a href={f.url} target="_blank" rel="noreferrer"
                                   style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>
                                  {f.nome}
                                </a>
                                {manual && <span style={{ flex: 'none', fontSize: 8.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1a1208', background: 'var(--grad-gold)', padding: '2px 6px', borderRadius: 5 }}>adicionada</span>}
                              </span>
                              <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)' }}>{hostDe(f.url)}</span>
                            </span>
                          </span>
                        </SourceHover>
                      </td>
                      <td><span className="chip" style={{ fontSize: 9.5 }}>{TIPO_LABEL[f.tipo] || f.tipo}</span></td>
                      <td><Level n={f.fiabilidade} label="Fiabilidade: peso da fonte na validação de um tema (5 = fonte oficial)." onChange={(v) => mudarNivel(f, 'fiabilidade', v)} /></td>
                      <td><Level n={f.engajamento} label="Engajamento: alcance típico do canal junto do público-alvo." onChange={(v) => mudarNivel(f, 'engajamento', v)} /></td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="num" style={{ fontSize: 17, color: f.indicados ? 'var(--gold-soft)' : 'var(--fg-3)' }}>{f.indicados}</span>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5, maxWidth: 330, cursor: 'text' }}
                          onDoubleClick={() => editarResumo(f)} title="Duplo clique para editar">
                        {f.resumo || '—'}
                      </td>
                      <td>
                        <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button type="button" className="btn-quiet" title="Editar resumo" style={{ padding: 7, borderRadius: 8 }} onClick={() => editarResumo(f)}><Icon name="edit" size={15} /></button>
                          <button type="button" className="btn-quiet" title="Apagar" style={{ padding: 7, borderRadius: 8 }} onClick={() => remover(f)}><Icon name="trash" size={15} /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="only-mob" style={{ display: 'grid', gap: 12 }}>
            {fontes.map((f, i) => {
              const manual = f.origem === 'manual';
              return (
                <div key={f.id} className="glass" style={{ padding: 17, borderColor: manual ? 'rgba(184,147,90,.34)' : 'var(--edge)', animation: `rsRiseInSm .45s ${Math.min(i, 8) * 50}ms both` }}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                    <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', border: '1px solid var(--edge)',
                                   background: manual ? 'rgba(184,147,90,.14)' : 'var(--panel)', color: manual ? 'var(--gold-soft)' : 'var(--fg-3)' }}>
                      <Icon name={TIPO_ICON[f.tipo] || 'globe'} size={15} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <a href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nome}</a>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{TIPO_LABEL[f.tipo] || f.tipo} · {f.indicados} temas</div>
                    </div>
                    {manual && <span style={{ flex: 'none', fontSize: 8.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1a1208', background: 'var(--grad-gold)', padding: '3px 7px', borderRadius: 5 }}>adicionada</span>}
                    <button type="button" className="btn-quiet" title="Apagar" style={{ padding: 6 }} onClick={() => remover(f)}><Icon name="trash" size={14} /></button>
                  </div>
                  {f.resumo && <p style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55, marginTop: 11 }} onDoubleClick={() => editarResumo(f)}>{f.resumo}</p>}
                  <div style={{ display: 'flex', gap: 18, marginTop: 13, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>Fiabilidade</span>
                      <Level n={f.fiabilidade} label="Peso da fonte na validação de um tema." onChange={(v) => mudarNivel(f, 'fiabilidade', v)} />
                    </span>
                    <span style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>Engajamento</span>
                      <Level n={f.engajamento} label="Alcance típico junto do público-alvo." onChange={(v) => mudarNivel(f, 'engajamento', v)} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <Confetti fire={fire} key={fire} />
    </>
  );
}

function hostDe(url) {
  try { return new URL(url).host.replace('www.', ''); } catch { return url || ''; }
}
