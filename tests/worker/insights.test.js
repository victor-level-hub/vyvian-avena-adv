// tests/worker/insights.test.js — Insights: estúdio de artigos do blogue
// (sugestões de temas, geração por IA, revisão, imagens/áudio, publicação e
// pré-visualização partilhável). Toda a IA é simulada com `fetch` controlado.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleInsights, limparCitacoes, comAvisoLegal, normalizarBlocos,
} from '../../worker/routes/insights.js';
import { handlePreviaArtigo, tokenPrevia } from '../../worker/routes/previa.js';
import { criarEnv, req, json, mockFetch, geminiJson } from '../helpers/env.js';

// A Dra. autenticada. O handler recebe a sessão mas não a usa — passamo-la à
// mesma, como o worker/index.js faz.
const SESSAO = { user_id: 1, email: 'dra@exemplo.pt', role: 'admin' };

let env;
beforeEach(() => { env = criarEnv(); });
afterEach(() => { vi.unstubAllGlobals(); });

function chamar(metodo, caminho, opts, ambiente) {
  const r = req(metodo, caminho, opts);
  return handleInsights(r, ambiente || env, new URL(r.url).pathname, SESSAO);
}

// ─── respostas de IA ─────────────────────────────────────────────────────────
const geminiTexto = (texto) => ({ json: { candidates: [{ content: { parts: [{ text: texto }] } }] } });
const geminiImagem = (b64 = btoa('PNG-FALSO'), mimeType = 'image/png') => ({
  json: { candidates: [{ content: { parts: [{ inlineData: { data: b64, mimeType } }] } }] },
});
const usarIA = (respostas) => { const f = mockFetch(respostas); vi.stubGlobal('fetch', f); return f; };

const ARTIGO_IA = {
  titulo: 'Nacionalidade portuguesa: o que muda',
  descricao: 'O que muda no pedido de nacionalidade portuguesa e como se preparar sem surpresas.',
  area: 'nacionalidade',
  idioma: 'pt-PT',
  markdown: 'Primeiro parágrafo do artigo.\n\n## Uma secção\n\nCorpo da secção.',
  palavras_chave: [{ termo: 'nacionalidade portuguesa', score: 90 }],
};

const AVALIACAO_IA = {
  texto: { score: 8.4, motivo: 'Bom ritmo.', melhorias: ['Cortar a secção 3.'] },
  seo: { score: 7, motivo: 'Descrição curta.', melhorias: ['Alargar a descrição.'] },
};

// ─── sementes ────────────────────────────────────────────────────────────────
function semearBatch(o = {}) {
  return env.DB.linha(
    `INSERT INTO insight_batches (estado, duracao_ms) VALUES (?,?) RETURNING *`,
    o.estado ?? 'ok', o.duracao_ms ?? 120);
}
function semearTopico(batchId, o = {}) {
  return env.DB.linha(
    `INSERT INTO insight_topics (batch_id, titulo, resumo, justificacao, area, score, fontes, estado)
     VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
    batchId, o.titulo ?? 'Tema de teste', o.resumo ?? 'Resumo do tema',
    o.justificacao ?? 'Porque engaja', o.area ?? 'nacionalidade', o.score ?? 80,
    o.fontes ?? '[]', o.estado ?? 'novo');
}
function semearArtigo(o = {}) {
  return env.DB.linha(
    `INSERT INTO insight_articles
       (topic_id, titulo, descricao, area, idioma, markdown, imagem_escolhida,
        revisto_em, publicar_em, publicado_em, slug, audio_key, audio_em, avaliacao)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    o.topic_id ?? null,
    o.titulo ?? 'Artigo de teste',
    o.descricao ?? 'Descrição SEO com dimensão razoável para os testes de publicação.',
    o.area ?? 'nacionalidade', o.idioma ?? 'pt-PT',
    o.markdown ?? 'Corpo do artigo de teste.',
    o.imagem_escolhida ?? null, o.revisto_em ?? null, o.publicar_em ?? null,
    o.publicado_em ?? null, o.slug ?? null, o.audio_key ?? null, o.audio_em ?? null,
    o.avaliacao ?? null);
}
function semearImagem(articleId, o = {}) {
  const img = env.DB.linha(
    `INSERT INTO insight_images (article_id, r2_key, content_type, prompt, provider, ronda)
     VALUES (?,?,?,?,?,?) RETURNING *`,
    articleId, o.r2_key ?? `insights/art-${articleId}/r1-${Math.random().toString(36).slice(2, 7)}.png`,
    o.content_type ?? 'image/png', o.prompt ?? 'Cena 1: uma cena qualquer',
    o.provider ?? 'gemini', o.ronda ?? 1);
  env.RECIBOS.store.set(img.r2_key, { bytes: new Uint8Array([1, 2, 3]), contentType: img.content_type });
  return img;
}
function noBanco(imageId) {
  return env.DB.linha(`INSERT INTO image_bank (image_id) VALUES (?) RETURNING *`, imageId);
}
// Artigo com tudo o que a publicação exige (revisto + capa).
function artigoPronto(o = {}) {
  const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00', ...o });
  const img = semearImagem(a.id);
  env.DB.exec(`UPDATE insight_articles SET imagem_escolhida = ${img.id} WHERE id = ${a.id}`);
  return { ...a, imagem_escolhida: img.id, img };
}

// ═══════════════════════════════════════════════════════ porta de entrada

