-- migrations/0004_contactos_multiplos.sql
-- Múltiplos contactos com label por cliente.
--   emails / phones: JSON array [{"label":"Empresa","value":"geral@x.pt"}, ...]
-- As colunas email/phone continuam a existir como CONTACTO PRINCIPAL
-- (primeiro da lista) — usadas pelas notificações, recibos e planos.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0004_contactos_multiplos.sql

ALTER TABLE clients ADD COLUMN emails TEXT;
ALTER TABLE clients ADD COLUMN phones TEXT;
