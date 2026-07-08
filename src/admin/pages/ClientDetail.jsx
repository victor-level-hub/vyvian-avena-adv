// src/admin/pages/ClientDetail.jsx
import React, { useState, useEffect } from 'react';
import ContactsEditor, { parseContacts, cleanContacts } from '../ContactsEditor';
import AddressEditor, { EMPTY_ADDRESS, composeAddress, hasAddress, parseAddressParts } from '../AddressEditor';
import { useParams, Link } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, recibos as recibosApi, procuracoes as procApi, planos as planosApi, uploadTokens as utApi, clientDocs as docsApi, clientLogo, calendar as calendarApi } from '../apiClient';
import { IconPhone, IconBuilding, IconCamera, IconDoc, IconUpload } from '../icons';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ installment }) {
  if (installment.status === 'paid') return <span className="adm-badge adm-badge-paid">Pago</span>;
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.due_date));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.due_date);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">Pendente</span>;
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const [activeTab, setActiveTab] = useState('plan');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);
  const [reciboInfo, setReciboInfo] = useState({}); // { installmentId: {exists, filename} }
  const [reciboBusy, setReciboBusy] = useState(null);
  const [sendBusy, setSendBusy] = useState(null);
  const [planPdfBusy, setPlanPdfBusy] = useState(false);
  const [planSendBusy, setPlanSendBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState(null);
  const [editing, setEditing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiDragOver, setAiDragOver] = useState(false);
  const aiFileRef = React.useRef(null);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const fileInputRef = React.useRef(null);
  const pendingUploadId = React.useRef(null);
  const logoInputRef = React.useRef(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);

  // ── Procurações
  const [procTemplates, setProcTemplates] = useState([]);
  const [procTemplateId, setProcTemplateId] = useState('');
  const [procText, setProcText] = useState('');
  const [procEditable, setProcEditable] = useState([]);   // ['poderes', ...]
  const [procOverrides, setProcOverrides] = useState({}); // { poderes: '...' }
  const [procLocal, setProcLocal] = useState('Santa Maria da Feira');
  const [procData, setProcData] = useState(new Date().toISOString().slice(0, 10));
  const [procBusy, setProcBusy] = useState(false);
  const [procRefs, setProcRefs] = useState([]);          // processos conhecidos do cliente
  const [procSelectedRef, setProcSelectedRef] = useState('');

  // ── Documentos do cliente / link de upload
  const [docs, setDocs] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  // ── IA: ler mais documentos e completar a ficha (só preenche campos VAZIOS; funde o resumo)
  const AI_ACCEPT = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
  const FIELD_PT = {
    identification: 'NIF/NIPC', address: 'morada/sede', nationality: 'nacionalidade',
    marital_status: 'estado civil', birth_date: 'nascimento', birth_place: 'naturalidade',
    doc_type: 'tipo de documento', doc_number: 'nº documento', doc_validity: 'validade',
    niss: 'NISS', filiation: 'filiação', father_name: 'pai', mother_name: 'mãe', duns: 'DUNS', rep_name: 'responsável', rep_nif: 'NIF do responsável', rep_nationality: 'nacionalidade do responsável', address_parts: 'morada', rep_address_parts: 'morada do responsável', rep_address: 'morada do responsável',
    rep_role: 'cargo', person_type: 'tipo de cliente', emails: 'e-mail', phones: 'telefone',
    process_summary: 'resumo do processo',
  };

  const aiExtractFile = async (file) => {
    const client = data?.client;
    if (!client || !file) return;
    if (!AI_ACCEPT.includes(file.type)) {
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
          ...(client.process_summary ? { 'X-Resumo-Atual': encodeURIComponent(client.process_summary.slice(0, 4000)) } : {}),
        },
        body: file,
      });
      const r = await res.json();
      if (!res.ok || !r.ok) { setAiMsg({ kind: 'err', text: r.error || `HTTP ${res.status}` }); return; }
      const f = r.fields || {};

      const upd = {};
      const fillIfEmpty = (col, v) => { if (v != null && v !== '' && !client[col]) upd[col] = String(v); };
      fillIfEmpty('identification', f.identification);
      fillIfEmpty('address', f.address);
      fillIfEmpty('nationality', f.nationality);
      fillIfEmpty('marital_status', f.marital_status);
      fillIfEmpty('birth_date', f.birth_date);
      fillIfEmpty('birth_place', f.birth_place);
      fillIfEmpty('doc_type', f.doc_type);
      fillIfEmpty('doc_number', f.doc_number);
      fillIfEmpty('doc_validity', f.doc_validity);
      fillIfEmpty('niss', f.niss);
      fillIfEmpty('father_name', f.father_name);
      fillIfEmpty('mother_name', f.mother_name);
      if ((f.father_name || f.mother_name) && !client.filiation) upd.filiation = [f.father_name, f.mother_name].filter(Boolean).join(' e ');
      fillIfEmpty('duns', f.duns);
      fillIfEmpty('rep_name', f.rep_name);
      fillIfEmpty('rep_role', f.rep_role);
      fillIfEmpty('rep_nif', f.rep_nif);
      fillIfEmpty('rep_nationality', f.rep_nationality);
      if (f.address_parts && !client.address_parts) {
        const partsClean = Object.fromEntries(Object.entries(f.address_parts).filter(([, v]) => v != null && v !== ''));
        upd.address_parts = JSON.stringify({ ...EMPTY_ADDRESS, country: client.country || 'PT', ...partsClean });
        if (!client.address) upd.address = composeAddress({ ...EMPTY_ADDRESS, ...partsClean });
      }
      if (f.rep_address_parts && !client.rep_address_parts) {
        const rpClean = Object.fromEntries(Object.entries(f.rep_address_parts).filter(([, v]) => v != null && v !== ''));
        upd.rep_address_parts = JSON.stringify({ ...EMPTY_ADDRESS, country: client.country || 'PT', ...rpClean });
        upd.rep_address = composeAddress({ ...EMPTY_ADDRESS, ...rpClean });
      }
      if (f.person_type === 'coletiva' && client.person_type !== 'coletiva') upd.person_type = 'coletiva';

      // contactos: acrescentar se ainda não existirem
      const ctLabel = (f.person_type === 'coletiva' || client.person_type === 'coletiva') ? 'Empresa' : 'Pessoal';
      const curEmails = parseContacts(client.emails, client.email).filter((c) => c.value);
      if (f.email && !curEmails.some((c) => c.value.toLowerCase() === String(f.email).toLowerCase())) {
        const next = [...curEmails, { label: ctLabel, value: String(f.email) }];
        upd.emails = JSON.stringify(next);
        if (!client.email) upd.email = next[0].value;
      }
      const curPhones = parseContacts(client.phones, client.phone).filter((c) => c.value);
      if (f.phone && !curPhones.some((c) => c.value.replace(/\s/g, '') === String(f.phone).replace(/\s/g, ''))) {
        const next = [...curPhones, { label: ctLabel, value: String(f.phone) }];
        upd.phones = JSON.stringify(next);
        if (!client.phone) upd.phone = next[0].value;
      }

      // resumo: a IA devolve a versão fundida com o existente
      if (f.process_summary && f.process_summary !== client.process_summary) upd.process_summary = f.process_summary;

      if (Object.keys(upd).length === 0) {
        setAiMsg({ kind: 'ok', text: 'Documento lido — sem informação nova para acrescentar.' });
        return;
      }
      await clientsApi.update(client.id, upd);
      await loadData();
      const changed = [...new Set(Object.keys(upd).filter((k) => k !== 'email' && k !== 'phone').map((k) => FIELD_PT[k] || k))];
      setAiMsg({ kind: 'ok', text: `Documento lido — atualizado: ${changed.join(', ')}.` });
    } catch (err) {
      setAiMsg({ kind: 'err', text: 'Erro: ' + err.message });
    } finally {
      setAiBusy(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await clientsApi.get(clientId);
      setData(res);
      // carregar estado dos RV das parcelas pagas
      const paidIds = (res.installments || []).filter((i) => i.status === 'paid').map((i) => i.id);
      const infos = {};
      await Promise.all(paidIds.map(async (id) => {
        try { infos[id] = await recibosApi.info(id); } catch { infos[id] = { exists: false }; }
      }));
      setReciboInfo(infos);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [clientId]);

  // logo do cliente (fetch autenticado -> objectURL)
  useEffect(() => {
    let url = null;
    if (data?.client?.logo_key) {
      clientLogo.fetchUrl(clientId).then((u) => { url = u; setLogoUrl(u); });
    } else {
      setLogoUrl(null);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [data?.client?.logo_key, clientId]);

  const handleLogoChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      alert('Tipo não suportado. Use PNG, JPEG, WEBP ou SVG.');
      return;
    }
    setLogoBusy(true);
    try { await clientLogo.upload(clientId, file); await loadData(); }
    catch (err) { alert('Erro ao carregar logo: ' + err.message); }
    finally { setLogoBusy(false); }
  };

  const handleLogoRemove = async () => {
    if (!confirm('Remover a logo do cliente?')) return;
    setLogoBusy(true);
    try { await clientLogo.remove(clientId); await loadData(); }
    catch (err) { alert('Erro: ' + err.message); }
    finally { setLogoBusy(false); }
  };

  const handleMarkPaid = async (installmentId) => {
    if (!confirm('Marcar esta parcela como paga (hoje)?')) return;
    setMarkingPaid(installmentId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await installmentsApi.markPaid(installmentId, today);
      await loadData();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setMarkingPaid(null);
    }
  };

  // Anexar RV: aciona o input de ficheiro escondido
  const triggerAttach = (installmentId) => {
    pendingUploadId.current = installmentId;
    if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); }
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    const installmentId = pendingUploadId.current;
    if (!file || !installmentId) return;
    if (file.type !== 'application/pdf') { alert('Por favor selecione um ficheiro PDF.'); return; }
    setReciboBusy(installmentId);
    try {
      await recibosApi.upload(installmentId, file);
      const info = await recibosApi.info(installmentId);
      setReciboInfo((prev) => ({ ...prev, [installmentId]: info }));
    } catch (err) {
      alert('Não foi possível anexar o Recibo Verde: ' + err.message);
    } finally {
      setReciboBusy(null);
      pendingUploadId.current = null;
    }
  };

  const handleViewRecibo = async (installmentId) => {
    try {
      await recibosApi.openInNewTab(installmentId);
    } catch (err) {
      alert('Não foi possível abrir o Recibo Verde: ' + err.message);
    }
  };

  const handleRemoveRecibo = async (installmentId) => {
    if (!confirm('Remover o Recibo Verde anexado a esta parcela?')) return;
    setReciboBusy(installmentId);
    try {
      await recibosApi.remove(installmentId);
      setReciboInfo((prev) => ({ ...prev, [installmentId]: { exists: false } }));
    } catch (err) {
      alert('Não foi possível remover: ' + err.message);
    } finally {
      setReciboBusy(null);
    }
  };

  const handleSendRecibo = async (installmentId) => {
    setSendBusy(installmentId);
    try {
      const r = await recibosApi.sendToClient(installmentId);
      if (r.skipped) alert('Envio por email ainda não configurado (falta a chave Resend).');
      else alert('Recibo Verde enviado por email para ' + r.sent_to + '.');
    } catch (err) {
      alert('Não foi possível enviar: ' + err.message);
    } finally {
      setSendBusy(null);
    }
  };

  // ── Procurações: carregar lista de modelos (apenas uma vez)
  useEffect(() => {
    (async () => {
      try { const r = await procApi.listTemplates(); setProcTemplates(r.templates || []); }
      catch (e) { /* silencioso — secção opcional */ }
    })();
  }, []);

  // Referências de processo conhecidas: notas do cliente + eventos do calendário deste cliente
  useEffect(() => {
    if (activeTab !== 'procuracoes' || !data?.client) return;
    (async () => {
      const refs = new Set();
      const m = (data.client.notes || '').match(/Processo:\s*(.+)/i);
      if (m && m[1].trim()) refs.add(m[1].trim());
      try {
        const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const nc = norm(data.client.name).slice(0, 14);
        const r = await calendarApi.getAll();
        (r.events || []).forEach((ev) => {
          if (!ev.case_reference) return;
          const ne = norm(ev.client_name);
          if (ne && nc && (ne.includes(nc) || nc.includes(ne.slice(0, 14)))) refs.add(ev.case_reference.trim());
        });
      } catch (e) { /* opcional */ }
      setProcRefs([...refs]);
    })();
  }, [activeTab, data?.client?.id]);

  // aplicar a referência escolhida ao bloco de poderes (substitui [INDICAR] ou a ref anterior)
  const applyProcessoRef = (ref) => {
    setProcOverrides((prev) => {
      let poderes = prev.poderes || '';
      if (procSelectedRef && poderes.includes(procSelectedRef)) {
        poderes = poderes.replace(procSelectedRef, ref || '[INDICAR]');
      } else if (poderes.includes('[INDICAR]')) {
        poderes = poderes.replace('[INDICAR]', ref || '[INDICAR]');
      } else if (ref) {
        poderes = poderes ? `${poderes} (Processo n.º ${ref}.)` : `Processo n.º ${ref}.`;
      }
      return { ...prev, poderes };
    });
    setProcSelectedRef(ref);
  };

  // Quando muda o modelo escolhido, fazer preview do texto preenchido
  const handleGeneratePlanPdf = async () => {
    setPlanPdfBusy(true);
    setPlanMsg(null);
    try {
      await planosApi.generateOpen(client.id);
    } catch (err) {
      setPlanMsg({ type: 'error', text: err.message || 'Falha ao gerar o PDF.' });
    } finally {
      setPlanPdfBusy(false);
    }
  };

  const handleSendPlan = async () => {
    if (!client.email) {
      setPlanMsg({ type: 'error', text: 'Cliente sem email registado. Adicione um email para enviar o plano.' });
      return;
    }
    if (!window.confirm(`Enviar o plano de pagamento para ${client.email}?`)) return;
    setPlanSendBusy(true);
    setPlanMsg(null);
    try {
      const r = await planosApi.enviar(client.id);
      if (r.skipped) setPlanMsg({ type: 'error', text: `Envio não configurado: ${r.reason}` });
      else setPlanMsg({ type: 'ok', text: `Plano enviado para ${r.sent_to}.` });
    } catch (err) {
      setPlanMsg({ type: 'error', text: err.message || 'Falha no envio.' });
    } finally {
      setPlanSendBusy(false);
    }
  };

  const openEdit = () => {
    setEditError(null);
    setEditForm({
      name: client.name || '',
      emails: parseContacts(client.emails, client.email),
      phones: parseContacts(client.phones, client.phone),
      identification: client.identification || '',
      person_type: client.person_type || 'singular',
      rep_name: client.rep_name || '',
      rep_role: client.rep_role || '',
      rep_nif: client.rep_nif || '',
      rep_nationality: client.rep_nationality || '',
      duns: client.duns || '',
      addrParts: parseAddressParts(client.address_parts, client.address, client.country),
      repAddrParts: parseAddressParts(client.rep_address_parts, client.rep_address, client.country),
      father_name: client.father_name || '',
      mother_name: client.mother_name || '',
      process_summary: client.process_summary || '',
      practice_area: client.practice_area || '',
      address: client.address || '',
      nationality: client.nationality || '',
      marital_status: client.marital_status || '',
      birth_date: client.birth_date || '',
      birth_place: client.birth_place || '',
      doc_type: client.doc_type || '',
      doc_number: client.doc_number || '',
      doc_validity: client.doc_validity || '',
      rg: client.rg || '',
      niss: client.niss || '',
      filiation: client.filiation || '',
      notes: client.notes || '',
      status: client.status || 'active',
    });
    setEditing(true);
  };

  const editField = (key) => (e) => setEditForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { setEditError('O nome é obrigatório.'); return; }
    const emailList = cleanContacts(editForm.emails);
    const phoneList = cleanContacts(editForm.phones);
    setEditBusy(true);
    setEditError(null);
    try {
      const payload = {
        ...editForm,
        emails: JSON.stringify(emailList), phones: JSON.stringify(phoneList),
        email: emailList[0]?.value || '', phone: phoneList[0]?.value || '',
        address: hasAddress(editForm.addrParts) ? composeAddress(editForm.addrParts) : (editForm.address || null),
        address_parts: hasAddress(editForm.addrParts) ? JSON.stringify(editForm.addrParts) : null,
        rep_address: editForm.person_type === 'coletiva' && hasAddress(editForm.repAddrParts) ? composeAddress(editForm.repAddrParts) : null,
        rep_address_parts: editForm.person_type === 'coletiva' && hasAddress(editForm.repAddrParts) ? JSON.stringify(editForm.repAddrParts) : null,
        filiation: [editForm.father_name, editForm.mother_name].filter(Boolean).join(' e ') || editForm.filiation || null,
      };
      delete payload.addrParts;
      delete payload.repAddrParts;
      await clientsApi.update(client.id, payload);
      setEditing(false);
      await loadData();
    } catch (err) {
      setEditError(err.message || 'Falha ao guardar.');
    } finally {
      setEditBusy(false);
    }
  };

  const handlePickTemplate = async (templateId) => {
    setProcTemplateId(templateId);
    setProcOverrides({});
    setProcSelectedRef('');
    setProcText('');
    setProcEditable([]);
    if (!templateId) return;
    setProcBusy(true);
    try {
      const r = await procApi.preview({ template_id: templateId, client_id: clientId });
      setProcText(r.texto || '');
      const fields = r.campos_editaveis || [];
      setProcEditable(fields);
      // pré-preencher cada campo editável com texto sugerido padrão (vazio se o utilizador definir)
      const defaults = {};
      if (fields.includes('poderes')) defaults.poderes = 'poderes para o representar no âmbito do processo n.º [INDICAR] e processos conexos, incluindo a junção de documentos, apresentação de requerimentos, resposta a notificações, interposição de recursos e prática de todos os demais atos processuais necessários à defesa dos seus direitos.';
      setProcOverrides(defaults);
    } catch (e) {
      alert('Erro a carregar modelo: ' + e.message);
    } finally {
      setProcBusy(false);
    }
  };

  const handleGenerateProc = async () => {
    if (!procTemplateId) return;
    setProcBusy(true);
    try {
      await procApi.generateOpen({
        template_id: procTemplateId,
        client_id: clientId,
        overrides: procOverrides,
        local: procLocal,
        data: procData,
      });
    } catch (e) {
      alert('Erro a gerar procuração: ' + e.message);
    } finally {
      setProcBusy(false);
    }
  };

  // ── Documentos: carregar quando se entra no tab
  const loadDocsAndTokens = async () => {
    setTokensLoading(true);
    try {
      const [d, t] = await Promise.all([docsApi.list(clientId), utApi.list(clientId)]);
      setDocs(d.documents || []);
      setTokens(t.tokens || []);
    } catch (e) { /* silencioso */ }
    finally { setTokensLoading(false); }
  };
  useEffect(() => { if (activeTab === 'docs') loadDocsAndTokens(); }, [activeTab, clientId]);

  const handleCreateToken = async () => {
    setTokenBusy(true);
    try {
      const r = await utApi.create({ client_id: clientId, instructions: instructions || null, days: 30 });
      const link = `${window.location.origin}/upload/${r.token}`;
      try { await navigator.clipboard.writeText(link); setCopied(r.token); setTimeout(() => setCopied(null), 2500); } catch {}
      setInstructions('');
      await loadDocsAndTokens();
      alert('Link gerado e copiado para o seu clipboard:\n\n' + link);
    } catch (e) {
      alert('Erro a gerar link: ' + e.message);
    } finally { setTokenBusy(false); }
  };

  const handleCopyLink = async (token) => {
    const link = `${window.location.origin}/upload/${token}`;
    try { await navigator.clipboard.writeText(link); setCopied(token); setTimeout(() => setCopied(null), 2500); } catch { alert(link); }
  };

  const handleRevokeToken = async (token) => {
    if (!confirm('Revogar este link? O cliente deixará de poder enviar documentos por ele.')) return;
    try { await utApi.revoke(token); await loadDocsAndTokens(); }
    catch (e) { alert('Erro: ' + e.message); }
  };

  const handleRemoveDoc = async (docId, filename) => {
    if (!confirm(`Apagar "${filename}"? Esta ação é irreversível.`)) return;
    try { await docsApi.remove(docId); await loadDocsAndTokens(); }
    catch (e) { alert('Erro: ' + e.message); }
  };

  if (loading) return <div className="adm-empty" style={{ padding: '3rem' }}>A carregar cliente…</div>;
  if (error) return <div className="adm-login-error">{error}</div>;
  if (!data?.client) {
    return <div className="adm-empty">Cliente não encontrado. <Link to="/admin/clientes">Voltar à lista</Link></div>;
  }

  const client = data.client;
  const installments = (data.installments || []).slice().sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const paid = installments.filter((i) => i.status === 'paid');
  const pending = installments.filter((i) => i.status !== 'paid');

  const initials = (client.name || '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const isMonthly = !client.honorarios_total || client.honorarios_total === 0;
  const currency = client.country === 'BR' ? 'BRL' : 'EUR';

  let summary;
  if (!isMonthly) {
    const totalPaid = paid.reduce((s, i) => s + Number(i.amount), 0);
    const totalRemaining = pending.reduce((s, i) => s + Number(i.amount), 0);
    summary = {
      contracted: client.honorarios_total,
      paid: totalPaid,
      remaining: totalRemaining,
      progress: `${paid.length} de ${client.honorarios_parcelas}`,
    };
  } else {
    const monthlyValue = installments[0]?.amount || 0;
    const startDate = client.contract_start_date ? new Date(client.contract_start_date) : new Date();
    const monthsActive = Math.max(1, Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24 * 30)));
    summary = {
      monthlyValue,
      paid: paid.reduce((s, i) => s + Number(i.amount), 0),
      progress: `${monthsActive} meses ativo`,
    };
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
      />

      {editing && editForm && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget && !editBusy) setEditing(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 640, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 1.25rem', fontFamily: 'var(--serif)' }}>Editar cliente</h2>

            {/* Logo do cliente — badge da câmara fora do círculo (não é cortado) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
              <div
                onClick={() => !logoBusy && logoInputRef.current && logoInputRef.current.click()}
                title={logoUrl ? 'Clique para substituir a logo' : 'Clique para adicionar a logo do cliente'}
                style={{ position: 'relative', cursor: 'pointer', width: 72, height: 72, flexShrink: 0 }}
              >
                <div style={{
                  width: 64, height: 64, borderRadius: '50%', overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, color: '#fff', fontSize: '1.1rem',
                  background: logoUrl
                    ? 'radial-gradient(circle at 32% 26%, #3a7a63 0%, #26594a 55%, #1b453a 100%)'
                    : 'var(--gold, #b8935a)',
                  boxShadow: logoUrl ? 'inset 0 2px 5px rgba(255,255,255,0.28), inset 0 -3px 7px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.25)' : '0 4px 12px rgba(0,0,0,0.15)',
                  border: logoUrl ? '1px solid rgba(184,147,90,0.4)' : 'none',
                }}>
                  {logoUrl
                    ? <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '7%', boxSizing: 'border-box' }} />
                    : (initials || 'C')}
                </div>
                <span style={{
                  position: 'absolute', bottom: 2, right: 2,
                  background: 'var(--forest, #12302a)', color: '#fff', borderRadius: '50%',
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid var(--bg, #faf8f4)', boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}><IconCamera size={12} /></span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}>Logo / fotografia do cliente</div>
                {logoBusy ? 'A carregar…' : 'Clique no círculo para carregar ou substituir (PNG, JPEG, WEBP, SVG · máx. 2 MB).'}
                {client.logo_key && !logoBusy && (
                  <> <a href="#" onClick={(e) => { e.preventDefault(); handleLogoRemove(); }} style={{ color: '#b00' }}>Remover logo</a></>
                )}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
              <label className="adm-field">
                <span>Tipo de cliente</span>
                <select value={editForm.person_type} onChange={editField('person_type')} disabled={editBusy}>
                  <option value="singular">Pessoa singular</option>
                  <option value="coletiva">Pessoa coletiva (empresa)</option>
                </select>
              </label>
              <label className="adm-field">
                <span>Área de atuação</span>
                <select value={editForm.practice_area} onChange={editField('practice_area')} disabled={editBusy}>
                  <option value="">—</option>
                  <option value="Família">Família</option>
                  <option value="Cível">Cível</option>
                  <option value="Trabalhista">Trabalhista</option>
                  <option value="Empresarial">Empresarial</option>
                  <option value="Nacionalidade">Nacionalidade</option>
                </select>
              </label>

              <div style={{ gridColumn: '1 / -1', fontWeight: 600, color: 'var(--forest, #12302a)', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '0.3rem', marginTop: '0.3rem' }}>
                {editForm.person_type === 'coletiva' ? 'Dados da empresa' : 'Dados pessoais'}
              </div>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>{editForm.person_type === 'coletiva' ? 'Denominação da empresa *' : 'Nome *'}</span>
                <input type="text" value={editForm.name} onChange={editField('name')} disabled={editBusy} />
              </label>
              <label className="adm-field"><span>{editForm.person_type === 'coletiva' ? (client.country === 'BR' ? 'CNPJ' : 'NIFC') : (client.country === 'BR' ? 'CPF' : 'NIF')}</span><input type="text" value={editForm.identification} onChange={editField('identification')} disabled={editBusy} /></label>
              {editForm.person_type === 'coletiva' ? (
                <label className="adm-field"><span>DUNS</span><input type="text" value={editForm.duns} onChange={editField('duns')} disabled={editBusy} /></label>
              ) : (
                <label className="adm-field"><span>Nacionalidade</span><input type="text" value={editForm.nationality} onChange={editField('nationality')} disabled={editBusy} /></label>
              )}
              {editForm.person_type === 'coletiva' && (
                <label className="adm-field"><span>Nacionalidade da empresa</span><input type="text" value={editForm.nationality} onChange={editField('nationality')} disabled={editBusy} /></label>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <ContactsEditor kind="email" items={editForm.emails} onChange={(v) => setEditForm((f) => ({ ...f, emails: v }))} disabled={editBusy} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <ContactsEditor kind="phone" items={editForm.phones} onChange={(v) => setEditForm((f) => ({ ...f, phones: v }))} disabled={editBusy} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <AddressEditor
                  label={editForm.person_type === 'coletiva' ? 'Sede da empresa' : 'Morada'}
                  value={editForm.addrParts}
                  onChange={(v) => setEditForm((f) => ({ ...f, addrParts: v }))}
                  disabled={editBusy}
                />
              </div>

              {editForm.person_type === 'coletiva' && (
                <div style={{ gridColumn: '1 / -1', fontWeight: 600, color: 'var(--forest, #12302a)', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '0.3rem', marginTop: '0.3rem' }}>
                  Dados do responsável
                </div>
              )}
              {editForm.person_type === 'coletiva' && (
                <>
                  <label className="adm-field"><span>Nome do responsável</span><input type="text" value={editForm.rep_name} onChange={editField('rep_name')} disabled={editBusy} /></label>
                  <label className="adm-field"><span>Cargo</span><input type="text" value={editForm.rep_role} onChange={editField('rep_role')} disabled={editBusy} /></label>
                  <label className="adm-field"><span>{client.country === 'BR' ? 'CPF do responsável' : 'NIF do responsável'}</span><input type="text" value={editForm.rep_nif} onChange={editField('rep_nif')} disabled={editBusy} /></label>
                  <label className="adm-field"><span>Nacionalidade do responsável</span><input type="text" value={editForm.rep_nationality} onChange={editField('rep_nationality')} disabled={editBusy} /></label>
                </>
              )}
              <label className="adm-field"><span>Estado civil</span>
                <select value={editForm.marital_status} onChange={editField('marital_status')} disabled={editBusy}>
                  <option value="">—</option>
                  <option value="solteiro(a)">Solteiro(a)</option>
                  <option value="casado(a)">Casado(a)</option>
                  <option value="divorciado(a)">Divorciado(a)</option>
                  <option value="viúvo(a)">Viúvo(a)</option>
                  <option value="união estável">União estável / convivente</option>
                </select>
              </label>
              <label className="adm-field"><span>Data de nascimento</span><input type="date" value={editForm.birth_date} onChange={editField('birth_date')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Naturalidade</span><input type="text" value={editForm.birth_place} onChange={editField('birth_place')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Tipo de documento</span><input type="text" value={editForm.doc_type} onChange={editField('doc_type')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Nº do documento</span><input type="text" value={editForm.doc_number} onChange={editField('doc_number')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Validade do documento</span><input type="date" value={editForm.doc_validity} onChange={editField('doc_validity')} disabled={editBusy} /></label>
              {client.country === 'BR'
                ? <label className="adm-field"><span>RG</span><input type="text" value={editForm.rg} onChange={editField('rg')} disabled={editBusy} /></label>
                : <label className="adm-field"><span>NISS</span><input type="text" value={editForm.niss} onChange={editField('niss')} disabled={editBusy} /></label>}
              <label className="adm-field"><span>Pai</span><input type="text" value={editForm.father_name} onChange={editField('father_name')} disabled={editBusy} placeholder="Nome do pai" /></label>
              <label className="adm-field"><span>Mãe</span><input type="text" value={editForm.mother_name} onChange={editField('mother_name')} disabled={editBusy} placeholder="Nome da mãe" /></label>
              {editForm.person_type === 'coletiva' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <AddressEditor
                    label="Morada do responsável"
                    value={editForm.repAddrParts}
                    onChange={(v) => setEditForm((f) => ({ ...f, repAddrParts: v }))}
                    disabled={editBusy}
                  />
                </div>
              )}

              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Estado</span>
                <select value={editForm.status} onChange={editField('status')} disabled={editBusy}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Resumo do processo</span>
                <textarea rows={6} value={editForm.process_summary} onChange={editField('process_summary')} disabled={editBusy} placeholder="Resumo gerado pela IA no cadastro — editável" />
              </label>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Notas</span>
                <textarea rows={3} value={editForm.notes} onChange={editField('notes')} disabled={editBusy} />
              </label>
            </div>
            {editError && <div className="adm-login-error" style={{ marginTop: '1rem' }}>{editError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="adm-btn" onClick={() => setEditing(false)} disabled={editBusy}>Cancelar</button>
              <button className="adm-btn adm-btn-gold" onClick={handleSaveEdit} disabled={editBusy}>
                {editBusy ? 'A guardar…' : 'Guardar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleLogoChosen} />
      <div className="adm-client-head">
        <div
          className="adm-client-avatar"
          style={{
            overflow: 'hidden',
            ...(logoUrl ? {
              // verde mais claro que o cabeçalho + efeito 3D (relevo côncavo com brilho superior)
              background: 'radial-gradient(circle at 32% 26%, #3a7a63 0%, #26594a 55%, #1b453a 100%)',
              padding: 0,
              boxShadow: 'inset 0 3px 7px rgba(255,255,255,0.28), inset 0 -4px 9px rgba(0,0,0,0.4), 0 6px 16px rgba(0,0,0,0.35)',
              border: '1px solid rgba(213,177,124,0.35)',
            } : {}),
          }}
        >
          {logoUrl ? (
            // object-fit: contain — a logo (mesmo retangular) aparece INTEIRA, com respiro reduzido
            <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '7%', boxSizing: 'border-box', borderRadius: '50%', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))' }} />
          ) : (
            initials || 'C'
          )}
        </div>
        <div>
          <h1>{client.name}</h1>
          <div className="adm-client-meta">
            {parseContacts(client.phones, client.phone).filter((c) => c.value).map((c, i) => (
              <span key={'p' + i}><IconPhone /> {c.value}{c.label && c.label !== 'Pessoal' ? ` (${c.label})` : ''}</span>
            ))}
            {parseContacts(client.emails, client.email).filter((c) => c.value).map((c, i) => (
              <span key={'e' + i}>✉ {c.value}{c.label && c.label !== 'Pessoal' ? ` (${c.label})` : ''}</span>
            ))}
            {client.identification && (
              <span>{client.person_type === 'coletiva' ? (client.country === 'BR' ? 'CNPJ' : 'NIPC') : (client.country === 'BR' ? 'CPF' : 'NIF')} {client.identification}</span>
            )}
            {client.person_type === 'coletiva' && client.duns && <span>DUNS {client.duns}</span>}
          </div>
          <div className="adm-client-meta" style={{ marginTop: '0.4rem' }}>
            <span>{client.practice_area || '—'} · {client.country}</span>
            {client.person_type === 'coletiva' && (
              <span><IconBuilding /> Pessoa coletiva{client.rep_name ? ` · Rep.: ${client.rep_name}${client.rep_role ? ` (${client.rep_role})` : ''}` : ''}</span>
            )}
          </div>
        </div>
        <div className="adm-client-actions">
          <button onClick={openEdit}>Editar</button>
          <button className="primary" onClick={() => alert('Registo de pagamento avulso — em desenvolvimento')}>+ Pagamento</button>
        </div>
      </div>

      <input ref={aiFileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) aiExtractFile(f); e.target.value = ''; }} />
      <div
        onDragOver={(e) => { e.preventDefault(); setAiDragOver(true); }}
        onDragLeave={() => setAiDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setAiDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) aiExtractFile(f); }}
        onClick={() => !aiBusy && aiFileRef.current && aiFileRef.current.click()}
        style={{
          border: `2px dashed ${aiDragOver ? 'var(--gold, #b8935a)' : 'rgba(0,0,0,0.15)'}`,
          background: aiDragOver ? 'rgba(184,147,90,0.08)' : 'var(--cream, #f5f0e8)',
          borderRadius: 8,
          padding: '0.7rem 1rem',
          textAlign: 'center',
          cursor: aiBusy ? 'wait' : 'pointer',
          margin: '1rem 0',
          opacity: aiBusy ? 0.7 : 1,
          fontSize: '0.85rem',
          color: 'var(--muted, #666)',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}><IconDoc /> Ler mais documentos com IA</span>
        {' — arraste (ou clique) para completar campos vazios, acrescentar contactos e atualizar o resumo do processo.'}
        {aiMsg && (
          <div style={{
            marginTop: '0.5rem', padding: '0.4rem 0.75rem', borderRadius: 4, display: 'inline-block',
            background: aiMsg.kind === 'ok' ? 'rgba(34,134,58,0.10)' : aiMsg.kind === 'err' ? 'rgba(176,0,0,0.10)' : 'rgba(0,0,0,0.06)',
            color: aiMsg.kind === 'ok' ? '#1f6b32' : aiMsg.kind === 'err' ? '#b00' : 'var(--ink, #333)',
          }}>
            {aiMsg.text}
          </div>
        )}
      </div>

      <div className="adm-tabs">
        {[
          { id: 'plan', label: 'Plano de pagamento' },
          { id: 'summary', label: 'Resumo' },
          { id: 'comms', label: 'Comunicações' },
          { id: 'docs', label: 'Documentos' },
          { id: 'procuracoes', label: 'Procurações' },
          { id: 'notes', label: 'Notas' },
        ].map((t) => (
          <button
            key={t.id}
            className={'adm-tab' + (activeTab === t.id ? ' active' : '')}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'plan' && (
        <>
          <div className="adm-plan-actions">
            <button
              className="adm-btn"
              onClick={handleGeneratePlanPdf}
              disabled={planPdfBusy || installments.length === 0}
            >
              {planPdfBusy ? 'A gerar…' : <><IconDoc /> Gerar PDF</>}
            </button>
            <button
              className="adm-btn adm-btn-gold"
              onClick={handleSendPlan}
              disabled={planSendBusy || installments.length === 0}
              title={client.email ? `Enviar para ${client.email}` : 'Cliente sem email'}
            >
              {planSendBusy ? 'A enviar…' : '✉ Enviar ao cliente'}
            </button>
            {planMsg && (
              <span className={planMsg.type === 'ok' ? 'adm-plan-msg-ok' : 'adm-plan-msg-error'}>
                {planMsg.text}
              </span>
            )}
          </div>
          <div className="adm-plan-summary">
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {!isMonthly ? 'Total contratado' : 'Avença mensal'}
              </div>
              <div className="adm-plan-item-value">
                {!isMonthly
                  ? fmtMoney(summary.contracted, currency)
                  : fmtMoney(summary.monthlyValue, currency)}
              </div>
            </div>
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">Já recebido</div>
              <div className="adm-plan-item-value adm-plan-item-value-success">
                {fmtMoney(summary.paid, currency)}
              </div>
            </div>
            {!isMonthly ? (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Em aberto</div>
                <div className="adm-plan-item-value adm-plan-item-value-warn">
                  {fmtMoney(summary.remaining, currency)}
                </div>
              </div>
            ) : (
              <div className="adm-plan-item">
                <div className="adm-plan-item-label">Início da avença</div>
                <div className="adm-plan-item-value">{fmtDate(client.contract_start_date)}</div>
              </div>
            )}
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {!isMonthly ? 'Progresso' : 'Tempo ativo'}
              </div>
              <div className="adm-plan-item-value">{summary.progress}</div>
            </div>
          </div>

          <table className="adm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Vencimento</th>
                <th className="adm-text-right">Valor</th>
                <th>Pago em</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => {
                const isToday = i.status === 'due_today';
                const isTomorrow = !isToday && i.status !== 'paid' && daysUntil(i.due_date) === 1;
                const highlight = isToday || isTomorrow;
                return (
                  <tr key={i.id} className={highlight ? 'adm-row-highlight' : ''}>
                    <td>{i.installment_number}/{i.total_installments}</td>
                    <td><strong>{fmtDate(i.due_date)}</strong></td>
                    <td className="adm-text-right adm-val">{fmtMoney(i.amount, i.currency)}</td>
                    <td>{i.paid_date ? fmtDate(i.paid_date) : '—'}</td>
                    <td><StatusBadge installment={i} /></td>
                    <td>
                      {i.status === 'paid' ? (
                        <>
                          {reciboInfo[i.id]?.exists ? (
                            <>
                              <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); handleViewRecibo(i.id); }}>
                                Ver RV
                              </a>
                              <a href="#" style={{ fontSize: '0.75rem', marginLeft: '0.75rem' }} onClick={(e) => { e.preventDefault(); if (reciboBusy !== i.id) triggerAttach(i.id); }}>
                                {reciboBusy === i.id ? 'A processar…' : 'Substituir'}
                              </a>
                              <a href="#" style={{ fontSize: '0.75rem', marginLeft: '0.75rem' }} onClick={(e) => { e.preventDefault(); if (sendBusy !== i.id) handleSendRecibo(i.id); }}>
                                {sendBusy === i.id ? 'A enviar…' : 'Enviar'}
                              </a>
                              <a href="#" style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--late, #b00)' }} onClick={(e) => { e.preventDefault(); if (reciboBusy !== i.id) handleRemoveRecibo(i.id); }}>
                                Remover
                              </a>
                            </>
                          ) : (
                            <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); if (reciboBusy !== i.id) triggerAttach(i.id); }}>
                              {reciboBusy === i.id ? 'A anexar…' : '+ Anexar Recibo Verde'}
                            </a>
                          )}
                        </>
                      ) : (
                        <a
                          href="#"
                          style={{ fontSize: '0.75rem' }}
                          onClick={(e) => { e.preventDefault(); handleMarkPaid(i.id); }}
                        >
                          {markingPaid === i.id ? 'A marcar…' : 'Marcar pago'}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {activeTab === 'summary' && (
        <div className="adm-card">
          <div className="adm-card-title">Resumo</div>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>{client.name}</strong> é cliente desde {fmtDate(client.contract_start_date)},
            na área de <strong>{client.practice_area || 'geral'}</strong>.
          </p>
          <p>
            Plano contratado: {isMonthly
              ? `avença mensal de ${fmtMoney(summary.monthlyValue, currency)}`
              : `parcelado em ${client.honorarios_parcelas} prestações (total ${fmtMoney(client.honorarios_total, currency)})`}.
          </p>
          {data.rules?.length > 0 && (
            <p>
              Lembretes configurados: {data.rules.map(r => `${r.days_before}d antes via ${r.channel}`).join(', ')}.
            </p>
          )}
          {client.process_summary && (
            <>
              <div className="adm-card-title" style={{ marginTop: '1.5rem' }}>Resumo do processo</div>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{client.process_summary}</p>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                Gerado pela IA a partir dos documentos do cadastro · editável em "Editar"
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'comms' && (
        <div className="adm-empty">Histórico de comunicações — em desenvolvimento.</div>
      )}

      {activeTab === 'docs' && (
        <div className="adm-card">
          <div className="adm-card-title">Documentos do cliente</div>

          {/* Gerar link para o cliente enviar */}
          <div style={{ background: 'var(--cream, #f5f0e8)', padding: '1rem', borderRadius: 6, marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)', marginBottom: '0.5rem' }}>
              <IconUpload /> Pedir documentos ao cliente
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
              Gere um link único e envie por WhatsApp ou e-mail. O cliente arrasta os ficheiros sem precisar de login.
            </p>
            <div className="adm-field">
              <label>Instruções (opcional)</label>
              <textarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Ex.: Enviar passaporte, comprovativo de morada e declaração da Segurança Social."
                disabled={tokenBusy}
                style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.9rem', padding: '0.5rem' }}
              />
            </div>
            <button className="adm-btn adm-btn-gold" onClick={handleCreateToken} disabled={tokenBusy}>
              {tokenBusy ? 'A gerar…' : 'Gerar link (válido 30 dias)'}
            </button>
          </div>

          {/* Lista de links ativos */}
          {tokens.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', letterSpacing: 1, color: 'var(--gold, #b8935a)', fontWeight: 700, marginBottom: '0.5rem' }}>LINKS ATIVOS</div>
              <table className="adm-table">
                <thead><tr><th>Criado</th><th>Expira</th><th>Usos</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {tokens.map((t) => {
                    const expired = new Date(t.expires_at) < new Date();
                    const status = t.revoked ? 'Revogado' : expired ? 'Expirado' : 'Ativo';
                    return (
                      <tr key={t.token}>
                        <td>{new Date(t.created_at).toLocaleDateString('pt-PT')}</td>
                        <td>{new Date(t.expires_at).toLocaleDateString('pt-PT')}</td>
                        <td>{t.used_count}</td>
                        <td>{status}</td>
                        <td style={{ textAlign: 'right' }}>
                          {!t.revoked && !expired && (
                            <>
                              <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); handleCopyLink(t.token); }}>
                                {copied === t.token ? '✓ Copiado' : 'Copiar link'}
                              </a>
                              <a href="#" style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: '#b00' }} onClick={(e) => { e.preventDefault(); handleRevokeToken(t.token); }}>Revogar</a>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Lista de documentos enviados */}
          <div style={{ fontSize: '0.8rem', letterSpacing: 1, color: 'var(--gold, #b8935a)', fontWeight: 700, marginBottom: '0.5rem' }}>DOCUMENTOS ENVIADOS</div>
          {tokensLoading ? (
            <div className="adm-empty">A carregar…</div>
          ) : docs.length === 0 ? (
            <div className="adm-empty">Sem documentos enviados.</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>Ficheiro</th><th>Tipo</th><th>Tamanho</th><th>Enviado</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.filename}</td>
                    <td><small style={{ color: 'var(--muted)' }}>{d.content_type}</small></td>
                    <td>{(d.size_bytes / 1024).toFixed(0)} KB</td>
                    <td>{new Date(d.uploaded_at).toLocaleString('pt-PT')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); docsApi.openInNewTab(d.id).catch((err) => alert(err.message)); }}>Abrir</a>
                      <a href="#" style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: '#b00' }} onClick={(e) => { e.preventDefault(); handleRemoveDoc(d.id, d.filename); }}>Remover</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'procuracoes' && (
        <div className="adm-card">
          <div className="adm-card-title">Gerar procuração</div>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0 }}>
            Os dados do cliente são preenchidos automaticamente a partir do cadastro.
            Os blocos editáveis (ex.: <em>poderes</em>) vêm sugeridos — ajuste-os antes de gerar.
          </p>

          <div className="adm-field" style={{ maxWidth: 520 }}>
            <label>Modelo de procuração</label>
            <select value={procTemplateId} onChange={(e) => handlePickTemplate(e.target.value)} disabled={procBusy}>
              <option value="">— selecionar —</option>
              {procTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.categoria ? `[${t.categoria}] ` : ''}{t.nome}</option>
              ))}
            </select>
          </div>

          {procTemplateId && (
            <>
              {procEditable.includes('poderes') && (
                <div className="adm-field" style={{ maxWidth: 520 }}>
                  <label>Processo</label>
                  <select value={procSelectedRef} onChange={(e) => applyProcessoRef(e.target.value)} disabled={procBusy}>
                    <option value="">— digitar manualmente no texto —</option>
                    {procRefs.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <div className="adm-field-helper">
                    Referências vindas das notas do cliente e dos eventos do calendário. Ao escolher, substitui o [INDICAR] nos poderes.
                  </div>
                </div>
              )}
              {procEditable.includes('poderes') && (
                <div className="adm-field">
                  <label>Poderes específicos (editável)</label>
                  <textarea
                    rows={5}
                    value={procOverrides.poderes || ''}
                    onChange={(e) => setProcOverrides({ ...procOverrides, poderes: e.target.value })}
                    disabled={procBusy}
                    style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.9rem', padding: '0.6rem' }}
                  />
                </div>
              )}

              <div className="adm-field-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="adm-field" style={{ flex: 1, minWidth: 200 }}>
                  <label>Local de emissão</label>
                  <input type="text" value={procLocal} onChange={(e) => setProcLocal(e.target.value)} disabled={procBusy} />
                </div>
                <div className="adm-field" style={{ flex: 1, minWidth: 200 }}>
                  <label>Data</label>
                  <input type="date" value={procData} onChange={(e) => setProcData(e.target.value)} disabled={procBusy} />
                </div>
              </div>

              <details style={{ margin: '1rem 0', fontSize: '0.85rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Ver texto preenchido (preview)</summary>
                <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--cream, #f5f0e8)', padding: '0.8rem', borderRadius: 4, marginTop: '0.5rem', fontSize: '0.85rem', fontFamily: 'inherit' }}>
                  {procText}
                </pre>
              </details>

              <button
                className="adm-btn adm-btn-gold"
                onClick={handleGenerateProc}
                disabled={procBusy}
                style={{ marginTop: '0.5rem' }}
              >
                {procBusy ? 'A gerar…' : 'Gerar PDF'}
              </button>

              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
                Campos em falta no cadastro aparecerão como <code>[•]</code> no documento. Para os preencher, edite o cliente.
              </p>
            </>
          )}
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="adm-card">
          <div className="adm-card-title">Notas</div>
          <p style={{ fontStyle: client.notes ? 'normal' : 'italic', color: client.notes ? 'var(--ink)' : 'var(--muted)' }}>
            {client.notes || 'Sem notas registadas para este cliente.'}
          </p>
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <Link to="/admin/clientes" className="adm-btn adm-btn-ghost adm-btn-sm">
          ← Voltar à lista
        </Link>
      </div>
    </>
  );
}


