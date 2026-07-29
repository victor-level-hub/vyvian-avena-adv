// src/admin/pages/Apoio.jsx — Apoio Técnico (tickets de erros/melhorias/demandas)
// Design system «Vyvian Avena v3» (RsShell). Criação/edição num modal .adm-overlay:
// prints colados com Ctrl+V, ficheiros, gravação de voz com transcrição (Whisper),
// análise de complexidade + plano pela IA (Gemini), campos de impedimentos e
// resolução, e o botão «Efetuar Alteração» (Fase 1: fica Em execução; o Claude
// trata do ticket em sessão — «resolver ticket AT-2026-001»).
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { apoio } from '../apiClient';
import { SkeletonPage } from '../skeletons';
import { admToast } from '../toasts';
import { admConfirm, admAlert } from '../dialogs';
import ModalClose from '../modal-close';
import DateInput from '../datepicker';
import SelectMenu from '../dropdown';
import { RsShell, Icon, Reveal, Seg } from '../rs/ui';

const STATUS_META = {
  rascunho:    { label: 'Rascunho',      fg: 'var(--fg-3)',  bg: 'rgba(125,156,141,.12)' },
  aberto:      { label: 'Aberto',        fg: '#7fb8e8',      bg: 'rgba(96,155,220,.14)' },
  em_analise:  { label: 'Em análise',    fg: 'var(--gold-soft)', bg: 'rgba(184,147,90,.14)' },
  em_execucao: { label: 'Em execução',   fg: '#d4b585',      bg: 'rgba(212,181,133,.18)' },
  impedimento: { label: 'Impedimento',   fg: '#e08b8b',      bg: 'rgba(214,106,106,.16)' },
  resolvido:   { label: 'Resolvido',     fg: '#8fce9f',      bg: 'rgba(110,190,130,.14)' },
  cancelado:   { label: 'Cancelado',     fg: 'var(--fg-3)',  bg: 'rgba(120,120,120,.12)' },
};
const URGENCIA_META = {
  baixa:   { label: 'Baixa',   fg: 'var(--fg-3)' },
  media:   { label: 'Média',   fg: 'var(--gold-soft)' },
  alta:    { label: 'Alta',    fg: '#e0a35b' },
  critica: { label: 'Crítica', fg: '#e08b8b' },
};
const COMPLEX_META = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
const AUTORES = ['Victor', 'Dra. Vyvian'];

const fmtDataHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtData = (s) => (s ? s.split('-').reverse().join('/') : '—');

function Badge({ meta, children }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
                   color: meta.fg, background: meta.bg || 'transparent',
                   border: '1px solid var(--edge-2)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {children || meta.label}
    </span>
  );
}

/* ---------- miniatura/preview de anexo já guardado (busca blob com Bearer) ---------- */
function AnexoItem({ anexo, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true; let obj = null;
    apoio.anexoObjectUrl(anexo.id).then((u) => { if (alive) { obj = u; setUrl(u); } else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [anexo.id]);
  const isImg = (anexo.content_type || '').startsWith('image/');
  const isAudio = anexo.tipo === 'audio' || (anexo.content_type || '').startsWith('audio/');
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: 4, maxWidth: isAudio ? 280 : 120 }}>
      {isImg ? (
        url ? <a href={url} target="_blank" rel="noreferrer" data-tip={anexo.nome}>
                <img src={url} alt={anexo.nome} style={{ width: 110, height: 78, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--edge-2)', display: 'block' }} />
              </a>
            : <div style={{ width: 110, height: 78, borderRadius: 8, border: '1px solid var(--edge-2)', background: 'var(--panel)' }} />
      ) : isAudio ? (
        <>
          {url ? <audio controls src={url} style={{ width: 260, height: 34 }} /> : <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>a carregar…</span>}
          {anexo.transcricao && (
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontStyle: 'italic', lineHeight: 1.45 }}>«{anexo.transcricao}»</span>
          )}
        </>
      ) : (
        <a href={url || '#'} target="_blank" rel="noreferrer" className="link-anim"
           style={{ fontSize: 12.5, color: 'var(--fg-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="doc" size={13} />{anexo.nome || 'ficheiro'}
        </a>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remover anexo" data-tip="Remover"
                style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%',
                         background: '#c0564f', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer',
                         border: '1px solid rgba(0,0,0,.25)' }}>✕</button>
      )}
    </div>
  );
}

