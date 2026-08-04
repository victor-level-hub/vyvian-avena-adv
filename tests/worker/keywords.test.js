// tests/worker/keywords.test.js — worker/lib/keywords.js (Banco de Palavras, SEO)

import { describe, it, expect } from 'vitest';
import {
  normalizarTermo, upsertKeywords, resumoBanco, blocoBancoParaPrompt, updateKeywordMetrics,
} from '../../worker/lib/keywords.js';
import { criarEnv } from '../helpers/env.js';

const semear = (db, termos) => {
  for (const t of termos) {
    db.exec(`INSERT INTO keyword_bank (termo, tipo, score, usos, visitas, ig_curtidas, ig_comentarios)
             VALUES ('${t.termo}', '${t.tipo || 'conjunto'}', ${t.score ?? 50}, ${t.usos ?? 0},
                     ${t.visitas ?? 0}, ${t.curtidas ?? 0}, ${t.comentarios ?? 0})`);
  }
};

// ════════════════════════════════════════════════════════════════════════════
describe('normalizarTermo', () => {
  it('remove os acentos', () => {
    expect(normalizarTermo('herança indivisível')).toBe('heranca indivisivel');
  });

  it('converte a cedilha em c', () => {
    expect(normalizarTermo('Ação')).toBe('acao');
  });

  it('passa tudo a minúsculas', () => {
    expect(normalizarTermo('DIREITO DE FAMÍLIA')).toBe('direito de familia');
  });

  it('remove a pontuação', () => {
    expect(normalizarTermo('divórcio, partilha; bens!')).toBe('divorcio partilha bens');
  });

  it('colapsa espaços múltiplos', () => {
    expect(normalizarTermo('guarda    partilhada')).toBe('guarda partilhada');
  });

  it('remove os espaços à volta', () => {
    expect(normalizarTermo('   pensão de alimentos   ')).toBe('pensao de alimentos');
  });

  it('trata quebras de linha e tabulações como espaço', () => {
    expect(normalizarTermo('guarda\n\tpartilhada')).toBe('guarda partilhada');
  });

  it('string vazia devolve string vazia', () => {
    expect(normalizarTermo('')).toBe('');
  });

  it('null devolve string vazia', () => {
    expect(normalizarTermo(null)).toBe('');
  });

  it('undefined devolve string vazia', () => {
    expect(normalizarTermo(undefined)).toBe('');
  });

  it('preserva os números', () => {
    expect(normalizarTermo('Lei 2026 de Nacionalidade')).toBe('lei 2026 de nacionalidade');
  });

  it('preserva o hífen', () => {
    expect(normalizarTermo('e-mail jurídico')).toBe('e-mail juridico');
  });

  it('remove emojis', () => {
    expect(normalizarTermo('cidadania 🇵🇹 portuguesa')).toBe('cidadania portuguesa');
  });

  it('texto só de pontuação devolve string vazia', () => {
    expect(normalizarTermo('!!! ??? ...')).toBe('');
  });

  it('um termo já normalizado fica inalterado (idempotência)', () => {
    const t = 'guarda partilhada 2026';
    expect(normalizarTermo(normalizarTermo(t))).toBe(t);
  });

  it('aceita números como entrada', () => {
    expect(normalizarTermo(123)).toBe('123');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('upsertKeywords', () => {
  it('lista vazia não grava nada', async () => {
    const env = criarEnv();
    expect(await upsertKeywords(env, [])).toBe(0);
    expect(env.DB.conta('keyword_bank')).toBe(0);
  });

  it('lista null não grava nada', async () => {
    const env = criarEnv();
    expect(await upsertKeywords(env, null)).toBe(0);
  });

  it('lista undefined não grava nada', async () => {
    const env = criarEnv();
    expect(await upsertKeywords(env, undefined)).toBe(0);
  });

  it('argumento que não é array não grava nada', async () => {
    const env = criarEnv();
    expect(await upsertKeywords(env, { termo: 'divorcio' })).toBe(0);
  });

  it('grava um termo válido com o score indicado', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'Guarda Partilhada', score: 80 }]);
    expect(env.DB.linha('SELECT termo, tipo, score FROM keyword_bank'))
      .toEqual({ termo: 'guarda partilhada', tipo: 'conjunto', score: 80 });
  });

  it('devolve o número de termos aceites', async () => {
    const env = criarEnv();
    const n = await upsertKeywords(env, [{ termo: 'divorcio' }, { termo: 'ab' }, { termo: 'heranca' }]);
    expect(n).toBe(2);
  });

  it('termo com menos de 3 caracteres é descartado', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'ab' }, { termo: 'a' }, { termo: '' }]);
    expect(env.DB.conta('keyword_bank')).toBe(0);
  });

  it('termo com exatamente 3 caracteres é aceite', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'irn' }]);
    expect(env.DB.conta('keyword_bank')).toBe(1);
  });

  it('termo com mais de 80 caracteres é descartado', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'a'.repeat(81) }]);
    expect(env.DB.conta('keyword_bank')).toBe(0);
  });

  it('termo com exatamente 80 caracteres é aceite', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'a'.repeat(80) }]);
    expect(env.DB.conta('keyword_bank')).toBe(1);
  });

  it('o comprimento é avaliado depois de normalizar', async () => {
    const env = criarEnv();
    // 82 caracteres com pontuação, 80 depois de normalizados
    await upsertKeywords(env, [{ termo: '!' + 'a'.repeat(78) + '!'.repeat(3) }]);
    expect(env.DB.linha('SELECT termo FROM keyword_bank').termo.length).toBe(78);
  });

  it('termo sem espaços é do tipo palavra', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'divórcio' }]);
    expect(env.DB.linha('SELECT tipo FROM keyword_bank').tipo).toBe('palavra');
  });

  it('termo com espaço é do tipo conjunto', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'divórcio litigioso' }]);
    expect(env.DB.linha('SELECT tipo FROM keyword_bank').tipo).toBe('conjunto');
  });

  it('termo com hífen mas sem espaço continua a ser palavra', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'e-mail' }]);
    expect(env.DB.linha('SELECT tipo FROM keyword_bank').tipo).toBe('palavra');
  });

  it('score acima de 100 é limitado a 100', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: 999 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(100);
  });

  it('score negativo é limitado a 0', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: -20 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(0);
  });

  it('score decimal é arredondado', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: 72.6 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(73);
  });

  it('score em texto numérico é aceite', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: '85' }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(85);
  });

  it('score não numérico vira 50', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: 'muito alto' }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(50);
  });

  it('score em falta vira 50', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade' }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(50);
  });

  it('score nulo vira 50', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'nacionalidade', score: null }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(50);
  });

  // CORRIGIDO (era): o `|| 50` tratava o zero como ausência de valor e promovia um
  // termo sem potencial nenhum a meio da tabela.
  it('score 0 fica mesmo 0', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'termo sem potencial', score: 0 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(0);
  });

  // CORRIGIDO (era): worker/lib/keywords.js:29 — `Math.round(+(k.score) || 50)` trata o zero como
  // ausência de valor, por isso um score 0 (nenhum potencial) é promovido a 50.
  // O 0 está dentro do intervalo 0..100 e devia sobreviver ao clamp.
  it('score 0 ficar 0 (o falsy-coalescing engole o zero)', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'termo sem potencial', score: 0 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(0);
  });

  it('entrada sem campo termo é descartada', async () => {
    const env = criarEnv();
    expect(await upsertKeywords(env, [{ score: 90 }, null, undefined, 5])).toBe(0);
  });

  it('conflito mantém o score maior (não o mais recente)', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'heranca', score: 90 }]);
    await upsertKeywords(env, [{ termo: 'heranca', score: 20 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(90);
  });

  it('conflito sobe o score quando o novo é maior', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'heranca', score: 20 }]);
    await upsertKeywords(env, [{ termo: 'heranca', score: 90 }]);
    expect(env.DB.linha('SELECT score FROM keyword_bank').score).toBe(90);
  });

  it('conflito não duplica a linha', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'heranca', score: 20 }]);
    await upsertKeywords(env, [{ termo: 'Herança', score: 30 }]);
    expect(env.DB.conta('keyword_bank')).toBe(1);
  });

  it('termos duplicados na mesma lista dão uma só linha com o score maior', async () => {
    const env = criarEnv();
    const n = await upsertKeywords(env, [
      { termo: 'guarda partilhada', score: 40 },
      { termo: 'Guarda  Partilhada!', score: 88 },
    ]);
    expect({ n, linhas: env.DB.conta('keyword_bank'), score: env.DB.linha('SELECT score FROM keyword_bank').score })
      .toEqual({ n: 2, linhas: 1, score: 88 });
  });

  it('o conflito não repõe os contadores já calculados pelo cron', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca', score: 50, usos: 3, visitas: 120 }]);
    await upsertKeywords(env, [{ termo: 'herança', score: 70 }]);
    expect(env.DB.linha('SELECT usos, visitas, score FROM keyword_bank'))
      .toEqual({ usos: 3, visitas: 120, score: 70 });
  });

  it('grava vários termos de uma vez', async () => {
    const env = criarEnv();
    await upsertKeywords(env, [{ termo: 'divorcio' }, { termo: 'heranca' }, { termo: 'guarda partilhada' }]);
    expect(env.DB.conta('keyword_bank')).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('resumoBanco', () => {
  it('tabela vazia devolve listas vazias', async () => {
    const env = criarEnv();
    expect(await resumoBanco(env)).toEqual({ fortes: [], porUsar: [] });
  });

  it('fortes só inclui termos já usados', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'usado', usos: 2 }, { termo: 'por usar', usos: 0 }]);
    const { fortes } = await resumoBanco(env);
    expect(fortes.map((t) => t.termo)).toEqual(['usado']);
  });

  it('porUsar só inclui termos com usos a zero', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'usado', usos: 2 }, { termo: 'por usar', usos: 0 }]);
    const { porUsar } = await resumoBanco(env);
    expect(porUsar.map((t) => t.termo)).toEqual(['por usar']);
  });

  it('fortes vêm ordenados pelo desempenho real', async () => {
    const env = criarEnv();
    semear(env.DB, [
      { termo: 'fraco', usos: 1, visitas: 1, curtidas: 0, comentarios: 0 },
      { termo: 'medio', usos: 1, visitas: 10, curtidas: 5, comentarios: 0 },
      { termo: 'forte', usos: 1, visitas: 50, curtidas: 20, comentarios: 5 },
    ]);
    const { fortes } = await resumoBanco(env);
    expect(fortes.map((t) => t.termo)).toEqual(['forte', 'medio', 'fraco']);
  });

  it('empate de desempenho desempata pelo score', async () => {
    const env = criarEnv();
    semear(env.DB, [
      { termo: 'baixo score', usos: 1, visitas: 10, score: 30 },
      { termo: 'alto score', usos: 1, visitas: 10, score: 90 },
    ]);
    const { fortes } = await resumoBanco(env);
    expect(fortes.map((t) => t.termo)).toEqual(['alto score', 'baixo score']);
  });

  it('porUsar vem ordenado pelo score potencial', async () => {
    const env = criarEnv();
    semear(env.DB, [
      { termo: 'medio', score: 55 }, { termo: 'topo', score: 95 }, { termo: 'baixo', score: 10 },
    ]);
    const { porUsar } = await resumoBanco(env);
    expect(porUsar.map((t) => t.termo)).toEqual(['topo', 'medio', 'baixo']);
  });

  it('respeita o limite n', async () => {
    const env = criarEnv();
    semear(env.DB, Array.from({ length: 15 }, (_, i) => ({ termo: 'termo ' + i, score: i })));
    const { porUsar } = await resumoBanco(env, 3);
    expect(porUsar).toHaveLength(3);
  });

  it('o limite por omissão é 10', async () => {
    const env = criarEnv();
    semear(env.DB, Array.from({ length: 15 }, (_, i) => ({ termo: 'termo ' + i, score: i })));
    const { porUsar } = await resumoBanco(env);
    expect(porUsar).toHaveLength(10);
  });

  it('o campo ig soma curtidas e comentários', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca', usos: 1, curtidas: 30, comentarios: 12 }]);
    const { fortes } = await resumoBanco(env);
    expect(fortes[0].ig).toBe(42);
  });

  it('base de dados que rebenta devolve listas vazias em vez de propagar', async () => {
    const env = { DB: { prepare() { throw new Error('D1 fora de serviço'); } } };
    await expect(resumoBanco(env)).resolves.toEqual({ fortes: [], porUsar: [] });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('blocoBancoParaPrompt', () => {
  it('devolve vazio quando não há dados nenhuns', () => {
    expect(blocoBancoParaPrompt({ fortes: [], porUsar: [] })).toBe('');
  });

  it('inclui só a secção de termos fortes quando não há termos por usar', () => {
    const txt = blocoBancoParaPrompt({ fortes: [{ termo: 'guarda partilhada' }], porUsar: [] });
    expect({ fortes: txt.includes('melhor desempenho'), porUsar: txt.includes('AINDA NÃO cobertos') })
      .toEqual({ fortes: true, porUsar: false });
  });

  it('inclui só a secção de termos por usar quando não há fortes', () => {
    const txt = blocoBancoParaPrompt({ fortes: [], porUsar: [{ termo: 'usucapiao', score: 70 }] });
    expect({ fortes: txt.includes('melhor desempenho'), porUsar: txt.includes('AINDA NÃO cobertos') })
      .toEqual({ fortes: false, porUsar: true });
  });

  it('inclui as duas secções quando há dados dos dois lados', () => {
    const txt = blocoBancoParaPrompt({
      fortes: [{ termo: 'heranca' }], porUsar: [{ termo: 'usucapiao', score: 70 }],
    });
    expect(txt.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
  });

  it('envolve cada termo em aspas angulares', () => {
    const txt = blocoBancoParaPrompt({ fortes: [{ termo: 'guarda partilhada' }], porUsar: [] });
    expect(txt).toContain('«guarda partilhada»');
  });

  it('mostra o score dos termos por cobrir', () => {
    const txt = blocoBancoParaPrompt({ fortes: [], porUsar: [{ termo: 'usucapiao', score: 70 }] });
    expect(txt).toContain('«usucapiao» (70)');
  });

  it('separa vários termos por vírgula', () => {
    const txt = blocoBancoParaPrompt({ fortes: [{ termo: 'a b' }, { termo: 'c d' }], porUsar: [] });
    expect(txt).toContain('«a b», «c d»');
  });

  it('abre com o cabeçalho do banco de palavras-chave', () => {
    const txt = blocoBancoParaPrompt({ fortes: [{ termo: 'heranca' }], porUsar: [] });
    expect(txt.startsWith('\nBANCO DE PALAVRAS-CHAVE')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('updateKeywordMetrics', () => {
  const artigo = (db, titulo, markdown) =>
    db.exec(`INSERT INTO insight_articles (titulo, markdown) VALUES ('${titulo}', '${markdown}')`);
  const post = (db, caption, likes, comentarios) =>
    db.exec(`INSERT INTO ig_posts (id, caption, like_count, comments_count)
             VALUES ('${Math.random().toString(36).slice(2)}', '${caption}', ${likes}, ${comentarios})`);
  const pagina = (db, day, path, views) =>
    db.exec(`INSERT INTO site_page_views (day, path, views) VALUES ('${day}', '${path}', ${views})`);

  it('banco vazio devolve { termos: 0 }', async () => {
    const env = criarEnv();
    expect(await updateKeywordMetrics(env)).toEqual({ termos: 0 });
  });

  it('devolve o número de termos processados', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca' }, { termo: 'divorcio' }]);
    expect(await updateKeywordMetrics(env)).toEqual({ termos: 2 });
  });

  it('conta os artigos que usam o termo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'guarda partilhada' }]);
    artigo(env.DB, 'Guarda Partilhada em 2026', 'Texto sobre o tema.');
    artigo(env.DB, 'Outro assunto', 'A guarda partilhada também aqui.');
    artigo(env.DB, 'Nada a ver', 'Usucapião.');
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos FROM keyword_bank').usos).toBe(2);
  });

  it('procura o termo também no título do artigo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'usucapiao' }]);
    artigo(env.DB, 'Usucapião passo a passo', 'Sem o termo no corpo.');
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos FROM keyword_bank').usos).toBe(1);
  });

  it('soma curtidas e comentários dos posts de Instagram que contêm o termo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'guarda partilhada' }]);
    post(env.DB, 'Tudo sobre guarda partilhada!', 100, 10);
    post(env.DB, 'Guarda Partilhada: mitos', 50, 5);
    post(env.DB, 'Assunto diferente', 999, 99);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT ig_curtidas, ig_comentarios FROM keyword_bank'))
      .toEqual({ ig_curtidas: 150, ig_comentarios: 15 });
  });

  it('post sem legenda não conta', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca' }]);
    env.DB.exec(`INSERT INTO ig_posts (id, like_count, comments_count) VALUES ('x1', 10, 2)`);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT ig_curtidas FROM keyword_bank').ig_curtidas).toBe(0);
  });

  it('soma as visitas das páginas /blog/* cujo caminho contém o termo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'guarda partilhada' }]);
    pagina(env.DB, '2026-08-01', '/blog/guarda-partilhada-em-2026', 40);
    pagina(env.DB, '2026-08-02', '/blog/guarda-partilhada-em-2026', 60);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT visitas FROM keyword_bank').visitas).toBe(100);
  });

  it('soma visitas de várias páginas diferentes', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca' }]);
    pagina(env.DB, '2026-08-01', '/blog/heranca-e-partilha', 10);
    pagina(env.DB, '2026-08-01', '/blog/heranca-indivisa', 7);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT visitas FROM keyword_bank').visitas).toBe(17);
  });

  it('ignora páginas fora de /blog/', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca' }]);
    pagina(env.DB, '2026-08-01', '/servicos/heranca', 500);
    pagina(env.DB, '2026-08-01', '/blog/heranca-e-partilha', 10);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT visitas FROM keyword_bank').visitas).toBe(10);
  });

  it('termo que não aparece em lado nenhum fica a zeros', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'termo fantasma', usos: 9, visitas: 9, curtidas: 9, comentarios: 9 }]);
    artigo(env.DB, 'Outro assunto', 'Nada relacionado.');
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos, visitas, ig_curtidas, ig_comentarios FROM keyword_bank'))
      .toEqual({ usos: 0, visitas: 0, ig_curtidas: 0, ig_comentarios: 0 });
  });

  it('recalcula todas as fontes ao mesmo tempo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'guarda partilhada' }]);
    artigo(env.DB, 'Guarda partilhada', 'x');
    post(env.DB, 'guarda partilhada explicada', 8, 3);
    pagina(env.DB, '2026-08-01', '/blog/guarda-partilhada', 25);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos, visitas, ig_curtidas, ig_comentarios FROM keyword_bank'))
      .toEqual({ usos: 1, visitas: 25, ig_curtidas: 8, ig_comentarios: 3 });
  });

  it('o termo casa mesmo com acentos e maiúsculas na fonte', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca indivisa' }]);
    artigo(env.DB, 'A HERANÇA INDIVISA', 'Texto.');
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos FROM keyword_bank').usos).toBe(1);
  });

  it('processa em lotes de 40 sem rebentar e atualiza todos os termos', async () => {
    const env = criarEnv();
    const termos = Array.from({ length: 45 }, (_, i) => ({ termo: 'tema ' + String(i).padStart(2, '0') }));
    semear(env.DB, termos);
    artigo(env.DB, 'Tudo', termos.map((t) => t.termo).join(' '));
    const r = await updateKeywordMetrics(env);
    expect({ r, atualizados: env.DB.conta('keyword_bank', 'usos = 1') })
      .toEqual({ r: { termos: 45 }, atualizados: 45 });
  });

  it('mais de 80 termos continuam todos a ser atualizados', async () => {
    const env = criarEnv();
    const termos = Array.from({ length: 83 }, (_, i) => ({ termo: 'tema ' + String(i).padStart(3, '0') }));
    semear(env.DB, termos);
    artigo(env.DB, 'Tudo', termos.map((t) => t.termo).join(' '));
    await updateKeywordMetrics(env);
    expect(env.DB.conta('keyword_bank', 'usos = 1')).toBe(83);
  });

  it('correr duas vezes seguidas dá o mesmo resultado (idempotente)', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca' }]);
    artigo(env.DB, 'Herança', 'x');
    post(env.DB, 'heranca', 5, 1);
    await updateKeywordMetrics(env);
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT usos, ig_curtidas FROM keyword_bank')).toEqual({ usos: 1, ig_curtidas: 5 });
  });

  it('não toca no score nem no tipo do termo', async () => {
    const env = criarEnv();
    semear(env.DB, [{ termo: 'heranca', tipo: 'palavra', score: 77 }]);
    artigo(env.DB, 'Herança', 'x');
    await updateKeywordMetrics(env);
    expect(env.DB.linha('SELECT tipo, score FROM keyword_bank')).toEqual({ tipo: 'palavra', score: 77 });
  });
});
