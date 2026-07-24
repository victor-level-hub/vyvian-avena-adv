// src/admin/Avatar.jsx
// Avatar da Dra. Vyvian: mostra a foto (/avatar-vyvian.webp); se a foto
// não existir/carregar, cai nas iniciais sobre o fundo dourado.
import React, { useState } from 'react';

export default function Avatar({ initials = 'VA', className }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className}>
      {!failed ? (
        <img
          src="/avatar-vyvian.webp"
          alt=""
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