describe('handleInsights — porta de entrada', () => {
  it('recusa tudo com 503 quando não há nenhuma chave de IA configurada', async () => {
    const e = criarEnv({ GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined });
    const res = await chamar('GET', '/api/insights/topics', {}, e);
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatch(/IA não configurad/i);
  });

  it('trata chave vazia como chave ausente', async () => {
    const e = criarEnv({ GEMINI_API_KEY: '' });
    expect((await chamar('GET', '/api/insights/sources', {}, e)).status).toBe(503);
  });

  it('basta a chave da Anthropic para servir as rotas', async () => {
    const e = criarEnv({ GEMINI_API_KEY: '', ANTHROPIC_API_KEY: 'chave-claude' });
    expect((await chamar('GET', '/api/insights/topics', {}, e)).status).toBe(200);
  });

  it('devolve 404 numa rota inexistente do módulo', async () => {
    const res = await chamar('GET', '/api/insights/inexistente');
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Not found');
  });

  // O módulo nunca responde 405: um método não suportado cai no 404 final.
  it('responde 404 (e não 405) a um método não suportado num artigo', async () => {
    const a = semearArtigo();
    expect((await chamar('PUT', `/api/insights/articles/${a.id}`)).status).toBe(404);
  });

  it('responde 404 a DELETE numa rota que só aceita GET', async () => {
    expect((await chamar('DELETE', '/api/insights/topics')).status).toBe(404);
  });

  it('ignora ids não numéricos no caminho', async () => {
    expect((await chamar('GET', '/api/insights/articles/abc')).status).toBe(404);
    expect((await chamar('GET', '/api/insights/images/1x')).status).toBe(404);
  });

  it('ignora ids negativos ou decimais no caminho', async () => {
    expect((await chamar('GET', '/api/insights/articles/-1')).status).toBe(404);
    expect((await chamar('GET', '/api/insights/articles/1.5')).status).toBe(404);
  });

  it('não aceita barra final na rota', async () => {
    expect((await chamar('GET', '/api/insights/topics/')).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════ utilitários de texto

describe('limparCitacoes', () => {
  it('remove tags de citação dos modelos com pesquisa web', () => {
    expect(limparCitacoes('O prazo <cite index="2-10">mudou</cite> ontem.')).toBe('O prazo mudou ontem.');
  });

  it('remove também <ref>, <citation> e <source>', () => {
    expect(limparCitacoes('a<ref>b</ref><citation>c</citation><source>d</source>')).toBe('abcd');
  });

  it('remove marcas [1] e [2-3] no fim das frases', () => {
    expect(limparCitacoes('A lei mudou [1]. E o prazo caiu [2-3].')).toBe('A lei mudou. E o prazo caiu.');
  });

  it('não estraga links markdown com texto numérico', () => {
    expect(limparCitacoes('ver [1](https://exemplo.pt)')).toBe('ver [1](https://exemplo.pt)');
  });

  it('junta espaços a mais e limita as linhas em branco', () => {
    expect(limparCitacoes('a  b\n\n\n\nc')).toBe('a b\n\nc');
  });

  it('cola a pontuação que ficou separada', () => {
    expect(limparCitacoes('frase .')).toBe('frase.');
  });

  it('devolve o valor tal e qual quando não é string', () => {
    expect(limparCitacoes(null)).toBe(null);
    expect(limparCitacoes(7)).toBe(7);
  });

  it('não toca em HTML que não seja tag de citação', () => {
    expect(limparCitacoes('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('comAvisoLegal', () => {
  it('acrescenta o aviso legal no fecho do artigo', () => {
    const md = comAvisoLegal('Corpo.', 'pt-PT');
    expect(md).toMatch(/carácter informativo e não constitui aconselhamento jurídico/);
    expect(md.startsWith('Corpo.')).toBe(true);
  });

  it('usa «caráter» quando o artigo é em pt-BR', () => {
    expect(comAvisoLegal('Corpo.', 'pt-BR')).toContain('tem caráter informativo');
  });

  it('não duplica quando o artigo já traz um aviso equivalente', () => {
    const md = 'Corpo.\n\n*Este texto tem carácter informativo.*';
    expect(comAvisoLegal(md, 'pt-PT')).toBe(md);
  });

  it('reconhece a variante «não constitui aconselhamento»', () => {
    const md = 'Corpo.\n\nEste texto não constitui aconselhamento jurídico.';
    expect(comAvisoLegal(md, 'pt-PT')).toBe(md);
  });

  it('devolve vazio para markdown vazio (nada a assinar)', () => {
    expect(comAvisoLegal('', 'pt-PT')).toBe('');
    expect(comAvisoLegal(null, 'pt-PT')).toBe('');
  });

  it('separa o aviso do corpo com uma linha horizontal', () => {
    expect(comAvisoLegal('Corpo.', 'pt-PT')).toContain('\n\n---\n\n*Este artigo tem');
  });
});

describe('normalizarBlocos', () => {
  it('descola um título de uma imagem que vinha imediatamente antes', () => {
    const md = normalizarBlocos('![alt](/api/insights/images/31)## O que diz a lei');
    expect(md).toBe('![alt](/api/insights/images/31)\n\n## O que diz a lei');
  });

  it('mete linha em branco antes de um título ATX colado ao parágrafo', () => {
    expect(normalizarBlocos('Texto\n## Título\n\nCorpo')).toBe('Texto\n\n## Título\n\nCorpo');
  });

  it('mete linha em branco depois do título', () => {
    expect(normalizarBlocos('## Título\nCorpo')).toBe('## Título\n\nCorpo');
  });

  it('não parte um «##» a meio de uma frase', () => {
    expect(normalizarBlocos('isto ## não é título')).toBe('isto ## não é título');
  });

  it('separa o separador --- do parágrafo anterior', () => {
    expect(normalizarBlocos('Fim do corpo\n---')).toBe('Fim do corpo\n\n---');
  });

  it('separa um bloco de citação do parágrafo anterior', () => {
    expect(normalizarBlocos('Texto\n> Aviso')).toBe('Texto\n\n> Aviso');
  });

  it('normaliza quebras de linha do Windows', () => {
    expect(normalizarBlocos('a\r\n\r\nb')).toBe('a\n\nb');
  });

  it('colapsa três ou mais linhas em branco e apara as pontas', () => {
    expect(normalizarBlocos('\n\n  a\n\n\n\nb  \n\n')).toBe('a\n\nb');
  });

  it('aceita valores não-string sem rebentar', () => {
    expect(normalizarBlocos(null)).toBe('');
    expect(normalizarBlocos(undefined)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════ 1) sugestões de temas

const TOPICO = (o = {}) => ({
  titulo: 'AIMA abre novos agendamentos', resumo: 'Resumo do assunto.',
  justificacao: 'Toca no público da Dra.', area: 'nacionalidade', score: 90,
  fontes: [{ nome: 'AIMA', tipo: 'governo', url: 'https://aima.gov.pt/noticias/1', titulo: 'Comunicado' }],
  ...o,
});

describe('POST /api/insights/refresh', () => {
  it('grava as sugestões devolvidas pela IA e responde com o lote', async () => {
    usarIA([geminiJson([TOPICO(), TOPICO({ titulo: 'Segundo tema', score: 70 })])]);
    const res = await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.batch.estado).toBe('ok');
    expect(b.topics).toHaveLength(2);
    expect(b.topics[0].titulo).toBe('AIMA abre novos agendamentos');
  });

  it('devolve as fontes de cada tema já em objeto', async () => {
    usarIA([geminiJson([TOPICO()])]);
    const b = await json(await chamar('POST', '/api/insights/refresh', { body: {} }));
    expect(b.topics[0].fontes[0]).toMatchObject({ nome: 'AIMA', tipo: 'governo' });
  });

  it('guarda no máximo 10 sugestões mesmo que a IA devolva mais', async () => {
    usarIA([geminiJson(Array.from({ length: 14 }, (_, i) => TOPICO({ titulo: `Tema ${i}` })))]);
    await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(env.DB.conta('insight_topics')).toBe(10);
  });

  it('limita o score ao intervalo 0-100 e aceita ausência de score', async () => {
    usarIA([geminiJson([
      TOPICO({ titulo: 'A', score: 150 }), TOPICO({ titulo: 'B', score: -20 }),
      TOPICO({ titulo: 'C', score: 'muito alto' }),
    ])]);
    await chamar('POST', '/api/insights/refresh', { body: {} });
    const linhas = env.DB.linhas('SELECT titulo, score FROM insight_topics ORDER BY id');
    expect(linhas.map((l) => l.score)).toEqual([100, 0, null]);
  });

  it('trunca títulos gigantes a 200 caracteres', async () => {
    usarIA([geminiJson([TOPICO({ titulo: 'x'.repeat(500) })])]);
    await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(env.DB.linha('SELECT titulo FROM insight_topics').titulo).toHaveLength(200);
  });

  it('limpa as tags de citação dos textos das sugestões', async () => {
    usarIA([geminiJson([TOPICO({ titulo: 'O IRN <cite index="1">mudou</cite> a regra' })])]);
    await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(env.DB.linha('SELECT titulo FROM insight_topics').titulo).toBe('O IRN mudou a regra');
  });

  it('conta a indicação nas fontes acompanhadas com o mesmo domínio', async () => {
    usarIA([geminiJson([TOPICO()])]);
    await chamar('POST', '/api/insights/refresh', { body: {} });
    const aima = env.DB.linha(`SELECT indicados FROM insight_sources WHERE url = 'https://aima.gov.pt'`);
    expect(aima.indicados).toBe(1);
  });

  it('leva os títulos já publicados no prompt para a IA não repetir o ângulo', async () => {
    const f = usarIA([geminiJson([TOPICO()])]);
    await chamar('POST', '/api/insights/refresh', { body: { existing_titles: ['Artigo antigo sobre CPLP'] } });
    expect(String(f.chamadas[0].body)).toContain('Artigo antigo sobre CPLP');
  });

  it('aceita corpo JSON inválido (o pedido continua a valer)', async () => {
    usarIA([geminiJson([TOPICO()])]);
    const res = await chamar('POST', '/api/insights/refresh', {
      body: '{isto não é json', headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('devolve 502 e regista o lote em erro quando a IA responde com HTTP != 200', async () => {
    usarIA([{ status: 500, texto: 'motor em baixo' }]);
    const res = await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(res.status).toBe(502);
    const b = env.DB.linha(`SELECT * FROM insight_batches ORDER BY id DESC`);
    expect(b.estado).toBe('erro');
    expect(b.erro).toMatch(/500/);
  });

  it('devolve 502 quando a resposta não traz JSON nenhum', async () => {
    usarIA([geminiTexto('Peço desculpa, não consigo ajudar com isso.')]);
    const res = await chamar('POST', '/api/insights/refresh', { body: {} });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/sem JSON/i);
  });

  it('devolve 502 quando a IA devolve um objeto em vez de uma lista', async () => {
    usarIA([geminiJson({ titulo: 'só um' })]);
    expect((await chamar('POST', '/api/insights/refresh', { body: {} })).status).toBe(502);
  });

  it('devolve 502 quando a lista vem vazia', async () => {
    usarIA([geminiJson([])]);
    expect((await chamar('POST', '/api/insights/refresh', { body: {} })).status).toBe(502);
  });

  it('aceita a lista embrulhada em ```json', async () => {
    usarIA([geminiTexto('```json\n' + JSON.stringify([TOPICO()]) + '\n```')]);
    expect((await chamar('POST', '/api/insights/refresh', { body: {} })).status).toBe(200);
  });
});

describe('GET /api/insights/topics', () => {
  it('devolve lote nulo e lista vazia quando ainda não houve pesquisa', async () => {
    expect(await json(await chamar('GET', '/api/insights/topics'))).toEqual({ batch: null, topics: [] });
  });

  it('ignora lotes que ficaram em erro', async () => {
    const ok = semearBatch(); semearTopico(ok.id, { titulo: 'Do lote bom' });
    env.DB.exec(`INSERT INTO insight_batches (estado, erro) VALUES ('erro', 'falhou')`);
    const b = await json(await chamar('GET', '/api/insights/topics'));
    expect(b.batch.id).toBe(ok.id);
    expect(b.topics[0].titulo).toBe('Do lote bom');
  });

  it('devolve apenas o lote mais recente, ordenado por score', async () => {
    const velho = semearBatch(); semearTopico(velho.id, { titulo: 'Antigo' });
    const novo = semearBatch();
    semearTopico(novo.id, { titulo: 'Menor', score: 10 });
    semearTopico(novo.id, { titulo: 'Maior', score: 99 });
    const b = await json(await chamar('GET', '/api/insights/topics'));
    expect(b.topics.map((t) => t.titulo)).toEqual(['Maior', 'Menor']);
  });

  it('indica o artigo já gerado a partir da sugestão', async () => {
    const lote = semearBatch(); const t = semearTopico(lote.id);
    const a = semearArtigo({ topic_id: t.id });
    const b = await json(await chamar('GET', '/api/insights/topics'));
    expect(b.topics[0].artigo_id).toBe(a.id);
  });

  it('tolera fontes com JSON corrompido na base de dados', async () => {
    const lote = semearBatch(); semearTopico(lote.id, { fontes: '{corrompido' });
    const b = await json(await chamar('GET', '/api/insights/topics'));
    expect(b.topics[0].fontes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════ 2) gerar artigo

describe('POST /api/insights/articles — geração', () => {
  it('gera o artigo a partir de um tema livre e devolve-o com as imagens vazias', async () => {
    usarIA([geminiJson(ARTIGO_IA)]);
    const res = await chamar('POST', '/api/insights/articles', { body: { tema: 'Nacionalidade' } });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.article.titulo).toBe(ARTIGO_IA.titulo);
    expect(b.article.topic_id).toBe(null);
    expect(b.images).toEqual([]);
    expect(b.ronda).toBe(0);
  });

  it('acrescenta sempre o aviso legal ao corpo gerado', async () => {
    usarIA([geminiJson(ARTIGO_IA)]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.markdown).toMatch(/não constitui aconselhamento jurídico/);
  });

  it('normaliza os blocos do markdown gerado', async () => {
    usarIA([geminiJson({ ...ARTIGO_IA, markdown: 'Abertura\n## Secção\nCorpo' })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.markdown).toContain('Abertura\n\n## Secção\n\nCorpo');
  });

  it('gera a partir de uma sugestão e marca-a como «artigo_gerado»', async () => {
    const lote = semearBatch(); const t = semearTopico(lote.id);
    usarIA([geminiJson(ARTIGO_IA)]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { topic_id: t.id } }));
    expect(b.article.topic_id).toBe(t.id);
    expect(env.DB.linha('SELECT estado FROM insight_topics WHERE id = ?', t.id).estado).toBe('artigo_gerado');
  });

  it('recusa com 404 uma sugestão inexistente', async () => {
    usarIA([geminiJson(ARTIGO_IA)]);
    const res = await chamar('POST', '/api/insights/articles', { body: { topic_id: 9999 } });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Sugestão não encontrada');
  });

  it('exige tema ou sugestão', async () => {
    const res = await chamar('POST', '/api/insights/articles', { body: {} });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Indique a sugestão/);
  });

  it('recusa um tema só com espaços', async () => {
    expect((await chamar('POST', '/api/insights/articles', { body: { tema: '   ' } })).status).toBe(400);
  });

  it('recusa corpo JSON inválido como se viesse vazio', async () => {
    const res = await chamar('POST', '/api/insights/articles', { body: 'nada-de-json' });
    expect(res.status).toBe(400);
  });

  it('trunca o tema livre a 300 caracteres antes de ir para o prompt', async () => {
    const f = usarIA([geminiJson(ARTIGO_IA)]);
    await chamar('POST', '/api/insights/articles', { body: { tema: 'A'.repeat(400) } });
    expect(String(f.chamadas[0].body)).toContain('A'.repeat(300) + '\\n');
  });

  it('devolve 502 quando o markdown falta na resposta do modelo', async () => {
    usarIA([geminiJson({ titulo: 'só título' })]);
    const res = await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/artigo incompleto/);
  });

  it('devolve 502 quando o título falta na resposta do modelo', async () => {
    usarIA([geminiJson({ markdown: 'corpo' })]);
    expect((await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } })).status).toBe(502);
  });

  it('devolve 502 quando a IA responde com HTTP 503', async () => {
    usarIA([{ status: 503, texto: 'sobrecarregado' }]);
    const res = await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/503/);
  });

  it('devolve 502 quando a resposta do modelo não é JSON', async () => {
    usarIA([geminiTexto('Não posso escrever esse artigo.')]);
    expect((await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } })).status).toBe(502);
  });

  it('devolve 502 quando o JSON vem cortado a meio', async () => {
    usarIA([geminiTexto('{"titulo":"a","markdown":"corpo sem fecho')]);
    const res = await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/incompleto/i);
  });

  it('aceita JSON embrulhado em ```json com prosa à volta', async () => {
    usarIA([geminiTexto('Aqui vai:\n```json\n' + JSON.stringify(ARTIGO_IA) + '\n```\nEspero que sirva.')]);
    expect((await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } })).status).toBe(200);
  });

  it('preserva chavetas e aspas escapadas dentro do markdown', async () => {
    const md = 'Ele disse "olá" e escreveu \\ e } e { no texto.\n\nSegundo parágrafo.';
    usarIA([geminiJson({ ...ARTIGO_IA, markdown: md })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.markdown).toContain('Ele disse "olá" e escreveu \\ e } e { no texto.');
  });

  it('aceita um artigo enorme sem truncar o corpo', async () => {
    const md = 'Parágrafo longo. '.repeat(6000);
    usarIA([geminiJson({ ...ARTIGO_IA, markdown: md })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.markdown.length).toBeGreaterThan(90000);
  });

  it('guarda pt-BR quando o modelo o indica e cai em pt-PT em qualquer outro caso', async () => {
    usarIA([geminiJson({ ...ARTIGO_IA, idioma: 'pt-BR' })]);
    expect((await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }))).article.idioma).toBe('pt-BR');
    usarIA([geminiJson({ ...ARTIGO_IA, idioma: 'en-US' })]);
    expect((await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'y' } }))).article.idioma).toBe('pt-PT');
  });

  it('trunca o título a 120 caracteres', async () => {
    usarIA([geminiJson({ ...ARTIGO_IA, titulo: 'T'.repeat(300) })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.titulo).toHaveLength(120);
  });

  it('herda a área da sugestão quando o modelo não a devolve', async () => {
    const lote = semearBatch(); const t = semearTopico(lote.id, { area: 'familia' });
    usarIA([geminiJson({ ...ARTIGO_IA, area: undefined })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { topic_id: t.id } }));
    expect(b.article.area).toBe('familia');
  });

  it('guarda as palavras-chave devolvidas pelo modelo no banco de palavras', async () => {
    usarIA([geminiJson(ARTIGO_IA)]);
    await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } });
    expect(env.DB.linha(`SELECT termo FROM keyword_bank`).termo).toBe('nacionalidade portuguesa');
  });

  it('não parte a geração quando as palavras-chave vêm num formato inesperado', async () => {
    usarIA([geminiJson({ ...ARTIGO_IA, palavras_chave: 'nacionalidade' })]);
    expect((await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } })).status).toBe(200);
  });

  it('guarda tal e qual um título com HTML (o escape é feito na apresentação)', async () => {
    usarIA([geminiJson({ ...ARTIGO_IA, titulo: '<script>alert(1)</script>' })]);
    const b = await json(await chamar('POST', '/api/insights/articles', { body: { tema: 'x' } }));
    expect(b.article.titulo).toBe('<script>alert(1)</script>');
  });
});