/* ---------- área de colar prints (Ctrl+V) + escolher ficheiro ---------- */
function PasteZone({ label, hint, pendentes, guardados, onPaste, onPickFiles, onRemovePendente, onRemoveGuardado, accept }) {
  const inputRef = useRef(null);
  const [focado, setFocado] = useState(false);
  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); onPaste(files); }
  };
  return (
    <div>
      <span className="overline" style={{ fontSize: 9, letterSpacing: '.16em' }}>{label}</span>
      <div tabIndex={0} onPaste={handlePaste} onFocus={() => setFocado(true)} onBlur={() => setFocado(false)}
           onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.focus(); }}
           style={{ marginTop: 7, minHeight: 92, borderRadius: 12, padding: 12, cursor: 'text', outline: 'none',
                    border: '1.5px dashed ' + (focado ? 'var(--gold)' : 'var(--edge-2)'),
                    background: focado ? 'rgba(184,147,90,.06)' : 'var(--panel)',
                    transition: 'border-color .2s, background .2s',
                    display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        {(guardados || []).map((a) => <AnexoItem key={'g' + a.id} anexo={a} onRemove={onRemoveGuardado ? () => onRemoveGuardado(a) : null} />)}
        {(pendentes || []).map((p, i) => (
          <div key={'p' + i} style={{ position: 'relative' }}>
            {p.file.type.startsWith('image/')
              ? <img src={p.preview} alt={p.file.name} style={{ width: 110, height: 78, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--gold)', display: 'block' }} />
              : <span style={{ fontSize: 12.5, color: 'var(--fg-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="doc" size={13} />{p.file.name}</span>}
            <button type="button" onClick={() => onRemovePendente(i)} aria-label="Remover"
                    style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%',
                             background: '#c0564f', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer',
                             border: '1px solid rgba(0,0,0,.25)' }}>✕</button>
          </div>
        ))}
        {!(guardados || []).length && !(pendentes || []).length && (
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)', alignSelf: 'center' }}>
            {hint || 'Clique aqui e cole um print com Ctrl+V…'}
          </span>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => inputRef.current?.click()}>
        <Icon name="plus" size={12} />Escolher ficheiro
      </button>
      <input ref={inputRef} type="file" multiple accept={accept} style={{ display: 'none' }}
             onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) onPickFiles(fs); e.target.value = ''; }} />
    </div>
  );
}

/* ---------- gravador de voz com transcrição ---------- */
function Gravador({ onAudio, transcrevendo }) {
  const [estado, setEstado] = useState('idle'); // idle | rec
  const [seg, setSeg] = useState(0);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const parar = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }, []);
  useEffect(() => () => { parar(); clearInterval(timerRef.current); }, [parar]);

  const gravar = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        setEstado('idle'); setSeg(0);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 500) onAudio(blob);
      };
      rec.start();
      recRef.current = rec;
      setEstado('rec'); setSeg(0);
      timerRef.current = setInterval(() => setSeg((s) => s + 1), 1000);
    } catch (e) {
      admAlert('Não foi possível aceder ao microfone: ' + e.message);
    }
  };

  const mm = String(Math.floor(seg / 60)).padStart(2, '0');
  const ss = String(seg % 60).padStart(2, '0');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {estado === 'idle' ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={gravar} disabled={transcrevendo}
                data-tip="Gravar por voz — o que disser é transcrito para a descrição e o áudio fica guardado no ticket">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg>
          {transcrevendo ? 'A transcrever…' : 'Ditar por voz'}
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-gold btn-sm" onClick={parar}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#1a1208', display: 'inline-block', marginRight: 6 }} />
            Parar
          </button>
          <span style={{ fontSize: 12.5, color: '#e08b8b', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e08b8b', animation: 'adm-pulse 1.1s infinite' }} />
            A gravar {mm}:{ss}
          </span>
        </>
      )}
    </span>
  );
}

/* ================================ MODAL DO TICKET ================================ */
const FORM_VAZIO = { titulo: '', descricao: '', criado_por: 'Victor', urgencia: 'media', data_prazo: '', plano_ia: '', impedimentos: '', resolucao: '' };

