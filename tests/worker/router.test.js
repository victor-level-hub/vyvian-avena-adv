// tests/worker/router.test.js — worker/index.js (dispatch, CORS, gating de sessão, 404 real)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../worker/index.js';
import { signJWT } from '../../worker/lib/auth.js';
import { tokenPrevia } from '../../worker/routes/previa.js';
import { criarEnv, json, mockFetch } from '../helpers/env.js';
import { ROTAS_PUBLICAS } from '../../worker/rotas-publicas.js';

// ctx do Worker: guarda as promessas de waitUntil para os testes as poderem esperar.
function criarCtx() {
  const pendentes = [];
  return { waitUntil: (p) => pendentes.push(p), passThroughOnException() {}, esperar: () => Promise.all(pendentes), pendentes };
}

// ASSETS falso: devolve um corpo reconhecível e regista o que lhe pedem.
function comAssets(env, corpo = '<html>pagina</html>') {
  const pedidos = [];
  env.ASSETS = {
    pedidos,
    fetch: async (r) => {
      pedidos.push(new URL(r.url).pathname);
      return new Response(corpo, { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  };
  return env;
}

const pedido = (url, init = {}) => new Request(url, init);
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

let env, ctx;
beforeEach(() => {
  env = comAssets(criarEnv());
  ctx = criarCtx();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Cria uma sessão válida (JWT + registo no KV) e devolve o cabeçalho pronto.
async function sessaoValida(env, payload = { sub: 1, name: 'Victor', email: 'v@exemplo.pt' }) {
  const jti = 'sessao-de-teste';
  const token = await signJWT({ ...payload, jti }, env.JWT_SECRET);
  await env.SESSIONS.put(jti, JSON.stringify({ criada: true }));
  return { Authorization: `Bearer ${token}` };
}

describe('redirecionamento HTTP → HTTPS', () => {
  it('redireciona 301 mantendo caminho e query', async () => {
    const r = await worker.fetch(pedido('http://vyavenaadv.com/areas/familia?a=1'), env, ctx);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://vyavenaadv.com/areas/familia?a=1');
  });

  it('não redireciona em localhost (dev)', async () => {
    const r = await worker.fetch(pedido('http://localhost:8787/'), env, ctx);
    expect(r.status).not.toBe(301);
  });

  it('não redireciona em 127.0.0.1 (dev)', async () => {
    const r = await worker.fetch(pedido('http://127.0.0.1:8787/'), env, ctx);
    expect(r.status).not.toBe(301);
  });

  it('redireciona antes de qualquer autenticação (rota privada em http)', async () => {
    const r = await worker.fetch(pedido('http://vyavenaadv.com/api/clients'), env, ctx);
    expect(r.status).toBe(301);
  });
});

describe('pré-flight CORS (OPTIONS)', () => {
  it('responde 204 sem corpo', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/clients', { method: 'OPTIONS' }), env, ctx);
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
  });

  it('ecoa a Origin do pedido', async () => {
    const r = await worker.fetch(
      pedido('https://vyavenaadv.com/api/clients', { method: 'OPTIONS', headers: { Origin: 'https://outro.pt' } }), env, ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://outro.pt');
  });

  it('usa * quando não há Origin', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/x', { method: 'OPTIONS' }), env, ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('anuncia os métodos e cabeçalhos permitidos', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/x', { method: 'OPTIONS' }), env, ctx);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(r.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('OPTIONS a uma página (não-API) também é tratado como pré-flight', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/sobre', { method: 'OPTIONS' }), env, ctx);
    expect(r.status).toBe(204);
  });
});

describe('beacon público /api/hit', () => {
  it('responde 204 sem exigir sessão', async () => {
    const r = await worker.fetch(
      pedido('https://vyavenaadv.com/api/hit', { method: 'POST', body: '/blog', headers: { 'User-Agent': UA_BROWSER } }), env, ctx);
    expect(r.status).toBe(204);
  });

  it('regista a visita através do waitUntil', async () => {
    const r = pedido('https://vyavenaadv.com/api/hit', {
      method: 'POST', body: '/blog/heranca-portugal-brasil-mapa-das-decisoes',
      headers: { 'User-Agent': UA_BROWSER, Referer: 'https://vyavenaadv.com/blog' },
    });
    await worker.fetch(r, env, ctx);
    await ctx.esperar();
    expect(env.DB.conta('site_visits_hourly')).toBe(1);
    expect(env.DB.linha(`SELECT path, views FROM site_page_views`)).toMatchObject({
      path: '/blog/heranca-portugal-brasil-mapa-das-decisoes', views: 1,
    });
  });

  it('não regista nada quando o User-Agent é de robô', async () => {
    await worker.fetch(
      pedido('https://vyavenaadv.com/api/hit', { method: 'POST', body: '/', headers: { 'User-Agent': 'Googlebot/2.1' } }), env, ctx);
    await ctx.esperar();
    expect(ctx.pendentes.length).toBe(0);
    expect(env.DB.conta('site_visits_hourly')).toBe(0);
  });

  it('responde 204 na mesma quando é robô (não denuncia o filtro)', async () => {
    const r = await worker.fetch(
      pedido('https://vyavenaadv.com/api/hit', { method: 'POST', body: '/', headers: { 'User-Agent': 'curl/8.0' } }), env, ctx);
    expect(r.status).toBe(204);
  });

  it('ignora beacon vindo de outra origem', async () => {
    await worker.fetch(pedido('https://vyavenaadv.com/api/hit', {
      method: 'POST', body: '/', headers: { 'User-Agent': UA_BROWSER, Origin: 'https://site-alheio.com' },
    }), env, ctx);
    await ctx.esperar();
    expect(env.DB.conta('site_visits_hourly')).toBe(0);
  });

  it('duas visitas do mesmo visitante somam views mas contam 1 visitante único', async () => {
    for (let i = 0; i < 2; i++) {
      const c = criarCtx();
      await worker.fetch(pedido('https://vyavenaadv.com/api/hit', {
        method: 'POST', body: '/', headers: { 'User-Agent': UA_BROWSER, 'CF-Connecting-IP': '1.2.3.4' },
      }), env, c);
      await c.esperar();
    }
    expect(env.DB.linha(`SELECT views FROM site_visits_hourly`).views).toBe(2);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
  });
});

describe('miniaturas do Instagram (/api/ig/thumb/:id)', () => {
  it('serve a imagem do R2 sem exigir sessão', async () => {
    await env.RECIBOS.put('ig/thumbs/17900000000000000.jpg', new Uint8Array([137, 80, 78, 71]).buffer,
      { httpMetadata: { contentType: 'image/jpeg' } });
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/ig/thumb/17900000000000000'), env, ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/jpeg');
    expect(r.headers.get('Cache-Control')).toContain('max-age=86400');
  });

  it('404 quando a miniatura não existe', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/ig/thumb/123'), env, ctx);
    expect(r.status).toBe(404);
  });

  it('404 quando o id não tem dígitos nenhuns', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/ig/thumb/abc'), env, ctx);
    expect(r.status).toBe(404);
  });

  it('não deixa sair da pasta ig/thumbs (travessia de caminho)', async () => {
    await env.RECIBOS.put('segredo.jpg', 'x', { httpMetadata: { contentType: 'image/jpeg' } });
    const lidas = [];
    const getOriginal = env.RECIBOS.get.bind(env.RECIBOS);
    env.RECIBOS.get = (k) => { lidas.push(k); return getOriginal(k); };
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/ig/thumb/..%2F..%2Fsegredo'), env, ctx);
    expect(r.status).toBe(404);
    expect(lidas.every((k) => k.startsWith('ig/thumbs/'))).toBe(true);
  });
});

describe('sync manual do Instagram (/api/stats/instagram/sync)', () => {
  it('403 quando IG_SYNC_KEY não está configurada', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/stats/instagram/sync', { method: 'POST' }), env, ctx);
    expect(r.status).toBe(403);
  });

  it('403 quando a chave enviada está errada', async () => {
    env.IG_SYNC_KEY = 'chave-certa';
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/stats/instagram/sync',
      { method: 'POST', headers: { 'X-IG-Sync-Key': 'chave-errada' } }), env, ctx);
    expect(r.status).toBe(403);
  });

  it('com a chave certa corre o sync sem precisar de sessão', async () => {
    env.IG_SYNC_KEY = 'chave-certa';
    env.IG_SEED_TOKEN = 'token-ig';
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (url.includes('/me?')) return { json: { followers_count: 500, media_count: 42 } };
      if (url.includes('/me/media')) return { json: { data: [] } };
      return { json: { data: [] } };
    }));
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/stats/instagram/sync',
      { method: 'POST', headers: { 'X-IG-Sync-Key': 'chave-certa' } }), env, ctx);
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ok: true, followers: 500 });
  });

  it('GET a esta rota não passa pela porta da chave e cai no gating de sessão', async () => {
    env.IG_SYNC_KEY = 'chave-certa';
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/stats/instagram/sync',
      { headers: { 'X-IG-Sync-Key': 'chave-certa' } }), env, ctx);
    expect(r.status).toBe(401);
  });
});

