// tests/worker/stats.test.js
// Estatísticas (worker/routes/stats.js) e painel inicial (worker/routes/dashboard.js).
// Aqui o que mata é a agregação: tabelas vazias, colunas a NULL a entrar em somas,
// divisões por zero e períodos sem dados não podem produzir NaN nem null inesperado
// — a Dra. vê estes números como se fossem verdade.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleStats } from '../../worker/routes/stats.js';
import { handleDashboard } from '../../worker/routes/dashboard.js';
import { criarEnv, req, json, mockFetch, FakeKV } from '../helpers/env.js';

const SESSAO = { sub: 1, name: 'Victor', email: 'v@exemplo.pt', role: 'admin' };

// Instante fixo para os cálculos em JS (Date.now()). Nota: o datetime('now') do
// SQLite continua a usar o relógio verdadeiro — por isso o painel inicial, que
// filtra com date('now'), é semeado com datas relativas à data real.
const INSTANTE = '2026-08-03T12:00:00Z';

let env;
beforeEach(() => { env = criarEnv(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const relogioFixo = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(INSTANTE)); };

function stats(metodo, caminho, corpo) {
  const pathname = caminho.split('?')[0];
  return handleStats(req(metodo, caminho, corpo === undefined ? {} : { body: corpo }), env, pathname, SESSAO);
}
function painel(caminho = '/api/dashboard', metodo = 'GET') {
  const pathname = caminho.split('?')[0];
  return handleDashboard(req(metodo, caminho), env, pathname, SESSAO);
}

// Nenhum valor da resposta pode ser NaN (JSON.stringify transforma-o em null, o que
// é ainda pior — passa despercebido). Percorremos a estrutura toda.
function semNaN(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (Array.isArray(valor)) return valor.every(semNaN);
  if (valor && typeof valor === 'object') return Object.values(valor).every(semNaN);
  return true;
}

// dias e horas relativos ao instante fixo
const dia = (n) => new Date(Date.parse(INSTANTE) + n * 86400000).toISOString().slice(0, 10);
const hora = (n) => new Date(Date.parse(INSTANTE) + n * 3600000).toISOString().slice(0, 13);

const semearHora = (h, views) => env.DB.exec(`INSERT INTO site_visits_hourly (hour, views) VALUES ('${h}', ${views})`);
const semearVisitante = (d, hash) =>
  env.DB.exec(`INSERT INTO site_visitors_daily (day, visitor_hash) VALUES ('${d}', '${hash}')`);

// ═════════════════════════════════════════════════════════════════════════════
// /api/stats/site — acessos ao site
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/stats/site (sem dados)', () => {
  beforeEach(relogioFixo);

  it('com as tabelas vazias devolve uma série completa de zeros', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.series).toHaveLength(7);
    expect(b.series.every((p) => p.views === 0 && p.visitors === 0)).toBe(true);
    expect(b.total_views).toBe(0);
    expect(b.total_visitors).toBe(0);
  });

  it('sem dados o período anterior é zero e não null', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.prev_total_views).toBe(0);
  });

  it('nenhum número da resposta é NaN', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(semNaN(b)).toBe(true);
  });

  it('a série cobre até hoje inclusive', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.series[b.series.length - 1].key).toBe(dia(0));
    expect(b.series[0].key).toBe(dia(-6));
  });

  it('os rótulos vêm em DD/MM', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.series[b.series.length - 1].label).toBe('03/08');
  });

  it('declara o fuso usado nos agrupamentos', async () => {
    expect((await json(await stats('GET', '/api/stats/site'))).tz).toBe('UTC');
  });
});

describe('GET /api/stats/site (períodos)', () => {
  beforeEach(relogioFixo);

  it.each([['7d', 7], ['15d', 15], ['30d', 30], ['60d', 60], ['90d', 90], ['120d', 120]])(
    'o período %s devolve %i pontos diários', async (range, dias) => {
      const b = await json(await stats('GET', `/api/stats/site?range=${range}`));
      expect(b.series).toHaveLength(dias);
      expect(b.granularity).toBe('day');
    });

  it('sem range assume 7 dias', async () => {
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.range).toBe('7d');
  });

  it.each(['1a', '', 'abc', '7', '-30d'])('o range inválido «%s» cai nos 7 dias', async (range) => {
    const b = await json(await stats('GET', `/api/stats/site?range=${range}`));
    expect(b.range).toBe('7d');
    expect(b.series).toHaveLength(7);
  });

  it('o período 1d passa a granularidade horária com 24 pontos', async () => {
    const b = await json(await stats('GET', '/api/stats/site?range=1d'));
    expect(b.granularity).toBe('hour');
    expect(b.series).toHaveLength(24);
    expect(b.series[b.series.length - 1].key).toBe(hora(0));
  });

  it('por hora não há visitantes únicos (o hash é diário)', async () => {
    const b = await json(await stats('GET', '/api/stats/site?range=1d'));
    expect(b.total_visitors).toBe(null);
  });
});