describe('GET /api/insights/articles — rascunhos de tema livre', () => {
  it('devolve lista vazia quando não há artigos', async () => {
    expect(await json(await chamar('GET', '/api/insights/articles'))).toEqual({ articles: [] });
  });

  it('lista só os artigos sem sugestão associada, do mais recente para o mais antigo', async () => {
    const lote = semearBatch(); const t = semearTopico(lote.id);
    semearArtigo({ titulo: 'Com sugestão', topic_id: t.id });
    semearArtigo({ titulo: 'Livre 1' });
    semearArtigo({ titulo: 'Livre 2' });
    const b = await json(await chamar('GET', '/api/insights/articles'));
    expect(b.articles.map((a) => a.titulo)).toEqual(['Livre 2', 'Livre 1']);
  });

  it('devolve apenas os campos do cartão (sem o markdown)', async () => {
    semearArtigo();
    const b = await json(await chamar('GET', '/api/insights/articles'));
    expect(Object.keys(b.articles[0]).sort()).toEqual(['area', 'criado_em', 'id', 'idioma', 'titulo']);
  });
});

describe('GET /api/insights/articles/:id', () => {
  it('devolve o artigo com as imagens da ronda atual', async () => {
    const a = semearArtigo();
    semearImagem(a.id, { ronda: 1 });
    const i2 = semearImagem(a.id, { ronda: 2 });
    const b = await json(await chamar('GET', `/api/insights/articles/${a.id}`));
    expect(b.ronda).toBe(2);
    expect(b.images.map((i) => i.id)).toEqual([i2.id]);
  });

  it('devolve 404 para um artigo inexistente', async () => {
    const res = await chamar('GET', '/api/insights/articles/424242');
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe('Artigo não encontrado');
  });

  it('esconde as opções descartadas (ronda -1)', async () => {
    const a = semearArtigo();
    semearImagem(a.id, { ronda: -1 });
    const b = await json(await chamar('GET', `/api/insights/articles/${a.id}`));
    expect(b.images).toEqual([]);
    expect(b.ronda).toBe(0);
  });

  it('assinala as imagens adotadas do banco', async () => {
    const a = semearArtigo();
    semearImagem(a.id, { prompt: 'banco#77' });
    const b = await json(await chamar('GET', `/api/insights/articles/${a.id}`));
    expect(b.images[0].banco_origem).toBe(77);
  });
});

// ═══════════════════════════════════════════════════════ edição

describe('PATCH /api/insights/articles/:id', () => {
  it('atualiza título, descrição e corpo', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, {
      body: { titulo: 'Novo título', descricao: 'Nova descrição', markdown: 'Novo corpo.' },
    }));
    expect(b.article.titulo).toBe('Novo título');
    expect(b.article.descricao).toBe('Nova descrição');
    expect(b.article.markdown).toBe('Novo corpo.');
    expect(b.article.atualizado_em).toBeTruthy();
  });

  it('recusa um pedido sem nada para atualizar', async () => {
    const a = semearArtigo();
    const res = await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: {} });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Nada para atualizar');
  });

  it('ignora campos que não sejam do tipo esperado', async () => {
    const a = semearArtigo();
    const res = await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { titulo: 123, markdown: null } });
    expect(res.status).toBe(400);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('PATCH', '/api/insights/articles/999', { body: { titulo: 'x' } })).status).toBe(404);
  });

  it('trunca o título a 120 e a descrição a 300 caracteres', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, {
      body: { titulo: 'T'.repeat(200), descricao: 'D'.repeat(400) },
    }));
    expect(b.article.titulo).toHaveLength(120);
    expect(b.article.descricao).toHaveLength(300);
  });

  it('normaliza os blocos do markdown guardado', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, {
      body: { markdown: 'Texto\n## Título\nCorpo' },
    }));
    expect(b.article.markdown).toBe('Texto\n\n## Título\n\nCorpo');
  });

  it('marca «Revisto pela Dra.» quando pedido explicitamente', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { revisto: true } }));
    expect(b.article.revisto_em).toBeTruthy();
  });

  it('desmarca a revisão quando pedido explicitamente', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { revisto: false } }));
    expect(b.article.revisto_em).toBe(null);
  });

  it('limpa a revisão sozinha quando o conteúdo muda', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { markdown: 'Corpo diferente.' } }));
    expect(b.article.revisto_em).toBe(null);
  });

  it('mantém a revisão quando o conteúdo enviado é igual ao guardado', async () => {
    const a = semearArtigo({ markdown: 'Corpo igual.', revisto_em: '2026-08-01 10:00:00' });
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, {
      body: { markdown: 'Corpo igual.', titulo: a.titulo },
    }));
    expect(b.article.revisto_em).toBe('2026-08-01 10:00:00');
  });

  it('a marcação explícita ganha a uma alteração de conteúdo no mesmo pedido', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, {
      body: { markdown: 'Outro corpo.', revisto: true },
    }));
    expect(b.article.revisto_em).toBeTruthy();
  });

  it('aceita qualquer área sem validar contra a lista de slugs (documenta o comportamento)', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { area: 'astrologia' } }));
    expect(b.article.area).toBe('astrologia');
  });

  it('trata aspas e SQL no título como texto puro', async () => {
    const a = semearArtigo();
    const mau = `'; DROP TABLE insight_articles;--`;
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { titulo: mau } }));
    expect(b.article.titulo).toBe(mau);
    expect(env.DB.conta('insight_articles')).toBe(1);
  });

  it('aceita título vazio (o bloqueio acontece só na publicação)', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('PATCH', `/api/insights/articles/${a.id}`, { body: { titulo: '' } }));
    expect(b.article.titulo).toBe('');
  });
});

