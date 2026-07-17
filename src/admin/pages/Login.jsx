// src/admin/pages/Login.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../auth';
import { PasswordInput } from '../inputs';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('vyvian@vyvianavena.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.ok) {
        navigate('/admin/painel');
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro inesperado: ' + (err.message || 'tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="adm-root">
      <div className="adm-login-screen">
        <div className="adm-login-card">
          <img
            src="/logo-vyvian-vertical.svg"
            alt="Vyvian Avena Advogada"
            style={{
              height: '120px',
              width: 'auto',
              display: 'block',
              margin: '0 auto 1.5rem',
            }}
          />

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
                disabled={loading}
              />
            </div>
            <div className="adm-field">
              <label>Palavra-passe</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              className="adm-btn adm-btn-primary"
              style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
              disabled={loading}
            >
              {loading ? 'A entrar...' : 'Entrar'}
            </button>
          </form>

          <div className="adm-login-help">
            Acesso restrito · Recuperar palavra-passe
          </div>
        </div>
      </div>
    </div>
  );
}