describe('gating de sessão nas rotas privadas', () => {
  const privadas = [
    '/api/clients', '/api/installments', '/api/notifications', '/api/dashboard',
    '/api/stats/resumo', '/api/insights/temas', '/api/recibos', '/api/procuracoes',
    '/api/planos', '/api/calendar', '/api/apoio/tickets', '/api/config/users',
    '/api/upload-tokens', '/api/client-documents',
  ];

  it.each(privadas)('%s responde 401 sem token', async (p) => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com' + p), env, ctx);
    expect(r.status).toBe(401);
    expect(await json(r)).toEqual({ error: 'Unauthorized' });
  });

  it('401 com token bem formado mas assinado com outro segredo', async () => {
    const token = await signJWT({ sub: 1, jti: 'x' }, 'segredo-do-atacante');
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/clients',
      { headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(r.status).toBe(401);
  });

  it('401 com token válido cuja sessão foi revogada do KV', async () => {
    const h = await sessaoValida(env);
    await env.SESSIONS.delete('sessao-de-teste');
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/clients', { headers: h }), env, ctx);
    expect(r.status).toBe(401);
  });

  it('401 com esquema errado (Basic em vez de Bearer)', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/clients',
      { headers: { Authorization: 'Basic dXNlcjpwYXNz' } }), env, ctx);
    expect(r.status).toBe(401);
  });

  it('com sessão válida já não devolve 401 (chega ao handler)', async () => {
    const h = await sessaoValida(env);
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/apoio/tickets', { headers: h }), env, ctx);
    expect(r.status).not.toBe(401);
  });

  it('rota /api/ desconhecida com sessão válida devolve 404', async () => {
    const h = await sessaoValida(env);
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/inexistente', { headers: h }), env, ctx);
    expect(r.status).toBe(404);
    expect(await json(r)).toEqual({ error: 'Not found' });
  });

  it('um prefixo parecido não engana o dispatch (/api/clientsX vai para clients)', async () => {
    const h = await sessaoValida(env);
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/clientsX', { headers: h }), env, ctx);
    expect([200, 404, 405]).toContain(r.status); // nunca 401/500
  });
});

