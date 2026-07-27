-- 0021: Avaliação da IA por artigo (Insights).
-- Depois de a Dra. guardar alterações ao texto/descrição SEO, a IA atribui notas
-- de 0 a 10 (texto e SEO), com motivo e sugestões de melhoria. Guardado como JSON:
-- { "texto": {"score","motivo","melhorias":[]}, "seo": {...}, "avaliado_em": "..." }
ALTER TABLE insight_articles ADD COLUMN avaliacao TEXT;
