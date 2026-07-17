// src/admin/Sidebar.jsx
// Sidebar com pílula ativa que desliza entre itens + perfil no fundo
// (avatar com iniciais e menu — preparado para mais utilizadores no futuro).
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { logout, getSession } from './auth';
import Avatar from './Avatar';
import { IconHome, IconUsers, IconCoins, IconCalendar, IconBell } from './icons';

const NAV_ITEMS = [
  { to: '/admin/painel', label: 'Painel', Icon: IconHome },
  { to: '/admin/clientes', label: 'Clientes', Icon: IconUsers },
  { to: '/admin/parcelas', label: 'Parcelas', Icon: IconCoins },
  { to: '/admin/calendario', label: 'Calendário', Icon: IconCalendar },
  { to: '/admin/notificacoes', label: 'Notificações', Icon: IconBell },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = getSession();

  const navRef = useRef(null);
  const footRef = useRef(null);
  const [ind, setInd] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // pílula deslizante: mede o item ativo sempre que a rota muda
  useLayoutEffect(() => {
    const el = navRef.current && navRef.current.querySelector('.adm-nav-item.active');
    if (el) setInd({ top: el.offsetTop, height: el.offsetHeight });
    else setInd(null);
  }, [location.pathname]);

  // fecha o menu de perfil ao clicar fora / Esc
  useEffect(() => {
    if (!profileOpen) return undefined;
    const onDoc = (e) => { if (footRef.current && !footRef.current.contains(e.target)) setProfileOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [profileOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const name = session?.name || 'Vyvian Avena';
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'VA';

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
        <ul className="adm-nav" ref={navRef}>
          {ind && <span className="adm-nav-ind" style={{ top: ind.top, height: ind.height }} aria-hidden="true" />}
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => 'adm-nav-item' + (isActive ? ' active' : '')}
              >
                <item.Icon size={14} style={{ marginRight: '0.6rem', verticalAlign: '-2.5px' }} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="adm-sidebar-footer" ref={footRef}>
        {profileOpen && (
          <div className="adm-profile-menu">
            <div className="adm-profile-menu-head">
              Sessão iniciada como<br /><strong>{name}</strong>
            </div>
            <button type="button" className="adm-profile-menu-item" disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
              Gerir equipa — em breve
            </button>
            <button type="button" className="adm-profile-menu-item" onClick={handleLogout}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
              Terminar sessão
            </button>
          </div>
        )}
        <button
          type="button"
          className={'adm-profile' + (profileOpen ? ' open' : '')}
          onClick={() => setProfileOpen((o) => !o)}
          aria-expanded={profileOpen}
        >
          <Avatar className="adm-profile-avatar" initials={initials} />
          <span className="adm-profile-info">
            <span className="adm-profile-name">{name}</span>
            <span className="adm-profile-role">Advogada · Titular</span>
          </span>
          <svg className="adm-profile-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
        </button>
      </div>
    </aside>
  );
}
