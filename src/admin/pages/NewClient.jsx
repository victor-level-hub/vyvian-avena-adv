// src/admin/pages/NewClient.jsx
import LerIAModal from '../ler-ia-modal.jsx';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, notifications as notifApi } from '../apiClient';
import { IconDoc } from '../icons';
import ContactsEditor, { cleanContacts } from '../ContactsEditor';
import ParcelasEditor, { gerarParcelas, somaParcelas, parseValor, fmtValor } from '../ParcelasEditor';
import AddressEditor, { EMPTY_ADDRESS, composeAddress, hasAddress } from '../AddressEditor';
import { MoneyInput, StepperInput, TagsInput, RadioCards } from '../inputs';
import SlidingTabs from '../tabs';
import DateInput from '../datepicker';
import { IconUpload, IconPencil, IconRotate } from '../icons';
import PersonFields, { PersonPills, EMPTY_PERSON, personHasData } from '../PersonFields';

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
  const [invalid, setInvalid] = useState({}); // { name, startDate, totalValue, installments, monthlyValue }
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiDragOver, setAiDragOver] = useState(false);
  const aiFileRef = React.useRef(null);
  const [aiModalOpen, setAiModalOpen] = React.useState(false);
  // ref com o form mais recente — evita stale closure na leitura em lote
  const formRef = React.useRef(null);

  // Cliente conjunto (várias pessoas singulares, ex.: casal):
  // people = pessoas ADICIONAIS; activePerson: 0 = titular, 1.. = people[i-1]
  const [people, setPeople] = useState([]);
  const [activePerson, setActivePerson] = useState(0);
  const peopleRef = React.useRef({ people, activePerson });

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
    nationalities: [''],
    maritalStatus: '',
    rg: '',
    birthDate: '',
    birthPlace: '',
    docType: '',
    docNumber: '',
    docValidity: '',
    documents: [{ docType: '', docNumber: '', docValidity: '' }],
    niss: '',
    filiation: '',
    processos: [{ ref: '', area: 'Família', resumo: '' }],
    planType: 'installment',
    firstAttendance: '',
    startDate: '',
    totalValue: '',
    installments: '',
    monthlyValue: '',
    reminderDays: '5',
    reminderChannels: 'email+whatsapp',
  });
  formRef.current = form;
  peopleRef.current = { people, activePerson };

  const addPerson = () => {
    setPeople((ps) => {
      setActivePerson(ps.length + 1);
      return [...ps, { ...EMPTY_PERSON, addrParts: { ...EMPTY_ADDRESS, country: formRef.current.country || 'PT' } }];
    });
  };
  const updatePerson = (idx) => (v) => setPeople((ps) => ps.map((p, i) => (i === idx ? v : p)));
  const removePerson = (idx) => {
    setPeople((ps) => ps.filter((_, i) => i !== idx));
    setActivePerson(0);
  };

  // parcelas com valores personalizados (null = divisão igual automática)
  const [parcelasCustom, setParcelasCustom] = useState(null);
  const [parcelasModal, setParcelasModal] = useState(false);
  const [parcelasDraft, setParcelasDraft] = useState([]);

  const update = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    if (invalid[key]) setInvalid((inv) => ({ ...inv, [key]: false }));
    // mudar os parâmetros do plano invalida a personalização das parcelas
    if (['totalValue', 'installments', 'startDate', 'planType'].includes(key)) setParcelasCustom(null);
  };

  const abrirParcelasModal = () => {
    const total = parseValor(form.totalValue);
    const n = parseInt(form.installments, 10) || 0;
    if (!form.startDate || total <= 0 || n <= 0) return;
    setParcelasDraft(parcelasCustom ? parcelasCustom.map((r) => ({ ...r })) : gerarParcelas(total, n, form.startDate));
    setParcelasModal(true);
  };

  // ── editores de listas (nacionalidades, documentos, processos)
  const updList = (key, idx, patch) => setForm((f) => ({
    ...f,
    [key]: f[key].map((it, i) => (i === idx ? (typeof patch === 'object' ? { ...it, ...patch } : patch) : it)),
  }));
  const addList = (key, empty) => setForm((f) => ({ ...f, [key]: [...f[key], empty] }));
  const rmList = (key, idx) => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));
  const rmBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#b00', fontSize: '1rem', padding: '0 0.25rem' };
  const addBtnStyle = { background: 'none', border: '1px dashed rgba(0,0,0,0.25)', borderRadius: 4, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted, #666)' };
  // traço vertical entre campos do mesmo documento
  const vSep = { borderLeft: '1px solid rgba(0,0,0,0.22)', paddingLeft: '0.75rem' };

  // mudar o tipo de cliente ajusta as labels default dos contactos ainda vazios
  const updatePersonType = (e) => {
    const pt = e.target.value;
    if (pt === 'coletiva') setActivePerson(0); // pessoas adicionais só em singular
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
          // envia os processos já registados: a IA decide se o documento pertence a um
          // existente (melhora esse resumo) ou é um processo novo (cria resumo à parte)
          ...(form.processos.some((p) => p.ref || p.resumo)
            ? { 'X-Processos': encodeURIComponent(JSON.stringify(form.processos.map((p) => ({ ref: p.ref, area: p.area, resumo: (p.resumo || '').slice(0, 1500) })))) }
            : {}),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiMsg({ kind: 'err', text: data.error || `HTTP ${res.status}` });
        return;
      }
      const f = data.fields || {};
      // Pessoa adicional ativa? Os campos PESSOAIS vão para ela (preencher só vazios);
      // contactos e resumo do processo continuam no nível do cliente.
      const { people: curPeople, activePerson: curActive } = peopleRef.current;
      if (formRef.current.personType === 'singular' && curActive > 0 && curPeople[curActive - 1]) {
        const idx = curActive - 1;
        const pp = { ...curPeople[idx] };
        const pset = (k, v) => { if (v != null && v !== '' && !pp[k]) pp[k] = String(v); };
        pset('name', f.name);
        pset('identification', f.identification);
        pset('nationality', f.nationality);
        pset('marital_status', f.marital_status);
        pset('birth_date', f.birth_date);
        pset('birth_place', f.birth_place);
        pset('doc_type', f.doc_type);
        pset('doc_number', f.doc_number);
        pset('doc_validity', f.doc_validity);
        pset('niss', f.niss);
        pset('rg', f.rg);
        pset('father_name', f.father_name);
        pset('mother_name', f.mother_name);
        const cleanP = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== ''));
        if (f.address_parts && !hasAddress(pp.addrParts)) {
          pp.addrParts = { ...EMPTY_ADDRESS, country: formRef.current.country || 'PT', ...cleanP(f.address_parts) };
        } else if (f.address && !hasAddress(pp.addrParts)) {
          pp.addrParts = { ...EMPTY_ADDRESS, country: formRef.current.country || 'PT', via_type: 'Outro', via_name: String(f.address) };
        }
        setPeople((ps) => ps.map((x, i) => (i === idx ? pp : x)));
        // resumo do processo continua a ser do cliente
        if (f.process_summary && f.process_summary !== formRef.current.processSummary) {
          setForm((prev) => ({ ...prev, processSummary: String(f.process_summary) }));
        }
        const uP = data.usage || {};
        setAiMsg({ kind: 'ok', text: `${isTexto ? 'Texto lido' : 'Documento lido'} — campos aplicados à pessoa ${curActive + 1} (${pp.name || 'sem nome'}). Reveja antes de guardar. (uso: ${uP.input_tokens||0} entrada, ${uP.output_tokens||0} saída)` });
        return;
      }
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
      // sincronizar com os editores múltiplos (só preenche o que estiver vazio)
      const nats = [...merge.nationalities];
      if (f.nationality && !nats[0]) nats[0] = String(f.nationality);
      merge.nationalities = nats;
      const docs = merge.documents.map((d) => ({ ...d }));
      if (docs[0] && !docs[0].docType && f.doc_type) docs[0].docType = String(f.doc_type);
      if (docs[0] && !docs[0].docNumber && f.doc_number) docs[0].docNumber = String(f.doc_number);
      if (docs[0] && !docs[0].docValidity && f.doc_validity) docs[0].docValidity = String(f.doc_validity);
      merge.documents = docs;
      if (f.country && (f.country === 'PT' || f.country === 'BR')) merge.country = f.country;
      // processos: a IA indica se o documento pertence a um processo existente
      // (process_match = índice) ou é um processo NOVO (process_match = null)
      const AREAS_VALIDAS = ['Família', 'Cível', 'Trabalhista', 'Empresarial', 'Nacionalidade', 'Administrativo', 'Criminal'];
      const procs = merge.processos.map((p) => ({ ...p }));
      let procMsg = '';
      if (f.process_summary) {
        const mi = Number.isInteger(f.process_match) && f.process_match >= 0 && f.process_match < procs.length
          ? f.process_match : null;
        if (mi !== null) {
          // documento de um processo já registado -> melhora esse resumo
          procs[mi].resumo = String(f.process_summary);
          if (!procs[mi].ref && f.process_ref) procs[mi].ref = String(f.process_ref);
          procMsg = ` · resumo do Processo ${mi + 1} atualizado`;
        } else {
          // processo novo -> ocupa o primeiro cartão vazio ou cria um novo
          const novo = {
            ref: f.process_ref ? String(f.process_ref) : '',
            area: f.practice_area && AREAS_VALIDAS.includes(f.practice_area) ? f.practice_area : 'Família',
            resumo: String(f.process_summary),
          };
          const emptyIdx = procs.findIndex((p) => !p.ref.trim() && !p.resumo.trim());
          if (emptyIdx !== -1) {
            procs[emptyIdx] = { ...procs[emptyIdx], ...novo };
            procMsg = ' · resumo do processo criado (ver aba Dados do Processo)';
          } else {
            procs.push(novo);
            procMsg = ` · novo processo detetado e adicionado (Processo ${procs.length})`;
          }
        }
      }
      merge.processos = procs;
      setForm(merge);
      const filled = Object.keys(f).filter((k) => f[k]).length;
      const u = data.usage || {};
      setAiMsg({ kind: 'ok', text: `Documento lido — ${filled} campos preenchidos${procMsg}. Reveja antes de guardar. (uso: ${u.input_tokens||0} entrada, ${u.output_tokens||0} saída)` });
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

    // Sem campos obrigatórios: o formulário guarda com o que estiver preenchido.
    // As parcelas só são geradas quando houver data de vencimento e valores válidos.
    const emailList = cleanContacts(form.emails);
    const phoneList = cleanContacts(form.phones);
    const inv = {};
    if (!form.name.trim()) inv.name = true;
    if (emailList.length === 0) inv.email = true;
    if (phoneList.length === 0) inv.phone = true;
    const semPlano = form.planType === 'oficioso' || form.planType === 'probono';
    if (!semPlano && !form.startDate) inv.startDate = true;
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

    // pessoas adicionais: se tem dados preenchidos, o nome é obrigatório
    if (form.personType === 'singular') {
      const semNome = people.findIndex((p) => !p.name.trim() && personHasData(p));
      if (semNome !== -1) {
        setError(`A pessoa ${semNome + 2} tem dados preenchidos mas falta o nome.`);
        setTab('cliente');
        setActivePerson(semNome + 1);
        return;
      }
    }
    setSubmitting(true);

    try {
      const currency = form.country === 'BR' ? 'BRL' : 'EUR';
      const clientId = makeId(form.name);

      // 1. Criar cliente
      const totalContracted = form.planType === 'installment'
        ? (parseFloat(form.totalValue.toString().replace(',', '.')) || 0)
        : 0;
      const numParcelas = form.planType === 'installment'
        ? (parseInt(form.installments, 10) || 0)
        : 0;

      const isColetiva = form.personType === 'coletiva';
      // listas limpas (nacionalidades/documentos são da pessoa singular; coletiva usa os campos do responsável)
      const natList = !isColetiva ? form.nationalities.map((n) => n.trim()).filter(Boolean) : [];
      const docList = !isColetiva ? form.documents.filter((d) => d.docType || d.docNumber || d.docValidity) : [];
      const procList = form.processos
        .filter((p) => p.ref.trim() || p.resumo.trim())
        .map((p) => ({ ref: p.ref.trim(), area: p.area, resumo: p.resumo }));
      const proc0 = form.processos[0] || { ref: '', area: 'Família', resumo: '' };

      // pessoas adicionais (cliente conjunto) — só em pessoa singular
      const extraPeople = isColetiva ? [] : people
        .filter((p) => p.name.trim())
        .map((p) => {
          const { addrParts, ...rest } = p;
          return {
            ...rest,
            address: hasAddress(addrParts) ? composeAddress(addrParts) : null,
            address_parts: hasAddress(addrParts) ? JSON.stringify(addrParts) : null,
          };
        });

      await clientsApi.create({
        id: clientId,
        name: form.name,
        email: emailList[0]?.value || null,
        phone: phoneList[0]?.value || null,
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
        nationality: (natList[0] || form.nationality) || null,
        nationalities: natList.length ? JSON.stringify(natList) : null,
        marital_status: form.maritalStatus || null,
        rg: form.country === 'BR' ? (form.rg || null) : null,
        birth_date: form.birthDate || null,
        birth_place: form.birthPlace || null,
        doc_type: (!isColetiva ? docList[0]?.docType : form.docType) || null,
        doc_number: (!isColetiva ? docList[0]?.docNumber : form.docNumber) || null,
        doc_validity: (!isColetiva ? docList[0]?.docValidity : form.docValidity) || null,
        documents: docList.length ? JSON.stringify(docList) : null,
        niss: form.niss || null,
        filiation: [form.father, form.mother].filter(Boolean).join(' e ') || form.filiation || null,
        practice_area: proc0.area,
        process_summary: proc0.resumo || null,
        notes: proc0.ref ? `Processo: ${proc0.ref}` : '',
        processes: procList.length ? JSON.stringify(procList) : null,
        plan_type: form.planType,
        honorarios_total: semPlano ? 0 : totalContracted,
        honorarios_parcelas: semPlano ? 0 : numParcelas,
        contract_start_date: semPlano ? null : (form.startDate || null),
        first_attendance_date: form.firstAttendance || null,
        people: extraPeople,
      });

      // 2. Gerar parcelas — só quando há data de vencimento e valores válidos.
      //    Sem esses dados, o cliente é criado sem plano (pode ser preenchido depois).
      let installmentsToCreate = [];
      if (semPlano) {
        // Oficioso: honorários fixados no trânsito em julgado — registados depois
        // como pagamento avulso na ficha. Pro bono: sem componente financeira.
      } else if (form.startDate && form.planType === 'installment' && totalContracted > 0 && numParcelas > 0) {
        // valores personalizados (se definidos e a fechar com o total) ou divisão igual
        const rows = (parcelasCustom && parcelasCustom.length === numParcelas && Math.abs(somaParcelas(parcelasCustom) - totalContracted) < 0.005)
          ? parcelasCustom
          : gerarParcelas(totalContracted, numParcelas, form.startDate);
        for (const r of rows) {
          installmentsToCreate.push({
            id: `${clientId}-p${r.n}`,
            client_id: clientId,
            installment_number: r.n,
            total_installments: numParcelas,
            amount: parseValor(r.amount),
            currency,
            due_date: r.due_date,
          });
        }
      } else if (form.startDate && form.planType === 'monthly') {
        // Avença: cria 12 primeiras parcelas
        const monthlyValue = parseFloat(form.monthlyValue.toString().replace(',', '.')) || 0;
        if (monthlyValue > 0) {
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
      if (!semPlano && form.reminderChannels !== 'none') {
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
  } else if (form.planType === 'oficioso') {
    planPreview = '→ sem valor à partida — honorários fixados e recebidos após o trânsito em julgado; registe com "+ Pagamento" na ficha do cliente';
  } else if (form.planType === 'probono') {
    planPreview = '→ atendimento gratuito e voluntário — sem parcelas nem cobranças';
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
          className={'adm-dropzone' + (aiDragOver ? ' over' : '') + (aiBusy ? ' busy' : '')}
          onDragOver={(e) => { e.preventDefault(); setAiDragOver(true); }}
          onDragLeave={() => setAiDragOver(false)}
          onDrop={aiOnDrop}
          onClick={() => !aiBusy && setAiModalOpen(true)}
        >
          <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}>
            <span className="adm-dropzone-icon"><IconUpload size={15} /></span> Cadastro rápido com IA
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
            Arraste aqui (ou clique para escolher) o documento do cliente — Título de Residência, Cartão de Cidadão, Passaporte, RG, ou uma procuração/certidão da empresa.
            <br />A IA lê o documento e preenche o formulário (incl. empresa, sede, DUNS e representante legal). Reveja antes de guardar.
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
            PNG, JPEG, WEBP ou PDF · até 8 MB
          </div>
          {aiBusy && <span className="adm-dropzone-bar" aria-hidden="true" />}
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

        {/* Abas — indicador dourado desliza até à ativa */}
        <SlidingTabs
          items={[
            { id: 'cliente', label: 'Dados do Cliente' },
            { id: 'processo', label: 'Dados do Processo' },
            { id: 'financeiro', label: 'Dados Financeiros' },
          ]}
          active={tab}
          onChange={setTab}
          variant="underline"
        />

        {tab === 'cliente' && (<>
        <div className="adm-form-grid">
          <div className="adm-field">
            <label>Tipo de cliente</label>
            <select value={form.personType} onChange={updatePersonType} disabled={submitting}>
              <option value="singular">Pessoa singular</option>
              <option value="coletiva">Pessoa coletiva (empresa)</option>
            </select>
          </div>
          <div className="adm-field">
            <label>Jurisdição</label>
            <RadioCards
              value={form.country}
              onChange={(v) => update('country')({ target: { value: v } })}
              disabled={submitting}
              options={[
                { value: 'PT', title: 'Portugal', desc: 'Faturação em € EUR' },
                { value: 'BR', title: 'Brasil', desc: 'Faturação em R$ BRL' },
              ]}
            />
          </div>
        </div>

        <div className="adm-form-section-title">{form.personType === 'coletiva' ? 'Dados da empresa' : 'Dados pessoais'}</div>
        {form.personType === 'singular' && (
          <PersonPills
            names={[form.name || 'Pessoa 1', ...people.map((p) => p.name)]}
            active={activePerson}
            onSelect={setActivePerson}
            onAdd={addPerson}
            disabled={submitting}
          />
        )}
        {form.personType === 'singular' && people.length > 0 && activePerson === 0 && (
          <div className="adm-field-helper" style={{ margin: '-0.4rem 0 0.8rem' }}>
            Cliente conjunto: os contactos, a área e o plano financeiro são partilhados; cada pessoa tem os seus dados pessoais (use as pills acima).
          </div>
        )}
        {(form.personType === 'coletiva' || activePerson === 0) && (
        <div className="adm-form-grid">
          <div className="adm-field">
            <label style={invLabel('name')}>{form.personType === 'coletiva' ? 'Denominação da empresa' : 'Nome completo'}</label>
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
          {form.personType === 'coletiva' ? (
            <div className="adm-field">
              <label>Nacionalidade da empresa</label>
              <input type="text" value={form.nationality} onChange={update('nationality')} placeholder={form.country === 'BR' ? 'brasileira' : 'portuguesa'} disabled={submitting} />
            </div>
          ) : (
            <div className="adm-field">
              <label>Nacionalidade{form.nationalities.filter(Boolean).length > 1 ? 's' : ''}</label>
              <TagsInput
                tags={form.nationalities.filter(Boolean)}
                onChange={(tags) => setForm((f) => ({ ...f, nationalities: tags.length ? tags : [''] }))}
                placeholder={form.country === 'BR' ? 'brasileira (Enter adiciona)' : 'portuguesa (Enter adiciona)'}
                disabled={submitting}
              />
              <div className="adm-field-helper">Escreva e prima Enter — pode adicionar várias</div>
            </div>
          )}
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
                <DateInput value={form.birthDate} onChange={update('birthDate')} disabled={submitting} />
              </div>
              <div className="adm-field">
                <label>Naturalidade</label>
                <input type="text" value={form.birthPlace} onChange={update('birthPlace')} placeholder="Cidade, Estado/Distrito, País" disabled={submitting} />
              </div>
            </>
          )}
          <ContactsEditor kind="email" items={form.emails} onChange={(v) => setForm({ ...form, emails: v })} disabled={submitting} inputId="f-email" />
          <ContactsEditor kind="phone" items={form.phones} onChange={(v) => setForm({ ...form, phones: v })} disabled={submitting} inputId="f-phone" />
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
              {/* Documentos de identificação — necessários para procurações. Cada linha: tipo | número | validade */}
              <div className="adm-field adm-full">
                <label>Documento{form.documents.length > 1 ? 's' : ''} de identificação</label>
                {form.documents.map((d, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    {/* grupo acoplado tipo | número | validade (padrão "input with start select") */}
                    <div className="adm-input-group" style={{ flex: 1, flexWrap: 'wrap' }}>
                      <select
                        value={d.docType}
                        onChange={(e) => updList('documents', idx, { docType: e.target.value })}
                        disabled={submitting}
                        style={{ flex: '0 0 32%', minWidth: 170 }}
                      >
                        <option value="">— tipo —</option>
                        <option value="Título de Residência">Título de Residência</option>
                        <option value="Cartão de Cidadão">Cartão de Cidadão</option>
                        <option value="Passaporte">Passaporte</option>
                        <option value="BI/RG">BI / RG</option>
                      </select>
                      <input
                        type="text"
                        value={d.docNumber}
                        onChange={(e) => updList('documents', idx, { docNumber: e.target.value })}
                        placeholder="Nº do documento (ex.: X6D997798)"
                        disabled={submitting}
                        style={{ flex: 1, minWidth: 160 }}
                      />
                      <DateInput
                        value={d.docValidity}
                        onChange={(e) => updList('documents', idx, { docValidity: e.target.value })}
                        disabled={submitting}
                        placeholder="validade"
                        style={{ flex: '0 0 160px', width: 'auto' }}
                      />
                    </div>
                    {form.documents.length > 1 && (
                      <button type="button" onClick={() => rmList('documents', idx)} disabled={submitting} title="Remover documento" style={rmBtnStyle}>✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => addList('documents', { docType: '', docNumber: '', docValidity: '' })} disabled={submitting} style={addBtnStyle}>
                  ＋ adicionar documento
                </button>
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
        )}

        {form.personType === 'singular' && activePerson > 0 && people[activePerson - 1] && (
          <>
            <div className="adm-form-grid">
              <PersonFields
                value={people[activePerson - 1]}
                onChange={updatePerson(activePerson - 1)}
                country={form.country}
                disabled={submitting}
              />
            </div>
            <div style={{ margin: '0.6rem 0 0.2rem' }}>
              <button
                type="button"
                className="adm-btn adm-btn-ghost adm-btn-sm"
                style={{ color: '#b00', borderColor: 'rgba(176,0,0,0.35)' }}
                onClick={() => removePerson(activePerson - 1)}
                disabled={submitting}
              >
                Remover esta pessoa
              </button>
            </div>
          </>
        )}

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
                <DateInput value={form.birthDate} onChange={update('birthDate')} disabled={submitting} />
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
        <div className="adm-form-section-title">Dados do{form.processos.length > 1 ? 's' : ''} Processo{form.processos.length > 1 ? 's' : ''}</div>
        {form.processos.map((p, idx) => (
          <div
            key={idx}
            style={{
              border: '1px solid rgba(0,0,0,0.1)', borderLeft: '3px solid var(--gold, #b8935a)',
              borderRadius: 6, padding: '1rem 1.1rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.45)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--forest, #12302a)' }}>
                Processo {idx + 1}{p.ref ? ` · ${p.ref}` : ''}
              </div>
              {form.processos.length > 1 && (
                <button type="button" onClick={() => rmList('processos', idx)} disabled={submitting} title="Remover processo" style={rmBtnStyle}>✕</button>
              )}
            </div>
            <div className="adm-form-grid">
              <div className="adm-field">
                <label>Processo / referência interna</label>
                <input
                  type="text"
                  value={p.ref}
                  onChange={(e) => updList('processos', idx, { ref: e.target.value })}
                  placeholder="Ex.: 1289/26 · Divórcio consensual"
                  disabled={submitting}
                />
              </div>
              <div className="adm-field">
                <label>Área de atuação</label>
                <select value={p.area} onChange={(e) => updList('processos', idx, { area: e.target.value })} disabled={submitting}>
                  <option>Família</option>
                  <option>Cível</option>
                  <option>Trabalhista</option>
                  <option>Empresarial</option>
                  <option>Nacionalidade</option>
                  <option>Administrativo</option>
                  <option>Criminal</option>
                </select>
              </div>
              <div className="adm-field adm-full">
                <label>Resumo do processo</label>
                <textarea
                  rows={idx === 0 ? 9 : 6}
                  value={p.resumo}
                  onChange={(e) => updList('processos', idx, { resumo: e.target.value })}
                  placeholder={idx === 0
                    ? 'Arraste documentos do caso (e-mails, participações de sinistro, contratos…) na caixa de IA acima — o resumo é criado automaticamente e melhorado a cada documento novo. Também pode escrever ou editar à mão.'
                    : 'Resumo deste processo (escrito à mão).'}
                  disabled={submitting}
                  style={{ resize: 'vertical', width: '100%', fontFamily: "'Arial Unicode MS', Arial, 'Helvetica Neue', sans-serif", fontSize: '0.9rem', lineHeight: 1.55, padding: '0.6rem 0.75rem' }}
                />
                {idx === 0 && <div className="adm-field-helper">Gerado pela IA a partir dos documentos · sempre editável · reveja antes de guardar</div>}
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => addList('processos', { ref: '', area: 'Família', resumo: '' })} disabled={submitting} style={addBtnStyle}>
          ＋ adicionar processo
        </button>
        </>)}

        {tab === 'financeiro' && (
        <div className="adm-form-section">
          <div className="adm-form-section-title">Plano financeiro</div>
          <div className="adm-form-grid">
            <div className="adm-field adm-full">
              <label>Tipo de plano</label>
              <RadioCards
                value={form.planType}
                onChange={(v) => update('planType')({ target: { value: v } })}
                disabled={submitting}
                options={[
                  { value: 'installment', title: 'Parcelado', desc: 'Montante total dividido em prestações' },
                  { value: 'monthly', title: 'Avença mensal', desc: 'Valor recorrente todos os meses' },
                  { value: 'oficioso', title: 'Oficioso', desc: 'Nomeação da Ordem — honorários no trânsito' },
                  { value: 'probono', title: 'Pro bono', desc: 'Atendimento gratuito e voluntário' },
                ]}
              />

            </div>
            {(form.planType === 'installment' || form.planType === 'monthly') && (
            <div className="adm-field">
              <label style={invLabel('startDate')}>Data de Vencimento</label>
              <DateInput id="f-startDate" value={form.startDate} onChange={update('startDate')} disabled={submitting} style={invStyle('startDate')} />
              <div className="adm-field-helper">1.ª parcela — as seguintes vencem mensalmente a partir desta data</div>
            </div>
            <div className="adm-field">
              <label>Data do 1.º atendimento</label>
              <DateInput value={form.firstAttendance} onChange={update('firstAttendance')} disabled={submitting} />
              <div className="adm-field-helper">Opcional — quando o cliente foi atendido pela primeira vez</div>
            </div>
            )}

            {form.planType === 'installment' && (
              <>
                <div className="adm-field">
                  <label style={invLabel('totalValue')}>Valor total contratado</label>
                  <MoneyInput id="f-totalValue" currency={form.country === 'BR' ? 'BRL' : 'EUR'} value={form.totalValue} onChange={update('totalValue')} placeholder="3120" disabled={submitting} style={invStyle('totalValue')} />
                </div>
                <div className="adm-field">
                  <label style={invLabel('installments')}>Número de parcelas</label>
                  <StepperInput id="f-installments" min={1} value={form.installments} onChange={update('installments')} placeholder="6" disabled={submitting} style={invStyle('installments')} />
                  {planPreview && !parcelasCustom && <div className="adm-field-helper">{planPreview}</div>}
                  {parcelasCustom && (
                    <div className="adm-field-helper" style={{ color: '#1f7a43', fontWeight: 600 }}>
                      → valores personalizados definidos ✓ (última: {fmtValor(parseValor(parcelasCustom[parcelasCustom.length - 1].amount), form.country === 'BR' ? 'BRL' : 'EUR')})
                    </div>
                  )}
                  <button
                    type="button"
                    className="adm-btn"
                    data-tip="Definir um valor e uma data diferentes para cada parcela (ex.: 12× €50 + 1× €60)"
                    style={{ marginTop: '0.5rem', fontSize: '0.72rem', padding: '0.3rem 0.75rem' }}
                    disabled={submitting || !form.startDate || parseValor(form.totalValue) <= 0 || (parseInt(form.installments, 10) || 0) <= 0}
                    onClick={abrirParcelasModal}
                  >
                    <IconPencil size={12} /> Ajustar valores das parcelas
                  </button>
                </div>
              </>
            )}

            {(form.planType === 'oficioso' || form.planType === 'probono') && (
              <div className="adm-field adm-full">
                <div className="adm-field-helper" style={{ padding: '0.75rem 1rem', background: 'var(--cream, #f5f0e8)', borderRadius: 8, lineHeight: 1.6 }}>
                  {form.planType === 'oficioso'
                    ? <>Nomeação pela Ordem dos Advogados: o valor dos honorários não é conhecido à partida e só é recebido após o trânsito em julgado. O cliente é criado sem parcelas — quando receber, registe o valor na ficha do cliente com <strong>+ Pagamento</strong>.</>
                    : <>Atendimento gratuito e voluntário — este cliente não tem componente financeira: sem parcelas, cobranças ou lembretes.</>}
                </div>
              </div>
            )}

            {form.planType === 'monthly' && (
              <div className="adm-field adm-full">
                <label style={invLabel('monthlyValue')}>Valor mensal</label>
                <MoneyInput id="f-monthlyValue" currency={form.country === 'BR' ? 'BRL' : 'EUR'} value={form.monthlyValue} onChange={update('monthlyValue')} placeholder="450" disabled={submitting} style={invStyle('monthlyValue')} />
                {planPreview && <div className="adm-field-helper">{planPreview}</div>}
              </div>
            )}

            {(form.planType === 'installment' || form.planType === 'monthly') && (
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
            )}
          </div>
        </div>
        )}

        {/* Modal: ajustar valores individuais das parcelas */}
        {parcelasModal && (
          <div
            className="adm-overlay"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setParcelasModal(false); }}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', zIndex: 1500,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 1rem 2rem', overflowY: 'auto',
            }}
          >
            <div style={{
              background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 560,
              padding: '1.6rem 1.7rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', borderTop: '3px solid var(--gold, #b8935a)',
            }}>
              <h2 style={{ margin: '0 0 0.3rem', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--forest, #12302a)' }}>
                Ajustar valores das parcelas
              </h2>
              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--muted, #777)', marginBottom: '0.9rem' }}>
                Edite o valor (e a data, se necessário) de cada parcela. A soma tem de fechar com o valor total contratado para aplicar.
              </div>
              <ParcelasEditor
                rows={parcelasDraft}
                onChange={setParcelasDraft}
                currency={form.country === 'BR' ? 'BRL' : 'EUR'}
                targetTotal={parseValor(form.totalValue)}
                onRemove={(idx) => setParcelasDraft((rows) => rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, n: i + 1 })))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => setParcelasDraft(gerarParcelas(parseValor(form.totalValue), parseInt(form.installments, 10) || 0, form.startDate))}
                >
                  <IconRotate size={12} /> Repor divisão igual
                </button>
                <span style={{ display: 'inline-flex', gap: '0.6rem' }}>
                  <button type="button" className="adm-btn" onClick={() => setParcelasModal(false)}>Cancelar</button>
                  <button
                    type="button"
                    className="adm-btn adm-btn-gold"
                    disabled={Math.abs(somaParcelas(parcelasDraft) - parseValor(form.totalValue)) >= 0.005}
                    title={Math.abs(somaParcelas(parcelasDraft) - parseValor(form.totalValue)) >= 0.005 ? 'A soma das parcelas tem de ser igual ao valor total' : ''}
                    onClick={() => {
                      setParcelasCustom(parcelasDraft.map((r) => ({ ...r })));
                      // se foram eliminadas parcelas no modal, sincroniza o n.º de parcelas do formulário
                      setForm((f) => ({ ...f, installments: String(parcelasDraft.length) }));
                      setParcelasModal(false);
                    }}
                  >
                    Aplicar
                  </button>
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="adm-form-actions">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => navigate('/admin/clientes')} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={submitting}>
            {submitting ? 'A criar…' : (form.planType === 'oficioso' || form.planType === 'probono' ? 'Criar cliente' : 'Criar cliente e gerar parcelas')}
          </button>
        </div>
      </form>
    </>
  );
}
