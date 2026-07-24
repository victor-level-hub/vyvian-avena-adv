// src/admin/insights/ArticleStudio.jsx
// Estúdio do artigo gerado a partir de uma sugestão de Insights:
//  · editor de texto rico (Markdown ↔ TipTap) com título e descrição editáveis;
//  · geração de 4 opções de imagem (Gemini; fallback Recraft) + "gerar todas novamente";
//  · pré-visualização do artigo com o visual do blogue (hero + prosa).
// Overlay a ecrã inteiro, por cima da página Redes Sociais.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { insights as api } from '../apiClient';
import { admToast } from '../toasts';
import { admConfirm } from '../dialogs';

const RichEditor = React.lazy(() => import('./RichEditor'));

const AREAS_LABEL = {
  familia: 'Direito de Família', civil: 'Direito Civil', comercial: 'Direito Comercial',
  cobranca: 'Cobrança de Dívida', nacionalidade: 'Nacionalidade', notarial: 'Direito Notarial',
};

const minutosLeitura = (md) =>
  Math.max(1, Math.round((md || '').replace(/[#>*_`\-]/g, ' ').split(/\s+/).filter(Boolean).length / 200));

export default function ArticleStudio({ articleId, onClose }) {
  const [data, setData] = useState(null);          // { article, images, ronda }
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [sujo, setSujo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [gerandoImgs, setGerandoImgs] = useState(false);
  const [urls, setUrls] = useState({});            // imageId -> objectURL
  const [preview, setPreview] = useState(false);
  const mdRef = useRef('');

  useEffect(() => {
    api.getArticle(articleId).then((d) => {
      setData(d);
      setTitulo(d.article.titulo || '');
      setDescricao(d.article.descricao || '');
      setMarkdown(d.article.markdown || '');
      mdRef.current = d.article.markdown || '';
    }).catch((e) => { admToast(e.message, { kind: 'error' }); onClose(); });
  }, [articleId, onClose]);

  // blob-URLs autenticadas para as imagens da ronda atual
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!data?.images?.length) return;
      const novo = {};
      await Promise.all(data.images.map(async (img) => { novo[img.id] = await api.imageUrl(img.id); }));
      if (vivo) setUrls((prev) => {
        Object.values(prev).forEach((u) => u && URL.revokeObjectURL(u));
        return novo;
      });
    })();
    return () => { vivo = false; };
  }, [data?.images?.map((i) => i.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)); }, []); // eslint-disable-line

  // Esc fecha (pré-visualização primeiro, depois o estúdio)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setPreview((p) => { if (p) return false; fechar(); return p; }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sujo]);

  const onMd = (md) => { mdRef.current = md; setSujo(true); };

  const guardar = async (silencioso = false) => {
    setGuardando(true);
    try {
      const d = await api.saveArticle(articleId, { titulo, descricao, markdown: mdRef.current });
      setData(d);
      setSujo(false);
      if (!silencioso) admToast('Artigo guardado.');
      return true;
    } catch (e) {
      admToast(`Não foi possível guardar: ${e.message}`, { kind: 'error' });
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const fechar = async () => {
    if (sujo || titulo !== (data?.article.titulo || '') || descricao !== (data?.article.descricao || '')) {
      const ok = await admConfirm('Guardar as alterações antes de fechar?', { okLabel: 'Guardar e fechar', cancelLabel: 'Sair sem guardar' });
      if (ok) await guardar(true);
    }
    onClose();
  };

  const gerarImagens = async () => {
    const regen = (data?.images?.length || 0) > 0;
    if (regen) {
      const ok = await admConfirm('Gerar 4 novas opções? As atuais deixam de estar disponíveis para escolha.', { okLabel: 'Gerar novamente' });
      if (!ok) return;
    }
    setGerandoImgs(true);
    try {
      const d = await api.generateImages(articleId);
      setData(d);
      admToast(`${d.images.length} ${d.images.length === 1 ? 'imagem gerada' : 'imagens geradas'}.`);
    } catch (e) {
      admToast(`Falha ao gerar imagens: ${e.message}`, { kind: 'error' });
    } finally {
      setGerandoImgs(false);
    }
  };

  const escolher = async (imgId) => {
    try {
      const d = await api.chooseImage(articleId, imgId);
      setData(d);
      admToast('Imagem escolhida para a capa.');
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

  const a = data?.article;
  const escolhida = a?.imagem_escolhida || null;
  const tituloLongo = titulo.length > 60;

  if (!data) {
    return (
      <div className="adm-ins-studio"><div className="adm-ins-studio-load">
        <span className="adm-ins-spin dark" aria-hidden="true" /> A abrir o artigo…
      </div></div>
    );
  }

  return (
    <div className="adm-ins-studio" role="dialog" aria-modal="true" aria-label="Editor do artigo">
      <header className="adm-ins-studio-head">
        <button type="button" className="adm-btn adm-btn-ghost" onClick={fechar}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Voltar
        </button>
        <div className="adm-ins-studio-headinfo">
          <span className="adm-tag">{AREAS_LABEL[a.area] || 'Blogue'}</span>
          <span className="adm-tag">{a.idioma === 'pt-BR' ? 'PT-BR' : 'PT-PT'}</span>
          <span className="adm-tag">{minutosLeitura(mdRef.current || markdown)} min de leitura</span>
        </div>
        <div className="adm-ins-studio-headbtns">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={async () => { if (sujo) await guardar(true); setPreview(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            Pré-visualizar
          </button>
          <button type="button" className="adm-btn adm-btn-gold" onClick={() => guardar()} disabled={guardando}>
            {guardando ? <span className="adm-ins-spin" aria-hidden="true" /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            )}
            {guardando ? 'A guardar…' : sujo ? 'Guardar alterações' : 'Guardado'}
          </button>
        </div>
      </header>

      <div className="adm-ins-studio-body">
        <div className="adm-ins-studio-editor">
          <div className="adm-field">
            <label>Título {tituloLongo && <em className="adm-ins-avisochars">({titulo.length}/60 — o SEO trava títulos acima de 60)</em>}</label>
            <input value={titulo} onChange={(e) => { setTitulo(e.target.value); setSujo(true); }} maxLength={120}
                   className={tituloLongo ? 'adm-ins-input-warn' : ''} />
          </div>
          <div className="adm-field">
            <label>Descrição (metas/SEO — {descricao.length}/155)</label>
            <textarea rows={2} value={descricao} maxLength={200}
                      onChange={(e) => { setDescricao(e.target.value); setSujo(true); }} />
          </div>
          <Suspense fallback={<div className="adm-rte"><div className="adm-rte-loading">A carregar o editor…</div></div>}>
            <RichEditor initialMarkdown={markdown} onChangeMarkdown={onMd} placeholder="Corpo do artigo…" />
          </Suspense>
        </div>

        <aside className="adm-ins-studio-rail">
          <div className="adm-card">
            <div className="adm-card-title">Imagem do artigo</div>
            {gerandoImgs ? (
              <>
                <div className="adm-ins-imgs">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="adm-ins-img adm-ins-img-skel"><span className="adm-skel" /></div>)}
                </div>
                <div className="adm-ins-progress-sub" style={{ marginTop: 8 }}>
                  A gerar 4 opções na direção de arte da marca… (até ~1 min)
                </div>
              </>
            ) : data.images.length ? (
              <>
                <div className="adm-ins-imgs">
                  {data.images.map((img, i) => (
                    <button key={img.id} type="button"
                            className={'adm-ins-img' + (escolhida === img.id ? ' escolhida' : '')}
                            onClick={() => escolher(img.id)}
                            title={`Opção ${i + 1} · ${img.provider}`}>
                      {urls[img.id]
                        ? <img src={urls[img.id]} alt={`Opção ${i + 1}`} />
                        : <span className="adm-skel" />}
                      {escolhida === img.id && (
                        <span className="adm-ins-img-check" aria-label="Escolhida">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="adm-ins-img-hint">
                  {escolhida ? 'Capa escolhida. Pode trocar clicando noutra opção.' : 'Clique numa imagem para a escolher como capa.'}
                </div>
                <button type="button" className="adm-btn adm-btn-ghost" style={{ width: '100%', marginTop: 8 }}
                        onClick={gerarImagens}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                  Gerar todas novamente
                </button>
              </>
            ) : (
              <>
                <p className="adm-ins-img-intro">
                  Gere 4 opções de capa na direção de arte do blogue (Gemini). Depois escolha
                  a preferida — ou gere todas novamente.
                </p>
                <button type="button" className="adm-btn adm-btn-primary" style={{ width: '100%' }}
                        onClick={gerarImagens}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
                  Gerar 4 opções de imagem
                </button>
              </>
            )}
          </div>

          <div className="adm-card">
            <div className="adm-card-title">Publicação</div>
            <p className="adm-ins-img-intro">
              Este artigo fica guardado como rascunho na área privada. A publicação no blogue
              (fotos com marca de água, áudio do Modo Leitor, build e deploy) continua a ser
              feita pelo fluxo habitual com o Victor.
            </p>
          </div>
        </aside>
      </div>

      {preview && (
        <PreviewBlogue
          titulo={titulo} descricao={descricao} area={a.area}
          markdown={mdRef.current || markdown}
          capaUrl={escolhida ? urls[escolhida] : null}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------- Pré-visualização

function PreviewBlogue({ titulo, descricao, area, markdown, capaUrl, onClose }) {
  const html = useMemo(() => marked.parse(markdown || ''), [markdown]);
  const hoje = new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="adm-ins-preview" role="dialog" aria-modal="true" aria-label="Pré-visualização do artigo">
      <div className="adm-ins-preview-top">
        <span>Pré-visualização — assim ficará no blogue</span>
        <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m18 6-12 12M6 6l12 12" /></svg>
          Fechar
        </button>
      </div>
      <div className="adm-ins-preview-scroll">
        <section className="adm-ins-hero">
          {capaUrl && <img src={capaUrl} alt="" className="adm-ins-hero-img" />}
          <div className="adm-ins-hero-grad" />
          <div className="adm-ins-hero-inner">
            <div className="adm-ins-hero-rule" />
            <div className="adm-ins-hero-meta">
              {(AREAS_LABEL[area] || 'Blogue')} · {hoje} · {minutosLeitura(markdown)} min de leitura
            </div>
            <h1 className="adm-ins-hero-title">{titulo}</h1>
          </div>
        </section>
        <div className="adm-ins-preview-body">
          <aside className="adm-ins-preview-rail">
            <div className="adm-ins-rail-label">Neste artigo</div>
            <p className="adm-ins-rail-desc">{descricao}</p>
            <div className="adm-ins-rail-rule" />
            <div className="adm-ins-rail-label">Escrito por</div>
            <div className="adm-ins-rail-autor">Dra. Vyvian Avena</div>
            <div className="adm-ins-rail-sub">Advogada · Portugal e Brasil</div>
          </aside>
          <article className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