describe('DELETE /api/insights/articles/:id', () => {
  it('apaga o rascunho e devolve o id apagado', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('DELETE', `/api/insights/articles/${a.id}`));
    expect(b).toEqual({ ok: true, apagado: a.id });
    expect(env.DB.conta('insight_articles')).toBe(0);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('DELETE', '/api/insights/articles/777')).status).toBe(404);
  });

  it('recusa apagar um artigo já publicado no blogue', async () => {
    const a = semearArtigo({ publicado_em: '2026-08-02 09:00:00' });
    const res = await chamar('DELETE', `/api/insights/articles/${a.id}`);
    expect(res.status).toBe(409);
    expect(env.DB.conta('insight_articles')).toBe(1);
  });

  it('apaga a narração e as imagens do R2', async () => {
    const a = semearArtigo({ audio_key: 'insights/art-1/narracao.mp3' });
    env.RECIBOS.store.set('insights/art-1/narracao.mp3', { bytes: new Uint8Array([9]), contentType: 'audio/mpeg' });
    const img = semearImagem(a.id);
    await chamar('DELETE', `/api/insights/articles/${a.id}`);
    expect(env.RECIBOS.store.has('insights/art-1/narracao.mp3')).toBe(false);
    expect(env.RECIBOS.store.has(img.r2_key)).toBe(false);
  });

  it('não rebenta se o ficheiro de áudio já não existir no R2', async () => {
    const a = semearArtigo({ audio_key: 'insights/desaparecido.mp3' });
    expect((await chamar('DELETE', `/api/insights/articles/${a.id}`)).status).toBe(200);
  });

  it('devolve a sugestão de origem à lista de temas', async () => {
    const lote = semearBatch();
    const t = semearTopico(lote.id, { estado: 'artigo_gerado' });
    const a = semearArtigo({ topic_id: t.id });
    await chamar('DELETE', `/api/insights/articles/${a.id}`);
    expect(env.DB.linha('SELECT estado FROM insight_topics WHERE id = ?', t.id).estado).toBe('sugerido');
  });

  it('não apaga do R2 os bytes de uma imagem que está no Banco de Imagens', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    noBanco(img.id);
    await chamar('DELETE', `/api/insights/articles/${a.id}`);
    expect(env.RECIBOS.store.has(img.r2_key)).toBe(true);
  });

  // BUG: o comentário do código diz que as imagens guardadas no Banco de Imagens
  // sobrevivem ao apagar do artigo, mas insight_images.article_id tem ON DELETE
  // CASCADE e image_bank.image_id também — apagar o artigo leva à frente a linha
  // da imagem e a entrada do banco. Ficam apenas os bytes órfãos no R2 (que o
  // código deliberadamente não apagou). worker/routes/insights.js:827-837.
  it.fails('mantém no banco a imagem guardada depois de apagar o artigo', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    noBanco(img.id);
    await chamar('DELETE', `/api/insights/articles/${a.id}`);
    expect(env.DB.conta('image_bank')).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════ correções por IA

describe('POST /api/insights/articles/:id/corrigir', () => {
  const CORRECAO = {
    markdown: 'Corpo corrigido pela IA. '.repeat(20),
    titulo: 'Título corrigido',
    descricao: 'Descrição corrigida para o teste.',
    notas: 'Ajustei o prazo da secção 3.',
  };

  it('aplica as correções ao artigo inteiro e devolve as notas', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    usarIA([geminiJson(CORRECAO)]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Corrige o prazo da secção 3.' },
    }));
    expect(b.article.titulo).toBe('Título corrigido');
    expect(b.article.markdown).toContain('Corpo corrigido pela IA.');
    expect(b.notas).toBe('Ajustei o prazo da secção 3.');
  });

  it('limpa a revisão da Dra. porque o conteúdo mudou', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    usarIA([geminiJson(CORRECAO)]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Muda o tom da abertura.' },
    }));
    expect(b.article.revisto_em).toBe(null);
  });

  it('garante o aviso legal no texto corrigido', async () => {
    const a = semearArtigo();
    usarIA([geminiJson(CORRECAO)]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Corrige tudo.' },
    }));
    expect(b.article.markdown).toMatch(/não constitui aconselhamento jurídico/);
  });

  it('exige uma descrição da correção com pelo menos 5 caracteres', async () => {
    const a = semearArtigo();
    const res = await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, { body: { instrucoes: 'ok' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Descreva a correção/);
  });

  it('recusa instruções só com espaços', async () => {
    const a = semearArtigo();
    expect((await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, { body: { instrucoes: '        ' } })).status).toBe(400);
  });

  it('valida as instruções antes de procurar o artigo', async () => {
    expect((await chamar('POST', '/api/insights/articles/999/corrigir', { body: { instrucoes: '' } })).status).toBe(400);
  });

  it('devolve 404 para artigo inexistente com instruções válidas', async () => {
    expect((await chamar('POST', '/api/insights/articles/999/corrigir', { body: { instrucoes: 'Corrige o prazo.' } })).status).toBe(404);
  });

  it('devolve 502 quando a correção vem demasiado curta', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ markdown: 'curto demais' })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, { body: { instrucoes: 'Corrige.' } });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/incompleta/);
  });

  it('devolve 502 quando o motor de IA falha', async () => {
    const a = semearArtigo();
    usarIA([{ status: 500, texto: 'boom' }]);
    expect((await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, { body: { instrucoes: 'Corrige.' } })).status).toBe(502);
  });

  it('em modo trecho devolve a proposta sem gravar nada', async () => {
    const a = semearArtigo({ markdown: 'Corpo original.' });
    usarIA([geminiJson({ texto: 'Trecho corrigido.', notas: 'Troquei uma palavra.' })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Troca a palavra X.', selecao: 'Corpo original.' },
    });
    expect(await json(res)).toEqual({ ok: true, texto: 'Trecho corrigido.', notas: 'Troquei uma palavra.' });
    expect(env.DB.linha('SELECT markdown FROM insight_articles WHERE id = ?', a.id).markdown).toBe('Corpo original.');
  });

  it('limpa as tags de citação do trecho corrigido', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: 'Trecho <cite index="3">limpo</cite>.', notas: '' })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Corrige.', selecao: 'trecho' },
    }));
    expect(b.texto).toBe('Trecho limpo.');
  });

  it('devolve 502 quando o trecho corrigido vem vazio', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: '   ', notas: 'nada' })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/corrigir`, {
      body: { instrucoes: 'Corrige.', selecao: 'trecho' },
    });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/vazia/);
  });
});

// ═══════════════════════════════════════════════════════ avaliação

describe('POST /api/insights/articles/:id/avaliar', () => {
  it('guarda a nota da IA e devolve-a', async () => {
    const a = semearArtigo();
    usarIA([geminiJson(AVALIACAO_IA)]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/avaliar`));
    expect(b.ok).toBe(true);
    expect(b.avaliacao.texto.score).toBe(8.4);
    expect(b.avaliacao.seo.motivo).toBe('Descrição curta.');
    expect(b.avaliacao.avaliado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const guardada = JSON.parse(env.DB.linha('SELECT avaliacao FROM insight_articles WHERE id = ?', a.id).avaliacao);
    expect(guardada.texto.score).toBe(8.4);
  });

  it('limita as notas ao intervalo 0-10', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: { score: 25 }, seo: { score: -4 } })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/avaliar`));
    expect(b.avaliacao.texto.score).toBe(10);
    expect(b.avaliacao.seo.score).toBe(0);
  });

  it('trata nota não numérica como zero', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: { score: 'muito bom' }, seo: {} })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/avaliar`));
    expect(b.avaliacao.texto.score).toBe(0);
    expect(b.avaliacao.seo).toEqual({ score: 0, motivo: '', melhorias: [] });
  });

  it('guarda no máximo 4 sugestões de melhoria', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: { score: 5, melhorias: ['a', 'b', 'c', 'd', 'e', 'f'] }, seo: { score: 5 } })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/avaliar`));
    expect(b.avaliacao.texto.melhorias).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignora melhorias que não venham em lista', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ texto: { score: 5, melhorias: 'melhora tudo' }, seo: { score: 5 } })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/avaliar`));
    expect(b.avaliacao.texto.melhorias).toEqual([]);
  });

  it('recorre ao motor de reserva quando a primeira via falha', async () => {
    const a = semearArtigo();
    usarIA([{ status: 500, texto: 'falhou' }, geminiJson(AVALIACAO_IA)]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/avaliar`);
    expect(res.status).toBe(200);
    expect((await json(res)).avaliacao.texto.score).toBe(8.4);
  });

  it('recorre ao motor de reserva quando o JSON da primeira via vem truncado', async () => {
    const a = semearArtigo();
    usarIA([geminiTexto('{"texto":{"score":8'), geminiJson(AVALIACAO_IA)]);
    expect((await chamar('POST', `/api/insights/articles/${a.id}/avaliar`)).status).toBe(200);
  });

  it('devolve 502 quando as duas vias falham', async () => {
    const a = semearArtigo();
    usarIA({ status: 500, texto: 'em baixo' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/avaliar`);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/Falha na avaliação/);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('POST', '/api/insights/articles/321/avaliar')).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════ narração