describe('GET /api/stats/site (com dados)', () => {
  beforeEach(relogioFixo);

  it('soma as visitas das horas do mesmo dia', async () => {
    semearHora(dia(0) + 'T09', 3);
    semearHora(dia(0) + 'T10', 4);
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.series[b.series.length - 1].views).toBe(7);
    expect(b.total_views).toBe(7);
  });

  it('conta os visitantes únicos por dia', async () => {
    semearVisitante(dia(0), 'h1');
    semearVisitante(dia(0), 'h2');
    semearVisitante(dia(-1), 'h3');
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.series[b.series.length - 1].visitors).toBe(2);
    expect(b.total_visitors).toBe(3);
  });

  it('ignora dias anteriores à janela', async () => {
    semearHora(dia(-30) + 'T09', 500);
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.total_views).toBe(0);
  });

  it('ignora dias no futuro que a consulta apanha', async () => {
    semearHora(dia(3) + 'T09', 500);
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.total_views).toBe(0);
    expect(b.series.every((p) => p.views === 0)).toBe(true);
  });

  it('o período homólogo anterior conta os 7 dias imediatamente antes', async () => {
    semearHora(dia(-8) + 'T09', 10);
    semearHora(dia(-13) + 'T09', 5);
    semearHora(dia(-14) + 'T09', 99);   // já fora do homólogo
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.prev_total_views).toBe(15);
  });

  it('o dia de hoje não entra no período anterior', async () => {
    semearHora(dia(0) + 'T09', 42);
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.prev_total_views).toBe(0);
    expect(b.total_views).toBe(42);
  });

  it('por hora soma só as últimas 24 horas', async () => {
    semearHora(hora(0), 5);
    semearHora(hora(-23), 2);
    semearHora(hora(-24), 100);         // já fora da janela
    const b = await json(await stats('GET', '/api/stats/site?range=1d'));
    expect(b.total_views).toBe(7);
  });

  it('por hora o período anterior são as 24 horas antes dessas', async () => {
    semearHora(hora(-24), 8);
    semearHora(hora(-47), 1);
    semearHora(hora(-48), 999);
    const b = await json(await stats('GET', '/api/stats/site?range=1d'));
    expect(b.prev_total_views).toBe(9);
  });

  it('os rótulos horários acabam em «h»', async () => {
    const b = await json(await stats('GET', '/api/stats/site?range=1d'));
    expect(b.series[b.series.length - 1].label).toBe('12h');
  });

  it('aguenta contagens muito grandes sem perder precisão', async () => {
    semearHora(dia(0) + 'T09', 2000000000);
    semearHora(dia(-1) + 'T09', 2000000000);
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.total_views).toBe(4000000000);
    expect(semNaN(b)).toBe(true);
  });

  it('um único dia com dados não contamina os outros pontos', async () => {
    semearHora(dia(-3) + 'T01', 9);
    const b = await json(await stats('GET', '/api/stats/site?range=30d'));
    expect(b.series.filter((p) => p.views > 0)).toHaveLength(1);
    expect(b.total_views).toBe(9);
  });

  it('visitantes fora da janela não entram no total', async () => {
    semearVisitante(dia(-40), 'antigo');
    const b = await json(await stats('GET', '/api/stats/site'));
    expect(b.total_visitors).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /api/stats/instagram
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/stats/instagram', () => {
  beforeEach(relogioFixo);

  const semearSnapshot = (d, seguidores, media = 10) => env.DB.exec(
    `INSERT INTO ig_snapshots (day, followers_count, media_count, captured_at)
     VALUES ('${d}', ${seguidores}, ${media}, '${d}T06:00:00Z')`);
  const semearPost = (id, ts, extra = '') => env.DB.exec(
    `INSERT INTO ig_posts (id, caption, media_type, permalink, timestamp, like_count, comments_count${extra ? ', thumb_key' : ''})
     VALUES ('${id}', 'legenda ${id}', 'IMAGE', 'https://instagram.com/p/${id}', '${ts}', 10, 2${extra ? `, '${extra}'` : ''})`);

  it('sem nenhuma recolha devolve a aba vazia sem rebentar', async () => {
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b).toMatchObject({
      has_data: false, followers_count: null, media_count: null, new_followers: null, updated_at: null,
    });
    expect(b.series).toEqual([]);
    expect(b.posts).toEqual([]);
  });

  it('nenhum número é NaN quando não há dados', async () => {
    expect(semNaN(await json(await stats('GET', '/api/stats/instagram')))).toBe(true);
  });

  it('com uma única fotografia os novos seguidores são zero, não null', async () => {
    semearSnapshot(dia(0), 120);
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b.new_followers).toBe(0);
    expect(b.followers_count).toBe(120);
    expect(b.has_data).toBe(true);
  });

  it('com duas fotografias mostra a diferença do período', async () => {
    semearSnapshot(dia(-5), 100);
    semearSnapshot(dia(0), 137);
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b.new_followers).toBe(37);
    expect(b.series).toHaveLength(2);
  });

  it('uma perda de seguidores aparece como número negativo', async () => {
    semearSnapshot(dia(-5), 200);
    semearSnapshot(dia(0), 180);
    expect((await json(await stats('GET', '/api/stats/instagram'))).new_followers).toBe(-20);
  });

  it('as fotografias fora do período não entram na série', async () => {
    semearSnapshot(dia(-90), 10);
    semearSnapshot(dia(-2), 50);
    const b = await json(await stats('GET', '/api/stats/instagram?range=7d'));
    expect(b.series.map((p) => p.key)).toEqual([dia(-2)]);
  });

  it('o total de seguidores vem sempre da fotografia mais recente, mesmo fora do período', async () => {
    semearSnapshot(dia(-90), 88);
    const b = await json(await stats('GET', '/api/stats/instagram?range=7d'));
    expect(b.series).toEqual([]);
    expect(b.followers_count).toBe(88);
    expect(b.new_followers).toBe(null);
  });

  it('sem range assume 30 dias', async () => {
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b).toMatchObject({ range: '30d', period_days: 30, since: dia(-29) });
  });

  it('um range inválido cai nos 30 dias', async () => {
    expect((await json(await stats('GET', '/api/stats/instagram?range=tudo'))).range).toBe('30d');
  });

  it('devolve no máximo 12 publicações, das mais recentes', async () => {
    for (let i = 1; i <= 15; i++) semearPost(`p${i}`, `2026-07-${String(i).padStart(2, '0')}T10:00:00Z`);
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b.posts).toHaveLength(12);
    expect(b.posts[0].id).toBe('p15');
  });

  it('a miniatura só tem URL quando foi copiada para o R2', async () => {
    semearPost('p1', '2026-07-01T10:00:00Z');
    semearPost('p2', '2026-07-02T10:00:00Z', 'ig/thumbs/p2.jpg');
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b.posts.find((p) => p.id === 'p1').thumb_url).toBe(null);
    expect(b.posts.find((p) => p.id === 'p2').thumb_url).toBe('/api/ig/thumb/p2');
  });

  it('as publicações aparecem mesmo sem nenhuma fotografia de seguidores', async () => {
    semearPost('p1', '2026-07-01T10:00:00Z');
    const b = await json(await stats('GET', '/api/stats/instagram'));
    expect(b.posts).toHaveLength(1);
    expect(b.has_data).toBe(false); // has_data segue as fotografias, não as publicações
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /api/stats/engagement
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/stats/engagement', () => {
  beforeEach(relogioFixo);

  const semearDia = (d, v = {}) => {
    const cols = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'saves', 'shares', 'replies', 'profile_links_taps'];
    const valores = cols.map((c) => (v[c] === undefined || v[c] === null ? 'NULL' : v[c])).join(', ');
    env.DB.exec(`INSERT INTO ig_daily_insights (day, ${cols.join(', ')}) VALUES ('${d}', ${valores})`);
  };
  const semearPost = (id, { ts = '2026-07-20T10:00:00Z', tipo = 'IMAGE', produto = 'FEED', likes = 0, comentarios = 0 } = {}) =>
    env.DB.exec(`INSERT INTO ig_posts (id, caption, media_type, media_product_type, permalink, timestamp, like_count, comments_count)
                 VALUES ('${id}', 'legenda', '${tipo}', '${produto}', 'https://x/${id}', '${ts}', ${likes}, ${comentarios})`);
  const semearInsights = (id, { reach = null, interacoes = null, views = null } = {}) =>
    env.DB.exec(`INSERT INTO ig_post_insights (id, reach, views, total_interactions)
                 VALUES ('${id}', ${reach ?? 'NULL'}, ${views ?? 'NULL'}, ${interacoes ?? 'NULL'})`);

  it('com tudo vazio a aba diz que ainda está a recolher', async () => {
    const b = await json(await stats('GET', '/api/stats/engagement'));
    const i = b.platforms.instagram;
    expect(i).toMatchObject({ connected: true, has_data: false, has_daily: false, days_collected: 0 });
    expect(i.posts).toEqual([]);
    expect(i.ranking).toEqual([]);
    expect(i.best).toBe(null);
  });

  it('com tudo vazio os totais são null e não zero', async () => {
    const t = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.totals;
    expect(t.reach).toBe(null);
    expect(t.total_interactions).toBe(null);
  });

  it('com tudo vazio a taxa de engajamento é null e nunca NaN', async () => {
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.engagement_rate).toBe(null);
    expect(semNaN(i)).toBe(true);
  });

  it('com tudo vazio não há formatos, dias da semana nem demografia', async () => {
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.by_format).toEqual([]);
    expect(i.by_weekday).toEqual([]);
    expect(i.demographics).toEqual({});
    expect(i.demographics_day).toBe(null);
  });

  it('soma as colunas dos dias do período', async () => {
    semearDia(dia(0), { reach: 100, total_interactions: 20, likes: 15 });
    semearDia(dia(-1), { reach: 50, total_interactions: 5, likes: 4 });
    const t = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.totals;
    expect(t).toMatchObject({ reach: 150, total_interactions: 25, likes: 19 });
  });

  it('uma coluna que só tem NULL soma para null, não para zero', async () => {
    semearDia(dia(0), { reach: 100 });
    const t = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.totals;
    expect(t.reach).toBe(100);
    expect(t.saves).toBe(null);
  });

  it('mistura de NULL e números soma só o que existe', async () => {
    semearDia(dia(0), { reach: 100 });
    semearDia(dia(-1), { reach: null, views: 7 });
    const t = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.totals;
    expect(t).toMatchObject({ reach: 100, views: 7 });
  });

  it('a taxa de engajamento é interações a dividir por alcance', async () => {
    semearDia(dia(0), { reach: 200, total_interactions: 50 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.engagement_rate).toBeCloseTo(25, 6);
  });

  it('alcance zero não gera divisão por zero na taxa', async () => {
    semearDia(dia(0), { reach: 0, total_interactions: 30 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.engagement_rate).toBe(null);
    expect(semNaN(i)).toBe(true);
  });

  it('interações a null com alcance preenchido também dão taxa null', async () => {
    semearDia(dia(0), { reach: 500 });
    expect((await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.engagement_rate)
      .toBe(null);
  });

  it('a série diária troca os nulos por zero e rotula em DD/MM', async () => {
    semearDia(dia(0), { reach: null, views: null });
    const s = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.series;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: dia(0), label: '03/08', reach: 0, views: 0, interactions: 0 });
  });

  it('os dias anteriores ao período ficam no bloco de comparação', async () => {
    semearDia(dia(0), { reach: 10 });
    semearDia(dia(-40), { reach: 400 });
    const i = (await json(await stats('GET', '/api/stats/engagement?range=30d'))).platforms.instagram;
    expect(i.totals.reach).toBe(10);
    expect(i.prev_totals.reach).toBe(400);
    expect(i.days_collected).toBe(1);
  });

  it('sem período homólogo os totais anteriores são null', async () => {
    semearDia(dia(0), { reach: 10 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.prev_totals.reach).toBe(null);
  });

  it('um dia muito antigo não entra em nenhum dos dois períodos', async () => {
    semearDia(dia(-200), { reach: 999 });
    const i = (await json(await stats('GET', '/api/stats/engagement?range=30d'))).platforms.instagram;
    expect(i.totals.reach).toBe(null);
    expect(i.prev_totals.reach).toBe(null);
  });

  it.each([['7d', 7], ['30d', 30], ['90d', 90]])('o período %s reporta %i dias', async (range, dias) => {
    const b = await json(await stats('GET', `/api/stats/engagement?range=${range}`));
    expect(b).toMatchObject({ range, period_days: dias, since: dia(-(dias - 1)) });
  });

  it('um range inválido cai nos 30 dias', async () => {
    expect((await json(await stats('GET', '/api/stats/engagement?range=xpto'))).range).toBe('30d');
  });

  it('uma publicação sem insights usa curtidas mais comentários', async () => {
    semearPost('p1', { likes: 30, comentarios: 5 });
    const p = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.posts[0];
    expect(p).toMatchObject({ interactions: 35, has_insights: false, reach: null, rate: null });
  });

  it('uma publicação com insights usa o total de interações da API', async () => {
    semearPost('p1', { likes: 30, comentarios: 5 });
    semearInsights('p1', { reach: 400, interacoes: 88 });
    const p = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.posts[0];
    expect(p).toMatchObject({ interactions: 88, has_insights: true, reach: 400 });
    expect(p.rate).toBeCloseTo(22, 6);
  });

  it('alcance zero numa publicação não gera divisão por zero', async () => {
    semearPost('p1', { likes: 3 });
    semearInsights('p1', { reach: 0, interacoes: 3 });
    const p = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.posts[0];
    expect(p.rate).toBe(null);
    expect(semNaN(p)).toBe(true);
  });

  it('o ranking ordena por interações e o melhor é o primeiro', async () => {
    semearPost('fraco', { ts: '2026-07-01T10:00:00Z', likes: 1 });
    semearPost('forte', { ts: '2026-07-02T10:00:00Z', likes: 90 });
    semearPost('medio', { ts: '2026-07-03T10:00:00Z', likes: 40 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.ranking.map((p) => p.id)).toEqual(['forte', 'medio', 'fraco']);
    expect(i.best.id).toBe('forte');
  });

  it('as publicações vêm por data descendente, limitadas a 12', async () => {
    for (let i = 1; i <= 14; i++) semearPost(`p${i}`, { ts: `2026-07-${String(i).padStart(2, '0')}T10:00:00Z` });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.posts).toHaveLength(12);
    expect(i.posts[0].id).toBe('p14');
  });

  it.each([
    ['REELS', 'VIDEO', 'Reel'],
    ['FEED', 'CAROUSEL_ALBUM', 'Álbum'],
    ['FEED', 'VIDEO', 'Vídeo'],
    ['FEED', 'IMAGE', 'Imagem'],
    [null, null, 'Imagem'],
  ])('produto %s + tipo %s é rotulado como %s', async (produto, tipo, rotulo) => {
    env.DB.exec(`INSERT INTO ig_posts (id, media_type, media_product_type, timestamp, like_count, comments_count)
                 VALUES ('p1', ${tipo ? `'${tipo}'` : 'NULL'}, ${produto ? `'${produto}'` : 'NULL'}, '2026-07-01T10:00:00Z', 0, 0)`);
    const p = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.posts[0];
    expect(p.format).toBe(rotulo);
  });

  it('agrupa o desempenho por formato com média arredondada', async () => {
    semearPost('r1', { produto: 'REELS', tipo: 'VIDEO', likes: 10 });
    semearPost('r2', { produto: 'REELS', tipo: 'VIDEO', likes: 5 });
    semearPost('i1', { produto: 'FEED', tipo: 'IMAGE', likes: 4 });
    const f = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_format;
    expect(f.find((x) => x.format === 'Reel')).toMatchObject({ posts: 2, interactions: 15, avg_interactions: 8 });
    expect(f[0].format).toBe('Reel'); // ordenado pela média
  });

  it('sem alcance nenhum, o formato reporta alcance e taxa a null', async () => {
    semearPost('i1', { likes: 4 });
    const f = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_format[0];
    expect(f).toMatchObject({ reach: null, rate: null });
  });

  it('o alcance do formato soma apenas as publicações que o têm', async () => {
    semearPost('i1', { likes: 4 });
    semearPost('i2', { likes: 6 });
    semearInsights('i1', { reach: 200, interacoes: 4 });
    const f = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_format[0];
    expect(f.reach).toBe(200);
    expect(f.interactions).toBe(10);
  });

  // CORRIGIDO (era): em by_format (worker/routes/stats.js:284-297) o numerador da taxa soma as
  // interações de TODAS as publicações do formato, mas o denominador só soma o
  // alcance das que já têm insights. Basta uma peça sem insights para a taxa do
  // formato ficar inflacionada — aqui dá 5% quando a leitura honesta é 2%. A taxa
  // por publicação (linha 274) está bem protegida; esta não.
  it('a taxa por formato só conta as interações das publicações com alcance', async () => {
    semearPost('i1', { likes: 4 });
    semearPost('i2', { likes: 6 });
    semearInsights('i1', { reach: 200, interacoes: 4 });
    const f = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_format[0];
    expect(f.rate).toBeCloseTo(2, 6);
  });

  it('o melhor dia da semana é calculado em UTC e ordenado pela média', async () => {
    semearPost('seg', { ts: '2026-07-20T10:00:00Z', likes: 100 });  // segunda
    semearPost('qua', { ts: '2026-07-22T10:00:00Z', likes: 10 });   // quarta
    const w = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_weekday;
    expect(w[0]).toMatchObject({ day: 'segunda', posts: 1, avg: 100 });
    expect(w[1].day).toBe('quarta');
  });

  it('publicações com data ilegível não entram no dia da semana', async () => {
    semearPost('mau', { ts: 'não é data', likes: 5 });
    semearPost('bom', { ts: '2026-07-20T10:00:00Z', likes: 5 });
    const w = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.by_weekday;
    expect(w).toHaveLength(1);
    expect(semNaN(w)).toBe(true);
  });

  it('a demografia usa só a fotografia mais recente', async () => {
    env.DB.exec(`INSERT INTO ig_demographics (day, kind, dimension, bucket, value) VALUES
      ('${dia(-5)}', 'follower', 'country', 'PT', 10),
      ('${dia(0)}', 'follower', 'country', 'PT', 40),
      ('${dia(0)}', 'follower', 'country', 'BR', 25)`);
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.demographics_day).toBe(dia(0));
    expect(i.demographics.follower_country).toEqual([{ bucket: 'PT', value: 40 }, { bucket: 'BR', value: 25 }]);
  });

  it('a demografia é cortada aos 8 primeiros valores', async () => {
    const linhas = [];
    for (let i = 0; i < 12; i++) linhas.push(`('${dia(0)}', 'follower', 'city', 'cidade${i}', ${100 - i})`);
    env.DB.exec(`INSERT INTO ig_demographics (day, kind, dimension, bucket, value) VALUES ${linhas.join(', ')}`);
    const d = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.demographics;
    expect(d.follower_city).toHaveLength(8);
    expect(d.follower_city[0].bucket).toBe('cidade0');
  });

  it('separa a demografia de quem segue da de quem interage', async () => {
    env.DB.exec(`INSERT INTO ig_demographics (day, kind, dimension, bucket, value) VALUES
      ('${dia(0)}', 'follower', 'age', '25-34', 30),
      ('${dia(0)}', 'engaged', 'age', '35-44', 12)`);
    const d = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram.demographics;
    expect(Object.keys(d).sort()).toEqual(['engaged_age', 'follower_age']);
  });

  it('a contagem de seguidores vem da última fotografia', async () => {
    env.DB.exec(`INSERT INTO ig_snapshots (day, followers_count, media_count, captured_at)
                 VALUES ('${dia(0)}', 321, 40, '${dia(0)}T05:00:00Z')`);
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i).toMatchObject({ followers_count: 321, media_count: 40, updated_at: `${dia(0)}T05:00:00Z` });
  });

  it('números muito grandes continuam finitos', async () => {
    semearDia(dia(0), { reach: 1000000000, total_interactions: 500000000 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.totals.reach).toBe(1000000000);
    expect(i.engagement_rate).toBeCloseTo(50, 6);
    expect(semNaN(i)).toBe(true);
  });

  it('has_data fica verdadeiro quando há publicações mesmo sem dias recolhidos', async () => {
    semearPost('p1', { likes: 1 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i).toMatchObject({ has_data: true, has_daily: false, days_collected: 0 });
  });

  it('o Facebook aparece como não ligado, com a razão explicada', async () => {
    const fb = (await json(await stats('GET', '/api/stats/engagement'))).platforms.facebook;
    expect(fb.connected).toBe(false);
    expect(fb.reason).toContain('token de Página');
  });

  // Documenta um efeito de fronteira: a consulta do período não tem limite superior,
  // por isso um dia com data futura (só possível com dados corrompidos) contaria.
  it('um dia com data futura entra nos totais do período', async () => {
    semearDia(dia(5), { reach: 77 });
    const i = (await json(await stats('GET', '/api/stats/engagement'))).platforms.instagram;
    expect(i.totals.reach).toBe(77);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /api/stats/campaign-history e /api/stats/campaign/end
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/stats/campaign-history', () => {
  beforeEach(relogioFixo);

  it('devolve as entradas semeadas da mais recente para a mais antiga', async () => {
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(b.entries.length).toBeGreaterThanOrEqual(3);
    const datas = b.entries.map((e) => e.data);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('devolve as ações e as métricas já parseadas', async () => {
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(Array.isArray(b.entries[0].acoes)).toBe(true);
    expect(b.entries[0].metricas[0]).toHaveProperty('label');
  });

  it('JSON corrompido numa entrada devolve lista vazia em vez de rebentar', async () => {
    env.DB.exec(`UPDATE campaign_history SET acoes = 'isto não é json'`);
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(b.entries.every((e) => Array.isArray(e.acoes) && e.acoes.length === 0)).toBe(true);
  });

  it('as entradas antigas não têm hora e isso é explícito', async () => {
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(b.entries.every((e) => e.hora === null)).toBe(true);
  });

  it('devolve a data de fim guardada nas definições da campanha', async () => {
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(b.fim).toBe('2026-08-02T23:00:00-03:00');
  });

  it('sem definição de fim devolve null', async () => {
    env.DB.exec(`DELETE FROM campaign_settings`);
    expect((await json(await stats('GET', '/api/stats/campaign-history'))).fim).toBe(null);
  });

  it('sem histórico nenhum devolve lista vazia', async () => {
    env.DB.exec('DELETE FROM campaign_history');
    const b = await json(await stats('GET', '/api/stats/campaign-history'));
    expect(b.entries).toEqual([]);
  });
});

describe('POST /api/stats/campaign/end', () => {
  beforeEach(relogioFixo);

  const guardar = (corpo) => stats('POST', '/api/stats/campaign/end', corpo);
  const valorGuardado = () =>
    env.DB.linha("SELECT valor FROM campaign_settings WHERE chave = 'fim_engajamento'").valor;

  it('guarda a data-hora de fim em horário de Brasília', async () => {
    const b = await json(await guardar({ fim: '2026-08-10T23:00:00-03:00' }));
    expect(b).toMatchObject({ ok: true, fim: '2026-08-10T23:00:00-03:00' });
    expect(valorGuardado()).toBe('2026-08-10T23:00:00-03:00');
  });

  it('substitui o valor anterior em vez de duplicar a chave', async () => {
    await guardar({ fim: '2026-08-10T23:00:00-03:00' });
    await guardar({ fim: '2026-08-11T20:00:00-03:00' });
    expect(env.DB.conta('campaign_settings', "chave = 'fim_engajamento'")).toBe(1);
    expect(valorGuardado()).toBe('2026-08-11T20:00:00-03:00');
  });

  it('fim a null limpa a data', async () => {
    expect((await json(await guardar({ fim: null }))).fim).toBe(null);
    expect(valorGuardado()).toBe(null);
  });

  it.each([['   '], [''], [42], [{ a: 1 }]])('um fim inválido (%s) é guardado como null', async (fim) => {
    expect((await json(await guardar({ fim }))).fim).toBe(null);
  });

  it('corta os espaços à volta da data', async () => {
    expect((await json(await guardar({ fim: '  2026-08-10T23:00:00-03:00  ' }))).fim)
      .toBe('2026-08-10T23:00:00-03:00');
  });

  it('um corpo que não é JSON não rebenta o pedido', async () => {
    const r = await stats('POST', '/api/stats/campaign/end', 'nem por sombras');
    expect(r.status).toBe(200);
    expect((await json(r)).fim).toBe(null);
  });

  it('não valida o formato da data (documenta o comportamento)', async () => {
    expect((await json(await guardar({ fim: 'ontem à noite' }))).fim).toBe('ontem à noite');
  });
});

describe('POST /api/stats/engagement/sync', () => {
  beforeEach(relogioFixo);

  it('sem token do Instagram o pedido rebenta e o router transforma em 500', async () => {
    await expect(stats('POST', '/api/stats/engagement/sync', {}))
      .rejects.toThrow('sem token do Instagram');
  });

  it('com token corre o sync e regista um snapshot no histórico', async () => {
    env.SESSIONS = new FakeKV({ 'ig:token': JSON.stringify({ access_token: 'tok', expires_at: 4102444800 }) });
    vi.stubGlobal('fetch', mockFetch({ json: { followers_count: 130, media_count: 12, data: [] } }));
    const antes = env.DB.conta('campaign_history');
    const r = await stats('POST', '/api/stats/engagement/sync', {});
    expect((await json(r)).ok).toBe(true);
    expect(env.DB.conta('campaign_history')).toBe(antes + 1);
    const nova = env.DB.linha('SELECT * FROM campaign_history ORDER BY id DESC LIMIT 1');
    expect(nova.fase).toBe('verificacao');
    expect(nova.hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it('o snapshot mostra um travessão quando ainda não há métricas', async () => {
    env.SESSIONS = new FakeKV({ 'ig:token': JSON.stringify({ access_token: 'tok', expires_at: 4102444800 }) });
    vi.stubGlobal('fetch', mockFetch({ json: { followers_count: 130, media_count: 12, data: [] } }));
    await stats('POST', '/api/stats/engagement/sync', {});
    const metricas = JSON.parse(env.DB.linha('SELECT metricas FROM campaign_history ORDER BY id DESC LIMIT 1').metricas);
    expect(metricas.find((m) => m.label === 'Taxa de engajamento').valor).toBe('—');
  });

  it('grava também a fotografia de seguidores devolvida pela API', async () => {
    env.SESSIONS = new FakeKV({ 'ig:token': JSON.stringify({ access_token: 'tok', expires_at: 4102444800 }) });
    vi.stubGlobal('fetch', mockFetch({ json: { followers_count: 130, media_count: 12, data: [] } }));
    await stats('POST', '/api/stats/engagement/sync', {});
    expect(env.DB.linha('SELECT followers_count FROM ig_snapshots').followers_count).toBe(130);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /api/stats — métodos e rotas
// ═════════════════════════════════════════════════════════════════════════════
describe('stats — métodos e rotas', () => {
  beforeEach(relogioFixo);

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s /api/stats/site devolve 405', async (metodo) => {
    const r = await stats(metodo, '/api/stats/site', {});
    expect(r.status).toBe(405);
    expect((await json(r)).error).toBe('Method not allowed');
  });

  it('uma rota de estatísticas desconhecida devolve 404', async () => {
    const r = await stats('GET', '/api/stats/inventado');
    expect(r.status).toBe(404);
  });

  it('GET /api/stats devolve 404', async () => {
    expect((await stats('GET', '/api/stats')).status).toBe(404);
  });

  it('POST numa rota de leitura devolve 405 e não 404', async () => {
    expect((await stats('POST', '/api/stats/engagement', {})).status).toBe(405);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PAINEL INICIAL (/api/dashboard)
// ═════════════════════════════════════════════════════════════════════════════
// O SQLite avalia date('now') com o relógio verdadeiro — as datas são semeadas em
// relação ao dia real de hoje (UTC).
describe('GET /api/dashboard', () => {
  const dataReal = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const cliente = (id, nome, pais = 'PT', estado = 'active') => env.DB.exec(
    `INSERT INTO clients (id, name, country, status) VALUES ('${id}', '${nome}', '${pais}', '${estado}')`);
  const parcela = (id, { cli = 'cli-1', valor = 100, moeda = 'EUR', vence = 0, estado = 'pending', pago = null, n = 1 } = {}) =>
    env.DB.exec(`INSERT INTO installments (id, client_id, installment_number, total_installments, amount, currency, due_date, status, paid_date)
                 VALUES ('${id}', '${cli}', ${n}, 3, ${valor}, '${moeda}',
                         '${typeof vence === 'string' ? vence : dataReal(vence)}', '${estado}',
                         ${pago === null ? 'NULL' : `'${pago}'`})`);

  it.each(['POST', 'PUT', 'DELETE'])('%s devolve 405', async (metodo) => {
    const r = await painel('/api/dashboard', metodo);
    expect(r.status).toBe(405);
  });

  it('com a base vazia devolve tudo a zero e listas vazias', async () => {
    const b = await json(await painel());
    expect(b.counts).toEqual({ active_clients: 0, pending: 0, due_today: 0, late: 0, paid_last_30d: 0 });
    expect(b.upcoming_revenue).toEqual([]);
    expect(b.upcoming).toEqual([]);
    expect(b.alerts).toEqual([]);
  });

  it('com a base vazia nenhum número é NaN nem null', async () => {
    const b = await json(await painel());
    expect(semNaN(b)).toBe(true);
    expect(Object.values(b.counts).every((v) => v !== null)).toBe(true);
  });

  it('conta apenas os clientes ativos', async () => {
    cliente('cli-1', 'Maria');
    cliente('cli-2', 'João', 'BR', 'inactive');
    expect((await json(await painel())).counts.active_clients).toBe(1);
  });

  it('conta as parcelas por estado', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { estado: 'pending' });
    parcela('i-2', { estado: 'due_today', n: 2 });
    parcela('i-3', { estado: 'late', n: 3 });
    parcela('i-4', { estado: 'paid', n: 4, pago: dataReal(-1) });
    expect((await json(await painel())).counts).toMatchObject({ pending: 1, due_today: 1, late: 1 });
  });

  it('conta os pagamentos dos últimos 30 dias', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { estado: 'paid', pago: dataReal(-5) });
    parcela('i-2', { estado: 'paid', pago: dataReal(-40), n: 2 });
    expect((await json(await painel())).counts.paid_last_30d).toBe(1);
  });

  it('uma parcela paga sem data de pagamento não conta para os 30 dias', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { estado: 'paid', pago: null });
    expect((await json(await painel())).counts.paid_last_30d).toBe(0);
  });

  it('a receita prevista é agrupada por moeda', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { valor: 100, moeda: 'EUR', vence: 5 });
    parcela('i-2', { valor: 50, moeda: 'EUR', vence: 10, n: 2 });
    parcela('i-3', { valor: 300, moeda: 'BRL', vence: 3, n: 3 });
    const b = await json(await painel());
    expect(b.upcoming_revenue).toEqual(
      expect.arrayContaining([{ currency: 'EUR', total: 150 }, { currency: 'BRL', total: 300 }]));
  });

  it('a receita prevista ignora o que já foi pago e o que vence depois de 30 dias', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { valor: 100, estado: 'paid', vence: 5, pago: dataReal(-1) });
    parcela('i-2', { valor: 200, vence: 40, n: 2 });
    expect((await json(await painel())).upcoming_revenue).toEqual([]);
  });

  it('a receita prevista inclui as parcelas já em atraso', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { valor: 100, estado: 'late', vence: -10 });
    expect((await json(await painel())).upcoming_revenue).toEqual([{ currency: 'EUR', total: 100 }]);
  });

  it('somas grandes mantêm-se exatas', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { valor: 1000000000, vence: 1 });
    parcela('i-2', { valor: 1000000000, vence: 2, n: 2 });
    const b = await json(await painel());
    expect(b.upcoming_revenue[0].total).toBe(2000000000);
    expect(semNaN(b)).toBe(true);
  });

  it('os próximos vencimentos vêm por data ascendente com o nome do cliente', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-2', { vence: 10, n: 2 });
    parcela('i-1', { vence: 2 });
    const b = await json(await painel());
    expect(b.upcoming.map((p) => p.id)).toEqual(['i-1', 'i-2']);
    expect(b.upcoming[0]).toMatchObject({ client_name: 'Maria', client_country: 'PT' });
  });

  it('os próximos vencimentos são no máximo 30', async () => {
    cliente('cli-1', 'Maria');
    for (let i = 1; i <= 35; i++) parcela(`i-${i}`, { vence: 1, n: i });
    expect((await json(await painel())).upcoming).toHaveLength(30);
  });

  it('por omissão a janela é de 30 dias', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 29 });
    parcela('i-2', { vence: 31, n: 2 });
    expect((await json(await painel())).upcoming.map((p) => p.id)).toEqual(['i-1']);
  });

  it.each([
    ['7', 1],      // só a parcela dentro de 7 dias
    ['365', 2],
    ['abc', 1],    // não numérico → 30 dias
    ['0', 1],      // limitado ao mínimo de 1 dia... a parcela de 5 dias fica de fora
  ])('upcoming_days=%s devolve %i parcelas', async (dias, esperado) => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 5 });
    parcela('i-2', { vence: 100, n: 2 });
    const b = await json(await painel(`/api/dashboard?upcoming_days=${dias}`));
    expect(b.upcoming).toHaveLength(dias === '0' ? 0 : esperado);
  });

  it('uma janela acima de 365 dias é limitada a 365', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 300 });
    parcela('i-2', { vence: 400, n: 2 });
    const b = await json(await painel('/api/dashboard?upcoming_days=99999'));
    expect(b.upcoming.map((p) => p.id)).toEqual(['i-1']);
  });

  it('uma janela negativa é limitada a um dia', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 3 });
    expect((await json(await painel('/api/dashboard?upcoming_days=-10'))).upcoming).toEqual([]);
  });

  it('uma janela decimal é truncada', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 10 });
    const b = await json(await painel('/api/dashboard?upcoming_days=10.9'));
    expect(b.upcoming.map((p) => p.id)).toEqual(['i-1']);
  });

  it('os alertas trazem só as parcelas em atraso, com os dias de atraso', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { estado: 'late', vence: -10 });
    parcela('i-2', { estado: 'pending', vence: 5, n: 2 });
    const b = await json(await painel());
    expect(b.alerts.map((a) => a.id)).toEqual(['i-1']);
    expect(b.alerts[0].days_late).toBeGreaterThan(9);
  });

  it('os alertas vêm do mais antigo para o mais recente', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-novo', { estado: 'late', vence: -2 });
    parcela('i-velho', { estado: 'late', vence: -30, n: 2 });
    expect((await json(await painel())).alerts.map((a) => a.id)).toEqual(['i-velho', 'i-novo']);
  });

  it('sem atrasos a lista de alertas vem vazia', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 5 });
    expect((await json(await painel())).alerts).toEqual([]);
  });

  it('as parcelas de clientes inativos continuam a aparecer nos próximos vencimentos', async () => {
    cliente('cli-1', 'Maria', 'PT', 'inactive');
    parcela('i-1', { vence: 3 });
    const b = await json(await painel());
    expect(b.counts.active_clients).toBe(0);
    expect(b.upcoming.map((p) => p.id)).toEqual(['i-1']);
  });

  // Uma data de vencimento corrompida some da janela (date() devolve NULL e a
  // comparação nunca é verdadeira) — a parcela existe mas o painel não a mostra.
  it('uma data de vencimento ilegível desaparece dos próximos vencimentos', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: '2026-13-45' });
    const b = await json(await painel());
    expect(b.upcoming).toEqual([]);
    expect(env.DB.conta('installments')).toBe(1);
  });

  // Nos alertas não há filtro por data, por isso a linha aparece — mas com os dias
  // de atraso a null, que o frontend tem de saber tratar.
  it('uma data ilegível numa parcela em atraso dá dias de atraso a null', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { estado: 'late', vence: '31/12/2026' });
    const b = await json(await painel());
    expect(b.alerts).toHaveLength(1);
    expect(b.alerts[0].days_late).toBe(null);
  });

  it('uma parcela que vence hoje entra na janela', async () => {
    cliente('cli-1', 'Maria');
    parcela('i-1', { vence: 0, estado: 'due_today' });
    expect((await json(await painel())).upcoming.map((p) => p.id)).toEqual(['i-1']);
  });

  it('clientes sem parcelas não geram receita prevista', async () => {
    cliente('cli-1', 'Maria');
    cliente('cli-2', 'João');
    const b = await json(await painel());
    expect(b.counts.active_clients).toBe(2);
    expect(b.upcoming_revenue).toEqual([]);
  });
});
