// worker/index.js
// Cloudflare Worker — serve API em /api/* e SPA estático em todo o resto.

import { handleAuth } from './routes/auth.js';
import { handleClients } from './routes/clients.js';
import { handleInstallments } from './routes/installments.js';
import { handleNotifications } from './routes/notifications.js';
import { handleDashboard } from './routes/dashboard.js';
import { handleRecibos } from './routes/recibos.js'; // Fase 3
import { handleProcuracoes } from './routes/procuracoes.js'; // Procurações
import { handlePlanos } from './routes/planos.js'; // Plano de pagamento (PDF + envio)
import { handleExtracao } from './routes/extracao.js'; // IA: extração de documentos
import { handleUploadTokens, handleClientDocuments, handlePublicUpload } from './routes/cliente_docs.js'; // Upload pelo cliente
import { handleCalendar } from './routes/calendar.js'; // Calendário jurídico
import { runDailyCron } from './cron.js'; // Fase 2
import { jsonError, jsonResponse } from './lib/response.js';
import { requireAuth } from './lib/auth.js';
import { ROTAS_PUBLICAS } from './rotas-publicas.js';

/**
 * Rotas do site que nao sao paginas publicas indexaveis e nao devem ser
 * verificadas contra ROTAS_PUBLICAS: a area privada e os links de upload
 * tokenizados dependem do fallback da SPA para o routing do lado do cliente.
 */
const PREFIXOS_SPA = ['/admin', '/upload/'];

/**
 * Uma rota publica desconhecida deve responder 404, e nao cair no fallback da SPA
 * com um 200 — o que o Google trata como soft-404 e penaliza.
 * Ficheiros (com extensao) e assets ficam de fora: sao servidos pelo ASSETS.
 */
function ehPaginaInexistente(path) {
  if (path.startsWith('/assets/')) return false;
  if (path.includes('.')) return false; // .css, .js, .jpg, robots.txt, sitemap.xml
  if (PREFIXOS_SPA.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) return false;

  const normalizado = path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
  return !ROTAS_PUBLICAS.includes(normalizado);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Pre-flight CORS (mesma origem normalmente; útil para dev)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // === ROTAS API ===
    if (path.startsWith('/api/')) {
      try {
        // Rotas públicas (auth)
        if (path.startsWith('/api/auth/')) {
          return await handleAuth(request, env, path);
        }

        // Upload de documentos PELO CLIENTE (público, valida pelo token)
        if (path.startsWith('/api/public/upload/')) {
          return await handlePublicUpload(request, env, path);
        }

        // Rotas privadas — requerem sessão válida
        const session = await requireAuth(request, env);
        if (!session) {
          return jsonError('Unauthorized', 401);
        }

        if (path.startsWith('/api/clients')) {
          return await handleClients(request, env, path, session);
        }
        if (path.startsWith('/api/installments')) {
          return await handleInstallments(request, env, path, session);
        }
        if (path.startsWith('/api/notifications')) {
          return await handleNotifications(request, env, path, session);
        }
        if (path.startsWith('/api/dashboard')) {
          return await handleDashboard(request, env, path, session);
        }

        // NOVO (Fase 3): recibos PDF
        if (path.startsWith('/api/recibos')) {
          return await handleRecibos(request, env, path, session);
        }
        if (path.startsWith('/api/procuracoes')) {
          return await handleProcuracoes(request, env, path, session);
        }
        if (path.startsWith('/api/planos')) {
          return await handlePlanos(request, env, path, session);
        }
        if (path === '/api/cadastro/extrair-documento') {
          return await handleExtracao(request, env, path, session);
        }
        if (path.startsWith('/api/calendar')) {
          return await handleCalendar(request, env, path, session);
        }
        if (path.startsWith('/api/upload-tokens')) {
          return await handleUploadTokens(request, env, path, session);
        }
        if (path.startsWith('/api/client-documents')) {
          return await handleClientDocuments(request, env, path, session);
        }
        // NOVO (Fase 2): disparo manual do cron diário
        if (path === '/api/cron/run' && request.method === 'POST') {
          const result = await runDailyCron(env, ctx);
          return jsonResponse({ ok: true, ...result });
        }

        return jsonError('Not found', 404);
      } catch (err) {
        console.error('API error:', err.message, err.stack);
        return jsonError('Internal server error', 500, { detail: err.message });
      }
    }

    // === PÁGINA INEXISTENTE: 404 REAL ===
    if (ehPaginaInexistente(path)) {
      const pagina404 = new URL('/404.html', url.origin);
      const resposta = await env.ASSETS.fetch(new Request(pagina404, request));
      return new Response(resposta.body, {
        status: 404,
        headers: resposta.headers,
      });
    }

    // === ASSETS ESTÁTICOS (SPA) ===
    return env.ASSETS.fetch(request);
  },

  // NOVO (Fase 2): cron agendado (ver triggers.crons no wrangler.jsonc)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyCron(env, ctx).then(
        (s) => console.log('cron diário OK:', JSON.stringify(s)),
        (e) => console.error('cron diário falhou:', e.message),
      ),
    );
  },
};

