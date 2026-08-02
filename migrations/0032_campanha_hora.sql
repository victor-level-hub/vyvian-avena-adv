-- 0032: hora do registo (HH:MM, horário de Brasília).
-- Preenchida nos registos gerados automaticamente pelo botão «Atualizar agora»
-- (fase «verificação»), para distinguir vários snapshots do mesmo dia. Entradas
-- antigas/manuais ficam com hora NULL e mostram só a data.
ALTER TABLE campaign_history ADD COLUMN hora TEXT;
