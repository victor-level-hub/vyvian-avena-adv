// src/admin/cmdk.jsx
// Command palette (Ctrl+K / Cmd+K): saltar para qualquer cliente ou página.
// "/" foca a pesquisa da página atual (quando existe).
// Montado uma vez em AdminApp.jsx.
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clients as clientsApi } from './apiClient';
import { isAuthenticated } from './auth';
import { IconSearch, IconUser } from './icons';

const PAGES = [
  { id: 'novo', label: 'Novo cliente', to: '/admin/clientes/novo' },
  { id: 'painel', label: 'Painel', to: '/admin/painel' },
  { id: 'clientes', label: 'Clientes', to: '/admin/clientes' },
  { id: 'parcelas', label: 'Parcelas e mensalidades', to: '/admin/parcelas' },
  { id: 'calendario', label: 'Calendário', to: '/admin/calendario' },
  { id: 'notificacoes', label: 'Notificações', to: '/admin/notificacoes' },
];

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [clientsList, setClientsList] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // atalhos globais: Ctrl/Cmd+K abre; "/" foca a pesquisa da página
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (!isAuthenticated()) return;
        e.preventDefault();
        setOpen((o) => !o); setQ(''); setIdx(0);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        const tag = (t.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
        const el = document.querySelector('input.adm-in-search');
        if (el) { e.preventDefault(); el.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // carrega a lista de clientes na primeira abertura (cache em memória)
  useEffect(() => {
    if (open && clientsList === null) {
      clientsApi.list().then((r) => setClientsList(r.clients || [])).catch(() => setClientsList([]));
    }
    if (open) setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
  }, [open, clientsList]);

  if (!open) return null;

  const nq = norm(q.trim());
  const cliMatches = nq && clientsList
    ? clientsList.filter((c) =>
        norm(c.name).includes(nq) ||
        (c.tax_id || '').replace(/\s/g, '').includes(q.trim().replace(/\s/g, '')) ||
        norm(c.email || '').includes(nq)
      ).slice(0, 8)
    : [];
  const pageMatches = PAGES.filter((p) => !nq || norm(p.label).includes(nq));
  const items = [
    ...cliMatches.map((c) => ({ kind: 'Cliente', key: 'c' + c.id, label: c.name, sub: c.practice_area || c.email || c.country, to: `/admin/clientes/${c.id}` })),
    ...pageMatches.map((p) => ({ kind: 'Página', key: 'p' + p.id, label: p.label, sub: null, to: p.to })),
  ];
  const sel = Math.min(idx, Math.max(0, items.length - 1));

  const go = (item) => { if (item) { navigate(item.to); setOpen(false); } };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="adm-overlay adm-cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="adm-cmdk">
        <div className="adm-cmdk-input">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            type="text"
            value={q}
            placeholder="Procurar cliente ou página…"
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={onInputKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="adm-cmdk-list">
          {clientsList === null && nq && <div className="adm-cmdk-empty">A carregar clientes…</div>}
          {items.length === 0 && <div className="adm-cmdk-empty">Nada encontrado para “{q}”.</div>}
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              className={'adm-cmdk-item' + (i === sel ? ' sel' : '')}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(item)}
            >
              <span className="adm-cmdk-item-icon">
                {item.kind === 'Cliente' ? <IconUser size={13} /> : '→'}
              </span>
              <span className="adm-cmdk-item-label">
                {item.label}
                {item.sub && <small>{item.sub}</small>}
              </span>
              <span className="adm-cmdk-item-kind">{item.kind}</span>
            </button>
          ))}
        </div>
        <div className="adm-cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> abrir/fechar</span>
        </div>
      </div>
    </div>
  );
}
