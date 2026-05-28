// src/admin/Sidebar.jsx
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout, getSession } from './auth';

const NAV_ITEMS = [
  { to: '/admin/painel', label: 'Painel' },
  { to: '/admin/clientes', label: 'Clientes' },
  { to: '/admin/parcelas', label: 'Parcelas' },
  { to: '/admin/calendario', label: 'Calendário' },
  { to: '/admin/notificacoes', label: 'Notificações' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const session = getSession();

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <aside className="adm-sidebar">
      <div className="adm-sidebar-brand" style={{ textAlign: 'center' }}>
        <img
          src="/logo-vyvian-vertical-gold.svg"
          alt="Vyvian Avena Advogada"
          style={{
            height: '90px',
            width: 'auto',
            display: 'block',
            margin: '0 auto 0.8rem',
          }}
        />
        <div className="adm-sidebar-role">Área Privada</div>
      </div>

      <nav>
        <ul className="adm-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => 'adm-nav-item' + (isActive ? ' active' : '')}
              >
                ◇&nbsp;&nbsp;{item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="adm-sidebar-footer">
        {session?.name || 'Sessão ativa'}
        <button className="adm-logout-btn" onClick={handleLogout}>
          Terminar sessão
        </button>
      </div>
    </aside>
  );
}
