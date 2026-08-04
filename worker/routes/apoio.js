// worker/routes/apoio.js — Apoio Técnico (tickets de erros/melhorias/demandas)
//
// Endpoints (sob /api/apoio, todos autenticados):
//   GET    /api/apoio/tickets                      ?status=&urgencia=&q=      -> { tickets }
//   POST   /api/apoio/tickets                      body {titulo, ...}         -> { ticket }  (gera ID AT-AAAA-NNN)
//   GET    /api/apoio/tickets/:id                                             -> { ticket, anexos, log }
//   PATCH  /api/apoio/tickets/:id                  body {campos...}           -> { ticket }  (regista no log)
//   POST   /api/apoio/tickets/:id/abrir                                       -> passa rascunho -> aberto (data/hora)
//   POST   /api/apoio/tickets/:id/analisar                                    -> IA: complexidade + plano (Gemini)
//   POST   /api/apoio/tickets/:id/executar                                    -> "Efetuar Alteração": status em_execucao
//   POST   /api/apoio/tickets/:id/aprovar                                     -> e-mail à Dra. + status em_aprovacao
//   POST   /api/apoio/tickets/:id/anexos           ?tipo=&nome=  (binário)    -> { anexo }   (R2)
//   GET    /api/apoio/anexos/:anexoId                                         -> ficheiro (stream do R2)
//   DELETE /api/apoio/anexos/:anexoId                                         -> { ok }
//   POST   /api/apoio/transcrever                  (áudio binário)            -> { text }    (Workers AI Whisper)
//
// Fase 1 do "Efetuar Alteração": o botão marca o ticket como em_execucao e o
// Claude, em sessão do projeto, lê o ticket pela API, executa a alteração e
// atualiza status/resolucao/impedimentos via PATCH.

import { jsonResponse, jsonError } from "../lib/response.js";
import { sendEmail } from "../lib/senders.js";

