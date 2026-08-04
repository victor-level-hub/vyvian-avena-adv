// tests/worker/visits.test.js — contador de acessos (beacon /api/hit) e a
// pré-visualização pública de artigos (/pre-visual-artigo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidHit, recordVisit } from '../../worker/lib/visits.js';
import { handlePreviaArtigo, tokenPrevia } from '../../worker/routes/previa.js';
import { criarEnv, req, json } from '../helpers/env.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Pedido de beacon: POST /api/hit com o pathname no corpo.
function hit({ ua = CHROME, path, headers = {}, metodo = 'POST' } = {}) {
  const h = { ...headers };
  if (ua !== null) h['User-Agent'] = ua;
  return req(metodo, '/api/hit', path === undefined ? { headers: h } : { body: path, headers: h });
}

afterEach(() => vi.unstubAllGlobals());

// ─────────────────────────────────────────────────────────────────────────────
describe('isValidHit', () => {
  it('aceita um browser real sem Origin nem Referer', () => {
    expect(isValidHit(hit())).toBe(true);
  });

  it('aceita um iPhone', () => {
    expect(isValidHit(hit({ ua: IPHONE }))).toBe(true);
  });

  it('recusa pedidos sem User-Agent', () => {
    expect(isValidHit(hit({ ua: null }))).toBe(false);
  });

  it('recusa User-Agent vazio', () => {
    expect(isValidHit(hit({ ua: '' }))).toBe(false);
  });

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'facebookexternalhit/1.1',
    'WhatsApp/2.23.20.0',
    'TelegramBot (like TwitterBot)',
    'curl/8.4.0',
    'Wget/1.21',
    'python-requests/2.31.0',
    'axios/1.6.0',
    'node-fetch/1.0',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
    'Slackbot-LinkExpanding 1.0',
    'Discordbot/2.0',
    'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    'Screaming Frog SEO Spider/19.0',
  ])('recusa o robô/pré-visualizador %s', (ua) => {
    expect(isValidHit(hit({ ua }))).toBe(false);
  });

  it('aceita quando o Origin é o próprio site', () => {
    expect(isValidHit(hit({ headers: { Origin: 'https://exemplo.pt' } }))).toBe(true);
  });

  it('aceita quando o Referer é uma página do próprio site', () => {
    expect(isValidHit(hit({ headers: { Referer: 'https://exemplo.pt/blog/artigo' } }))).toBe(true);
  });

  it('recusa quando o Origin é outro site (beacon roubado)', () => {
    expect(isValidHit(hit({ headers: { Origin: 'https://site-alheio.com' } }))).toBe(false);
  });

  it('recusa quando o Referer é de outro site', () => {
    expect(isValidHit(hit({ headers: { Referer: 'https://site-alheio.com/pagina' } }))).toBe(false);
  });

  it('o Origin tem prioridade sobre o Referer', () => {
    const bom = hit({ headers: { Origin: 'https://exemplo.pt', Referer: 'https://site-alheio.com/x' } });
    expect(isValidHit(bom)).toBe(true);
    const mau = hit({ headers: { Origin: 'https://site-alheio.com', Referer: 'https://exemplo.pt/x' } });
    expect(isValidHit(mau)).toBe(false);
  });

  it('recusa um Origin ilegível (ex.: «null» de um iframe em sandbox)', () => {
    expect(isValidHit(hit({ headers: { Origin: 'null' } }))).toBe(false);
  });

  it('recusa um Referer que não é um URL', () => {
    expect(isValidHit(hit({ headers: { Referer: 'lixo qualquer' } }))).toBe(false);
  });

  it('distingue subdomínios (www conta como outro host)', () => {
    expect(isValidHit(hit({ headers: { Origin: 'https://www.exemplo.pt' } }))).toBe(false);
  });

  it('ignora o esquema: http do mesmo host passa', () => {
    expect(isValidHit(hit({ headers: { Origin: 'http://exemplo.pt' } }))).toBe(true);
  });

  // Limitação assumida do filtro: apanha pessoas reais em navegadores embebidos
  // cujo UA contém «GoogleApp». Documenta-se para não surpreender depois.
  it('também recusa o navegador embebido da app Google (falso positivo assumido)', () => {
    expect(isValidHit(hit({ ua: 'Mozilla/5.0 (Linux; Android 13) GoogleApp/14.0 Chrome/120' }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('recordVisit', () => {
  let env;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-03T14:25:00Z'));
    env = criarEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('regista um page view na hora corrente (UTC)', async () => {
    await recordVisit(hit({ path: '/blog/artigo' }), env);
    expect(env.DB.linhas('SELECT * FROM site_visits_hourly')).toEqual([
      { hour: '2026-08-03T14', views: 1 },
    ]);
  });

  it('a segunda visita incrementa em vez de duplicar a linha', async () => {
    await recordVisit(hit({ path: '/a' }), env);
    await recordVisit(hit({ path: '/a' }), env);
    await recordVisit(hit({ path: '/a' }), env);
    expect(env.DB.linhas('SELECT * FROM site_visits_hourly')).toEqual([
      { hour: '2026-08-03T14', views: 3 },
    ]);
  });

  it('horas diferentes ficam em linhas diferentes', async () => {
    await recordVisit(hit({ path: '/a' }), env);
    vi.setSystemTime(new Date('2026-08-03T15:01:00Z'));
    await recordVisit(hit({ path: '/a' }), env);
    expect(env.DB.linhas('SELECT hour, views FROM site_visits_hourly ORDER BY hour')).toEqual([
      { hour: '2026-08-03T14', views: 1 },
      { hour: '2026-08-03T15', views: 1 },
    ]);
  });

  it('regista a página do dia a partir do corpo do beacon', async () => {
    await recordVisit(hit({ path: '/blog/nacionalidade-portuguesa' }), env);
    expect(env.DB.linhas('SELECT * FROM site_page_views')).toEqual([
      { day: '2026-08-03', path: '/blog/nacionalidade-portuguesa', views: 1 },
    ]);
  });

  it('a mesma página no mesmo dia incrementa a contagem', async () => {
    await recordVisit(hit({ path: '/blog/x' }), env);
    await recordVisit(hit({ path: '/blog/x' }), env);
    expect(env.DB.linhas('SELECT * FROM site_page_views')).toEqual([
      { day: '2026-08-03', path: '/blog/x', views: 2 },
    ]);
  });

  it('páginas diferentes ficam em linhas diferentes', async () => {
    await recordVisit(hit({ path: '/blog/x' }), env);
    await recordVisit(hit({ path: '/contactos' }), env);
    expect(env.DB.conta('site_page_views')).toBe(2);
  });

  it('o mesmo path em dias diferentes é agregado por dia', async () => {
    await recordVisit(hit({ path: '/blog/x' }), env);
    vi.setSystemTime(new Date('2026-08-04T09:00:00Z'));
    await recordVisit(hit({ path: '/blog/x' }), env);
    expect(env.DB.linhas('SELECT day, views FROM site_page_views ORDER BY day')).toEqual([
      { day: '2026-08-03', views: 1 },
      { day: '2026-08-04', views: 1 },
    ]);
  });

  it('sem corpo usa o pathname do Referer', async () => {
    await recordVisit(hit({ headers: { Referer: 'https://exemplo.pt/servicos/familia' } }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/servicos/familia');
  });

  it('o corpo tem prioridade sobre o Referer', async () => {
    const r = hit({ path: '/do-corpo', headers: { Referer: 'https://exemplo.pt/do-referer' } });
    await recordVisit(r, env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/do-corpo');
  });

  it('corpo só com espaços cai no Referer', async () => {
    await recordVisit(hit({ path: '   ', headers: { Referer: 'https://exemplo.pt/fallback' } }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/fallback');
  });

  it('remove a query string do caminho', async () => {
    await recordVisit(hit({ path: '/blog/x?utm_source=instagram&utm_medium=bio' }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/blog/x');
  });

  it('remove o fragmento do caminho', async () => {
    await recordVisit(hit({ path: '/blog/x#conclusao' }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/blog/x');
  });

  it('remove as barras finais', async () => {
    await recordVisit(hit({ path: '/blog///' }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/blog');
  });

  it('a raiz mantém-se «/»', async () => {
    await recordVisit(hit({ path: '/' }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe('/');
  });

  it('«/» e «/?x=1» são a mesma página', async () => {
    await recordVisit(hit({ path: '/' }), env);
    await recordVisit(hit({ path: '/?x=1' }), env);
    expect(env.DB.linhas('SELECT * FROM site_page_views')).toEqual([
      { day: '2026-08-03', path: '/', views: 2 },
    ]);
  });

  it.each([
    ['blog/sem-barra', 'sem barra inicial'],
    ['https://exemplo.pt/blog/x', 'URL absoluto'],
    ['/admin/painel', 'área privada'],
    ['/api/clients', 'rota de API'],
  ])('ignora o caminho %s (%s)', async (path) => {
    await recordVisit(hit({ path }), env);
    expect(env.DB.conta('site_page_views')).toBe(0);
  });

  it('um caminho ignorado não impede a contagem da hora', async () => {
    await recordVisit(hit({ path: '/admin/painel' }), env);
    expect(env.DB.linha('SELECT views FROM site_visits_hourly').views).toBe(1);
  });

  it('ignora caminhos com mais de 160 caracteres', async () => {
    await recordVisit(hit({ path: '/blog/' + 'a'.repeat(200) }), env);
    expect(env.DB.conta('site_page_views')).toBe(0);
  });

  it('aceita um caminho com exatamente 160 caracteres', async () => {
    const p = '/' + 'a'.repeat(159);
    await recordVisit(hit({ path: p }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views').path).toBe(p);
  });

  // CORRIGIDO (era): o limite de 160 é medido ANTES de cortar a query string, por isso um
  // artigo com uma campanha longa (utm_*) desaparece do Banco de Palavras.
  it('caminho curto com query string longa ser contado', async () => {
    await recordVisit(hit({ path: '/blog/x?' + 'utm_content=' + 'b'.repeat(200) }), env);
    expect(env.DB.linha('SELECT path FROM site_page_views')).toMatchObject({ path: '/blog/x' });
  });

  // Quirk conhecido: o filtro é por prefixo, logo uma página pública que comece
  // por «/admin» (ex.: /administracao-de-insolvencias) nunca seria contada.
  it('descarta páginas públicas cujo caminho comece por /admin (quirk do prefixo)', async () => {
    await recordVisit(hit({ path: '/administracao-de-insolvencias' }), env);
    expect(env.DB.conta('site_page_views')).toBe(0);
  });

  it('regista o visitante único do dia', async () => {
    await recordVisit(hit({ path: '/', headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
  });

  it('o mesmo visitante duas vezes continua a contar como um', async () => {
    const cab = { 'CF-Connecting-IP': '1.2.3.4' };
    await recordVisit(hit({ path: '/', headers: cab }), env);
    await recordVisit(hit({ path: '/outra', headers: cab }), env);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
    expect(env.DB.linha('SELECT SUM(views) AS n FROM site_visits_hourly').n).toBe(2);
  });

  it('IPs diferentes contam como visitantes diferentes', async () => {
    await recordVisit(hit({ path: '/', headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env);
    await recordVisit(hit({ path: '/', headers: { 'CF-Connecting-IP': '5.6.7.8' } }), env);
    expect(env.DB.conta('site_visitors_daily')).toBe(2);
  });

  it('o mesmo IP com browsers diferentes conta como dois visitantes', async () => {
    const ip = { 'CF-Connecting-IP': '1.2.3.4' };
    await recordVisit(hit({ path: '/', headers: ip }), env);
    await recordVisit(hit({ path: '/', ua: IPHONE, headers: ip }), env);
    expect(env.DB.conta('site_visitors_daily')).toBe(2);
  });

  it('o mesmo visitante em dias diferentes gera hashes diferentes (privacidade)', async () => {
    const cab = { 'CF-Connecting-IP': '1.2.3.4' };
    await recordVisit(hit({ path: '/', headers: cab }), env);
    vi.setSystemTime(new Date('2026-08-04T10:00:00Z'));
    await recordVisit(hit({ path: '/', headers: cab }), env);
    const hashes = env.DB.linhas('SELECT visitor_hash FROM site_visitors_daily').map((l) => l.visitor_hash);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('o hash tem 32 hex e não contém o IP em claro', async () => {
    await recordVisit(hit({ path: '/', headers: { 'CF-Connecting-IP': '81.193.44.7' } }), env);
    const { visitor_hash: h } = env.DB.linha('SELECT visitor_hash FROM site_visitors_daily');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain('81');
  });

  it('o segredo influencia o hash (dois ambientes não se cruzam)', async () => {
    const env2 = criarEnv({ JWT_SECRET: 'outro-segredo-completamente' });
    const cab = { 'CF-Connecting-IP': '1.2.3.4' };
    await recordVisit(hit({ path: '/', headers: cab }), env);
    await recordVisit(hit({ path: '/', headers: cab }), env2);
    expect(env.DB.linha('SELECT visitor_hash FROM site_visitors_daily').visitor_hash)
      .not.toBe(env2.DB.linha('SELECT visitor_hash FROM site_visitors_daily').visitor_hash);
  });

  it('sem IP nem UA continua a registar um visitante', async () => {
    await recordVisit(req('POST', '/api/hit', { body: '/' }), env);
    expect(env.DB.conta('site_visitors_daily')).toBe(1);
  });

  it('sem env.DB não faz nada nem rebenta', async () => {
    await expect(recordVisit(hit({ path: '/' }), {})).resolves.toBeUndefined();
  });

  it('um D1 em baixo é silenciado (o beacon nunca parte o serviço)', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const envMau = { DB: { prepare() { throw new Error('D1 indisponível'); } } };
    await expect(recordVisit(hit({ path: '/' }), envMau)).resolves.toBeUndefined();
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });

  it('a falha do contador de páginas não impede o visitante único', async () => {
    const real = env.DB;
    const envParcial = {
      JWT_SECRET: env.JWT_SECRET,
      DB: {
        prepare(sql) {
          if (/site_page_views/.test(sql)) throw new Error('tabela em manutenção');
          return real.prepare(sql);
        },
      },
    };
    await recordVisit(hit({ path: '/blog/x' }), envParcial);
    expect(real.conta('site_page_views')).toBe(0);
    expect(real.conta('site_visitors_daily')).toBe(1);
    expect(real.linha('SELECT views FROM site_visits_hourly').views).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
async function semearArtigo(env, campos = {}) {
  const a = {
    titulo: 'Como pedir a nacionalidade portuguesa',
    descricao: null,
    area: 'nacionalidade',
    idioma: 'pt-PT',
    markdown: '## Requisitos\n\nO pedido faz-se **online**.',
    imagem_escolhida: null,
    publicado_em: null,
    slug: null,
    ...campos,
  };
  const r = await env.DB.prepare(
    `INSERT INTO insight_articles (titulo, descricao, area, idioma, markdown, imagem_escolhida, publicado_em, slug)
     VALUES (?,?,?,?,?,?,?,?) RETURNING id`
  ).bind(a.titulo, a.descricao, a.area, a.idioma, a.markdown, a.imagem_escolhida, a.publicado_em, a.slug).first();
  return r.id;
}

const previa = (id, t) => req('GET', `/pre-visual-artigo?id=${id}&t=${t}`);

describe('tokenPrevia', () => {
  it('devolve 24 caracteres hexadecimais', async () => {
    const t = await tokenPrevia(criarEnv(), 1);
    expect(t).toMatch(/^[0-9a-f]{24}$/);
  });

  it('é estável para o mesmo id e segredo', async () => {
    const env = criarEnv();
    expect(await tokenPrevia(env, 7)).toBe(await tokenPrevia(env, 7));
  });

  it('muda com o id', async () => {
    const env = criarEnv();
    expect(await tokenPrevia(env, 7)).not.toBe(await tokenPrevia(env, 8));
  });

  it('muda com o JWT_SECRET', async () => {
    expect(await tokenPrevia({ JWT_SECRET: 'a' }, 7)).not.toBe(await tokenPrevia({ JWT_SECRET: 'b' }, 7));
  });

  it('funciona (mas é previsível) sem JWT_SECRET', async () => {
    expect(await tokenPrevia({}, 7)).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('handlePreviaArtigo — acesso', () => {
  let env;
  beforeEach(() => { env = criarEnv(); });

  it('sem parâmetros devolve 404 em texto simples', async () => {
    const res = await handlePreviaArtigo(req('GET', '/pre-visual-artigo'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toContain('não encontrada');
  });

  it('id sem token devolve 404', async () => {
    const id = await semearArtigo(env);
    expect((await handlePreviaArtigo(req('GET', `/pre-visual-artigo?id=${id}`), env)).status).toBe(404);
  });

  it('token errado devolve 404', async () => {
    const id = await semearArtigo(env);
    expect((await handlePreviaArtigo(previa(id, 'aaaaaaaaaaaaaaaaaaaaaaaa'), env)).status).toBe(404);
  });

  it('token de outro artigo devolve 404', async () => {
    const id = await semearArtigo(env);
    const outro = await tokenPrevia(env, id + 99);
    expect((await handlePreviaArtigo(previa(id, outro), env)).status).toBe(404);
  });

  it('token válido mas de outro segredo devolve 404', async () => {
    const id = await semearArtigo(env);
    const t = await tokenPrevia({ JWT_SECRET: 'segredo-de-outro-ambiente' }, id);
    expect((await handlePreviaArtigo(previa(id, t), env)).status).toBe(404);
  });

  it('id não numérico devolve 404', async () => {
    expect((await handlePreviaArtigo(req('GET', '/pre-visual-artigo?id=abc&t=x'), env)).status).toBe(404);
  });

  it('id zero devolve 404', async () => {
    const t = await tokenPrevia(env, 0);
    expect((await handlePreviaArtigo(previa(0, t), env)).status).toBe(404);
  });

  it('não toca na base de dados quando o token não bate', async () => {
    const id = await semearArtigo(env);
    const antes = env.DB.queries.length;
    await handlePreviaArtigo(previa(id, 'token-invalido'), env);
    expect(env.DB.queries.length).toBe(antes);
  });

  // parseInt é permissivo: «12abc» vira 12. Documenta-se para não surpreender.
  it('aceita um id com lixo à direita (parseInt permissivo)', async () => {
    const id = await semearArtigo(env);
    const t = await tokenPrevia(env, id);
    const res = await handlePreviaArtigo(req('GET', `/pre-visual-artigo?id=${id}abc&t=${t}`), env);
    expect(res.status).toBe(200);
  });

  it('token válido de artigo inexistente devolve 404 (mas em JSON)', async () => {
    const t = await tokenPrevia(env, 4242);
    const res = await handlePreviaArtigo(previa(4242, t), env);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'Artigo não encontrado' });
  });
});

describe('handlePreviaArtigo — página', () => {
  let env;
  beforeEach(() => { env = criarEnv(); });

  async function abrir(campos = {}) {
    const id = await semearArtigo(env, campos);
    const res = await handlePreviaArtigo(previa(id, await tokenPrevia(env, id)), env);
    return { res, html: await res.text(), id };
  }

  it('devolve 200 com HTML em UTF-8', async () => {
    const { res } = await abrir();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('proíbe cache e indexação nos cabeçalhos', async () => {
    const { res } = await abrir();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('repete o noindex na meta tag do HTML', async () => {
    const { html } = await abrir();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('marca visivelmente a página como pré-visualização', async () => {
    const { html } = await abrir();
    expect(html).toContain('Pré-visualização');
    expect(html).toContain('ainda não publicado');
  });

  it('mostra o título no <title> e no <h1>', async () => {
    const { html } = await abrir({ titulo: 'Herança e partilhas' });
    expect(html).toContain('<title>Prévia · Herança e partilhas</title>');
    expect(html).toContain('<h1>Herança e partilhas</h1>');
  });

  it('converte o markdown em HTML', async () => {
    const { html } = await abrir({ markdown: '## Requisitos\n\nO pedido faz-se **online**.' });
    expect(html).toContain('<h2>Requisitos</h2>');
    expect(html).toContain('<strong>online</strong>');
  });

  it('remove as tags de citação da pesquisa web', async () => {
    const { html } = await abrir({ markdown: 'Segundo a lei<cite id="1">fonte</cite>, o prazo é de 6 meses.<ref>x</ref>' });
    expect(html).not.toContain('<cite');
    expect(html).not.toContain('<ref>');
    expect(html).toContain('o prazo é de 6 meses.');
  });

  it('mostra a etiqueta da área quando é conhecida', async () => {
    const { html } = await abrir({ area: 'familia' });
    expect(html).toContain('Direito de Família');
  });

  it('não inventa etiqueta para uma área desconhecida', async () => {
    const { html } = await abrir({ area: 'fiscal' });
    expect(html).not.toContain('fiscal ·');
  });

  it('artigo sem área não parte a linha de meta', async () => {
    const { res, html } = await abrir({ area: null });
    expect(res.status).toBe(200);
    expect(html).toContain('min de leitura');
  });

  it('usa lang="pt-BR" para artigos brasileiros', async () => {
    const { html } = await abrir({ idioma: 'pt-BR' });
    expect(html).toContain('<html lang="pt-BR">');
  });

  it('usa lang="pt-PT" para tudo o resto', async () => {
    const { html } = await abrir({ idioma: 'pt-PT' });
    expect(html).toContain('<html lang="pt-PT">');
  });

  it('mostra a capa quando há imagem escolhida', async () => {
    const { html } = await abrir({ imagem_escolhida: 12 });
    expect(html).toContain('<img class="capa" src="/api/insights/images/12"');
  });

  it('sem imagem escolhida não há tag de capa', async () => {
    const { html } = await abrir({ imagem_escolhida: null });
    expect(html).not.toContain('class="capa"');
  });

  it('mostra a descrição quando existe', async () => {
    const { html } = await abrir({ descricao: 'Um guia prático para quem vive em Portugal.' });
    expect(html).toContain('Um guia prático para quem vive em Portugal.');
    expect(html).toContain('class="descricao"');
  });

  it('sem descrição não desenha o bloco', async () => {
    const { html } = await abrir({ descricao: null });
    expect(html).not.toContain('class="descricao"');
  });

  it('escapa HTML no título (nada de scripts injetados)', async () => {
    const { html } = await abrir({ titulo: '<script>alert(1)</script> & cia' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; cia');
  });

  it('escapa HTML na descrição', async () => {
    const { html } = await abrir({ descricao: '<img onerror=x>' });
    expect(html).toContain('&lt;img onerror=x&gt;');
  });

  it('mostra pelo menos 1 minuto de leitura num artigo curto', async () => {
    const { html } = await abrir({ markdown: 'Olá.' });
    expect(html).toContain('1 min de leitura');
  });

  it('estima os minutos de leitura de um artigo longo', async () => {
    const { html } = await abrir({ markdown: 'palavra '.repeat(540) });
    expect(html).toContain('3 min de leitura');
  });

  it('assina com o nome da Dra.', async () => {
    const { html } = await abrir();
    expect(html).toContain('Dra. Vyvian Avena');
  });

  it('mostra igualmente um artigo já publicado (a prévia ignora o estado)', async () => {
    const { res, html } = await abrir({ publicado_em: '2026-07-01', slug: 'nacionalidade' });
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>');
  });

  it('mostra um rascunho por publicar (o caso normal)', async () => {
    const { res } = await abrir({ publicado_em: null });
    expect(res.status).toBe(200);
  });

  it('sobrevive a um markdown vazio', async () => {
    const { res, html } = await abrir({ markdown: '' });
    expect(res.status).toBe(200);
    expect(html).toContain('<article class="prosa"></article>');
  });
});
