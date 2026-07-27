-- 0024: Publicação de artigos Insights no blogue.
-- publicar_em = quando a Dra. clicou PUBLICAR (entra na fila);
-- publicado_em = quando o pipeline (GitHub Actions) confirmou o deploy;
-- slug = URL final /blog/<slug>.
ALTER TABLE insight_articles ADD COLUMN slug TEXT;
ALTER TABLE insight_articles ADD COLUMN publicar_em TEXT;
ALTER TABLE insight_articles ADD COLUMN publicado_em TEXT;
