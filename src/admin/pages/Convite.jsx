// src/admin/pages/Convite.jsx — Registo por convite (público, /admin/convite/:token)
// Aberto a partir do link enviado por e-mail: mostra os dados pré-preenchidos,
// deixa completar nome/cargo/telefone/foto e definir a palavra-passe.
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { convite as conviteApi } from '../apiClient';
import { PasswordInput } from '../inputs';
import '../admin.css';

export default function Convite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ name: '', cargo: '', phone: '', password: '', password2: '' });
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feito, setFeito] = useState(false);

  useEffect(() => {
    conviteApi.info(token)
      .then((d) => { setInfo(d); setForm((f) => ({ ...f, name: d.name || '', cargo: d.cargo || '', phone: d.phone || '' })); })
      .catch((e) => setErro(e.message));
  }, [token]);

  const escolherFoto = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    setFotoFile(f); setFotoPreview(URL.createObjectURL(f));
    e.target.value = '';
  };

  const submeter = async (e) => {
    e.preventDefault();
    setErro('');
    if (form.password.length < 8) { setErro('A palavra-passe deve ter pelo menos 8 caracteres.'); return; }
    if (form.password !== form.password2) { setErro('As palavras-passe não coincidem.'); return; }
    setBusy(true);
    try {
      if (fotoFile) await conviteApi.uploadFoto(token, fotoFile).catch(() => {});
      await conviteApi.concluir(token, { password: form.password, name: form.name, cargo: form.cargo, phone: form.phone });
      setFeito(true);
      setTimeout(() => navigate('/admin/login'), 2600);
    } catch (err) { setErro(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="adm-root">
      <div className="adm-login-screen">
        <div className="adm-login-card" style={{ maxWidth: 440 }}>
          <img src="/logo-vyvian-vertical.svg" alt="Vyvian Avena Advogada"
               style={{ height: 100, width: 'auto', display: 'block', margin: '0 auto 1.2rem' }} />

          {feito ? (
            <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
              <h3 style={{ margin: '0 0 10px' }}>Registo concluído ✓</h3>
              <p style={{ fontSize: 13.5, opacity: 0.8 }}>A sua conta está ativa. A redirecionar para o início de sessão…</p>
            </div>
          ) : !info && !erro ? (
            <p style={{ textAlign: 'center', fontSize: 13.5, opacity: 0.7 }}>A validar o convite…</p>
          ) : erro && !info ? (
            <div className="adm-login-error">{erro}</div>
          ) : (
            <>
              <p style={{ textAlign: 'center', fontSize: 13.5, margin: '0 0 4px', opacity: 0.85 }}>
                Bem-vindo(a), <strong>{info.name}</strong>
              </p>
              <p style={{ textAlign: 'center', fontSize: 12, margin: '0 0 18px', opacity: 0.6 }}>
                Complete o seu registo na Área Privada · {info.email}
              </p>
              {erro && <div className="adm-login-error">{erro}</div>}
              <form onSubmit={submeter}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                  <label style={{ cursor: 'pointer', textAlign: 'center' }}>
                    {fotoPreview
                      ? <img src={fotoPreview} alt="" style={{ width: 70, height: 70, borderRadius: '50%', objectFit: 'cover', border: '2px solid #b8935a' }} />
                      : <span style={{ width: 70, height: 70, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                       border: '1.5px dashed rgba(184,147,90,.6)', fontSize: 11, opacity: 0.7, padding: 6 }}>+ foto</span>}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={escolherFoto} disabled={busy} />
                  </label>
                </div>
                <div className="adm-field">
                  <label>Nome</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required disabled={busy} />
                </div>
                <div className="adm-field">
                  <label>Cargo</label>
                  <input value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} placeholder="Ex.: Assistente jurídica" disabled={busy} />
                </div>
                <div className="adm-field">
                  <label>Telefone</label>
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+351 …" disabled={busy} />
                </div>
                <div className="adm-field">
                  <label>Palavra-passe (mín. 8 caracteres)</label>
                  <PasswordInput value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                                 autoComplete="new-password" required disabled={busy} />
                </div>
                <div className="adm-field">
                  <label>Confirmar palavra-passe</label>
                  <PasswordInput value={form.password2} onChange={(e) => setForm((f) => ({ ...f, password2: e.target.value }))}
                                 autoComplete="new-password" required disabled={busy} />
                </div>
                <button type="submit" className="adm-btn adm-btn-primary"
                        style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }} disabled={busy}>
                  {busy ? 'A concluir…' : 'Concluir registo'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
