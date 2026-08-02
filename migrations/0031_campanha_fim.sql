-- 0031: Data e hora de fim do engajamento (campo editável no painel) + snapshots por sync.
-- Configuração ao nível da campanha (um valor só), guardada como chave/valor.
-- O painel (aba Engajamento) mostra "termina …" com contagem decrescente e permite editar.
-- A data/hora é sempre em horário de Brasília (GMT-3): guardada em ISO com offset -03:00.
CREATE TABLE IF NOT EXISTS campaign_settings (
  chave         TEXT PRIMARY KEY,
  valor         TEXT,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

-- Fim atual: definido no Meta a 2 ago 2026 às 23:00 (GMT-3) nos dois conjuntos.
INSERT OR IGNORE INTO campaign_settings (chave, valor) VALUES
  ('fim_engajamento', '2026-08-02T23:00:00-03:00');
