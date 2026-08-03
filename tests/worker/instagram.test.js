// tests/worker/instagram.test.js — worker/lib/instagram.js (sync do Instagram)
//
// Toda a superfície pública é uma só função (syncInstagram), por isso cada bloco
// exercita uma secção do sync através dela: token, perfil, publicações, insights
// diários, insights por publicação e demografia.
//
// O tempo está fixo em 2026-08-03T10:00:00Z para que os dias sejam determinísticos.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncInstagram } from '../../worker/lib/instagram.js';
import { criarEnv, FakeKV, mockFetch } from '../helpers/env.js';

// ─── tempo fixo ─────────────────────────────────────────────────────────────
const INSTANTE = '2026-08-03T10:00:00Z';
const AGORA_S = Math.floor(Date.parse(INSTANTE) / 1000);
const HOJE = '2026-08-03';
const dia = (i) => new Date(Date.parse(INSTANTE) - i * 86400000).toISOString().slice(0, 10);
const meiaNoite = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

// ─── respostas da Graph API ─────────────────────────────────────────────────
const metricas = (obj) => ({
  json: { data: Object.entries(obj).map(([name, value]) => ({ name, total_value: { value } })) },
});
const respDemo = (results) => ({ json: { data: [{ total_value: { breakdowns: [{ results }] } }] } });

const PADROES = {
  refresh: { json: { access_token: 'tok-renovado', expires_in: 60 * 24 * 3600 } },
  perfil: { json: { followers_count: 128, media_count: 34 } },
  media: { json: { data: [] } },
  dia: { json: { data: [] } },
  post: { json: { data: [] } },
  demo: { json: { data: [] } },
  imagem: { texto: 'BYTES-JPEG', headers: { 'Content-Type': 'image/jpeg' } },
};

const valor = (v, url) => (typeof v === 'function' ? v(url) : v);

// Encaminha cada URL para a resposta configurada. A ordem importa: /me/media e
// /me/insights têm de ser vistos antes de /me? e de /insights.
function roteador(cfg = {}) {
  const c = { ...PADROES, ...cfg };
  return (url) => {
    if (url.includes('refresh_access_token')) return valor(c.refresh, url);
    if (url.includes('/me/media')) return valor(c.media, url);
    if (url.includes('/me/insights')) {
      return url.includes('period=day') ? valor(c.dia, url) : valor(c.demo, url);
    }
    if (url.includes('/me?fields=')) return valor(c.perfil, url);
    if (url.includes('/insights')) return valor(c.post, url);
    return valor(c.imagem, url);
  };
}

function stubFetch(cfg) {
  const f = mockFetch(roteador(cfg));
  vi.stubGlobal('fetch', f);
  return f;
}

const urls = (f, pred) => f.chamadas.map((c) => c.url).filter(pred);
const param = (url, nome) => new URL(url).searchParams.get(nome);

// Dias efetivamente pedidos à API, pela ordem em que foram pedidos, sem repetições.
function diasPedidos(f) {
  const vistos = [];
  for (const u of urls(f, (u) => u.includes('/me/insights') && u.includes('period=day'))) {
    const d = new Date(Number(param(u, 'since')) * 1000).toISOString().slice(0, 10);
    if (!vistos.includes(d)) vistos.push(d);
  }
  return vistos;
}

// ─── env ────────────────────────────────────────────────────────────────────
const tokenValido = () => ({ access_token: 'tok-valido', expires_at: AGORA_S + 40 * 24 * 3600 });

function envIG(extra = {}, kv) {
  return criarEnv({ SESSIONS: new FakeKV(kv ?? { 'ig:token': JSON.stringify(tokenValido()) }), ...extra });
}

// Base de dados que rebenta num SQL específico — para testar isolamento de erros.
function dbFalhaEm(db, padrao) {
  return {
    prepare(sql) {
      if (sql.includes(padrao)) throw new Error('D1 indisponível');
      return db.prepare(sql);
    },
    batch: (s) => db.batch(s),
  };
}

const POST_BASE = {
  id: '18001',
  caption: 'Guarda partilhada em Portugal',
  media_type: 'IMAGE',
  media_product_type: 'FEED',
  media_url: 'https://cdn.exemplo.com/img-18001.jpg',
  permalink: 'https://instagram.com/p/abc',
  timestamp: '2026-08-01T12:00:00+0000',
  like_count: 42,
  comments_count: 7,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(INSTANTE));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════
