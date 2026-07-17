// src/admin/pages/ClientDetail.jsx
import LerIAModal from '../ler-ia-modal.jsx';
import React, { useState, useEffect, useRef } from 'react';
import ContactsEditor, { parseContacts, cleanContacts } from '../ContactsEditor';
import ParcelasEditor, { gerarParcelas, somaParcelas, parseValor, fmtValor } from '../ParcelasEditor';
import { MoneyInput, StepperInput } from '../inputs';
import SlidingTabs from '../tabs';
import { admToast } from '../toasts';
import DateInput from '../datepicker';
import { IconMail, IconGear } from '../icons';
import { SkeletonPage } from '../skeletons';
import AddressEditor, { EMPTY_ADDRESS, composeAddress, hasAddress, parseAddressParts } from '../AddressEditor';
import PersonFields, { PersonPills, EMPTY_PERSON, personFromRow, personHasData } from '../PersonFields';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ModalClose from '../modal-close.jsx';
import PeoplePicker from '../people-picker.jsx';
import { clients as clientsApi, installments as installmentsApi, recibos as recibosApi, procuracoes as procApi, planos as planosApi, uploadTokens as utApi, clientDocs as docsApi, clientLogo, calendar as calendarApi, notifications as notifApi } from '../apiClient';
import { IconPhone, IconBuilding, IconCamera, IconDoc, IconUpload } from '../icons';
import { admAlert, admConfirm } from '../dialogs';

