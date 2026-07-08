-- migrations/0007_client_logo.sql
-- Logo/fotografia do cliente (guardada no R2, chave logos/<client_id>).
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0007_client_logo.sql

ALTER TABLE clients ADD COLUMN logo_key TEXT;
ALTER TABLE clients ADD COLUMN logo_type TEXT;
