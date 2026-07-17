// src/admin/modal-close.jsx
// Fecho padrão de TODOS os modais da Área Privada: bolinha com o ✕ dourado no
// canto superior direito. O cartão do modal tem de ter `position: relative`.
//
// Fecha também com a tecla Esc. Como os modais se empilham (o "Eliminar
// cliente" abre por cima do "Editar cliente"), o Esc só fecha o modal do topo —
// sem esta pilha, um Esc fechava os dois de uma vez.
import React, { useEffect, useRef } from 'react';

const pilha = [];

export default function ModalClose({ onClose, disabled = false, title = 'Fechar' }) {
  // O ref mantém a entrada na pilha estável entre renders (o efeito corre uma
  // vez por modal); onClose/disabled são lidos sempre atualizados.
  const ref = useRef({ onClose, disabled });
  ref.current.onClose = onClose;
  ref.current.disabled = disabled;

  useEffect(() => {
    const entrada = ref.current;
    pilha.push(entrada);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (pilha[pilha.length - 1] !== entrada || entrada.disabled) return;
      e.stopPropagation();
      entrada.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const i = pilha.indexOf(entrada);
      if (i >= 0) pilha.splice(i, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <button
      type="button"
      className="adm-modal-close"
      onClick={onClose}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
        <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}