describe('narração do artigo (ElevenLabs + R2)', () => {
  const comVoz = (extra = {}) => criarEnv({ ELEVENLABS_API_KEY: 'chave-eleven', ...extra });

  it('recusa gerar sem ELEVENLABS_API_KEY', async () => {
    const a = semearArtigo();
    const res = await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatch(/ELEVENLABS_API_KEY/);
  });

  it('gera o MP3, guarda-o no R2 e regista a chave', async () => {
    env = comVoz();
    const a = semearArtigo({ markdown: '## Título\n\nCorpo do artigo.' });
    usarIA([{ texto: 'MP3-FALSO' }]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/audio`));
    expect(b.ok).toBe(true);
    expect(b.bytes).toBe(9);
    expect(b.audio_key).toMatch(new RegExp(`^insights/art-${a.id}/narracao-\\d+\\.mp3$`));
    expect(env.RECIBOS.store.get(b.audio_key).contentType).toBe('audio/mpeg');
    expect(b.audio_em).toBeTruthy();
  });

  it('envia para a ElevenLabs o texto falado, sem markdown', async () => {
    env = comVoz();
    const a = semearArtigo({ titulo: 'O título', markdown: '## Secção\n\n**Negrito** e ![img](/x.png) e [link](https://e.pt).' });
    const f = usarIA([{ texto: 'MP3' }]);
    await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    const enviado = JSON.parse(f.chamadas[0].body).text;
    expect(enviado).toContain('O título.');
    expect(enviado).not.toContain('##');
    expect(enviado).not.toContain('![img]');
    expect(enviado).toContain('link');
  });

  it('substitui a narração anterior em vez de acumular MP3', async () => {
    env = comVoz();
    const a = semearArtigo({ audio_key: 'insights/art-1/narracao-antiga.mp3' });
    env.RECIBOS.store.set('insights/art-1/narracao-antiga.mp3', { bytes: new Uint8Array([1]), contentType: 'audio/mpeg' });
    usarIA([{ texto: 'MP3-NOVO' }]);
    await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    expect(env.RECIBOS.store.has('insights/art-1/narracao-antiga.mp3')).toBe(false);
    expect([...env.RECIBOS.store.keys()]).toHaveLength(1);
  });

  it('devolve 404 para artigo inexistente', async () => {
    env = comVoz();
    expect((await chamar('POST', '/api/insights/articles/555/audio')).status).toBe(404);
  });

  it('recusa gerar narração de um artigo sem texto', async () => {
    env = comVoz();
    const a = semearArtigo({ markdown: '   ' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/ainda não tem texto/);
  });

  it('devolve 502 quando a ElevenLabs responde com erro', async () => {
    env = comVoz();
    const a = semearArtigo();
    usarIA([{ status: 401, texto: 'chave inválida' }]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/ElevenLabs: 401/);
  });

  it('devolve 502 quando o áudio vem vazio', async () => {
    env = comVoz();
    const a = semearArtigo();
    usarIA([{ texto: '' }]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/áudio vazio/);
  });

  it('serve o MP3 com o tipo de conteúdo e a cache certos', async () => {
    const a = semearArtigo({ audio_key: 'insights/art-1/narracao.mp3' });
    env.RECIBOS.store.set('insights/art-1/narracao.mp3', { bytes: new TextEncoder().encode('MP3'), contentType: 'audio/mpeg' });
    const res = await chamar('GET', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(await res.text()).toBe('MP3');
  });

  it('devolve 404 quando o artigo ainda não tem narração', async () => {
    const a = semearArtigo();
    const res = await chamar('GET', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatch(/ainda não tem narração/);
  });

  it('devolve 404 quando o ficheiro desapareceu do R2', async () => {
    const a = semearArtigo({ audio_key: 'insights/desaparecido.mp3' });
    const res = await chamar('GET', `/api/insights/articles/${a.id}/audio`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatch(/Ficheiro de áudio/);
  });
});

// ═══════════════════════════════════════════════════════ publicação

describe('POST /api/insights/articles/:id/publicar', () => {
  it('mete o artigo na fila e gera o slug a partir do título', async () => {
    const a = artigoPronto({ titulo: 'Nacionalidade portuguesa em 2026' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.slug).toBe('nacionalidade-portuguesa-em-2026');
    expect(b.article.publicar_em).toBeTruthy();
    expect(b.article.publicado_em).toBe(null);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('POST', '/api/insights/articles/808/publicar')).status).toBe(404);
  });

  it('recusa republicar um artigo já publicado', async () => {
    const a = artigoPronto({ publicado_em: '2026-08-01 10:00:00' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/já foi publicado/);
  });

  it('exige a revisão da Dra.', async () => {
    const a = artigoPronto({ revisto_em: null });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Revisto pela Dra/);
  });

  it('exige a imagem de capa', async () => {
    const a = semearArtigo({ revisto_em: '2026-08-01 10:00:00' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/imagem de capa/);
  });

  it('exige título com 60 caracteres no máximo', async () => {
    const a = artigoPronto({ titulo: 'T'.repeat(61) });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/60 caracteres/);
  });

  it('exige título não vazio', async () => {
    const a = artigoPronto({ titulo: '' });
    expect((await chamar('POST', `/api/insights/articles/${a.id}/publicar`)).status).toBe(400);
  });

  it('exige descrição SEO com 155 caracteres no máximo', async () => {
    const a = artigoPronto({ descricao: 'D'.repeat(156) });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/155 caracteres/);
  });

  it('exige descrição SEO preenchida', async () => {
    const a = artigoPronto({ descricao: '' });
    expect((await chamar('POST', `/api/insights/articles/${a.id}/publicar`)).status).toBe(400);
  });

  it('tira acentos, maiúsculas e pontuação do slug', async () => {
    const a = artigoPronto({ titulo: 'Herança, Sucessões & Cônjuges: o Guia!' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.slug).toBe('heranca-sucessoes-conjuges-o-guia');
  });

  it('junta espaços seguidos num único traço e apara as pontas', async () => {
    const a = artigoPronto({ titulo: '  ---  AIMA   e   o   prazo  ---  ' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.slug).toBe('aima-e-o-prazo');
  });

  it('limita o slug a 80 caracteres', async () => {
    const a = artigoPronto({ titulo: 'palavra '.repeat(7) + 'fim' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.slug.length).toBeLessThanOrEqual(80);
  });

  it('recusa quando o título não deixa nenhum slug utilizável', async () => {
    const a = artigoPronto({ titulo: '«»!!! ??? ...' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicar`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/slug/);
  });

  it('mantém o slug que já tinha sido atribuído', async () => {
    const a = artigoPronto({ titulo: 'Outro título qualquer', slug: 'slug-antigo' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.slug).toBe('slug-antigo');
  });

  it('acrescenta o aviso legal a rascunhos antigos antes de publicar', async () => {
    const a = artigoPronto({ markdown: 'Corpo sem aviso.' });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/publicar`));
    expect(b.article.markdown).toMatch(/não constitui aconselhamento jurídico/);
  });

  // CORRIGIDO (era): dois artigos com o mesmo título produzem o mesmo slug e nada o impede —
  // o pipeline escreve <slug>.md no repo, por isso o segundo artigo sobrepõe-se
  // silenciosamente ao primeiro em /blog/<slug>. worker/routes/insights.js:583.
  it('não deixa dois artigos ficarem com o mesmo slug', async () => {
    const a1 = artigoPronto({ titulo: 'Nacionalidade portuguesa em 2026' });
    const a2 = artigoPronto({ titulo: 'Nacionalidade portuguesa em 2026' });
    const s1 = (await json(await chamar('POST', `/api/insights/articles/${a1.id}/publicar`))).article.slug;
    const s2 = (await json(await chamar('POST', `/api/insights/articles/${a2.id}/publicar`))).article.slug;
    expect(s2).not.toBe(s1);
  });
});

describe('GET /api/insights/fila-publicacao', () => {
  const comChave = () => criarEnv({ PUBLISH_KEY: 'chave-do-pipeline' });

  it('recusa sem chave', async () => {
    env = comChave();
    const res = await chamar('GET', '/api/insights/fila-publicacao');
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('Chave inválida');
  });

  it('recusa com chave errada', async () => {
    env = comChave();
    expect((await chamar('GET', '/api/insights/fila-publicacao?key=errada')).status).toBe(401);
  });

  it('recusa quando o Worker não tem PUBLISH_KEY configurada', async () => {
    expect((await chamar('GET', '/api/insights/fila-publicacao?key=qualquer')).status).toBe(401);
  });

  it('devolve os artigos em fila com a capa e as imagens do corpo', async () => {
    env = comChave();
    const a = semearArtigo({
      slug: 'artigo-em-fila', publicar_em: '2026-08-02 08:00:00',
      revisto_em: '2026-08-01 09:30:00', imagem_escolhida: 5,
      markdown: 'Texto\n\n![a](/api/insights/images/7)\n\n![b](/api/insights/images/9)\n\n![b2](/api/insights/images/7)',
    });
    const b = await json(await chamar('GET', '/api/insights/fila-publicacao?key=chave-do-pipeline'));
    expect(b.artigos).toHaveLength(1);
    expect(b.artigos[0]).toMatchObject({ id: a.id, slug: 'artigo-em-fila', capa_image_id: 5, revisto_em: '2026-08-01' });
    expect(b.artigos[0].body_image_ids).toEqual([7, 9]);
  });

  it('não devolve artigos já publicados nem rascunhos fora da fila', async () => {
    env = comChave();
    semearArtigo({ titulo: 'Rascunho' });
    semearArtigo({ titulo: 'Publicado', publicar_em: '2026-08-01 08:00:00', publicado_em: '2026-08-01 09:00:00' });
    const b = await json(await chamar('GET', '/api/insights/fila-publicacao?key=chave-do-pipeline'));
    expect(b.artigos).toEqual([]);
  });

  it('limpa as tags de citação do markdown entregue ao pipeline', async () => {
    env = comChave();
    semearArtigo({ publicar_em: '2026-08-02 08:00:00', markdown: 'Texto <cite index="1">citado</cite>.' });
    const b = await json(await chamar('GET', '/api/insights/fila-publicacao?key=chave-do-pipeline'));
    expect(b.artigos[0].markdown).toBe('Texto citado.');
  });
});

describe('POST /api/insights/articles/:id/publicado', () => {
  const comChave = () => criarEnv({ PUBLISH_KEY: 'chave-do-pipeline' });

  it('recusa sem chave', async () => {
    env = comChave();
    const a = semearArtigo({ publicar_em: '2026-08-02 08:00:00' });
    expect((await chamar('POST', `/api/insights/articles/${a.id}/publicado`)).status).toBe(401);
  });

  it('marca a data de publicação de um artigo que estava em fila', async () => {
    env = comChave();
    const a = semearArtigo({ publicar_em: '2026-08-02 08:00:00' });
    const res = await chamar('POST', `/api/insights/articles/${a.id}/publicado?key=chave-do-pipeline`);
    expect(await json(res)).toEqual({ ok: true });
    expect(env.DB.linha('SELECT publicado_em FROM insight_articles WHERE id = ?', a.id).publicado_em).toBeTruthy();
  });

  it('não marca um artigo que nunca entrou na fila', async () => {
    env = comChave();
    const a = semearArtigo();
    await chamar('POST', `/api/insights/articles/${a.id}/publicado?key=chave-do-pipeline`);
    expect(env.DB.linha('SELECT publicado_em FROM insight_articles WHERE id = ?', a.id).publicado_em).toBe(null);
  });

  it('responde ok mesmo para um artigo inexistente (documenta o comportamento)', async () => {
    env = comChave();
    const res = await chamar('POST', '/api/insights/articles/9090/publicado?key=chave-do-pipeline');
    expect(await json(res)).toEqual({ ok: true });
  });
});

// ═══════════════════════════════════════════════════════ imagens

describe('POST /api/insights/articles/:id/images — geração', () => {
  it('gera quatro opções, guarda-as no R2 e abre a ronda 1', async () => {
    const a = semearArtigo();
    usarIA([geminiImagem()]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/images`));
    expect(b.ronda).toBe(1);
    expect(b.images).toHaveLength(4);
    expect([...env.RECIBOS.store.keys()].sort()).toEqual([
      `insights/art-${a.id}/r1-1.png`, `insights/art-${a.id}/r1-2.png`,
      `insights/art-${a.id}/r1-3.png`, `insights/art-${a.id}/r1-4.png`,
    ]);
  });

  it('usa a extensão certa conforme o tipo devolvido pelo modelo', async () => {
    const a = semearArtigo();
    usarIA([geminiImagem(btoa('JPG'), 'image/jpeg')]);
    await chamar('POST', `/api/insights/articles/${a.id}/images`);
    expect([...env.RECIBOS.store.keys()][0]).toMatch(/\.jpg$/);
  });

  it('a ronda seguinte incrementa e invalida a capa escolhida', async () => {
    const a = artigoPronto();
    usarIA([geminiImagem()]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/images`));
    expect(b.ronda).toBe(2);
    expect(b.article.imagem_escolhida).toBe(null);
  });

  it('devolve 404 para artigo inexistente', async () => {
    usarIA([geminiImagem()]);
    expect((await chamar('POST', '/api/insights/articles/616/images')).status).toBe(404);
  });

  it('devolve 502 quando nenhuma imagem é gerada', async () => {
    const a = semearArtigo();
    usarIA([geminiJson({ candidates: [{ content: { parts: [{ text: 'sem imagem' }] } }] })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/images`);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/Nenhuma imagem gerada/);
  });

  it('recorre ao Recraft quando o Gemini não devolve imagem', async () => {
    env = criarEnv({ RECRAFT_API_KEY: 'chave-recraft' });
    const a = semearArtigo();
    usarIA((url) => {
      if (url.includes('generativelanguage')) return { json: { candidates: [] } };
      if (url.includes('recraft')) return { json: { data: [{ url: 'https://cdn.recraft.ai/x.png' }] } };
      return { texto: 'BYTES-PNG', headers: { 'Content-Type': 'image/png' } };
    });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/images`));
    expect(b.images).toHaveLength(4);
    expect(b.images[0].provider).toBe('recraft');
  });

  it('inclui no prompt as correções de imagem apontadas pela Dra.', async () => {
    const a = semearArtigo();
    await env.SESSIONS.put('insights:img-correcoes', JSON.stringify([{ id: 1, texto: 'Nunca ecrãs virados para a câmara' }]));
    const f = usarIA([geminiImagem()]);
    await chamar('POST', `/api/insights/articles/${a.id}/images`);
    expect(String(f.chamadas[0].body)).toContain('Nunca ecrãs virados para a câmara');
  });
});

describe('escolher, servir, substituir e descartar imagens', () => {
  it('escolhe a capa do artigo', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/escolher-imagem`, { body: { image_id: img.id } }));
    expect(b.article.imagem_escolhida).toBe(img.id);
  });

  it('recusa uma imagem de outro artigo', async () => {
    const a = semearArtigo(); const outro = semearArtigo();
    const img = semearImagem(outro.id);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/escolher-imagem`, { body: { image_id: img.id } });
    expect(res.status).toBe(404);
  });

  it('recusa quando não vem image_id', async () => {
    const a = semearArtigo();
    expect((await chamar('POST', `/api/insights/articles/${a.id}/escolher-imagem`, { body: {} })).status).toBe(404);
  });

  it('serve os bytes da imagem com o tipo e a cache certos', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { content_type: 'image/jpeg' });
    const res = await chamar('GET', `/api/insights/images/${img.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('devolve 404 para uma imagem inexistente', async () => {
    expect((await chamar('GET', '/api/insights/images/4242')).status).toBe(404);
  });

  it('devolve 404 quando o objeto já não está no R2', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    env.RECIBOS.store.delete(img.r2_key);
    const res = await chamar('GET', `/api/insights/images/${img.id}`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatch(/armazenamento/);
  });

  it('substitui os bytes da imagem mantendo a mesma chave R2', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const bytes = new Uint8Array([7, 7, 7, 7]);
    const b = await json(await chamar('PUT', `/api/insights/images/${img.id}`, {
      binario: bytes, headers: { 'Content-Type': 'image/webp' },
    }));
    expect(b).toEqual({ ok: true, id: img.id, bytes: 4 });
    expect(env.RECIBOS.store.get(img.r2_key).bytes).toEqual(bytes);
    expect(env.DB.linha('SELECT content_type FROM insight_images WHERE id = ?', img.id).content_type).toBe('image/webp');
  });

  it('recusa substituir com corpo vazio', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const res = await chamar('PUT', `/api/insights/images/${img.id}`, { binario: new Uint8Array(0) });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Corpo vazio');
  });

  it('recusa imagens acima de 8 MB', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const res = await chamar('PUT', `/api/insights/images/${img.id}`, { binario: new Uint8Array(8 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it('devolve 404 ao substituir uma imagem inexistente', async () => {
    expect((await chamar('PUT', '/api/insights/images/99', { binario: new Uint8Array([1]) })).status).toBe(404);
  });

  it('descarta uma opção da ronda e limpa a capa se era ela', async () => {
    const a = artigoPronto();
    const b = await json(await chamar('DELETE', `/api/insights/articles/${a.id}/images/${a.img.id}`));
    expect(b.article.imagem_escolhida).toBe(null);
    expect(b.images).toEqual([]);
    expect(env.DB.linha('SELECT ronda FROM insight_images WHERE id = ?', a.img.id).ronda).toBe(-1);
    expect(env.RECIBOS.store.has(a.img.r2_key)).toBe(true);
  });

  it('não descarta duas vezes a mesma imagem', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: -1 });
    expect((await chamar('DELETE', `/api/insights/articles/${a.id}/images/${img.id}`)).status).toBe(404);
  });

  it('não descarta uma imagem de outro artigo', async () => {
    const a = semearArtigo(); const outro = semearArtigo();
    const img = semearImagem(outro.id);
    expect((await chamar('DELETE', `/api/insights/articles/${a.id}/images/${img.id}`)).status).toBe(404);
  });

  // Comportamento a vigiar: uma opção descartada continua a poder ser escolhida
  // como capa — não há filtro por ronda em chooseImage.
  it('deixa escolher como capa uma imagem já descartada (comportamento atual)', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: -1 });
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/escolher-imagem`, { body: { image_id: img.id } }));
    expect(b.article.imagem_escolhida).toBe(img.id);
    expect(b.images).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════ banco de imagens

describe('Banco de Imagens', () => {
  it('guarda uma imagem no banco', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const b = await json(await chamar('POST', '/api/insights/banco', { body: { image_ids: [img.id] } }));
    expect(b).toEqual({ ok: true, resultados: [{ image_id: img.id, estado: 'guardada' }] });
  });

  it('aceita também um único image_id', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    const b = await json(await chamar('POST', '/api/insights/banco', { body: { image_id: img.id } }));
    expect(b.resultados[0].estado).toBe('guardada');
  });

  it('não duplica uma imagem já guardada', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    noBanco(img.id);
    const b = await json(await chamar('POST', '/api/insights/banco', { body: { image_ids: [img.id] } }));
    expect(b.resultados[0].estado).toBe('ja_existia');
    expect(b.resultados[0].criado_em).toBeTruthy();
  });

  it('assinala imagens inexistentes', async () => {
    const b = await json(await chamar('POST', '/api/insights/banco', { body: { image_ids: [4242] } }));
    expect(b.resultados[0].estado).toBe('inexistente');
  });

  it('recusa um pedido sem imagens', async () => {
    const res = await chamar('POST', '/api/insights/banco', { body: { image_ids: [] } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Indique as imagens/);
  });

  it('lista o banco com o artigo de origem e os usos', async () => {
    const a = semearArtigo({ titulo: 'Artigo da capa' });
    const img = semearImagem(a.id);
    env.DB.exec(`UPDATE insight_articles SET imagem_escolhida = ${img.id} WHERE id = ${a.id}`);
    noBanco(img.id);
    const b = await json(await chamar('GET', '/api/insights/banco'));
    expect(b.images[0]).toMatchObject({ image_id: img.id, provider: 'gemini', artigo_titulo: 'Artigo da capa' });
    expect(b.images[0].usos).toEqual([{ article_id: a.id, titulo: 'Artigo da capa' }]);
  });

  it('conta como uso a imagem que aparece no corpo de um artigo', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id);
    noBanco(img.id);
    env.DB.exec(`UPDATE insight_articles SET markdown = '![x](/api/insights/images/${img.id})' WHERE id = ${a.id}`);
    const b = await json(await chamar('GET', '/api/insights/banco'));
    expect(b.images[0].usos).toHaveLength(1);
  });

  it('remove do banco e apaga os bytes quando a imagem não está em uso', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: -1 });
    noBanco(img.id);
    const b = await json(await chamar('DELETE', `/api/insights/banco/${img.id}`));
    expect(b).toEqual({ ok: true, apagada: true });
    expect(env.RECIBOS.store.has(img.r2_key)).toBe(false);
    expect(env.DB.conta('insight_images')).toBe(0);
  });

  it('não apaga os bytes de uma imagem que é capa', async () => {
    const a = artigoPronto();
    noBanco(a.img.id);
    const b = await json(await chamar('DELETE', `/api/insights/banco/${a.img.id}`));
    expect(b).toEqual({ ok: true, apagada: false, motivo: 'capa' });
    expect(env.RECIBOS.store.has(a.img.r2_key)).toBe(true);
  });

  it('não apaga os bytes de uma imagem usada no corpo de um artigo', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: -1 });
    env.DB.exec(`UPDATE insight_articles SET markdown = 'texto ![x](/api/insights/images/${img.id}) fim' WHERE id = ${a.id}`);
    noBanco(img.id);
    expect((await json(await chamar('DELETE', `/api/insights/banco/${img.id}`))).motivo).toBe('corpo');
  });

  it('não apaga uma imagem que ainda está nas opções da ronda atual', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: 1 });
    noBanco(img.id);
    expect((await json(await chamar('DELETE', `/api/insights/banco/${img.id}`))).motivo).toBe('opcoes');
  });

  it('não se engana com markdown cheio de % e _ (curingas do LIKE)', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: -1 });
    const outro = semearArtigo({ markdown: `100% e _ e "aspas" e /api/insights/images/%)` });
    noBanco(img.id);
    expect((await json(await chamar('DELETE', `/api/insights/banco/${img.id}`))).apagada).toBe(true);
  });

  it('remover uma imagem que já não existe devolve o motivo «inexistente»', async () => {
    const b = await json(await chamar('DELETE', '/api/insights/banco/9999'));
    expect(b).toEqual({ ok: true, apagada: false, motivo: 'inexistente' });
  });
});

describe('POST /api/insights/articles/:id/imagens-do-banco', () => {
  it('copia a imagem do banco para o artigo, com chave R2 própria', async () => {
    const origem = semearArtigo({ titulo: 'Origem' });
    const img = semearImagem(origem.id, { content_type: 'image/jpeg' });
    noBanco(img.id);
    const destino = semearArtigo({ titulo: 'Destino' });
    const b = await json(await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.resultados).toEqual([{ image_id: img.id, estado: 'adicionada' }]);
    expect(b.ronda).toBe(1);
    const nova = env.DB.linha('SELECT * FROM insight_images WHERE article_id = ?', destino.id);
    expect(nova.r2_key).toBe(`insights/art-${destino.id}/r1-banco${img.id}.jpg`);
    expect(nova.prompt).toBe(`banco#${img.id}`);
    expect(env.RECIBOS.store.has(nova.r2_key)).toBe(true);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('POST', '/api/insights/articles/909/imagens-do-banco', { body: { image_ids: [1] } })).status).toBe(404);
  });

  it('recusa um pedido sem imagens', async () => {
    const a = semearArtigo();
    const res = await chamar('POST', `/api/insights/articles/${a.id}/imagens-do-banco`, { body: {} });
    expect(res.status).toBe(400);
  });

  it('assinala como inexistente uma imagem que não está no banco', async () => {
    const origem = semearArtigo();
    const img = semearImagem(origem.id);
    const destino = semearArtigo();
    const b = await json(await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.resultados[0].estado).toBe('inexistente');
  });

  it('não copia uma imagem que já está nas opções do próprio artigo', async () => {
    const a = semearArtigo();
    const img = semearImagem(a.id, { ronda: 1 });
    noBanco(img.id);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.resultados[0].estado).toBe('ja_no_artigo');
  });

  it('não copia duas vezes a mesma imagem para a mesma ronda', async () => {
    const origem = semearArtigo();
    const img = semearImagem(origem.id);
    noBanco(img.id);
    const destino = semearArtigo();
    await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, { body: { image_ids: [img.id] } });
    const b = await json(await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.resultados[0].estado).toBe('ja_no_artigo');
    expect(env.DB.conta('insight_images', `article_id = ${destino.id}`)).toBe(1);
  });

  it('assinala como inexistente quando os bytes desapareceram do R2', async () => {
    const origem = semearArtigo();
    const img = semearImagem(origem.id);
    noBanco(img.id);
    env.RECIBOS.store.delete(img.r2_key);
    const destino = semearArtigo();
    const b = await json(await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.resultados[0].estado).toBe('inexistente');
  });

  it('junta-se à ronda atual do artigo de destino', async () => {
    const origem = semearArtigo();
    const img = semearImagem(origem.id);
    noBanco(img.id);
    const destino = semearArtigo();
    semearImagem(destino.id, { ronda: 3 });
    const b = await json(await chamar('POST', `/api/insights/articles/${destino.id}/imagens-do-banco`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.ronda).toBe(3);
    expect(b.images).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════ fotos no corpo

describe('POST /api/insights/articles/:id/inserir-imagens', () => {
  const MD = 'Abertura do artigo.\n\nSegundo bloco.\n\nTerceiro bloco.\n\nQuarto bloco.\n\nQuinto bloco.';

  it('insere a foto depois do bloco escolhido pela IA', async () => {
    const a = semearArtigo({ markdown: MD, revisto_em: '2026-08-01 10:00:00' });
    const img = semearImagem(a.id);
    usarIA([geminiJson({ colocacoes: [{ image_id: img.id, apos_bloco: 2, alt: 'Advogada a explicar o processo' }] })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, {
      body: { image_ids: [img.id] },
    }));
    expect(b.article.markdown).toContain(`![Advogada a explicar o processo](/api/insights/images/${img.id})`);
    expect(b.article.markdown.split('\n\n')[3]).toBe(`![Advogada a explicar o processo](/api/insights/images/${img.id})`);
  });

  it('limpa a revisão da Dra. porque o conteúdo mudou', async () => {
    const a = semearArtigo({ markdown: MD, revisto_em: '2026-08-01 10:00:00' });
    const img = semearImagem(a.id);
    usarIA([geminiJson({ colocacoes: [{ image_id: img.id, apos_bloco: 2, alt: 'x' }] })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [img.id] } }));
    expect(b.article.revisto_em).toBe(null);
  });

  it('recusa um pedido sem imagens', async () => {
    const a = semearArtigo();
    const res = await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [] } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/pelo menos uma imagem/);
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('POST', '/api/insights/articles/808/inserir-imagens', { body: { image_ids: [1] } })).status).toBe(404);
  });

  it('devolve 404 quando nenhuma das imagens pertence ao artigo', async () => {
    const a = semearArtigo({ markdown: MD });
    const outro = semearArtigo();
    const img = semearImagem(outro.id);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [img.id] } });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatch(/Imagens não encontradas/);
  });

  it('limpa aspas e parênteses retos do texto alternativo', async () => {
    const a = semearArtigo({ markdown: MD });
    const img = semearImagem(a.id);
    usarIA([geminiJson({ colocacoes: [{ image_id: img.id, apos_bloco: 1, alt: 'foto "com" aspas] e reto' }] })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [img.id] } }));
    expect(b.article.markdown).toContain('![foto com aspas e reto]');
  });

  it('nunca põe duas fotos depois do mesmo bloco', async () => {
    const a = semearArtigo({ markdown: MD });
    const i1 = semearImagem(a.id); const i2 = semearImagem(a.id);
    usarIA([geminiJson({ colocacoes: [
      { image_id: i1.id, apos_bloco: 2, alt: 'a' }, { image_id: i2.id, apos_bloco: 2, alt: 'b' },
    ] })]);
    const b = await json(await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, {
      body: { image_ids: [i1.id, i2.id] },
    }));
    const blocos = b.article.markdown.split('\n\n');
    const posicoes = blocos.map((x, i) => (x.startsWith('![') ? i : -1)).filter((i) => i >= 0);
    expect(posicoes[1] - posicoes[0]).toBeGreaterThan(1);
  });

  it('devolve 502 quando a IA não devolve posições válidas', async () => {
    const a = semearArtigo({ markdown: MD });
    const img = semearImagem(a.id);
    usarIA([geminiJson({ colocacoes: [{ image_id: 999999, apos_bloco: 2, alt: 'x' }] })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [img.id] } });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/posições válidas/);
  });

  it('devolve 502 quando os dois motores de IA falham', async () => {
    const a = semearArtigo({ markdown: MD });
    const img = semearImagem(a.id);
    usarIA({ status: 500, texto: 'boom' });
    expect((await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, { body: { image_ids: [img.id] } })).status).toBe(502);
  });

  // CORRIGIDO (era): o filtro final valida a colocação contra os ids PEDIDOS (`ids`) e não
  // contra as imagens que pertencem mesmo ao artigo (`imgs`) — basta uma imagem
  // válida no pedido para uma imagem de outro artigo entrar no corpo deste.
  // worker/routes/insights.js:758-764.
  it('não insere no corpo uma imagem que é de outro artigo', async () => {
    const a = semearArtigo({ markdown: MD });
    const minha = semearImagem(a.id);
    const alheia = semearImagem(semearArtigo().id);
    usarIA([geminiJson({ colocacoes: [{ image_id: alheia.id, apos_bloco: 2, alt: 'intrusa' }] })]);
    const res = await chamar('POST', `/api/insights/articles/${a.id}/inserir-imagens`, {
      body: { image_ids: [minha.id, alheia.id] },
    });
    // Sobrando zero colocações válidas, a rota recusa em vez de inserir a intrusa.
    expect(res.status).toBe(502);
    const md = env.DB.linha('SELECT markdown FROM insight_articles WHERE id = ?', a.id).markdown;
    expect(md).not.toContain(`/api/insights/images/${alheia.id}`);
  });
});

