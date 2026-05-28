# Instalar Fase 2

Copia os ficheiros para a estrutura do projeto:

| Ficheiro deste ZIP | Destino no projeto |
|---|---|
| `worker-cron.js` | `worker/cron.js` (NOVO) |
| `worker-index.js` | `worker/index.js` (SUBSTITUIR) |
| `worker-lib-senders.js` | `worker/lib/senders.js` (NOVO) |
| `worker-routes-notifications.js` | `worker/routes/notifications.js` (SUBSTITUIR) |
| `wrangler.jsonc` | `wrangler.jsonc` (SUBSTITUIR — agora tem cron trigger) |
| `README-FASE2.md` | `README-FASE2.md` (NOVO — só doc) |

Depois:

```powershell
cd C:\Users\victor.sousa\Projetos\vyvian-avena-adv
npm run build
git add .
git commit -m "feat: fase 2 - cron diario + skeleton Resend/Z-API"
git push
```

Após deploy (~2 min), o cron está agendado para 07:00 UTC diário.

Para testar manualmente sem esperar:
```bash
# Substituir TOKEN pelo retorno do /api/auth/login
curl -X POST https://vyavenaadv.com/api/cron/run \
  -H "Authorization: Bearer TOKEN"
```
