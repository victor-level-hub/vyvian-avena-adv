-- 0011: Registo do envio manual de lembrete por WhatsApp.
-- Preenchido quando a Dra. clica "Abrir no WhatsApp" no modal da página de Parcelas
-- (a mensagem abre pré-preenchida na conversa do cliente; considera-se enviada).
ALTER TABLE installments ADD COLUMN wa_sent_at TEXT;
