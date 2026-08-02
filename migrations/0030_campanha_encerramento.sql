-- 0030: Encerramento programado da campanha "Reel Urgência Nacionalidade — Jul 2026 (BR+PT)".
-- Nova entrada no "Histórico da campanha" (aba Engajamento). Segue as informações padrão:
-- data · fase · título · ações · métricas · decisão. Depende só das colunas base do 0028
-- (não usa valor_restante/tempo_restante), por isso aplica-se com ou sem a 0029.

INSERT INTO campaign_history (data, fase, titulo, resumo, acoes, metricas, decisao) VALUES (
  '2026-08-02',
  'alteracao',
  'Encerramento programado para hoje às 23:00',
  'Em vez de deixar correr até bater o limite de gastos da conta, a campanha foi encerrada manualmente esta noite.',
  json('["Definida Data de término = 2 ago 2026, 23:00 (GMT-3 / Brasília) nos DOIS conjuntos (PT e BR).","Alterações publicadas em cada conjunto — «Todas as edições salvas» é só rascunho; só entra em vigor com Publicar.","A campanha deixa de depender do limite de gastos da conta (R$ 1.000) para parar: passa a ter fim fixo."]'),
  json('[{"label":"Gasto da conta","valor":"R$ 536,14","sub":"de R$ 1.000"},{"label":"Restava até ao limite","valor":"R$ 463,86","sub":"~11 dias a ~R$ 44/dia"},{"label":"Fim programado","valor":"Hoje 23:00","sub":"GMT-3 · PT + BR"}]'),
  'Encerrar hoje às 23:00. Para a PRÓXIMA campanha: usar Programação do orçamento (dayparting) — aumentar a verba nos horários de pico de engajamento e desligar/reduzir bem nos horários fracos, decidido pelo histórico da aba Engajamento (não por palpite).'
);
