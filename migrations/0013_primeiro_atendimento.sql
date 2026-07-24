-- 0010: Data do primeiro atendimento do cliente.
-- O campo contract_start_date mantém-se e passa a ser apresentado na UI como
-- "Data de Vencimento" (data da 1.ª parcela; as seguintes vencem mensalmente).
-- first_attendance_date fica em branco para clientes existentes — a Dra. preenche
-- depois, caso se faça necessário.
ALTER TABLE clients ADD COLUMN first_attendance_date TEXT;
