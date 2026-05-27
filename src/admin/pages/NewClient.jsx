// src/admin/pages/NewClient.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function NewClient() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    taxId: '',
    email: '',
    phone: '',
    country: 'PT',
    area: 'Família',
    process: '',
    planType: 'installment',
    startDate: '',
    totalValue: '',
    installments: '',
    monthlyValue: '',
    reminderDays: '5',
    reminderChannels: 'email+whatsapp',
  });

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    alert('Cliente criado (mock). Quando o BD estiver pronto, isto guarda no Supabase.');
    navigate('/admin/clientes');
  };

  // ===== preview do plano =====
  let planPreview = null;
  if (form.planType === 'installment' && form.totalValue && form.installments) {
    const total = parseFloat(form.totalValue.toString().replace(',', '.'));
    const n = parseInt(form.installments, 10);
    if (!isNaN(total) && n > 0) {
      const per = (total / n).toFixed(2);
      const symbol = form.country === 'BR' ? 'R$' : '€';
      planPreview = `→ ${n} parcelas de ${symbol}\u00A0${per}, mensais`;
    }
  } else if (form.planType === 'monthly' && form.monthlyValue) {
    const v = parseFloat(form.monthlyValue.toString().replace(',', '.'));
    const symbol = form.country === 'BR' ? 'R$' : '€';
    if (!isNaN(v)) planPreview = `→ avença de ${symbol}\u00A0${v.toFixed(2)}/mês, recorrente`;
  }

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Novo cliente</h1>
          <div className="adm-sub">Cadastro + plano financeiro</div>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div className="adm-form-section-title">Dados pessoais</div>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Nome completo *</label>
            <input type="text" value={form.name} onChange={update('name')} required />
          </div>
          <div className="adm-field">
            <label>NIF / CPF</label>
            <input type="text" value={form.taxId} onChange={update('taxId')} placeholder="123 456 789" />
          </div>
          <div className="adm-field">
            <label>E-mail *</label>
            <input type="email" value={form.email} onChange={update('email')} required />
          </div>
          <div className="adm-field">
            <label>Telefone (WhatsApp) *</label>
            <input type="tel" value={form.phone} onChange={update('phone')} placeholder="+351 91 …" required />
          </div>
          <div className="adm-field">
            <label>Jurisdição</label>
            <select value={form.country} onChange={update('country')}>
              <option value="PT">Portugal · € EUR</option>
              <option value="BR">Brasil · R$ BRL</option>
            </select>
          </div>
          <div className="adm-field">
            <label>Área de atuação</label>
            <select value={form.area} onChange={update('area')}>
              <option>Família</option>
              <option>Cível</option>
              <option>Trabalhista</option>
              <option>Empresarial</option>
            </select>
          </div>
          <div className="adm-field adm-full">
            <label>Processo / referência interna</label>
            <input type="text" value={form.process} onChange={update('process')} placeholder="Ex.: 1289/26 · Divórcio consensual" />
          </div>
        </div>

        <div className="adm-form-section">
          <div className="adm-form-section-title">Plano financeiro</div>
          <div className="adm-form-grid">
            <div className="adm-field">
              <label>Tipo de plano *</label>
              <select value={form.planType} onChange={update('planType')}>
                <option value="installment">Parcelado (montante dividido)</option>
                <option value="monthly">Avença mensal (recorrente)</option>
              </select>
            </div>
            <div className="adm-field">
              <label>Data da primeira cobrança *</label>
              <input type="date" value={form.startDate} onChange={update('startDate')} required />
            </div>

            {form.planType === 'installment' && (
              <>
                <div className="adm-field">
                  <label>Valor total contratado *</label>
                  <input type="text" value={form.totalValue} onChange={update('totalValue')} placeholder="3.120,00" required />
                </div>
                <div className="adm-field">
                  <label>Número de parcelas *</label>
                  <input type="number" min="1" value={form.installments} onChange={update('installments')} placeholder="6" required />
                  {planPreview && <div className="adm-field-helper">{planPreview}</div>}
                </div>
              </>
            )}

            {form.planType === 'monthly' && (
              <div className="adm-field adm-full">
                <label>Valor mensal *</label>
                <input type="text" value={form.monthlyValue} onChange={update('monthlyValue')} placeholder="450,00" required />
                {planPreview && <div className="adm-field-helper">{planPreview}</div>}
              </div>
            )}

            <div className="adm-field adm-full">
              <label>Lembrete automático antes do vencimento</label>
              <select
                value={form.reminderDays + ':' + form.reminderChannels}
                onChange={(e) => {
                  const [days, channels] = e.target.value.split(':');
                  setForm({ ...form, reminderDays: days, reminderChannels: channels });
                }}
              >
                <option value="5:email+whatsapp">5 dias antes — por e-mail + WhatsApp</option>
                <option value="3:email">3 dias antes — só e-mail</option>
                <option value="7:email">7 dias antes — só e-mail</option>
                <option value="0:none">Não enviar lembrete automático</option>
              </select>
            </div>
          </div>
        </div>

        <div className="adm-form-actions">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => navigate('/admin/clientes')}>
            Cancelar
          </button>
          <button type="submit" className="adm-btn adm-btn-primary">
            Criar cliente e gerar parcelas
          </button>
        </div>
      </form>
    </>
  );
}
