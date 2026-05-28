# Instalar Fase 3 — Recibos PDF

## 1. Instalar dependência pdf-lib

```powershell
cd C:\Users\victor.sousa\Projetos\vyvian-avena-adv
npm install pdf-lib
```

(`pdf-lib` é uma biblioteca JS pura para gerar PDFs, ~250 KB, sem dependências nativas — funciona no Cloudflare Worker.)

## 2. Copiar ficheiros

| Ficheiro deste ZIP | Destino no projeto |
|---|---|
| `worker-lib-pdfgen.js` | `worker/lib/pdfgen.js` (NOVO) |
| `worker-routes-recibos.js` | `worker/routes/recibos.js` (NOVO) |
| `worker-index.js` | `worker/index.js` (SUBSTITUIR) |
| `wrangler.jsonc` | `wrangler.jsonc` (SUBSTITUIR — agora com R2 binding) |
| `admin-apiClient.js` | `src/admin/apiClient.js` (SUBSTITUIR) |
| `admin-pages-ClientDetail.jsx` | `src/admin/pages/ClientDetail.jsx` (SUBSTITUIR) |

## 3. Build + push

```powershell
npm run build
git add .
git commit -m "feat: fase 3 - geracao de recibos PDF (R2 + pdf-lib)"
git push
```

## 4. Testar

Após deploy (~2 min):

1. Login em `vyavenaadv.com/admin/login`
2. Abrir qualquer cliente com parcelas pagas (ex: Maria Soares)
3. Clicar **"Recibo"** numa parcela paga
4. PDF abre em nova aba — design verde-floresta + dourado, formato A4

Primeira chamada gera o PDF e guarda em R2 (chave `recibos/{client_id}/{installment_id}.pdf`).
Chamadas seguintes retornam o cached do R2 (mais rápido).

## API endpoints

| Método | Path | Função |
|---|---|---|
| GET | `/api/recibos/:installmentId` | Retorna PDF (gera se não existir) |
| GET | `/api/recibos/:installmentId?info=true` | Metadados JSON (sem download) |
| POST | `/api/recibos/:installmentId` | Força regeneração |
| DELETE | `/api/recibos/:installmentId` | Apaga PDF do R2 |

## Layout do recibo

Cabeçalho verde-floresta `#12302a` + dourado `#b8935a`:
- "VYVIAN AVENA · ADVOGADA" (esquerda)
- "RECIBO Nº YYYY-NNNN" (direita)

Corpo:
- Recebi de: [Nome] · [NIF/CPF/CNPJ] · [Email]
- A quantia de: € XXX,XX (em destaque grande)
- Referente a: Honorários · Parcela X/Y
- Tabela: data vencimento, data pagamento, forma, valor
- Declaração de quitação (texto adaptado PT vs BR)
- Assinatura: "Dra. Vyvian Avena" + ordem profissional

Footer: identificador único + timestamp UTC.
