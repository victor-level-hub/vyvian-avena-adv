// src/admin/dialogs.jsx — diálogos com o layout do site.
// Substituem alert/confirm/prompt nativos do browser na área privada.
//   admAlert(mensagem, { title? })                    -> Promise<void>
//   admConfirm(mensagem, { title?, okLabel?, cancelLabel?, danger? }) -> Promise<boolean>
//   admPrompt(mensagem, { title?, defaultValue?, placeholder? })      -> Promise<string|null>
// O <DialogHost /> é montado uma única vez no AdminApp.
import React, { useEffect, useState } from 'react';

let pushDialog = null; // ligado quando o DialogHost monta

function open(cfg) {
  return new Promise((resolve) => {
    if (!pushDialog) {
      // fallback (host não montado): usa os nativos para nunca engolir a ação
      if (cfg.kind === 'confirm') return resolve(window.confirm(cfg.message));
      if (cfg.kind === 'prompt') return resolve(window.prompt(cfg.message, cfg.defaultValue || ''));
      window.alert(cfg.message);
      return resolve(undefined);
    }
    pushDialog({ ...cfg, resolve });
  });
}

export const admAlert = (message, opts = {}) => open({ kind: 'alert', message, ...opts });
export const admConfirm = (message, opts = {}) => open({ kind: 'confirm', message, ...opts });
export const admPrompt = (message, opts = {}) => open({ kind: 'prompt', message, ...opts });

export function DialogHost() {
  const [queue, setQueue] = useState([]);
  const [value, setValue] = useState('');
  const d = queue[0] || null;

  useEffect(() => {
    pushDialog = (cfg) => setQueue((q) => [...q, cfg]);
    return () => { pushDialog = null; };
  }, []);

  useEffect(() => {
    if (d && d.kind === 'prompt') setValue(d.defaultValue || '');
  }, [d]);

  useEffect(() => {
    if (!d) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close(d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined);
      if (e.key === 'Enter' && d.kind !== 'prompt') close(d.kind === 'confirm' ? true : undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  if (!d) return null;

  function close(result) {
    d.resolve(result);
    setQueue((q) => q.slice(1));
  }

  const defaultTitle = d.kind === 'confirm' ? 'Confirmar' : d.kind === 'prompt' ? 'Introduzir' : 'Atenção';

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', zIndex: 2000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '18vh 1rem 2rem',
      }}
    >
      <div style={{
        background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 460,
        padding: '1.5rem 1.6rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        borderTop: '3px solid var(--gold, #b8935a)',
      }}>
        <h2 style={{ margin: '0 0 0.8rem', fontFamily: 'var(--serif)', fontSize: '1.15rem', color: 'var(--forest, #12302a)' }}>
          {d.title || defaultTitle}
        </h2>
        <div style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink, #333)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {d.message}
        </div>
        {d.kind === 'prompt' && (
          <input
            autoFocus
            type="text"
            value={value}
            placeholder={d.placeholder || ''}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') close(value); }}
            style={{
              width: '100%', marginTop: '0.9rem', padding: '0.5rem 0.7rem',
              border: '1px solid rgba(0,0,0,0.2)', borderRadius: 4, fontSize: '0.9rem',
              fontFamily: 'var(--sans)', background: '#fff',
            }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.3rem' }}>
          {(d.kind === 'confirm' || d.kind === 'prompt') && (
            <button
              type="button"
              className="adm-btn"
              onClick={() => close(d.kind === 'confirm' ? false : null)}
            >
              {d.cancelLabel || 'Cancelar'}
            </button>
          )}
          <button
            type="button"
            autoFocus={d.kind !== 'prompt'}
            className={'adm-btn ' + (d.danger ? 'adm-btn-primary' : 'adm-btn-gold')}
            style={d.danger ? { background: '#8e1f1f', borderColor: '#8e1f1f' } : undefined}
            onClick={() => close(d.kind === 'confirm' ? true : d.kind === 'prompt' ? value : undefined)}
          >
            {d.okLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
