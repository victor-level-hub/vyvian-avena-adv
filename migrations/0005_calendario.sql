-- migrations/0005_calendario.sql
-- Calendário jurídico configurável:
--   calendar_types: tipos de data (nativos + personalizados)
--   calendar_events: eventos (sistema + manuais)
-- Seed 2026: feriados nacionais PT, férias judiciais, ano judicial,
-- Ordem dos Advogados e efemérides jurídicas.
-- Executar via: wrangler d1 execute vyvian-avena-db --remote --file=migrations/0005_calendario.sql

CREATE TABLE IF NOT EXISTS calendar_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 1,
  amount REAL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'none',
  client_name TEXT,
  case_reference TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (type_id) REFERENCES calendar_types(id)
);

CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_cal_events_type ON calendar_events(type_id);

-- ── Tipos nativos ──────────────────────────────────────────────
INSERT OR IGNORE INTO calendar_types (id, label, color, description, is_default, is_visible) VALUES
  ('feriado_nacional', 'Feriados nacionais', '#8B6F47', 'Feriados nacionais de Portugal.', 1, 1),
  ('ferias_judiciais', 'Férias judiciais', '#9A4E4E', 'Períodos de férias judiciais em Portugal.', 1, 1),
  ('ano_judicial', 'Ano judicial', '#2F5D50', 'Ano judicial português. O ano judicial corresponde ao ano civil.', 1, 1),
  ('ordem_advogados', 'Ordem dos Advogados', '#4B6584', 'Datas institucionais relevantes para a advocacia portuguesa.', 1, 1),
  ('efemeride_juridica', 'Efemérides jurídicas', '#7D5A8C', 'Datas comemorativas relacionadas com justiça, direitos humanos e cidadania.', 1, 1),
  ('prazo_processual_modelo', 'Prazos processuais modelo', '#B08968', 'Prazos processuais genéricos apenas para referência, sem processo concreto associado.', 1, 0),
  ('evento_pessoal', 'Eventos pessoais', '#59788E', 'Eventos adicionados manualmente pela Dra.', 1, 1),
  ('financeiro', 'Financeiro', '#4F8A67', 'Avenças, recebimentos, pagamentos e valores previstos.', 1, 1),
  ('cliente', 'Clientes', '#C18653', 'Reuniões, consultas, chamadas e follow-ups com clientes.', 1, 1),
  ('processo', 'Processos', '#7A4E48', 'Prazos concretos, audiências, diligências e tarefas associadas a processos específicos.', 1, 1);

-- ── Eventos de sistema 2026 ────────────────────────────────────
INSERT OR IGNORE INTO calendar_events (id, title, description, type_id, start_date, end_date, source) VALUES
  ('2026-ano-judicial-inicio', 'Início do ano judicial', 'Em Portugal, o ano judicial corresponde ao ano civil.', 'ano_judicial', '2026-01-01', NULL, 'system'),
  ('2026-ano-judicial-fim', 'Fim do ano judicial', 'Em Portugal, o ano judicial corresponde ao ano civil.', 'ano_judicial', '2026-12-31', NULL, 'system'),
  ('2026-ferias-judiciais-natal-ano-novo', 'Férias judiciais — Natal/Ano Novo', 'Período de férias judiciais de 22 de dezembro a 3 de janeiro; no calendário de 2026 entra de 1 a 3 de janeiro.', 'ferias_judiciais', '2026-01-01', '2026-01-03', 'system'),
  ('2026-ferias-judiciais-pascoa', 'Férias judiciais — Páscoa', 'Férias judiciais do domingo de Ramos à segunda-feira de Páscoa.', 'ferias_judiciais', '2026-03-29', '2026-04-06', 'system'),
  ('2026-ferias-judiciais-verao', 'Férias judiciais — Verão', 'Férias judiciais de verão.', 'ferias_judiciais', '2026-07-15', '2026-08-31', 'system'),
  ('2026-ferias-judiciais-natal', 'Férias judiciais — Natal', 'Férias judiciais de Natal.', 'ferias_judiciais', '2026-12-22', '2026-12-31', 'system'),
  ('2026-feriado-ano-novo', 'Ano Novo', 'Feriado nacional.', 'feriado_nacional', '2026-01-01', NULL, 'system'),
  ('2026-feriado-sexta-feira-santa', 'Sexta-Feira Santa', 'Feriado nacional.', 'feriado_nacional', '2026-04-03', NULL, 'system'),
  ('2026-feriado-pascoa', 'Páscoa', 'Feriado nacional.', 'feriado_nacional', '2026-04-05', NULL, 'system'),
  ('2026-feriado-dia-liberdade', 'Dia da Liberdade', 'Feriado nacional.', 'feriado_nacional', '2026-04-25', NULL, 'system'),
  ('2026-feriado-dia-trabalhador', 'Dia do Trabalhador', 'Feriado nacional.', 'feriado_nacional', '2026-05-01', NULL, 'system'),
  ('2026-feriado-corpo-de-deus', 'Corpo de Deus', 'Feriado nacional.', 'feriado_nacional', '2026-06-04', NULL, 'system'),
  ('2026-feriado-dia-portugal', 'Dia de Portugal, de Camões e das Comunidades Portuguesas', 'Feriado nacional.', 'feriado_nacional', '2026-06-10', NULL, 'system'),
  ('2026-feriado-assuncao', 'Assunção de Nossa Senhora', 'Feriado nacional.', 'feriado_nacional', '2026-08-15', NULL, 'system'),
  ('2026-feriado-implantacao-republica', 'Implantação da República', 'Feriado nacional.', 'feriado_nacional', '2026-10-05', NULL, 'system'),
  ('2026-feriado-todos-os-santos', 'Todos os Santos', 'Feriado nacional.', 'feriado_nacional', '2026-11-01', NULL, 'system'),
  ('2026-feriado-restauracao-independencia', 'Restauração da Independência', 'Feriado nacional.', 'feriado_nacional', '2026-12-01', NULL, 'system'),
  ('2026-feriado-imaculada-conceicao', 'Imaculada Conceição', 'Feriado nacional.', 'feriado_nacional', '2026-12-08', NULL, 'system'),
  ('2026-feriado-natal', 'Natal', 'Feriado nacional.', 'feriado_nacional', '2026-12-25', NULL, 'system'),
  ('2026-dia-advogado-comemoracoes', 'Comemorações do Dia do Advogado', 'Comemorações institucionais do Dia do Advogado 2026.', 'ordem_advogados', '2026-05-17', '2026-05-19', 'system'),
  ('2026-dia-advogado', 'Dia do Advogado', 'Dia do Advogado em Portugal.', 'ordem_advogados', '2026-05-19', NULL, 'system'),
  ('2026-dia-europeu-justica', 'Dia Europeu da Justiça', 'Data europeia dedicada à aproximação da justiça aos cidadãos.', 'efemeride_juridica', '2026-10-25', NULL, 'system'),
  ('2026-dia-direitos-humanos', 'Dia Internacional dos Direitos Humanos', 'Data internacional associada à Declaração Universal dos Direitos Humanos.', 'efemeride_juridica', '2026-12-10', NULL, 'system');
