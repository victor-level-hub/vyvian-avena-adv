// src/admin/pages/Login.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../auth';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('vyvian@vyvianavena.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const result = login(email, password);
    if (result.ok) {
      navigate('/admin/painel');
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="adm-root">
      <div className="adm-login-screen">
        <div className="adm-login-card">
          <div className="adm-login-logo">V</div>
          <h1>Área Privada</h1>
          <div className="adm-login-sub">Vyvian Avena Advogada</div>

          {error && <div className="adm-login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="adm-field">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="adm-field">
              <label>Palavra-passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button
              type="submit"
              className="adm-btn adm-btn-primary"
              style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
            >
              Entrar
            </button>
          </form>

          <div className="adm-login-help">
            Acesso restrito · Recuperar palavra-passe
          </div>
          <div className="adm-login-help" style={{ marginTop: '0.5rem', fontSize: '0.65rem', opacity: 0.6 }}>
            (Mock: qualquer palavra-passe não-vazia entra)
          </div>
        </div>
      </div>
    </div>
  );
}
