-- 0026_configuracoes_users.sql
-- Configurações → Gestão de utilizadores da Área Privada.
-- Sem tabela de perfis: cada utilizador tem `permissions` (JSON) com as abas a
-- que acede + permissões especiais. '["*"]' = acesso total (Dra. e Victor).
-- Chaves: painel, clientes, parcelas, calendario, notificacoes, estatisticas,
--         apoio, configuracoes, gerir_utilizadores.
-- Convite: o utilizador é criado sem password utilizável; recebe por e-mail
-- (Resend) um link /admin/convite/<token> onde define a password e completa
-- os dados. `status`: 'ativo' | 'convidado'.

ALTER TABLE users ADD COLUMN cargo TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN photo_key TEXT;
ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '["*"]';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE users ADD COLUMN invite_token TEXT;
ALTER TABLE users ADD COLUMN invite_expires TEXT;

-- utilizadores existentes ficam com acesso total explícito
UPDATE users SET permissions = '["*"]';
