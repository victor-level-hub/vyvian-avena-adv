-- 0033 — colunas de `clients` que o código escreve mas que nenhuma migração cria.
--
-- worker/routes/clients.js:102 (INSERT) e :159 (UPDATE) escrevem nestas onze colunas.
-- Em produção foram acrescentadas à mão; no repositório nunca existiram. Resultado:
-- contra o esquema reconstruído a partir de migrations/, CRIAR UM CLIENTE É IMPOSSÍVEL.
--
-- ANTES DE APLICAR: ver migracoes-pendentes/LEIA-ME.md. Confirma com
--   PRAGMA table_info(clients);
-- quais destas já existem e apaga daqui as linhas correspondentes — o SQLite não
-- tem ADD COLUMN IF NOT EXISTS e um ALTER repetido parte a cadeia de migrações.
--
-- Todas TEXT e sem NOT NULL, porque o código trata a ausência com `|| null`.

ALTER TABLE clients ADD COLUMN address TEXT;
ALTER TABLE clients ADD COLUMN nationality TEXT;
ALTER TABLE clients ADD COLUMN marital_status TEXT;
ALTER TABLE clients ADD COLUMN rg TEXT;
ALTER TABLE clients ADD COLUMN birth_date TEXT;
ALTER TABLE clients ADD COLUMN birth_place TEXT;
ALTER TABLE clients ADD COLUMN doc_type TEXT;
ALTER TABLE clients ADD COLUMN doc_number TEXT;
ALTER TABLE clients ADD COLUMN doc_validity TEXT;
ALTER TABLE clients ADD COLUMN niss TEXT;
ALTER TABLE clients ADD COLUMN filiation TEXT;
