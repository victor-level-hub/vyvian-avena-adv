// src/admin/insights/ArticleStudio.jsx
// Estúdio do artigo — redesign «Vyvian Avena Design System v3».
//  · header de vidro (Voltar · chips · Pré-visualizar · Guardar com confetti);
//  · título Fraunces editável + descrição SEO com contador e barra âmbar/vermelho;
//  · editor rico TipTap (re-skin via rs-theme.css) · capas com hover direcional;
//  · StepLoader narrado na geração de imagens · pré-visualização com contraste AA.
// Lógica e endpoints inalterados.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { insights as api } from '../apiClient';
import { admToast } from '../toasts';
import { admConfirm } from '../dialogs';
import { Icon, Tip, StepLoader, Confetti, Thumb } from '../rs/ui';

const RichEditor = React.lazy(() => import('./RichEditor'));

const AREAS_LABEL = {
  familia: 'Direito de Família', civil: 'Direito Civil', comercial: 'Direito Comercial',
  cobranca: 'Cobrança de Dívida', nacionalidade: 'Nacionalidade', notarial: 'Direito Notarial',
};

const PASSOS_IMAGENS = [
  'A ler o artigo e a extrair o tema visual…',
  'A compor 4 direções de imagem…',
  'A gerar em alta resolução (Gemini)…',
  'A guardar no R2 e a otimizar…',
];

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
  const [erroImgs, setErroImgs] = useState(null);
  const [urls, setUrls] = useState({});            // imageId -> objectURL
  const [preview, setPreview] = useState(false);
  const [fire, setFire] = useState(0);
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
      if (!silencioso) { setFire(Date.now()); admToast('Artigo guardado.'); }
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
    setErroImgs(null);
    try {
      const d = await api.generateImages(articleId);
      setData(d);
      setGerandoImgs(false);
      setFire(Date.now());
      admToast(`${d.images.length} ${d.images.length === 1 ? 'imagem gerada' : 'imagens geradas'}.`);
    } catch (e) {
      setErroImgs(e.message || 'Falha ao gerar as imagens.');
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
  const temAviso = /(^|\n)\s*>/.test(mdRef.current || markdown);

  if (!data) {
    return (
      <div className="rs-studio">
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: 'var(--fg-2)', fontSize: 14 }}>
          A abrir o artigo…
        </div>
      </div>
    );
  }

  return (
    <div className="rs-studio" role="dialog" aria-modal="true" aria-label="Editor do artigo">
      <div className="rs-studio-inner">
        {/* -------- header -------- */}
        <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', marginBottom: 22, flexWrap: 'wrap', borderRadius: 16 }}>
          <button type="button" className="btn btn-quiet" onClick={fechar}
                  style={{ letterSpacing: '.12em', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', display: 'inline-flex', gap: 7, alignItems: 'center' }}>
            <Icon name="back" size={15} />Voltar
          </button>
          <span style={{ width: 1, height: 20, background: 'var(--edge)' }} />
          <span className="chip chip-gold">{AREAS_LABEL[a.area] || 'Blogue'}</span>
          <span className="chip">{a.idioma === 'pt-BR' ? 'PT-BR' : 'PT-PT'}</span>
          <span className="chip"><Icon name="clock" size={11} />{minutosLeitura(mdRef.current || markdown)} min de leitura</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { if (sujo) await guardar(true); setPreview(true); }}>
              <Icon name="eye" size={14} />Pré-visualizar
            </button>
            <button type="button" className={'btn btn-sm ' + (sujo ? 'btn-gold' : 'btn-ghost')} onClick={() => guardar()} disabled={guardando}>
              <Icon name={sujo ? 'save' : 'check'} size={14} s={sujo ? 1.6 : 3} />
              {guardando ? 'A guardar…' : sujo ? 'Guardar' : 'Guardado'}
            </button>
          </span>
        </div>

        <div className="ed-grid">
          {/* -------- coluna principal -------- */}
          <div style={{ minWidth: 0 }}>
            <div className="glass" style={{ padding: '26px 28px 24px', marginBottom: 16 }}>
              <span className="overline">
                Título{tituloLongo && <em style={{ color: 'var(--warn)', textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontStyle: 'normal', marginLeft: 8 }}>({titulo.length}/60 — o SEO trava títulos acima de 60)</em>}
              </span>
              <textarea rows={2} value={titulo} maxLength={120}
                        onChange={(e) => { setTitulo(e.target.value); setSujo(true); }}
                        style={{ width: '100%', background: 'none', border: 0, resize: 'none', fontFamily: 'Fraunces,Georgia,serif',
                                 fontSize: 'clamp(24px,2.5vw,32px)', lineHeight: 1.2, letterSpacing: '-.02em', color: 'var(--fg)', marginTop: 10, outline: 'none' }} />
              <hr className="rule" style={{ margin: '14px 0 18px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span className="overline">Descrição SEO</span>
                <span className="mono" style={{ fontSize: 11, color: descricao.length > 155 ? 'var(--danger)' : descricao.length > 140 ? 'var(--warn)' : 'var(--fg-3)' }}>
                  {descricao.length}/155
                </span>
              </div>
              <textarea rows={2} value={descricao} maxLength={200}
                        onChange={(e) => { setDescricao(e.target.value); setSujo(true); }}
                        style={{ width: '100%', background: 'none', border: 0, resize: 'none', fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', marginTop: 8, outline: 'none' }} />
              <div style={{ height: 3, borderRadius: 9, background: 'var(--edge)', overflow: 'hidden', marginTop: 6 }}>
                <span style={{ display: 'block', height: '100%', width: Math.min(100, (descricao.length / 155) * 100) + '%',
                               background: descricao.length > 155 ? 'var(--danger)' : 'var(--grad-gold)', transition: 'width .3s' }} />
              </div>
            </div>

            <Suspense fallback={<div className="glass" style={{ padding: 30, color: 'var(--fg-3)', fontSize: 13 }}>A carregar o editor…</div>}>
              <RichEditor initialMarkdown={markdown} onChangeMarkdown={onMd} placeholder="Corpo do artigo…" />
            </Suspense>
          </div>

          {/* -------- sidebar -------- */}
          <div className="ed-side">
            <div className="glass" style={{ padding: '20px 20px 22px' }}>
              <span className="overline">Imagem do artigo</span>
              {gerandoImgs ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ aspectRatio: '4/3', borderRadius: 13, overflow: 'hidden', position: 'relative', background: 'var(--panel)' }}>
                      <span className="shimmer" style={{ position: 'absolute', inset: 0 }} />
                    </div>
                  ))}
                </div>
              ) : data.images.length ? (
                <>
                  <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.5 }}>
                    4 opções geradas por IA. {escolhida ? 'Pode trocar clicando noutra opção.' : 'Clique numa imagem para a escolher como capa.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                    {data.images.map((img, i) => (
                      <CoverOption key={img.id} src={urls[img.id]} i={i} provider={img.provider}
                                   chosen={escolhida === img.id} onPick={() => escolher(img.id)} />
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={gerarImagens}>
                    <Icon name="refresh" size={13} />Gerar todas novamente
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 9, textAlign: 'center' }}>1–2 min · Gemini, fallback Recraft</div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
                    Gere 4 opções de capa na direção de arte do blogue. Depois escolha a preferida — ou gere todas novamente.
                  </p>
                  <button type="button" className="btn btn-gold btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={gerarImagens}>
                    <Icon name="image" size={13} />Gerar 4 opções de imagem
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 9, textAlign: 'center' }}>1–2 min · Gemini, fallback Recraft</div>
                </>
              )}
            </div>

            <div className="glass" style={{ padding: 20 }}>
              <span className="overline">Publicação</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--warn)', boxShadow: '0 0 0 4px rgba(200,150,86,.18)' }} />
                <span style={{ fontSize: 13.5 }}>Rascunho pronto a revisão</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 11, lineHeight: 1.55 }}>
                A publicação final no blogue segue fluxo manual — depois de aprovar, o artigo é colocado em produção pelo Victor.
              </p>
              <hr className="rule" style={{ margin: '15px 0' }} />
              <div style={{ display: 'grid', gap: 9 }}>
                {[
                  ['Aviso legal incluído', temAviso],
                  ['Capa escolhida', !!escolhida],
                  ['Descrição SEO ≤ 155', descricao.length > 0 && descricao.length <= 155],
                  ['Título ≤ 60 caracteres', titulo.length > 0 && titulo.length <= 60],
                  ['Revisto pela Dra.', false],
                ].map(([l, ok]) => (
                  <span key={l} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, color: ok ? 'var(--fg-2)' : 'var(--fg-3)' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, flex: 'none', display: 'grid', placeItems: 'center',
                                   border: '1px solid ' + (ok ? 'transparent' : 'var(--edge-2)'),
                                   background: ok ? 'var(--grad-gold)' : 'transparent', color: '#1a1208' }}>
                      {ok && <Icon name="check" size={10} s={3.4} />}
                    </span>{l}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <StepLoader open={gerandoImgs} steps={PASSOS_IMAGENS} per={16000}
                  title="A gerar 4 novas capas (1–2 min)"
                  error={erroImgs}
                  onRetry={() => gerarImagens()}
                  onCancel={() => { setGerandoImgs(false); setErroImgs(null); }} />
      <Confetti fire={fire} key={fire} />

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

/* ---------------- opção de capa com hover direcional ---------------- */
function CoverOption({ src, i, provider, chosen, onPick }) {
  const [dir, setDir] = useState('b');
  const enter = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const d = Math.min(x, 1 - x, y, 1 - y);
    setDir(d === y ? 't' : d === 1 - y ? 'b' : d === x ? 'l' : 'r');
  };
  const off = { t: 'translateY(-100%)', b: 'translateY(100%)', l: 'translateX(-100%)', r: 'translateX(100%)' }[dir];
  return (
    <button type="button" onMouseEnter={enter} onClick={onPick} aria-pressed={chosen}
            className="rs-cover"
            style={{ position: 'relative', borderRadius: 13, overflow: 'hidden', padding: 0, display: 'block', width: '100%',
                     border: '1.5px solid ' + (chosen ? 'var(--gold-soft)' : 'var(--edge)'),
                     boxShadow: chosen ? '0 0 0 3px rgba(184,147,90,.22)' : 'none',
                     transition: 'border-color .25s,box-shadow .25s,transform .3s var(--ease-out)',
                     animation: `rsScaleIn .5s ${i * 90}ms var(--ease-spring) both` }}
            onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = ''; }}>
      <Thumb hue={i} src={src} dim={.42} style={{ aspectRatio: '4/3' }}>
        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(6,18,15,.94),rgba(6,18,15,.5))',
                       display: 'flex', alignItems: 'flex-end', padding: 11, transform: off, transition: 'transform .38s var(--ease-out)' }}>
          <span style={{ fontSize: 10.5, lineHeight: 1.45, color: 'rgba(244,238,226,.9)', textAlign: 'left' }}>
            Opção {i + 1}{provider ? ` · ${provider}` : ''}
          </span>
        </span>
      </Thumb>
      <span className="mono" style={{ position: 'absolute', top: 8, left: 9, fontSize: 9.5, letterSpacing: '.14em', color: 'rgba(244,238,226,.7)',
                                      background: 'rgba(6,18,15,.55)', padding: '2px 6px', borderRadius: 5, backdropFilter: 'blur(4px)' }}>
        0{i + 1}
      </span>
      {chosen && (
        <span style={{ position: 'absolute', top: 7, right: 7, width: 21, height: 21, borderRadius: '50%', background: 'var(--grad-gold)',
                       color: '#1a1208', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.5)',
                       animation: 'rsScaleIn .35s var(--ease-spring) both' }}>
          <Icon name="check" size={11} s={3.2} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------- Pré-visualização

function PreviewBlogue({ titulo, descricao, area, markdown, capaUrl, onClose }) {
  // Rede de segurança: artigos antigos podem ainda trazer tags de citação da pesquisa web.
  const mdLimpo = useMemo(() => (markdown || '').replace(/<\/?(?:cite|ref|citation|source)\b[^>]*>/gi, ''), [markdown]);
  const html = useMemo(() => marked.parse(mdLimpo), [mdLimpo]);
  const toc = useMemo(() => {
    const out = [];
    for (const m of mdLimpo.matchAll(/^##\s+(.+)$/gm)) out.push(m[1].trim());
    return out.slice(0, 8);
  }, [mdLimpo]);
  const hoje = new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="rs-preview" role="dialog" aria-modal="true" aria-label="Pré-visualização do artigo"
         style={{ position: 'fixed', inset: 0, zIndex: 150, background: '#0a1c18', overflowY: 'auto', animation: 'rsFadeIn .3s both' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                    background: 'rgba(6,18,15,.82)', backdropFilter: 'blur(18px)', borderBottom: '1px solid rgba(212,181,133,.16)' }}>
        <Icon name="eye" size={15} style={{ color: '#b8935a' }} />
        <span style={{ fontSize: 11.5, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 800, color: 'rgba(244,238,226,.72)' }}>
          Pré-visualização — assim ficará no blogue
        </span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
          <Icon name="close" size={13} />Fechar
        </button>
      </div>

      {/* hero — contraste AA por construção: gradiente de 3 paradas + text-shadow */}
      <div style={{ position: 'relative', minHeight: 'min(62vh,520px)', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
        <Thumb hue={1} src={capaUrl} dim={.34} style={{ position: 'absolute', inset: 0 }} />
        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(6,18,15,.96) 4%,rgba(6,18,15,.78) 42%,rgba(6,18,15,.42) 100%)' }} />
        <div style={{ position: 'relative', maxWidth: 860, margin: '0 auto', padding: '90px 24px 54px', width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase',
                        color: '#d4b585', fontWeight: 800, animation: 'rsRiseIn .6s .1s var(--ease-out) both', flexWrap: 'wrap' }}>
            <span>{AREAS_LABEL[area] || 'Blogue'}</span>
            <span style={{ width: 22, height: 1, background: 'rgba(212,181,133,.6)' }} />
            <span style={{ color: 'rgba(244,238,226,.62)' }}>{hoje}</span>
            <span style={{ color: 'rgba(244,238,226,.62)' }}>· {minutosLeitura(markdown)} min</span>
          </div>
          <h1 style={{ fontSize: 'clamp(30px,4.6vw,56px)', lineHeight: 1.06, color: '#f5f0e8', marginTop: 18, maxWidth: '22ch',
                       fontFamily: 'Fraunces,Georgia,serif', fontWeight: 400, letterSpacing: '-.02em',
                       textShadow: '0 2px 24px rgba(6,18,15,.85)', animation: 'rsRiseIn .7s .2s var(--ease-out) both', textWrap: 'balance' }}>
            {titulo}
          </h1>
        </div>
      </div>

      <div className="pv-grid" style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 90px' }}>
        <aside className="only-desk" style={{ position: 'sticky', top: 74, alignSelf: 'start' }}>
          <span style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', fontWeight: 800, color: '#b8935a' }}>Neste artigo</span>
          <span className="rule-s" style={{ display: 'block', margin: '11px 0 14px' }} />
          {toc.length ? (
            <nav style={{ display: 'grid', gap: 11 }}>
              {toc.map((t, i) => (
                <span key={i} style={{ fontSize: 12.5, lineHeight: 1.45, color: 'rgba(244,238,226,.6)', paddingLeft: 11,
                                       borderLeft: '1px solid rgba(212,181,133,' + (i ? '.16' : '.7') + ')' }}>{t}</span>
              ))}
            </nav>
          ) : (
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'rgba(244,238,226,.55)' }}>{descricao}</p>
          )}
        </aside>
        <div>
          <div className="prose" style={{ color: 'rgba(244,238,226,.74)' }} dangerouslySetInnerHTML={{ __html: html }} />
          <div style={{ marginTop: 46, padding: 26, borderRadius: 18, border: '1px solid rgba(212,181,133,.2)', background: 'rgba(28,65,56,.4)',
                        display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 62, height: 62, borderRadius: '50%', background: 'linear-gradient(150deg,#1c4138,#0a1c18)',
                           border: '1px solid rgba(212,181,133,.4)', display: 'grid', placeItems: 'center',
                           fontFamily: 'Fraunces,serif', fontSize: 22, color: '#d4b585', flex: 'none' }}>VA</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '.2em', textTransform: 'uppercase', color: '#b8935a', fontWeight: 800 }}>Autora</div>
              <div style={{ fontFamily: 'Fraunces,serif', fontSize: 20, color: '#f5f0e8', marginTop: 5 }}>Dra. Vyvian Avena</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(244,238,226,.6)', marginTop: 7 }}>
                Advogada em Portugal. Nacionalidade, vistos, direito da família e civil para quem recomeça longe de casa.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
