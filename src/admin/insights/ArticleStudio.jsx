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
import { admConfirm, admPrompt } from '../dialogs';
import { Icon, Tip, StepLoader, Confetti, Thumb } from '../rs/ui';
import { Play, Pause } from 'lucide-react';
import Footer from '../../components/Footer';
import { POSTS } from '../../data/blog';
import { capaSrcSet } from '../../lib/imagens';

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
  const [regras, setRegras] = useState(null);      // correções de imagem (erros a evitar)
  const [corpo, setCorpo] = useState(() => new Set()); // imagens marcadas (corpo do artigo / banco)
  const [inserindo, setInserindo] = useState(false);
  const [salvando, setSalvando] = useState(false);     // a guardar no Banco de Imagens
  const [bancoAberto, setBancoAberto] = useState(false); // modal «Usar imagem do banco»
  const [adotando, setAdotando] = useState(false);
  const [avaliacao, setAvaliacao] = useState(null);      // { texto, seo, avaliado_em }
  const [avaliando, setAvaliando] = useState(false);
  const [fire, setFire] = useState(0);
  const mdRef = useRef('');

  useEffect(() => {
    api.imageRules().then((d) => setRegras(d.rules || [])).catch(() => setRegras([]));
  }, []);

  const adicionarRegra = async (texto) => {
    const t = String(texto || '').trim();
    if (!t) return;
    try {
      const d = await api.addImageRule(t);
      setRegras(d.rules || []);
      admToast('Correção guardada — entra no prompt das próximas gerações.');
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

  const removerRegra = async (id) => {
    try {
      const d = await api.removeImageRule(id);
      setRegras(d.rules || []);
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

  const toggleCorpo = (id) => setCorpo((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const inserirNoArtigo = async () => {
    const ids = [...corpo];
    if (!ids.length) return;
    if (sujo) await guardar(true); // não perder edições — a inserção reescreve o markdown
    setInserindo(true);
    try {
      const d = await api.insertImages(articleId, ids);
      setData(d);
      setMarkdown(d.article.markdown || '');
      mdRef.current = d.article.markdown || '';
      setSujo(false);
      setCorpo(new Set());
      setFire(Date.now());
      admToast(`${ids.length} ${ids.length === 1 ? 'foto colocada' : 'fotos colocadas'} nos parágrafos mais adequados.`);
    } catch (e) {
      admToast(`Não foi possível inserir as fotos: ${e.message}`, { kind: 'error' });
    } finally {
      setInserindo(false);
    }
  };

  /* -------- Banco de Imagens --------
     Duplicados são verificados pelo ID da imagem no servidor (UNIQUE em D1):
     «Imagem salva com sucesso.» ou «Esta imagem já foi salva no dia X.» */
  const fmtDataBanco = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
    return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const salvarNoBanco = async (ids) => {
    if (!ids.length || salvando) return;
    setSalvando(true);
    try {
      const d = await api.saveToBank(ids);
      const res = d.resultados || [];
      const novas = res.filter((r) => r.estado === 'guardada').length;
      const repetidas = res.filter((r) => r.estado === 'ja_existia');
      if (ids.length === 1) {
        const r = res[0];
        if (r?.estado === 'guardada') admToast('Imagem salva com sucesso.');
        else if (r?.estado === 'ja_existia') admToast(`Esta imagem já foi salva no dia ${fmtDataBanco(r.criado_em)}.`, { kind: 'info' });
        else admToast('Imagem não encontrada.', { kind: 'error' });
      } else {
        const partes = [];
        if (novas) partes.push(`${novas} ${novas === 1 ? 'imagem salva' : 'imagens salvas'} com sucesso`);
        if (repetidas.length) partes.push(`${repetidas.length} já ${repetidas.length === 1 ? 'tinha sido salva' : 'tinham sido salvas'} (${repetidas.map((r) => fmtDataBanco(r.criado_em)).join(', ')})`);
        admToast((partes.join(' · ') || 'Nada para salvar') + '.', { kind: novas ? undefined : 'info' });
      }
      if (novas) setFire(Date.now());
    } catch (e) {
      admToast(`Não foi possível salvar no Banco de Imagens: ${e.message}`, { kind: 'error' });
    } finally {
      setSalvando(false);
    }
  };

  /* «Usar imagem do banco» — copia imagens guardadas para as opções deste artigo */
  const adicionarDoBanco = async (ids) => {
    if (!ids.length || adotando) return;
    setAdotando(true);
    try {
      const d = await api.adoptFromBank(articleId, ids);
      setData({ article: d.article, images: d.images, ronda: d.ronda });
      const res = d.resultados || [];
      const novas = res.filter((r) => r.estado === 'adicionada').length;
      const jaLa = res.filter((r) => r.estado === 'ja_no_artigo').length;
      const partes = [];
      if (novas) partes.push(`${novas} ${novas === 1 ? 'imagem adicionada' : 'imagens adicionadas'} às opções do artigo`);
      if (jaLa) partes.push(`${jaLa} já ${jaLa === 1 ? 'estava' : 'estavam'} neste artigo`);
      admToast((partes.join(' · ') || 'Nada adicionado') + '.', { kind: novas ? undefined : 'info' });
      if (novas) setFire(Date.now());
      setBancoAberto(false);
    } catch (e) {
      admToast(`Não foi possível adicionar do banco: ${e.message}`, { kind: 'error' });
    } finally {
      setAdotando(false);
    }
  };

  /* Descartar uma opção da grelha (não apaga do banco nem do corpo do artigo) */
  const descartarOpcao = async (imgId, n) => {
    const ok = await admConfirm(
      `Descartar a opção ${n} deste artigo? Ela sai da grelha de opções — se estiver no Banco de Imagens ou no corpo do artigo, lá permanece.`,
      { danger: true, okLabel: 'Descartar' }
    );
    if (!ok) return;
    try {
      const d = await api.discardImage(articleId, imgId);
      setData(d);
      admToast('Opção descartada.');
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

  /* PUBLICAR — entra na fila; o GitHub Actions publica em até ~15 min */
  const publicar = async () => {
    const ok = await admConfirm(
      `Publicar este artigo no blogue? Entra na fila de publicação e fica no ar em até ~15 minutos, em vyavenaadv.com/blog/ — com narração e leitura acompanhada geradas na publicação.`,
      { okLabel: 'Publicar no blogue' }
    );
    if (!ok) return;
    if (sujo) { const okG = await guardar(true); if (!okG) return; }
    try {
      const d = await api.publishArticle(articleId);
      setData(d);
      setFire(Date.now());
      admToast('Na fila de publicação — o artigo entra no ar em até ~15 minutos.');
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

  const reportarErroDialogo = async (contexto) => {
    // solta o foco do editor antes de abrir o diálogo (o TipTap retém o teclado)
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
    const texto = await admPrompt(
      'Descreva o erro para a IA nunca mais o repetir (ex.: «ecrã do telemóvel virado ao contrário»):',
      { title: contexto || 'Reportar erro na imagem', placeholder: 'O que está errado nesta imagem?' }
    );
    if (texto != null) await adicionarRegra(texto);
  };

  useEffect(() => {
    api.getArticle(articleId).then((d) => {
      setData(d);
      setTitulo(d.article.titulo || '');
      setDescricao(d.article.descricao || '');
      setMarkdown(d.article.markdown || '');
      mdRef.current = d.article.markdown || '';
      try { setAvaliacao(d.article.avaliacao ? JSON.parse(d.article.avaliacao) : null); } catch { setAvaliacao(null); }
    }).catch((e) => { admToast(e.message, { kind: 'error' }); onClose(); });
  }, [articleId, onClose]);

  // Nota da IA — corre depois de cada «Guardar» explícito (texto/descrição novos)
  const avaliar = async () => {
    if (avaliando) return;
    setAvaliando(true);
    try {
      const d = await api.evaluateArticle(articleId);
      setAvaliacao(d.avaliacao);
    } catch (e) {
      admToast(`Avaliação falhou: ${e.message}`, { kind: 'error' });
    } finally {
      setAvaliando(false);
    }
  };

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
      if (document.querySelector('.adm-overlay')) return; // um diálogo aberto trata do seu próprio Esc
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
      if (!silencioso) {
        setFire(Date.now());
        admToast('Artigo guardado — a IA está a avaliar o novo texto…');
        avaliar(); // nota 0-10 do texto e da descrição SEO (não bloqueia o guardar)
      }
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
  const revisto = !!a?.revisto_em;

  /* «Revisto pela Dra.» — a Dra. marca quando termina a leitura final; qualquer
     alteração posterior ao conteúdo desmarca sozinha (worker). */
  const alternarRevisto = async () => {
    const alvo = !revisto;
    if (alvo && sujo) { const ok = await guardar(true); if (!ok) return; } // marca sempre sobre o texto guardado
    try {
      const d = await api.setReviewed(articleId, alvo);
      setData(d);
      admToast(alvo ? 'Artigo marcado como revisto pela Dra.' : 'Revisão desmarcada.');
    } catch (e) { admToast(e.message, { kind: 'error' }); }
  };

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
              if (sujo) await guardar(true);
              if (corpo.size) admToast(`Tem ${corpo.size} ${corpo.size === 1 ? 'foto marcada' : 'fotos marcadas'} ainda NÃO inseridas — use «Inserir no artigo» para entrarem no corpo.`, { kind: 'info' });
              setPreview(true);
            }}>
              <Icon name="eye" size={14} />Pré-visualizar
            </button>
            <button type="button" className={'btn btn-sm ' + (sujo ? 'btn-gold' : 'btn-ghost')} onClick={() => guardar()} disabled={guardando}>
              <Icon name={sujo ? 'save' : 'check'} size={14} s={sujo ? 1.6 : 3} />
              {guardando ? 'A guardar…' : sujo ? 'Guardar' : 'Guardado'}
            </button>
            {a.publicado_em
              ? <span className="chip chip-ok"><Icon name="check" size={11} s={3} />Publicado</span>
              : a.publicar_em
                ? <span className="chip chip-gold" data-tip="Na fila — o GitHub Actions publica em até ~15 minutos"><Icon name="refresh" size={11} />A publicar…</span>
                : <button type="button" className={'btn btn-sm ' + (revisto ? 'btn-gold' : 'btn-ghost')}
                          onClick={publicar} disabled={!revisto}
                          data-tip={revisto ? 'Publica no blogue nos moldes dos artigos existentes' : 'Disponível depois de marcar «Revisto pela Dra.»'}>
                    <Icon name="spark" size={14} />Publicar
                  </button>}
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
                                   noCorpo={corpo.has(img.id)}
                                   jaNoArtigo={(mdRef.current || markdown).includes(`/api/insights/images/${img.id})`)}
                                   onToggleCorpo={() => toggleCorpo(img.id)}
                                   onDiscard={() => descartarOpcao(img.id, i + 1)}
                                   onExpand={() => setAmpliada(i)} />
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => setAmpliada(0)}>
                    <Icon name="expand" size={13} />Ver ampliadas
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={gerarImagens}>
                    <Icon name="refresh" size={13} />Gerar todas novamente
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                          data-tip="Escolher imagens já guardadas no Banco de Imagens para juntar às opções deste artigo"
                          onClick={() => setBancoAberto(true)}>
                    <Icon name="image" size={13} />Usar imagem do banco
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 9, textAlign: 'center' }}>1–2 min · Gemini, fallback Recraft</div>

                  <hr className="rule" style={{ margin: '16px 0 13px' }} />
                  <span className="overline">Fotos no corpo do artigo</span>
                  <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
                    Marque fotos com o botão <Icon name="plus" size={10} style={{ verticalAlign: '-1px' }} /> em cada miniatura —
                    a IA coloca cada uma <strong style={{ color: 'var(--fg-2)' }}>após o parágrafo com que mais se relaciona</strong>.
                    Para guardar no Banco de Imagens, use «Salvar imagem» dentro de «Ver ampliadas».
                  </p>
                  <button type="button" className={'btn btn-sm ' + (corpo.size ? 'btn-gold' : 'btn-ghost')}
                          style={{ width: '100%', justifyContent: 'center', marginTop: 11 }}
                          onClick={inserirNoArtigo} disabled={!corpo.size || inserindo}>
                    <Icon name={inserindo ? 'refresh' : 'image'} size={13} />
                    {inserindo ? 'A posicionar as fotos…' : corpo.size ? `Inserir ${corpo.size} no artigo` : 'Inserir no artigo'}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
                    Gere 4 opções de capa na direção de arte do blogue. Depois escolha a preferida — ou gere todas novamente.
                  </p>
                  <button type="button" className="btn btn-gold btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={gerarImagens}>
                    <Icon name="image" size={13} />Gerar 4 opções de imagem
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                          data-tip="Escolher imagens já guardadas no Banco de Imagens"
                          onClick={() => setBancoAberto(true)}>
                    <Icon name="image" size={13} />Usar imagem do banco
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 9, textAlign: 'center' }}>1–2 min · Gemini, fallback Recraft</div>
                </>
              )}
            </div>

            <AvaliacaoCard avaliacao={avaliacao} avaliando={avaliando} onAvaliar={avaliar} />

            <NarracaoCard articleId={articleId} audioKey={data.article.audio_key} audioEm={data.article.audio_em}
                          sujo={sujo} onAntesDeGerar={async () => { if (sujo) await guardar(true); }}
                          onGerado={(d) => setData((prev) => ({ ...prev, article: { ...prev.article, audio_key: d.audio_key, audio_em: d.audio_em } }))} />

            <ImageRulesCard regras={regras} onAdd={adicionarRegra} onRemove={removerRegra} />

            <div className="glass" style={{ padding: 20 }}>
              <span className="overline">Publicação</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 9,
                               background: revisto ? 'var(--ok, #8fd0a2)' : 'var(--warn)',
                               boxShadow: revisto ? '0 0 0 4px rgba(143,208,162,.18)' : '0 0 0 4px rgba(200,150,86,.18)' }} />
                <span style={{ fontSize: 13.5 }}>{revisto ? 'Aprovado pela Dra. — pronto a publicar' : 'Rascunho pronto a revisão'}</span>
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
                ].map(([l, ok]) => (
                  <span key={l} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, color: ok ? 'var(--fg-2)' : 'var(--fg-3)' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, flex: 'none', display: 'grid', placeItems: 'center',
                                   border: '1px solid ' + (ok ? 'transparent' : 'var(--edge-2)'),
                                   background: ok ? 'var(--grad-gold)' : 'transparent', color: '#1a1208' }}>
                      {ok && <Icon name="check" size={10} s={3.4} />}
                    </span>{l}
                  </span>
                ))}
                {/* a única caixa que é da Dra.: clicável, guarda a data, e desmarca
                    sozinha se o texto for alterado depois da revisão */}
                <button type="button" onClick={alternarRevisto} aria-pressed={revisto}
                        data-tip={revisto
                          ? `Revisto a ${fmtDataBanco(a.revisto_em)} — clique para desmarcar. Alterar o texto desmarca sozinho.`
                          : 'Terminou a leitura final? Clique para marcar o artigo como revisto.'}
                        style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, padding: 0, textAlign: 'left',
                                 color: revisto ? 'var(--fg-2)' : 'var(--fg-3)', cursor: 'pointer', background: 'none', border: 'none' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 5, flex: 'none', display: 'grid', placeItems: 'center',
                                 border: '1px solid ' + (revisto ? 'transparent' : 'var(--gold-soft)'),
                                 background: revisto ? 'var(--grad-gold)' : 'transparent', color: '#1a1208',
                                 boxShadow: revisto ? 'none' : '0 0 0 3px rgba(184,147,90,.12)' }}>
                    {revisto && <Icon name="check" size={10} s={3.4} />}
                  </span>
                  Revisto pela Dra.{revisto && <em style={{ fontStyle: 'normal', color: 'var(--fg-3)', marginLeft: 4 }}>· {fmtDataBanco(a.revisto_em)}</em>}
                </button>
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
          onSave={(id) => salvarNoBanco([id])}
          salvando={salvando}
          onReport={(n) => reportarErroDialogo(`Reportar erro · Opção ${n}`)}
          onClose={() => setAmpliada(null)}
        />
      )}

      {bancoAberto && (
        <BancoPicker adotando={adotando}
                     articleId={articleId}
                     noArtigoIds={new Set((data.images || []).flatMap((im) => im.banco_origem ? [im.id, im.banco_origem] : [im.id]))}
                     onAdd={(ids) => adicionarDoBanco(ids)}
                     onClose={() => setBancoAberto(false)} />
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
          articleId={articleId} temAudio={!!a.audio_key}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}

/* ---------------- opção de capa com hover direcional ---------------- */
function CoverOption({ src, i, provider, chosen, onPick, onExpand, noCorpo, jaNoArtigo, onToggleCorpo, onDiscard }) {
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
        <span role="button" tabIndex={0} data-tip="Ampliar" aria-label={`Ampliar a opção ${i + 1}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onExpand(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onExpand(); } }}
              style={{ position: 'absolute', bottom: 7, right: 7, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center',
                       background: 'rgba(6,18,15,.62)', border: '1px solid rgba(212,181,133,.4)', color: '#d4b585',
                       backdropFilter: 'blur(4px)', cursor: 'zoom-in' }}>
          <Icon name="expand" size={12} />
        </span>
      )}
      {onToggleCorpo && (
        jaNoArtigo
          ? <span data-tip="Já está no corpo do artigo"
                  style={{ position: 'absolute', bottom: 7, left: 7, height: 24, padding: '0 7px', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 4,
                           background: 'rgba(74,124,89,.55)', border: '1px solid rgba(143,208,162,.5)', color: '#d9f2e0',
                           fontSize: 8.5, fontWeight: 800, letterSpacing: '.08em', backdropFilter: 'blur(4px)' }}>
              <Icon name="check" size={9} s={3.4} />NO ARTIGO
            </span>
          : <span role="button" tabIndex={0} aria-pressed={noCorpo}
                  data-tip={noCorpo ? 'Retirar da seleção para o corpo do artigo' : 'Marcar para o corpo do artigo'}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleCorpo(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggleCorpo(); } }}
                  style={{ position: 'absolute', bottom: 7, left: 7, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center',
                           background: noCorpo ? 'var(--grad-gold)' : 'rgba(6,18,15,.62)',
                           border: '1px solid rgba(212,181,133,.4)', color: noCorpo ? '#1a1208' : '#d4b585',
                           backdropFilter: 'blur(4px)', cursor: 'pointer' }}>
              <Icon name={noCorpo ? 'check' : 'plus'} size={12} s={noCorpo ? 3 : 1.8} />
            </span>
      )}
      {onDiscard && (
        <span role="button" tabIndex={0} data-tip={`Descartar a opção ${i + 1} deste artigo`}
              aria-label={`Descartar a opção ${i + 1}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDiscard(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDiscard(); } }}
              style={{ position: 'absolute', top: 7, right: chosen ? 33 : 7, width: 21, height: 21, borderRadius: 7,
                       display: 'grid', placeItems: 'center', background: 'rgba(6,18,15,.62)',
                       border: '1px solid rgba(212,181,133,.35)', color: 'rgba(244,238,226,.75)',
                       backdropFilter: 'blur(4px)', cursor: 'pointer' }}>
          <Icon name="trash" size={11} />
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

/* ---------------- Narração ElevenLabs ----------------
   Para quando a Dra. dá o texto por FINALIZADO: gera a narração com a voz do
   blogue (Claudia, pt-PT) e deixa-a ouvível aqui mesmo. Se o texto mudar
   depois, é preciso gerar novamente. */
function NarracaoCard({ articleId, audioKey, audioEm, sujo, onAntesDeGerar, onGerado }) {
  const [gerando, setGerando] = useState(false);
  const [url, setUrl] = useState(null);

  // carrega o MP3 (autenticado) quando já existe narração
  useEffect(() => {
    let vivo = true;
    if (!audioKey) { setUrl(null); return undefined; }
    api.audioUrl(articleId).then((u) => { if (vivo) setUrl(u); else if (u) URL.revokeObjectURL(u); });
    return () => { vivo = false; };
  }, [articleId, audioKey]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]); // eslint-disable-line

  const gerar = async () => {
    const ok = await admConfirm(
      audioKey
        ? 'Gerar a narração novamente com o texto atual? A anterior é substituída.'
        : 'O texto está finalizado? A narração é gerada a partir do texto ATUAL do artigo, com a voz do blogue (ElevenLabs). Se editar depois, terá de gerar novamente.',
      { okLabel: audioKey ? 'Gerar novamente' : 'Sim, gerar narração' }
    );
    if (!ok) return;
    setGerando(true);
    try {
      await onAntesDeGerar(); // não narrar texto desatualizado — guarda primeiro
      const d = await api.generateAudio(articleId);
      onGerado(d);
      admToast('Narração gerada com a voz do blogue.');
    } catch (e) {
      admToast(`Não foi possível gerar a narração: ${e.message}`, { kind: 'error' });
    } finally {
      setGerando(false);
    }
  };

  const dataFmt = audioEm ? (() => {
    const d = new Date(String(audioEm).replace(' ', 'T') + (String(audioEm).endsWith('Z') ? '' : 'Z'));
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' às ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  })() : '';

  return (
    <div className="glass" style={{ padding: 20 }}>
      <span className="overline">Narração · ElevenLabs</span>
      {!audioKey ? (
        <>
          <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
            Quando o texto estiver <strong style={{ color: 'var(--fg-2)' }}>finalizado</strong>, gere a narração
            com a voz do blogue (Claudia · pt-PT) para o «Ouvir este artigo».
          </p>
          <button type="button" className="btn btn-gold btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                  onClick={gerar} disabled={gerando}>
            <Icon name={gerando ? 'refresh' : 'spark'} size={13} />
            {gerando ? 'A gravar a narração…' : 'Gerar narração'}
          </button>
          {gerando && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 9, textAlign: 'center' }}>~20-60 segundos · ElevenLabs</div>}
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.5 }}>
            Gerada a {dataFmt}.{sujo && <strong style={{ color: 'var(--warn)' }}> O texto foi alterado desde então — gere novamente.</strong>}
          </p>
          {url
            ? <PlayerDourado url={url} />
            : <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 11 }}>A carregar o áudio…</div>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 11 }}
                  onClick={gerar} disabled={gerando}>
            <Icon name="refresh" size={13} />{gerando ? 'A gravar a narração…' : 'Gerar novamente'}
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------- player dourado (narração na sidebar) ----------------
   Substitui o <audio controls> nativo (branco) por um player no design do
   site: play dourado, progresso clicável e velocidades 1/1.25/1.5/2x. */
