// worker/routes/config.js — Configurações → Gestão de utilizadores
//
// Autenticadas (sob /api/config; exigem permissão 'gerir_utilizadores' ou '*'):
//   GET    /api/config/users                       -> { users }
//   POST   /api/config/users                       -> cria + envia convite por e-mail (Resend)
//   PATCH  /api/config/users/:id                   -> edita nome/email/cargo/telefone/permissões
//   DELETE /api/config/users/:id                   -> apaga (guardas: nunca a si próprio nem o último gestor)
//   POST   /api/config/users/:id/convite           -> regenera token e reenvia o e-mail de convite
//   POST   /api/config/users/:id/foto   (binário)  -> foto de perfil no R2
//   GET    /api/config/users/:id/foto              -> serve a foto
//   DELETE /api/config/users/:id/foto              -> remove a foto
//
// Públicas (sob /api/public/convite; validam pelo token do e-mail):
//   GET    /api/public/convite/:token              -> { name, email, cargo, phone } (pré-preenche o registo)
//   POST   /api/public/convite/:token              -> { password, name?, cargo?, phone? } conclui o registo
//   POST   /api/public/convite/:token/foto (bin.)  -> foto durante o registo

import { jsonResponse, jsonError } from "../lib/response.js";
import { hashPassword } from "../lib/auth.js";
import { sendEmail } from "../lib/senders.js";

export const PERMISSOES = [
  "painel", "clientes", "parcelas", "calendario", "notificacoes",
  "estatisticas", "apoio", "configuracoes", "gerir_utilizadores",
];
const MAX_FOTO = 5 * 1024 * 1024;

