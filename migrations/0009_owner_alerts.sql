-- migrations/0009_owner_alerts.sql
-- Reestruturação das notificações (acordada com o Victor a 2026-05-29,
-- autorizada a 2026-07-11): as notification_rules por cliente passam a ser
-- geridas na ficha do cliente; a secção Notificações do admin vira um painel
-- de alertas PARA A DRA. VYVIAN (não para os clientes).
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0009_owner_alerts.sql

-- Preferências: um registo por tipo de alerta, com toggle por canal.
CREATE TABLE IF NOT EXISTS owner_alert_prefs (
  alert_type TEXT PRIMARY KEY,          -- vence_hoje | em_atraso | resumo_diario | pagamento_recebido
  email_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO owner_alert_prefs (alert_type, email_enabled, whatsapp_enabled) VALUES
  ('vence_hoje', 1, 0),
  ('em_atraso', 1, 0),
  ('resumo_diario', 0, 0),
  ('pagamento_recebido', 0, 0);

-- Contactos de destino dos alertas (linha única).
CREATE TABLE IF NOT EXISTS owner_alert_contacts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  whatsapp TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO owner_alert_contacts (id, email, whatsapp) VALUES (1, 'vyavena@gmail.com', NULL);

-- Log próprio (notification_log exige installment_id; os alertas à Dra. são
-- agregados). Também serve de dedupe: 1 alerta por tipo+canal+dia.
CREATE TABLE IF NOT EXISTS owner_alert_log (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,                 -- sent | error
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_date TEXT NOT NULL,              -- YYYY-MM-DD (para dedupe diário)
  message_preview TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_alert_log_dedupe ON owner_alert_log(alert_type, channel, sent_date);