describe('rotas de API públicas por desenho', () => {
  it('/api/auth/* não exige sessão', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/auth/login',
      { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), env, ctx);
    expect(r.status).not.toBe(401);
  });

  it('GET de imagem de artigo é público', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/insights/images/1'), env, ctx);
    expect(r.status).not.toBe(401);
  });

  it('POST na mesma rota de imagem já exige sessão', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/insights/images/1', { method: 'POST' }), env, ctx);
    expect(r.status).toBe(401);
  });

  it('imagem com id não numérico exige sessão (a regex não casa)', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/insights/images/abc'), env, ctx);
    expect(r.status).toBe(401);
  });

  it('fila de publicação passa o dispatch sem sessão e é travada pela chave no handler', async () => {
    env.PUBLISH_KEY = 'chave-de-publicacao';
    const semChave = await worker.fetch(pedido('https://vyavenaadv.com/api/insights/fila-publicacao'), env, ctx);
    expect(await json(semChave)).toEqual({ error: 'Chave inválida' }); // do handler, não do router
    const comChave = await worker.fetch(
      pedido('https://vyavenaadv.com/api/insights/fila-publicacao?key=chave-de-publicacao'), env, ctx);
    expect(comChave.status).toBe(200);
  });
});

describe('tratamento de erros da API', () => {
  it('exceção num handler vira 500 com detalhe, não uma exceção por tratar', async () => {
    const h = await sessaoValida(env);
    env.DB.prepare = () => { throw new Error('D1 indisponível'); };
    const r = await worker.fetch(pedido('https://vyavenaadv.com/api/apoio/tickets', { headers: h }), env, ctx);
    expect(r.status).toBe(500);
    expect(await json(r)).toMatchObject({ error: 'Internal server error', detail: 'D1 indisponível' });
  });
});

