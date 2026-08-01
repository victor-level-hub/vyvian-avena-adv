-- 0027: Engajamento — Instagram Insights (@vyvianavenaadv).
-- Alimentado pelo cron diário (worker/cron.js -> worker/lib/instagram.js) através da API
-- oficial "Instagram API with Instagram login" (graph.instagram.com). Consultado por
-- worker/routes/stats.js em /api/stats/engagement, para a aba "Engajamento" da página
-- Redes Sociais. Puramente aditivo: a Fase B (ig_snapshots / ig_posts) fica intacta.
--
-- Nota sobre nomes de métricas: a API usa 'saves' ao nível da conta e 'saved' ao nível
-- da publicação. As colunas abaixo respeitam essa diferença de propósito.

-- Tipo de produto da publicação (FEED | REELS | STORY | AD). Determina que métricas de
-- insights são válidas para cada peça — os Reels têm tempo de visualização, o feed tem
-- visitas ao perfil. Passa a ser recolhido junto com o resto dos campos da media.
ALTER TABLE ig_posts ADD COLUMN media_product_type TEXT;

-- Fotografia diária das métricas de conta. Uma linha por dia (UTC), obtida com
-- period=day&metric_type=total_value numa janela de 24h. O cron reescreve os últimos
-- dias (os valores assentam com atraso) e preenche buracos de dias anteriores.
-- Todas as colunas são anuláveis: se a Meta descontinuar uma métrica, o resto sobrevive.
CREATE TABLE IF NOT EXISTS ig_daily_insights (
  day                TEXT PRIMARY KEY,
  reach              INTEGER,
  views              INTEGER,
  accounts_engaged   INTEGER,
  total_interactions INTEGER,
  likes              INTEGER,
  comments           INTEGER,
  saves              INTEGER,
  shares             INTEGER,
  replies            INTEGER,
  profile_links_taps INTEGER,
  captured_at        TEXT DEFAULT (datetime('now'))
);

-- Engajamento por publicação (métricas de tempo de vida, não por dia). Chave partilhada
-- com ig_posts.id — separado em tabela própria para que uma falha nos insights não
-- estrague a listagem de publicações, que continua a funcionar só com curtidas e
-- comentários. avg_watch_time / watch_time_total vêm em milissegundos e só existem
-- para Reels.
CREATE TABLE IF NOT EXISTS ig_post_insights (
  id                 TEXT PRIMARY KEY,
  reach              INTEGER,
  views              INTEGER,
  total_interactions INTEGER,
  likes              INTEGER,
  comments           INTEGER,
  saved              INTEGER,
  shares             INTEGER,
  profile_visits     INTEGER,
  follows            INTEGER,
  avg_watch_time     INTEGER,
  watch_time_total   INTEGER,
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- Demografia agregada, uma fotografia por dia. 'kind' distingue quem SEGUE (follower)
-- de quem INTERAGE (engaged) — é a comparação que interessa: o público que reage pode
-- não ser o que já segue. 'dimension' é country | city | age | gender e 'bucket' é o
-- valor concreto ('BR', 'Lisboa', '35-44', 'F'). A Meta só devolve estas métricas em
-- contas com 100+ seguidores; até lá a tabela fica simplesmente vazia.
CREATE TABLE IF NOT EXISTS ig_demographics (
  day       TEXT    NOT NULL,
  kind      TEXT    NOT NULL,
  dimension TEXT    NOT NULL,
  bucket    TEXT    NOT NULL,
  value     INTEGER NOT NULL,
  PRIMARY KEY (day, kind, dimension, bucket)
);
CREATE INDEX IF NOT EXISTS idx_ig_demo ON ig_demographics (kind, dimension, day DESC);
