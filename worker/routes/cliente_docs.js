// worker/routes/cliente_docs.js
// Endpoints para upload de documentos pelo CLIENTE (link público com token).
//
// ADMIN (precisa auth):
//   POST   /api/upload-tokens                     -> gera token { client_id, instructions?, days? }
//   GET    /api/upload-tokens?client_id=...       -> lista tokens do cliente
//   DELETE /api/upload-tokens/:token              -> revoga token
//   GET    /api/client-documents?client_id=...    -> lista documentos do cliente
//   GET    /api/client-documents/:id              -> serve o PDF/imagem (admin)
//   DELETE /api/client-documents/:id              -> remove documento
//
// PÚBLICO (sem auth, valida pelo token):
//   GET    /api/public/upload/:token              -> info do destinatário { client_name, instructions, expires_at, max_bytes }
//   POST   /api/public/upload/:token              -> recebe ficheiro (Content-Type=mime, X-Filename: original)
//
import { jsonResponse, jsonError } from "../lib/response.js";
import { sendEmail } from "../lib/senders.js";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = [
  "application/pdf",
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif",
];
const TOKEN_DAYS_DEFAULT = 30;

const CORS_PUBLIC = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Filename",
  "Access-Control-Max-Age": "86400",
};

function randomToken() {
  // 32 bytes -> 43 chars base64url (impossível de adivinhar)
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeFilename(name) {
  return String(name || "ficheiro").replace(/[^\w.\-\u00C0-\u017F ]/g, "_").slice(0, 120);
}

// ============== ADMIN ==============

export async function handleUploadTokens(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','upload-tokens', ?token]
  const tokenInPath = segments[2];
  const method = request.method;

  if (method === "POST" && !tokenInPath) {
    let body; try { body = await request.json(); } catch { return jsonError("Invalid JSON", 400); }
    const { client_id, instructions, days } = body || {};
    if (!client_id) return jsonError("client_id é obrigatório", 400);
    const c = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?").bind(client_id).first();
    if (!c) return jsonError("Cliente não encontrado", 404);
    const validDays = Math.max(1, Math.min(90, parseInt(days, 10) || TOKEN_DAYS_DEFAULT));
    const token = randomToken();
    const expires = new Date(Date.now() + validDays * 86400_000).toISOString();
    await env.DB.prepare(
      "INSERT INTO upload_tokens (token, client_id, instructions, expires_at, created_by) VALUES (?,?,?,?,?)"
    ).bind(token, client_id, instructions || null, expires, session?.user || null).run();
    return jsonResponse({ ok: true, token, expires_at: expires, client: { id: c.id, name: c.name }, days: validDays });
  }

  if (method === "GET" && !tokenInPath) {
    const url = new URL(request.url);
    const cid = url.searchParams.get("client_id");
    if (!cid) return jsonError("client_id em falta", 400);
    const r = await env.DB.prepare(
      "SELECT token, client_id, instructions, expires_at, created_at, used_count, last_used_at, revoked FROM upload_tokens WHERE client_id = ? ORDER BY created_at DESC"
    ).bind(cid).all();
    return jsonResponse({ tokens: r.results });
  }

  if (method === "DELETE" && tokenInPath) {
    await env.DB.prepare("UPDATE upload_tokens SET revoked = 1 WHERE token = ?").bind(tokenInPath).run();
    return jsonResponse({ ok: true, revoked: tokenInPath });
  }

  return jsonError("Method not allowed", 405);
}

export async function handleClientDocuments(request, env, path, session) {
  const segments = path.split("/").filter(Boolean); // ['api','client-documents', ?id]
  const docId = segments[2];
  const method = request.method;

  if (method === "GET" && !docId) {
    const url = new URL(request.url);
    const cid = url.searchParams.get("client_id");
    if (!cid) return jsonError("client_id em falta", 400);
    const r = await env.DB.prepare(
      "SELECT id, client_id, filename, size_bytes, content_type, uploaded_at, uploaded_via FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC"
    ).bind(cid).all();
    return jsonResponse({ documents: r.results });
  }

  if (method === "GET" && docId) {
    const doc = await env.DB.prepare("SELECT * FROM client_documents WHERE id = ?").bind(docId).first();
    if (!doc) return jsonError("Documento não encontrado", 404);
    if (!env.RECIBOS) return jsonError("Armazenamento indisponível", 500);
    const obj = await env.RECIBOS.get(doc.r2_key).catch(() => null);
    if (!obj) return jsonError("Ficheiro em falta no armazenamento", 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": doc.content_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${doc.filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  if (method === "DELETE" && docId) {
    const doc = await env.DB.prepare("SELECT r2_key FROM client_documents WHERE id = ?").bind(docId).first();
    if (!doc) return jsonError("Documento não encontrado", 404);
    if (env.RECIBOS) await env.RECIBOS.delete(doc.r2_key).catch(() => {});
    await env.DB.prepare("DELETE FROM client_documents WHERE id = ?").bind(docId).run();
    return jsonResponse({ ok: true, deleted: docId });
  }

  return jsonError("Method not allowed", 405);
}

// ============== PÚBLICO (sem auth) ==============

export async function handlePublicUpload(request, env, path) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_PUBLIC });

  const segments = path.split("/").filter(Boolean); // ['api','public','upload',token]
  const token = segments[3];
  if (!token) return jsonError("Token em falta", 400);

  const t = await env.DB.prepare("SELECT * FROM upload_tokens WHERE token = ?").bind(token).first();
  if (!t) return jsonError("Link inválido", 404);
  if (t.revoked) return jsonError("Este link foi revogado.", 410);
  if (new Date(t.expires_at) < new Date()) return jsonError("Este link expirou.", 410);

  const client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?").bind(t.client_id).first();
  if (!client) return jsonError("Cliente associado não encontrado", 404);

  if (request.method === "GET") {
    // info — para a página pública mostrar quem é o destinatário
    const docs = await env.DB.prepare(
      "SELECT id, filename, size_bytes, uploaded_at FROM client_documents WHERE token = ? ORDER BY uploaded_at DESC"
    ).bind(token).all();
    return new Response(JSON.stringify({
      ok: true,
      client_name: client.name,
      instructions: t.instructions || null,
      expires_at: t.expires_at,
      max_bytes: MAX_BYTES,
      allowed: ALLOWED_MIME,
      uploaded: docs.results || [],
    }), { headers: { "Content-Type": "application/json", ...CORS_PUBLIC } });
  }

  if (request.method === "POST") {
    const ct = (request.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    if (!ALLOWED_MIME.includes(ct)) {
      return jsonError("Tipo de ficheiro não permitido. Envie PDF, JPG, PNG ou WEBP.", 415);
    }
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength === 0) return jsonError("Ficheiro vazio.", 400);
    if (buf.byteLength > MAX_BYTES) return jsonError(`Ficheiro demasiado grande (máx. ${MAX_BYTES / 1024 / 1024} MB).`, 413);

    // validação rápida da magic number
    const head = new Uint8Array(buf.slice(0, 12));
    const looksOK =
      (ct === "application/pdf" && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) ||
      (ct.startsWith("image/png") && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) ||
      (ct.startsWith("image/jpeg") || ct.startsWith("image/jpg")) && head[0] === 0xFF && head[1] === 0xD8 ||
      (ct === "image/webp" && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) ||
      (ct === "image/heic" || ct === "image/heif");
    if (!looksOK) return jsonError("Conteúdo não corresponde ao tipo declarado.", 415);

    if (!env.RECIBOS) return jsonError("Armazenamento indisponível", 500);

    const filenameRaw = request.headers.get("x-filename") || `documento.${ct.split("/")[1] || "bin"}`;
    const filename = safeFilename(filenameRaw);
    const docId = crypto.randomUUID();
    const ts = Date.now();
    const r2key = `documentos/${client.id}/${ts}-${docId}-${filename}`;

    await env.RECIBOS.put(r2key, buf, {
      httpMetadata: { contentType: ct },
      customMetadata: { client_id: client.id, token, uploaded_at: new Date().toISOString(), original_name: filename },
    });

    await env.DB.prepare(
      "INSERT INTO client_documents (id, client_id, filename, r2_key, size_bytes, content_type, uploaded_via, token) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(docId, client.id, filename, r2key, buf.byteLength, ct, "client-link", token).run();

    await env.DB.prepare(
      "UPDATE upload_tokens SET used_count = used_count + 1, last_used_at = datetime('now') WHERE token = ?"
    ).bind(token).run();

    // Notificar a Vyvian por email (não bloqueia o upload se falhar)
    if (env.ADMIN_EMAIL && env.RESEND_API_KEY) {
      const sizeKB = Math.round(buf.byteLength / 1024);
      const subject = `📎 ${client.name} enviou um documento (${filename})`;
      const text =
        `Olá Vyvian,\n\n` +
        `O cliente "${client.name}" acabou de enviar um documento através do link de upload:\n\n` +
        `  • Ficheiro: ${filename}\n` +
        `  • Tamanho: ${sizeKB} KB\n` +
        `  • Tipo: ${ct}\n\n` +
        `Pode consultá-lo no separador "Documentos" da ficha do cliente.\n\n` +
        `— Sistema Vyvian Avena Advogada`;
      // não esperamos o resultado para não atrasar a resposta ao cliente
      sendEmail(env, { to: env.ADMIN_EMAIL, subject, text }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, id: docId, filename, size: buf.byteLength }), {
      headers: { "Content-Type": "application/json", ...CORS_PUBLIC },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...CORS_PUBLIC },
  });
}
