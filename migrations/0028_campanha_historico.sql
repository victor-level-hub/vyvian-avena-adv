-- 0028: Histórico da campanha Meta Ads.
-- Registo cronológico das intervenções e verificações da campanha de impulsionamento
-- (montagem, auditoria, alterações, verificações). Consultado por /api/stats/campaign-history
-- e mostrado no modal "Histórico da campanha" da aba Engajamento (Redes Sociais).
--
-- Cada entrada segue SEMPRE os mesmos campos ("informações padrão"):
--   data · fase · título · ações (o que foi feito) · métricas · decisão/recomendação.
-- 'acoes' e 'metricas' são JSON (o Worker devolve-os já parseados):
--   acoes    = ["texto da ação", ...]
--   metricas = [{"label":"Visitas ao perfil","valor":"163","sub":"PT 112 · BR 51"}, ...]

CREATE TABLE IF NOT EXISTS campaign_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,              -- 'YYYY-MM-DD' do evento/análise
  fase       TEXT NOT NULL,              -- montagem | auditoria | alteracao | verificacao
  titulo     TEXT NOT NULL,
  resumo     TEXT,                       -- 1 frase de contexto
  acoes      TEXT,                       -- JSON: lista de ações feitas
  metricas   TEXT,                       -- JSON: lista de {label, valor, sub?}
  decisao    TEXT,                       -- decisão/recomendação que ficou
  criado_em  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaign_history_data ON campaign_history (data DESC, id DESC);

-- Entrada 1 — montagem + auditoria (1 ago 2026).
INSERT INTO campaign_history (data, fase, titulo, resumo, acoes, metricas, decisao) VALUES (
  '2026-08-01',
  'auditoria',
  'Montagem, auditoria e passagem a ABO',
  'Campanha "Reel Urgência Nacionalidade — Jul 2026 (BR+PT)" publicada a 31 jul às 20:00; metade dela (Portugal) tinha ficado em rascunho sem aviso.',
  json('["Conjunto PT estava em rascunho — a campanha mostrava-se ativa com metade parada; publicado.","Orçamento de campanha (CBO) trocado para orçamento por conjunto (ABO): PT R$ 30/dia, BR R$ 14/dia.","Conjuntos e anúncios renomeados (BR — Estados imigração 35+ / PT — Zonas BR-residentes / Reel Urgência IRN — BR e PT).","Limite de gastos da conta estava a ~2,5 dias de travar tudo — subido para R$ 1.000."]'),
  json('[{"label":"Visitas ao perfil","valor":"35","sub":"primeiras ~14h"},{"label":"Gasto","valor":"R$ 13,73"},{"label":"CTR (link)","valor":"6,32%"},{"label":"Frequência","valor":"1,07"},{"label":"PT","valor":"18 visitas","sub":"R$ 0,47/visita"},{"label":"BR","valor":"17 visitas","sub":"R$ 0,31/visita"}]'),
  'Manter objetivo Engajamento (decisão do Victor). Entrega a ~50% do esperado — normal na fase de aprendizagem. Reavaliar às 20:00; inverter verba para o BR só se o PT continuar bem mais caro E sem gerar contactos.'
);

-- Entrada 2 — verificação às ~37h (2 ago 2026).
INSERT INTO campaign_history (data, fase, titulo, resumo, acoes, metricas, decisao) VALUES (
  '2026-08-02',
  'verificacao',
  'Verificação às ~37h de veiculação',
  'Ambos os conjuntos ativos e a entregar; a fase de aprendizagem passou e a diferença de custo entre PT e BR encolheu muito.',
  json('["Ambos os conjuntos ativos e a entregar.","Entrega normalizou: ~91% do ritmo esperado (a subentrega inicial passou).","Diferença de custo PT vs BR encolheu de 34% (ontem) para 8% — a vantagem do BR era efeito da aprendizagem, não estrutural."]'),
  json('[{"label":"Visitas ao perfil","valor":"163","sub":"PT 112 · BR 51"},{"label":"Custo por visita","valor":"R$ 0,38","sub":"PT R$ 0,39 · BR R$ 0,36"},{"label":"Alcance","valor":"2.065","sub":"PT 1.593 · BR 506"},{"label":"Frequência","valor":"1,21"},{"label":"CTR (link)","valor":"5,74%"},{"label":"Gasto acumulado","valor":"R$ 61,72","sub":"PT R$ 43,72 · BR R$ 18,18"}]'),
  'Não mexer. Inverter a verba para o BR já não se justifica. Limite de gastos confortável (~21 dias de folga). O que decide agora são as conversas geradas na caixa de entrada do Instagram/WhatsApp, não as métricas do Ads Manager.'
);
