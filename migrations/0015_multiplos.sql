-- 0012: Cadastro com múltiplas nacionalidades, múltiplos documentos e múltiplos processos.
-- Guardados como JSON (mesmo padrão de emails/phones). Os campos antigos
-- (nationality, doc_type/doc_number/doc_validity, practice_area, process_summary, notes)
-- continuam a ser preenchidos com o PRIMEIRO item de cada lista, por retrocompatibilidade
-- com o resto do sistema (PDFs, procurações, filtros).
ALTER TABLE clients ADD COLUMN nationalities TEXT;   -- ["portuguesa","brasileira"]
ALTER TABLE clients ADD COLUMN documents TEXT;       -- [{"docType","docNumber","docValidity"}]
ALTER TABLE clients ADD COLUMN processes TEXT;       -- [{"ref","area","resumo"}]
