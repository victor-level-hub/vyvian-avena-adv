// src/admin/pages/Notifications.jsx
import React, { useState } from 'react';
import { NOTIFICATION_RULES, MESSAGE_TEMPLATES } from '../mockData';

export default function Notifications() {
  const [rules, setRules] = useState(NOTIFICATION_RULES);

  const toggle = (id) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Notificações automáticas</h1>
          <div className="adm-sub">Regras de envio e modelos de mensagem</div>
        </div>
      </header>

      <div className="adm-card">
        <div className="adm-card-title">Regras ativas</div>

        {rules.map((rule) => (
          <div key={rule.id} className="adm-notif-row">
            <div className="adm-notif-icon">{rule.badge}</div>
            <div>
              <div className="adm-notif-title">{rule.title}</div>
              <div className="adm-notif-desc">{rule.description}</div>
            </div>
            <button
              type="button"
              className={'adm-switch' + (rule.enabled ? '' : ' off')}
              onClick={() => toggle(rule.id)}
              aria-label={rule.enabled ? 'Desativar' : 'Ativar'}
            />
          </div>
        ))}
      </div>

      <div className="adm-card" style={{ marginTop: '1.25rem' }}>
        <div className="adm-card-title">
          Modelo · {MESSAGE_TEMPLATES.reminderBefore.name}
        </div>
        <div className="adm-template-card">
          <div className="adm-template-head">
            <span>Assunto: <code>{MESSAGE_TEMPLATES.reminderBefore.subject.replace(/\{\{/g, '').replace(/\}\}/g, '')}</code></span>
            <a href="#" onClick={(e) => { e.preventDefault(); alert('Editor de modelos na Fase 2'); }}>Editar →</a>
          </div>
          <div className="adm-template-body">
            {MESSAGE_TEMPLATES.reminderBefore.body.split(/(\{\{[^}]+\}\})/g).map((part, idx) =>
              part.startsWith('{{') ? (
                <code key={idx}>{part.replace(/[{}]/g, '')}</code>
              ) : (
                <React.Fragment key={idx}>{part}</React.Fragment>
              )
            )}
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '1rem', fontStyle: 'italic' }}>
          As variáveis entre chavetas (cliente.nome, parcela.data…) são substituídas automaticamente
          pelos dados de cada cliente no momento do envio.
        </p>
      </div>
    </>
  );
}