const VELOC_NARR = [1, 1.25, 1.5, 2];
const fmtSeg = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

function PlayerDourado({ url }) {
  const [tocar, setTocar] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [vel, setVel] = useState(0);
  const audioRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); audioRef.current?.pause(); }, []);
  useEffect(() => { // URL nova (narração regenerada) → recomeça
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    audioRef.current = null;
    setTocar(false); setT(0); setDur(0);
  }, [url]);

  const tique = () => {
    const a = audioRef.current;
    if (a) setT(a.currentTime);
    rafRef.current = requestAnimationFrame(tique);
  };
  const play = () => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio(url);
      a.preload = 'auto';
      a.playbackRate = VELOC_NARR[vel];
      a.addEventListener('loadedmetadata', () => setDur(a.duration || 0));
      a.addEventListener('ended', () => { setTocar(false); cancelAnimationFrame(rafRef.current); });
      audioRef.current = a;
    }
    a.play(); setTocar(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tique);
  };
  const pause = () => { audioRef.current?.pause(); setTocar(false); cancelAnimationFrame(rafRef.current); };
  const mudarVel = () => {
    const nv = (vel + 1) % VELOC_NARR.length;
    setVel(nv);
    if (audioRef.current) audioRef.current.playbackRate = VELOC_NARR[nv];
  };
  const procurar = (e) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
    setT(a.currentTime);
  };

  return (
    <div style={{ marginTop: 11, padding: '12px 13px', borderRadius: 13, border: '1px solid var(--edge-2)',
                  background: 'rgba(184,147,90,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <button type="button" onClick={tocar ? pause : play} aria-label={tocar ? 'Pausar' : 'Ouvir a narração'}
              style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--grad-gold)', color: '#1a1208',
                       display: 'grid', placeItems: 'center', border: 'none', cursor: 'pointer', flex: 'none',
                       boxShadow: '0 6px 18px -6px rgba(184,147,90,.7)' }}>
        {tocar ? <Pause style={{ width: 15, height: 15 }} /> : <Play style={{ width: 15, height: 15, transform: 'translateX(1px)' }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtSeg(t / VELOC_NARR[vel])} / {fmtSeg(dur / VELOC_NARR[vel])}
          </span>
          <button type="button" onClick={mudarVel} data-tip="Velocidade da narração"
                  style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', color: 'var(--gold-soft)',
                           border: '1px solid var(--edge-2)', borderRadius: 7, padding: '1px 7px',
                           background: 'transparent', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
            {VELOC_NARR[vel]}x
          </button>
        </div>
        <div role="slider" aria-label="Posição da narração" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)}
             tabIndex={0} onClick={procurar} style={{ marginTop: 8, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ position: 'relative', height: 4, width: '100%', borderRadius: 9, background: 'var(--edge)', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', inset: '0 auto 0 0', width: (dur ? (t / dur) * 100 : 0) + '%',
                           background: 'var(--grad-gold)', borderRadius: 9, transition: 'width .15s' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Nota da IA (0-10 · texto e descrição SEO) ----------------
   Depois de a Dra. guardar alterações, a IA dá nota ao texto e à descrição SEO,
   com o motivo e sugestões de melhoria acionáveis. */
function NotaBarra({ rotulo, dados }) {
  const s = dados?.score ?? null;
  const cor = s == null ? 'var(--edge-2)' : s >= 7.5 ? 'var(--grad-gold)' : s >= 5 ? 'linear-gradient(90deg,#c89656,#b8935a)' : 'linear-gradient(90deg,#a04b3c,#8e1f1f)';
  return (
    <div style={{ marginTop: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span className="overline" style={{ fontSize: 9.5, letterSpacing: '.2em' }}>{rotulo}</span>
        <span className="num" style={{ fontSize: 21, lineHeight: 1, color: 'var(--fg)' }}>
          {s == null ? '—' : s.toFixed(1)}<span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontWeight: 800 }}> /10</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 9, background: 'var(--edge)', overflow: 'hidden', marginTop: 7 }}>
        <span style={{ display: 'block', height: '100%', width: (s == null ? 0 : s * 10) + '%', background: cor,
                       borderRadius: 9, transition: 'width .7s var(--ease-out)' }} />
      </div>
      {dados?.motivo && <p style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.55, marginTop: 8 }}>{dados.motivo}</p>}
      {dados?.melhorias?.length > 0 && (
        <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
          {dados.melhorias.map((m, i) => (
            <span key={i} style={{ display: 'flex', gap: 7, fontSize: 11.5, lineHeight: 1.5, color: 'var(--fg-3)' }}>
              <span style={{ flex: 'none', marginTop: 5, width: 5, height: 5, borderRadius: 9, background: 'var(--gold-soft)' }} />
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AvaliacaoCard({ avaliacao, avaliando, onAvaliar }) {
  return (
    <div className="glass" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="overline">Nota da IA</span>
        {avaliando && <span className="chip"><Icon name="refresh" size={10} />a avaliar…</span>}
      </div>
      {!avaliacao && !avaliando ? (
        <>
          <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
            Ao clicar em <strong style={{ color: 'var(--fg-2)' }}>Guardar</strong>, a IA avalia o texto e a
            descrição SEO de 0 a 10, com o motivo e sugestões de melhoria.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 11 }} onClick={onAvaliar}>
            <Icon name="spark" size={13} />Avaliar agora
          </button>
        </>
      ) : (
        <>
          <NotaBarra rotulo="Texto do artigo" dados={avaliacao?.texto} />
          <hr className="rule" style={{ margin: '14px 0 1px' }} />
          <NotaBarra rotulo="Descrição SEO" dados={avaliacao?.seo} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                  onClick={onAvaliar} disabled={avaliando}>
            <Icon name="refresh" size={13} />{avaliando ? 'A avaliar…' : 'Reavaliar agora'}
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------- «Usar imagem do banco» ----------------
   Modal com as imagens guardadas no Banco de Imagens (vista IMAGENS). A Dra.
   seleciona quantas quiser e «Adicionar no artigo» copia-as para as opções
   deste artigo — a partir daí podem ser capa ou entrar no corpo. */
function BancoPicker({ onAdd, onClose, adotando, noArtigoIds, articleId }) {
  const [itens, setItens] = useState(null);
  const [sel, setSel] = useState(() => new Set());

  useEffect(() => {
    api.imageBank()
      .then((d) => setItens(d.images || []))
      .catch((e) => { admToast(e.message, { kind: 'error' }); setItens([]); });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toggle = (id) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" aria-label="Usar imagem do banco" onClick={onClose}
         style={{ position: 'fixed', inset: 0, zIndex: 175, display: 'grid', placeItems: 'center', padding: 18,
                  background: 'rgba(4,12,10,.82)', backdropFilter: 'blur(14px)', animation: 'rsFadeIn .22s both' }}>
      <div className="glass" onClick={(e) => e.stopPropagation()}
           style={{ width: 'min(880px, 100%)', maxHeight: 'min(86vh, 740px)', display: 'flex', flexDirection: 'column',
                    padding: '20px 22px 18px', borderRadius: 18, animation: 'rsRiseIn .3s var(--ease-out) both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="overline">Banco de Imagens</span>
          {itens?.length > 0 && <span className="chip">{itens.length} {itens.length === 1 ? 'guardada' : 'guardadas'}</span>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <Icon name="close" size={13} />Fechar
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 7, lineHeight: 1.5 }}>
          Selecione as imagens que quer juntar às opções deste artigo — depois podem ser usadas como capa ou no corpo.
        </p>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 13, paddingRight: 4 }}>
          {itens == null ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ aspectRatio: '4/3', borderRadius: 12, overflow: 'hidden', position: 'relative', background: 'var(--panel)' }}>
                  <span className="shimmer" style={{ position: 'absolute', inset: 0 }} />
                </div>
              ))}
            </div>
          ) : itens.length === 0 ? (
            <div style={{ padding: '34px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, lineHeight: 1.6 }}>
              O banco ainda está vazio.<br />Guarde imagens com «Salvar imagem» dentro de «Ver ampliadas», em qualquer artigo.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
              {itens.map((im, k) => {
                const jaNoArtigo = noArtigoIds?.has(im.image_id);
                const marcada = sel.has(im.image_id);
                // usos noutros artigos (exclui este) — a Dra. sabe onde a imagem já foi usada
                const usosOutros = (im.usos || []).filter((u) => u.article_id !== articleId);
                const tipUsos = usosOutros.length
                  ? `Já usada em: ${usosOutros.map((u) => `artigo ${u.article_id} — «${u.titulo}»`).join(' · ')}`
                  : null;
                return (
                  <button key={im.id} type="button" aria-pressed={marcada} disabled={jaNoArtigo}
                          onClick={() => { if (!jaNoArtigo) toggle(im.image_id); }}
                          data-tip={jaNoArtigo ? 'Esta imagem já está nas opções deste artigo'
                                    : tipUsos || (im.artigo_titulo ? `De: ${im.artigo_titulo}` : 'Imagem guardada')}
                          style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', padding: 0, display: 'block',
                                   aspectRatio: '4/3', cursor: jaNoArtigo ? 'not-allowed' : 'pointer',
                                   border: '1.5px solid ' + (marcada ? 'var(--gold-soft)' : 'var(--edge)'),
                                   boxShadow: marcada ? '0 0 0 3px rgba(184,147,90,.22)' : 'none',
                                   transition: 'border-color .2s, box-shadow .2s, transform .25s var(--ease-out)',
                                   animation: `rsScaleIn .4s ${k * 45}ms var(--ease-spring) both` }}>
                    <img src={'/api/insights/images/' + im.image_id} alt=""
                         style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                                  opacity: jaNoArtigo ? .38 : marcada ? 1 : .88, transition: 'opacity .2s',
                                  filter: jaNoArtigo ? 'saturate(.55)' : 'none' }} />
                    {jaNoArtigo ? (
                      <span style={{ position: 'absolute', top: 7, left: 7, height: 22, padding: '0 8px', borderRadius: 7,
                                     display: 'inline-flex', alignItems: 'center', gap: 4,
                                     background: 'rgba(74,124,89,.55)', border: '1px solid rgba(143,208,162,.5)', color: '#d9f2e0',
                                     fontSize: 8.5, fontWeight: 800, letterSpacing: '.08em', backdropFilter: 'blur(4px)' }}>
                        <Icon name="check" size={9} s={3.4} />ESTÁ NESSE ARTIGO
                      </span>
                    ) : (
                      <>
                        {usosOutros.length > 0 && (
                          <span style={{ position: 'absolute', top: 7, left: 7, height: 22, padding: '0 8px', borderRadius: 7,
                                         display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 'calc(100% - 42px)', overflow: 'hidden',
                                         background: 'rgba(184,147,90,.5)', border: '1px solid rgba(212,181,133,.55)', color: '#f4eee2',
                                         fontSize: 8.5, fontWeight: 800, letterSpacing: '.08em', backdropFilter: 'blur(4px)', whiteSpace: 'nowrap' }}>
                            <Icon name="image" size={9} />NO ARTIGO {usosOutros.map((u) => u.article_id).join(', ')}
                          </span>
                        )}
                        <span style={{ position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: 7,
                                       display: 'grid', placeItems: 'center',
                                       background: marcada ? 'var(--grad-gold)' : 'rgba(6,18,15,.6)',
                                       border: '1px solid rgba(212,181,133,.45)', color: marcada ? '#1a1208' : '#d4b585',
                                       backdropFilter: 'blur(4px)' }}>
                          <Icon name={marcada ? 'check' : 'plus'} size={11} s={marcada ? 3.2 : 1.8} />
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-3)', marginRight: 'auto' }}>
            {sel.size ? `${sel.size} ${sel.size === 1 ? 'selecionada' : 'selecionadas'}` : 'Clique nas imagens para selecionar'}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button type="button" className={'btn btn-sm ' + (sel.size ? 'btn-gold' : 'btn-ghost')}
                  disabled={!sel.size || adotando} onClick={() => onAdd([...sel])}>
            <Icon name={adotando ? 'refresh' : 'image'} size={13} />
            {adotando ? 'A adicionar…' : sel.size ? `Adicionar ${sel.size} no artigo` : 'Adicionar no artigo'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- correções de imagem (erros apontados pela Dra.) ----------------
   Cada erro grotesco visto numa imagem (ex.: ecrã do telemóvel ao contrário) vira
   uma regra permanente que entra no prompt de TODAS as gerações seguintes. */
function ImageRulesCard({ regras, onAdd, onRemove }) {
  const [texto, setTexto] = useState('');
  const submeter = (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    onAdd(texto);
    setTexto('');
  };
  return (
    <div className="glass" style={{ padding: 20 }}>
      <span className="overline">Correções de imagem</span>
      <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.55 }}>
        Viu um erro grotesco numa imagem (ecrã ao contrário, mãos estranhas)? Aponte aqui —
        a nota entra no prompt de <strong style={{ color: 'var(--fg-2)' }}>todas as próximas gerações</strong>.
      </p>
      <form onSubmit={submeter} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {/* onFocus/onBlur: desativa o TipTap enquanto se escreve aqui (mesmo
            mecanismo do fix dos diálogos) — o ProseMirror rouba o teclado se puder */}
        <input className="field" style={{ padding: '9px 12px', fontSize: 13 }} value={texto} maxLength={240}
               onChange={(e) => setTexto(e.target.value)}
               onFocus={() => window.dispatchEvent(new CustomEvent('adm-dialog-open'))}
               onBlur={() => window.dispatchEvent(new CustomEvent('adm-dialog-close'))}
               placeholder="Ex.: ecrã do telemóvel virado ao contrário" />
        <button type="submit" className="btn btn-gold btn-sm" disabled={!texto.trim()} data-tip="Guardar correção" aria-label="Guardar correção"
                style={{ padding: '7px 11px' }}>
          <Icon name="plus" size={13} />
        </button>
      </form>
      {regras == null ? (
        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 12 }}>A carregar…</div>
      ) : regras.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 12 }}>Ainda sem correções registadas.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
          {regras.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10,
                                     background: 'var(--panel)', border: '1px solid var(--edge)', animation: 'rsRiseInSm .35s var(--ease-out) both' }}>
              <span style={{ flex: 'none', marginTop: 3, width: 6, height: 6, borderRadius: 9, background: 'var(--gold)' }} />
              <span style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'var(--fg-2)' }}>{r.texto}</span>
              <button type="button" className="btn-quiet" data-tip="Remover esta correção" onClick={() => onRemove(r.id)}
                      style={{ padding: 3, borderRadius: 6, flex: 'none' }}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- lightbox / carrossel das capas ----------------
   Ampliação a ecrã inteiro: setas, teclado (←/→/Esc), swipe no telemóvel,
   miniaturas com anel dourado na ativa e «Usar como capa» sem sair daqui. */
function Lightbox({ images, start = 0, chosenId, onPick, onSave, salvando, onReport, onClose }) {
  const [i, setI] = useState(Math.max(0, Math.min(start, images.length - 1)));
  const [dir, setDir] = useState(1); // direção da transição (1 = próxima)
  const touchX = useRef(null);
  const total = images.length;
  const img = images[i];

  const ir = (n, d) => { setDir(d); setI(((n % total) + total) % total); };

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.adm-overlay')) return; // diálogo aberto (ex.: reportar erro) — as teclas são dele
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className={'btn btn-sm ' + (escolhidaEsta ? 'btn-ghost' : 'btn-gold')}
                  onClick={() => onPick(img.id)} disabled={escolhidaEsta}>
            <Icon name={escolhidaEsta ? 'check' : 'image'} size={13} s={escolhidaEsta ? 3 : 1.6} />
            {escolhidaEsta ? 'É a capa escolhida' : 'Usar como capa'}
          </button>
          {onSave && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSave(img.id)} disabled={salvando}
                    data-tip="Guardar esta imagem no Banco de Imagens (vista IMAGENS) — duplicados são detetados pelo ID">
              <Icon name={salvando ? 'refresh' : 'save'} size={13} />{salvando ? 'A salvar…' : 'Salvar imagem'}
            </button>
          )}
          {onReport && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReport(i + 1)}
                    data-tip="Aponte um erro grotesco desta imagem — a IA nunca mais o repete">
              <Icon name="info" size={13} />Reportar erro
            </button>
          )}
        </div>
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