describe('token do Instagram', () => {
  it('semeia o KV a partir do IG_SEED_TOKEN quando o KV está vazio', async () => {
    const env = envIG({ IG_SEED_TOKEN: 'semente-1' }, {});
    stubFetch();
    await syncInstagram(env);
    const rec = JSON.parse(env.SESSIONS.store.get('ig:token'));
    expect(rec.access_token).toBe('semente-1');
  });

  it('o expires_at semeado fica a 50 dias da hora atual', async () => {
    const env = envIG({ IG_SEED_TOKEN: 'semente-1' }, {});
    stubFetch();
    await syncInstagram(env);
    const rec = JSON.parse(env.SESSIONS.store.get('ig:token'));
    expect(rec.expires_at).toBe(AGORA_S + 50 * 24 * 3600);
  });

  it('usa o token semeado nos pedidos à API', async () => {
    const env = envIG({ IG_SEED_TOKEN: 'semente-1' }, {});
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(f.chamadas[0].url, 'access_token')).toBe('semente-1');
  });

  it('não chama a API de renovação quando o token do KV ainda é válido', async () => {
    const env = envIG();
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => u.includes('refresh_access_token'))).toHaveLength(0);
  });

  it('o token do KV tem precedência sobre o IG_SEED_TOKEN', async () => {
    const env = envIG({ IG_SEED_TOKEN: 'semente-1' });
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(f.chamadas[0].url, 'access_token')).toBe('tok-valido');
  });

  it('registo do KV sem access_token cai para a semente', async () => {
    const env = envIG({ IG_SEED_TOKEN: 'semente-1' }, { 'ig:token': JSON.stringify({ lixo: true }) });
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(f.chamadas[0].url, 'access_token')).toBe('semente-1');
  });

  it('renova o token quando faltam menos de 10 dias para expirar', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => u.includes('refresh_access_token'))).toHaveLength(1);
  });

  it('grava o token renovado no KV', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch();
    await syncInstagram(env);
    expect(JSON.parse(env.SESSIONS.store.get('ig:token')).access_token).toBe('tok-renovado');
  });

  it('marca summary.refreshed quando renova', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch();
    const s = await syncInstagram(env);
    expect(s.refreshed).toBe(true);
  });

  it('usa o expires_in devolvido pela Meta no novo expires_at', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch({ refresh: { json: { access_token: 'tok-renovado', expires_in: 12345 } } });
    await syncInstagram(env);
    expect(JSON.parse(env.SESSIONS.store.get('ig:token')).expires_at).toBe(AGORA_S + 12345);
  });

  it('assume 60 dias quando a Meta não devolve expires_in', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch({ refresh: { json: { access_token: 'tok-renovado' } } });
    await syncInstagram(env);
    expect(JSON.parse(env.SESSIONS.store.get('ig:token')).expires_at).toBe(AGORA_S + 60 * 24 * 3600);
  });

  it('renova na fronteira dos 10 dias exatos (a comparação é estrita)', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 10 * 24 * 3600 }) });
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => u.includes('refresh_access_token'))).toHaveLength(1);
  });

  it('renova quando o registo do KV não traz expires_at', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'sem-validade' }) });
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => u.includes('refresh_access_token'))).toHaveLength(1);
  });

  it('mantém o token antigo quando a renovação devolve erro HTTP', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    const f = stubFetch({ refresh: { status: 400, json: { error: { message: 'token inválido' } } } });
    await syncInstagram(env);
    expect(param(urls(f, (u) => u.includes('/me?fields='))[0], 'access_token')).toBe('a-expirar');
  });

  it('mantém o token antigo quando a resposta da renovação não traz access_token', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    const f = stubFetch({ refresh: { json: { ok: true } } });
    await syncInstagram(env);
    expect(param(urls(f, (u) => u.includes('/me?fields='))[0], 'access_token')).toBe('a-expirar');
  });

  it('mantém o token antigo quando o fetch da renovação rebenta', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    const f = stubFetch({ refresh: { erro: 'rede caiu' } });
    await syncInstagram(env);
    expect(param(urls(f, (u) => u.includes('/me?fields='))[0], 'access_token')).toBe('a-expirar');
  });

  it('não marca refreshed quando a renovação falha', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch({ refresh: { erro: 'rede caiu' } });
    const s = await syncInstagram(env);
    expect(s.refreshed).toBe(false);
  });

  it('não reescreve o KV quando a renovação falha', async () => {
    const env = envIG({}, { 'ig:token': JSON.stringify({ access_token: 'a-expirar', expires_at: AGORA_S + 5 * 24 * 3600 }) });
    stubFetch({ refresh: { erro: 'rede caiu' } });
    await syncInstagram(env);
    expect(env.SESSIONS.puts).toHaveLength(0);
  });

  it('lança erro quando não há token no KV nem semente', async () => {
    const env = envIG({}, {});
    stubFetch();
    await expect(syncInstagram(env)).rejects.toThrow(/sem token do Instagram/i);
  });

  it('um KV que rebenta na leitura não impede a semeadura', async () => {
    const kv = new FakeKV({});
    kv.get = async () => { throw new Error('KV fora'); };
    const env = criarEnv({ SESSIONS: kv, IG_SEED_TOKEN: 'semente-1' });
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(f.chamadas[0].url, 'access_token')).toBe('semente-1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('perfil', () => {
  it('grava a fotografia do dia com seguidores e nº de publicações', async () => {
    const env = envIG();
    stubFetch();
    await syncInstagram(env);
    expect(env.DB.linha('SELECT * FROM ig_snapshots WHERE day = ?', HOJE))
      .toMatchObject({ day: HOJE, followers_count: 128, media_count: 34 });
  });

  it('devolve os números do perfil no summary', async () => {
    const env = envIG();
    stubFetch();
    const s = await syncInstagram(env);
    expect({ f: s.followers, m: s.media_count }).toEqual({ f: 128, m: 34 });
  });

  it('segundo sync no mesmo dia faz UPSERT e não duplica a linha', async () => {
    const env = envIG();
    stubFetch();
    await syncInstagram(env);
    await syncInstagram(env);
    expect(env.DB.conta('ig_snapshots')).toBe(1);
  });

  it('segundo sync no mesmo dia atualiza o número de seguidores', async () => {
    const env = envIG();
    stubFetch();
    await syncInstagram(env);
    vi.unstubAllGlobals();
    stubFetch({ perfil: { json: { followers_count: 200, media_count: 40 } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT followers_count FROM ig_snapshots').followers_count).toBe(200);
  });

  it('media_count ausente fica NULL', async () => {
    const env = envIG();
    stubFetch({ perfil: { json: { followers_count: 128 } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT media_count FROM ig_snapshots').media_count).toBe(null);
  });

  it('resposta sem followers_count vai para summary.errors', async () => {
    const env = envIG();
    stubFetch({ perfil: { json: { error: { message: 'token expirado' } } } });
    const s = await syncInstagram(env);
    expect(s.errors.some((e) => e.startsWith('perfil:'))).toBe(true);
  });

  it('resposta sem followers_count não grava fotografia nenhuma', async () => {
    const env = envIG();
    stubFetch({ perfil: { json: { error: { message: 'token expirado' } } } });
    await syncInstagram(env);
    expect(env.DB.conta('ig_snapshots')).toBe(0);
  });

  it('followers_count em texto é recusado (só aceita número)', async () => {
    const env = envIG();
    stubFetch({ perfil: { json: { followers_count: '128' } } });
    const s = await syncInstagram(env);
    expect(s.followers).toBe(null);
  });

  it('followers_count a zero é gravado (o zero é um valor válido)', async () => {
    const env = envIG();
    stubFetch({ perfil: { json: { followers_count: 0, media_count: 0 } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT followers_count FROM ig_snapshots').followers_count).toBe(0);
  });

  it('erro de rede no perfil não impede a recolha das publicações', async () => {
    const env = envIG();
    stubFetch({ perfil: { erro: 'timeout' }, media: { json: { data: [POST_BASE] } } });
    const s = await syncInstagram(env);
    expect({ erros: s.errors.some((e) => e.startsWith('perfil:')), posts: s.posts }).toEqual({ erros: true, posts: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('publicações', () => {
  it('grava as publicações devolvidas pela API', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT * FROM ig_posts WHERE id = ?', '18001')).toMatchObject({
      caption: 'Guarda partilhada em Portugal',
      media_type: 'IMAGE',
      media_product_type: 'FEED',
      permalink: 'https://instagram.com/p/abc',
      like_count: 42,
      comments_count: 7,
    });
  });

  it('pede no máximo 12 publicações', async () => {
    const env = envIG();
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(urls(f, (u) => u.includes('/me/media'))[0], 'limit')).toBe('12');
  });

  it('correr duas vezes não duplica (upsert por id)', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    await syncInstagram(env);
    expect(env.DB.conta('ig_posts')).toBe(1);
  });

  it('o segundo sync atualiza curtidas e comentários', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    vi.unstubAllGlobals();
    stubFetch({ media: { json: { data: [{ ...POST_BASE, like_count: 99, comments_count: 12 }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT like_count, comments_count FROM ig_posts')).toEqual({ like_count: 99, comments_count: 12 });
  });

  it('campos de texto em falta ficam a null', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [{ id: '18002' }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT caption, media_type, permalink, timestamp FROM ig_posts'))
      .toEqual({ caption: null, media_type: null, permalink: null, timestamp: null });
  });

  it('curtidas e comentários em falta ficam a 0', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [{ id: '18002' }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT like_count, comments_count FROM ig_posts')).toEqual({ like_count: 0, comments_count: 0 });
  });

  it('VIDEO usa o thumbnail_url para a miniatura', async () => {
    const env = envIG();
    const f = stubFetch({
      media: { json: { data: [{ ...POST_BASE, media_type: 'VIDEO', thumbnail_url: 'https://cdn.exemplo.com/thumb.jpg' }] } },
    });
    await syncInstagram(env);
    expect(urls(f, (u) => u.startsWith('https://cdn.exemplo.com'))).toEqual(['https://cdn.exemplo.com/thumb.jpg']);
  });

  it('IMAGE usa o media_url para a miniatura', async () => {
    const env = envIG();
    const f = stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    expect(urls(f, (u) => u.startsWith('https://cdn.exemplo.com'))).toEqual(['https://cdn.exemplo.com/img-18001.jpg']);
  });

  it('VIDEO sem thumbnail_url não vai buscar o media_url', async () => {
    const env = envIG();
    const f = stubFetch({ media: { json: { data: [{ ...POST_BASE, media_type: 'VIDEO' }] } } });
    await syncInstagram(env);
    expect(urls(f, (u) => u.startsWith('https://cdn.exemplo.com'))).toEqual([]);
  });

  it('a miniatura é gravada no R2 com a chave ig/thumbs/<id>.jpg', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    expect([...env.RECIBOS.store.keys()]).toEqual(['ig/thumbs/18001.jpg']);
  });

  it('a chave da miniatura fica gravada em thumb_key', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    const s = await syncInstagram(env);
    expect({ chave: env.DB.linha('SELECT thumb_key FROM ig_posts').thumb_key, thumbs: s.thumbs })
      .toEqual({ chave: 'ig/thumbs/18001.jpg', thumbs: 1 });
  });

  it('preserva o content-type devolvido pelo CDN', async () => {
    const env = envIG();
    stubFetch({
      media: { json: { data: [POST_BASE] } },
      imagem: { texto: 'BYTES', headers: { 'Content-Type': 'image/webp' } },
    });
    await syncInstagram(env);
    expect(env.RECIBOS.store.get('ig/thumbs/18001.jpg').contentType).toBe('image/webp');
  });

  it('falha de rede ao buscar a miniatura não impede o upsert', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } }, imagem: { erro: 'timeout' } });
    const s = await syncInstagram(env);
    expect({ posts: env.DB.conta('ig_posts'), thumbs: s.thumbs }).toEqual({ posts: 1, thumbs: 0 });
  });

  it('miniatura com 404 não é gravada mas o post entra na mesma', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } }, imagem: { status: 404, texto: 'não existe' } });
    await syncInstagram(env);
    expect({ posts: env.DB.conta('ig_posts'), r2: env.RECIBOS.store.size }).toEqual({ posts: 1, r2: 0 });
  });

  it('R2 que rebenta na escrita não impede o upsert', async () => {
    const env = envIG();
    env.RECIBOS.falhaNoPut = 'R2 fora de serviço';
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    const s = await syncInstagram(env);
    expect({ posts: env.DB.conta('ig_posts'), thumbs: s.thumbs }).toEqual({ posts: 1, thumbs: 0 });
  });

  it('sync sem miniatura não apaga o thumb_key já guardado (COALESCE)', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [POST_BASE] } } });
    await syncInstagram(env);
    vi.unstubAllGlobals();
    stubFetch({ media: { json: { data: [{ ...POST_BASE, media_url: undefined }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT thumb_key FROM ig_posts').thumb_key).toBe('ig/thumbs/18001.jpg');
  });

  it('sync sem media_product_type não apaga o valor já guardado (COALESCE)', async () => {
    const env = envIG();
    stubFetch({ media: { json: { data: [{ ...POST_BASE, media_product_type: 'REELS' }] } } });
    await syncInstagram(env);
    vi.unstubAllGlobals();
    stubFetch({ media: { json: { data: [{ ...POST_BASE, media_product_type: undefined }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT media_product_type FROM ig_posts').media_product_type).toBe('REELS');
  });

  it('resposta sem data não grava nada nem rebenta', async () => {
    const env = envIG();
    stubFetch({ media: { json: { error: { message: 'sem permissões' } } } });
    const s = await syncInstagram(env);
    expect({ posts: env.DB.conta('ig_posts'), contador: s.posts }).toEqual({ posts: 0, contador: 0 });
  });

  it('erro de rede nas publicações vai para summary.errors', async () => {
    const env = envIG();
    stubFetch({ media: { erro: 'timeout' } });
    const s = await syncInstagram(env);
    expect(s.errors.some((e) => e.startsWith('media:'))).toBe(true);
  });

  it('grava várias publicações de uma vez', async () => {
    const env = envIG();
    const lote = [1, 2, 3].map((i) => ({ ...POST_BASE, id: '1800' + i, media_url: `https://cdn.exemplo.com/${i}.jpg` }));
    stubFetch({ media: { json: { data: lote } } });
    const s = await syncInstagram(env);
    expect({ posts: env.DB.conta('ig_posts'), contador: s.posts, thumbs: s.thumbs })
      .toEqual({ posts: 3, contador: 3, thumbs: 3 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('insights diários', () => {
  const semearDias = (db, indices) => {
    for (const i of indices) db.exec(`INSERT INTO ig_daily_insights (day, reach) VALUES ('${dia(i)}', 1)`);
  };
  const TODAS = metricas({
    reach: 100, views: 200, accounts_engaged: 30, total_interactions: 40, likes: 25,
    comments: 5, saves: 3, shares: 2, replies: 1, profile_links_taps: 4,
  });

  it('faz no máximo 7 pedidos de dias por corrida', async () => {
    const env = envIG();
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(diasPedidos(f)).toHaveLength(7);
  });

  it('com o histórico vazio começa em hoje e recua dia a dia', async () => {
    const env = envIG();
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(diasPedidos(f)).toEqual([dia(0), dia(1), dia(2), dia(3), dia(4), dia(5), dia(6)]);
  });

  it('revê sempre os 2 dias mais recentes mesmo que já existam', async () => {
    const env = envIG();
    semearDias(env.DB, [...Array(30).keys()]);
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(diasPedidos(f)).toEqual([dia(0), dia(1)]);
  });

  it('preenche os buracos do mais recente para o mais antigo', async () => {
    const env = envIG();
    const buracos = [5, 10, 15, 20, 25, 28];
    semearDias(env.DB, [...Array(30).keys()].filter((i) => !buracos.includes(i)));
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(diasPedidos(f)).toEqual([dia(0), dia(1), dia(5), dia(10), dia(15), dia(20), dia(25)]);
  });

  it('não recua para além dos 30 dias de horizonte', async () => {
    const env = envIG();
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(diasPedidos(f).every((d) => d >= dia(29))).toBe(true);
  });

  it('grava cada métrica na coluna respetiva', async () => {
    const env = envIG();
    stubFetch({ dia: TODAS });
    await syncInstagram(env);
    const r = env.DB.linha('SELECT * FROM ig_daily_insights WHERE day = ?', HOJE);
    expect(r).toMatchObject({
      reach: 100, views: 200, accounts_engaged: 30, total_interactions: 40, likes: 25,
      comments: 5, saves: 3, shares: 2, replies: 1, profile_links_taps: 4,
    });
  });

  it('pede a janela da meia-noite UTC até 24h depois', async () => {
    const env = envIG();
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    const u = urls(f, (x) => x.includes('period=day'))[0];
    expect({ since: param(u, 'since'), until: param(u, 'until') })
      .toEqual({ since: String(meiaNoite(HOJE)), until: String(meiaNoite(HOJE) + 86400) });
  });

  it('pede metric_type=total_value', async () => {
    const env = envIG();
    const f = stubFetch({ dia: TODAS });
    await syncInstagram(env);
    expect(param(urls(f, (x) => x.includes('period=day'))[0], 'metric_type')).toBe('total_value');
  });

  it('COALESCE não apaga valores já guardados quando a métrica vem em falta', async () => {
    const env = envIG();
    env.DB.exec(`INSERT INTO ig_daily_insights (day, reach, views) VALUES ('${HOJE}', 999, 888)`);
    stubFetch({ dia: metricas({ views: 5 }) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach, views FROM ig_daily_insights WHERE day = ?', HOJE))
      .toEqual({ reach: 999, views: 5 });
  });

  it('dia sem métricas nenhumas não insere linha', async () => {
    const env = envIG();
    stubFetch({ dia: { json: { data: [] } } });
    const s = await syncInstagram(env);
    expect({ linhas: env.DB.conta('ig_daily_insights'), dias: s.engagement.days }).toEqual({ linhas: 0, dias: 0 });
  });

  it('conta em summary.engagement.days os dias efetivamente gravados', async () => {
    const env = envIG();
    stubFetch({ dia: TODAS });
    const s = await syncInstagram(env);
    expect(s.engagement.days).toBe(7);
  });

  it('guarda as métricas de hoje em summary.engagement_today', async () => {
    const env = envIG();
    stubFetch({ dia: TODAS });
    const s = await syncInstagram(env);
    expect(s.engagement_today.reach).toBe(100);
  });

  it('valor não numérico numa métrica fica a NULL', async () => {
    const env = envIG();
    stubFetch({ dia: { json: { data: [{ name: 'reach', total_value: { value: 'muitos' } }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach FROM ig_daily_insights WHERE day = ?', HOJE).reach).toBe(null);
  });

  it('lê o último elemento de values quando não há total_value', async () => {
    const env = envIG();
    stubFetch({ dia: { json: { data: [{ name: 'reach', values: [{ value: 1 }, { value: 9 }] }] } } });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach FROM ig_daily_insights WHERE day = ?', HOJE).reach).toBe(9);
  });

  it('métrica com valor zero é gravada como zero', async () => {
    const env = envIG();
    stubFetch({ dia: metricas({ reach: 0 }) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach FROM ig_daily_insights WHERE day = ?', HOJE).reach).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('fetchMetrics — degradação métrica a métrica', () => {
  // Bloco recusado pela Meta; no fallback, 'views' continua a falhar e o resto responde.
  const parcial = (url) => {
    const m = param(url, 'metric');
    if (m.includes(',')) return { json: { error: { message: 'metric views is deprecated' } } };
    if (m === 'views') return { json: { error: { message: 'views indisponivel' } } };
    return metricas({ [m]: 3 });
  };

  it('bloco recusado dispara um pedido por métrica', async () => {
    const env = envIG();
    env.DB.exec(`INSERT INTO ig_daily_insights (day, reach) VALUES ('${dia(2)}', 1)`);
    const f = stubFetch({ dia: parcial });
    await syncInstagram(env);
    const doDia = urls(f, (u) => u.includes('period=day') && param(u, 'since') === String(meiaNoite(HOJE)));
    expect(doDia).toHaveLength(11); // 1 bloco + 10 métricas
  });

  it('guarda as métricas que responderam no fallback', async () => {
    const env = envIG();
    stubFetch({ dia: parcial });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach, likes, views FROM ig_daily_insights WHERE day = ?', HOJE))
      .toEqual({ reach: 3, likes: 3, views: null });
  });

  it('a métrica que falhou isoladamente vai para summary.errors', async () => {
    const env = envIG();
    stubFetch({ dia: parcial });
    const s = await syncInstagram(env);
    expect(s.errors.some((e) => e === `dia ${HOJE}/views: views indisponivel`)).toBe(true);
  });

  it('o erro de uma métrica não derruba o resto do sync', async () => {
    const env = envIG();
    stubFetch({ dia: parcial, media: { json: { data: [POST_BASE] } } });
    const s = await syncInstagram(env);
    expect({ dias: s.engagement.days, posts: s.posts, seguidores: s.followers })
      .toEqual({ dias: 7, posts: 1, seguidores: 128 });
  });

  it('bloco inteiro em erro de rede também degrada para métrica a métrica', async () => {
    const env = envIG();
    const f = stubFetch({ dia: (url) => (param(url, 'metric').includes(',') ? { erro: 'timeout' } : metricas({ reach: 1 })) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach FROM ig_daily_insights WHERE day = ?', HOJE).reach).toBe(1);
    expect(f.chamadas.length).toBeGreaterThan(7);
  });

  it('todas as métricas em erro não inserem linha nenhuma', async () => {
    const env = envIG();
    stubFetch({ dia: { json: { error: { message: 'conta sem insights' } } } });
    const s = await syncInstagram(env);
    expect({ linhas: env.DB.conta('ig_daily_insights'), erros: s.errors.length > 0 })
      .toEqual({ linhas: 0, erros: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('insights por publicação', () => {
  const semearPost = (db, id, tipo) =>
    db.exec(`INSERT INTO ig_posts (id, media_type, media_product_type, timestamp)
             VALUES ('${id}', 'VIDEO', '${tipo}', '2026-08-01T12:00:00+0000')`);

  it('um Reel pede as métricas de Reels', async () => {
    const env = envIG();
    semearPost(env.DB, '900', 'REELS');
    const f = stubFetch();
    await syncInstagram(env);
    expect(param(urls(f, (u) => u.includes('/900/insights'))[0], 'metric')).toContain('ig_reels_avg_watch_time');
  });

  it('uma peça de feed pede as métricas do feed', async () => {
    const env = envIG();
    semearPost(env.DB, '901', 'FEED');
    const f = stubFetch();
    await syncInstagram(env);
    const m = param(urls(f, (u) => u.includes('/901/insights'))[0], 'metric');
    expect({ perfil: m.includes('profile_visits'), reels: m.includes('ig_reels') })
      .toEqual({ perfil: true, reels: false });
  });

  it('grava o tempo de visualização dos Reels', async () => {
    const env = envIG();
    semearPost(env.DB, '900', 'REELS');
    stubFetch({ post: metricas({ ig_reels_avg_watch_time: 3200, ig_reels_video_view_total_time: 99000 }) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT avg_watch_time, watch_time_total FROM ig_post_insights WHERE id = ?', '900'))
      .toEqual({ avg_watch_time: 3200, watch_time_total: 99000 });
  });

  it('grava as métricas de feed nas colunas respetivas', async () => {
    const env = envIG();
    semearPost(env.DB, '901', 'FEED');
    stubFetch({ post: metricas({ reach: 500, views: 700, likes: 20, comments: 4, saved: 6, shares: 2, profile_visits: 9, follows: 1, total_interactions: 32 }) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT * FROM ig_post_insights WHERE id = ?', '901')).toMatchObject({
      reach: 500, views: 700, likes: 20, comments: 4, saved: 6, shares: 2, profile_visits: 9, follows: 1, total_interactions: 32,
    });
  });

  it('publicação sem métricas nenhumas é saltada', async () => {
    const env = envIG();
    semearPost(env.DB, '901', 'FEED');
    stubFetch({ post: { json: { data: [] } } });
    const s = await syncInstagram(env);
    expect({ linhas: env.DB.conta('ig_post_insights'), contador: s.engagement.posts }).toEqual({ linhas: 0, contador: 0 });
  });

  it('correr duas vezes não duplica (upsert por id)', async () => {
    const env = envIG();
    semearPost(env.DB, '901', 'FEED');
    stubFetch({ post: metricas({ reach: 10 }) });
    await syncInstagram(env);
    await syncInstagram(env);
    expect(env.DB.conta('ig_post_insights')).toBe(1);
  });

  it('COALESCE preserva métricas anteriores quando a nova resposta não as traz', async () => {
    const env = envIG();
    semearPost(env.DB, '901', 'FEED');
    env.DB.exec(`INSERT INTO ig_post_insights (id, reach) VALUES ('901', 500)`);
    stubFetch({ post: metricas({ views: 7 }) });
    await syncInstagram(env);
    expect(env.DB.linha('SELECT reach, views FROM ig_post_insights WHERE id = ?', '901'))
      .toEqual({ reach: 500, views: 7 });
  });

  it('só pede insights das 12 publicações mais recentes', async () => {
    const env = envIG();
    for (let i = 0; i < 15; i++) {
      env.DB.exec(`INSERT INTO ig_posts (id, media_product_type, timestamp)
                   VALUES ('p${i}', 'FEED', '2026-07-${String(i + 1).padStart(2, '0')}T10:00:00+0000')`);
    }
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => /\/p\d+\/insights/.test(u))).toHaveLength(12);
  });

  it('sem publicações guardadas não faz pedidos de insights por post', async () => {
    const env = envIG();
    const f = stubFetch();
    await syncInstagram(env);
    expect(urls(f, (u) => /graph\.instagram\.com\/\d+\/insights/.test(u))).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('demografia', () => {
  const demoPorBreakdown = (url) => {
    const b = param(url, 'breakdown');
    const bucket = { country: 'BR', city: 'Lisboa', age: '35-44', gender: 'F' }[b];
    return respDemo([{ dimension_values: [bucket], value: 10 }]);
  };

  it('grava um bucket por dimensão pedida', async () => {
    const env = envIG();
    stubFetch({ demo: demoPorBreakdown });
    const s = await syncInstagram(env);
    expect({ linhas: env.DB.conta('ig_demographics'), contador: s.engagement.demographics })
      .toEqual({ linhas: 6, contador: 6 });
  });

  it('distingue quem segue de quem interage', async () => {
    const env = envIG();
    stubFetch({ demo: demoPorBreakdown });
    await syncInstagram(env);
    expect({
      follower: env.DB.conta('ig_demographics', "kind = 'follower'"),
      engaged: env.DB.conta('ig_demographics', "kind = 'engaged'"),
    }).toEqual({ follower: 4, engaged: 2 });
  });

  it('grava o dia, a dimensão e o valor de cada bucket', async () => {
    const env = envIG();
    stubFetch({ demo: demoPorBreakdown });
    await syncInstagram(env);
    expect(env.DB.linha("SELECT * FROM ig_demographics WHERE kind='follower' AND dimension='city'"))
      .toEqual({ day: HOJE, kind: 'follower', dimension: 'city', bucket: 'Lisboa', value: 10 });
  });

  it('não repete as chamadas quando já existe linha do dia', async () => {
    const env = envIG();
    env.DB.exec(`INSERT INTO ig_demographics (day, kind, dimension, bucket, value)
                 VALUES ('${HOJE}', 'follower', 'country', 'PT', 5)`);
    const f = stubFetch({ demo: demoPorBreakdown });
    await syncInstagram(env);
    expect(urls(f, (u) => u.includes('follower_demographics'))).toHaveLength(0);
  });

  it('linha de outro dia não trava a recolha de hoje', async () => {
    const env = envIG();
    env.DB.exec(`INSERT INTO ig_demographics (day, kind, dimension, bucket, value)
                 VALUES ('${dia(1)}', 'follower', 'country', 'PT', 5)`);
    stubFetch({ demo: demoPorBreakdown });
    const s = await syncInstagram(env);
    expect(s.engagement.demographics).toBe(6);
  });

  it('erro da Meta (conta com menos de 100 seguidores) vai para errors sem derrubar', async () => {
    const env = envIG();
    stubFetch({ demo: { json: { error: { message: 'Insufficient followers' } } } });
    const s = await syncInstagram(env);
    expect({
      erros: s.errors.filter((e) => e.startsWith('demografia/')).length,
      demografia: s.engagement.demographics,
      seguidores: s.followers,
    }).toEqual({ erros: 6, demografia: 0, seguidores: 128 });
  });

  it('erro de rede na demografia vai para errors', async () => {
    const env = envIG();
    stubFetch({ demo: { erro: 'timeout' } });
    const s = await syncInstagram(env);
    expect(s.errors.filter((e) => e.startsWith('demografia/')).length).toBe(6);
  });

  it('buckets com value não numérico são ignorados', async () => {
    const env = envIG();
    stubFetch({ demo: respDemo([{ dimension_values: ['BR'], value: 'muitos' }]) });
    await syncInstagram(env);
    expect(env.DB.conta('ig_demographics')).toBe(0);
  });

  it('bucket sem dimension_values é ignorado', async () => {
    const env = envIG();
    stubFetch({ demo: respDemo([{ value: 10 }]) });
    await syncInstagram(env);
    expect(env.DB.conta('ig_demographics')).toBe(0);
  });

  it('mistura de buckets válidos e inválidos guarda só os válidos', async () => {
    const env = envIG();
    stubFetch({
      demo: (url) => respDemo([
        { dimension_values: ['BR'], value: 10 },
        { dimension_values: ['PT'], value: null },
        { dimension_values: ['ES'], value: 4 },
      ]),
    });
    await syncInstagram(env);
    // 6 pedidos x 2 buckets válidos (o de value null cai fora)
    expect(env.DB.conta('ig_demographics')).toBe(12);
  });

  it('pede period=lifetime e timeframe=last_30_days', async () => {
    const env = envIG();
    const f = stubFetch({ demo: demoPorBreakdown });
    await syncInstagram(env);
    const u = urls(f, (x) => x.includes('follower_demographics'))[0];
    expect({ p: param(u, 'period'), t: param(u, 'timeframe') })
      .toEqual({ p: 'lifetime', t: 'last_30_days' });
  });

  it('resposta sem breakdowns não grava nada', async () => {
    const env = envIG();
    stubFetch({ demo: { json: { data: [{ total_value: { value: 3 } }] } } });
    const s = await syncInstagram(env);
    expect({ linhas: env.DB.conta('ig_demographics'), erros: s.errors.length }).toEqual({ linhas: 0, erros: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('isolamento de erros entre secções', () => {
  it('summary traz sempre a estrutura de engagement', async () => {
    const env = envIG();
    stubFetch();
    const s = await syncInstagram(env);
    expect(s.engagement).toEqual({ days: 0, posts: 0, demographics: 0 });
  });

  it('falha nos insights diários não impede perfil, publicações e demografia', async () => {
    const env = envIG();
    const real = env.DB;
    env.DB = dbFalhaEm(real, 'FROM ig_daily_insights');
    stubFetch({ media: { json: { data: [POST_BASE] } }, demo: respDemo([{ dimension_values: ['BR'], value: 9 }]) });
    const s = await syncInstagram(env);
    expect({
      erro: s.errors.some((e) => e.startsWith('insights/dia:')),
      seguidores: s.followers,
      posts: s.posts,
      demografia: s.engagement.demographics > 0,
    }).toEqual({ erro: true, seguidores: 128, posts: 1, demografia: true });
  });

  it('falha nos insights por publicação não impede a demografia', async () => {
    const env = envIG();
    const real = env.DB;
    env.DB = dbFalhaEm(real, 'FROM ig_posts');
    stubFetch({ demo: respDemo([{ dimension_values: ['BR'], value: 9 }]) });
    const s = await syncInstagram(env);
    expect({
      erro: s.errors.some((e) => e.startsWith('insights/posts:')),
      demografia: s.engagement.demographics > 0,
    }).toEqual({ erro: true, demografia: true });
  });

  it('falha na demografia não apaga o que já foi recolhido', async () => {
    const env = envIG();
    const real = env.DB;
    env.DB = dbFalhaEm(real, 'FROM ig_demographics');
    stubFetch({ media: { json: { data: [POST_BASE] } }, dia: metricas({ reach: 7 }) });
    const s = await syncInstagram(env);
    expect({
      erro: s.errors.some((e) => e.startsWith('insights/demografia:')),
      dias: s.engagement.days,
      snapshots: real.conta('ig_snapshots'),
    }).toEqual({ erro: true, dias: 7, snapshots: 1 });
  });

  it('rede completamente em baixo devolve summary com erros e sem rebentar', async () => {
    const env = envIG();
    stubFetch({ perfil: { erro: 'sem rede' }, media: { erro: 'sem rede' }, dia: { erro: 'sem rede' }, demo: { erro: 'sem rede' } });
    const s = await syncInstagram(env);
    expect({ seguidores: s.followers, posts: s.posts, temErros: s.errors.length > 0 })
      .toEqual({ seguidores: null, posts: 0, temErros: true });
  });

  it('todas as secções em ordem: um sync completo preenche as quatro tabelas', async () => {
    const env = envIG();
    stubFetch({
      media: { json: { data: [{ ...POST_BASE, media_product_type: 'REELS' }] } },
      dia: metricas({ reach: 10, views: 20 }),
      post: metricas({ reach: 5 }),
      demo: respDemo([{ dimension_values: ['BR'], value: 9 }]),
    });
    await syncInstagram(env);
    expect({
      snapshots: env.DB.conta('ig_snapshots'),
      posts: env.DB.conta('ig_posts'),
      dias: env.DB.conta('ig_daily_insights'),
      insights: env.DB.conta('ig_post_insights'),
      demo: env.DB.conta('ig_demographics') > 0,
    }).toEqual({ snapshots: 1, posts: 1, dias: 7, insights: 1, demo: true });
  });
});
