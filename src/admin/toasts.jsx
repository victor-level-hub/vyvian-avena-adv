// src/admin/toasts.jsx
// Toasts empilhados no canto inferior direito (padrão "sonner" adaptado ao site).
// Uso: admToast('Parcela marcada como paga'); admToast('msg', { kind: 'info' | 'error' });
// Sucessos usam toast; erros importantes continuam em modal (admAlert).
// <ToastHost /> é montado uma vez em AdminApp.jsx.
import React, { useState, useEffect, useRef } from 'react';

let pushImpl = null;
let seq = 0;

export function admToast(message, opts = {}) {
  if (pushImpl) pushImpl({ id: ++seq, message, kind: opts.kind || 'success' });
}

const ICONS = {
  success: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  ),
  info: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  error: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
    </svg>
  ),
};

const DURATION = 4200;

export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  useEffect(() => {
    pushImpl = (t) => {
      setToasts((cur) => [...cur.slice(-3), t]); // máx. 4 em simultâneo
      timers.current[t.id] = setTimeout(() => dismiss(t.id), DURATION);
    };
    return () => { pushImpl = null; Object.values(timers.current).forEach(clearTimeout); };
  }, []);

  const dismiss = (id) => {
    clearTimeout(timers.current[id]);
    // marca como "leaving" para animar a saída, depois remove
    setToasts((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 230);
  };

  if (!toasts.length) return null;
  return (
    <div className="adm-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`adm-toast adm-toast-${t.kind}${t.leaving ? ' leaving' : ''}`}
          onClick={() => dismiss(t.id)}
        >
          <span className="adm-toast-icon">{ICONS[t.kind] || ICONS.success}</span>
          <span className="adm-toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