/* A pré-visualização replica a PÁGINA REAL do artigo no blogue público
   (ex.: /blog/cobrancas-indevidas-cidadania-portuguesa): navbar e footer do
   próprio site (sem navegação), barra de progresso de leitura, hero full-bleed
   com breadcrumb «Blogue», rail lateral, prosa .blog-prose com drop cap, CTA
   e «Continuar a ler». O blogue é sempre CLARO — mesmo com a área privada em
   dark, aqui a Dra. vê exatamente o que o leitor verá. */
/* Réplica ESTÁTICA do navbar do site no estado sólido (pós-scroll / páginas claras).
   O Navbar real decide a transparência pelo scroll da JANELA — dentro deste overlay
   (que tem scroll próprio) ficava sempre transparente, com o texto por cima. */
function NavPreview() {
  const links = ['Home', 'Sobre', 'Áreas de Atuação', 'Apoio', 'Blogue', 'Contacto'];
  return (
    <nav className="fixed top-0 left-0 right-0 z-40"
         style={{ backgroundColor: '#faf8f4', boxShadow: '0 1px 12px rgba(0,0,0,0.08)', paddingTop: 12, paddingBottom: 12 }}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <img src="/logo-horizontal-verde.png" alt="Vyvian Avena Advogada"
             style={{ height: 44, width: 'auto', objectFit: 'contain' }} />
        <div className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <span key={l} className={'text-sm font-body tracking-wide ' + (l === 'Blogue' ? 'text-gold' : 'text-forest')}>{l}</span>
          ))}
          <span className="flex items-center gap-1 text-xs font-body tracking-wide text-forest/60">Área Privada</span>
          <span className="ml-2 px-5 py-2 text-sm font-body tracking-wide border border-gold text-gold">Consulta</span>
        </div>
      </div>
    </nav>
  );
}

