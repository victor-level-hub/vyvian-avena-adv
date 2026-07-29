// src/admin/pages/Configuracoes.jsx — Configurações → Gestão de utilizadores
// Design system v3 (RsShell). Criar utilizador envia convite por e-mail (Resend)
// com link /admin/convite/<token> onde a pessoa define a password.
// Sem tabela de perfis: acesso por flags de aba + «Gerir utilizadores».
import React, { useState, useEffect, useCallback } from 'react';
import { config as configApi } from '../apiClient';
import { getSession } from '../auth';
import { SkeletonPage } from '../skeletons';
import { admToast } from '../toasts';
import { admConfirm, admAlert } from '../dialogs';
import ModalClose from '../modal-close';
import { RsShell, Icon, Reveal } from '../rs/ui';

const ABAS = [
  { k: 'painel', label: 'Painel' },
  { k: 'clientes', label: 'Clientes' },
  { k: 'parcelas', label: 'Parcelas' },
  { k: 'calendario', label: 'Calendário' },
  { k: 'notificacoes', label: 'Notificações' },
  { k: 'estatisticas', label: 'Redes Sociais' },
  { k: 'apoio', label: 'Apoio Técnico' },
  { k: 'configuracoes', label: 'Configurações' },
];
const ESPECIAIS = [
  { k: 'gerir_utilizadores', label: 'Gerir utilizadores', desc: 'Criar, editar e apagar utilizadores' },
];
const nomePerm = (k) => (k === '*' ? 'Acesso total' : [...ABAS, ...ESPECIAIS].find((a) => a.k === k)?.label || k);

const fmtDataHora = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
};

