import React, { useEffect, useRef, useState } from 'react';

// Modal partilhado dos leitores IA (NewClient e ClientDetail).
// Arrastar diretamente para o dropzone continua a funcionar sem modal;
// o clique abre isto: caixa de texto editável (colar e-mails, mensagens,
// excertos) + anexar quantos ficheiros quiser. Tudo segue para a mesma
// extração por IA — o texto como text/plain, cada ficheiro como binário.

const ACCEPT = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,application/pdf';

const fmtKB = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function LerIAModal({ open, onClose, onSubmeter }) {
  const [texto, setTexto] = useState('');
  const [files, setFiles] = useState([]);
  const [aviso, setAviso] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTexto(''); setFiles([]); setAviso(''); setDragOver(false);
      setTimeout(() => textRef.current && textRef.current.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  const juntar = (lista) => {
    const novos = [...lista].filter((f) => {
      if (!ACCEPT.includes(f.type)) { setAviso(`"${f.name}" ignorado — use PNG, JPEG, WEBP ou PDF.`); return false; }
      return !files.some((x) => x.name === f.name && x.size === f.size);
    });
    if (novos.length) setFiles((prev) => [...prev, ...novos]);
  };

  const podeSubmeter = texto.trim().length > 0 || files.length > 0;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4rem 1rem', zIndex: 1100, overflowY: 'auto' }}
    >
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) juntar(e.dataTransfer.files); }}
        style={{ background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 560, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', borderTop: `3px solid var(--gold, #b8935a)`, outline: dragOver ? '2px dashed var(--gold, #b8935a)' : 'none', outlineOffset: -8 }}
      >
        <h2 style={{ margin: '0 0 0.35rem', fontFamily: 'var(--serif)', color: 'var(--forest, #12302a)' }}>Ler com IA</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.86rem', color: 'var(--muted, #666)' }}>
          Cole texto (e-mail, mensagem, excerto de documento…), anexe ficheiros — ou ambos.
          A IA extrai os dados e preenche apenas o que estiver em falta.
        </p>

        <textarea
          ref={textRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Cole aqui o texto a analisar…"
          rows={7}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 130, padding: '0.7rem 0.85rem', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 6, background: '#fff', font: 'inherit', fontSize: '0.9rem', color: 'var(--ink, #333)' }}
        />

        <div style={{ margin: '0.85rem 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) juntar(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => inputRef.current && inputRef.current.click()}
            style={{ background: 'transparent', border: '1px solid rgba(0,0,0,0.25)', borderRadius: 6, padding: '0.45rem 0.9rem', cursor: 'pointer', font: 'inherit', fontSize: '0.85rem', color: 'var(--forest, #12302a)' }}>
            📎 Anexar ficheiros…
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted, #888)' }}>PNG, JPEG, WEBP ou PDF · também pode arrastar para aqui</span>
        </div>

        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', margin: '0.6rem 0 0' }}>
            {files.map((f, i) => (
              <span key={`${f.name}-${f.size}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(184,147,90,0.12)', border: '1px solid rgba(184,147,90,0.45)', borderRadius: 999, padding: '0.25rem 0.4rem 0.25rem 0.7rem', fontSize: '0.8rem', color: 'var(--forest, #12302a)' }}>
                {f.name} <em style={{ opacity: 0.6, fontStyle: 'normal' }}>({fmtKB(f.size)})</em>
                <button type="button" aria-label={`Remover ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{ border: 'none', background: 'rgba(18,48,42,0.12)', borderRadius: '50%', width: 18, height: 18, lineHeight: '16px', cursor: 'pointer', fontSize: 11, color: 'var(--forest, #12302a)', padding: 0 }}>✕</button>
              </span>
            ))}
          </div>
        )}

        {aviso && <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: '#b00' }}>{aviso}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.4rem' }}>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: '1px solid rgba(0,0,0,0.25)', borderRadius: 6, padding: '0.55rem 1rem', cursor: 'pointer', font: 'inherit', fontSize: '0.88rem', color: 'var(--ink, #333)' }}>
            Cancelar
          </button>
          <button type="button" disabled={!podeSubmeter}
            onClick={() => onSubmeter(texto.trim(), files)}
            style={{ background: 'var(--gold, #b8935a)', border: 'none', borderRadius: 6, padding: '0.55rem 1.2rem', cursor: podeSubmeter ? 'pointer' : 'not-allowed', opacity: podeSubmeter ? 1 : 0.45, font: 'inherit', fontSize: '0.88rem', fontWeight: 600, color: '#fff' }}>
            Ler com IA
          </button>
        </div>
      </div>
    </div>
  );
}
