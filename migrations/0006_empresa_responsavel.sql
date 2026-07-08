-- migrations/0006_empresa_responsavel.sql
-- Separação empresa vs responsável (pessoa coletiva) + moradas estruturadas:
--   rep_nif / rep_nationality: NIF e nacionalidade do responsável
--   rep_address (string composta) + rep_address_parts (JSON estruturado)
--   address_parts: JSON estruturado da morada principal (empresa ou pessoa)
--     PT: {country, via_type, via_name, number, complement, freguesia, concelho, distrito, cp}
--     BR: {country, via_type, via_name, number, complement, bairro, cidade, estado, cep}
--   father_name / mother_name: filiação separada (o campo filiation mantém-se
--   como string composta para os geradores de PDF)
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0006_empresa_responsavel.sql

ALTER TABLE clients ADD COLUMN rep_nif TEXT;
ALTER TABLE clients ADD COLUMN rep_nationality TEXT;
ALTER TABLE clients ADD COLUMN rep_address TEXT;
ALTER TABLE clients ADD COLUMN address_parts TEXT;
ALTER TABLE clients ADD COLUMN rep_address_parts TEXT;
ALTER TABLE clients ADD COLUMN father_name TEXT;
ALTER TABLE clients ADD COLUMN mother_name TEXT;
