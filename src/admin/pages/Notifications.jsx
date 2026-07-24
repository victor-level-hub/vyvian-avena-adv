// src/admin/pages/Notifications.jsx
// Reestruturado (2026-07): esta secção passou a ser o painel de alertas PARA A
// DRA. VYVIAN. As regras de lembretes por cliente vivem agora na ficha de cada
// cliente (ClientDetail → separador Notificações).
import React, { useState, useEffect } from 'react';
import { notifications as notifApi } from '../apiClient';
import { IconMail, IconPhone } from '../icons';
import { SkeletonPage } from '../skeletons';
import { admToast } from '../toasts';

const ALERTAS = [
  { type: 'vence_hoje', titulo: 'Pagamento vence hoje', desc: 'Um resumo dos pagamentos de clientes que vencem no próprio dia.' },
  { type: 'em_atraso', titulo: 'Pagamento ficou em atraso', desc: 'Avisa quando um pagamento passa o prazo sem ser liquidado.' },
  { type: 'resumo_diario', titulo: 'Resumo diário de vencimentos', desc: 'Panorama de cada manhã: vence hoje, próximos 7 dias e total em atraso.' },
  { type: 'pagamento_recebido', titulo: 'Pagamento recebido', desc: 'Confirmação sempre que um pagamento é registado no sistema.' },
];

const fmtDataHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function Notifications() {
  const [prefs, setPrefs] = useState({});
  const [contacts, setContacts] = useState({ email: '', whatsapp: '' });
  const [log, setLog] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [op, t] = await Promise.all([notifApi.getOwnerPrefs(), notifApi.listTemplates()]);
      const map = {};
      (op.prefs || []).forEach((p) => { map[p.alert_type] = p; });
      setPrefs(map);
      setContacts({ email: op.contacts?.email || '', whatsapp: op.contacts?.whatsapp || '' });
      setLog(op.log || []);
      setTemplates(t.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const togglePref = (type, canal) => {
    setPrefs((prev) => {
      const p = prev[type] || { alert_type: type, email_enabled: 0, whatsapp_enabled: 0 };
      const key = canal === 'email' ? 'email_enabled' : 'whatsapp_enabled';
      return { ...prev, [type]: { ...p, [key]: p[key] ? 0 : 1 } };
    });
    setDirty(true);
  };

  const guardar = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await notifApi.updateOwnerPrefs({
        prefs: ALERTAS.map(({ type }) => ({
          alert_type: type,
          email_enabled: prefs[type]?.email_enabled ? 1 : 0,
          whatsapp_enabled: prefs[type]?.whatsapp_enabled ? 1 : 0,
        })),
        contacts: { email: contacts.email.trim() || null, whatsapp: contacts.whatsapp.trim() || null },
      });
      setLog(r.log || []);
      setDirty(false);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
      admToast('Preferências de alertas guardadas');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonPage kpis={0} rows={4} />;

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Notificações</h1>
          <div className="adm-sub">Alertas enviados a si sobre a atividade dos clientes</div>
        </div>
        <button type="button" className="adm-btn" onClick={guardar} disabled={saving || !dirty}>
          {saving ? 'A guardar…' : savedMsg ? 'Guardado ✓' : 'Guardar alterações'}
        </button>
      </header>

      {error && <div className="adm-login-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="adm-card">
        <div className="adm-card-title">Os meus alertas</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 1rem' }}>
          Os lembretes enviados <strong>aos clientes</strong> configuram-se na ficha de cada cliente
          (separador Notificações). Aqui escolhe o que <strong>a Dra.</strong> quer receber.
        </p>

        <table className="adm-table">
          <thead>
            <tr>
              <th>Alerta</th>
              <th style={{ width: 90, textAlign: 'center' }}>Email</th>
              <th style={{ width: 90, textAlign: 'center' }}>WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {ALERTAS.map(({ type, titulo, desc }) => (
              <tr key={type}>
                <td>
                  <div style={{ fontWeight: 600 }}>{titulo}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{desc}</div>
                </td>
                {['email', 'whatsapp'].map((canal) => (
                  <td key={canal} style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className={'adm-switch' + (prefs[type]?.[canal + '_enabled'] ? '' : ' off')}
                      onClick={() => togglePref(type, canal)}
                      aria-label={titulo + ' por ' + canal}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="adm-card" style={{ marginTop: '1.25rem' }}>
        <div className="adm-card-title">Destinos</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <label className="adm-field">
            <span className="adm-label">Email para alertas</span>
            <input
              className="adm-input"
              type="email"
              value={contacts.email}
              placeholder="ex.: vyavena@gmail.com"
              onChange={(e) => { setContacts({ ...contacts, email: e.target.value }); setDirty(true); }}
            />
          </label>
          <label className="adm-field">
            <span className="adm-label">WhatsApp para alertas</span>
            <input
              className="adm-input"
              type="tel"
              value={contacts.whatsapp}
              placeholder="ex.: 351911831530"
              onChange={(e) => { setContacts({ ...contacts, whatsapp: e.target.value }); setDirty(true); }}
            />
          </label>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.6rem' }}>
          Um alerta com canal ativo mas sem destino preenchido é simplesmente ignorado.
        </p>
      </div>

      {log.length > 0 && (
        <div className="adm-card" style={{ marginTop: '1.25rem' }}>
          <div className="adm-card-title">Últimos alertas enviados</div>
          {log.map((l, i) => (
            <div key={i} className="adm-notif-row">
              <div className="adm-notif-icon">{l.channel === 'email' ? <IconMail size={13} /> : <IconPhone size={13} />}</div>
              <div style={{ flex: 1 }}>
                <div className="adm-notif-title">
                  {(ALERTAS.find((a) => a.type === l.alert_type) || {}).titulo || l.alert_type}
                  {l.status !== 'sent' && <span style={{ color: 'var(--danger)' }}> · falhou</span>}
                </div>
                <div className="adm-notif-desc">
                  {fmtDataHora(l.sent_at)} · {l.message_preview}
                  {l.error_message && <> · <span style={{ color: 'var(--danger)' }}>{l.error_message}</span></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="adm-card" style={{ marginTop: '1.25rem' }}>
        <div className="adm-card-title">Modelos de mensagem (lembretes aos clientes)</div>
        {templates.map((t) => (
          <div key={t.id} className="adm-template-card" style={{ marginBottom: '1rem' }}>
            <div className="adm-template-head">
              <span>
                <strong>{t.name}</strong> · {t.channel} · {t.language}
                {t.subject && <> · Assunto: <code>{t.subject.replace(/\{\{/g, '').replace(/\}\}/g, '')}</code></>}
              </span>
            </div>
            <div className="adm-template-body">
              {(t.body || '').split(/(\{\{[^}]+\}\})/g).map((part, idx) =>
                part.startsWith('{{') ? (
                  <code key={idx}>{part.replace(/[{}]/g, '')}</code>
                ) : (
                  <React.Fragment key={idx}>{part}</React.Fragment>
                )
              )}
            </div>
          </div>
        ))}
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '1rem', fontStyle: 'italic' }}>
          As variáveis entre chavetas são substituídas automaticamente pelos dados de cada cliente no momento do envio.
        </p>
      </div>
    </>
  );
}
