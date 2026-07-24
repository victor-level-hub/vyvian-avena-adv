// src/admin/ParcelasEditor.jsx
// Editor de parcelas com valores individuais (parcelas não precisam de ser todas iguais).
// Mostra a soma em destaque: vermelho enquanto não "fecha" com o valor total do plano
// (indicando quanto falta ou quanto está a mais), verde quando bate certo.
// Usado no cadastro de novo cliente e na edição do plano na ficha do cliente.
import React from 'react';
import DateInput from './datepicker';

export function addMonthsISO(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function parseValor(v) {
  return parseFloat(String(v ?? '').replace(',', '.')) || 0;
}

export function fmtValor(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  return symbol + ' ' + Number(amount || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Divide o total em n parcelas iguais; a última absorve o arredondamento
// (ex.: 100/3 -> 33,33 + 33,33 + 33,34).
export function gerarParcelas(total, n, startDate, startN = 1) {
  const per = Math.floor((total / n) * 100) / 100;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ n: startN + i, due_date: addMonthsISO(startDate, i), amount: per.toFixed(2) });
  }
  if (rows.length) {
    const resto = Math.round((total - per * n) * 100) / 100;
    rows[rows.length - 1].amount = (per + resto).toFixed(2);
  }
  return rows;
}

export function somaParcelas(rows) {
  return Math.round(rows.reduce((s, r) => s + parseValor(r.amount), 0) * 100) / 100;
}

export default function ParcelasEditor({ rows, onChange, currency, targetTotal, baseSum = 0, baseLabel = null, disabled, onRemove = null, onUnmark = null }) {
  const soma = Math.round((somaParcelas(rows) + baseSum) * 100) / 100;
  const diff = Math.round((targetTotal - soma) * 100) / 100;
  const fecha = Math.abs(diff) < 0.005;

  const setRow = (idx, patch) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div>
      <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'hidden', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, padding: '0.4rem 0.6rem', background: '#fff' }}>
        {rows.map((r, idx) => (
          <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.25rem 0', borderBottom: idx < rows.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
            <div style={{ flex: '0 0 96px', fontFamily: 'var(--sans)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--forest, #12302a)' }}>
              Parcela {r.n}
              {r.paid && (
                <span
                  role={onUnmark ? 'button' : undefined}
                  tabIndex={onUnmark ? 0 : undefined}
                  data-tip={onUnmark ? 'Clique para desmarcar — volta a pendente (os documentos mantêm-se)' : undefined}
                  onClick={onUnmark && !disabled ? () => onUnmark(idx) : undefined}
                  style={{
                    display: 'inline-block', marginLeft: '0.35rem', padding: '0.08rem 0.4rem',
                    fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.08em',
                    background: 'rgba(31,138,76,0.14)', color: '#1f7a43', borderRadius: 3,
                    textTransform: 'uppercase', verticalAlign: '1px',
                    cursor: onUnmark && !disabled ? 'pointer' : 'default',
                  }}
                >
                  Paga{onUnmark ? ' ✕' : ''}
                </span>
              )}
            </div>
            <DateInput
              value={r.due_date}
              onChange={(e) => setRow(idx, { due_date: e.target.value })}
              disabled={disabled}
              clearable={false}
              style={{ flex: '0 0 138px', width: 'auto' }}
            />
            <span style={{ position: 'relative', flex: 1, minWidth: 96, display: 'block' }}>
              <span style={{
                position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)',
                fontSize: '0.75rem', color: 'var(--muted, #888)', pointerEvents: 'none', lineHeight: 1,
              }}>
                {currency === 'BRL' ? 'R$' : '€'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => setRow(idx, { amount: e.target.value })}
                disabled={disabled}
                style={{ width: '100%', fontSize: '0.82rem', padding: '0.25rem 0.5rem', paddingLeft: currency === 'BRL' ? '1.9rem' : '1.4rem', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 4, textAlign: 'right', boxSizing: 'border-box' }}
              />
            </span>
            {onRemove && !r.paid && (
              <button
                type="button"
                onClick={() => onRemove(idx)}
                disabled={disabled || rows.length <= 1}
                data-tip="Eliminar esta parcela (ex.: valores adiantados pelo cliente)"
                style={{
                  flex: '0 0 auto', background: 'none', border: 'none', cursor: rows.length > 1 ? 'pointer' : 'default',
                  color: rows.length > 1 ? '#b00000' : 'rgba(0,0,0,0.2)', fontSize: '0.95rem', padding: '0 0.2rem', lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Soma em destaque: verde quando fecha com o total, vermelho com a diferença */}
      <div style={{
        marginTop: '0.6rem', padding: '0.55rem 0.8rem', borderRadius: 6,
        fontFamily: 'var(--sans)', fontSize: '0.85rem', fontWeight: 600,
        background: fecha ? 'rgba(31,138,76,0.10)' : 'rgba(176,0,0,0.08)',
        color: fecha ? '#1f7a43' : '#b00000',
        border: `1px solid ${fecha ? 'rgba(31,138,76,0.35)' : 'rgba(176,0,0,0.3)'}`,
      }}>
        {baseLabel && <span style={{ display: 'block', fontWeight: 400, fontSize: '0.75rem', marginBottom: 2 }}>{baseLabel}</span>}
        Soma: {fmtValor(soma, currency)} de {fmtValor(targetTotal, currency)}
        {!fecha && (
          <span style={{ fontWeight: 700 }}>
            {' — '}{diff > 0 ? `faltam ${fmtValor(diff, currency)}` : `${fmtValor(-diff, currency)} a mais`}
          </span>
        )}
        {fecha && ' ✓'}
      </div>
    </div>
  );
}
