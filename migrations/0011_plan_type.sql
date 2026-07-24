-- 0011: tipo de plano persistido no cliente.
-- Valores: installment | monthly | oficioso | probono
--   installment — parcelado (montante dividido)
--   monthly     — avença mensal recorrente
--   oficioso    — nomeação da Ordem dos Advogados; sem valor nem datas à partida,
--                 honorários fixados e recebidos após o trânsito em julgado
--                 (recebimentos registados como pagamentos avulsos)
--   probono     — atendimento gratuito e voluntário; sem componente financeira
ALTER TABLE clients ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'installment';

-- Retrocompatibilidade: até aqui, "sem valor total" significava avença mensal
-- (era assim que a UI inferia o tipo). Os novos tipos só existem daqui em diante.
UPDATE clients SET plan_type = 'monthly'
WHERE honorarios_total IS NULL OR honorarios_total = 0;
