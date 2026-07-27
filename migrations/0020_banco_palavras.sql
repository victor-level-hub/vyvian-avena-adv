-- 0020: Banco de Palavras (SEO) + visitas por página.
--
-- keyword_bank: "palavras" e "conjuntos de palavras" com potencial de pesquisa.
-- Alimentado pela IA na geração de artigos (novos termos + score de potencial) e
-- pelo cron diário, que recalcula as métricas reais: em quantos artigos o termo é
-- usado, visitas das páginas do blogue cujo slug o contém, curtidas e comentários
-- dos posts de Instagram cuja legenda o contém. A IA consulta este banco ao
-- pesquisar temas e ao escrever artigos (termos fortes + termos por cobrir).
CREATE TABLE IF NOT EXISTS keyword_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  termo TEXT NOT NULL UNIQUE,                     -- normalizado: minúsculas, sem acentos
  tipo TEXT NOT NULL DEFAULT 'conjunto',          -- 'palavra' | 'conjunto'
  score INTEGER NOT NULL DEFAULT 50,              -- potencial de pesquisa/engajamento 0-100 (IA)
  usos INTEGER NOT NULL DEFAULT 0,                -- nº de artigos (Insights) que usam o termo
  visitas INTEGER NOT NULL DEFAULT 0,             -- visitas em páginas /blog/* cujo slug contém o termo
  ig_curtidas INTEGER NOT NULL DEFAULT 0,         -- soma de curtidas de posts IG cuja legenda contém o termo
  ig_comentarios INTEGER NOT NULL DEFAULT 0,      -- idem, comentários
  origem TEXT NOT NULL DEFAULT 'ia',              -- 'ia' | 'manual'
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_keyword_bank_score ON keyword_bank (score DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_bank_usos ON keyword_bank (usos, score DESC);

-- Visitas por página e por dia (o contador global por hora continua em
-- site_visits_hourly). Alimentado pelo beacon /api/hit, que passa a enviar o
-- caminho. Necessário para a coluna "visitas" do keyword_bank.
CREATE TABLE IF NOT EXISTS site_page_views (
  day   TEXT NOT NULL,                            -- 'YYYY-MM-DD' (UTC)
  path  TEXT NOT NULL,                            -- ex.: /blog/nome-do-artigo
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
CREATE INDEX IF NOT EXISTS idx_site_page_views_path ON site_page_views (path);
