// src/admin/people-picker.jsx
// Escolha das pessoas do cliente que entram num documento (clientes conjuntos).
//
//   mode="multi"  → várias pessoas (plano de pagamento: que titulares constam)
//   mode="single" → uma só pessoa (procuração: quem é o outorgante — os modelos
//                   atuais estão redigidos no singular)
//
// Não renderiza nada em clientes de uma só pessoa: não há nada para escolher.
import React from 'react';

export default function PeoplePicker({
  people = [],
  selected = [],
  onChange,
  mode = 'multi',
  disabled = false,
  label,
  helper,
}) {
  if (people.length < 2) return null;

  const ids = people.map((p) => p.id);

  const toggle = (id) => {
    if (disabled) return;
    if (mode === 'single') {
      onChange([id]);
      return;
    }
    const tem = selected.includes(id);
    if (tem && selected.length === 1) return; // nunca deixar ficar zero
    const novo = tem ? selected.filter((s) => s !== id) : [...selected, id];
    onChange(ids.filter((i) => novo.includes(i))); // mantém a ordem do cadastro
  };

  return (
    <div className="adm-field" style={{ margin: '0 0 1rem' }}>
      {label && <label>{label}</label>}
      <div className="adm-people-picker">
        {people.map((p, idx) => {
          const on = selected.includes(p.id);
          return (
            <label key={p.id} className={'adm-person-pick' + (on ? ' on' : '') + (disabled ? ' off' : '')}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => toggle(p.id)}
              />
              <span className="adm-person-pick-txt">
                <strong>{p.name}</strong>
                <small>
                  {idx === 0 ? 'Titular' : `${idx + 1}.ª pessoa`}
                  {p.identification ? ` · ${p.identification}` : ''}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      {helper && <div className="adm-field-helper">{helper}</div>}
    </div>
  );
}
