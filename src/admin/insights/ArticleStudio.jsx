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
  'A aplicar a marca de água da Dra.…',
];

const minutosLeitura = (md) =>
  Math.max(1, Math.round((md || '').replace(/[#>*_`\-]/g, ' ').split(/\s+/).filter(Boolean).length / 200));

/* ---------------- marca de água (favicon da Dra.) ----------------
   Segue o padrão das fotos do blogue (claude/padrao-fotos-blogue.md):
   logo-coluna no canto inferior direito, altura 64px em imagens de 1376px
   (escala proporcionalmente), margens 22px, opacidade 88%. Dourado por
   defeito; verde quando o canto é quente (r > b+18 e lum > 35) ou muito
   claro (lum > 185) — medido no retângulo exato onde o logo assenta. */
const FAVICON_URL = {
  gold: encodeURI('/Favicon - Logo Vyvian Avena - Gold.svg'),
  verde: encodeURI('/Favicon - Logo Vyvian Avena - Verde.svg'),
};
function carregarSvg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function aplicarMarcaDagua(blob) {
  const bmp = await createImageBitmap(blob);
  const W = bmp.width, H = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);

  // dimensões proporcionais ao padrão 1376px
  const esc = W / 1376;
  const logoH = Math.max(40, Math.round(64 * esc));
  const margem = Math.max(14, Math.round(22 * esc));

  // proporção do logo a partir do próprio SVG
  const dourado = await carregarSvg(FAVICON_URL.gold);
  const ratio = (dourado.width && dourado.height) ? dourado.width / dourado.height : 0.72;
  const logoW = Math.round(logoH * ratio);
  const x = W - margem - logoW, y = H - margem - logoH;

  // média RGB do retângulo onde o logo assenta → dourado ou verde
  let cor = 'gold';
  try {
    const amostra = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.min(logoW, W - x), Math.min(logoH, H - y)).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < amostra.length; i += 4) { r += amostra[i]; g += amostra[i + 1]; b += amostra[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if ((r > b + 18 && lum > 35) || lum > 185) cor = 'verde';
  } catch { /* canvas tainted não acontece (blob local), mas por segurança */ }

  const logo = cor === 'gold' ? dourado : await carregarSvg(FAVICON_URL.verde);
  ctx.globalAlpha = 0.88;
  ctx.drawImage(logo, x, y, logoW, logoH);
  ctx.globalAlpha = 1;

  const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
  bmp.close && bmp.close();
  return out;
}

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
  const [rev, setRev] = useState(0);               // força refetch dos blobs (pós marca de água)
  const [preview, setPreview] = useState(false);
  const [ampliada, setAmpliada] = useState(null);  // índice da imagem aberta no lightbox
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
  }, [data?.images?.map((i) => i.id).join(','), rev]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)); }, []); // eslint-disable-line

  // Esc fecha (lightbox primeiro, depois pré-visualização, depois o estúdio)
  const ampliadaRef = useRef(null);
  useEffect(() => { ampliadaRef.current = ampliada; }, [ampliada]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (ampliadaRef.current != null) return; // o lightbox trata do seu próprio Esc
      setPreview((p) => { if (p) return false; fechar(); return p; });
    };
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
      // marca de água (favicon) em todas as imagens geradas, antes de mostrar
      try {
        await Promise.all((d.images || []).map(async (img) => {
          const blob = await api.imageBlob(img.id);
          if (!blob) return;
          const marcado = await aplicarMarcaDagua(blob);
          if (marcado) await api.replaceImage(img.id, marcado);
        }));
      } catch (e) {
        admToast(`Imagens geradas, mas a marca de água falhou: ${e.message}`, { kind: 'info' });
      }
      setData(d);
      setRev((r) => r + 1); // força o refetch dos blobs (agora com marca)
      setGerandoImgs(false);
      setFire(Date.now());
      admToast(`${d.images.length} ${d.images.length === 1 ? 'imagem gerada' : 'imagens geradas'} com a marca da Dra.`);
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
                                   chosen={escolhida === img.id} onPick={() => escolher(img.id)}
                                   onExpand={() => setAmpliada(i)} />
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => setAmpliada(0)}>
                    <Icon name="expand" size={13} />Ver ampliadas
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={gerarImagens}>
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

      {ampliada != null && data.images.length > 0 && (
        <Lightbox
          images={data.images.map((img, i) => ({ id: img.id, url: urls[img.id], provider: img.provider, n: i + 1 }))}
          start={ampliada}
          chosenId={escolhida}
          onPick={(id) => escolher(id)}
          onClose={() => setAmpliada(null)}
        />
      )}

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
function CoverOption({ src, i, provider, chosen, onPick, onExpand }) {
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
      {onExpand && (
        <span role="button" tabIndex={0} title="Ampliar" aria-label={`Ampliar a opção ${i + 1}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onExpand(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onExpand(); } }}
              style={{ position: 'absolute', bottom: 7, right: 7, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center',
                       background: 'rgba(6,18,15,.62)', border: '1px solid rgba(212,181,133,.4)', color: '#d4b585',
                       backdropFilter: 'blur(4px)', cursor: 'zoom-in' }}>
          <Icon name="expand" size={12} />
        </span>
      )}
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

/* ---------------- lightbox / carrossel das capas ----------------
   Ampliação a ecrã inteiro: setas, teclado (←/→/Esc), swipe no telemóvel,
   miniaturas com anel dourado na ativa e «Usar como capa» sem sair daqui. */
function Lightbox({ images, start = 0, chosenId, onPick, onClose }) {
  const [i, setI] = useState(Math.max(0, Math.min(start, images.length - 1)));
  const [dir, setDir] = useState(1); // direção da transição (1 = próxima)
  const touchX = useRef(null);
  const total = images.length;
  const img = images[i];

  const ir = (n, d) => { setDir(d); setI(((n % total) + total) % total); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') ir(i + 1, 1);
      else if (e.key === 'ArrowLeft') ir(i - 1, -1);
    };
    window.addEventListener('keydown', onKey, true); // capture: ganha ao Esc do estúdio
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, total]);

  const Arrow = ({ side }) => (
    <button type="button" aria-label={side === 'l' ? 'Anterior' : 'Seguinte'}
            onClick={(e) => { e.stopPropagation(); ir(side === 'l' ? i - 1 : i + 1, side === 'l' ? -1 : 1); }}
            style={{ position: 'absolute', top: '50%', [side === 'l' ? 'left' : 'right']: 'clamp(8px,2.5vw,28px)', transform: 'translateY(-50%)',
                     width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', zIndex: 4,
                     background: 'rgba(28,65,56,.55)', border: '1px solid rgba(212,181,133,.35)', color: '#f4eee2',
                     backdropFilter: 'blur(10px)', transition: 'transform .25s var(--ease-spring), border-color .25s' }}
            onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)'; e.currentTarget.style.borderColor = 'var(--gold-soft)'; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(-50%)'; e.currentTarget.style.borderColor = 'rgba(212,181,133,.35)'; }}>
      <Icon name={side === 'l' ? 'chevL' : 'chevR'} size={20} />
    </button>
  );

  const escolhidaEsta = chosenId === img.id;

  return (
    <div role="dialog" aria-modal="true" aria-label="Imagens ampliadas"
         onClick={onClose}
         onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
         onTouchEnd={(e) => {
           if (touchX.current == null) return;
           const dx = e.changedTouches[0].clientX - touchX.current;
           touchX.current = null;
           if (Math.abs(dx) > 48) ir(dx < 0 ? i + 1 : i - 1, dx < 0 ? 1 : -1);
         }}
         style={{ position: 'fixed', inset: 0, zIndex: 170, display: 'flex', flexDirection: 'column',
                  background: 'rgba(4,12,10,.88)', backdropFilter: 'blur(16px)', animation: 'rsFadeIn .25s both' }}>
      {/* topo: contador + fechar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', flex: 'none' }} onClick={(e) => e.stopPropagation()}>
        <span className="num" style={{ fontSize: 20, color: 'var(--gold-soft)' }}>{String(i + 1).padStart(2, '0')}</span>
        <span style={{ fontSize: 11, letterSpacing: '.18em', color: 'rgba(244,238,226,.45)', fontWeight: 800 }}>/ {String(total).padStart(2, '0')}</span>
        <span className="chip" style={{ marginLeft: 6 }}>Opção {i + 1}{img.provider ? ` · ${img.provider}` : ''}</span>
        {escolhidaEsta && <span className="chip chip-gold"><Icon name="check" size={11} s={3} />Capa atual</span>}
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
          <Icon name="close" size={13} />Fechar
        </button>
      </div>

      {/* imagem grande */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: '4px clamp(60px,9vw,110px)' }}>
        <Arrow side="l" /><Arrow side="r" />
        {img.url
          ? <img key={img.id + '-' + i} src={img.url} alt={`Opção ${i + 1}`}
                 onClick={(e) => e.stopPropagation()}
                 style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 250px)', borderRadius: 16, border: '1px solid rgba(212,181,133,.3)',
                          boxShadow: '0 40px 90px -30px rgba(0,0,0,.9)', objectFit: 'contain',
                          animation: `rsRiseIn .35s var(--ease-out) both`, transformOrigin: dir > 0 ? '60% 50%' : '40% 50%' }} />
          : <span className="shimmer" style={{ width: 'min(70vw,760px)', aspectRatio: '4/3', borderRadius: 16, display: 'block' }} />}
      </div>

      {/* rodapé: usar como capa + miniaturas */}
      <div style={{ flex: 'none', padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 12, justifyItems: 'center' }}
           onClick={(e) => e.stopPropagation()}>
        <button type="button" className={'btn btn-sm ' + (escolhidaEsta ? 'btn-ghost' : 'btn-gold')}
                onClick={() => onPick(img.id)} disabled={escolhidaEsta}>
          <Icon name={escolhidaEsta ? 'check' : 'image'} size={13} s={escolhidaEsta ? 3 : 1.6} />
          {escolhidaEsta ? 'É a capa escolhida' : 'Usar como capa'}
        </button>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'center', flexWrap: 'wrap' }}>
          {images.map((im, k) => (
            <button key={im.id} type="button" aria-label={`Ver a opção ${k + 1}`} aria-current={k === i}
                    onClick={() => ir(k, k > i ? 1 : -1)}
                    style={{ width: 66, height: 50, borderRadius: 9, overflow: 'hidden', padding: 0, position: 'relative',
                             border: '1.5px solid ' + (k === i ? 'var(--gold-soft)' : 'rgba(212,181,133,.18)'),
                             boxShadow: k === i ? '0 0 0 3px rgba(184,147,90,.25)' : 'none',
                             opacity: k === i ? 1 : .55, transition: 'opacity .25s, border-color .25s, transform .25s var(--ease-spring)',
                             transform: k === i ? 'translateY(-3px)' : 'none' }}>
              {im.url && <img src={im.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              {chosenId === im.id && (
                <span style={{ position: 'absolute', top: 3, right: 3, width: 15, height: 15, borderRadius: '50%', background: 'var(--grad-gold)',
                               color: '#1a1208', display: 'grid', placeItems: 'center' }}><Icon name="check" size={8} s={4} /></span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
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
