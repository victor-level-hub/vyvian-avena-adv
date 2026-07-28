// src/admin/pages/Notifications.jsx
// Notificações — redesign «Vyvian Avena Design System v3» (rollout 5/5).
// Painel de alertas PARA A DRA. VYVIAN; as regras de lembretes por cliente
// vivem na ficha de cada cliente (ClientDetail → separador Notificações).
// Lógica intacta: preferências, destinos, log e modelos de mensagem.
import React, { useState, useEffect } from 'react';
import { notifications as notifApi } from '../apiClient';
import { IconMail, IconPhone } from '../icons';
import { SkeletonPage } from '../skeletons';
import { admToast } from '../toasts';
import { RsShell, Icon, Reveal, PanelHead } from '../rs/ui';

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

// interruptor no padrão rs (dourado quando ligado), com tooltip do site
function Switch({ on, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={!!on}
            data-tip={on ? 'Ativo — clique para desligar' : 'Inativo — clique para ligar'}
            style={{ width: 42, height: 24, borderRadius: 999, position: 'relative', cursor: 'pointer', padding: 0, flex: 'none',
                     background: on ? 'var(--grad-gold)' : 'var(--panel)',
                     border: '1px solid ' + (on ? 'rgba(212,181,133,.55)' : 'var(--edge-2)'),
                     transition: 'background .25s, border-color .25s' }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 21 : 3, width: 17, height: 17, borderRadius: '50%',
                     background: on ? '#1a1208' : 'var(--fg-3)', transition: 'left .25s var(--ease-out), background .25s' }} />
    </button>
  );
}

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

  const codeChip = {
    display: 'inline-block', fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '1px 7px',
    borderRadius: 7, background: 'rgba(184,147,90,.13)', border: '1px solid var(--edge-2)',
    color: 'var(--gold-soft)', margin: '0 1px',
  };

  return (
    <RsShell overline="Área privada · Notificações" titulo="Notificações"
             sub="Alertas enviados a si sobre a atividade dos clientes"
             right={<button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 4, opacity: (saving || !dirty) ? 0.55 : 1 }}
                            onClick={guardar} disabled={saving || !dirty}>
                      <Icon name="save" size={13} />{saving ? 'A guardar…' : savedMsg ? 'Guardado ✓' : 'Guardar alterações'}
                    </button>}>

      {error && (
        <Reveal>
          <div className="glass" style={{ padding: '13px 17px', marginBottom: 16, borderColor: 'rgba(200,110,90,.45)', fontSize: 13, color: '#e0a294' }}>
            {error}
          </div>
        </Reveal>
      )}

      {/* Os meus alertas */}
      <Reveal>
        <div className="glass" style={{ padding: '20px 22px 14px', marginBottom: 18 }}>
          <PanelHead over="Preferências" title="Os meus alertas"
                     note={<>Os lembretes enviados <strong style={{ color: 'var(--fg-2)' }}>aos clientes</strong> configuram-se na ficha de cada cliente (separador Notificações). Aqui escolhe o que <strong style={{ color: 'var(--fg-2)' }}>a Dra.</strong> quer receber.</>} />
          <div style={{ display: 'grid', gap: 8 }}>
            {/* cabeçalho das colunas */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 13px' }}>
              <span style={{ flex: 1 }} />
              <span className="overline" style={{ width: 64, textAlign: 'center', fontSize: 9, letterSpacing: '.16em' }}>Email</span>
              <span className="overline" style={{ width: 64, textAlign: 'center', fontSize: 9, letterSpacing: '.16em' }}>WhatsApp</span>
            </div>
            {ALERTAS.map(({ type, titulo, desc }, k) => (
              <Reveal key={type} d={k * 50} y={10}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', borderRadius: 12,
                              border: '1px solid var(--edge)', background: 'var(--panel)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{titulo}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>{desc}</div>
                  </div>
                  {['email', 'whatsapp'].map((canal) => (
                    <span key={canal} style={{ width: 64, display: 'flex', justifyContent: 'center' }}>
                      <Switch on={!!prefs[type]?.[canal + '_enabled']}
                              onClick={() => togglePref(type, canal)}
                              label={titulo + ' por ' + canal} />
                    </span>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Destinos */}
      <Reveal d={80}>
        <div className="glass" style={{ padding: '20px 22px 18px', marginBottom: 18 }}>
          <PanelHead over="Canais" title="Destinos" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <label style={{ display: 'block' }}>
              <span className="overline" style={{ display: 'block', fontSize: 9, letterSpacing: '.16em', marginBottom: 7 }}>Email para alertas</span>
              <input
                className="field"
                type="email"
                value={contacts.email}
                placeholder="ex.: vyavena@gmail.com"
                onChange={(e) => { setContacts({ ...contacts, email: e.target.value }); setDirty(true); }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 13.5 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span className="overline" style={{ display: 'block', fontSize: 9, letterSpacing: '.16em', marginBottom: 7 }}>WhatsApp para alertas</span>
              <input
                className="field"
                type="tel"
                value={contacts.whatsapp}
                placeholder="ex.: 351911831530"
                onChange={(e) => { setContacts({ ...contacts, whatsapp: e.target.value }); setDirty(true); }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 13.5 }}
              />
            </label>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--fg-3)', margin: '10px 0 0' }}>
            Um alerta com canal ativo mas sem destino preenchido é simplesmente ignorado.
          </p>
        </div>
      </Reveal>

      {/* Últimos alertas enviados */}
      {log.length > 0 && (
        <Reveal d={120}>
          <div className="glass" style={{ padding: '20px 22px 16px', marginBottom: 18 }}>
            <PanelHead over="Histórico" title="Últimos alertas enviados" />
            <div style={{ display: 'grid', gap: 8 }}>
              {log.map((l, i) => {
                const falhou = l.status !== 'sent';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px', borderRadius: 12,
                                        border: '1px solid ' + (falhou ? 'rgba(200,110,90,.35)' : 'var(--edge)'),
                                        background: falhou ? 'rgba(160,75,60,.08)' : 'var(--panel)' }}>
                    <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', flex: 'none',
                                   background: 'var(--grad-gold-soft)', border: '1px solid var(--edge-2)', color: 'var(--gold-soft)' }}>
                      {l.channel === 'email' ? <IconMail size={13} /> : <IconPhone size={13} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                        {(ALERTAS.find((a) => a.type === l.alert_type) || {}).titulo || l.alert_type}
                        {falhou && <span style={{ color: '#e0a294' }}> · falhou</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                        {fmtDataHora(l.sent_at)} · {l.message_preview}
                        {l.error_message && <> · <span style={{ color: '#e0a294' }}>{l.error_message}</span></>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      )}

      {/* Modelos de mensagem */}
      <Reveal d={160}>
        <div className="glass" style={{ padding: '20px 22px 18px' }}>
          <PanelHead over="Lembretes aos clientes" title="Modelos de mensagem" />
          <div style={{ display: 'grid', gap: 12 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ borderRadius: 12, border: '1px solid var(--edge)', background: 'var(--panel)', padding: '13px 15px' }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginBottom: 8 }}>
                  <strong style={{ color: 'var(--fg)' }}>{t.name}</strong> · {t.channel} · {t.language}
                  {t.subject && <> · Assunto: <code style={codeChip}>{t.subject.replace(/\{\{/g, '').replace(/\}\}/g, '')}</code></>}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--fg-3)', whiteSpace: 'pre-wrap' }}>
                  {(t.body || '').split(/(\{\{[^}]+\}\})/g).map((part, idx) =>
                    part.startsWith('{{') ? (
                      <code key={idx} style={codeChip}>{part.replace(/[{}]/g, '')}</code>
                    ) : (
                      <React.Fragment key={idx}>{part}</React.Fragment>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--fg-3)', margin: '12px 0 0', fontStyle: 'italic' }}>
            As variáveis entre chavetas são substituídas automaticamente pelos dados de cada cliente no momento do envio.
          </p>
        </div>
      </Reveal>
    </RsShell>
  );
}
