-- 0023: «Revisto pela Dra.» deixa de ser decorativo.
-- revisto_em = data/hora em que a Dra. marcou o artigo como revisto (NULL = por
-- rever). Qualquer alteração posterior ao conteúdo (título, descrição, corpo ou
-- inserção de fotos) limpa a marca — texto mudado é texto por rever.
ALTER TABLE insight_articles ADD COLUMN revisto_em TEXT;
