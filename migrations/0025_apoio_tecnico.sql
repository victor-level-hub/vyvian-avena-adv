-- 0025_apoio_tecnico.sql
-- Apoio Técnico: sistema de tickets de erros/melhorias/novas demandas.
-- Criados pelo Victor ou pela Dra. Vyvian na Área Privada; resolvidos pelo
-- Claude em sessão ("resolver ticket AT-2026-001") — ver worker/routes/apoio.js.

CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,              -- ex.: 'AT-2026-001'
  titulo        TEXT NOT NULL,
  descricao     TEXT DEFAULT '',
  criado_por    TEXT NOT NULL,                 -- 'Victor' | 'Dra. Vyvian'
  status        TEXT NOT NULL DEFAULT 'rascunho',
                -- rascunho | aberto | em_analise | em_execucao | impedimento | resolvido | cancelado
  urgencia      TEXT DEFAULT 'media',          -- baixa | media | alta | critica
  complexidade  TEXT,                          -- baixa | media | alta (avaliada pela IA)
  complexidade_justificacao TEXT,
  plano_ia      TEXT,                          -- como a IA tenciona resolver
  impedimentos  TEXT,                          -- preenchido por humano ou pela IA
  resolucao     TEXT,                          -- explicação de como foi resolvido
  data_abertura TEXT,                          -- YYYY-MM-DD (quando passa a 'aberto')
  hora_abertura TEXT,                          -- HH:MM (hora de Lisboa)
  data_prazo    TEXT,                          -- YYYY-MM-DD
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_anexos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,                  -- anexo | print_abertura | print_conclusao | audio
  nome         TEXT,
  content_type TEXT,
  size         INTEGER DEFAULT 0,
  r2_key       TEXT NOT NULL,
  transcricao  TEXT,                           -- só para tipo 'audio'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_anexos_ticket ON ticket_anexos (ticket_id);

CREATE TABLE IF NOT EXISTS ticket_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  evento     TEXT NOT NULL,                    -- criado | aberto | editado | status | analise_ia | anexo | execucao | resolvido
  detalhe    TEXT,
  autor      TEXT,                             -- 'Victor' | 'Dra. Vyvian' | 'IA' | 'Claude'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_log_ticket ON ticket_log (ticket_id);
