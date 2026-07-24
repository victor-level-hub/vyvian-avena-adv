-- 0016: Estatísticas de acessos ao site (contador próprio, sem cookies — RGPD ok).
-- Preenchido pelo middleware do Worker (worker/lib/visits.js) em cada navegação HTML
-- do site público. Consultado por worker/routes/stats.js na página "Estatísticas" da
-- Área Privada. Puramente aditivo — não toca em nenhuma tabela existente.

-- Visitas (page views) agregadas por HORA, em UTC. Chave 'YYYY-MM-DDTHH'.
CREATE TABLE IF NOT EXISTS site_visits_hourly (
  hour  TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0
);

-- Visitantes únicos por DIA, sem cookies. visitor_hash = SHA-256(dia|ip|ua|segredo):
-- irreversível e com o dia dentro do hash (o "sal" roda todos os dias, por isso não
-- permite seguir um visitante entre dias). As linhas são apagadas após ~35 dias pelo
-- cron diário (worker/cron.js). Chave 'YYYY-MM-DD' em UTC.
CREATE TABLE IF NOT EXISTS site_visitors_daily (
  day          TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
CREATE INDEX IF NOT EXISTS idx_site_visitors_day ON site_visitors_daily (day);
