// src/admin/PersonFields.jsx
// Campos pessoais de UMA pessoa adicional de um cliente conjunto (ex.: casal).
// Usado no NewClient e no modal Editar do ClientDetail. As chaves do objeto
// `value` são as colunas da tabela client_people (snake_case) + addrParts
// (morada estruturada do AddressEditor, convertida no submit).
import React from 'react';
import AddressEditor, { EMPTY_ADDRESS } from './AddressEditor';

export const EMPTY_PERSON = {
  name: '',
  identification: '',
  nationality: '',
  marital_status: '',
  rg: '',
  birth_date: '',
  birth_place: '',
  doc_type: '',
  doc_number: '',
  doc_validity: '',
  niss: '',
  father_name: '',
  mother_name: '',
  addrParts: { ...EMPTY_ADDRESS },
};

// linha do BD -> objeto do form (parse do address_parts)
export function personFromRow(row, country) {
  let addrParts = { ...EMPTY_ADDRESS, country: country || 'PT' };
  if (row.address_parts) {
    try { addrParts = { ...addrParts, ...JSON.parse(row.address_parts) }; } catch { /* mantém vazio */ }
  }
  return { ...EMPTY_PERSON, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : v])), addrParts, id: row.id };
}

// devolve true se a pessoa tem algum campo pessoal preenchido (além do nome)
const DATA_KEYS = ['identification', 'nationality', 'marital_status', 'rg', 'birth_date', 'birth_place', 'doc_type', 'doc_number', 'doc_validity', 'niss', 'father_name', 'mother_name'];
export function personHasData(p) {
  if (DATA_KEYS.some((k) => String(p[k] || '').trim() !== '')) return true;
  // morada estruturada preenchida também conta
  const a = p.addrParts || {};
  return Object.entries(a).some(([k, v]) => k !== 'country' && String(v || '').trim() !== '');
}

export default function PersonFields({ value, onChange, country, disabled }) {
  const p = value;
  const set = (key) => (e) => onChange({ ...p, [key]: e.target.value });

  return (
    <>
      <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
        <span>Nome completo *</span>
        <input type="text" value={p.name} onChange={set('name')} disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>{country === 'BR' ? 'CPF' : 'NIF'}</span>
        <input type="text" value={p.identification} onChange={set('identification')} placeholder={country === 'BR' ? '123.456.789-00' : '123 456 789'} disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Nacionalidade</span>
        <input type="text" value={p.nationality} onChange={set('nationality')} placeholder={country === 'BR' ? 'brasileira' : 'portuguesa'} disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Estado civil</span>
        <select value={p.marital_status} onChange={set('marital_status')} disabled={disabled}>
          <option value="">—</option>
          <option value="solteiro(a)">Solteiro(a)</option>
          <option value="casado(a)">Casado(a)</option>
          <option value="divorciado(a)">Divorciado(a)</option>
          <option value="viúvo(a)">Viúvo(a)</option>
          <option value="união estável">União estável / convivente</option>
        </select>
      </label>
      <label className="adm-field">
        <span>Data de nascimento</span>
        <input type="date" value={p.birth_date} onChange={set('birth_date')} disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Naturalidade</span>
        <input type="text" value={p.birth_place} onChange={set('birth_place')} placeholder="Cidade, Estado/Distrito, País" disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Tipo de documento</span>
        <select value={p.doc_type} onChange={set('doc_type')} disabled={disabled}>
          <option value="">—</option>
          <option value="Título de Residência">Título de Residência</option>
          <option value="Cartão de Cidadão">Cartão de Cidadão</option>
          <option value="Passaporte">Passaporte</option>
          <option value="BI/RG">BI / RG</option>
        </select>
      </label>
      <label className="adm-field">
        <span>Nº do documento</span>
        <input type="text" value={p.doc_number} onChange={set('doc_number')} placeholder="Ex.: X6D997798" disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Validade do documento</span>
        <input type="date" value={p.doc_validity} onChange={set('doc_validity')} disabled={disabled} />
      </label>
      {country === 'BR' ? (
        <label className="adm-field">
          <span>RG</span>
          <input type="text" value={p.rg} onChange={set('rg')} placeholder="12.345.678-9" disabled={disabled} />
        </label>
      ) : (
        <label className="adm-field">
          <span>NISS (opcional)</span>
          <input type="text" value={p.niss} onChange={set('niss')} placeholder="120 772 806 32" disabled={disabled} />
        </label>
      )}
      <label className="adm-field">
        <span>Pai (opcional)</span>
        <input type="text" value={p.father_name} onChange={set('father_name')} placeholder="Nome do pai" disabled={disabled} />
      </label>
      <label className="adm-field">
        <span>Mãe (opcional)</span>
        <input type="text" value={p.mother_name} onChange={set('mother_name')} placeholder="Nome da mãe" disabled={disabled} />
      </label>
      <div style={{ gridColumn: '1 / -1' }}>
        <AddressEditor
          label="Morada / Endereço"
          value={p.addrParts}
          onChange={(v) => onChange({ ...p, addrParts: v })}
          disabled={disabled}
        />
      </div>
    </>
  );
}

// Pills de navegação entre as pessoas do cliente (titular + adicionais + adicionar)
export function PersonPills({ names, active, onSelect, onAdd, disabled, addLabel = '＋ Adicionar pessoa' }) {
  const pill = (isActive) => ({
    border: '1px solid ' + (isActive ? 'var(--gold, #b8935a)' : 'rgba(0,0,0,0.18)'),
    background: isActive ? 'rgba(184,147,90,0.14)' : 'transparent',
    color: isActive ? 'var(--forest, #12302a)' : 'var(--muted, #666)',
    fontWeight: isActive ? 600 : 400,
    borderRadius: 999,
    padding: '0.35rem 0.9rem',
    fontSize: '0.85rem',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  });
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.35rem 0 0.9rem' }}>
      {names.map((n, i) => (
        <button key={i} type="button" style={pill(active === i)} onClick={() => onSelect(i)} disabled={disabled}>
          {n || `Pessoa ${i + 1}`}
        </button>
      ))}
      {onAdd && (
        <button
          key="add" type="button" onClick={onAdd} disabled={disabled}
          style={{ ...pill(false), borderStyle: 'dashed', color: 'var(--gold, #b8935a)', fontWeight: 600 }}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