const parsePerms = (s) => { try { const p = JSON.parse(s || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } };
const temGestao = (perms) => perms.includes("*") || perms.includes("gerir_utilizadores");
const initials = (name) => (name || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const pub = (u) => ({
  id: u.id, email: u.email, name: u.name, initials: u.initials, cargo: u.cargo,
  phone: u.phone, status: u.status, permissions: parsePerms(u.permissions),
  created_at: u.created_at, has_photo: !!u.photo_key,
  invite_expires: u.status === "convidado" ? u.invite_expires : undefined,
});

async function enviarConvite(env, user, token) {
  const link = `https://vyavenaadv.com/admin/convite/${token}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f5f0e8;padding:32px;border-radius:12px">
    <h2 style="color:#12302a;margin:0 0 6px;font-weight:600">Vyvian Avena Advogada</h2>
    <p style="color:#b8935a;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:0 0 22px">Área Privada · Convite de acesso</p>
    <p style="color:#333;line-height:1.6">Olá, <strong>${user.name}</strong>,</p>
    <p style="color:#333;line-height:1.6">Foi criado um acesso para si na Área Privada do escritório. Para concluir o registo, defina a sua palavra-passe através do botão abaixo:</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${link}" style="background:#12302a;color:#f5f0e8;text-decoration:none;padding:13px 30px;border-radius:8px;display:inline-block;font-weight:600">Concluir o meu registo</a>
    </p>
    <p style="color:#777;font-size:12.5px;line-height:1.6">O link é válido durante 7 dias. Se não esperava este convite, ignore este e-mail.</p>
    <p style="color:#777;font-size:12.5px">Se o botão não funcionar, copie este endereço:<br><a href="${link}" style="color:#b8935a">${link}</a></p>
  </div>`;
  return sendEmail(env, {
    to: user.email,
    subject: "Convite — Área Privada · Vyvian Avena Advogada",
    html,
    text: `Olá ${user.name}, foi criado um acesso para si na Área Privada. Conclua o registo em: ${link} (válido 7 dias).`,
  });
}

function novoToken() {
  const u8 = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
}
const expira7d = () => new Date(Date.now() + 7 * 86400 * 1000).toISOString();

// ============================== PÚBLICO (convite) ==============================
export async function handlePublicConvite(request, env, path) {
  const m = path.match(/^\/api\/public\/convite\/([a-f0-9]{48})(\/foto)?$/);
  if (!m) return jsonError("Not found", 404);
  const user = await env.DB.prepare(
    `SELECT * FROM users WHERE invite_token = ? AND status = 'convidado'`
  ).bind(m[1]).first();
  if (!user) return jsonError("Convite inválido ou já utilizado.", 404);
  if (user.invite_expires && new Date(user.invite_expires) < new Date()) {
    return jsonError("Este convite expirou. Peça um novo convite.", 410);
  }

  if (m[2] === "/foto" && request.method === "POST") {
    const ct = request.headers.get("Content-Type") || "";
    if (!ct.startsWith("image/")) return jsonError("Envie uma imagem.", 400);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_FOTO) return jsonError("Imagem vazia ou acima de 5 MB.", 400);
    const key = `users/${user.id}/foto-${Date.now()}`;
    if (user.photo_key) await env.RECIBOS.delete(user.photo_key).catch(() => {});
    await env.RECIBOS.put(key, buf, { httpMetadata: { contentType: ct } });
    await env.DB.prepare(`UPDATE users SET photo_key = ?, updated_at = datetime('now') WHERE id = ?`).bind(key, user.id).run();
    return jsonResponse({ ok: true });
  }

  if (!m[2] && request.method === "GET") {
    return jsonResponse({ name: user.name, email: user.email, cargo: user.cargo, phone: user.phone, has_photo: !!user.photo_key });
  }

  if (!m[2] && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const password = String(body.password || "");
    if (password.length < 8) return jsonError("A palavra-passe deve ter pelo menos 8 caracteres.", 400);
    const name = String(body.name || user.name).trim() || user.name;
    const hash = await hashPassword(password);
    await env.DB.prepare(`
      UPDATE users SET password_hash = ?, name = ?, initials = ?, cargo = ?, phone = ?,
                       status = 'ativo', invite_token = NULL, invite_expires = NULL,
                       updated_at = datetime('now')
      WHERE id = ?
    `).bind(hash, name, initials(name), body.cargo ?? user.cargo, body.phone ?? user.phone, user.id).run();
    return jsonResponse({ ok: true });
  }

  return jsonError("Método não suportado.", 405);
}

// ============================== AUTENTICADO ==============================
export async function handleConfig(request, env, path, session) {
  // permissão verificada na BD (não no JWT, que pode estar desatualizado)
  const eu = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(session.sub).first();
  if (!eu) return jsonError("Unauthorized", 401);
  const minhas = parsePerms(eu.permissions);
  if (!temGestao(minhas)) return jsonError("Sem permissão para gerir utilizadores.", 403);

  const method = request.method;

  if (path === "/api/config/users") {
    if (method === "GET") {
      const { results } = await env.DB.prepare(`SELECT * FROM users ORDER BY created_at`).all();
      return jsonResponse({ users: (results || []).map(pub), permissoes_disponiveis: PERMISSOES });
    }
    if (method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!name) return jsonError("Indique o nome.", 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("E-mail inválido.", 400);
      const dup = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
      if (dup) return jsonError("Já existe um utilizador com esse e-mail.", 409);
      let perms = Array.isArray(body.permissions) ? body.permissions.filter((p) => PERMISSOES.includes(p)) : [];
      if (!perms.length) perms = ["painel"];
      const id = "usr_" + crypto.randomUUID().slice(0, 12);
      // password aleatória inutilizável até o convite ser concluído
      const hash = await hashPassword(novoToken() + novoToken());
      const token = novoToken();
      await env.DB.prepare(`
        INSERT INTO users (id, email, password_hash, name, initials, role, cargo, phone, permissions, status, invite_token, invite_expires)
        VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, 'convidado', ?, ?)
      `).bind(id, email, hash, name, initials(name), body.cargo || null, body.phone || null,
              JSON.stringify(perms), token, expira7d()).run();
      const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
      const envio = await enviarConvite(env, user, token);
      return jsonResponse({ ok: true, user: pub(user), convite_enviado: !!envio.ok, envio }, 201);
    }
    return jsonError("Método não suportado.", 405);
  }

  const m = path.match(/^\/api\/config\/users\/([\w-]+)(\/(convite|foto))?$/);
  if (!m) return jsonError("Not found", 404);
  const alvo = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(m[1]).first();
  if (!alvo) return jsonError("Utilizador não encontrado.", 404);
  const acao = m[3] || null;

  // quantos gestores ativos existem (para nunca ficar zero)
  const gestores = async () => {
    const { results } = await env.DB.prepare(`SELECT id, permissions FROM users`).all();
    return (results || []).filter((u) => temGestao(parsePerms(u.permissions)));
  };

  if (!acao && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const sets = []; const binds = [];
    if (body.name != null && String(body.name).trim()) {
      const n = String(body.name).trim();
      sets.push("name = ?", "initials = ?"); binds.push(n, initials(n));
    }
    if (body.email != null) {
      const e2 = String(body.email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e2)) return jsonError("E-mail inválido.", 400);
      const dup = await env.DB.prepare(`SELECT id FROM users WHERE email = ? AND id != ?`).bind(e2, alvo.id).first();
      if (dup) return jsonError("Já existe um utilizador com esse e-mail.", 409);
      sets.push("email = ?"); binds.push(e2);
    }
    if ("cargo" in body) { sets.push("cargo = ?"); binds.push(body.cargo || null); }
    if ("phone" in body) { sets.push("phone = ?"); binds.push(body.phone || null); }
    if (Array.isArray(body.permissions)) {
      const perms = body.permissions.includes("*") ? ["*"]
        : body.permissions.filter((p) => PERMISSOES.includes(p));
      if (!perms.length) return jsonError("O utilizador tem de ter acesso a pelo menos uma aba.", 400);
      // guarda: não deixar o sistema sem nenhum gestor
      if (temGestao(parsePerms(alvo.permissions)) && !temGestao(perms)) {
        const g = await gestores();
        if (g.length <= 1) return jsonError("Não pode remover a gestão de utilizadores ao único gestor.", 400);
      }
      sets.push("permissions = ?"); binds.push(JSON.stringify(perms));
    }
    if (!sets.length) return jsonResponse({ ok: true, user: pub(alvo) });
    sets.push("updated_at = datetime('now')");
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, alvo.id).run();
    const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(alvo.id).first();
    return jsonResponse({ ok: true, user: pub(user) });
  }

  if (!acao && method === "DELETE") {
    if (alvo.id === eu.id) return jsonError("Não pode apagar o seu próprio utilizador.", 400);
    if (temGestao(parsePerms(alvo.permissions))) {
      const g = await gestores();
      if (g.length <= 1) return jsonError("Não pode apagar o único gestor de utilizadores.", 400);
    }
    if (alvo.photo_key) await env.RECIBOS.delete(alvo.photo_key).catch(() => {});
    await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(alvo.id).run();
    return jsonResponse({ ok: true });
  }

  if (acao === "convite" && method === "POST") {
    if (alvo.status !== "convidado") return jsonError("O utilizador já concluiu o registo.", 400);
    const token = novoToken();
    await env.DB.prepare(`UPDATE users SET invite_token = ?, invite_expires = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(token, expira7d(), alvo.id).run();
    const envio = await enviarConvite(env, alvo, token);
    return jsonResponse({ ok: !!envio.ok, envio });
  }

  if (acao === "foto") {
    if (method === "POST") {
      const ct = request.headers.get("Content-Type") || "";
      if (!ct.startsWith("image/")) return jsonError("Envie uma imagem.", 400);
      const buf = await request.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_FOTO) return jsonError("Imagem vazia ou acima de 5 MB.", 400);
      const key = `users/${alvo.id}/foto-${Date.now()}`;
      if (alvo.photo_key) await env.RECIBOS.delete(alvo.photo_key).catch(() => {});
      await env.RECIBOS.put(key, buf, { httpMetadata: { contentType: ct } });
      await env.DB.prepare(`UPDATE users SET photo_key = ?, updated_at = datetime('now') WHERE id = ?`).bind(key, alvo.id).run();
      return jsonResponse({ ok: true });
    }
    if (method === "GET") {
      if (!alvo.photo_key) return jsonError("Sem foto.", 404);
      const obj = await env.RECIBOS.get(alvo.photo_key);
      if (!obj) return jsonError("Sem foto.", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    if (method === "DELETE") {
      if (alvo.photo_key) await env.RECIBOS.delete(alvo.photo_key).catch(() => {});
      await env.DB.prepare(`UPDATE users SET photo_key = NULL, updated_at = datetime('now') WHERE id = ?`).bind(alvo.id).run();
      return jsonResponse({ ok: true });
    }
  }

  return jsonError("Not found", 404);
}
