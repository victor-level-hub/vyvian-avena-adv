-- 0022: Narração do artigo via ElevenLabs (Insights).
-- Quando a Dra. dá o texto por finalizado, o Worker gera a narração com a voz
-- do blogue (Claudia, pt-PT) e guarda o MP3 no R2. audio_key = chave R2;
-- audio_em = data/hora da geração (para avisar se o texto mudou depois).
ALTER TABLE insight_articles ADD COLUMN audio_key TEXT;
ALTER TABLE insight_articles ADD COLUMN audio_em TEXT;
