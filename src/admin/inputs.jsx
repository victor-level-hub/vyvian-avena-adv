// src/admin/inputs.jsx
// Campos de input melhorados (padrão 21st.dev / Origin UI adaptado ao estilo do site):
//  - MoneyInput     — input com símbolo de moeda fixo (€ / R$) à esquerda
//  - StepperInput   — input numérico com chevrons ▲▼ próprios
//  - SearchInput    — pesquisa com lupa à esquerda e ✕ de limpar à direita
//  - TagsInput      — etiquetas removíveis (Enter/vírgula adiciona) — ex.: nacionalidades
//  - PasswordInput  — palavra-passe com olho mostrar/ocultar
//  - IconInput      — input com ícone inicial (@ ou telefone)
// Estilos em admin.css (secção INPUT ADORNMENTS).
import React, { useState, useRef } from 'react';
import { IconSearch, IconPhone } from './icons';

const Svg = ({ children, size = 14, style }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flexShrink: 0, ...style }} aria-hidden="true"
  >
    {children}
  </svg>
);
const IconMail = (p) => (
  <Svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></Svg>
);
const IconEye = (p) => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Svg>
);
const IconEyeOff = (p) => (
  <Svg {...p}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></Svg>
);

export function moneySymbol(currency) {
  return currency === 'BRL' ? 'R$' : '€';
}

// ── Input com símbolo de moeda fixo ─────────────────────────────
export function MoneyInput({ currency = 'EUR', style, ...props }) {
  const sym = moneySymbol(currency);
  return (
    <span className="adm-input-wrap">
      <span className={'adm-input-prefix' + (sym.length > 1 ? ' wide' : '')}>{sym}</span>
      <input type="text" inputMode="decimal" {...props} style={style} className={('adm-in-prefix' + (sym.length > 1 ? ' adm-in-prefix-wide' : '') + ' ' + (props.className || '')).trim()} />
    </span>
  );
}

// ── Input numérico com chevrons próprios ────────────────────────
export function StepperInput({ value, onChange, min = 1, max = 999, disabled, style, ...props }) {
  const bump = (delta) => {
    if (disabled) return;
    const cur = parseInt(value, 10) || 0;
    const next = Math.min(max, Math.max(min, cur + delta));
    onChange({ target: { value: String(next) } });
  };
  return (
    <span className="adm-input-wrap">
      <input
        type="number" min={min} max={max} value={value} onChange={onChange}
        disabled={disabled} style={style} {...props}
        className={('adm-in-stepper ' + (props.className || '')).trim()}
      />
      <span className="adm-stepper-btns">
        <button type="button" tabIndex={-1} onClick={() => bump(1)} disabled={disabled} aria-label="Aumentar">
          <Svg size={11}><path d="m18 15-6-6-6 6" /></Svg>
        </button>
        <button type="button" tabIndex={-1} onClick={() => bump(-1)} disabled={disabled} aria-label="Diminuir">
          <Svg size={11}><path d="m6 9 6 6 6-6" /></Svg>
        </button>
      </span>
    </span>
  );
}

// ── Pesquisa com lupa + limpar ──────────────────────────────────
export function SearchInput({ value, onChange, placeholder, style, ...props }) {
  return (
    <span className="adm-input-wrap" style={style}>
      <span className="adm-input-icon"><IconSearch size={15} /></span>
      <input
        type="search" value={value} onChange={onChange} placeholder={placeholder} {...props}
        className={('adm-in-icon adm-in-search ' + (props.className || '')).trim()}
      />
      {value && (
        <button
          type="button" className="adm-input-clear" aria-label="Limpar pesquisa"
          onClick={() => onChange({ target: { value: '' } })}
        >
          <Svg size={13}><path d="M18 6 6 18M6 6l12 12" /></Svg>
        </button>
      )}
    </span>
  );
}

// ── Etiquetas (tags) removíveis — ex.: nacionalidades ───────────
export function TagsInput({ tags, onChange, placeholder, disabled, id }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const commit = () => {
    const t = draft.trim().replace(/,+$/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
  };

  return (
    <div className={'adm-tags' + (disabled ? ' disabled' : '')} onClick={() => inputRef.current && inputRef.current.focus()}>
      {tags.map((t) => (
        <span key={t} className="adm-tag">
          {t}
          {!disabled && (
            <button type="button" aria-label={`Remover ${t}`} onClick={(e) => { e.stopPropagation(); onChange(tags.filter((x) => x !== t)); }}>
              <Svg size={11}><path d="M18 6 6 18M6 6l12 12" /></Svg>
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef} id={id} type="text" value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={tags.length ? '' : placeholder}
      />
    </div>
  );
}

// ── Palavra-passe com mostrar/ocultar ───────────────────────────
export function PasswordInput({ style, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className="adm-input-wrap" style={style}>
      <input type={show ? 'text' : 'password'} {...props} className={('adm-in-suffix ' + (props.className || '')).trim()} />
      <button
        type="button" className="adm-input-eye" tabIndex={-1}
        aria-label={show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </span>
  );
}

// ── Radio-cards — opções como cartões clicáveis ─────────────────
// options: [{ value, title, desc? }]
export function RadioCards({ options, value, onChange, disabled }) {
  return (
    <div className="adm-radio-cards">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          className={'adm-radio-card' + (value === o.value ? ' sel' : '')}
          onClick={() => onChange(o.value)}
        >
          <span className="adm-radio-card-title">{o.title}</span>
          {o.desc && <span className="adm-radio-card-desc">{o.desc}</span>}
          <span className="adm-radio-card-check" aria-hidden="true">
            <Svg size={11}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Input com ícone inicial (@ / telefone) ──────────────────────
export function IconInput({ icon, style, inputStyle, ...props }) {
  return (
    <span className="adm-input-wrap" style={style}>
      <span className="adm-input-icon">
        {icon === 'phone' ? <IconPhone size={14} /> : <IconMail size={14} />}
      </span>
      <input {...props} style={inputStyle} className={('adm-in-icon ' + (props.className || '')).trim()} />
    </span>
  );
}
