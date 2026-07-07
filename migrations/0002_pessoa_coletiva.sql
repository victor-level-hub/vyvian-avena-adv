-- migrations/0002_pessoa_coletiva.sql
-- Suporte a clientes pessoa coletiva (empresas):
--   person_type: 'singular' (default) | 'coletiva'
--   rep_name / rep_role: representante legal e cargo (ex.: sócio-gerente)
--   duns: número DUNS da empresa (visível em procurações)
-- Para coletiva: name = nome da empresa, identification = NIPC,
-- address = sede, doc_* = documento do representante.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0002_pessoa_coletiva.sql

ALTER TABLE clients ADD COLUMN person_type TEXT NOT NULL DEFAULT 'singular';
ALTER TABLE clients ADD COLUMN rep_name TEXT;
ALTER TABLE clients ADD COLUMN rep_role TEXT;
ALTER TABLE clients ADD COLUMN duns TEXT;
