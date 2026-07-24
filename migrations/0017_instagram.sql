-- 0017: Estatísticas do Instagram (Fase B) — @vyvianavenaadv.
-- Alimentado pelo cron diário (worker/cron.js -> worker/lib/instagram.js) via API
-- oficial "Instagram API with Instagram login" (graph.instagram.com). Consultado por
-- worker/routes/stats.js na aba "Instagram" da página Estatísticas. Puramente aditivo.

-- Fotografia diária da conta: total de seguidores e de publicações, um ponto por dia
-- (UTC, chave 'YYYY-MM-DD'). Serve o gráfico de evolução e o cálculo de "novos
-- seguidores no período" (atual − início do período).
CREATE TABLE IF NOT EXISTS ig_snapshots (
  day             TEXT PRIMARY KEY,
  followers_count INTEGER NOT NULL,
  media_count     INTEGER,
  captured_at     TEXT DEFAULT (datetime('now'))
);

-- Últimas publicações com o respetivo engajamento. Reescritas a cada sync (o cron faz
-- upsert por id): curtidas e comentários são sempre o valor mais recente da API. A
-- miniatura é copiada para o R2 (thumb_key) porque os URLs de imagem do Instagram
-- expiram; o Worker serve-a a partir daí em /api/ig/thumb/<id>.
CREATE TABLE IF NOT EXISTS ig_posts (
  id             TEXT PRIMARY KEY,
  caption        TEXT,
  media_type     TEXT,
  permalink      TEXT,
  timestamp      TEXT,
  like_count     INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  thumb_key      TEXT,
  fetched_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ig_posts_ts ON ig_posts (timestamp DESC);
