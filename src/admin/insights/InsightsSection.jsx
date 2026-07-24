// src/admin/insights/InsightsSection.jsx
// Aba "Insights" das Redes Sociais:
//  · Sugestões — botão Atualizar → a IA pesquisa nas fontes e devolve 10 temas
//    com potencial de engajamento, cada um com as fontes que o corroboram;
//    a partir de um tema gera-se o artigo (editor rico + imagens + pré-visualização).
//  · Fontes — canais acompanhados (nome, tipo, fiabilidade, engajamento, resumo);
//    a Dra. cola um link e a IA preenche os restantes campos.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { insights as api } from '../apiClient';
import SlidingTabs from '../tabs';
import { admToast } from '../toasts';
import { admConfirm, admPrompt } from '../dialogs';
import { POSTS } from '../../data/blog';
import ArticleStudio from './ArticleStudio';

const VISTAS = [
  { id: 'sugestoes', label: 'Sugestões' },
  { id: 'fontes', label: 'Fontes' },
];

const AREAS_LABEL = {
  familia: 'Família', civil: 'Civil', comercial: 'Comercial',
  cobranca: 'Cobrança', nacionalidade: 'Nacionalidade', notarial: 'Notarial',
};

const TIPO_LABEL = {
  governo: 'Governo', site: 'Site', blogue: 'Blogue',
  instagram: 'Instagram', midia: 'Mídia', escritorio: 'Escritório',
};

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
      <div className="adm-stat-toolbar">
        <SlidingTabs items={VISTAS} active={vista} onChange={setVista} variant="pills" />
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

const PASSOS_PESQUISA = [
  'A ler as fontes oficiais (AIMA, IRN, Finanças, Segurança Social)…',
  'A percorrer blogues e sites de escritórios com relevância…',
  'A verificar o que está a engajar no Instagram do nicho…',
  'A cruzar cada assunto em várias fontes…',
  'A ordenar os 10 temas por potencial de engajamento…',
];

function Sugestoes({ onAbrirArtigo }) {
  const [dados, setDados] = useState(null);   // { batch, topics }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [passo, setPasso] = useState(0);
  const [gerando, setGerando] = useState(null); // topic_id em geração
  const timerRef = useRef(null);

  const carregar = () => api.topics().then(setDados).catch((e) => admToast(e.message, { kind: 'error' }));

  useEffect(() => { carregar().finally(() => setLoading(false)); }, []);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const atualizar = async () => {
    setRefreshing(true);
    setPasso(0);
    timerRef.current = setInterval(() => setPasso((p) => (p + 1) % PASSOS_PESQUISA.length), 9000);
    try {
      const d = await api.refresh(POSTS.map((p) => p.titulo));
      setDados(d);
      admToast('Sugestões atualizadas — 10 novos temas.');
    } catch (e) {
      admToast(`Não foi possível atualizar: ${e.message}`, { kind: 'error' });
    } finally {
      clearInterval(timerRef.current);
      setRefreshing(false);
    }
  };

  const gerarArtigo = async (topic) => {
    if (topic.artigo_id) { onAbrirArtigo(topic.artigo_id); return; }
    setGerando(topic.id);
    try {
      const d = await api.generateArticle(topic.id);
      await carregar();
      onAbrirArtigo(d.article.id);
    } catch (e) {
      admToast(`Falha ao gerar o artigo: ${e.message}`, { kind: 'error' });
    } finally {
      setGerando(null);
    }
  };

  const topics = dados?.topics || [];

  return (
    <>
      <div className="adm-ins-head">
        <div className="adm-ins-head-txt">
          {dados?.batch
            ? <>Última atualização: <strong>{fmtDataHora(dados.batch.criado_em)}</strong></>
            : 'Ainda sem sugestões — clique em Atualizar para a primeira pesquisa.'}
        </div>
        <button type="button" className="adm-btn adm-btn-gold" onClick={atualizar} disabled={refreshing}>
          {refreshing ? <span className="adm-ins-spin" aria-hidden="true" /> : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
          )}
          {refreshing ? 'A pesquisar…' : 'Atualizar'}
        </button>
      </div>

      {refreshing && (
        <div className="adm-card adm-ins-progress">
          <div className="adm-ins-progress-bar"><span /></div>
          <div className="adm-ins-progress-txt">{PASSOS_PESQUISA[passo]}</div>
          <div className="adm-ins-progress-sub">Isto demora 1 a 2 minutos — a IA está mesmo a pesquisar na web.</div>
        </div>
      )}

      {loading ? (
        <div className="adm-card"><span className="adm-skel" style={{ width: '55%', height: 12, display: 'block' }} /></div>
      ) : !refreshing && !topics.length ? (
        <div className="adm-stat-coming">
          <div className="adm-stat-coming-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
          </div>
          <h3>Descubra o que vai engajar</h3>
          <p>
            Ao clicar em <strong>Atualizar</strong>, a IA pesquisa nas fontes jurídicas, oficiais e de
            imigração de Portugal e traz 10 assuntos com grande potencial de engajamento para o
            público da Dra. — cada um com as fontes que o confirmam.
          </p>
        </div>
      ) : (
        <div className="adm-ins-list">
          {topics.map((t, i) => (
            <TopicCard key={t.id} topic={t} pos={i + 1} gerando={gerando === t.id}
                       bloqueado={gerando != null} onGerar={() => gerarArtigo(t)} />
          ))}
        </div>
      )}
    </>
  );
}

