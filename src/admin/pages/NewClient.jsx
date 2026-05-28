// src/admin/pages/NewClient.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, notifications as notifApi } from '../apiClient';

function makeId(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function NewClient() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    name: '',
    taxId: '',
    email: '',
    phone: '',
    country: 'PT',
    address: '',
    nationality: '',
    maritalStatus: '',
    rg: '',
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const currency = form.country === 'BR' ? 'BRL' : 'EUR';
      const clientId = makeId(form.name);

      // 1. Criar cliente
      const totalContracted = form.planType === 'installment'
        ? parseFloat(form.totalValue.toString().replace(',', '.'))
        : 0;
      const numParcelas = form.planType === 'installment'
        ? parseInt(form.installments, 10)
        : 0;

      await clientsApi.create({
        id: clientId,
        name: form.name,
        email: form.email,
        phone: form.phone,
        country: form.country,
        identification: form.taxId,
        address: form.address || null,
        nationality: form.country === 'BR' ? (form.nationality || null) : null,
        marital_status: form.country === 'BR' ? (form.maritalStatus || null) : null,
        rg: form.country === 'BR' ? (form.rg || null) : null,
        practice_area: form.area,
        notes: form.process ? `Processo: ${form.process}` : '',
        honorarios_total: totalContracted,
        honorarios_parcelas: numParcelas,
        contract_start_date: form.startDate,
      });

      // 2. Gerar parcelas
      let installmentsToCreate = [];
      if (form.planType === 'installment') {
        const per = totalContracted / numParcelas;
        for (let n = 1; n <= numParcelas; n++) {
          installmentsToCreate.push({
            id: `${clientId}-p${n}`,
            client_id: clientId,
            installment_number: n,
            total_installments: numParcelas,
            amount: Math.round(per * 100) / 100,
            currency,
            due_date: addMonths(form.startDate, n - 1),
          });
        }
      } else {
        // Avença: cria 12 primeiras parcelas
        const monthlyValue = parseFloat(form.monthlyValue.toString().replace(',', '.'));
        for (let n = 1; n <= 12; n++) {
          installmentsToCreate.push({
            id: `${clientId}-m${n}`,
            client_id: clientId,
            installment_number: n,
            total_installments: 12,
            amount: monthlyValue,
            currency,
            due_date: addMonths(form.startDate, n - 1),
          });
        }
      }

      for (const inst of installmentsToCreate) {
        await installmentsApi.list ? null : null; // dummy
        await fetch('/api/installments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionStorage.getItem('vyvian_admin_token')}`,
          },
          body: JSON.stringify(inst),
        });
      }

      // 3. Criar regras de notificação
      if (form.reminderChannels !== 'none') {
        const channels = form.reminderChannels.split('+');
        for (let idx = 0; idx < channels.length; idx++) {
          const channel = channels[idx];
          await notifApi.createRule({
            id: `nr-${clientId}-${idx}`,
            client_id: clientId,
            channel,
            days_before: parseInt(form.reminderDays, 10),
            enabled: true,
            template_id: channel === 'email' ? 'tpl-reminder-5d-pt' : 'tpl-reminder-1d-pt',
          });
        }
      }

      navigate('/admin/clientes/' + clientId);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

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
    if (!isNaN(v)) planPreview = `→ avença de ${symbol}\u00A0${v.toFixed(2)}/mês, recorrente (12 meses iniciais)`;
  }

  return (
    <>
      <header className="adm-page-header">
        <div>
          <h1>Novo cliente</h1>
          <div className="adm-sub">Cadastro + plano financeiro</div>
        </div>
      </header>

      {error && <div className="adm-login-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="adm-form-section-title">Dados pessoais</div>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Nome completo *</label>
            <input type="text" value={form.name} onChange={update('name')} required disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>{form.country === 'BR' ? 'CPF' : 'NIF'}</label>
            <input type="text" value={form.taxId} onChange={update('taxId')} placeholder={form.country === 'BR' ? '123.456.789-00' : '123 456 789'} disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>E-mail *</label>
            <input type="email" value={form.email} onChange={update('email')} required disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>Telefone (WhatsApp) *</label>
            <input type="tel" value={form.phone} onChange={update('phone')} placeholder="+351 91 …" required disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>Jurisdição</label>
            <select value={form.country} onChange={update('country')} disabled={submitting}>
              <option value="PT">Portugal · € EUR</option>
              <option value="BR">Brasil · R$ BRL</option>
            </select>
          </div>
          <div className="adm-field">
            <label>Morada / Endereço</label>
            <input type="text" value={form.address} onChange={update('address')} placeholder={form.country === 'BR' ? 'Rua, nº, bairro, cidade - UF' : 'Rua, nº, código postal, localidade'} disabled={submitting} />
          </div>
          {form.country === 'BR' && (
            <>
              <div className="adm-field">
                <label>RG</label>
                <input type="text" value={form.rg} onChange={update('rg')} placeholder="12.345.678-9" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Nacionalidade</label>
                <input type="text" value={form.nationality} onChange={update('nationality')} placeholder="brasileiro(a)" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Estado civil</label>
                <select value={form.maritalStatus} onChange={update('maritalStatus')} disabled={submitting}>
                  <option value="">—</option>
                  <option value="solteiro(a)">Solteiro(a)</option>
                  <option value="casado(a)">Casado(a)</option>
                  <option value="divorciado(a)">Divorciado(a)</option>
                  <option value="viúvo(a)">Viúvo(a)</option>
                  <option value="união estável">União estável</option>
                </select>
              </div>
            </>
          )}
          <div className="adm-field">
            <label>Área de atuação</label>
            <select value={form.area} onChange={update('area')} disabled={submitting}>
              <option>Família</option>
              <option>Cível</option>
              <option>Trabalhista</option>
              <option>Empresarial</option>
            </select>
          </div>
          <div className="adm-field adm-full">
            <label>Processo / referência interna</label>
            <input type="text" value={form.process} onChange={update('process')} placeholder="Ex.: 1289/26 · Divórcio consensual" disabled={submitting} />
          </div>
        </div>

        <div className="adm-form-section">
          <div className="adm-form-section-title">Plano financeiro</div>
          <div className="adm-form-grid">
            <div className="adm-field">
              <label>Tipo de plano *</label>
              <select value={form.planType} onChange={update('planType')} disabled={submitting}>
                <option value="installment">Parcelado (montante dividido)</option>
                <option value="monthly">Avença mensal (recorrente)</option>
              </select>
            </div>
            <div className="adm-field">
              <label>Data da primeira cobrança *</label>
              <input type="date" value={form.startDate} onChange={update('startDate')} required disabled={submitting} />
            </div>

            {form.planType === 'installment' && (
              <>
                <div className="adm-field">
                  <label>Valor total contratado *</label>
                  <input type="text" value={form.totalValue} onChange={update('totalValue')} placeholder="3120" required disabled={submitting} />
                </div>
                <div className="adm-field">
                  <label>Número de parcelas *</label>
                  <input type="number" min="1" value={form.installments} onChange={update('installments')} placeholder="6" required disabled={submitting} />
                  {planPreview && <div className="adm-field-helper">{planPreview}</div>}
                </div>
              </>
            )}

            {form.planType === 'monthly' && (
              <div className="adm-field adm-full">
                <label>Valor mensal *</label>
                <input type="text" value={form.monthlyValue} onChange={update('monthlyValue')} placeholder="450" required disabled={submitting} />
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
                disabled={submitting}
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
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => navigate('/admin/clientes')} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={submitting}>
            {submitting ? 'A criar…' : 'Criar cliente e gerar parcelas'}
          </button>
        </div>
      </form>
    </>
  );
}