// ═══════════════════════════════════════════════════════ regras de imagem

describe('correções de imagem (KV)', () => {
  it('começa sem regras nenhumas', async () => {
    expect(await json(await chamar('GET', '/api/insights/image-rules'))).toEqual({ rules: [] });
  });

  it('acrescenta uma regra e devolve a lista', async () => {
    const b = await json(await chamar('POST', '/api/insights/image-rules', { body: { texto: 'Mãos com seis dedos' } }));
    expect(b.ok).toBe(true);
    expect(b.rule.texto).toBe('Mãos com seis dedos');
    expect(b.rule.criado_em).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(b.rules).toHaveLength(1);
  });

  it('põe a regra nova em primeiro lugar', async () => {
    await chamar('POST', '/api/insights/image-rules', { body: { texto: 'Primeira' } });
    const b = await json(await chamar('POST', '/api/insights/image-rules', { body: { texto: 'Segunda' } }));
    expect(b.rules.map((r) => r.texto)).toEqual(['Segunda', 'Primeira']);
  });

  it('recusa uma regra vazia ou só com espaços', async () => {
    expect((await chamar('POST', '/api/insights/image-rules', { body: { texto: '' } })).status).toBe(400);
    expect((await chamar('POST', '/api/insights/image-rules', { body: { texto: '   ' } })).status).toBe(400);
  });

  it('trunca a regra a 240 caracteres', async () => {
    const b = await json(await chamar('POST', '/api/insights/image-rules', { body: { texto: 'R'.repeat(400) } }));
    expect(b.rule.texto).toHaveLength(240);
  });

  it('recusa passar das 40 correções', async () => {
    const cheias = Array.from({ length: 40 }, (_, i) => ({ id: i, texto: `regra ${i}` }));
    await env.SESSIONS.put('insights:img-correcoes', JSON.stringify(cheias));
    const res = await chamar('POST', '/api/insights/image-rules', { body: { texto: 'mais uma' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Limite de 40/);
  });

  it('apaga uma regra pelo id', async () => {
    const criada = (await json(await chamar('POST', '/api/insights/image-rules', { body: { texto: 'Apagar-me' } }))).rule;
    const b = await json(await chamar('DELETE', `/api/insights/image-rules/${criada.id}`));
    expect(b.rules).toEqual([]);
  });

  it('apagar um id inexistente não mexe na lista', async () => {
    await chamar('POST', '/api/insights/image-rules', { body: { texto: 'Fico cá' } });
    const b = await json(await chamar('DELETE', '/api/insights/image-rules/123'));
    expect(b.rules).toHaveLength(1);
  });

  it('ignora um KV corrompido em vez de rebentar', async () => {
    await env.SESSIONS.put('insights:img-correcoes', '{isto não é json');
    expect(await json(await chamar('GET', '/api/insights/image-rules'))).toEqual({ rules: [] });
  });

  it('ignora um KV que não contenha uma lista', async () => {
    await env.SESSIONS.put('insights:img-correcoes', '{"a":1}');
    expect(await json(await chamar('GET', '/api/insights/image-rules'))).toEqual({ rules: [] });
  });
});

// ═══════════════════════════════════════════════════════ fontes

describe('fontes acompanhadas', () => {
  const META = { nome: '@teste (Canal)', tipo: 'blogue', fiabilidade: 4, engajamento: 5, resumo: 'Fala de vistos.' };

  it('lista as fontes semeadas pelas migrações', async () => {
    const b = await json(await chamar('GET', '/api/insights/sources'));
    expect(b.sources.length).toBeGreaterThan(10);
    expect(b.sources[0].fiabilidade).toBe(5);
  });

  it('acrescenta uma fonte com os dados preenchidos pela IA', async () => {
    usarIA([geminiJson(META)]);
    const b = await json(await chamar('POST', '/api/insights/sources', { body: { url: 'https://exemplo.pt/blog' } }));
    expect(b.preenchido_por_ia).toBe(true);
    expect(b.source).toMatchObject({ nome: '@teste (Canal)', tipo: 'blogue', fiabilidade: 4, engajamento: 5, origem: 'manual' });
  });

  it('recusa um link inválido', async () => {
    const res = await chamar('POST', '/api/insights/sources', { body: { url: 'exemplo.pt' } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/link válido/);
  });

  it('recusa um pedido sem link', async () => {
    expect((await chamar('POST', '/api/insights/sources', { body: {} })).status).toBe(400);
  });

  it('recusa uma fonte repetida com 409', async () => {
    const res = await chamar('POST', '/api/insights/sources', { body: { url: 'https://aima.gov.pt' } });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/já está na lista/);
  });

  it('usa o domínio como nome quando a IA falha', async () => {
    usarIA([{ status: 500, texto: 'boom' }]);
    const b = await json(await chamar('POST', '/api/insights/sources', { body: { url: 'https://www.exemplo.pt/seccao' } }));
    expect(b.preenchido_por_ia).toBe(false);
    expect(b.source.nome).toBe('exemplo.pt');
    expect(b.source.fiabilidade).toBe(3);
  });

  it('deduz o tipo «instagram» pelo URL quando a IA devolve um tipo inválido', async () => {
    usarIA([geminiJson({ ...META, tipo: 'podcast' })]);
    const b = await json(await chamar('POST', '/api/insights/sources', { body: { url: 'https://www.instagram.com/alguem/' } }));
    expect(b.source.tipo).toBe('instagram');
  });

  it('limita fiabilidade e engajamento ao intervalo 1-5', async () => {
    usarIA([geminiJson({ ...META, fiabilidade: 99, engajamento: -3 })]);
    const b = await json(await chamar('POST', '/api/insights/sources', { body: { url: 'https://exemplo.pt/x' } }));
    expect(b.source.fiabilidade).toBe(5);
    expect(b.source.engajamento).toBe(1);
  });

  it('atualiza uma fonte', async () => {
    const id = env.DB.linha(`SELECT id FROM insight_sources ORDER BY id LIMIT 1`).id;
    const b = await json(await chamar('PATCH', `/api/insights/sources/${id}`, {
      body: { nome: 'Novo nome', fiabilidade: 9 },
    }));
    expect(b.source.nome).toBe('Novo nome');
    expect(b.source.fiabilidade).toBe(5);
    expect(b.source.atualizado_em).toBeTruthy();
  });

  it('recusa uma atualização sem campos conhecidos', async () => {
    const id = env.DB.linha(`SELECT id FROM insight_sources ORDER BY id LIMIT 1`).id;
    const res = await chamar('PATCH', `/api/insights/sources/${id}`, { body: { desconhecido: 1 } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Nada para atualizar');
  });

  it('devolve 404 ao atualizar uma fonte inexistente', async () => {
    expect((await chamar('PATCH', '/api/insights/sources/9999', { body: { nome: 'x' } })).status).toBe(404);
  });

  it('ignora valores não numéricos na fiabilidade', async () => {
    const id = env.DB.linha(`SELECT id, fiabilidade FROM insight_sources ORDER BY id LIMIT 1`).id;
    const res = await chamar('PATCH', `/api/insights/sources/${id}`, { body: { fiabilidade: 'muita' } });
    expect(res.status).toBe(400);
  });

  it('apaga uma fonte', async () => {
    const id = env.DB.linha(`SELECT id FROM insight_sources ORDER BY id LIMIT 1`).id;
    expect(await json(await chamar('DELETE', `/api/insights/sources/${id}`))).toEqual({ ok: true });
    expect(env.DB.linha('SELECT id FROM insight_sources WHERE id = ?', id)).toBe(null);
  });

  it('apagar uma fonte inexistente responde ok (documenta o comportamento)', async () => {
    expect(await json(await chamar('DELETE', '/api/insights/sources/9999'))).toEqual({ ok: true });
  });
});

describe('GET /api/insights/palavras', () => {
  it('devolve o banco de palavras vazio', async () => {
    expect(await json(await chamar('GET', '/api/insights/palavras'))).toEqual({ keywords: [] });
  });

  it('devolve os termos ordenados por score', async () => {
    env.DB.exec(`INSERT INTO keyword_bank (termo, tipo, score) VALUES ('visto cplp','conjunto',40),('nacionalidade','palavra',95)`);
    const b = await json(await chamar('GET', '/api/insights/palavras'));
    expect(b.keywords.map((k) => k.termo)).toEqual(['nacionalidade', 'visto cplp']);
  });
});

// ═══════════════════════════════════════════════════════ pré-visualização

describe('GET /api/insights/articles/:id/previa-link', () => {
  it('devolve um link com o id e o token do artigo', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('GET', `/api/insights/articles/${a.id}/previa-link`));
    const t = await tokenPrevia(env, a.id);
    expect(b.url).toBe(`https://exemplo.pt/pre-visual-artigo?id=${a.id}&t=${t}`);
  });

  it('o token tem 24 caracteres hexadecimais', async () => {
    const a = semearArtigo();
    const b = await json(await chamar('GET', `/api/insights/articles/${a.id}/previa-link`));
    expect(new URL(b.url).searchParams.get('t')).toMatch(/^[0-9a-f]{24}$/);
  });

  it('artigos diferentes têm tokens diferentes', async () => {
    const a1 = semearArtigo(); const a2 = semearArtigo();
    const u1 = (await json(await chamar('GET', `/api/insights/articles/${a1.id}/previa-link`))).url;
    const u2 = (await json(await chamar('GET', `/api/insights/articles/${a2.id}/previa-link`))).url;
    expect(new URL(u1).searchParams.get('t')).not.toBe(new URL(u2).searchParams.get('t'));
  });

  it('devolve 404 para artigo inexistente', async () => {
    expect((await chamar('GET', '/api/insights/articles/4321/previa-link')).status).toBe(404);
  });
});

describe('pré-visualização pública partilhável', () => {
  const abrir = (id, t) => handlePreviaArtigo(req('GET', `/pre-visual-artigo?id=${id}&t=${t}`), env);

  it('abre o rascunho com o token certo, sem sessão', async () => {
    const a = semearArtigo({ titulo: 'Rascunho para a Dra.', markdown: '## Secção\n\nCorpo.' });
    const res = await abrir(a.id, await tokenPrevia(env, a.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain('Rascunho para a Dra.');
    expect(html).toContain('<h2>Secção</h2>');
  });

  it('nunca é indexada pelos motores de busca', async () => {
    const a = semearArtigo();
    const res = await abrir(a.id, await tokenPrevia(env, a.id));
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('recusa um token errado', async () => {
    const a = semearArtigo();
    const res = await abrir(a.id, 'token-invalido');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('recusa um pedido sem token', async () => {
    const a = semearArtigo();
    expect((await handlePreviaArtigo(req('GET', `/pre-visual-artigo?id=${a.id}`), env)).status).toBe(404);
  });

  it('recusa o token de outro artigo', async () => {
    const a1 = semearArtigo(); const a2 = semearArtigo();
    expect((await abrir(a1.id, await tokenPrevia(env, a2.id))).status).toBe(404);
  });

  it('devolve 404 quando o artigo já não existe, mesmo com token válido', async () => {
    const res = await abrir(4242, await tokenPrevia(env, 4242));
    expect(res.status).toBe(404);
  });

  it('recusa um id que não é número', async () => {
    expect((await handlePreviaArtigo(req('GET', '/pre-visual-artigo?id=abc&t=x'), env)).status).toBe(404);
  });

  it('abre também um artigo já publicado', async () => {
    const a = semearArtigo({ publicado_em: '2026-08-01 09:00:00', publicar_em: '2026-08-01 08:00:00' });
    expect((await abrir(a.id, await tokenPrevia(env, a.id))).status).toBe(200);
  });

  it('escapa HTML do título e da descrição', async () => {
    const a = semearArtigo({ titulo: '<script>alert(1)</script>', descricao: 'a & b <b>c</b>' });
    const html = await (await abrir(a.id, await tokenPrevia(env, a.id))).text();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('a &amp; b &lt;b&gt;c&lt;/b&gt;');
  });

  it('mostra a capa quando há imagem escolhida', async () => {
    const a = artigoPronto();
    const html = await (await abrir(a.id, await tokenPrevia(env, a.id))).text();
    expect(html).toContain(`<img class="capa" src="/api/insights/images/${a.imagem_escolhida}"`);
  });

  it('limpa as tags de citação antes de renderizar', async () => {
    const a = semearArtigo({ markdown: 'Texto <cite index="1">citado</cite> aqui.' });
    const html = await (await abrir(a.id, await tokenPrevia(env, a.id))).text();
    expect(html).not.toContain('<cite');
    expect(html).toContain('Texto citado aqui.');
  });

  it('marca a língua da página conforme o idioma do artigo', async () => {
    const a = semearArtigo({ idioma: 'pt-BR' });
    expect(await (await abrir(a.id, await tokenPrevia(env, a.id))).text()).toContain('<html lang="pt-BR">');
  });
});
