-- migrations/0001_initial_schema.sql
-- Schema inicial da BD Vyvian Avena.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0001_initial_schema.sql
-- Esta migration já foi executada no D1 production a 27 Mai 2026.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  country TEXT NOT NULL,
  identification TEXT,
  practice_area TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  honorarios_total REAL DEFAULT 0,
  honorarios_parcelas INTEGER DEFAULT 1,
  contract_start_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS installments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  installment_number INTEGER NOT NULL,
  total_installments INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  due_date TEXT NOT NULL,
  paid_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  receipt_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  days_before INTEGER NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 1,
  template_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt-PT',
  subject TEXT,
  body TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  installment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  message_preview TEXT,
  error_message TEXT,
  external_id TEXT,
  FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_installments_client ON installments(client_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_status ON installments(status);
CREATE INDEX IF NOT EXISTS idx_notif_rules_client ON notification_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_installment ON notification_log(installment_id);
CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
