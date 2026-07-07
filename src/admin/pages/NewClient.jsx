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
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiDragOver, setAiDragOver] = useState(false);
  const aiFileRef = React.useRef(null);

  const [form, setForm] = useState({
    personType: 'singular',
    name: '',
    taxId: '',
    email: '',
    phone: '',
    country: 'PT',
    address: '',
    duns: '',
    repName: '',
    repRole: '',
    nationality: '',
    maritalStatus: '',
    rg: '',
    birthDate: '',
    birthPlace: '',
    docType: '',
    docNumber: '',
    docValidity: '',
    niss: '',
    filiation: '',
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

  // ── Cadastro com IA: arrastar/escolher documento -> extrair campos
  const aiAccept = ['image/png','image/jpeg','image/jpg','image/webp','application/pdf'];

  const aiExtractFile = async (file) => {
    if (!file) return;
    if (!aiAccept.includes(file.type)) {
      setAiMsg({ kind: 'err', text: 'Tipo não suportado. Use PNG, JPEG, WEBP ou PDF.' });
      return;
    }
    setAiBusy(true);
    setAiMsg({ kind: 'info', text: 'A ler o documento com IA…' });
    try {
      const token = sessionStorage.getItem('vyvian_admin_token');
      const res = await fetch('/api/cadastro/extrair-documento', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiMsg({ kind: 'err', text: data.error || `HTTP ${res.status}` });
        return;
      }
      const f = data.fields || {};
      // mapear campos da IA -> campos do form (apenas preencher se não estiver vazio)
      const merge = { ...form };
      const set = (k, v) => { if (v != null && v !== '' && !merge[k]) merge[k] = String(v); };
      if (f.person_type === 'coletiva') merge.personType = 'coletiva';
      set('name', f.name);
      set('taxId', f.identification);
      set('duns', f.duns);
      set('repName', f.rep_name);
      set('repRole', f.rep_role);
      set('address', f.birth_place && !f.address ? '' : f.address); // não mexer se não veio
      if (f.address) merge.address = String(f.address);
      set('nationality', f.nationality);
      set('maritalStatus', f.marital_status);
      set('birthDate', f.birth_date);
      set('birthPlace', f.birth_place);
      set('docType', f.doc_type);
      set('docNumber', f.doc_number);
      set('docValidity', f.doc_validity);
      set('niss', f.niss);
      set('filiation', f.filiation);
      if (f.country && (f.country === 'PT' || f.country === 'BR')) merge.country = f.country;
      setForm(merge);
      const filled = Object.keys(f).filter((k) => f[k]).length;
      const u = data.usage || {};
      setAiMsg({ kind: 'ok', text: `Documento lido — ${filled} campos preenchidos. Reveja antes de guardar. (uso: ${u.input_tokens||0} entrada, ${u.output_tokens||0} saída)` });
    } catch (err) {
      setAiMsg({ kind: 'err', text: 'Erro: ' + err.message });
    } finally {
      setAiBusy(false);
    }
  };

  const aiOnDrop = (e) => {
    e.preventDefault(); setAiDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) aiExtractFile(file);
  };
  const aiOnFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) aiExtractFile(file);
    if (aiFileRef.current) aiFileRef.current.value = '';
  };

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

      const isColetiva = form.personType === 'coletiva';
      await clientsApi.create({
        id: clientId,
        name: form.name,
        email: form.email,
        phone: form.phone,
        country: form.country,
        identification: form.taxId,
        person_type: form.personType,
        duns: isColetiva ? (form.duns || null) : null,
        rep_name: isColetiva ? (form.repName || null) : null,
        rep_role: isColetiva ? (form.repRole || null) : null,
        address: form.address || null,
        nationality: form.nationality || null,
        marital_status: form.maritalStatus || null,
        rg: form.country === 'BR' ? (form.rg || null) : null,
        birth_date: form.birthDate || null,
        birth_place: form.birthPlace || null,
        doc_type: form.docType || null,
        doc_number: form.docNumber || null,
        doc_validity: form.docValidity || null,
        niss: form.niss || null,
        filiation: form.filiation || null,
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
        <input ref={aiFileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" style={{ display: 'none' }} onChange={aiOnFile} />
        <div
          onDragOver={(e) => { e.preventDefault(); setAiDragOver(true); }}
          onDragLeave={() => setAiDragOver(false)}
          onDrop={aiOnDrop}
          onClick={() => !aiBusy && aiFileRef.current && aiFileRef.current.click()}
          style={{
            border: `2px dashed ${aiDragOver ? 'var(--gold, #b8935a)' : 'rgba(0,0,0,0.18)'}`,
            background: aiDragOver ? 'rgba(184,147,90,0.08)' : 'var(--cream, #f5f0e8)',
            borderRadius: 8,
            padding: '1.25rem',
            textAlign: 'center',
            cursor: aiBusy ? 'wait' : 'pointer',
            marginBottom: '1.25rem',
            opacity: aiBusy ? 0.7 : 1,
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}>
            📄 Cadastro rápido com IA
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
            Arraste aqui (ou clique para escolher) o documento do cliente — Título de Residência, Cartão de Cidadão, Passaporte, RG, ou uma procuração/certidão da empresa.
            <br />A IA lê o documento e preenche o formulário (incl. empresa, sede, DUNS e representante legal). Reveja antes de guardar.
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
            PNG, JPEG, WEBP ou PDF · até 8 MB
          </div>
          {aiMsg && (
            <div style={{
              marginTop: '0.75rem',
              fontSize: '0.85rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 4,
              background: aiMsg.kind === 'ok' ? 'rgba(34,134,58,0.10)' : aiMsg.kind === 'err' ? 'rgba(176,0,0,0.10)' : 'rgba(0,0,0,0.06)',
              color: aiMsg.kind === 'ok' ? '#1f6b32' : aiMsg.kind === 'err' ? '#b00' : 'var(--ink)',
            }}>
              {aiMsg.text}
            </div>
          )}
        </div>

        <div className="adm-form-section-title">{form.personType === 'coletiva' ? 'Dados da empresa' : 'Dados pessoais'}</div>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Tipo de cliente *</label>
            <select value={form.personType} onChange={update('personType')} disabled={submitting}>
              <option value="singular">Pessoa singular</option>
              <option value="coletiva">Pessoa coletiva (empresa)</option>
            </select>
          </div>
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? 'Denominação da empresa *' : 'Nome completo *'}</label>
            <input type="text" value={form.name} onChange={update('name')} required disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? (form.country === 'BR' ? 'CNPJ' : 'NIPC') : (form.country === 'BR' ? 'CPF' : 'NIF')}</label>
            <input type="text" value={form.taxId} onChange={update('taxId')} placeholder={form.country === 'BR' ? '12.345.678/0001-00' : '123 456 789'} disabled={submitting} />
          </div>
          {form.personType === 'coletiva' && (
            <>
              <div className="adm-field">
                <label>DUNS (opcional)</label>
                <input type="text" value={form.duns} onChange={update('duns')} placeholder="449683786" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Representante legal</label>
                <input type="text" value={form.repName} onChange={update('repName')} placeholder="Nome completo do representante" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Cargo do representante</label>
                <input type="text" value={form.repRole} onChange={update('repRole')} placeholder="sócio-gerente, administrador…" disabled={submitting} />
              </div>
            </>
          )}
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
            <label>{form.personType === 'coletiva' ? 'Sede' : 'Morada / Endereço'}</label>
            <input type="text" value={form.address} onChange={update('address')} placeholder={form.country === 'BR' ? 'Rua, nº, bairro, cidade - UF' : 'Rua, nº, código postal, localidade'} disabled={submitting} />
          </div>
          {form.personType === 'singular' && (
            <>
              <div className="adm-field">
                <label>Nacionalidade</label>
                <input type="text" value={form.nationality} onChange={update('nationality')} placeholder={form.country === 'BR' ? 'brasileiro(a)' : 'português(a)'} disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Estado civil</label>
                <select value={form.maritalStatus} onChange={update('maritalStatus')} disabled={submitting}>
                  <option value="">—</option>
                  <option value="solteiro(a)">Solteiro(a)</option>
                  <option value="casado(a)">Casado(a)</option>
                  <option value="divorciado(a)">Divorciado(a)</option>
                  <option value="viúvo(a)">Viúvo(a)</option>
                  <option value="união estável">União estável / convivente</option>
                </select>
              </div>
              <div className="adm-field">
                <label>Data de nascimento</label>
                <input type="date" value={form.birthDate} onChange={update('birthDate')} disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Naturalidade</label>
                <input type="text" value={form.birthPlace} onChange={update('birthPlace')} placeholder="Cidade, Estado/Distrito, País" disabled={submitting} />
              </div>
            </>
          )}

          {/* Documento de identificação — necessário para procurações */}
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? 'Tipo de documento (representante)' : 'Tipo de documento'}</label>
            <select value={form.docType} onChange={update('docType')} disabled={submitting}>
              <option value="">—</option>
              <option value="Título de Residência">Título de Residência</option>
              <option value="Cartão de Cidadão">Cartão de Cidadão</option>
              <option value="Passaporte">Passaporte</option>
              <option value="BI/RG">BI / RG</option>
            </select>
          </div>
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? 'Nº do documento (representante)' : 'Nº do documento'}</label>
            <input type="text" value={form.docNumber} onChange={update('docNumber')} placeholder="Ex.: X6D997798" disabled={submitting} />
          </div>
          <div className="adm-field">
            <label>Validade do documento</label>
            <input type="date" value={form.docValidity} onChange={update('docValidity')} disabled={submitting} />
          </div>
          {form.personType === 'singular' && form.country === 'BR' && (
            <div className="adm-field">
              <label>RG</label>
              <input type="text" value={form.rg} onChange={update('rg')} placeholder="12.345.678-9" disabled={submitting} />
            </div>
          )}
          {form.personType === 'singular' && form.country === 'PT' && (
            <div className="adm-field">
              <label>NISS (opcional)</label>
              <input type="text" value={form.niss} onChange={update('niss')} placeholder="120 772 806 32" disabled={submitting} />
            </div>
          )}
          {form.personType === 'singular' && (
            <div className="adm-field">
              <label>Filiação (opcional)</label>
              <input type="text" value={form.filiation} onChange={update('filiation')} placeholder="Nome do pai e da mãe" disabled={submitting} />
            </div>
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
