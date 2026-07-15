// src/admin/pages/NewClient.jsx
import LerIAModal from '../ler-ia-modal.jsx';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, notifications as notifApi } from '../apiClient';
import { IconDoc } from '../icons';
import ContactsEditor, { cleanContacts } from '../ContactsEditor';
import AddressEditor, { EMPTY_ADDRESS, composeAddress, hasAddress } from '../AddressEditor';

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
  const [tab, setTab] = useState('cliente'); // 'cliente' | 'processo' | 'financeiro'
  const [invalid, setInvalid] = useState({}); // { name, email, phone, startDate, totalValue, installments, monthlyValue }
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiDragOver, setAiDragOver] = useState(false);
  const aiFileRef = React.useRef(null);
  const [aiModalOpen, setAiModalOpen] = React.useState(false);
  // ref com o form mais recente — evita stale closure na leitura em lote
  const formRef = React.useRef(null);

  const [form, setForm] = useState({
    personType: 'singular',
    name: '',
    taxId: '',
    emails: [{ label: 'Pessoal', value: '' }],
    phones: [{ label: 'Pessoal', value: '' }],
    country: 'PT',
    address: '',
    addrParts: { ...EMPTY_ADDRESS },
    duns: '',
    repName: '',
    repRole: '',
    repNif: '',
    repNationality: '',
    repAddrParts: { ...EMPTY_ADDRESS },
    father: '',
    mother: '',
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
    processSummary: '',
    planType: 'installment',
    startDate: '',
    totalValue: '',
    installments: '',
    monthlyValue: '',
    reminderDays: '5',
    reminderChannels: 'email+whatsapp',
  });
  formRef.current = form;

  const update = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    if (invalid[key]) setInvalid((inv) => ({ ...inv, [key]: false }));
  };

  // mudar o tipo de cliente ajusta as labels default dos contactos ainda vazios
  const updatePersonType = (e) => {
    const pt = e.target.value;
    const relabel = (list, lbl) => list.every((c) => !c.value) ? list.map((c, i) => ({ ...c, label: i === 0 ? lbl : c.label })) : list;
    setForm((f) => ({
      ...f,
      personType: pt,
      emails: relabel(f.emails, pt === 'coletiva' ? 'Empresa' : 'Pessoal'),
      phones: relabel(f.phones, pt === 'coletiva' ? 'Empresa' : 'Pessoal'),
    }));
  };

  // estilo de campo obrigatório em falta
  const invStyle = (k) => (invalid[k] ? { borderColor: '#c00000', boxShadow: '0 0 0 2px rgba(192,0,0,0.14)' } : {});
  const invLabel = (k) => (invalid[k] ? { color: '#c00000' } : undefined);

  // muda de aba, faz scroll até ao campo e coloca o cursor lá
  const focusField = (tabKey, elId) => {
    setTab(tabKey);
    setTimeout(() => {
      const el = document.getElementById(elId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
    }, 80);
  };

  // ── Cadastro com IA: arrastar/escolher documento -> extrair campos
  const aiAccept = ['image/png','image/jpeg','image/jpg','image/webp','application/pdf'];

  const aiExtractFile = async (file) => {
    if (!file) return;
    const isTexto = typeof file === 'string';
    if (!isTexto && !aiAccept.includes(file.type)) {
      setAiMsg({ kind: 'err', text: 'Tipo não suportado. Use PNG, JPEG, WEBP ou PDF.' });
      return;
    }
    setAiBusy(true);
    setAiMsg({ kind: 'info', text: isTexto ? 'A ler o texto com IA…' : 'A ler o documento com IA…' });
    try {
      const token = sessionStorage.getItem('vyvian_admin_token');
      const res = await fetch('/api/cadastro/extrair-documento', {
        method: 'POST',
        headers: {
          'Content-Type': isTexto ? 'text/plain;charset=utf-8' : file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // envia o resumo atual para a IA melhorar (em vez de substituir às cegas)
          ...(formRef.current.processSummary ? { 'X-Resumo-Atual': encodeURIComponent(formRef.current.processSummary.slice(0, 4000)) } : {}),
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
      const merge = { ...formRef.current };
      const set = (k, v) => { if (v != null && v !== '' && !merge[k]) merge[k] = String(v); };
      if (f.person_type === 'coletiva') merge.personType = 'coletiva';
      set('name', f.name);
      set('taxId', f.identification);
      const aiLabel = (f.person_type === 'coletiva' || merge.personType === 'coletiva') ? 'Empresa' : 'Pessoal';
      if (f.email && !merge.emails.some((c) => c.value)) merge.emails = [{ label: aiLabel, value: String(f.email) }];
      else if (f.email && !merge.emails.some((c) => c.value === f.email)) merge.emails = [...merge.emails, { label: aiLabel, value: String(f.email) }];
      if (f.phone && !merge.phones.some((c) => c.value)) merge.phones = [{ label: aiLabel, value: String(f.phone) }];
      else if (f.phone && !merge.phones.some((c) => c.value === f.phone)) merge.phones = [...merge.phones, { label: aiLabel, value: String(f.phone) }];
      set('duns', f.duns);
      set('repName', f.rep_name);
      set('repRole', f.rep_role);
      set('repNif', f.rep_nif);
      set('repNationality', f.rep_nationality);
      set('father', f.father_name);
      set('mother', f.mother_name);
      // moradas estruturadas (só preenche se ainda vazia)
      const cleanParts = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== ''));
      if (f.address_parts && !hasAddress(merge.addrParts)) {
        merge.addrParts = { ...EMPTY_ADDRESS, country: merge.country || 'PT', ...cleanParts(f.address_parts) };
      } else if (f.address && !hasAddress(merge.addrParts)) {
        merge.addrParts = { ...EMPTY_ADDRESS, country: merge.country || 'PT', via_type: 'Outro', via_name: String(f.address) };
      }
      if (f.rep_address_parts && !hasAddress(merge.repAddrParts)) {
        merge.repAddrParts = { ...EMPTY_ADDRESS, country: merge.country || 'PT', ...cleanParts(f.rep_address_parts) };
      }
      set('nationality', f.nationality);
      set('maritalStatus', f.marital_status);
      set('birthDate', f.birth_date);
      set('birthPlace', f.birth_place);
      set('docType', f.doc_type);
      set('docNumber', f.doc_number);
      set('docValidity', f.doc_validity);
      set('niss', f.niss);
      if (f.country && (f.country === 'PT' || f.country === 'BR')) merge.country = f.country;
      // resumo do processo: a IA já devolve a versão fundida com o resumo anterior
      const summaryUpdated = !!(f.process_summary && f.process_summary !== formRef.current.processSummary);
      if (f.process_summary) merge.processSummary = String(f.process_summary);
      setForm(merge);
      const filled = Object.keys(f).filter((k) => f[k]).length;
      const u = data.usage || {};
      setAiMsg({ kind: 'ok', text: `${isTexto ? 'Texto lido' : 'Documento lido'} — ${filled} campos preenchidos${summaryUpdated ? ' · resumo do processo atualizado (ver aba Dados do Processo)' : ''}. Reveja antes de guardar. (uso: ${u.input_tokens||0} entrada, ${u.output_tokens||0} saída)` });
    } catch (err) {
      setAiMsg({ kind: 'err', text: 'Erro: ' + err.message });
    } finally {
      setAiBusy(false);
    }
  };

  const aiOnDrop = (e) => {
    e.preventDefault(); setAiDragOver(false);
    const fs = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (fs.length) aiSubmeterLote('', fs);
  };
  // modal: texto colado + ficheiros, processados em sequência
  const aiSubmeterLote = async (texto, files) => {
    setAiModalOpen(false);
    if (texto) await aiExtractFile(texto);
    for (const f of files || []) await aiExtractFile(f); // eslint-disable-line no-await-in-loop
  };
  const aiOnFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) aiExtractFile(file);
    if (aiFileRef.current) aiFileRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // validação manual (os campos obrigatórios podem estar em abas escondidas)
    const emailList = cleanContacts(form.emails);
    const phoneList = cleanContacts(form.phones);
    const inv = {};
    if (!form.name.trim()) inv.name = true;
    if (emailList.length === 0) inv.email = true;
    if (phoneList.length === 0) inv.phone = true;
    if (!form.startDate) inv.startDate = true;
    if (form.planType === 'installment') {
      if (!form.totalValue) inv.totalValue = true;
      if (!form.installments) inv.installments = true;
    }
    if (form.planType === 'monthly' && !form.monthlyValue) inv.monthlyValue = true;
    setInvalid(inv);

    // primeiro campo em falta ganha o scroll + cursor
    const FIELD_META = [
      ['name', 'cliente', 'f-name'],
      ['email', 'cliente', 'f-email'],
      ['phone', 'cliente', 'f-phone'],
      ['startDate', 'financeiro', 'f-startDate'],
      ['totalValue', 'financeiro', 'f-totalValue'],
      ['installments', 'financeiro', 'f-installments'],
      ['monthlyValue', 'financeiro', 'f-monthlyValue'],
    ];
    const first = FIELD_META.find(([k]) => inv[k]);
    if (first) {
      setError('Faltam campos obrigatórios (assinalados a vermelho).');
      focusField(first[1], first[2]);
      return;
    }
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
        email: emailList[0].value,
        phone: phoneList[0].value,
        emails: JSON.stringify(emailList),
        phones: JSON.stringify(phoneList),
        country: form.country,
        identification: form.taxId,
        person_type: form.personType,
        duns: isColetiva ? (form.duns || null) : null,
        rep_name: isColetiva ? (form.repName || null) : null,
        rep_role: isColetiva ? (form.repRole || null) : null,
        rep_nif: isColetiva ? (form.repNif || null) : null,
        rep_nationality: isColetiva ? (form.repNationality || null) : null,
        rep_address: isColetiva && hasAddress(form.repAddrParts) ? composeAddress(form.repAddrParts) : null,
        rep_address_parts: isColetiva && hasAddress(form.repAddrParts) ? JSON.stringify(form.repAddrParts) : null,
        address: hasAddress(form.addrParts) ? composeAddress(form.addrParts) : (form.address || null),
        address_parts: hasAddress(form.addrParts) ? JSON.stringify(form.addrParts) : null,
        father_name: form.father || null,
        mother_name: form.mother || null,
        nationality: form.nationality || null,
        marital_status: form.maritalStatus || null,
        rg: form.country === 'BR' ? (form.rg || null) : null,
        birth_date: form.birthDate || null,
        birth_place: form.birthPlace || null,
        doc_type: form.docType || null,
        doc_number: form.docNumber || null,
        doc_validity: form.docValidity || null,
        niss: form.niss || null,
        filiation: [form.father, form.mother].filter(Boolean).join(' e ') || form.filiation || null,
        practice_area: form.area,
        process_summary: form.processSummary || null,
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
        <LerIAModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onSubmeter={aiSubmeterLote} />
        <div
          onDragOver={(e) => { e.preventDefault(); setAiDragOver(true); }}
          onDragLeave={() => setAiDragOver(false)}
          onDrop={aiOnDrop}
          onClick={() => !aiBusy && setAiModalOpen(true)}
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
            <IconDoc /> Cadastro rápido com IA
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

        {/* Abas */}
        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid rgba(0,0,0,0.12)', marginBottom: '1.25rem' }}>
          {[['cliente', 'Dados do Cliente'], ['processo', 'Dados do Processo'], ['financeiro', 'Dados Financeiros']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tab === key ? '2px solid var(--gold, #b8935a)' : '2px solid transparent',
                color: tab === key ? 'var(--forest, #12302a)' : 'var(--muted, #777)',
                fontWeight: tab === key ? 600 : 400,
                padding: '0.6rem 1rem',
                cursor: 'pointer',
                fontSize: '0.95rem',
                marginBottom: '-1px',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'cliente' && (<>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Tipo de cliente *</label>
            <select value={form.personType} onChange={updatePersonType} disabled={submitting}>
              <option value="singular">Pessoa singular</option>
              <option value="coletiva">Pessoa coletiva (empresa)</option>
            </select>
          </div>
          <div className="adm-field">
            <label>Jurisdição</label>
            <select value={form.country} onChange={update('country')} disabled={submitting}>
              <option value="PT">Portugal · € EUR</option>
              <option value="BR">Brasil · R$ BRL</option>
            </select>
          </div>
        </div>

        <div className="adm-form-section-title">{form.personType === 'coletiva' ? 'Dados da empresa' : 'Dados pessoais'}</div>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label style={invLabel('name')}>{form.personType === 'coletiva' ? 'Denominação da empresa *' : 'Nome completo *'}</label>
            <input id="f-name" type="text" value={form.name} onChange={update('name')} disabled={submitting} style={invStyle('name')} />
          </div>
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? (form.country === 'BR' ? 'CNPJ' : 'NIFC') : (form.country === 'BR' ? 'CPF' : 'NIF')}</label>
            <input type="text" value={form.taxId} onChange={update('taxId')} placeholder={form.country === 'BR' ? '12.345.678/0001-00' : '123 456 789'} disabled={submitting} />
          </div>
          {form.personType === 'coletiva' && (
            <div className="adm-field">
              <label>DUNS (opcional)</label>
              <input type="text" value={form.duns} onChange={update('duns')} placeholder="449683786" disabled={submitting} />
            </div>
          )}
          <div className="adm-field">
            <label>{form.personType === 'coletiva' ? 'Nacionalidade da empresa' : 'Nacionalidade'}</label>
            <input type="text" value={form.nationality} onChange={update('nationality')} placeholder={form.country === 'BR' ? 'brasileira' : 'portuguesa'} disabled={submitting} />
          </div>
          {form.personType === 'singular' && (
            <>
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
          <ContactsEditor kind="email" items={form.emails} onChange={(v) => { setForm({ ...form, emails: v }); if (invalid.email) setInvalid((i) => ({ ...i, email: false })); }} disabled={submitting} requiredFirst invalid={invalid.email} inputId="f-email" />
          <ContactsEditor kind="phone" items={form.phones} onChange={(v) => { setForm({ ...form, phones: v }); if (invalid.phone) setInvalid((i) => ({ ...i, phone: false })); }} disabled={submitting} requiredFirst invalid={invalid.phone} inputId="f-phone" />
          {form.personType === 'coletiva' && (
            <div className="adm-field adm-full" style={{ marginTop: '-0.5rem' }}>
              <div className="adm-field-helper">Use as labels para distinguir os contactos da empresa e do responsável.</div>
            </div>
          )}
          <AddressEditor
            label={form.personType === 'coletiva' ? 'Sede da empresa' : 'Morada / Endereço'}
            value={form.addrParts}
            onChange={(v) => setForm({ ...form, addrParts: v })}
            disabled={submitting}
          />

          {form.personType === 'singular' && (
            <>
              {/* Documento de identificação — necessário para procurações */}
              <div className="adm-field">
                <label>Tipo de documento</label>
                <select value={form.docType} onChange={update('docType')} disabled={submitting}>
                  <option value="">—</option>
                  <option value="Título de Residência">Título de Residência</option>
                  <option value="Cartão de Cidadão">Cartão de Cidadão</option>
                  <option value="Passaporte">Passaporte</option>
                  <option value="BI/RG">BI / RG</option>
                </select>
              </div>
              <div className="adm-field">
                <label>Nº do documento</label>
                <input type="text" value={form.docNumber} onChange={update('docNumber')} placeholder="Ex.: X6D997798" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Validade do documento</label>
                <input type="date" value={form.docValidity} onChange={update('docValidity')} disabled={submitting} />
              </div>
              {form.country === 'BR' && (
                <div className="adm-field">
                  <label>RG</label>
                  <input type="text" value={form.rg} onChange={update('rg')} placeholder="12.345.678-9" disabled={submitting} />
                </div>
              )}
              {form.country === 'PT' && (
                <div className="adm-field">
                  <label>NISS (opcional)</label>
                  <input type="text" value={form.niss} onChange={update('niss')} placeholder="120 772 806 32" disabled={submitting} />
                </div>
              )}
              <div className="adm-field">
                <label>Pai (opcional)</label>
                <input type="text" value={form.father} onChange={update('father')} placeholder="Nome do pai" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Mãe (opcional)</label>
                <input type="text" value={form.mother} onChange={update('mother')} placeholder="Nome da mãe" disabled={submitting} />
              </div>
            </>
          )}
        </div>

        {form.personType === 'coletiva' && (
          <>
            <div className="adm-form-section-title" style={{ marginTop: '1.25rem' }}>Dados do responsável</div>
            <div className="adm-form-grid">
              <div className="adm-field">
                <label>Nome do responsável</label>
                <input type="text" value={form.repName} onChange={update('repName')} placeholder="Nome completo" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Cargo</label>
                <input type="text" value={form.repRole} onChange={update('repRole')} placeholder="sócio-gerente, administrador…" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>{form.country === 'BR' ? 'CPF do responsável' : 'NIF do responsável'}</label>
                <input type="text" value={form.repNif} onChange={update('repNif')} placeholder={form.country === 'BR' ? '123.456.789-00' : '123 456 789'} disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Nacionalidade do responsável</label>
                <input type="text" value={form.repNationality} onChange={update('repNationality')} placeholder={form.country === 'BR' ? 'brasileiro(a)' : 'português(a)'} disabled={submitting} />
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
              <div className="adm-field">
                <label>Tipo de documento</label>
                <select value={form.docType} onChange={update('docType')} disabled={submitting}>
                  <option value="">—</option>
                  <option value="Título de Residência">Título de Residência</option>
                  <option value="Cartão de Cidadão">Cartão de Cidadão</option>
                  <option value="Passaporte">Passaporte</option>
                  <option value="BI/RG">BI / RG</option>
                </select>
              </div>
              <div className="adm-field">
                <label>Nº do documento</label>
                <input type="text" value={form.docNumber} onChange={update('docNumber')} placeholder="Ex.: X6D997798" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Validade do documento</label>
                <input type="date" value={form.docValidity} onChange={update('docValidity')} disabled={submitting} />
              </div>
              {form.country === 'PT' ? (
                <div className="adm-field">
                  <label>NISS (opcional)</label>
                  <input type="text" value={form.niss} onChange={update('niss')} placeholder="120 772 806 32" disabled={submitting} />
                </div>
              ) : (
                <div className="adm-field">
                  <label>RG</label>
                  <input type="text" value={form.rg} onChange={update('rg')} placeholder="12.345.678-9" disabled={submitting} />
                </div>
              )}
              <div className="adm-field">
                <label>Pai (opcional)</label>
                <input type="text" value={form.father} onChange={update('father')} placeholder="Nome do pai" disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Mãe (opcional)</label>
                <input type="text" value={form.mother} onChange={update('mother')} placeholder="Nome da mãe" disabled={submitting} />
              </div>
              <AddressEditor
                label="Morada do responsável"
                value={form.repAddrParts}
                onChange={(v) => setForm({ ...form, repAddrParts: v })}
                disabled={submitting}
              />
            </div>
          </>
        )}
        </>)}

        {tab === 'processo' && (<>
        <div className="adm-form-section-title">Dados do Processo</div>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Área de atuação</label>
            <select value={form.area} onChange={update('area')} disabled={submitting}>
              <option>Família</option>
              <option>Cível</option>
              <option>Trabalhista</option>
              <option>Empresarial</option>
            </select>
          </div>
          <div className="adm-field">
            <label>Processo / referência interna</label>
            <input type="text" value={form.process} onChange={update('process')} placeholder="Ex.: 1289/26 · Divórcio consensual" disabled={submitting} />
          </div>
          <div className="adm-field adm-full">
            <label>Resumo do processo</label>
            <textarea
              rows={9}
              value={form.processSummary}
              onChange={update('processSummary')}
              placeholder="Arraste documentos do caso (e-mails, participações de sinistro, contratos…) na caixa de IA acima — o resumo é criado automaticamente e melhorado a cada documento novo. Também pode escrever ou editar à mão."
              disabled={submitting}
              style={{ resize: 'vertical', width: '100%', fontFamily: "'Arial Unicode MS', Arial, 'Helvetica Neue', sans-serif", fontSize: '0.9rem', lineHeight: 1.55, padding: '0.6rem 0.75rem' }}
            />
            <div className="adm-field-helper">Gerado pela IA a partir dos documentos · sempre editável · reveja antes de guardar</div>
          </div>
        </div>
        </>)}

        {tab === 'financeiro' && (
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
              <label style={invLabel('startDate')}>Data da primeira cobrança *</label>
              <input id="f-startDate" type="date" value={form.startDate} onChange={update('startDate')} disabled={submitting} style={invStyle('startDate')} />
            </div>

            {form.planType === 'installment' && (
              <>
                <div className="adm-field">
                  <label style={invLabel('totalValue')}>Valor total contratado *</label>
                  <input id="f-totalValue" type="text" value={form.totalValue} onChange={update('totalValue')} placeholder="3120" disabled={submitting} style={invStyle('totalValue')} />
                </div>
                <div className="adm-field">
                  <label style={invLabel('installments')}>Número de parcelas *</label>
                  <input id="f-installments" type="number" min="1" value={form.installments} onChange={update('installments')} placeholder="6" disabled={submitting} style={invStyle('installments')} />
                  {planPreview && <div className="adm-field-helper">{planPreview}</div>}
                </div>
              </>
            )}

            {form.planType === 'monthly' && (
              <div className="adm-field adm-full">
                <label style={invLabel('monthlyValue')}>Valor mensal *</label>
                <input id="f-monthlyValue" type="text" value={form.monthlyValue} onChange={update('monthlyValue')} placeholder="450" disabled={submitting} style={invStyle('monthlyValue')} />
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
        )}

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
