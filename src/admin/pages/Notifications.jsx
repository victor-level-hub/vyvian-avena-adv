// src/admin/pages/Notifications.jsx
import React, { useState, useEffect } from 'react';
import { notifications as notifApi } from '../apiClient';

export default function Notifications() {
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([
        notifApi.listRules(),
        notifApi.listTemplates(),
      ]);
      setRules(r.rules || []);
      setTemplates(t.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (rule) => {
    setToggling(rule.id);
    try {
      await notifApi.updateRule(rule.id, { enabled: !rule.enabled });
      setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled ? 0 : 1 } : r)));
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar regras…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;

  // Agrupar regras por cliente
  const byClient = {};
  rules.forEach((r) => {
    if (!byClient[r.client_id]) byClient[r.client_id] = [];
    byClient[r.client_id].push(r);
  });

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Notificações automáticas</h1>
          <div className="adm-sub">{rules.length} regras configuradas · {templates.length} modelos</div>
        </div>
      </header>

      <div className="adm-card">
        <div className="adm-card-title">Regras por cliente</div>

        {Object.keys(byClient).length === 0 ? (
          <div className="adm-empty">Sem regras configuradas.</div>
        ) : (
          Object.entries(byClient).map(([clientId, clientRules]) => (
            <div key={clientId} style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--ink)' }}>
                {clientId}
              </div>
              {clientRules.map((rule) => (
                <div key={rule.id} className="adm-notif-row">
                  <div className="adm-notif-icon">
                    {rule.days_before}d
                  </div>
                  <div>
                    <div className="adm-notif-title">
                      Lembrete {rule.days_before} {rule.days_before === 1 ? 'dia' : 'dias'} antes
                    </div>
                    <div className="adm-notif-desc">
                      Canal: {rule.channel} · Modelo: {rule.template_id || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={'adm-switch' + (rule.enabled ? '' : ' off')}
                    onClick={() => toggle(rule)}
                    disabled={toggling === rule.id}
                    aria-label={rule.enabled ? 'Desativar' : 'Ativar'}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="adm-card" style={{ marginTop: '1.25rem' }}>
        <div className="adm-card-title">Modelos de mensagem</div>

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
