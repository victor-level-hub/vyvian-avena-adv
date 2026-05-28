// worker/index.js
// Cloudflare Worker — serve API em /api/* e SPA estático em todo o resto.

import { handleAuth } from './routes/auth.js';
import { handleClients } from './routes/clients.js';
import { handleInstallments } from './routes/installments.js';
import { handleNotifications } from './routes/notifications.js';
import { handleDashboard } from './routes/dashboard.js';
import { jsonError, jsonResponse } from './lib/response.js';
import { requireAuth } from './lib/auth.js';
import { runDailyCron } from './cron.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Pre-flight CORS
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
        if (path.startsWith('/api/auth/')) {
          return await handleAuth(request, env, path);
        }

        const session = await requireAuth(request, env);
        if (!session) return jsonError('Unauthorized', 401);

        // Endpoint manual: força execução do cron (útil para testes)
        if (path === '/api/cron/run' && request.method === 'POST') {
          const result = await runDailyCron(env, Date.now());
          return jsonResponse(result);
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

        return jsonError('Not found', 404);
      } catch (err) {
        console.error('API error:', err.message, err.stack);
        return jsonError('Internal server error', 500, { detail: err.message });
      }
    }

    // === ASSETS ESTÁTICOS (SPA) ===
    return env.ASSETS.fetch(request);
  },

  // ===== SCHEDULED HANDLER (Cron Triggers) =====
  // Configurado no wrangler.jsonc — corre todos os dias às 07:00 UTC
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyCron(env, event.scheduledTime).then((result) => {
        console.log('Cron diário OK:', JSON.stringify(result));
      }).catch((err) => {
        console.error('Cron diário FALHOU:', err.message, err.stack);
      })
    );
  },
};
