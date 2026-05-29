# Dados de demonstração — Vyvian Avena Advogada

Conjunto de dados **fictícios** para apresentar o sistema de gestão financeira a potenciais
clientes (outros advogados), sem expor dados reais.

## Conteúdo

- `demo-data.json` — 5 clientes fictícios + 31 parcelas, cobrindo:
  - **Portugal (EUR)** e **Brasil (BRL)**
  - Todas as áreas: Família, Cível, Trabalhista, Empresarial, Nacionalidade
  - Todos os estados de pagamento: pago, em atraso, vence hoje, a vencer
  - Planos parcelados (4x, 6x, 8x), avença mensal (12x) e pagamento único (1x)
  - Todos os campos novos preenchidos (morada, nacionalidade, estado civil, documento, NISS, filiação)
- `seed-demo.mjs` — carrega os dados numa instância via API
- `clear-demo.mjs` — remove os dados de demonstração (por prefixo `cli_demo_`)

Os IDs usam o prefixo `cli_demo_` / `inst_cli_demo_` para serem fáceis de identificar e remover.

## Como carregar

Requer Node.js 18+ (tem `fetch` nativo). A partir desta pasta:

```bash
# Produção (com login)
node seed-demo.mjs --base https://vyavenaadv.com --email SEU_EMAIL --password SUA_SENHA

# Local (dev)
node seed-demo.mjs --base http://localhost:8787 --email SEU_EMAIL --password SUA_SENHA

# Ou, se já tiver um token JWT:
node seed-demo.mjs --base https://vyavenaadv.com --token SEU_JWT
```

## Como remover (depois da demonstração)

```bash
node clear-demo.mjs --base https://vyavenaadv.com --email SEU_EMAIL --password SUA_SENHA
```

## Notas

- O `seed` **não apaga** nada; se um cliente já existir (mesmo ID), é ignorado.
- As parcelas são criadas como `pending` e depois marcadas como pagas conforme o JSON,
  via a ação `mark_paid` da API (espelha o fluxo real do sistema).
- Datas são **relativas ao dia em que o JSON foi gerado** — para uma demo com datas
  sempre frescas, basta regenerar o JSON.
