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
import { handleApoio } from './routes/apoio.js'; // Apoio Técnico (tickets)
import { handleConfig, handlePublicConvite } from './routes/config.js'; // Configurações: utilizadores
import { runDailyCron } from './cron.js'; // Fase 2
import { jsonError, jsonResponse } from './lib/response.js';
import { requireAuth } from './lib/auth.js';
import { ROTAS_PUBLICAS } from './rotas-publicas.js';
import { handleStats } from './routes/stats.js'; // Fase A: estatísticas (acessos ao site)
import { handleInsights } from './routes/insights.js'; // Insights: temas, artigos IA, imagens, fontes
import { handlePreviaArtigo } from './routes/previa.js'; // prévia pública de artigo (token)
import { isValidHit, recordVisit } from './lib/visits.js'; // Fase A: contador de visitas (beacon)
import { syncInstagram } from './lib/instagram.js'; // Fase B: sync do Instagram (cron + trigger manual)

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

    // HTTP -> HTTPS (301). O Cloudflare normalmente trata disto na edge
    // ("Always Use HTTPS"), mas se a opção estiver desligada o pedido http
    // chega aqui — e um site sem este redirect perde pontos de SEO e expõe
    // o visitante. Não se aplica em dev local (localhost usa http).
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

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
        // NOVO (Fase A): beacon público de contagem de acessos — sem auth, fire-and-forget.
        // O site dispara POST /api/hit a cada page view (ver src/lib/analytics.js).
        if (path === '/api/hit') {
          if (isValidHit(request)) ctx.waitUntil(recordVisit(request, env));
          return new Response(null, {
            status: 204,
            headers: { 'Access-Control-Allow-Origin': request.headers.get('Origin') || '*' },
          });
        }

        // NOVO (Fase B): miniatura de uma publicação do Instagram, servida do R2.
        // Conteúdo já público no Instagram; sem auth para funcionar em <img src>
        // (a Área Privada autentica por Bearer, que uma tag <img> não envia).
        if (path.startsWith('/api/ig/thumb/')) {
          const id = path.slice('/api/ig/thumb/'.length).replace(/[^0-9]/g, '');
          if (!id) return jsonError('Not found', 404);
          const obj = await env.RECIBOS.get('ig/thumbs/' + id + '.jpg');
          if (!obj) return jsonError('Not found', 404);
          return new Response(obj.body, {
            headers: {
              'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        // NOVO (Fase B): sincronização manual do Instagram — protegida por chave própria
        // (cabeçalho X-IG-Sync-Key). Idempotente e sem efeitos colaterais: apenas recolhe
        // seguidores/posts. Permite semear ou forçar uma atualização sem esperar pelo cron.
        if (path === '/api/stats/instagram/sync' && request.method === 'POST') {
          if (!env.IG_SYNC_KEY || request.headers.get('X-IG-Sync-Key') !== env.IG_SYNC_KEY) {
            return jsonError('Forbidden', 403);
          }
          const r = await syncInstagram(env);
          return jsonResponse({ ok: true, ...r });
        }

        // Rotas públicas (auth)
        if (path.startsWith('/api/auth/')) {
          return await handleAuth(request, env, path);
        }

        // Upload de documentos PELO CLIENTE (público, valida pelo token)
        if (path.startsWith('/api/public/upload/')) {
          return await handlePublicUpload(request, env, path);
        }

        // Registo por convite (público, valida pelo token do e-mail)
        if (path.startsWith('/api/public/convite/')) {
          return await handlePublicConvite(request, env, path);
        }

        // Imagens dos artigos Insights — públicas em GET (destinam-se ao blogue;
        // sem dados sensíveis). Permite usá-las em <img>/markdown na pré-visualização.
        if (request.method === 'GET' && /^\/api\/insights\/images\/\d+$/.test(path)) {
          return await handleInsights(request, env, path, null);
        }

        // Fila de publicação (consumida pelo GitHub Actions) — protegida por
        // PUBLISH_KEY dentro do handler, não por sessão.
        if (path === '/api/insights/fila-publicacao' || /^\/api\/insights\/articles\/\d+\/publicado$/.test(path)) {
          return await handleInsights(request, env, path, null);
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
        // NOVO (Fase A): estatísticas — acessos ao site
        if (path.startsWith('/api/stats')) {
          return await handleStats(request, env, path, session);
        }
        // NOVO: Insights (Redes Sociais) — sugestões de temas, artigos IA, imagens e fontes
        if (path.startsWith('/api/insights')) {
          return await handleInsights(request, env, path, session);
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
        // NOVO: Apoio Técnico — tickets de erros/melhorias/demandas
        if (path.startsWith('/api/apoio')) {
          return await handleApoio(request, env, path, session);
        }
        // NOVO: Configurações — gestão de utilizadores
        if (path.startsWith('/api/config')) {
          return await handleConfig(request, env, path, session);
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

    // === PRÉ-VISUALIZAÇÃO PÚBLICA DE ARTIGO (link partilhável, guardado por token) ===
    if (path === '/pre-visual-artigo') {
      try {
        return await handlePreviaArtigo(request, env);
      } catch (err) {
        console.error('previa error:', err.message);
        return new Response('Erro na pré-visualização.', { status: 500 });
      }
    }

    // === ÁUDIO DO BLOGUE: mp3 com suporte a Range (seek) ===
    // O ASSETS serve os mp3 com 200 sem Accept-Ranges nem Content-Length
    // (chunked) — o browser fica sem intervalo "seekable" e QUALQUER clique na
    // barra de progresso recomeçava a narração do zero. Ler o ficheiro inteiro
    // e responder nós próprios (206 aos pedidos Range) devolve o seek ao
    // <audio>. Requer "run_worker_first": ["/blog-audio/*"] no wrangler.jsonc,
    // senão o pedido nem chega ao worker. Ficheiros de poucos MB: ler para
    // memória é aceitável.
    if (path.startsWith('/blog-audio/') && path.endsWith('.mp3') && (request.method === 'GET' || request.method === 'HEAD')) {
      const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
      if (!asset.ok) return asset;
      const corpo = await asset.arrayBuffer();
      const total = corpo.byteLength;
      const cab = {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        // max-age=0: uma narração regenerada (ex.: correção de pronúncia) tem
        // de chegar já — com ETag a revalidação custa um 304, não os MB todos.
        'Cache-Control': 'public, max-age=0, must-revalidate',
      };
      const etag = asset.headers.get('ETag');
      if (etag) {
        cab.ETag = etag;
        if (request.headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers: cab });
        }
      }
      const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
      if (m && (m[1] !== '' || m[2] !== '')) {
        const ini = m[1] !== '' ? Number(m[1]) : Math.max(0, total - Number(m[2]));
        const fim = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1;
        if (ini > fim || ini >= total) {
          return new Response(null, { status: 416, headers: { ...cab, 'Content-Range': `bytes */${total}` } });
        }
        cab['Content-Range'] = `bytes ${ini}-${fim}/${total}`;
        cab['Content-Length'] = String(fim - ini + 1);
        return new Response(request.method === 'HEAD' ? null : corpo.slice(ini, fim + 1), { status: 206, headers: cab });
      }
      cab['Content-Length'] = String(total);
      return new Response(request.method === 'HEAD' ? null : corpo, { status: 200, headers: cab });
    }

    // === PÁGINA INEXISTENTE: 404 REAL ===
    if (ehPaginaInexistente(path)) {
      const pagina404 = new URL('/404.html', url.origin);
      const resposta = await env.ASSETS.fetch(new Request(pagina404, { method: 'GET' }));

      // Ler o corpo e reemitir com cabeçalhos próprios. Copiar os headers do asset
      // trazia o content-encoding (gzip/br) do original, mas o corpo era servido
      // sem essa codificação — o browser falhava a descomprimir e mostrava 0 bytes.
      const html = await resposta.text();
      return new Response(html, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
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

