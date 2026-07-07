-- migrations/0003_process_summary.sql
-- Resumo do processo do cliente, gerado/melhorado pela IA a partir dos
-- documentos arrastados no cadastro (e editável manualmente).
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0003_process_summary.sql

ALTER TABLE clients ADD COLUMN process_summary TEXT;