function FotoUser({ user, size = 40 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true; let obj = null;
    if (user.has_photo) {
      configApi.fotoObjectUrl(user.id).then((u) => { if (alive && u) { obj = u; setUrl(u); } else if (u) URL.revokeObjectURL(u); });
    } else setUrl(null);
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [user.id, user.has_photo]);
  return url ? (
    <img src={url} alt={user.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid var(--edge-2)', flex: 'none' }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: '50%', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                   background: 'var(--grad-gold)', color: '#1a1208', fontWeight: 800, fontSize: size * 0.34 }}>
      {user.initials}
    </span>
  );
}

/* =============================== MODAL =============================== */
const FORM_VAZIO = { name: '', email: '', cargo: '', phone: '', permissions: ['painel'] };

function UserModal({ user, onClose, onChanged }) {
  const editar = !!user;
  const [form, setForm] = useState(editar
    ? { name: user.name, email: user.email, cargo: user.cargo || '', phone: user.phone || '', permissions: user.permissions }
    : FORM_VAZIO);
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const total = form.permissions.includes('*');

  const togglePerm = (k) => setForm((f) => {
    if (k === '*') return { ...f, permissions: f.permissions.includes('*') ? ['painel'] : ['*'] };
    const sem = f.permissions.filter((p) => p !== '*');
    return { ...f, permissions: sem.includes(k) ? sem.filter((p) => p !== k) : [...sem, k] };
  });

  const escolherFoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { admAlert('Escolha uma imagem.'); return; }
    if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    setFotoFile(f); setFotoPreview(URL.createObjectURL(f));
    e.target.value = '';
  };

  const guardar = async () => {
    if (!form.name.trim()) { admAlert('Indique o nome.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { admAlert('Indique um e-mail válido.'); return; }
    if (!form.permissions.length) { admAlert('Escolha pelo menos uma aba de acesso.'); return; }
    setBusy(true);
    try {
      if (editar) {
        await configApi.updateUser(user.id, form);
        if (fotoFile) await configApi.uploadFoto(user.id, fotoFile);
        admToast('Utilizador atualizado.');
      } else {
        const r = await configApi.createUser(form);
        if (fotoFile && r.user?.id) await configApi.uploadFoto(r.user.id, fotoFile);
        admToast(r.convite_enviado
          ? `Utilizador criado — convite enviado para ${form.email}.`
          : 'Utilizador criado, mas o envio do e-mail falhou. Use «Reenviar convite».',
          r.convite_enviado ? {} : { kind: 'error' });
      }
      onChanged(); onClose();
    } catch (e) { admAlert('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const label = { display: 'block', fontSize: 9, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 7 };
  const input = { width: '100%', padding: '10px 14px', fontSize: 13.5, caretColor: 'var(--gold)' };

  return (
    <div className="adm-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass" style={{ width: 'min(620px, 94vw)', maxHeight: '92vh', overflowY: 'auto', padding: '26px 28px', position: 'relative' }}>
        <ModalClose onClose={onClose} />
        <span className="overline">Configurações · Utilizadores</span>
        <h3 style={{ fontSize: 20, margin: '8px 0 18px' }}>{editar ? 'Editar utilizador' : 'Novo utilizador'}</h3>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {fotoPreview
              ? <img src={fotoPreview} alt="" style={{ width: 62, height: 62, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid var(--gold)' }} />
              : editar ? <FotoUser user={user} size={62} />
              : <span style={{ width: 62, height: 62, borderRadius: '50%', background: 'var(--panel)', border: '1.5px dashed var(--edge-2)',
                               display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}><Icon name="image" size={20} /></span>}
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              <Icon name="image" size={13} />{fotoPreview || (editar && user.has_photo) ? 'Trocar foto' : 'Carregar foto'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={escolherFoto} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span style={label}>Nome *</span>
              <input className="field" style={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={busy} />
            </div>
            <div>
              <span style={label}>Cargo</span>
              <input className="field" style={input} value={form.cargo} placeholder="Ex.: Advogada, Assistente…"
                     onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} disabled={busy} />
            </div>
            <div>
              <span style={label}>E-mail * {!editar && <em style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(recebe o convite)</em>}</span>
              <input className="field" style={input} type="email" value={form.email}
                     onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={busy} />
            </div>
            <div>
              <span style={label}>Telefone</span>
              <input className="field" style={input} value={form.phone} placeholder="+351 …"
                     onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} disabled={busy} />
            </div>
          </div>

          <div>
            <span style={label}>Acessos na Área Privada</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--fg)', cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox" checked={total} onChange={() => togglePerm('*')} disabled={busy} style={{ accentColor: 'var(--gold)', width: 15, height: 15 }} />
              <strong>Acesso total</strong>
              <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>— todas as abas + gestão de utilizadores</span>
            </label>
            {!total && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px 14px' }}>
                  {ABAS.map((a) => (
                    <label key={a.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.permissions.includes(a.k)} onChange={() => togglePerm(a.k)} disabled={busy}
                             style={{ accentColor: 'var(--gold)', width: 14, height: 14 }} />
                      {a.label}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--edge)' }}>
                  {ESPECIAIS.map((a) => (
                    <label key={a.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.permissions.includes(a.k)} onChange={() => togglePerm(a.k)} disabled={busy}
                             style={{ accentColor: 'var(--gold)', width: 14, height: 14 }} />
                      {a.label}
                      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>— {a.desc}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, borderTop: '1px solid var(--edge)', paddingTop: 18 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-gold btn-sm" onClick={guardar} disabled={busy}>
            <Icon name="check" size={13} />
            {busy ? 'A guardar…' : editar ? 'Guardar alterações' : 'Criar e enviar convite'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =============================== PÁGINA =============================== */
export default function Configuracoes() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aberto, setAberto] = useState({});    // id -> bool (expansor de acessos)
  const [modal, setModal] = useState(null);    // { user: obj|null }
  const eu = getSession();

  const carregar = useCallback(async () => {
    try { const d = await configApi.listUsers(); setUsers(d.users || []); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const apagar = async (u) => {
    const ok = await admConfirm(`Apagar o utilizador «${u.name}» (${u.email})?\n\nEsta ação não pode ser anulada.`);
    if (!ok) return;
    try { await configApi.deleteUser(u.id); admToast('Utilizador apagado.'); carregar(); }
    catch (e) { admAlert('Erro: ' + e.message); }
  };
  const reenviar = async (u) => {
    try {
      const r = await configApi.reenviarConvite(u.id);
      admToast(r.ok ? `Convite reenviado para ${u.email}.` : 'O envio do e-mail falhou: ' + (r.envio?.error || ''), r.ok ? {} : { kind: 'error' });
    } catch (e) { admAlert('Erro: ' + e.message); }
  };

  if (loading) return <SkeletonPage kpis={0} rows={4} />;
  if (error) return <div className="adm-login-error">{error}</div>;

  return (
    <RsShell overline="Área privada · Configurações" titulo="Configurações"
             sub={`${users.length} ${users.length === 1 ? 'utilizador' : 'utilizadores'} com acesso à Área Privada`}
             right={<button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 4 }} onClick={() => setModal({ user: null })}>
                      <Icon name="plus" size={13} />Novo utilizador
                    </button>}>

      <Reveal>
        <div className="glass" style={{ padding: '8px 10px' }}>
          {users.map((u, idx) => {
            const exp = !!aberto[u.id];
            const perms = u.permissions.includes('*')
              ? [...ABAS.map((a) => a.label), ...ESPECIAIS.map((a) => a.label)]
              : u.permissions.map(nomePerm);
            return (
              <div key={u.id} style={{ borderBottom: idx < users.length - 1 ? '1px solid var(--edge)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 12px', flexWrap: 'wrap' }}>
                  <FotoUser user={u} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{u.name}</strong>
                      {u.cargo && <span style={{ fontSize: 11.5, color: 'var(--gold-soft)' }}>{u.cargo}</span>}
                      {u.id === eu?.id && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.1em', color: 'var(--fg-3)', border: '1px solid var(--edge-2)', borderRadius: 999, padding: '1px 8px' }}>VOCÊ</span>}
                      {u.status === 'convidado' && (
                        <span data-tip={'Convite por concluir' + (u.invite_expires ? ' · expira ' + fmtDataHora(u.invite_expires) : '')}
                              style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.1em', color: '#e0a35b',
                                       background: 'rgba(224,163,91,.12)', border: '1px solid var(--edge-2)', borderRadius: 999, padding: '1px 8px' }}>
                          CONVITE PENDENTE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 3 }}>
                      {u.email}{u.phone ? ` · ${u.phone}` : ''} · criado a {fmtDataHora(u.created_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {u.status === 'convidado' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => reenviar(u)} data-tip="Reenviar o e-mail de convite">
                        <Icon name="refresh" size={12} />Reenviar convite
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ user: u })} data-tip="Editar utilizador">
                      <Icon name="edit" size={12} />
                    </button>
                    {u.id !== eu?.id && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => apagar(u)} data-tip="Apagar utilizador"
                              style={{ color: '#e08b8b' }}>
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto((a) => ({ ...a, [u.id]: !exp }))}
                            data-tip={exp ? 'Ocultar acessos' : 'Ver a que abas tem acesso'} aria-expanded={exp}>
                      <Icon name="chev" size={13} style={{ transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
                    </button>
                  </div>
                </div>
                {exp && (
                  <div style={{ padding: '0 12px 14px 66px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {u.permissions.includes('*') && (
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1a1208',
                                     background: 'var(--grad-gold)', borderRadius: 999, padding: '3px 10px' }}>Acesso total</span>
                    )}
                    {perms.map((p) => (
                      <span key={p} style={{ fontSize: 11, color: 'var(--fg-2)', border: '1px solid var(--edge-2)',
                                             background: 'var(--panel)', borderRadius: 999, padding: '3px 10px' }}>{p}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Reveal>

      {modal && <UserModal user={modal.user} onClose={() => setModal(null)} onChanged={carregar} />}
    </RsShell>
  );
}
