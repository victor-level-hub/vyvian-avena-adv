// src/admin/pages/Login.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../auth';
import { PasswordInput } from '../inputs';
import { primeiraRotaPermitida } from '../perms';

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
        // Ia sempre para o painel: quem nao tem essa aba aterrava numa rota
        // proibida e so era salvo pelo bounce do PermGate; quem nao tem aba
        // nenhuma voltava ao login ja autenticado.
        navigate(primeiraRotaPermitida());
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
              <label htmlFor="login-email">E-mail</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="login-password">Palavra-passe</label>
              <PasswordInput
                id="login-password"
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
