-- migrations/0010_cliente_pessoas.sql
-- Clientes com várias pessoas singulares (ex.: casal na mesma procuração/processo).
-- A pessoa 1 (titular) continua nos campos da tabela `clients` — é o contacto
-- principal (e-mail/WhatsApp, lembretes, recibos). As pessoas ADICIONAIS vivem
-- aqui, com os mesmos campos pessoais, ligadas por client_id (cascata no delete).
-- Executar via: wrangler d1 migrations apply vyvian-avena-db --remote

CREATE TABLE IF NOT EXISTS client_people (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 2,   -- 2 = segunda pessoa, 3 = terceira, …
  name TEXT NOT NULL,
  identification TEXT,                   -- NIF (PT) / CPF (BR)
  nationality TEXT,
  marital_status TEXT,
  rg TEXT,                               -- só BR
  birth_date TEXT,
  birth_place TEXT,
  doc_type TEXT,
  doc_number TEXT,
  doc_validity TEXT,
  niss TEXT,                             -- só PT
  father_name TEXT,
  mother_name TEXT,
  filiation TEXT,
  address TEXT,
  address_parts TEXT,                    -- JSON estruturado (AddressEditor)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_people_client ON client_people(client_id, position);