function fmtMoney(amount, currency = 'EUR') {
  const symbol = currency === 'BRL' ? 'R$' : '€';
  const n = Number(amount || 0);
  return symbol + '\u00A0' + n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Documentos anexáveis por parcela (botões Emitir/Ver na tabela do plano)
const DOC_TIPOS = [
  ['fatura', 'Fatura'],
  ['recibo', 'Recibo'],
  ['fatura-recibo', 'Fatura-Recibo'],
];

function addMonthsStr(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function fmtDocStamp(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) + ' - ' +
         d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
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

function StatusBadge({ installment, onUnmark }) {
  if (installment.status === 'paid') {
    if (!onUnmark) return <span className="adm-badge adm-badge-paid">Pago</span>;
    // clicável: permite desmarcar um "pago" indevido (volta a pendente)
    return (
      <span
        className="adm-badge adm-badge-paid"
        role="button"
        tabIndex={0}
        data-tip="Clique para desmarcar — a parcela volta a pendente (os documentos mantêm-se)"
        style={{ cursor: 'pointer' }}
        onClick={() => onUnmark(installment)}
        onKeyDown={(e) => { if (e.key === 'Enter') onUnmark(installment); }}
      >
        Pago
      </span>
    );
  }
  if (installment.status === 'late') {
    const days = Math.abs(daysUntil(installment.due_date));
    return <span className="adm-badge adm-badge-late">{days}d atraso</span>;
  }
  if (installment.status === 'due_today') return <span className="adm-badge adm-badge-warn">Hoje</span>;
  const days = daysUntil(installment.due_date);
  if (days === 1) return <span className="adm-badge adm-badge-warn">Amanhã</span>;
  return <span className="adm-badge adm-badge-pending">Pendente</span>;
}

// Processos do cliente: abas laterais com o nº do processo; painel com área e resumo.
// Lê a lista JSON (client.processes); clientes antigos caem no processo único legado.
function ProcessosCard({ client }) {
  const [active, setActive] = React.useState(0);
  let processos = [];
  try { processos = JSON.parse(client.processes || 'null') || []; } catch { processos = []; }
  if (!processos.length) {
    const m = (client.notes || '').match(/Processo:\s*(.+)/);
    if (client.process_summary || m || client.practice_area) {
      processos = [{ ref: m ? m[1].trim() : '', area: client.practice_area || '', resumo: client.process_summary || '' }];
    }
  }
  if (!processos.length) return null;
  const sel = processos[Math.min(active, processos.length - 1)];
  return (
    <>
      <div className="adm-card-title" style={{ marginTop: '1.5rem' }}>
        {processos.length > 1 ? 'Processos' : 'Processo'}
      </div>
      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'stretch' }}>
        {/* Abas laterais com o número/referência de cada processo */}
        <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: '0.35rem', borderRight: '1px solid rgba(0,0,0,0.1)', paddingRight: '1rem' }}>
          {processos.map((p, idx) => {
            const isActive = idx === Math.min(active, processos.length - 1);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setActive(idx)}
                style={{
                  textAlign: 'left', cursor: 'pointer', borderRadius: 6, padding: '0.55rem 0.7rem',
                  border: isActive ? '1px solid var(--gold, #b8935a)' : '1px solid transparent',
                  borderLeft: isActive ? '3px solid var(--gold, #b8935a)' : '3px solid transparent',
                  background: isActive ? 'rgba(184,147,90,0.10)' : 'none',
                  fontFamily: 'var(--sans)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--forest, #12302a)', overflowWrap: 'anywhere' }}>
                  {p.ref || `Processo ${idx + 1}`}
                </div>
                {p.area && <div style={{ fontSize: '0.7rem', color: 'var(--muted, #777)', marginTop: 2 }}>{p.area}</div>}
              </button>
            );
          })}
        </div>
        {/* Painel do processo selecionado */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
            {sel.ref && (
              <div>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #777)' }}>Processo</div>
                <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}>{sel.ref}</div>
              </div>
            )}
            {sel.area && (
              <div>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #777)' }}>Área</div>
                <div style={{ fontWeight: 600, color: 'var(--forest, #12302a)' }}>{sel.area}</div>
              </div>
            )}
          </div>
          {sel.resumo ? (
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, margin: 0 }}>{sel.resumo}</p>
          ) : (
            <div className="adm-empty" style={{ padding: '1rem 0' }}>Sem resumo para este processo.</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const [activeTab, setActiveTab] = useState('plan');
  const [data, setData] = useState(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const dataRef = useRef(null);
  dataRef.current = data;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingPaid, setMarkingPaid] = useState(null);
  const [reciboInfo, setReciboInfo] = useState({}); // { installmentId: {exists, filename} }
  const [planEdit, setPlanEdit] = useState(false);   // modal "Editar plano"
  const [planForm, setPlanForm] = useState(null);
  const [planSaveBusy, setPlanSaveBusy] = useState(false);
  const [reciboBusy, setReciboBusy] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // "instId|tipo" do botão Anexar sob drag
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
  const [editPerson, setEditPerson] = useState(0); // 0 = titular; 1.. = editForm.people[i-1]
  const fileInputRef = React.useRef(null);
  const pendingUploadId = React.useRef(null);
  const logoInputRef = React.useRef(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);

  // ── Procurações
  const [procTemplates, setProcTemplates] = useState([]);
  const [planPeopleSel, setPlanPeopleSel] = useState(null); // null = todos os titulares
  const [procPersonId, setProcPersonId] = useState('');     // '' = titular
  const [procTemplateId, setProcTemplateId] = useState('');
  const [procText, setProcText] = useState('');
  const [procEditable, setProcEditable] = useState([]);   // ['poderes', ...]
  const [procOverrides, setProcOverrides] = useState({}); // { poderes: '...' }
  const [procLocal, setProcLocal] = useState('Santa Maria da Feira');
  const [procData, setProcData] = useState(new Date().toISOString().slice(0, 10));
  const [procBusy, setProcBusy] = useState(false);
  const [procRefs, setProcRefs] = useState([]);          // processos conhecidos do cliente
  const [procSelectedRef, setProcSelectedRef] = useState('');
  const [procBase, setProcBase] = useState(''); // texto dos poderes com [INDICAR]

  // ── Documentos do cliente / link de upload
  const [docs, setDocs] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  // ── Pagamento avulso (fora do plano de parcelas)
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState('');
  const [payForm, setPayForm] = useState(null);

  // ── Comunicações: log real de notificações enviadas
  const [commsLog, setCommsLog] = useState(null); // null = ainda não carregado
  // Regras de lembrete deste cliente (movidas da secção Notificações, 2026-07)
  const [cliRules, setCliRules] = useState(null);
  const [cliRulesErr, setCliRulesErr] = useState('');
  const [ruleTemplates, setRuleTemplates] = useState([]);
  const [newRule, setNewRule] = useState({ channel: 'email', days_before: 3, template_id: '' });
  const [ruleBusy, setRuleBusy] = useState(false);
  const [commsErr, setCommsErr] = useState('');

  // ── Eliminar cliente (dentro do modal Editar, zona de perigo)
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

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
    const client = dataRef.current?.client;
    if (!client || !file) return;
    const isTexto = typeof file === 'string';
    if (!isTexto && !AI_ACCEPT.includes(file.type)) {
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
        setAiMsg({ kind: 'ok', text: `${isTexto ? 'Texto lido' : 'Documento lido'} — sem informação nova para acrescentar.` });
        return;
      }
      await clientsApi.update(client.id, upd);
      await loadData();
      const changed = [...new Set(Object.keys(upd).filter((k) => k !== 'email' && k !== 'phone').map((k) => FIELD_PT[k] || k))];
      setAiMsg({ kind: 'ok', text: `${isTexto ? 'Texto lido' : 'Documento lido'} — atualizado: ${changed.join(', ')}.` });
    } catch (err) {
      setAiMsg({ kind: 'err', text: 'Erro: ' + err.message });
    } finally {
      setAiBusy(false);
    }
  };

  // modal "Ler com IA": texto colado + ficheiros, em sequência (dataRef mantém o cliente fresco entre itens)
  const aiSubmeterLote = async (texto, files) => {
    setAiModalOpen(false);
    if (texto) await aiExtractFile(texto);
    for (const f of files || []) await aiExtractFile(f); // eslint-disable-line no-await-in-loop
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await clientsApi.get(clientId);
      setData(res);
      // carregar estado dos documentos (recibo / fatura-recibo / fatura) de todas as parcelas
      const ids = (res.installments || []).map((i) => i.id);
      const infos = {};
      await Promise.all(ids.map(async (id) => {
        try { infos[id] = (await recibosApi.infoAll(id)).docs || {}; } catch { infos[id] = {}; }
      }));
      setReciboInfo(infos);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [clientId]);

  const navigate = useNavigate();
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // ── Pagamento avulso: um registo 1/1 fora do plano. Cobre honorarios pontuais,
  // consultas soltas e acertos. Se "ja foi pago", cria e marca logo como pago
  // (mesmo fluxo mark_paid do resto do sistema, para o recibo funcionar igual).
  const openPay = () => {
    const c = data?.client;
    setPayErr('');
    setPayForm({
      amount: '',
      currency: c?.country === 'BR' ? 'BRL' : 'EUR',
      due_date: todayISO(),
      notes: '',
      paid: true,
      paid_date: todayISO(),
    });
    setPayOpen(true);
  };

  const handleSavePay = async () => {
    const f = payForm;
    const amount = parseFloat(String(f.amount).replace(',', '.'));
    if (!amount || amount <= 0) { setPayErr('Indique um valor válido.'); return; }
    if (!f.due_date) { setPayErr('Indique a data.'); return; }
    if (f.paid && !f.paid_date) { setPayErr('Indique a data de pagamento.'); return; }
    setPayBusy(true); setPayErr('');
    try {
      const id = `${clientId}-a${Date.now()}`; // convenção: -p parcelas, -m avenças, -a avulsos
      await installmentsApi.create({
        id, client_id: clientId,
        installment_number: 1, total_installments: 1,
        amount, currency: f.currency, due_date: f.due_date,
        notes: f.notes ? `Avulso: ${f.notes}` : 'Pagamento avulso',
      });
      if (f.paid) await installmentsApi.markPaid(id, f.paid_date);
      setPayOpen(false);
      await loadData();
      admToast('Pagamento avulso registado');
    } catch (err) {
      setPayErr(err.message || 'Falhou o registo do pagamento.');
    } finally {
      setPayBusy(false);
    }
  };

  // ── Comunicações: carrega o log quando se entra no tab
  useEffect(() => {
    if (activeTab !== 'comms') return;
    setCommsErr(''); setCommsLog(null);
    notifApi.listLog({ client_id: clientId, limit: 100 })
      .then((r) => setCommsLog(r.log || []))
      .catch((err) => { setCommsErr(err.message); setCommsLog([]); });
  }, [activeTab, clientId]);

  useEffect(() => {
    if (activeTab !== 'notifs' || cliRules !== null) return;
    setCliRulesErr('');
    Promise.all([notifApi.listRules(clientId), notifApi.listTemplates()])
      .then(([r, t]) => { setCliRules(r.rules || []); setRuleTemplates(t.templates || []); })
      .catch((err) => { setCliRulesErr(err.message); setCliRules([]); });
  }, [activeTab, clientId, cliRules]);

  const toggleCliRule = async (rule) => {
    try {
      await notifApi.updateRule(rule.id, { enabled: rule.enabled ? 0 : 1 });
      setCliRules(cliRules.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled ? 0 : 1 } : r)));
    } catch (err) { admAlert('Erro: ' + err.message); }
  };

  const deleteCliRule = async (rule) => {
    if (!await admConfirm('Remover este lembrete?')) return;
    try {
      await notifApi.removeRule(rule.id);
      setCliRules(cliRules.filter((r) => r.id !== rule.id));
    } catch (err) { admAlert('Erro: ' + err.message); }
  };

  const createCliRule = async () => {
    setRuleBusy(true);
    try {
      const payload = {
        id: `nr_${clientId}_${Date.now()}`,
        client_id: clientId,
        channel: newRule.channel,
        days_before: Number(newRule.days_before) || 0,
        enabled: 1,
      };
      if (newRule.template_id) payload.template_id = newRule.template_id;
      await notifApi.createRule(payload);
      setCliRules(null); // força reload
      setNewRule({ channel: 'email', days_before: 3, template_id: '' });
    } catch (err) { admAlert('Erro: ' + err.message); }
    finally { setRuleBusy(false); }
  };

  // ── Eliminar cliente: exige escrever o nome exacto. O ON DELETE CASCADE do D1
  // apaga parcelas, regras, log e documentos — nao ha volta a dar.
  const handleDeleteClient = async () => {
    setDelBusy(true); setDelErr('');
    try {
      await clientsApi.remove(clientId);
      navigate('/admin/clientes');
    } catch (err) {
      setDelErr(err.message || 'Falhou a eliminação.');
      setDelBusy(false);
    }
  };

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
      admAlert('Tipo não suportado. Use PNG, JPEG, WEBP ou SVG.');
      return;
    }
    setLogoBusy(true);
    try { await clientLogo.upload(clientId, file); await loadData(); }
    catch (err) { admAlert('Erro ao carregar logo: ' + err.message); }
    finally { setLogoBusy(false); }
  };

  const handleLogoRemove = async () => {
    if (!await admConfirm('Remover a logo do cliente?')) return;
    setLogoBusy(true);
    try { await clientLogo.remove(clientId); await loadData(); }
    catch (err) { admAlert('Erro: ' + err.message); }
    finally { setLogoBusy(false); }
  };

  // Desmarcar um "pago" indevido: volta a pendente, mantém documentos anexados
  const handleUnmarkPaid = async (inst) => {
    if (!await admConfirm(
      `Desmarcar a parcela ${inst.installment_number}/${inst.total_installments} como paga? Volta a "pendente" — os documentos anexados mantêm-se.`,
      { okLabel: 'Desmarcar' }
    )) return;
    try {
      await installmentsApi.update(inst.id, { status: 'pending', paid_date: null });
      await loadData();
      admToast('Parcela desmarcada — voltou a pendente', { kind: 'info' });
    } catch (err) {
      admAlert('Erro: ' + err.message);
    }
  };

  const handleMarkPaid = async (installmentId) => {
    if (!await admConfirm('Marcar esta parcela como paga (hoje)?')) return;
    setMarkingPaid(installmentId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await installmentsApi.markPaid(installmentId, today);
      await loadData();
      admToast('Parcela marcada como paga');
    } catch (err) {
      admAlert('Erro: ' + err.message);
    } finally {
      setMarkingPaid(null);
    }
  };

  // Anexar documento (recibo | fatura-recibo | fatura): aciona o input de ficheiro escondido
  const triggerAttach = (installmentId, tipo = 'recibo') => {
    pendingUploadId.current = { id: installmentId, tipo };
    if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); }
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    const pending = pendingUploadId.current;
    if (!file || !pending) return;
    const { id: installmentId, tipo } = typeof pending === 'object' ? pending : { id: pending, tipo: 'recibo' };
    await doUploadDoc(installmentId, tipo, file);
  };

  // Carrega um documento (via seletor de ficheiro OU arrastado para o botão Anexar)
  const doUploadDoc = async (installmentId, tipo, file) => {
    if (file.type !== 'application/pdf') { admAlert('Por favor selecione um ficheiro PDF.'); return; }
    setReciboBusy(installmentId);
    try {
      await recibosApi.upload(installmentId, file, tipo);
      // Anexar Recibo ou Fatura-Recibo considera a parcela como paga (Fatura não)
      const inst = (data?.installments || []).find((x) => x.id === installmentId);
      const tipoLabel = (DOC_TIPOS.find(([t]) => t === tipo) || [null, 'Documento'])[1];
      if ((tipo === 'recibo' || tipo === 'fatura-recibo') && inst && inst.status !== 'paid') {
        await installmentsApi.markPaid(installmentId, new Date().toISOString().slice(0, 10));
        await loadData(); // recarrega parcelas + estado dos documentos
        admToast(`${tipoLabel} anexado — parcela marcada como paga`);
      } else {
        const info = (await recibosApi.infoAll(installmentId)).docs || {};
        setReciboInfo((prev) => ({ ...prev, [installmentId]: info }));
        admToast(`${tipoLabel} anexado`);
      }
    } catch (err) {
      admAlert('Não foi possível anexar o documento: ' + err.message);
    } finally {
      setReciboBusy(null);
      pendingUploadId.current = null;
    }
  };

  const handleViewRecibo = async (installmentId, tipo = 'recibo') => {
    try {
      await recibosApi.openInNewTab(installmentId, tipo);
    } catch (err) {
      admAlert('Não foi possível abrir o documento: ' + err.message);
    }
  };

  // Remover um documento anexado; se deixar de haver Recibo/Fatura-Recibo,
  // a parcela paga volta a pendente.
  const handleRemoveParcelaDoc = async (inst, tipo, label) => {
    const comprova = tipo === 'recibo' || tipo === 'fatura-recibo';
    if (!await admConfirm(
      `Remover o documento "${label}" anexado à parcela ${inst.installment_number}/${inst.total_installments}?` +
      (comprova && inst.status === 'paid' ? ' Se não restar Recibo nem Fatura-Recibo, a parcela volta a pendente.' : ''),
      { okLabel: 'Remover', danger: true }
    )) return;
    setReciboBusy(inst.id);
    try {
      await recibosApi.remove(inst.id, tipo);
      const info = (await recibosApi.infoAll(inst.id)).docs || {};
      setReciboInfo((prev) => ({ ...prev, [inst.id]: info }));
      const aindaComprovada = info['recibo']?.exists || info['fatura-recibo']?.exists;
      if (inst.status === 'paid' && comprova && !aindaComprovada) {
        await installmentsApi.update(inst.id, { status: 'pending', paid_date: null });
        await loadData();
        admToast(`${label} removido — a parcela voltou a pendente`, { kind: 'info' });
      } else {
        admToast(`${label} removido`, { kind: 'info' });
      }
    } catch (err) {
      admAlert('Não foi possível remover o documento: ' + err.message);
    } finally {
      setReciboBusy(null);
    }
  };

  const handleRemoveRecibo = async (installmentId) => {
    if (!await admConfirm('Remover o Recibo Verde anexado a esta parcela?')) return;
    setReciboBusy(installmentId);
    try {
      await recibosApi.remove(installmentId);
      setReciboInfo((prev) => ({ ...prev, [installmentId]: { exists: false } }));
    } catch (err) {
      admAlert('Não foi possível remover: ' + err.message);
    } finally {
      setReciboBusy(null);
    }
  };

  const handleSendRecibo = async (installmentId) => {
    setSendBusy(installmentId);
    try {
      const r = await recibosApi.sendToClient(installmentId);
      if (r.skipped) admAlert('Envio por email ainda não configurado (falta a chave Resend).');
      else admAlert('Recibo Verde enviado por email para ' + r.sent_to + '.');
    } catch (err) {
      admAlert('Não foi possível enviar: ' + err.message);
    } finally {
      setSendBusy(null);
    }
  };

  // ── Editar plano de pagamento (cliente já criado) ─────────────
  // A lista inclui TODAS as parcelas: as pagas primeiro (editáveis, para
  // corrigir o valor pago) e depois as novas. A soma de todas tem de fechar
  // com o total contratado.
  const paidRowsFromData = () => (data?.installments || [])
    .filter((i) => i.status === 'paid')
    .sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0))
    .map((i, idx) => ({
      n: idx + 1, id: i.id, paid: true,
      due_date: (i.due_date || '').slice(0, 10),
      amount: Number(i.amount).toFixed(2),
    }));

  const regenPlanParcelas = (pf) => {
    if (pf.planType !== 'installment') return { ...pf, parcelas: null };
    const paidRows = paidRowsFromData();
    const paidSum = Math.round(paidRows.reduce((s, r) => s + parseValor(r.amount), 0) * 100) / 100;
    const total = parseValor(pf.totalValue);
    const n = parseInt(pf.installments, 10) || 0;
    if (pf.startDate && total > 0 && n > paidRows.length) {
      const restante = Math.round((total - paidSum) * 100) / 100;
      return { ...pf, parcelas: [...paidRows, ...gerarParcelas(restante, n - paidRows.length, pf.startDate, paidRows.length + 1)] };
    }
    if (paidRows.length && n === paidRows.length) return { ...pf, parcelas: paidRows };
    return { ...pf, parcelas: paidRows.length ? paidRows : null };
  };

  const updPlanField = (key) => (e) => {
    const value = e.target.value;
    setPlanForm((pf) => {
      const next = { ...pf, [key]: value };
      if (next.planType !== 'installment') return { ...next, parcelas: null };
      // sem lista ainda (ou mudança de tipo de plano) → gerar de raiz
      if (key === 'planType' || !pf.parcelas || !pf.parcelas.length) return regenPlanParcelas(next);
      if (key === 'installments') {
        // mudar a QUANTIDADE não mexe nos valores já definidos:
        // as pagas ficam sempre; acrescenta linhas novas no fim (com o valor
        // da última) ou retira novas do fim
        const paidRows = pf.parcelas.filter((r) => r.paid);
        const novas = pf.parcelas.filter((r) => !r.paid);
        const alvo = Math.max(0, (parseInt(value, 10) || 0) - paidRows.length);
        let rows = novas.slice(0, alvo);
        while (rows.length < alvo) {
          const last = rows[rows.length - 1] || novas[novas.length - 1] || paidRows[paidRows.length - 1];
          rows = [...rows, {
            n: 0, // renumerado abaixo
            due_date: last ? addMonthsStr(last.due_date, 1) : next.startDate,
            amount: last ? last.amount : '0.00',
          }];
        }
        const todas = [...paidRows, ...rows].map((r, i) => ({ ...r, n: i + 1 }));
        return { ...next, parcelas: todas.length ? todas : null };
      }
      if (key === 'startDate' && value) {
        // nova data de vencimento: redata as parcelas NOVAS (mensal),
        // mantém valores; as pagas mantêm as suas datas
        let k = 0;
        return { ...next, parcelas: pf.parcelas.map((r) => (r.paid ? r : { ...r, due_date: addMonthsStr(value, k++) })) };
      }
      // totalValue: mantém a lista — a barra da soma mostra a diferença a acertar
      return next;
    });
  };

  const openPlanEdit = () => {
    const c = data?.client || {};
    const insts = data?.installments || [];
    const monthly = !c.honorarios_total;
    setPlanForm(regenPlanParcelas({
      planType: monthly ? 'monthly' : 'installment',
      startDate: (c.contract_start_date || '').slice(0, 10),
      totalValue: c.honorarios_total || '',
      installments: c.honorarios_parcelas || '',
      monthlyValue: monthly ? (insts[0]?.amount || '') : '',
      parcelas: null,
    }));
    setPlanEdit(true);
  };

  const handleSavePlan = async () => {
    const pf = planForm;
    const isInst = pf.planType === 'installment';
    const total = parseFloat(String(pf.totalValue).replace(',', '.')) || 0;
    const nParc = parseInt(pf.installments, 10) || 0;
    const mensal = parseFloat(String(pf.monthlyValue).replace(',', '.')) || 0;
    if (!pf.startDate) { admAlert('Indique a Data de Vencimento (1.ª parcela).'); return; }
    if (isInst && (total <= 0 || nParc <= 0)) { admAlert('Indique o valor total contratado e o número de parcelas.'); return; }
    if (!isInst && mensal <= 0) { admAlert('Indique o valor mensal da avença.'); return; }

    const insts = data?.installments || [];
    const unpaid = insts.filter((i) => i.status !== 'paid');
    const paidCount = insts.length - unpaid.length;
    if (isInst && paidCount > nParc) { admAlert(`Já existem ${paidCount} parcelas pagas — o número de parcelas não pode ser inferior.`); return; }
    // a lista inclui as pagas (editáveis) + as novas
    const rows = isInst ? (pf.parcelas || []) : [];
    const paidRows = rows.filter((r) => r.paid);
    const newRows = rows.filter((r) => !r.paid);
    if (isInst) {
      if (rows.length !== nParc) { admAlert('A lista de parcelas não corresponde ao número de parcelas indicado.'); return; }
      if (rows.some((r) => !r.due_date || parseValor(r.amount) <= 0)) { admAlert('Todas as parcelas precisam de data e de um valor superior a zero.'); return; }
      const soma = somaParcelas(rows);
      if (Math.abs(total - soma) >= 0.005) {
        admAlert(`A soma das parcelas (${fmtValor(soma, (data?.client?.country === 'BR') ? 'BRL' : 'EUR')}) não fecha com o total contratado (${fmtValor(total, (data?.client?.country === 'BR') ? 'BRL' : 'EUR')}). Ajuste os valores até a soma ficar a verde.`);
        return;
      }
    }
    if (insts.length > 0 && !(await admConfirm(
      `As ${unpaid.length} parcelas por pagar serão substituídas pelo novo plano.` +
      (paidCount ? ` As ${paidCount} pagas mantêm o estado de pagas (valores e datas atualizados conforme a lista).` : '') + ' Continuar?',
      { okLabel: 'Aplicar novo plano' }
    ))) return;

    setPlanSaveBusy(true);
    try {
      const curr = (data?.client?.country === 'BR') ? 'BRL' : 'EUR';
      await clientsApi.update(clientId, {
        honorarios_total: isInst ? total : 0,
        honorarios_parcelas: isInst ? nParc : 0,
        contract_start_date: pf.startDate,
      });
      // parcelas pagas: atualiza valor/data/numeração (mantêm o estado de pagas e os documentos)
      for (const r of paidRows) {
        await installmentsApi.update(r.id, {
          amount: parseValor(r.amount),
          due_date: r.due_date,
          installment_number: r.n,
          total_installments: isInst ? nParc : paidCount + 12,
        });
      }
      for (const i of unpaid) await installmentsApi.remove(i.id);
      const stamp = Date.now().toString(36);
      const toCreate = [];
      if (isInst) {
        for (const r of newRows) {
          toCreate.push({
            id: `${clientId}-p${r.n}-${stamp}`, client_id: clientId,
            installment_number: r.n, total_installments: nParc,
            amount: parseValor(r.amount), currency: curr, due_date: r.due_date,
          });
        }
      } else {
        for (let k = 0; k < 12; k++) {
          toCreate.push({
            id: `${clientId}-m${paidCount + k + 1}-${stamp}`, client_id: clientId,
            installment_number: paidCount + k + 1, total_installments: paidCount + 12,
            amount: mensal, currency: curr, due_date: addMonthsStr(pf.startDate, k),
          });
        }
      }
      for (const inst of toCreate) await installmentsApi.create(inst);
      setPlanEdit(false);
      await loadData();
      admToast('Plano de pagamento atualizado');
    } catch (err) {
      admAlert('Erro ao guardar o plano: ' + err.message);
    } finally {
      setPlanSaveBusy(false);
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

  // aplicar a referência escolhida/digitada: regenera os poderes a partir da base [INDICAR]
  const applyProcessoRef = (ref) => {
    setProcSelectedRef(ref);
    setProcOverrides((prev) => ({
      ...prev,
      poderes: (procBase || prev.poderes || '').split('[INDICAR]').join(ref || '[INDICAR]')
        // se a base já tinha ref anterior aplicada não acontece: base guarda sempre [INDICAR]
    }));
  };

  // edição manual do textarea: atualiza também a base (revertendo a ref atual para [INDICAR])
  const editPoderes = (text) => {
    setProcOverrides((prev) => ({ ...prev, poderes: text }));
    setProcBase(procSelectedRef ? text.split(procSelectedRef).join('[INDICAR]') : text);
  };

  // Quando muda o modelo escolhido, fazer preview do texto preenchido
  const handleGeneratePlanPdf = async () => {
    setPlanPdfBusy(true);
    setPlanMsg(null);
    try {
      await planosApi.generateOpen(client.id, { people_ids: planPeople });
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
    if (!await admConfirm(`Enviar o plano de pagamento para ${client.email}?`)) return;
    setPlanSendBusy(true);
    setPlanMsg(null);
    try {
      const r = await planosApi.enviar(client.id, { people_ids: planPeople });
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
    setEditPerson(0);
    setEditForm({
      people: (data?.people || []).map((row) => personFromRow(row, client.country)),
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
      contract_start_date: client.contract_start_date || '',
      first_attendance_date: client.first_attendance_date || '',
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
    const semNome = (editForm.people || []).findIndex((p) => !String(p.name || '').trim() && personHasData(p));
    if (semNome !== -1) {
      setEditError(`A pessoa ${semNome + 2} tem dados preenchidos mas falta o nome.`);
      setEditPerson(semNome + 1);
      return;
    }
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
        contract_start_date: editForm.contract_start_date || null,
        first_attendance_date: editForm.first_attendance_date || null,
        // pessoas adicionais (cliente conjunto): o array enviado substitui o existente
        people: editForm.person_type === 'coletiva' ? [] : (editForm.people || [])
          .filter((p) => String(p.name || '').trim())
          .map((p) => {
            const { addrParts, ...rest } = p;
            return {
              ...rest,
              address: hasAddress(addrParts) ? composeAddress(addrParts) : null,
              address_parts: hasAddress(addrParts) ? JSON.stringify(addrParts) : null,
            };
          }),
      };
      delete payload.addrParts;
      delete payload.repAddrParts;
      await clientsApi.update(client.id, payload);
      setEditing(false);
      await loadData();
      admToast('Ficha do cliente guardada');
    } catch (err) {
      setEditError(err.message || 'Falha ao guardar.');
    } finally {
      setEditBusy(false);
    }
  };

  // Trocar de outorgante: só o preview é refeito — os poderes já editados mantêm-se.
  const handlePickOutorgante = async (ids) => {
    const pid = ids[0];
    setProcPersonId(pid);
    if (!procTemplateId) return;
    setProcBusy(true);
    try {
      const r = await procApi.preview({ template_id: procTemplateId, client_id: clientId, person_id: pid, overrides: procOverrides });
      setProcText(r.texto || '');
    } catch { /* o texto final é sempre o do PDF gerado */ }
    finally { setProcBusy(false); }
  };

  const handlePickTemplate = async (templateId) => {
    setProcTemplateId(templateId);
    setProcOverrides({});
    setProcSelectedRef('');
    setProcBase('');
    setProcText('');
    setProcEditable([]);
    if (!templateId) return;
    setProcBusy(true);
    try {
      const r = await procApi.preview({ template_id: templateId, client_id: clientId, person_id: procPerson });
      const fields = r.campos_editaveis || [];
      setProcEditable(fields);
      if (fields.includes('poderes')) {
        const base = r.poderes_default || 'poderes para o representar no âmbito do processo n.º [INDICAR] e processos conexos, incluindo a junção de documentos, apresentação de requerimentos, resposta a notificações, interposição de recursos e prática de todos os demais atos processuais necessários à defesa dos seus direitos.';
        const firstRef = procRefs[0] || '';
        const poderes = base.split('[INDICAR]').join(firstRef || '[INDICAR]');
        setProcBase(base);
        setProcSelectedRef(firstRef);
        setProcOverrides({ poderes });
        // preview com os poderes já aplicados para o texto refletir o documento final
        try {
          const r2 = await procApi.preview({ template_id: templateId, client_id: clientId, person_id: procPerson, overrides: { poderes } });
          setProcText(r2.texto || r.texto || '');
        } catch { setProcText(r.texto || ''); }
      } else {
        setProcText(r.texto || '');
        setProcOverrides({});
      }
    } catch (e) {
      admAlert('Erro a carregar modelo: ' + e.message);
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
        person_id: procPerson,
        overrides: procOverrides,
        local: procLocal,
        data: procData,
      });
    } catch (e) {
      admAlert('Erro a gerar procuração: ' + e.message);
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
      admAlert('Link gerado e copiado para o seu clipboard:\n\n' + link);
    } catch (e) {
      admAlert('Erro a gerar link: ' + e.message);
    } finally { setTokenBusy(false); }
  };

  const handleCopyLink = async (token) => {
    const link = `${window.location.origin}/upload/${token}`;
    try { await navigator.clipboard.writeText(link); setCopied(token); setTimeout(() => setCopied(null), 2500); } catch { admAlert(link); }
  };

  const handleRevokeToken = async (token) => {
    if (!await admConfirm('Revogar este link? O cliente deixará de poder enviar documentos por ele.')) return;
    try { await utApi.revoke(token); await loadDocsAndTokens(); }
    catch (e) { admAlert('Erro: ' + e.message); }
  };

  const handleRemoveDoc = async (docId, filename) => {
    if (!await admConfirm(`Apagar "${filename}"? Esta ação é irreversível.`)) return;
    try { await docsApi.remove(docId); await loadDocsAndTokens(); }
    catch (e) { admAlert('Erro: ' + e.message); }
  };

  if (loading) return <SkeletonPage kpis={4} rows={5} />;
  if (error) return <div className="adm-login-error">{error}</div>;
  if (!data?.client) {
    return <div className="adm-empty">Cliente não encontrado. <Link to="/admin/clientes">Voltar à lista</Link></div>;
  }

  const client = data.client;
  const installments = (data.installments || []).slice().sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const paid = installments.filter((i) => i.status === 'paid');
  const pending = installments.filter((i) => i.status !== 'paid');

  const initials = (client.name || '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  // Pessoas do cliente para os documentos: o titular vive em `clients` (id = client.id),
  // as adicionais em `client_people` (ids `{client.id}-pesN-xxxx`, nunca iguais ao do titular).
  const pessoas = [
    { id: client.id, name: client.name, identification: client.identification },
    ...(data.people || []).map((p) => ({ id: p.id, name: p.name, identification: p.identification })),
  ];
  const planPeople = planPeopleSel || pessoas.map((p) => p.id);
  const procPerson = procPersonId || client.id;
  const planType = client.plan_type || ((!client.honorarios_total || client.honorarios_total === 0) ? 'monthly' : 'installment');
  const semPlano = planType === 'oficioso' || planType === 'probono';
  const isMonthly = !semPlano && (planType === 'monthly' || !client.honorarios_total || client.honorarios_total === 0);
  const currency = client.country === 'BR' ? 'BRL' : 'EUR';

  let summary;
  if (semPlano) {
    summary = {
      paid: paid.reduce((s2, i) => s2 + Number(i.amount), 0),
      progress: paid.length ? `${paid.length} pagamento${paid.length > 1 ? 's' : ''} registado${paid.length > 1 ? 's' : ''}` : '—',
    };
  } else if (!isMonthly) {
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
          className="adm-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !editBusy) setEditing(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ position: 'relative', background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 640, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <ModalClose onClose={() => setEditing(false)} disabled={editBusy} />
            <h2 style={{ margin: '0 0 1.25rem', paddingRight: '2.5rem', fontFamily: 'var(--serif)' }}>Editar cliente</h2>

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
                  <option value="Administrativo">Administrativo</option>
                  <option value="Criminal">Criminal</option>
                </select>
              </label>
              <label className="adm-field">
                <span>Data do 1.º atendimento</span>
                <input type="date" value={editForm.first_attendance_date} onChange={editField('first_attendance_date')} disabled={editBusy} />
              </label>
              <label className="adm-field">
                <span>Data de Vencimento (1.ª parcela)</span>
                <input type="date" value={editForm.contract_start_date} onChange={editField('contract_start_date')} disabled={editBusy} />
              </label>

              <div style={{ gridColumn: '1 / -1', fontWeight: 600, color: 'var(--forest, #12302a)', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '0.3rem', marginTop: '0.3rem' }}>
                {editForm.person_type === 'coletiva' ? 'Dados da empresa' : 'Dados pessoais'}
              </div>
              {editForm.person_type === 'singular' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <PersonPills
                    names={[editForm.name || 'Titular', ...(editForm.people || []).map((p) => p.name)]}
                    active={editPerson}
                    onSelect={setEditPerson}
                    onAdd={() => {
                      setEditForm((f) => {
                        const next = [...(f.people || []), { ...EMPTY_PERSON, addrParts: { ...EMPTY_ADDRESS, country: client.country || 'PT' } }];
                        setEditPerson(next.length);
                        return { ...f, people: next };
                      });
                    }}
                    disabled={editBusy}
                  />
                </div>
              )}
              {(editForm.person_type === 'coletiva' || editPerson === 0) && (<>
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
              </>)}

              {editForm.person_type === 'singular' && editPerson > 0 && editForm.people[editPerson - 1] && (
                <>
                  <PersonFields
                    value={editForm.people[editPerson - 1]}
                    onChange={(v) => setEditForm((f) => ({ ...f, people: f.people.map((p, i) => (i === editPerson - 1 ? v : p)) }))}
                    country={client.country}
                    disabled={editBusy}
                  />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <button
                      type="button"
                      className="adm-btn adm-btn-sm"
                      style={{ color: '#b00', borderColor: 'rgba(176,0,0,0.35)' }}
                      onClick={() => {
                        setEditForm((f) => ({ ...f, people: f.people.filter((_, i) => i !== editPerson - 1) }));
                        setEditPerson(0);
                      }}
                      disabled={editBusy}
                    >
                      Remover esta pessoa
                    </button>
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)', marginLeft: '0.7rem' }}>
                      A remoção só é aplicada ao Guardar alterações.
                    </span>
                  </div>
                </>
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
              <button
                className="adm-btn"
                style={{ marginRight: 'auto', color: '#b00', borderColor: 'rgba(176,0,0,0.35)' }}
                onClick={() => { setDelName(''); setDelErr(''); setDelOpen(true); }}
                disabled={editBusy}
              >
                Eliminar cliente…
              </button>
              <button className="adm-btn" onClick={() => setEditing(false)} disabled={editBusy}>Cancelar</button>
              <button className="adm-btn adm-btn-gold" onClick={handleSaveEdit} disabled={editBusy}>
                {editBusy ? 'A guardar…' : 'Guardar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: pagamento avulso ─────────────────────────────────────── */}
      {payOpen && payForm && (
        <div
          className="adm-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !payBusy) setPayOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}
        >
          <div style={{ position: 'relative', background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 440, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <ModalClose onClose={() => setPayOpen(false)} disabled={payBusy} />
            <h2 style={{ margin: '0 0 0.4rem', paddingRight: '2.5rem', fontFamily: 'var(--serif)' }}>Pagamento avulso</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: 'var(--muted, #666)' }}>
              Registo único, fora do plano de parcelas — consultas soltas, honorários pontuais, acertos.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <label className="adm-field" style={{ flex: 1 }}>
                <span>Valor *</span>
                <input
                  type="text" inputMode="decimal" placeholder="0,00" autoFocus
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  disabled={payBusy}
                />
              </label>
              <label className="adm-field" style={{ width: 100 }}>
                <span>Moeda</span>
                <select
                  value={payForm.currency}
                  onChange={(e) => setPayForm({ ...payForm, currency: e.target.value })}
                  disabled={payBusy}
                >
                  <option value="EUR">EUR</option>
                  <option value="BRL">BRL</option>
                </select>
              </label>
            </div>

            <label className="adm-field" style={{ display: 'block', marginTop: '0.9rem' }}>
              <span>Data *</span>
              <input
                type="date"
                value={payForm.due_date}
                onChange={(e) => setPayForm({ ...payForm, due_date: e.target.value })}
                disabled={payBusy}
              />
            </label>

            <label className="adm-field" style={{ display: 'block', marginTop: '0.9rem' }}>
              <span>Descrição (opcional)</span>
              <input
                type="text" placeholder="Ex.: consulta de 11/07"
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                disabled={payBusy}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', fontSize: '0.9rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={payForm.paid}
                onChange={(e) => setPayForm({ ...payForm, paid: e.target.checked })}
              />
              Já foi pago
            </label>
            {payForm.paid && (
              <>
                <label className="adm-field" style={{ display: 'block', marginTop: '0.6rem' }}>
                  <span>Data de pagamento</span>
                  <input
                    type="date"
                    value={payForm.paid_date}
                    onChange={(e) => setPayForm({ ...payForm, paid_date: e.target.value })}
                    disabled={payBusy}
                  />
                </label>
              </>
            )}

            {payErr && <div style={{ color: '#b00', fontSize: '0.85rem', marginTop: '0.9rem' }}>{payErr}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="adm-btn" onClick={() => setPayOpen(false)} disabled={payBusy}>Cancelar</button>
              <button className="adm-btn adm-btn-gold" onClick={handleSavePay} disabled={payBusy}>
                {payBusy ? 'A registar…' : 'Registar pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: eliminar cliente (confirmação pelo nome) ────────────── */}
      {delOpen && (
        <div
          className="adm-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !delBusy) setDelOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4rem 1rem', zIndex: 1100, overflowY: 'auto' }}
        >
          <div style={{ position: 'relative', background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 460, padding: '1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', borderTop: '3px solid #b00' }}>
            <ModalClose onClose={() => setDelOpen(false)} disabled={delBusy} />
            <h2 style={{ margin: '0 0 0.75rem', paddingRight: '2.5rem', fontFamily: 'var(--serif)', color: '#b00' }}>Eliminar cliente</h2>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
              Isto elimina <strong>{data?.client?.name}</strong> e <strong>tudo o que lhe está associado</strong>:
              parcelas e pagamentos, histórico de comunicações, regras de notificação e documentos.
            </p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#b00' }}>
              Não há forma de recuperar. Se o objetivo é apenas arquivar, use antes o botão Editar.
            </p>
            <label className="adm-field" style={{ display: 'block' }}>
              <span>Para confirmar, escreva o nome exato do cliente</span>
              <input
                type="text" autoFocus
                placeholder={data?.client?.name}
                value={delName}
                onChange={(e) => setDelName(e.target.value)}
                disabled={delBusy}
              />
            </label>
            {delErr && <div style={{ color: '#b00', fontSize: '0.85rem', marginTop: '0.9rem' }}>{delErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="adm-btn" onClick={() => setDelOpen(false)} disabled={delBusy}>Cancelar</button>
              <button
                className="adm-btn"
                style={{ background: '#b00', borderColor: '#b00', color: '#fff', opacity: delName.trim() === (data?.client?.name || '') ? 1 : 0.45 }}
                onClick={handleDeleteClient}
                disabled={delBusy || delName.trim() !== (data?.client?.name || '')}
              >
                {delBusy ? 'A eliminar…' : 'Eliminar definitivamente'}
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
              <span key={'e' + i}><IconMail size={12} /> {c.value}{c.label && c.label !== 'Pessoal' ? ` (${c.label})` : ''}</span>
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
            {(data.people || []).length > 0 && (
              <span title="Cliente conjunto — os documentos e planos incluem todas as pessoas">
                Cliente conjunto · com {(data.people || []).map((p) => p.name).join(' e ')}
              </span>
            )}
          </div>
        </div>
        <div className="adm-client-actions">
          <button onClick={openEdit}>Editar</button>
          {planType !== 'probono' && <button className="primary" onClick={openPay}>+ Pagamento</button>}
        </div>
      </div>

      <input ref={aiFileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) aiExtractFile(f); e.target.value = ''; }} />
      <div
        onDragOver={(e) => { e.preventDefault(); setAiDragOver(true); }}
        onDragLeave={() => setAiDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setAiDragOver(false); const fs = e.dataTransfer.files ? [...e.dataTransfer.files] : []; if (fs.length) aiSubmeterLote('', fs); }}
        onClick={() => !aiBusy && setAiModalOpen(true)}
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

      <LerIAModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onSubmeter={aiSubmeterLote} />

      <SlidingTabs
        items={[
          { id: 'plan', label: 'Plano de pagamento' },
          { id: 'summary', label: 'Resumo' },
          { id: 'comms', label: 'Comunicações' },
          { id: 'notifs', label: 'Notificações' },
          { id: 'docs', label: 'Documentos' },
          { id: 'procuracoes', label: 'Procurações' },
          { id: 'notes', label: 'Notas' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
        variant="underline"
        style={{ flexWrap: 'wrap' }}
      />

      {activeTab === 'plan' && (
        <>
          {semPlano && (
            <div style={{
              padding: '0.85rem 1.1rem', borderRadius: 8, marginBottom: '1rem',
              background: planType === 'oficioso' ? 'rgba(184,147,90,0.12)' : 'rgba(18,48,42,0.07)',
              border: `1px solid ${planType === 'oficioso' ? 'rgba(184,147,90,0.45)' : 'rgba(18,48,42,0.18)'}`,
              lineHeight: 1.6, fontSize: '0.9rem',
            }}>
              {planType === 'oficioso' ? (
                paid.length === 0
                  ? <><strong>Oficioso — aguarda trânsito em julgado.</strong> Nomeação pela Ordem dos Advogados: os honorários são fixados e recebidos após o trânsito em julgado. Quando receber, registe o valor com <strong>+ Pagamento</strong>.</>
                  : <><strong>Oficioso</strong> — nomeação pela Ordem dos Advogados. Recebimentos registados como pagamentos avulsos.</>
              ) : (
                <><strong>Pro bono</strong> — atendimento gratuito e voluntário, sem componente financeira.</>
              )}
            </div>
          )}
          {!semPlano && (
          <div className="adm-plan-actions">
            <button
              className="adm-btn"
              data-tip="Gera o PDF do plano de pagamento no formato padrão"
              onClick={handleGeneratePlanPdf}
              disabled={planPdfBusy || installments.length === 0}
            >
              {planPdfBusy ? 'A gerar…' : <><IconDoc /> Gerar PDF</>}
            </button>
            <button
              className="adm-btn adm-btn-gold"
              data-tip={client.email ? `Envia o PDF do plano para ${client.email}` : 'Cliente sem e-mail registado'}
              onClick={handleSendPlan}
              disabled={planSendBusy || installments.length === 0}
            >
              {planSendBusy ? 'A enviar…' : <><IconMail size={13} /> Enviar ao cliente</>}
            </button>
            <button
              className="adm-btn"
              data-tip="Alterar valor total, n.º de parcelas, datas e valores individuais — as pagas mantêm-se"
              onClick={openPlanEdit}
            >
              <IconGear size={13} /> Editar plano
            </button>
            {planMsg && (
              <span className={planMsg.type === 'ok' ? 'adm-plan-msg-ok' : 'adm-plan-msg-error'}>
                {planMsg.text}
              </span>
            )}
          </div>
          )}
          {!semPlano && (
            <PeoplePicker
              people={pessoas}
              selected={planPeople}
              onChange={setPlanPeopleSel}
              disabled={planPdfBusy || planSendBusy}
              label="Titulares no PDF do plano"
              helper="Só as pessoas assinaladas constam do plano gerado e do que é enviado ao cliente."
            />
          )}
          {planEdit && planForm && (
            <div
              className="adm-overlay"
              onMouseDown={(e) => { if (e.target === e.currentTarget && !planSaveBusy) setPlanEdit(false); }}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(18,48,42,0.55)', zIndex: 1500,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 1rem 2rem', overflowY: 'auto',
              }}
            >
              <div style={{
                background: 'var(--bg, #faf8f4)', borderRadius: 10, width: '100%', maxWidth: 580,
                padding: '1.6rem 1.7rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', borderTop: '3px solid var(--gold, #b8935a)',
              }}>
                <h2 style={{ margin: '0 0 1rem', fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--forest, #12302a)' }}>
                  Editar plano de pagamento
                </h2>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label>Tipo de plano</label>
                    <select value={planForm.planType} onChange={updPlanField('planType')} disabled={planSaveBusy}>
                      <option value="installment">Parcelado (montante dividido)</option>
                      <option value="monthly">Avença mensal (recorrente)</option>
                    </select>
                  </div>
                  <div className="adm-field">
                    <label>Data de Vencimento</label>
                    <DateInput value={planForm.startDate} onChange={updPlanField('startDate')} disabled={planSaveBusy} />
                    <div className="adm-field-helper">1.ª parcela nova — as seguintes vencem mensalmente</div>
                  </div>
                  {planForm.planType === 'installment' ? (
                    <>
                      <div className="adm-field">
                        <label>Valor total contratado</label>
                        <MoneyInput currency={(data?.client?.country === 'BR') ? 'BRL' : 'EUR'} value={planForm.totalValue} onChange={updPlanField('totalValue')} placeholder="3120" disabled={planSaveBusy} />
                      </div>
                      <div className="adm-field">
                        <label>Número de parcelas</label>
                        <StepperInput min={1} value={planForm.installments} onChange={updPlanField('installments')} placeholder="6" disabled={planSaveBusy} />
                      </div>
                      {planForm.parcelas && planForm.parcelas.length > 0 && (() => {
                        const nPagas = planForm.parcelas.filter((r) => r.paid).length;
                        const curr = (data?.client?.country === 'BR') ? 'BRL' : 'EUR';
                        return (
                          <div className="adm-field adm-full">
                            <label>Valores das parcelas</label>
                            <ParcelasEditor
                              rows={planForm.parcelas}
                              onChange={(rows) => setPlanForm({ ...planForm, parcelas: rows })}
                              currency={curr}
                              targetTotal={parseValor(planForm.totalValue)}
                              baseLabel={nPagas ? `${nPagas} parcela(s) paga(s) incluídas na lista — pode corrigir o valor/data pago(a); mantêm o estado de pagas` : null}
                              disabled={planSaveBusy}
                              onRemove={(idx) => {
                                // eliminar uma parcela nova (ex.: cliente adiantou valores) — renumera todas
                                const novo = planForm.parcelas
                                  .filter((_, i) => i !== idx)
                                  .map((r, i) => ({ ...r, n: i + 1 }));
                                setPlanForm({ ...planForm, parcelas: novo, installments: String(novo.length) });
                              }}
                              onUnmark={async (idx) => {
                                // desmarcar uma parcela paga a partir do editor
                                const r = planForm.parcelas[idx];
                                if (!r || !r.paid) return;
                                if (!await admConfirm(
                                  `Desmarcar a Parcela ${r.n} como paga? Volta a "pendente" — os documentos anexados mantêm-se.`,
                                  { okLabel: 'Desmarcar' }
                                )) return;
                                try {
                                  await installmentsApi.update(r.id, { status: 'pending', paid_date: null });
                                  await loadData();
                                  setPlanForm((pf) => ({
                                    ...pf,
                                    parcelas: pf.parcelas.map((x, i2) => (i2 === idx ? { ...x, paid: false, id: undefined } : x)),
                                  }));
                                  admToast('Parcela desmarcada — voltou a pendente', { kind: 'info' });
                                } catch (err) {
                                  admAlert('Erro: ' + err.message);
                                }
                              }}
                            />
                            <div className="adm-field-helper">Pode ajustar o valor e a data de cada parcela (incluindo as pagas), ou eliminar parcelas novas (✕) se o cliente adiantou valores — a soma de todas tem de fechar com o total contratado</div>
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div className="adm-field adm-full">
                      <label>Valor mensal</label>
                      <MoneyInput currency={(data?.client?.country === 'BR') ? 'BRL' : 'EUR'} value={planForm.monthlyValue} onChange={(e) => setPlanForm({ ...planForm, monthlyValue: e.target.value })} placeholder="450" disabled={planSaveBusy} />
                      <div className="adm-field-helper">Cria as próximas 12 mensalidades a partir da Data de Vencimento</div>
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--sans)', fontSize: '0.76rem', color: 'var(--muted, #777)', marginTop: '0.6rem' }}>
                  As parcelas por pagar são substituídas pelo novo plano; as pagas mantêm o estado de pagas e os documentos — o valor/data podem ser corrigidos na lista.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.2rem' }}>
                  <button type="button" className="adm-btn" onClick={() => setPlanEdit(false)} disabled={planSaveBusy}>Cancelar</button>
                  <button type="button" className="adm-btn adm-btn-gold" onClick={handleSavePlan} disabled={planSaveBusy}>
                    {planSaveBusy ? 'A guardar…' : 'Guardar e gerar parcelas'}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="adm-plan-summary">
            <div className="adm-plan-item">
              <div className="adm-plan-item-label">
                {semPlano ? 'Honorários' : !isMonthly ? 'Total contratado' : 'Avença mensal'}
              </div>
              <div className="adm-plan-item-value" style={semPlano ? { fontSize: '0.95rem', lineHeight: 1.4 } : undefined}>
                {semPlano
                  ? (planType === 'probono' ? 'Pro bono' : (paid.length ? 'Fixados no trânsito' : 'Aguarda trânsito'))
                  : !isMonthly
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
            {semPlano ? null : !isMonthly ? (
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
                {semPlano ? 'Recebimentos' : !isMonthly ? 'Progresso' : 'Tempo ativo'}
              </div>
              <div className="adm-plan-item-value">{summary.progress}</div>
            </div>
          </div>

          {!(semPlano && installments.length === 0) && (
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
                    <td><StatusBadge installment={i} onUnmark={handleUnmarkPaid} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {DOC_TIPOS.map(([tipo, label]) => {
                          const doc = reciboInfo[i.id]?.[tipo];
                          const busy = reciboBusy === i.id;
                          return doc?.exists ? (
                            <span key={tipo} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
                              <button
                                type="button"
                                className="adm-btn"
                                data-tip={`Anexado a ${doc.uploaded_at ? fmtDocStamp(doc.uploaded_at) : '—'} — clique para abrir noutro separador`}
                                style={{
                                  fontSize: '0.7rem', padding: '0.28rem 0.7rem', lineHeight: 1.25,
                                  background: 'var(--forest, #12302a)', borderColor: 'var(--forest, #12302a)', color: '#fff',
                                }}
                                onClick={() => handleViewRecibo(i.id, tipo)}
                              >
                                <span style={{ display: 'block' }}>Ver {label}</span>
                                {doc.uploaded_at && (
                                  <span style={{ display: 'block', fontSize: '0.56rem', opacity: 0.8, fontWeight: 400 }}>
                                    {fmtDocStamp(doc.uploaded_at)}
                                  </span>
                                )}
                              </button>
                              <button
                                type="button"
                                className="adm-btn"
                                data-tip={`Remover ${label} anexado${tipo !== 'fatura' ? ' — sem Recibo/Fatura-Recibo a parcela volta a pendente' : ''}`}
                                disabled={busy}
                                onClick={() => handleRemoveParcelaDoc(i, tipo, label)}
                                style={{
                                  fontSize: '0.72rem', padding: '0.28rem 0.45rem', marginLeft: -1,
                                  color: '#b00000', borderColor: 'rgba(176,0,0,0.35)', lineHeight: 1,
                                }}
                                aria-label={`Remover ${label}`}
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <button
                              key={tipo}
                              type="button"
                              className={'adm-btn' + (dropTarget === `${i.id}|${tipo}` ? ' adm-drop-target' : '')}
                              data-tip={tipo === 'fatura'
                                ? 'Anexar PDF da fatura (não marca a parcela como paga) — clique ou arraste o PDF para aqui'
                                : `Anexar PDF — marca a parcela como paga. Clique ou arraste o PDF para aqui`}
                              style={{ fontSize: '0.7rem', padding: '0.32rem 0.7rem', whiteSpace: 'nowrap' }}
                              disabled={busy}
                              onClick={() => triggerAttach(i.id, tipo)}
                              onDragOver={(e) => { e.preventDefault(); setDropTarget(`${i.id}|${tipo}`); }}
                              onDragLeave={() => setDropTarget(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDropTarget(null);
                                const f = e.dataTransfer.files && e.dataTransfer.files[0];
                                if (f && !busy) doUploadDoc(i.id, tipo, f);
                              }}
                            >
                              {busy ? 'A anexar…' : `Anexar ${label}`}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </>
      )}

      {activeTab === 'summary' && (
        <div className="adm-card">
          <div className="adm-card-title">Resumo</div>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>{client.name}</strong>{(data.people || []).length > 0 && (
              <> — em conjunto com <strong>{(data.people || []).map((p) => p.name).join(' e ')}</strong> —</>
            )} é cliente desde {fmtDate(client.first_attendance_date || client.contract_start_date || client.created_at)},
            na área de <strong>{client.practice_area || 'geral'}</strong>.
          </p>
          <p>
            {semPlano
              ? (planType === 'oficioso'
                  ? <>Atendimento <strong>oficioso</strong> (nomeação da Ordem dos Advogados) — honorários fixados e recebidos após o trânsito em julgado{paid.length === 0 ? '; aguarda trânsito em julgado' : ''}.</>
                  : <>Atendimento <strong>pro bono</strong> — gratuito e voluntário, sem componente financeira.</>)
              : <>Plano contratado: {isMonthly
                  ? `avença mensal de ${fmtMoney(summary.monthlyValue, currency)}`
                  : `parcelado em ${client.honorarios_parcelas} prestações (total ${fmtMoney(client.honorarios_total, currency)})`}.</>}
          </p>
          {data.rules?.length > 0 && (
            <p>
              Lembretes configurados: {data.rules.map(r => `${r.days_before}d antes via ${r.channel}`).join(', ')}.
            </p>
          )}
          <ProcessosCard client={client} />
        </div>
      )}

      {activeTab === 'comms' && (
        <div>
          {commsLog === null && <div className="adm-empty">A carregar…</div>}
          {commsErr && <div className="adm-empty" style={{ color: '#b00' }}>Erro a carregar o histórico: {commsErr}</div>}
          {commsLog !== null && !commsErr && commsLog.length === 0 && (
            <div className="adm-empty">Ainda não foram enviadas comunicações a este cliente.</div>
          )}
          {commsLog !== null && commsLog.length > 0 && (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Enviado em</th>
                  <th>Canal</th>
                  <th>Estado</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {commsLog.map((n) => (
                  <tr key={n.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{fmtDate(n.sent_at)}</strong>
                      <span style={{ color: 'var(--muted, #888)', marginLeft: '0.4rem', fontSize: '0.8rem' }}>
                        {String(n.sent_at || '').slice(11, 16)}
                      </span>
                    </td>
                    <td>{n.channel === 'whatsapp' ? 'WhatsApp' : n.channel === 'email' ? 'E-mail' : n.channel}</td>
                    <td>
                      {n.status === 'sent' && <span style={{ color: 'var(--paid, #1a7a4a)' }}>Enviada</span>}
                      {n.status === 'skipped' && <span style={{ color: 'var(--muted, #888)' }}>Ignorada</span>}
                      {n.status === 'error' && (
                        <span style={{ color: '#b00' }} title={n.error_message || ''}>Falhou</span>
                      )}
                      {!['sent', 'skipped', 'error'].includes(n.status) && <span>{n.status}</span>}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--muted, #666)' }}>
                      {n.message_preview || '—'}
                      {n.status === 'error' && n.error_message && (
                        <div style={{ color: '#b00', fontSize: '0.78rem', marginTop: '0.15rem' }}>{n.error_message}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'notifs' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 1rem' }}>
            Lembretes automáticos enviados <strong>a este cliente</strong> antes de cada vencimento.
            Os alertas para a Dra. configuram-se na secção Notificações.
          </p>
          {cliRulesErr && <div className="adm-empty" style={{ color: '#b00' }}>Erro: {cliRulesErr}</div>}
          {cliRules === null && !cliRulesErr && <div className="adm-empty">A carregar…</div>}
          {cliRules !== null && cliRules.length === 0 && !cliRulesErr && (
            <div className="adm-empty">Sem lembretes configurados para este cliente.</div>
          )}
          {cliRules !== null && cliRules.length > 0 && (
            <table className="adm-table" style={{ marginBottom: '1.25rem' }}>
              <thead>
                <tr>
                  <th>Antecedência</th>
                  <th>Canal</th>
                  <th>Modelo</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Ativo</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {cliRules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.days_before === 0 ? 'No próprio dia' : `${rule.days_before} ${rule.days_before === 1 ? 'dia' : 'dias'} antes`}</td>
                    <td style={{ textTransform: 'capitalize' }}>{rule.channel}</td>
                    <td>{(ruleTemplates.find((t) => t.id === rule.template_id) || {}).name || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className={'adm-switch' + (rule.enabled ? '' : ' off')}
                        onClick={() => toggleCliRule(rule)}
                        aria-label={rule.enabled ? 'Desativar' : 'Ativar'}
                      />
                    </td>
                    <td>
                      <button type="button" className="adm-btn-ghost" onClick={() => deleteCliRule(rule)}>Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="adm-card" style={{ background: 'var(--paper)' }}>
            <div className="adm-card-title">Novo lembrete</div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="adm-field">
                <span className="adm-label">Canal</span>
                <select className="adm-input" value={newRule.channel} onChange={(e) => setNewRule({ ...newRule, channel: e.target.value })}>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label className="adm-field">
                <span className="adm-label">Dias antes do vencimento</span>
                <input className="adm-input" type="number" min="0" max="30" value={newRule.days_before}
                  onChange={(e) => setNewRule({ ...newRule, days_before: e.target.value })} style={{ width: 90 }} />
              </label>
              <label className="adm-field" style={{ minWidth: 220 }}>
                <span className="adm-label">Modelo</span>
                <select className="adm-input" value={newRule.template_id} onChange={(e) => setNewRule({ ...newRule, template_id: e.target.value })}>
                  <option value="">Automático (por canal)</option>
                  {ruleTemplates.filter((t) => t.channel === newRule.channel).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="adm-btn" onClick={createCliRule} disabled={ruleBusy}>
                {ruleBusy ? 'A criar…' : 'Adicionar lembrete'}
              </button>
            </div>
          </div>
        </div>
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
                style={{ width: '100%', fontFamily: "'Arial Unicode MS', Arial, 'Helvetica Neue', sans-serif", fontSize: '0.9rem', padding: '0.5rem' }}
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
                      <a href="#" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); docsApi.openInNewTab(d.id).catch((err) => admAlert(err.message)); }}>Abrir</a>
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

          <PeoplePicker
            people={pessoas}
            selected={[procPerson]}
            onChange={handlePickOutorgante}
            mode="single"
            disabled={procBusy}
            label="Outorgante desta procuração"
            helper="Uma procuração por outorgante — o documento é preenchido com os dados da pessoa assinalada. Os modelos atuais estão redigidos no singular; uma procuração conjunta (dois outorgantes no mesmo documento) precisa de um modelo no plural, a aprovar com a Dra."
          />

          {procTemplateId && (
            <>
              {procEditable.includes('poderes') && (
                <div className="adm-field">
                  <label>Processo</label>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <select
                      value={procRefs.includes(procSelectedRef) ? procSelectedRef : ''}
                      onChange={(e) => applyProcessoRef(e.target.value)}
                      disabled={procBusy}
                      style={{ maxWidth: 340 }}
                    >
                      <option value="">— digitar manualmente —</option>
                      {procRefs.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {!procRefs.includes(procSelectedRef) && (
                      <input
                        type="text"
                        value={procSelectedRef}
                        onChange={(e) => applyProcessoRef(e.target.value)}
                        placeholder="n.º do processo (ex.: 1289/26)"
                        disabled={procBusy}
                        style={{ flex: 1, minWidth: 220 }}
                      />
                    )}
                  </div>
                  <div className="adm-field-helper">
                    O processo escolhido (ou digitado) entra automaticamente nos poderes abaixo, no lugar de [INDICAR].
                  </div>
                </div>
              )}
              {procEditable.includes('poderes') && (
                <div className="adm-field">
                  <label>Poderes específicos (editável)</label>
                  <textarea
                    rows={5}
                    value={procOverrides.poderes || ''}
                    onChange={(e) => editPoderes(e.target.value)}
                    disabled={procBusy}
                    style={{ width: '100%', fontFamily: "'Arial Unicode MS', Arial, 'Helvetica Neue', sans-serif", fontSize: '0.9rem', padding: '0.6rem' }}
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


