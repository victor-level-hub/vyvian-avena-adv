-- 0017: Insights (aba Redes Sociais) — sugestões de temas, artigos gerados,
-- imagens (R2) e fontes acompanhadas.

-- Cada clique em "Atualizar" cria um lote (batch) de 10 sugestões.
CREATE TABLE IF NOT EXISTS insight_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  estado TEXT NOT NULL DEFAULT 'ok',      -- ok | erro
  erro TEXT,
  duracao_ms INTEGER
);

CREATE TABLE IF NOT EXISTS insight_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES insight_batches(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  resumo TEXT NOT NULL,                   -- o assunto em 2-3 frases
  justificacao TEXT,                      -- porque tem potencial de engajamento
  area TEXT,                              -- slug da área de atuação relacionada
  score INTEGER,                          -- 0-100: potencial de engajamento
  fontes TEXT NOT NULL DEFAULT '[]',      -- JSON [{nome,url,tipo,titulo}]
  estado TEXT NOT NULL DEFAULT 'novo',    -- novo | artigo_gerado
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_insight_topics_batch ON insight_topics(batch_id);

CREATE TABLE IF NOT EXISTS insight_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES insight_topics(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  area TEXT,
  idioma TEXT NOT NULL DEFAULT 'pt-PT',   -- pt-PT | pt-BR
  markdown TEXT NOT NULL,
  imagem_escolhida INTEGER,               -- id em insight_images
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS insight_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES insight_articles(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  prompt TEXT,
  provider TEXT,                          -- gemini | recraft
  ronda INTEGER NOT NULL DEFAULT 1,       -- nº da geração (regenerar todas => ronda+1)
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_insight_images_article ON insight_images(article_id);

CREATE TABLE IF NOT EXISTS insight_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'site',      -- governo | site | blogue | instagram | midia | escritorio
  url TEXT NOT NULL UNIQUE,
  fiabilidade INTEGER NOT NULL DEFAULT 3, -- 1-5
  engajamento INTEGER NOT NULL DEFAULT 3, -- 1-5
  resumo TEXT,                            -- que temas o canal costuma tratar
  indicados INTEGER NOT NULL DEFAULT 0,   -- nº de sugestões já indicadas via este canal
  origem TEXT NOT NULL DEFAULT 'sistema', -- sistema | manual
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);

-- Fontes iniciais (curadoria: oficiais PT + canais com público relevante para a Dra.)
INSERT OR IGNORE INTO insight_sources (nome, tipo, url, fiabilidade, engajamento, resumo, origem) VALUES
  ('AIMA — Agência para a Integração, Migrações e Asilo', 'governo', 'https://aima.gov.pt', 5, 4, 'Fonte oficial de imigração em Portugal: autorizações de residência, agendamentos, CPLP, reagrupamento familiar e comunicados.', 'sistema'),
  ('Diário da República', 'governo', 'https://diariodarepublica.pt', 5, 2, 'Publicação oficial de leis e decretos — confirmação primária de qualquer alteração legislativa (nacionalidade, estrangeiros, família).', 'sistema'),
  ('ePortugal', 'governo', 'https://eportugal.gov.pt', 5, 3, 'Portal de serviços públicos: nacionalidade, documentos, registos, prazos e taxas oficiais.', 'sistema'),
  ('Portal das Finanças / AT', 'governo', 'https://www.portaldasfinancas.gov.pt', 5, 3, 'NIF, IRS, benefícios fiscais (ex-RNH), obrigações fiscais de residentes e não residentes.', 'sistema'),
  ('Segurança Social', 'governo', 'https://www.seg-social.pt', 5, 3, 'NISS, apoios sociais, pensões e obrigações contributivas de trabalhadores e independentes.', 'sistema'),
  ('IRN — Instituto dos Registos e do Notariado', 'governo', 'https://irn.justica.gov.pt', 5, 3, 'Nacionalidade portuguesa, registos civil e predial, prazos de processos de cidadania.', 'sistema'),
  ('Ordem dos Advogados', 'site', 'https://portal.oa.pt', 5, 2, 'Comunicações da OA, deontologia e pareceres — referência institucional da advocacia portuguesa.', 'sistema'),
  ('Eurodicas', 'midia', 'https://www.eurodicas.com.br', 3, 4, 'Mídia brasileira sobre emigração para a Europa com forte foco em Portugal: vistos, custo de vida, documentação.', 'sistema'),
  ('@cidadania.portuguesa (Mauricio Gonçalves)', 'instagram', 'https://www.instagram.com/cidadania.portuguesa/', 3, 5, 'Advogado com ~270K seguidores; cidadania e nacionalidade portuguesa, reage rápido a mudanças de regra.', 'sistema'),
  ('@celiosauer', 'instagram', 'https://www.instagram.com/celiosauer/', 3, 5, 'Advogado (~187K); imigração e nacionalidade — residência e cidadania para brasileiros.', 'sistema'),
  ('@brasileiros.emportugal', 'instagram', 'https://www.instagram.com/brasileiros.emportugal/', 2, 4, 'Página de notícias (~99K) para brasileiros em Portugal: AIMA, legalização, vida prática.', 'sistema'),
  ('@jessicanunes.adv', 'instagram', 'https://www.instagram.com/jessicanunes.adv/', 3, 5, 'Advogada (~95K); nacionalidade portuguesa e vistos, conteúdo frequente e bem indexado.', 'sistema'),
  ('@voumudarparaportugal (Pati Lemos)', 'instagram', 'https://www.instagram.com/voumudarparaportugal/', 2, 5, 'Maior perfil do nicho (~1,16M); morar e investir em Portugal — termómetro do que engaja o público brasileiro.', 'sistema'),
  ('@possotemostrar', 'instagram', 'https://www.instagram.com/possotemostrar/', 2, 5, 'Creator (~134K) com engajamento altíssimo (≈6%); imigração PT/ES, CPLP e autorizações de residência.', 'sistema');
