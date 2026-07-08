// src/admin/AddressEditor.jsx
// Morada estruturada por país.
//   PT: tipo de via, nome, número, complemento, freguesia, concelho, distrito, código postal
//   BR: tipo de via, nome, número, complemento, bairro, cidade, estado, CEP
// composeAddress() gera a string única usada nos PDFs (procurações, planos, recibos).
import React from 'react';

const VIA_PT = ['Rua', 'Avenida', 'Travessa', 'Praça', 'Largo', 'Estrada', 'Alameda', 'Calçada', 'Beco', 'Urbanização', 'Lugar', 'Outro'];
const VIA_BR = ['Rua', 'Avenida', 'Travessa', 'Alameda', 'Praça', 'Estrada', 'Rodovia', 'Largo', 'Beco', 'Outro'];

export const EMPTY_ADDRESS = {
  country: 'PT', via_type: 'Rua', via_name: '', number: '', complement: '',
  freguesia: '', concelho: '', distrito: '', cp: '',
  bairro: '', cidade: '', estado: '', cep: '',
};

export function composeAddress(a) {
  if (!a) return '';
  const parts = [];
  const via = a.via_type === 'Outro' ? (a.via_name || '') : [a.via_type, a.via_name].filter(Boolean).join(' ');
  if (via) parts.push(via + (a.number ? `, Nº ${a.number}` : ''));
  else if (a.number) parts.push(`Nº ${a.number}`);
  if (a.complement) parts.push(a.complement);
  if (a.country === 'BR') {
    if (a.bairro) parts.push(a.bairro);
    if (a.cidade) parts.push(a.cidade + (a.estado ? ' - ' + a.estado : ''));
    else if (a.estado) parts.push(a.estado);
    if (a.cep) parts.push('CEP ' + a.cep);
  } else {
    if (a.freguesia) parts.push(a.freguesia);
    if (a.concelho) parts.push(a.concelho);
    if (a.distrito) parts.push(a.distrito);
    if (a.cp) parts.push(a.cp);
  }
  return parts.join(', ');
}

export function parseAddressParts(jsonStr, fallbackString, fallbackCountry = 'PT') {
  try {
    const o = JSON.parse(jsonStr || 'null');
    if (o && typeof o === 'object') return { ...EMPTY_ADDRESS, country: fallbackCountry, ...o };
  } catch {}
  // sem estrutura: se houver morada antiga (string única), mostra-a como "Outro"
  if (fallbackString) return { ...EMPTY_ADDRESS, country: fallbackCountry, via_type: 'Outro', via_name: fallbackString };
  return { ...EMPTY_ADDRESS, country: fallbackCountry };
}

export function hasAddress(a) {
  return !!(a && (a.via_name || a.number || a.freguesia || a.concelho || a.cp || a.bairro || a.cidade || a.cep));
}

export default function AddressEditor({ label, value, onChange, disabled }) {
  const a = value || EMPTY_ADDRESS;
  const set = (k) => (e) => onChange({ ...a, [k]: e.target.value });
  const isBR = a.country === 'BR';
  const vias = isBR ? VIA_BR : VIA_PT;
  const cell = (span) => ({ gridColumn: `span ${span}` });

  return (
    <div className="adm-field adm-full">
      <label>{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
        <select value={a.country} onChange={set('country')} disabled={disabled} style={cell(2)}>
          <option value="PT">🇵🇹 Portugal</option>
          <option value="BR">🇧🇷 Brasil</option>
        </select>
        <select value={vias.includes(a.via_type) ? a.via_type : 'Outro'} onChange={set('via_type')} disabled={disabled} style={cell(2)} title="Tipo de via">
          {vias.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <input type="text" placeholder={a.via_type === 'Outro' ? 'Morada' : 'Nome da via'} value={a.via_name} onChange={set('via_name')} disabled={disabled} style={cell(2)} />
        <input type="text" placeholder="Número" value={a.number} onChange={set('number')} disabled={disabled} style={cell(1)} />
        <input type="text" placeholder="Complemento (andar, sala…)" value={a.complement} onChange={set('complement')} disabled={disabled} style={cell(2)} />
        {isBR ? (
          <>
            <input type="text" placeholder="Bairro" value={a.bairro} onChange={set('bairro')} disabled={disabled} style={cell(3)} />
            <input type="text" placeholder="Cidade" value={a.cidade} onChange={set('cidade')} disabled={disabled} style={cell(2)} />
            <input type="text" placeholder="Estado (UF)" value={a.estado} onChange={set('estado')} disabled={disabled} style={cell(2)} />
            <input type="text" placeholder="CEP" value={a.cep} onChange={set('cep')} disabled={disabled} style={cell(2)} />
          </>
        ) : (
          <>
            <input type="text" placeholder="Freguesia" value={a.freguesia} onChange={set('freguesia')} disabled={disabled} style={cell(3)} />
            <input type="text" placeholder="Concelho" value={a.concelho} onChange={set('concelho')} disabled={disabled} style={cell(2)} />
            <input type="text" placeholder="Distrito" value={a.distrito} onChange={set('distrito')} disabled={disabled} style={cell(2)} />
            <input type="text" placeholder="Código Postal" value={a.cp} onChange={set('cp')} disabled={disabled} style={cell(2)} />
          </>
        )}
      </div>
      {hasAddress(a) && <div className="adm-field-helper">→ {composeAddress(a)}</div>}
    </div>
  );
}
