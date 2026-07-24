// src/admin/skeletons.jsx
// Skeleton loaders — substituem os textos "A carregar…" por blocos com shimmer
// no padrão do site. Estilos em admin.css (secção SKELETONS).
import React from 'react';

const Block = ({ w = '100%', h = 14, style }) => (
  <span className="adm-skel" style={{ width: w, height: h, ...style }} />
);

// Página inteira: cabeçalho + KPIs + linhas
export function SkeletonPage({ kpis = 4, rows = 6 }) {
  return (
    <div aria-busy="true" aria-label="A carregar">
      <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--line)' }}>
        <Block w={220} h={26} style={{ marginBottom: 8 }} />
        <Block w={150} h={11} />
      </div>
      {kpis > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis}, 1fr)`, gap: '0.85rem', marginBottom: '1.75rem' }}>
          {Array.from({ length: kpis }, (_, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid var(--line)', borderTop: '2px solid var(--line)', padding: '1rem 1.15rem' }}>
              <Block w="60%" h={9} style={{ marginBottom: 10 }} />
              <Block w="45%" h={22} />
            </div>
          ))}
        </div>
      )}
      <SkeletonRows n={rows} />
    </div>
  );
}

// Lista de linhas (tabelas / listas)
export function SkeletonRows({ n = 6 }) {
  return (
    <div aria-busy="true" style={{ background: '#fff', border: '1px solid var(--line)', padding: '0.4rem 1rem' }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem 0', borderBottom: i < n - 1 ? '1px solid var(--line)' : 'none' }}>
          <span className="adm-skel adm-skel-circle" />
          <span style={{ flex: 1 }}>
            <Block w={`${52 + ((i * 17) % 30)}%`} h={12} style={{ marginBottom: 6 }} />
            <Block w={`${24 + ((i * 11) % 20)}%`} h={9} />
          </span>
          <Block w={64} h={12} />
          <Block w={80} h={20} />
        </div>
      ))}
    </div>
  );
}