const HOJE_LX = () => {
  // data/hora de Lisboa (o D1 guarda datetime('now') em UTC; a abertura fica legível)
  const f = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => f.find((p) => p.type === t)?.value || "";
  return { data: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
};

const STATUS_VALIDOS = ["rascunho", "aberto", "em_analise", "em_execucao", "em_aprovacao", "impedimento", "resolvido", "cancelado"];
const URGENCIAS = ["baixa", "media", "alta", "critica"];
const TIPOS_ANEXO = ["anexo", "print_abertura", "print_conclusao", "audio"];
const CAMPOS_EDITAVEIS = [
  "titulo", "descricao", "status", "urgencia", "complexidade", "complexidade_justificacao",
  "plano_ia", "impedimentos", "resolucao", "data_prazo", "criado_por",
];
const MAX_ANEXO = 20 * 1024 * 1024;  // 20 MB
const MAX_AUDIO = 15 * 1024 * 1024;  // ~15 MB (vários minutos de webm/opus)

async function log(env, ticketId, evento, detalhe, autor) {
  await env.DB.prepare(
    `INSERT INTO ticket_log (ticket_id, evento, detalhe, autor) VALUES (?, ?, ?, ?)`
  ).bind(ticketId, evento, detalhe || null, autor || null).run();
}

async function novoId(env) {
  const ano = HOJE_LX().data.slice(0, 4);
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE id LIKE ?`)
    .bind(`AT-${ano}-%`).first();
  return `AT-${ano}-${String((r?.n || 0) + 1).padStart(3, "0")}`;
}

async function carregarTicket(env, id) {
  return env.DB.prepare(`SELECT * FROM tickets WHERE id = ?`).bind(id).first();
}

export async function handleApoio(request, env, path, session) {
  const method = request.method;
  const autor = session?.name || "Victor";

  // ---- transcrição de áudio (Workers AI Whisper) ----
  if (path === "/api/apoio/transcrever" && method === "POST") {
    if (!env.AI) return jsonError("Workers AI indisponível (binding AI em falta).", 503);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return jsonError("Áudio vazio.", 400);
    if (buf.byteLength > MAX_AUDIO) return jsonError("Áudio demasiado longo (máx. 15 MB).", 413);
    try {
      // whisper-large-v3-turbo: áudio em base64; deteta o idioma (PT) automaticamente
      let b64 = "";
      const u8 = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      b64 = btoa(b64);
      const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: b64, language: "pt" });
      return jsonResponse({ ok: true, text: (out?.text || "").trim() });
    } catch (e) {
      return jsonError("Falha na transcrição: " + e.message, 502);
    }
  }

  // ---- servir / apagar anexo ----
  let m = path.match(/^\/api\/apoio\/anexos\/(\d+)$/);
  if (m) {
    const anexo = await env.DB.prepare(`SELECT * FROM ticket_anexos WHERE id = ?`).bind(+m[1]).first();
    if (!anexo) return jsonError("Anexo não encontrado.", 404);
    if (method === "GET") {
      const obj = await env.RECIBOS.get(anexo.r2_key);
      if (!obj) return jsonError("Ficheiro não encontrado no armazenamento.", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": anexo.content_type || "application/octet-stream",
          "Content-Disposition": `inline; filename="${(anexo.nome || "anexo").replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    if (method === "DELETE") {
      await env.RECIBOS.delete(anexo.r2_key).catch(() => {});
      await env.DB.prepare(`DELETE FROM ticket_anexos WHERE id = ?`).bind(anexo.id).run();
      await log(env, anexo.ticket_id, "anexo", `Removido: ${anexo.nome || anexo.r2_key}`, autor);
      return jsonResponse({ ok: true });
    }
    if (method === "PATCH") {
      // guarda a transcrição de um anexo de áudio
      // corpo literal "null": o request.json() devolve null, o .catch() nao dispara
      const body = (await request.json().catch(() => ({}))) || {};
      if (typeof body.transcricao !== "string") return jsonError("Campo transcricao em falta.", 400);
      await env.DB.prepare(`UPDATE ticket_anexos SET transcricao = ? WHERE id = ?`)
        .bind(body.transcricao, anexo.id).run();
      return jsonResponse({ ok: true });
    }
    return jsonError("Método não suportado.", 405);
  }

  // ---- lista / criação ----
  if (path === "/api/apoio/tickets") {
    if (method === "GET") {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const urgencia = url.searchParams.get("urgencia");
      const q = (url.searchParams.get("q") || "").trim();
      let sql = `SELECT t.*, (SELECT COUNT(*) FROM ticket_anexos a WHERE a.ticket_id = t.id) AS n_anexos
                 FROM tickets t WHERE 1=1`;
      const binds = [];
      if (status && STATUS_VALIDOS.includes(status)) { sql += ` AND t.status = ?`; binds.push(status); }
      if (urgencia && URGENCIAS.includes(urgencia)) { sql += ` AND t.urgencia = ?`; binds.push(urgencia); }
      if (q) { sql += ` AND (t.id LIKE ? OR t.titulo LIKE ? OR t.descricao LIKE ?)`; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      sql += ` ORDER BY t.created_at DESC`;
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return jsonResponse({ tickets: results || [] });
    }
    if (method === "POST") {
      // corpo literal "null": o request.json() devolve null, o .catch() nao dispara
      const body = (await request.json().catch(() => ({}))) || {};
      if (!body.titulo || !String(body.titulo).trim()) return jsonError("Título obrigatório.", 400);
      const id = await novoId(env);
      const abrir = body.status === "aberto";
      const { data, hora } = HOJE_LX();
      await env.DB.prepare(`
        INSERT INTO tickets (id, titulo, descricao, criado_por, status, urgencia, data_prazo, data_abertura, hora_abertura)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, String(body.titulo).trim(), body.descricao || "", body.criado_por || autor,
        abrir ? "aberto" : "rascunho",
        URGENCIAS.includes(body.urgencia) ? body.urgencia : "media",
        body.data_prazo || null,
        abrir ? data : null, abrir ? hora : null,
      ).run();
      await log(env, id, abrir ? "aberto" : "criado", abrir ? `Ticket aberto às ${hora}` : "Guardado como rascunho", body.criado_por || autor);
      const ticket = await carregarTicket(env, id);
      return jsonResponse({ ok: true, ticket }, 201);
    }
    return jsonError("Método não suportado.", 405);
  }

  // ---- rotas por ticket ----
  m = path.match(/^\/api\/apoio\/tickets\/(AT-\d{4}-\d{3})(\/(abrir|analisar|executar|aprovar|anexos))?$/);
  if (!m) return jsonError("Not found", 404);
  const id = m[1];
  const acao = m[3] || null;
  const ticket = await carregarTicket(env, id);
  if (!ticket) return jsonError("Ticket não encontrado.", 404);

  // detalhe
  if (!acao && method === "GET") {
    const anexos = (await env.DB.prepare(
      `SELECT id, tipo, nome, content_type, size, transcricao, created_at FROM ticket_anexos WHERE ticket_id = ? ORDER BY created_at`
    ).bind(id).all()).results || [];
    const eventos = (await env.DB.prepare(
      `SELECT evento, detalhe, autor, created_at FROM ticket_log WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(id).all()).results || [];
    return jsonResponse({ ticket, anexos, log: eventos });
  }

  // edição
  if (!acao && method === "PATCH") {
    // corpo literal "null": o request.json() devolve null, o .catch() nao dispara
    const body = (await request.json().catch(() => ({}))) || {};
    const sets = [];
    const binds = [];
    const mudancas = [];
    for (const c of CAMPOS_EDITAVEIS) {
      if (!(c in body)) continue;
      let v = body[c];
      if (c === "status") {
        if (!STATUS_VALIDOS.includes(v)) return jsonError("Status inválido.", 400);
        if (v !== ticket.status) mudancas.push(`status: ${ticket.status} → ${v}`);
        if (v === "aberto" && !ticket.data_abertura) {
          const { data, hora } = HOJE_LX();
          sets.push(`data_abertura = ?`, `hora_abertura = ?`);
          binds.push(data, hora);
        }
      } else if (c === "urgencia" && !URGENCIAS.includes(v)) {
        return jsonError("Urgência inválida.", 400);
      } else if (String(v ?? "") !== String(ticket[c] ?? "")) {
        mudancas.push(c);
      }
      sets.push(`${c} = ?`);
      // titulo e criado_por sao NOT NULL: converter "" em NULL fazia o UPDATE
      // rebentar com violacao de restricao (500) em vez de um 400 explicavel.
      if ((c === "titulo" || c === "criado_por") && String(v ?? "").trim() === "") {
        return jsonError(`O campo ${c === "titulo" ? "titulo" : "criado por"} nao pode ficar vazio.`, 400);
      }
      binds.push(v === "" ? null : v);
    }
    if (!sets.length) return jsonResponse({ ok: true, ticket });
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE tickets SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    if (mudancas.length) {
      const ev = mudancas.some((x) => x.startsWith("status")) ? "status" : "editado";
      await log(env, id, ev, mudancas.join("; "), body._autor || autor);
    }
    return jsonResponse({ ok: true, ticket: await carregarTicket(env, id) });
  }

  // abrir (rascunho -> aberto)
  if (acao === "abrir" && method === "POST") {
    const { data, hora } = HOJE_LX();
    await env.DB.prepare(
      `UPDATE tickets SET status = 'aberto', data_abertura = COALESCE(data_abertura, ?), hora_abertura = COALESCE(hora_abertura, ?), updated_at = datetime('now') WHERE id = ?`
    ).bind(data, hora, id).run();
    await log(env, id, "aberto", `Ticket aberto às ${hora}`, autor);
    return jsonResponse({ ok: true, ticket: await carregarTicket(env, id) });
  }

  // análise IA (complexidade + plano) — Gemini, mesma chave da extração de documentos
  if (acao === "analisar" && method === "POST") {
    if (!env.GEMINI_API_KEY) return jsonError("Serviço de IA não configurado.", 503);
    const prompt =
`És o assistente técnico do sistema de gestão do escritório Vyvian Avena Advogada
(React + Vite no frontend, Cloudflare Workers + D1 + KV + R2 no backend, e-mail via Resend, WhatsApp via Z-API).
Recebes um ticket de apoio técnico (erro, melhoria ou nova demanda). Avalia-o e devolve EXCLUSIVAMENTE JSON válido:

{
  "complexidade": "baixa" | "media" | "alta",
  "justificacao": "1-2 frases, em português europeu, a justificar o grau",
  "plano": "plano de resolução em 3-6 passos numerados, em português europeu, concreto e adequado à stack descrita"
}

TICKET
Título: ${ticket.titulo}
Urgência: ${ticket.urgencia}
Descrição:
${ticket.descricao || "(sem descrição)"}`;
    const ar = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 2048 },
      }),
    });
    if (!ar.ok) return jsonError(`API Gemini: ${ar.status} ${(await ar.text()).slice(0, 200)}`, 502);
    const data = await ar.json();
    const raw = (((data.candidates || [])[0]?.content?.parts) || []).map((p) => p.text || "").join("").trim();
    let out = null;
    try { out = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()); }
    catch { return jsonError("Resposta da IA não pôde ser interpretada.", 502); }
    // JSON valido que nao e objeto (string, numero, null) fazia o `out.plano = ...`
    // rebentar com TypeError em vez de devolver 502.
    if (!out || typeof out !== "object" || Array.isArray(out)) {
      return jsonError("Resposta da IA não pôde ser interpretada.", 502);
    }
    // o modelo às vezes devolve o plano como array de passos — normalizar para texto
    const texto = (v) => v == null ? null : Array.isArray(v) ? v.map(String).join("\n") : typeof v === "object" ? JSON.stringify(v) : String(v);
    out.plano = texto(out.plano);
    out.justificacao = texto(out.justificacao);
    out.complexidade = typeof out.complexidade === "string" ? out.complexidade.toLowerCase() : null;
    await env.DB.prepare(
      `UPDATE tickets SET complexidade = ?, complexidade_justificacao = ?, plano_ia = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(out.complexidade || null, out.justificacao || null, out.plano || null, id).run();
    await log(env, id, "analise_ia", `Complexidade: ${out.complexidade}`, "IA");
    return jsonResponse({ ok: true, ticket: await carregarTicket(env, id) });
  }

  // "Efetuar Alteração" — Fase 1: fica em execução, à espera do Claude em sessão
  if (acao === "executar" && method === "POST") {
    if (["resolvido", "cancelado"].includes(ticket.status)) {
      return jsonError("Ticket já fechado.", 400);
    }
    await env.DB.prepare(
      `UPDATE tickets SET status = 'em_execucao', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();
    await log(env, id, "execucao",
      "Pedido de execução registado. O Claude vai tratar do ticket na próxima sessão de desenvolvimento " +
      `(basta dizer «resolver ticket ${id}»). Se não for possível, o status passa a Impedimento com o motivo detalhado.`,
      autor);
    return jsonResponse({ ok: true, ticket: await carregarTicket(env, id) });
  }

  // "Enviar para Aprovação" — e-mail à Dra. com os dados do ticket (+ prints de
  // evidência anexados) e status em_aprovacao. O frontend guarda o formulário
  // (PATCH) antes de chamar isto, por isso o ticket aqui já está atualizado.
  if (acao === "aprovar" && method === "POST") {
    if (["rascunho", "cancelado"].includes(ticket.status)) {
      return jsonError("Abra o ticket antes de o enviar para aprovação.", 400);
    }
    const contacts = await env.DB.prepare(`SELECT email FROM owner_alert_contacts WHERE id = 1`).first().catch(() => null);
    const destino = contacts?.email || env.ADMIN_EMAIL;
    if (!destino) return jsonError("Sem e-mail da Dra. configurado (Configurações → Alertas).", 503);

    // prints de evidência da conclusão seguem anexados
    const prints = (await env.DB.prepare(
      `SELECT nome, content_type, r2_key FROM ticket_anexos WHERE ticket_id = ? AND tipo = 'print_conclusao' ORDER BY created_at`
    ).bind(id).all()).results || [];
    const attachments = [];
    for (const p of prints) {
      const obj = await env.RECIBOS.get(p.r2_key);
      if (!obj) continue;
      const u8 = new Uint8Array(await obj.arrayBuffer());
      let b64 = "";
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      attachments.push({ filename: p.nome || "print.png", content: btoa(b64) });
    }

    const URG_LABEL = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };
    const urg = URG_LABEL[ticket.urgencia] || "Média";
    const prazo = ticket.data_prazo ? ticket.data_prazo.split("-").reverse().join("/") : null;
    const analise = [
      ticket.complexidade ? `Complexidade ${ticket.complexidade}${ticket.complexidade_justificacao ? ` — ${ticket.complexidade_justificacao}` : ""}` : null,
      ticket.plano_ia || null,
    ].filter(Boolean).join("\n\n");

    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const secao = (t, corpo) => corpo
      ? `<h3 style="margin:20px 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8e6f3f">${t}</h3>` +
        `<p style="margin:0;font-size:14px;line-height:1.65;color:#333">${esc(corpo)}</p>`
      : "";
    const html =
      `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;padding:8px 4px">` +
      `<h2 style="color:#12302a;margin:0 0 2px;font-weight:600">Ticket ${id} — para aprovação</h2>` +
      `<p style="margin:0 0 16px;color:#8a8275;font-size:13px">Apoio Técnico · Vyvian Avena Advogada</p>` +
      `<p style="margin:0;font-size:16px;color:#12302a"><strong>${esc(ticket.titulo)}</strong></p>` +
      `<p style="margin:8px 0 0;font-size:13.5px;color:#555">Urgência: <strong>${urg}</strong>${prazo ? ` · Prazo: <strong>${prazo}</strong>` : ""}</p>` +
      secao("Descrição", ticket.descricao) +
      secao("Análise da IA", analise) +
      secao("Impedimentos", ticket.impedimentos) +
      secao("Como foi efetuada a resolução", ticket.resolucao) +
      (attachments.length ? `<p style="margin:20px 0 0;font-size:13px;color:#555">${attachments.length} print${attachments.length === 1 ? "" : "s"} de evidência da conclusão em anexo.</p>` : "") +
      `<p style="margin:24px 0 0;font-size:12px;color:#8a8275">Para aprovar ou pedir alterações, registe no ticket na Área Privada (Apoio Técnico → ${id}).</p>` +
      `</div>`;
    const text = [
      `Ticket ${id} — para aprovação`,
      ``,
      ticket.titulo,
      `Urgência: ${urg}` + (prazo ? ` · Prazo: ${prazo}` : ""),
      ticket.descricao ? `\nDESCRIÇÃO\n${ticket.descricao}` : null,
      analise ? `\nANÁLISE DA IA\n${analise}` : null,
      ticket.impedimentos ? `\nIMPEDIMENTOS\n${ticket.impedimentos}` : null,
      ticket.resolucao ? `\nCOMO FOI EFETUADA A RESOLUÇÃO\n${ticket.resolucao}` : null,
      attachments.length ? `\n${attachments.length} print(s) de evidência em anexo.` : null,
    ].filter((l) => l != null).join("\n");

    const res = await sendEmail(env, {
      to: destino,
      subject: `Ticket ${id} para aprovação — ${ticket.titulo}`,
      html, text, attachments,
    });
    if (!res.ok) return jsonError(`E-mail não enviado: ${res.error || res.reason || "falha no envio"}`, 502);

    await env.DB.prepare(
      `UPDATE tickets SET status = 'em_aprovacao', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();
    await log(env, id, "aprovacao",
      `Enviado para aprovação da Dra. (e-mail para ${destino}${attachments.length ? `, ${attachments.length} print${attachments.length === 1 ? "" : "s"} de evidência` : ""}).`,
      autor);
    return jsonResponse({ ok: true, ticket: await carregarTicket(env, id) });
  }

  // upload de anexo (binário) — ?tipo=anexo|print_abertura|print_conclusao|audio & ?nome=
  if (acao === "anexos" && method === "POST") {
    const url = new URL(request.url);
    const tipo = url.searchParams.get("tipo") || "anexo";
    if (!TIPOS_ANEXO.includes(tipo)) return jsonError("Tipo de anexo inválido.", 400);
    // decodeURIComponent atira URIError com uma sequência de percentagem inválida
    // (ex.: "%zz"): sem guarda, um nome de ficheiro estranho dava 500.
    let nomeCru = url.searchParams.get("nome") || "";
    try { nomeCru = decodeURIComponent(nomeCru); } catch { /* fica o valor cru */ }
    const nome = nomeCru ||
      (tipo === "audio" ? "gravacao.webm" : tipo.startsWith("print") ? "print.png" : "anexo");
    const ct = request.headers.get("Content-Type") || "application/octet-stream";
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return jsonError("Ficheiro vazio.", 400);
    if (buf.byteLength > MAX_ANEXO) return jsonError("Ficheiro demasiado grande (máx. 20 MB).", 413);
    const seguro = nome.replace(/[^\w.\-]+/g, "_").slice(0, 80);
    // sufixo aleatório: dois uploads do mesmo nome no mesmo milissegundo geravam a
    // mesma chave e o segundo sobrepunha o primeiro no R2 (apagar um apagava os dois).
    const r2key = `apoio/${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${seguro}`;
    await env.RECIBOS.put(r2key, buf, { httpMetadata: { contentType: ct } });
    const res = await env.DB.prepare(
      `INSERT INTO ticket_anexos (ticket_id, tipo, nome, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(id, tipo, nome, ct, buf.byteLength, r2key).first();
    await log(env, id, "anexo", `${tipo}: ${nome} (${Math.round(buf.byteLength / 1024)} KB)`, autor);
    return jsonResponse({ ok: true, anexo: res }, 201);
  }

  return jsonError("Not found", 404);
}
