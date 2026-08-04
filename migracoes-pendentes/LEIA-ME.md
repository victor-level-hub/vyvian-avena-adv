# Migrações pendentes — NÃO estão em `migrations/` de propósito

O `wrangler d1 migrations apply` corre tudo o que estiver em `migrations/`. Estes
ficheiros ficam **fora** dessa pasta porque, se corressem já contra produção, falhavam:
as colunas que eles criam **já existem lá**, acrescentadas à mão em algum momento. O
SQLite não tem `ADD COLUMN IF NOT EXISTS`, por isso um `ALTER TABLE` repetido dá erro e
deixa a cadeia de migrações a meio.

O problema que resolvem é real e está documentado em `docs/ACHADOS-TESTES.md`:
**`migrations/` não descreve a base de dados verdadeira.** Enquanto assim for, ninguém
consegue reconstruir o sistema a partir do repositório — nem para um ambiente de testes,
nem depois de um acidente.

## Como aplicar, quando decidires

1. Confirma o que existe mesmo em produção:

```bash
npx wrangler d1 execute vyvian-db --remote --command "PRAGMA table_info(clients);"
```

2. Compara com `0033_clients_colunas_em_falta.sql` e **apaga desse ficheiro as linhas
   das colunas que já existirem**.

3. Se sobrarem zero linhas — ou seja, produção já tem tudo — a forma correta de fechar
   isto é registar a migração como aplicada sem a correr, para o repositório e a base de
   dados voltarem a estar de acordo:

```bash
npx wrangler d1 migrations list vyvian-db --remote
```

4. Só depois move o ficheiro para `migrations/` e aplica.

## Porque é que o `image_bank` não tem aqui ficheiro

O segundo defeito por corrigir — as imagens guardadas no Banco de Imagens não
sobreviverem ao apagar do artigo — vem de um `ON DELETE CASCADE` em
`insight_images.article_id` e em `image_bank.image_id`. Mudar uma restrição destas em
SQLite obriga a **reconstruir a tabela** (criar nova, copiar, apagar, renomear), com o
risco que isso tem sobre dados a sério. Não é trabalho para fazer sem alguém a olhar, e
a decisão de produto — se as imagens do banco devem mesmo sobreviver — também é tua.

O teste que documenta o defeito continua marcado em
`tests/worker/insights.test.js` (`mantém no banco a imagem guardada depois de apagar o
artigo`).
