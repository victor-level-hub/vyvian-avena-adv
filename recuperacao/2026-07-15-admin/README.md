# Recuperação — Área Privada perdida a 15 jul 2026

Bundles **minificados** da última versão da Área Privada que esteve no ar com o
trabalho que nunca chegou ao repositório. Guardados aqui a 16 jul 2026 porque
só existiam no histórico de versões do Cloudflare (que expira).

**NÃO são código-fonte nem entram no build** — são a fonte para reconstruir.

## O que aconteceu (apurado a 16 jul 2026)

| Momento | Versão do Worker | Estado |
|---|---|---|
| 14 jul 13:41 → 15 jul 08:41 | `567ce5e0` … `2b55f6ed` | Admin **completo** — bundle 200 KB |
| 15 jul 10:20:49 | commit `66c2c65` (artigo do blogue) | — |
| 15 jul 10:21:32 | `ef53a7f4` | **Perdido** — bundle 147 KB |

O deploy das 10:21 de 15 jul foi feito a partir do repositório, 43 segundos depois
do commit do artigo do blogue. O código da Área Privada nunca tinha sido comitado
— vivia só em produção. O build a partir do repo produziu o admin antigo e o
`wrangler deploy` substituiu o que estava no ar. Mesma falha que apagou as capas
do blogue (ver `processo-artigo-blogue-completo.md`, ponto 5): trabalho só em
produção, sem commit.

## O que se perdeu

1. **Anexos por tipo de documento** (o que o Victor deu por falta a 16 jul):
   - `const ks=[["fatura","Fatura"],["recibo","Recibo"],["fatura-recibo","Fatura-Recibo"]]`
   - Um botão "Anexar {tipo}" por tipo, com drag&drop de PDF (`adm-drop-target`);
     depois de anexado passa a "Ver {tipo}" + Substituir/Enviar/Remover.
   - Regra de negócio: anexar **Recibo** ou **Fatura-Recibo** marca a parcela como
     paga; **Fatura não** ("Anexar PDF da fatura (não marca a parcela como paga)").
     Ao remover: "Se não restar Recibo nem Fatura-Recibo, a parcela volta a pendente."
   - API: `PUT/DELETE /api/recibos/{id}?tipo={fatura|recibo|fatura-recibo}` e
     `GET /api/recibos/{id}?info=all`. O worker atual só conhece o RV único.
2. **Upgrade visual Fases 1–4** (ver `claude_upgrade-visual-area-privada.md`):
   toasts, tabs deslizantes, count-up, command palette, skeletons, datepicker,
   avatares com foto da Dra., scrollbars da marca. Nada disto está no repo.

## Estado dos dados (bom)

Os ficheiros reais da Dra. **estão intactos** no R2 `vyvian-recibos` — a aplicação
é que deixou de os ver. Convenção das chaves:

```
recibos/{clientId}/{clientId}-p{N}.pdf                 → Recibo
recibos/{clientId}/{clientId}-p{N}-fatura.pdf          → Fatura
recibos/{clientId}/{clientId}-p{N}-fatura-recibo.pdf   → Fatura-Recibo
```

A 16 jul havia 8 faturas/faturas-recibo órfãs (Daniellen p1/p2/p3, Luiz Gustavo p2,
Maria Clara p1/p2, Maria Eduarda p2). `installments.receipt_path` só guarda um
caminho — a existência dos outros tipos era lida do próprio R2.

## Regra que isto reforça

**Commit + push no próprio dia, sempre** — e nunca fazer `wrangler deploy` a
partir do repo sem confirmar que o repo contém tudo o que está no ar. O
`seo-check` já trava capas do blogue em falta (guard de 16 jul); a Área Privada
não tem equivalente porque o bundle é opaco — a defesa é o commit.
