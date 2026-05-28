// worker/index.js
// Cloudflare Worker — serve API em /api/* e SPA estático em todo o resto.

import { handleAuth } from './routes/auth.js';
import { handleClients } from './routes/clients.js';
import { handleInstallments } from './routes/installments.js';
import { handleNotifications } from './routes/notifications.js';
import { handleDashboard } from './routes/dashboard.js';
import { jsonError, jsonResponse } from './lib/response.js';
import { requireAuth } from './lib/auth.js';

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

        return jsonError('Not found', 404);
      } catch (err) {
        console.error('API error:', err.message, err.stack);
        return jsonError('Internal server error', 500, { detail: err.message });
      }
    }

    // === ASSETS ESTÁTICOS (SPA) ===
    return env.ASSETS.fetch(request);
  },
};
