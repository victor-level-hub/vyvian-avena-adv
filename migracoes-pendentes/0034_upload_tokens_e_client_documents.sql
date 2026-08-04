-- 0034 — `upload_tokens` e `client_documents`: as tabelas do envio de documentos
-- pelo cliente. Existem em produção, mas NÃO existem em migrations/ nem em mais
-- nenhum ficheiro do repositório — só no código que as lê e escreve
-- (worker/routes/cliente_docs.js).
--
-- O esquema abaixo foi deduzido das colunas usadas por esse ficheiro e é o mesmo
-- que os testes criam (ver o topo de tests/worker/cliente-docs.test.js).
--
-- ANTES DE APLICAR: ver migracoes-pendentes/LEIA-ME.md. Confirma o que existe com
--   PRAGMA table_info(upload_tokens);
--   PRAGMA table_info(client_documents);
-- e compara — sobretudo os tipos e os valores por omissão, que aqui são uma
-- reconstrução a partir do uso, não uma cópia do original.
--
-- O CREATE TABLE IF NOT EXISTS torna isto seguro de correr mesmo que as tabelas já
-- existam: nesse caso não faz nada. Mas atenção — se existirem com um esquema
-- DIFERENTE deste, o ficheiro passa em silêncio e a divergência mantém-se.

CREATE TABLE IF NOT EXISTS upload_tokens (
  token        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  instructions TEXT,
  expires_at   TEXT NOT NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  used_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client_documents (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_via TEXT,
  token        TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_client ON upload_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);