function TicketModal({ ticketId, onClose, onChanged, readOnlyInicial }) {
  const [ticket, setTicket] = useState(null);       // null = novo
  const [anexos, setAnexos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [form, setForm] = useState(FORM_VAZIO);
  const [pend, setPend] = useState({ anexo: [], print_abertura: [], print_conclusao: [], audio: [] });
  const [readOnly, setReadOnly] = useState(!!readOnlyInicial);
  const [loading, setLoading] = useState(!!ticketId);
  const [busy, setBusy] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);

  const carregar = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const d = await apoio.get(ticketId);
      setTicket(d.ticket); setAnexos(d.anexos || []); setEventos(d.log || []);
      setForm({
        titulo: d.ticket.titulo || '', descricao: d.ticket.descricao || '',
        criado_por: d.ticket.criado_por || 'Victor', urgencia: d.ticket.urgencia || 'media',
        data_prazo: d.ticket.data_prazo || '', plano_ia: d.ticket.plano_ia || '',
        impedimentos: d.ticket.impedimentos || '', resolucao: d.ticket.resolucao || '',
      });
    } catch (e) { admAlert('Erro ao carregar o ticket: ' + e.message); onClose(); }
    finally { setLoading(false); }
  }, [ticketId, onClose]);
  useEffect(() => { carregar(); }, [carregar]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const addPend = (tipo, files, extra = {}) => setPend((p) => ({
    ...p, [tipo]: [...p[tipo], ...files.map((file) => ({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, ...extra }))],
  }));
  const rmPend = (tipo, i) => setPend((p) => {
    const arr = [...p[tipo]]; const [rem] = arr.splice(i, 1);
    if (rem?.preview) URL.revokeObjectURL(rem.preview);
    return { ...p, [tipo]: arr };
  });

  // upload dos pendentes depois de o ticket existir
  const subirPendentes = async (id) => {
    for (const tipo of Object.keys(pend)) {
      for (const p of pend[tipo]) {
        const r = await apoio.uploadAnexo(id, p.file, { tipo, nome: p.file.name || (tipo === 'audio' ? 'gravacao.webm' : 'print.png') });
        if (tipo === 'audio' && p.transcricao && r?.anexo?.id) {
          await apoio.setTranscricao(r.anexo.id, p.transcricao).catch(() => {});
        }
      }
    }
    setPend({ anexo: [], print_abertura: [], print_conclusao: [], audio: [] });
  };

  // upload imediato quando o ticket já existe; pendente quando é novo
  const anexar = async (tipo, files, extra = {}) => {
    if (!ticket) { addPend(tipo, files, extra); return; }
    setBusy(true);
    try {
      for (const f of files) {
        const r = await apoio.uploadAnexo(ticket.id, f, { tipo, nome: f.name || (tipo === 'audio' ? 'gravacao.webm' : 'print.png') });
        if (tipo === 'audio' && extra.transcricao && r?.anexo?.id) await apoio.setTranscricao(r.anexo.id, extra.transcricao).catch(() => {});
      }
      await carregar(); onChanged();
    } catch (e) { admAlert('Erro no anexo: ' + e.message); }
    finally { setBusy(false); }
  };
  const removerAnexo = async (a) => {
    if (!(await admConfirm(`Remover «${a.nome || 'anexo'}»?`))) return;
    try { await apoio.deleteAnexo(a.id); await carregar(); onChanged(); }
    catch (e) { admAlert('Erro: ' + e.message); }
  };

  // gravação de voz → transcreve → junta à descrição + guarda o áudio no ticket
  const onAudio = async (blob) => {
    setTranscrevendo(true);
    let texto = '';
    try { texto = (await apoio.transcrever(blob)).text || ''; }
    catch (e) { admToast('Transcrição falhou (' + e.message + ') — o áudio fica na mesma guardado no ticket.', { kind: 'error' }); }
    setTranscrevendo(false);
    if (texto) setForm((f) => ({ ...f, descricao: (f.descricao ? f.descricao.trimEnd() + '\n\n' : '') + texto }));
    const file = new File([blob], `gravacao-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
    await anexar('audio', [file], { transcricao: texto });
    if (texto) admToast('Fala transcrita e adicionada à descrição.');
  };

  const validar = () => {
    if (!form.titulo.trim()) { admAlert('Indique o título do pedido.'); return false; }
    return true;
  };

  const guardar = async (abrir) => {
    if (!validar()) return;
    setBusy(true);
    try {
      let id = ticket?.id;
      const body = { ...form, data_prazo: form.data_prazo || null };
      if (!id) {
        const r = await apoio.create({ ...body, status: abrir ? 'aberto' : 'rascunho' });
        id = r.ticket.id;
        await subirPendentes(id);
        admToast(abrir ? `Ticket ${id} aberto.` : `Rascunho ${id} guardado.`);
      } else {
        await apoio.update(id, body);
        if (abrir && ticket.status === 'rascunho') await apoio.abrir(id);
        await subirPendentes(id);
        admToast(abrir && ticket.status === 'rascunho' ? `Ticket ${id} aberto.` : 'Alterações guardadas.');
      }
      onChanged();
      if (abrir || !ticket) { onClose(); } else { await carregar(); }
    } catch (e) { admAlert('Erro ao guardar: ' + e.message); }
    finally { setBusy(false); }
  };

  const analisar = async () => {
    if (!ticket) { admAlert('Guarde o ticket primeiro para a IA o analisar.'); return; }
    setBusy(true);
    try {
      // garante que a IA analisa a versão mais recente do texto
      await apoio.update(ticket.id, { titulo: form.titulo, descricao: form.descricao, urgencia: form.urgencia });
      const r = await apoio.analisar(ticket.id);
      setTicket(r.ticket);
      setForm((f) => ({ ...f, plano_ia: r.ticket.plano_ia || '' }));
      onChanged();
      admToast(`Análise concluída — complexidade ${COMPLEX_META[r.ticket.complexidade] || r.ticket.complexidade}.`);
    } catch (e) { admAlert('Erro na análise: ' + e.message); }
    finally { setBusy(false); }
  };

  const executar = async () => {
    if (!ticket) return;
    const ok = await admConfirm(
      `Efetuar a alteração do ticket ${ticket.id}?\n\nO ticket passa a «Em execução» e o Claude trata dele na próxima sessão de desenvolvimento. Se não for possível, o status muda para «Impedimento» com o motivo detalhado.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await apoio.update(ticket.id, { titulo: form.titulo, descricao: form.descricao, plano_ia: form.plano_ia, impedimentos: form.impedimentos, resolucao: form.resolucao });
      const r = await apoio.executar(ticket.id);
      setTicket(r.ticket); onChanged();
      admToast(`${ticket.id} em execução — diga «resolver ticket ${ticket.id}» numa sessão do Claude.`);
      await carregar();
    } catch (e) { admAlert('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const mudarStatus = async (novo) => {
    if (!ticket) return;
    setBusy(true);
    try { const r = await apoio.update(ticket.id, { status: novo }); setTicket(r.ticket); onChanged(); admToast('Status atualizado.'); }
    catch (e) { admAlert('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const cancelarTicket = async () => {
    if (!ticket) { onClose(); return; }
    if (['resolvido', 'cancelado'].includes(ticket.status)) { onClose(); return; }
    const ok = await admConfirm(`Cancelar o ticket ${ticket.id}? (o registo mantém-se na lista, com status Cancelado)`);
    if (!ok) return;
    await mudarStatus('cancelado');
    onClose();
  };

  const anexosPor = (tipo) => anexos.filter((a) => a.tipo === tipo);
  const st = ticket ? (STATUS_META[ticket.status] || STATUS_META.aberto) : null;
  const label = { display: 'block', fontSize: 9, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 7 };
  const area = { width: '100%', minHeight: 90, resize: 'vertical', padding: '10px 14px', fontSize: 13.5, lineHeight: 1.55, caretColor: 'var(--gold)' };
  const ro = readOnly || busy;

  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}>
      <div className="glass" style={{ width: 'min(880px, 94vw)', height: 'fit-content', padding: '26px 28px', position: 'relative' }}>
        <ModalClose onClose={onClose} />

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>A carregar…</div>
        ) : (
          <>
            {/* cabeçalho */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4, paddingRight: 40 }}>
              <span className="overline">Apoio Técnico</span>
              {ticket && <strong style={{ fontSize: 13, color: 'var(--gold-soft)', letterSpacing: '.06em' }}>{ticket.id}</strong>}
              {st && <Badge meta={st} />}
              {ticket?.urgencia && <Badge meta={{ fg: URGENCIA_META[ticket.urgencia].fg }}>Urgência {URGENCIA_META[ticket.urgencia].label}</Badge>}
              {ticket?.complexidade && <Badge meta={{ fg: 'var(--fg-2)' }} >Complexidade {COMPLEX_META[ticket.complexidade] || ticket.complexidade}</Badge>}
              {readOnly && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setReadOnly(false)}>
                  <Icon name="edit" size={12} />Editar
                </button>
              )}
            </div>
            {ticket && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 16 }}>
                Criado por <strong style={{ color: 'var(--fg-2)' }}>{ticket.criado_por}</strong>
                {ticket.data_abertura ? <> · aberto a {fmtData(ticket.data_abertura)} às {ticket.hora_abertura}</> : <> · rascunho</>}
                {ticket.data_prazo ? <> · prazo {fmtData(ticket.data_prazo)}</> : null}
              </div>
            )}

            <h3 style={{ fontSize: 20, margin: '4px 0 18px' }}>{ticket ? 'Ticket de apoio' : 'Novo ticket de apoio'}</h3>

            {/* identificação */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              <div>
                <span style={label}>Título do pedido *</span>
                <input className="field" value={form.titulo} onChange={(e) => set('titulo')(e.target.value)} disabled={ro}
                       placeholder="Ex.: Erro ao gerar o PDF do plano de pagamento" style={{ width: '100%', padding: '10px 14px', fontSize: 13.5, caretColor: 'var(--gold)' }} />
              </div>

              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <span style={label}>Criado por</span>
                  <SelectMenu value={form.criado_por} ariaLabel="Criado por"
                              options={AUTORES.map((a) => ({ value: a, label: a }))}
                              onChange={(v) => { if (!ro) set('criado_por')(v); }}
                              style={{ minWidth: 150 }} />
                </div>
                <div>
                  <span style={label}>Grau de urgência</span>
                  <Seg small items={Object.entries(URGENCIA_META).map(([k, m]) => ({ k, label: m.label }))} value={form.urgencia}
                       onChange={ro ? () => {} : set('urgencia')} />
                </div>
                <div>
                  <span style={label}>Data de prazo</span>
                  <DateInput value={form.data_prazo} onChange={set('data_prazo')} disabled={ro} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                  <span style={{ ...label, marginBottom: 0 }}>Descrição do pedido</span>
                  {!ro && <Gravador onAudio={onAudio} transcrevendo={transcrevendo} />}
                </div>
                <textarea className="field" style={area} value={form.descricao} onChange={(e) => set('descricao')(e.target.value)} disabled={ro}
                          placeholder="Descreva o erro, a melhoria ou a nova demanda… (ou dite por voz)" />
              </div>

              <PasteZone label="Prints e ficheiros do pedido (Ctrl+V para colar)"
                         hint="Clique aqui e cole um print com Ctrl+V, ou escolha ficheiros…"
                         pendentes={[...pend.print_abertura, ...pend.anexo]}
                         guardados={[...anexosPor('print_abertura'), ...anexosPor('anexo'), ...anexosPor('audio')]}
                         onPaste={(fs) => (ro ? null : anexar('print_abertura', fs))}
                         onPickFiles={(fs) => (ro ? null : anexar('anexo', fs))}
                         onRemovePendente={(i) => { if (ro) return; const nPr = pend.print_abertura.length; if (i < nPr) rmPend('print_abertura', i); else rmPend('anexo', i - nPr); }}
                         onRemoveGuardado={ro ? null : removerAnexo} />

              {/* IA */}
              <div className="glass" style={{ padding: '16px 18px', border: '1px solid var(--edge-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ ...label, marginBottom: 0 }}>Análise da IA</span>
                  {!readOnly && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={analisar} disabled={busy || !ticket}
                            data-tip={ticket ? 'A IA avalia a complexidade e propõe um plano de resolução' : 'Guarde primeiro o ticket'}>
                      <Icon name="spark" size={12} />{busy ? 'A analisar…' : 'Analisar com IA'}
                    </button>
                  )}
                </div>
                {ticket?.complexidade && (
                  <div style={{ fontSize: 12.5, color: 'var(--fg-3)', marginBottom: 10 }}>
                    <strong style={{ color: 'var(--gold-soft)' }}>Complexidade {COMPLEX_META[ticket.complexidade] || ticket.complexidade}</strong>
                    {ticket.complexidade_justificacao ? <> — {ticket.complexidade_justificacao}</> : null}
                  </div>
                )}
                <span style={label}>Como a IA vai resolver</span>
                <textarea className="field" style={{ ...area, minHeight: 76 }} value={form.plano_ia} onChange={(e) => set('plano_ia')(e.target.value)} disabled={ro}
                          placeholder="Preenchido pela análise da IA (editável)…" />
              </div>

              <div>
                <span style={label}>Impedimentos</span>
                <textarea className="field" style={{ ...area, minHeight: 66 }} value={form.impedimentos} onChange={(e) => set('impedimentos')(e.target.value)} disabled={ro}
                          placeholder="Preenchido por quem não conseguir avançar (ex.: falta de token da API, falta de créditos, programa por instalar…)" />
              </div>

              {/* conclusão */}
              <div>
                <span style={label}>Como foi efetuada a resolução</span>
                <textarea className="field" style={{ ...area, minHeight: 66 }} value={form.resolucao} onChange={(e) => set('resolucao')(e.target.value)} disabled={ro}
                          placeholder="Explicação da resolução do problema…" />
              </div>

              <PasteZone label="Prints de evidência da conclusão (Ctrl+V)"
                         hint="Clique aqui e cole com Ctrl+V os prints que evidenciam a conclusão…"
                         pendentes={pend.print_conclusao}
                         guardados={anexosPor('print_conclusao')}
                         onPaste={(fs) => (ro ? null : anexar('print_conclusao', fs))}
                         onPickFiles={(fs) => (ro ? null : anexar('print_conclusao', fs))}
                         onRemovePendente={(i) => (ro ? null : rmPend('print_conclusao', i))}
                         onRemoveGuardado={ro ? null : removerAnexo}
                         accept="image/*" />

              {/* status manual quando já existe */}
              {ticket && !readOnly && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ ...label, marginBottom: 0 }}>Status</span>
                  <Seg small value={ticket.status}
                       items={Object.entries(STATUS_META).filter(([k]) => k !== 'rascunho' || ticket.status === 'rascunho').map(([k, m]) => ({ k, label: m.label }))}
                       onChange={(v) => mudarStatus(v)} />
                </div>
              )}

              {/* histórico */}
              {eventos.length > 0 && (
                <div>
                  <span style={label}>Histórico</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflowY: 'auto', paddingRight: 6 }}>
                    {eventos.map((ev, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--gold-soft)' }}>{fmtDataHora(ev.created_at)}</span>
                        {' · '}<strong style={{ color: 'var(--fg-2)' }}>{ev.autor || '—'}</strong>
                        {' · '}{ev.detalhe || ev.evento}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* rodapé de ações */}
            {!readOnly && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 24, borderTop: '1px solid var(--edge)', paddingTop: 18 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelarTicket} disabled={busy} style={{ marginRight: 'auto' }}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => guardar(false)} disabled={busy}
                        data-tip="Guarda para finalização posterior">
                  {busy ? 'A guardar…' : 'Salvar'}
                </button>
                {(!ticket || ticket.status === 'rascunho') && (
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => guardar(true)} disabled={busy}>
                    <Icon name="check" size={13} />Abrir ticket
                  </button>
                )}
                {ticket && !['rascunho', 'resolvido', 'cancelado'].includes(ticket.status) && (
                  <button type="button" className="btn btn-gold btn-sm" onClick={executar} disabled={busy || ticket.status === 'em_execucao'}
                          data-tip="O Claude tenta efetuar a melhoria; se não conseguir, passa a Impedimento com o motivo">
                    <Icon name="spark" size={13} />{ticket.status === 'em_execucao' ? 'Em execução' : 'Efetuar Alteração'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================================ PÁGINA ================================ */
const FILTRO_STATUS = [{ k: 'all', label: 'Todos' }, ...Object.entries(STATUS_META).map(([k, m]) => ({ k, label: m.label }))];

export default function Apoio() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('all');
  const [modal, setModal] = useState(null); // { id: string|null, readOnly: bool }

  const carregar = useCallback(async () => {
    try { const d = await apoio.list(); setTickets(d.tickets || []); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => tickets.filter((t) => {
    if (fStatus !== 'all' && t.status !== fStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.id.toLowerCase().includes(q) || (t.titulo || '').toLowerCase().includes(q) || (t.descricao || '').toLowerCase().includes(q);
    }
    return true;
  }), [tickets, fStatus, search]);

  const executarDaLista = async (t) => {
    const ok = await admConfirm(
      `Efetuar a alteração do ticket ${t.id}?\n\nO ticket passa a «Em execução» e o Claude trata dele na próxima sessão. Se não for possível, o status muda para «Impedimento» com o motivo.`,
    );
    if (!ok) return;
    try { await apoio.executar(t.id); admToast(`${t.id} em execução.`); carregar(); }
    catch (e) { admAlert('Erro: ' + e.message); }
  };

  if (loading) return <SkeletonPage kpis={0} rows={6} />;
  if (error) return <div className="adm-login-error">{error}</div>;

  const abertos = tickets.filter((t) => !['resolvido', 'cancelado', 'rascunho'].includes(t.status)).length;
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--gold)', borderBottom: '1px solid var(--edge-2)', whiteSpace: 'nowrap' };
  const td = { padding: '12px 12px', borderBottom: '1px solid var(--edge)', fontSize: 13.5, color: 'var(--fg-2)', verticalAlign: 'middle' };

  return (
    <RsShell overline="Área privada · Apoio Técnico" titulo="Apoio Técnico"
             sub={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} · ${abertos} em curso — erros, melhorias e novas demandas do sistema`}
             right={<button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 4 }} onClick={() => setModal({ id: null })}>
                      <Icon name="plus" size={13} />Novo ticket
                    </button>}>

      <Reveal>
        <div className="glass" style={{ padding: '16px 18px', marginBottom: 18, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="field" placeholder="Pesquisar por ID, título ou descrição…" value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 style={{ flex: 1, minWidth: 220, padding: '10px 14px', fontSize: 13.5, caretColor: 'var(--gold)' }} />
          <Seg small items={FILTRO_STATUS} value={fStatus} onChange={setFStatus} />
        </div>
      </Reveal>

      {filtrados.length === 0 ? (
        <Reveal cls="glass" style={{ padding: '40px 30px', textAlign: 'center', fontSize: 13.5, color: 'var(--fg-3)' }}>
          {tickets.length === 0 ? 'Ainda não há tickets. Crie o primeiro com «Novo ticket».' : 'Nenhum ticket com esses filtros.'}
        </Reveal>
      ) : (
        <Reveal d={80}>
          <div className="glass" style={{ padding: '6px 8px 4px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>ID</th>
                  <th style={th}>Título</th>
                  <th style={th}>Status</th>
                  <th style={th}>Urgência</th>
                  <th style={th}>Compl.</th>
                  <th style={th}>Abertura</th>
                  <th style={th}>Prazo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((t) => {
                  const st = STATUS_META[t.status] || STATUS_META.aberto;
                  const ug = URGENCIA_META[t.urgencia] || URGENCIA_META.media;
                  return (
                    <tr key={t.id} style={{ transition: 'background .2s' }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--panel)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--gold-soft)', fontWeight: 700 }}>{t.id}</td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        <span style={{ color: 'var(--fg)', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo}</span>
                        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t.criado_por}{Number(t.n_anexos) > 0 ? ` · ${t.n_anexos} anexo${t.n_anexos > 1 ? 's' : ''}` : ''}</span>
                      </td>
                      <td style={td}><Badge meta={st} /></td>
                      <td style={{ ...td, color: ug.fg, fontWeight: 600, fontSize: 12.5 }}>{ug.label}</td>
                      <td style={{ ...td, fontSize: 12.5 }}>{COMPLEX_META[t.complexidade] || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12.5 }}>{t.data_abertura ? `${fmtData(t.data_abertura)} ${t.hora_abertura || ''}` : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12.5 }}>{fmtData(t.data_prazo)}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ id: t.id, readOnly: true })} data-tip="Abrir o ticket">
                          Abrir
                        </button>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ id: t.id })} data-tip="Editar o ticket">
                          <Icon name="edit" size={12} />
                        </button>{' '}
                        {!['rascunho', 'resolvido', 'cancelado', 'em_execucao'].includes(t.status) && (
                          <button type="button" className="btn btn-gold btn-sm" onClick={() => executarDaLista(t)}
                                  data-tip="O Claude tenta efetuar a melhoria; se não conseguir, passa a Impedimento com o motivo">
                            Efetuar Alteração
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {modal && (
        <TicketModal ticketId={modal.id} readOnlyInicial={modal.readOnly}
                     onClose={() => setModal(null)} onChanged={carregar} />
      )}
    </RsShell>
  );
}