function PreviewBlogue({ titulo, descricao, area, markdown, capaUrl, articleId, temAudio, onClose }) {
  // Rede de segurança: artigos antigos podem ainda trazer tags de citação da pesquisa web.
  const mdLimpo = useMemo(() => (markdown || '').replace(/<\/?(?:cite|ref|citation|source)\b[^>]*>/gi, ''), [markdown]);
  const html = useMemo(() => marked.parse(mdLimpo), [mdLimpo]);
  const hoje = new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
  const areaLabel = AREAS_LABEL[area] || null;
  const outros = POSTS.slice(0, 2);

  // barra de progresso de leitura (2px dourada) — mede o scroll DESTE overlay
  const scrollRef = useRef(null);
  const barRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (barRef.current) barRef.current.style.width = `${max > 0 ? (el.scrollTop / max) * 100 : 0}%`;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={scrollRef} className="pv-blog" role="dialog" aria-modal="true" aria-label="Pré-visualização do artigo"
         style={{ position: 'fixed', inset: 0, zIndex: 150, background: '#faf8f4', overflowY: 'auto', animation: 'rsFadeIn .3s both' }}>
      {/* barra de progresso de leitura, como no blogue */}
      <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 170, pointerEvents: 'none' }}>
        <div ref={barRef} style={{ height: '100%', width: '0%', background: '#b8935a' }} />
      </div>

      {/* navbar do site no estado sólido (só visual) */}
      <NavPreview />

      {/* Hero full-bleed — igual a BlogArtigo.jsx */}
      <section className="relative min-h-[480px] md:min-h-[560px] bg-forest flex items-end">
        {capaUrl && (
          <img src={capaUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.38]" />
        )}
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(to top, #12302a 4%, rgba(18,48,42,0.55) 45%, rgba(18,48,42,0.25))' }} />
        <div className="relative w-full max-w-[1152px] mx-auto px-6 md:px-12 pt-40 pb-14 md:pb-[72px]">
          <span className="inline-flex items-center gap-2 font-body text-[13px] text-warmwhite/70 mb-7">
            <Icon name="back" size={14} />Blogue
          </span>
          <div className="h-px w-12 bg-gold mb-6" />
          <div className="font-body text-xs tracking-[0.15em] uppercase text-gold mb-5">
            {areaLabel ? `${areaLabel} · ` : ''}{hoje} · {minutosLeitura(markdown)} min de leitura
          </div>
          <h1 className="font-heading font-normal text-3xl md:text-[52px] leading-[1.12] text-warmwhite max-w-[880px]">
            {titulo}
          </h1>
        </div>
      </section>

      {/* Corpo: rail + prosa — igual ao blogue */}
      <div className="max-w-[1152px] mx-auto px-6 md:px-12 pt-14 md:pt-20 pb-6 grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
        <aside className="hidden lg:block sticky top-[120px] self-start">
          <div className="font-body text-xs tracking-[0.15em] uppercase text-forest/40 mb-3">Neste artigo</div>
          <p className="font-body text-[13.5px] leading-[1.7] text-forest/60">{descricao}</p>
          <div className="h-px w-8 bg-gold my-6" />
          <div className="font-body text-xs tracking-[0.15em] uppercase text-forest/40 mb-2">Escrito por</div>
          <div className="font-heading text-[17px] text-forest">Dra. Vyvian Avena</div>
          <div className="font-body text-[12.5px] text-forest/40">Advogada · Portugal e Brasil</div>
        </aside>
        <div className="max-w-[680px] min-w-0">
          {temAudio && <AudioPreview articleId={articleId} />}
          <article className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>

      {/* CTA contextual — igual ao blogue (estático na pré-visualização) */}
      <div className="max-w-[1152px] mx-auto px-6 md:px-12 pb-2 grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16">
        <div className="hidden lg:block" />
        <div className="bg-forest px-8 py-9 md:px-11 md:py-10 max-w-[680px]">
          <h2 className="font-heading font-normal text-2xl text-warmwhite mb-2.5">
            {areaLabel ? `Precisa de apoio em ${areaLabel}?` : 'Este tema toca a sua situação?'}
          </h2>
          <p className="font-body text-sm text-warmwhite/60 mb-7 leading-relaxed">
            Descreva-nos o seu caso e ajudamos a identificar o enquadramento certo.
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 px-6 py-2.5 bg-gold text-warmwhite text-sm font-body tracking-wide">
              Agendar Consulta
            </span>
          </div>
        </div>
      </div>

      {/* Continuar a ler — com os artigos reais do blogue */}
      {outros.length > 0 && (
        <section className="max-w-[1152px] mx-auto px-6 md:px-12 pt-12 pb-24">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-heading font-normal text-[26px] md:text-[28px] text-forest">Continuar a ler</h2>
            <span className="font-body text-sm text-gold">Todos os artigos</span>
          </div>
          {outros.map((p) => (
            <div key={p.slug} className="grid grid-cols-[112px_1fr] md:grid-cols-[160px_1fr] gap-4 md:gap-8 items-center py-6 border-t border-border">
              <div className="overflow-hidden aspect-[1200/630]">
                <img src={p.imagem} srcSet={capaSrcSet(p.imagem)} sizes="160px" alt="" loading="lazy"
                     className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="font-body text-xs tracking-[0.15em] uppercase text-forest/40 mb-1.5">{fmtSoDataPrev(p.data)} · {p.minutos} min</div>
                <div className="font-heading text-[19px] md:text-[21px] leading-snug text-forest">{p.titulo}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* footer real do site (só visual) */}
      <div style={{ pointerEvents: 'none' }} aria-hidden="true">
        <Footer />
      </div>

      {/* controlo do admin: fechar (flutuante, fora do layout do blogue) */}
      {/* dourado com contorno claro: legível tanto sobre o corpo creme como
          sobre o navbar/rodapé verde-escuro do site */}
      <button type="button" onClick={onClose}
              style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 180, display: 'inline-flex', alignItems: 'center', gap: 8,
                       padding: '11px 20px', borderRadius: 999, cursor: 'pointer',
                       background: '#b8935a', color: '#fff', border: '1px solid rgba(255,255,255,.55)',
                       fontSize: 11.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase',
                       boxShadow: '0 14px 40px rgba(0,0,0,.4), 0 0 0 3px rgba(18,48,42,.18)' }}>
        <Icon name="close" size={13} />Fechar pré-visualização
      </button>
    </div>
  );
}

/* «Ouvir este artigo» na pré-visualização — o MESMO cartão do blogue público
   (AudioArtigo.jsx), a tocar a narração ElevenLabs gerada no editor. A leitura
   acompanhada palavra a palavra só existe no site publicado (timestamps do
   script de publicação). */
const VELOC_PREVIEW = [1, 1.25, 1.5, 2];
const fmtTempo = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

function AudioPreview({ articleId }) {
  const [url, setUrl] = useState(null);
  const [tocar, setTocar] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [vel, setVel] = useState(0);
  const audioRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    let vivo = true;
    api.audioUrl(articleId).then((u) => { if (vivo) setUrl(u); else if (u) URL.revokeObjectURL(u); });
    return () => {
      vivo = false;
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, [articleId]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]); // eslint-disable-line

  if (!url) return null;

  const tique = () => {
    const a = audioRef.current;
    if (a) setT(a.currentTime);
    rafRef.current = requestAnimationFrame(tique);
  };
  const play = () => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio(url);
      a.preload = 'auto';
      a.playbackRate = VELOC_PREVIEW[vel];
      a.addEventListener('loadedmetadata', () => setDur(a.duration || 0));
      a.addEventListener('ended', () => { setTocar(false); cancelAnimationFrame(rafRef.current); });
      audioRef.current = a;
    }
    a.play();
    setTocar(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tique);
  };
  const pause = () => { audioRef.current?.pause(); setTocar(false); cancelAnimationFrame(rafRef.current); };
  const mudarVel = () => {
    const nv = (vel + 1) % VELOC_PREVIEW.length;
    setVel(nv);
    if (audioRef.current) audioRef.current.playbackRate = VELOC_PREVIEW[nv];
  };
  const procurar = (e) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    a.currentTime = frac * dur;
    setT(a.currentTime);
  };

  return (
    <div className="mb-10 border border-gold/35 bg-[#f7f2e9] px-5 py-4 md:px-6 md:py-5">
      <div className="flex items-center gap-4">
        <button type="button" onClick={tocar ? pause : play}
                aria-label={tocar ? 'Pausar a narração' : 'Ouvir este artigo'}
                style={{ width: 48, height: 48, borderRadius: '50%', background: '#b8935a', color: '#12302a',
                         display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
                         border: 'none', cursor: 'pointer' }}>
          {tocar ? <Pause style={{ width: 20, height: 20 }} /> : <Play style={{ width: 20, height: 20, transform: 'translateX(1px)' }} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-heading text-[17px] text-forest leading-tight">Ouvir este artigo</div>
            <div className="font-body text-[12px] text-forest/50 tabular-nums shrink-0">
              {fmtTempo(t / VELOC_PREVIEW[vel])} / {fmtTempo(dur / VELOC_PREVIEW[vel])}
            </div>
          </div>
          <div className="font-body text-[12.5px] text-forest/55 mt-0.5">Narração do artigo · voz sintetizada</div>
          <div role="slider" aria-label="Posição da narração" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)}
               tabIndex={0} onClick={procurar} className="mt-2.5 h-4 flex items-center cursor-pointer group">
            <div className="relative h-[3px] w-full bg-forest/15">
              <div className="absolute inset-y-0 left-0 bg-gold transition-[width] duration-150"
                   style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <button type="button" onClick={mudarVel} aria-label="Velocidade da narração"
                  style={{ fontSize: 12, letterSpacing: '.04em', color: 'rgba(18,48,42,.7)', border: '1px solid rgba(18,48,42,.2)',
                           padding: '2px 8px', background: 'transparent', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
            {VELOC_PREVIEW[vel]}x
          </button>
        </div>
      </div>
    </div>
  );
}

const fmtSoDataPrev = (iso) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