function TopicCard({ topic, pos, gerando, bloqueado, onGerar }) {
  return (
    <div className="adm-card adm-ins-topic">
      <div className="adm-ins-topic-top">
        <span className="adm-ins-rank">{pos}</span>
        <div className="adm-ins-topic-main">
          <div className="adm-ins-topic-title">{topic.titulo}</div>
          <div className="adm-ins-topic-meta">
            {topic.area && <span className="adm-chip">{AREAS_LABEL[topic.area] || topic.area}</span>}
            {topic.score != null && (
              <span className="adm-ins-score" title="Potencial de engajamento estimado">
                <span className="adm-ins-score-bar"><span style={{ width: `${topic.score}%` }} /></span>
                {topic.score}
              </span>
            )}
            {topic.estado === 'artigo_gerado' && <span className="adm-badge adm-badge-paid">artigo gerado</span>}
          </div>
        </div>
        <button type="button" className={'adm-btn ' + (topic.artigo_id ? 'adm-btn-ghost' : 'adm-btn-primary')}
                onClick={onGerar} disabled={bloqueado}>
          {gerando ? <span className="adm-ins-spin dark" aria-hidden="true" /> : null}
          {gerando ? 'A escrever…' : topic.artigo_id ? 'Abrir artigo' : 'Gerar artigo'}
        </button>
      </div>
      <p className="adm-ins-topic-resumo">{topic.resumo}</p>
      {topic.justificacao && <p className="adm-ins-topic-justif">Porquê agora: {topic.justificacao}</p>}
      {Array.isArray(topic.fontes) && topic.fontes.length > 0 && (
        <div className="adm-ins-fontes">
          <span className="adm-ins-fontes-label">Fontes ({topic.fontes.length}):</span>
          {topic.fontes.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer" className="adm-ins-fonte-chip"
               title={(f.titulo ? `«${f.titulo}» — ` : '') + (f.url || '')}>
              <span className={'adm-ins-fonte-dot t-' + (f.tipo || 'site')} aria-hidden="true" />
              {f.nome || f.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================ FONTES

function Estrelinhas({ n, onChange, title }) {
  return (
    <span className="adm-ins-nivel" title={title} role={onChange ? 'group' : undefined}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" disabled={!onChange}
                className={'adm-ins-nivel-dot' + (i <= n ? ' on' : '')}
                onClick={onChange ? () => onChange(i) : undefined}
                aria-label={`${title}: ${i} de 5`} />
      ))}
    </span>
  );
}

function Fontes() {
  const [fontes, setFontes] = useState(null);
  const [url, setUrl] = useState('');
  const [adicionando, setAdicionando] = useState(false);

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
      admToast(d.preenchido_por_ia
        ? `Fonte «${d.source.nome}» adicionada — campos preenchidos pela IA.`
        : `Fonte adicionada. Não consegui identificar o canal; reveja os campos.`,
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

  return (
    <>
      <form className="adm-ins-addfonte" onSubmit={adicionar}>
        <input
          type="url" className="adm-ins-addfonte-input" placeholder="Cole o link de um site, blogue ou perfil de Instagram — a IA preenche o resto"
          value={url} onChange={(e) => setUrl(e.target.value)} disabled={adicionando} required
        />
        <button type="submit" className="adm-btn adm-btn-gold" disabled={adicionando || !url.trim()}>
          {adicionando ? <span className="adm-ins-spin" aria-hidden="true" /> : '+'}
          {adicionando ? 'A identificar…' : 'Adicionar fonte'}
        </button>
      </form>

      {!fontes ? (
        <div className="adm-card"><span className="adm-skel" style={{ width: '55%', height: 12, display: 'block' }} /></div>
      ) : (
        <div className="adm-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="adm-table adm-ins-fontes-table">
            <thead>
              <tr>
                <th>Canal</th><th>Tipo</th><th>Fiabilidade</th><th>Engajamento</th>
                <th title="Nº de sugestões já indicadas através deste canal">Indicados</th><th>Sobre o canal</th><th />
              </tr>
            </thead>
            <tbody>
              {fontes.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a href={f.url} target="_blank" rel="noreferrer" className="adm-ins-fonte-nome">{f.nome}</a>
                    {f.origem === 'manual' && <span className="adm-tag" style={{ marginLeft: 6 }}>adicionada</span>}
                  </td>
                  <td><span className={'adm-ins-tipo t-' + f.tipo}>{TIPO_LABEL[f.tipo] || f.tipo}</span></td>
                  <td><Estrelinhas n={f.fiabilidade} title="Fiabilidade" onChange={(v) => mudarNivel(f, 'fiabilidade', v)} /></td>
                  <td><Estrelinhas n={f.engajamento} title="Engajamento" onChange={(v) => mudarNivel(f, 'engajamento', v)} /></td>
                  <td className="adm-ins-indicados">{f.indicados}</td>
                  <td className="adm-ins-fonte-resumo" onDoubleClick={() => editarResumo(f)} title="Duplo clique para editar">{f.resumo || '—'}</td>
                  <td className="adm-ins-fonte-acoes">
                    <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => editarResumo(f)} title="Editar resumo">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                    </button>
                    <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm adm-ins-btn-danger" onClick={() => remover(f)} title="Remover fonte">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
