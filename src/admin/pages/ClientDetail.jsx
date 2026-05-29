// src/admin/pages/ClientDetail.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { clients as clientsApi, installments as installmentsApi, recibos as recibosApi, procuracoes as procApi, planos as planosApi, uploadTokens as utApi, clientDocs as docsApi } from '../apiClient';

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
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const fileInputRef = React.useRef(null);
  const pendingUploadId = React.useRef(null);

  // ── Procurações
  const [procTemplates, setProcTemplates] = useState([]);
  const [procTemplateId, setProcTemplateId] = useState('');
  const [procText, setProcText] = useState('');
  const [procEditable, setProcEditable] = useState([]);   // ['poderes', ...]
  const [procOverrides, setProcOverrides] = useState({}); // { poderes: '...' }
  const [procLocal, setProcLocal] = useState('Santa Maria da Feira');
  const [procData, setProcData] = useState(new Date().toISOString().slice(0, 10));
  const [procBusy, setProcBusy] = useState(false);

  // ── Documentos do cliente / link de upload
  const [docs, setDocs] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState(null);

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
      email: client.email || '',
      phone: client.phone || '',
      identification: client.identification || '',
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
    setEditBusy(true);
    setEditError(null);
    try {
      await clientsApi.update(client.id, editForm);
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
          onClick={(e) => { if (e.target === e.currentTarget && !editBusy) setEditing(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 640, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 1.25rem', fontFamily: 'var(--serif)' }}>Editar cliente</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Nome *</span>
                <input type="text" value={editForm.name} onChange={editField('name')} disabled={editBusy} />
              </label>
              <label className="adm-field"><span>Email</span><input type="email" value={editForm.email} onChange={editField('email')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Telefone</span><input type="tel" value={editForm.phone} onChange={editField('phone')} disabled={editBusy} /></label>
              <label className="adm-field"><span>{client.country === 'BR' ? 'CPF/CNPJ' : 'NIF'}</span><input type="text" value={editForm.identification} onChange={editField('identification')} disabled={editBusy} /></label>
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
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}><span>Morada</span><input type="text" value={editForm.address} onChange={editField('address')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Nacionalidade</span><input type="text" value={editForm.nationality} onChange={editField('nationality')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Estado civil</span><input type="text" value={editForm.marital_status} onChange={editField('marital_status')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Data de nascimento</span><input type="date" value={editForm.birth_date} onChange={editField('birth_date')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Naturalidade</span><input type="text" value={editForm.birth_place} onChange={editField('birth_place')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Tipo de documento</span><input type="text" value={editForm.doc_type} onChange={editField('doc_type')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Nº do documento</span><input type="text" value={editForm.doc_number} onChange={editField('doc_number')} disabled={editBusy} /></label>
              <label className="adm-field"><span>Validade do documento</span><input type="date" value={editForm.doc_validity} onChange={editField('doc_validity')} disabled={editBusy} /></label>
              {client.country === 'BR'
                ? <label className="adm-field"><span>RG</span><input type="text" value={editForm.rg} onChange={editField('rg')} disabled={editBusy} /></label>
                : <label className="adm-field"><span>NISS</span><input type="text" value={editForm.niss} onChange={editField('niss')} disabled={editBusy} /></label>}
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}><span>Filiação</span><input type="text" value={editForm.filiation} onChange={editField('filiation')} disabled={editBusy} /></label>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Estado</span>
                <select value={editForm.status} onChange={editField('status')} disabled={editBusy}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
              <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span>Notas privadas</span>
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
      <div className="adm-client-head">
        <div className="adm-client-avatar">{initials || 'C'}</div>
        <div>
          <h1>{client.name}</h1>
          <div className="adm-client-meta">
            {client.phone && <span>📞 {client.phone}</span>}
            {client.email && <span>✉ {client.email}</span>}
            {client.identification && (
              <span>{client.country === 'BR' ? 'CPF/CNPJ' : 'NIF'} {client.identification}</span>
            )}
          </div>
          <div className="adm-client-meta" style={{ marginTop: '0.4rem' }}>
            <span>{client.practice_area || '—'} · {client.country}</span>
          </div>
        </div>
        <div className="adm-client-actions">
          <button onClick={openEdit}>Editar</button>
          <button className="primary" onClick={() => alert('Registo de pagamento avulso — em desenvolvimento')}>+ Pagamento</button>
        </div>
      </div>

      <div className="adm-tabs">
        {[
          { id: 'plan', label: 'Plano de pagamento' },
          { id: 'summary', label: 'Resumo' },
          { id: 'comms', label: 'Comunicações' },
          { id: 'docs', label: 'Documentos' },
          { id: 'procuracoes', label: 'Procurações' },
          { id: 'notes', label: 'Notas privadas' },
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
              {planPdfBusy ? 'A gerar…' : '📄 Gerar PDF'}
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
              📤 Pedir documentos ao cliente
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
          <div className="adm-card-title">Notas privadas</div>
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


