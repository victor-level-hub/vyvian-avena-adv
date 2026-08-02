-- 0029: "Falta para acabar" no histórico da campanha.
-- A campanha é CONTÍNUA (sem data de fim) — o que a trava é o limite de gastos da conta.
-- Cada entrada regista, no momento da análise, quanto valor e quanto tempo faltavam até
-- esse limite ser atingido ao ritmo diário. Mostrado no modal "Histórico da campanha".
ALTER TABLE campaign_history ADD COLUMN valor_restante TEXT;   -- ex.: 'R$ 464'
ALTER TABLE campaign_history ADD COLUMN tempo_restante TEXT;   -- ex.: '~11 dias'
ALTER TABLE campaign_history ADD COLUMN restante_nota TEXT;    -- contexto do cálculo

-- 1 ago: limite subido para R$ 1.000 nesse dia; conta gasta ~R$ 488 → restam ~R$ 512.
UPDATE campaign_history
   SET valor_restante = 'R$ 512',
       tempo_restante = '~12 dias',
       restante_nota  = 'Limite de gastos da conta R$ 1.000 (subido nesse dia). Ao ritmo de R$ 44/dia. A campanha é contínua — sem este limite não pararia sozinha.'
 WHERE data = '2026-08-01';

-- 2 ago: conta gasta R$ 536,14 de R$ 1.000 → restam R$ 463,86.
UPDATE campaign_history
   SET valor_restante = 'R$ 464',
       tempo_restante = '~11 dias',
       restante_nota  = 'Limite de gastos da conta R$ 1.000 · gastos R$ 536,14 · restam R$ 463,86. Ao ritmo de R$ 44/dia. A campanha é contínua — o limite de gastos é o que a trava.'
 WHERE data = '2026-08-02';

-- Correção: a decisão de 2 ago dizia "~21 dias" por engano — são ~11 dias.
UPDATE campaign_history
   SET decisao = replace(decisao, '~21 dias de folga', '~11 dias de folga (limite de gastos da conta)')
 WHERE data = '2026-08-02';
