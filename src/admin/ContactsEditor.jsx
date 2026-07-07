// src/admin/ContactsEditor.jsx
// Lista dinâmica de contactos (e-mails ou telefones) com label por entrada.
// Labels: predefinidas + personalizadas (persistidas em localStorage) + "+ Nova label…".
import React, { useState } from 'react';

const DEFAULT_LABELS = ['Pessoal', 'Empresa', 'Sócio-gerente', 'Financeiro', 'Trabalho', 'Outro'];
const LS_KEY = 'vyvian_contact_labels';

function loadCustomLabels() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveCustomLabel(label) {
  const cur = loadCustomLabels();
  if (!cur.includes(label)) {
    try { localStorage.setItem(LS_KEY, JSON.stringify([...cur, label])); } catch {}
  }
}

export default function ContactsEditor({ kind, items, onChange, disabled, requiredFirst, invalid, inputId }) {
  // kind: 'email' | 'phone'
  // invalid: marca a primeira linha a vermelho; inputId: id do primeiro input (para scroll/focus)
  const [customLabels, setCustomLabels] = useState(loadCustomLabels);
  const isEmail = kind === 'email';

  const allLabels = [...DEFAULT_LABELS, ...customLabels.filter((l) => !DEFAULT_LABELS.includes(l))];

  const setItem = (idx, patch) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  };

  const handleLabelChange = (idx) => (e) => {
    const v = e.target.value;
    if (v === '__nova__') {
      const nova = (window.prompt('Nome da nova label (ex.: Contabilista, Advogado BR…):') || '').trim();
      if (nova) {
        saveCustomLabel(nova);
        setCustomLabels(loadCustomLabels());
        setItem(idx, { label: nova });
      }
      return;
    }
    setItem(idx, { label: v });
  };

  const addRow = () => onChange([...items, { label: isEmail ? 'Pessoal' : 'Pessoal', value: '' }]);
  const removeRow = (idx) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div className="adm-field adm-full">
      <label style={invalid ? { color: '#c00000' } : undefined}>
        {isEmail ? 'E-mails' : 'Telefones (WhatsApp)'}
        {requiredFirst ? ' *' : ''}
        {invalid && <span style={{ fontWeight: 400 }}> — obrigatório</span>}
      </label>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <select
            value={allLabels.includes(it.label) ? it.label : it.label || 'Pessoal'}
            onChange={handleLabelChange(idx)}
            disabled={disabled}
            style={{ flex: '0 0 34%', maxWidth: 190 }}
          >
            {!allLabels.includes(it.label) && it.label && <option value={it.label}>{it.label}</option>}
            {allLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value="__nova__">＋ Nova label…</option>
          </select>
          <input
            id={idx === 0 ? inputId : undefined}
            type={isEmail ? 'email' : 'tel'}
            value={it.value}
            onChange={(e) => setItem(idx, { value: e.target.value })}
            placeholder={isEmail ? 'nome@exemplo.pt' : '+351 91 …'}
            disabled={disabled}
            style={{ flex: 1, ...(invalid && idx === 0 ? { borderColor: '#c00000', boxShadow: '0 0 0 2px rgba(192,0,0,0.14)' } : {}) }}
          />
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(idx)}
              disabled={disabled}
              title="Remover"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b00', fontSize: '1rem', padding: '0 0.25rem' }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.25)', borderRadius: 4, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted, #666)' }}
      >
        ＋ adicionar {isEmail ? 'e-mail' : 'telefone'}
      </button>
    </div>
  );
}

// Helpers partilhados
export function parseContacts(jsonStr, fallbackValue, fallbackLabel = 'Pessoal') {
  try {
    const arr = JSON.parse(jsonStr || 'null');
    if (Array.isArray(arr) && arr.length) return arr.map((c) => ({ label: c.label || fallbackLabel, value: c.value || '' }));
  } catch {}
  return fallbackValue ? [{ label: fallbackLabel, value: fallbackValue }] : [{ label: fallbackLabel, value: '' }];
}

export function cleanContacts(items) {
  return items.map((c) => ({ label: (c.label || '').trim() || 'Pessoal', value: (c.value || '').trim() })).filter((c) => c.value);
}
