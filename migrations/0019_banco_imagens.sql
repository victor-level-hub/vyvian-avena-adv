-- 0019: Banco de Imagens (Redes Sociais → Insights → vista IMAGENS)
-- A Dra. guarda imagens geradas por IA num banco reutilizável. Cada entrada
-- referencia a imagem original (insight_images, bytes no R2); UNIQUE(image_id)
-- garante que a mesma imagem nunca é guardada duas vezes.
CREATE TABLE IF NOT EXISTS image_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL UNIQUE REFERENCES insight_images(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_image_bank_criado ON image_bank (criado_em DESC);