describe('páginas do site: 404 real vs fallback da SPA', () => {
  it.each(ROTAS_PUBLICAS.slice(0, 12))('a rota pública %s é servida pelos assets (200)', async (p) => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com' + p), env, ctx);
    expect(r.status).toBe(200);
  });

  it('rota pública com barra final continua a ser 200', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/areas/'), env, ctx);
    expect(r.status).toBe(200);
  });

  it('página inventada devolve 404 real (evita soft-404 no Google)', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/pagina-que-nao-existe'), env, ctx);
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(env.ASSETS.pedidos).toContain('/404.html');
  });

  it('artigo de blogue inexistente devolve 404 real', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/blog/artigo-inventado'), env, ctx);
    expect(r.status).toBe(404);
  });

  it('/admin e subrotas caem no fallback da SPA (routing do lado do cliente)', async () => {
    for (const p of ['/admin', '/admin/painel', '/admin/apoio', '/admin/qualquer-coisa']) {
      const r = await worker.fetch(pedido('https://vyavenaadv.com' + p), env, ctx);
      expect(r.status, p).toBe(200);
    }
  });

  it('links de upload tokenizados caem no fallback da SPA', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/upload/abc123'), env, ctx);
    expect(r.status).toBe(200);
  });

  it('ficheiros com extensão vão para os assets mesmo que não existam na lista', async () => {
    for (const f of ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/imagem.jpg']) {
      const r = await worker.fetch(pedido('https://vyavenaadv.com' + f), env, ctx);
      expect(r.status, f).toBe(200);
    }
  });

  it('/assets/* vai sempre para os assets', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/assets/index-abc123.js'), env, ctx);
    expect(r.status).toBe(200);
  });

  it('a raiz é servida normalmente', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/'), env, ctx);
    expect(r.status).toBe(200);
  });
});

describe('pré-visualização pública de artigo', () => {
  it('não exige sessão e não cai no 404 genérico de página', async () => {
    const r = await worker.fetch(pedido('https://vyavenaadv.com/pre-visual-artigo?id=1&t=errado'), env, ctx);
    expect(r.status).not.toBe(401);
    expect(env.ASSETS.pedidos).not.toContain('/404.html');
    expect(await r.text()).toContain('Pré-visualização não encontrada');
  });

  it('erro interno na prévia devolve 500 legível em vez de rebentar', async () => {
    const t = await tokenPrevia(env, 1);
    env.DB.prepare = () => { throw new Error('boom'); };
    const r = await worker.fetch(pedido(`https://vyavenaadv.com/pre-visual-artigo?id=1&t=${t}`), env, ctx);
    expect(r.status).toBe(500);
    expect(await r.text()).toContain('pré-visualização');
  });
});

describe('cron agendado', () => {
  it('scheduled() não propaga exceções do cron', async () => {
    env.DB.prepare = () => { throw new Error('cron partido'); };
    const c = criarCtx();
    await expect(worker.scheduled({ cron: '0 7 * * *' }, env, c)).resolves.toBeUndefined();
    await expect(c.esperar()).resolves.toBeDefined();
  });
});
