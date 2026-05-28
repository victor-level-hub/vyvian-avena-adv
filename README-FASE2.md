# Vyvian Avena — Backend Fase 2

Extensão da Fase 1 com:

- ✅ **Cron diário** (07:00 UTC) que atualiza status e enfila notificações
- ✅ **Endpoint manual** `POST /api/cron/run` para testar o cron sem esperar
- ✅ **Endpoint `POST /api/notifications/send`** — envio manual (botão "Reenviar")
- ✅ **Endpoint `POST /api/notifications/process-queue`** — processa fila do cron
- ✅ **Skeleton Resend** (email) — falta só pôr a API key
- ✅ **Skeleton Z-API** (WhatsApp) — falta só pôr as credenciais

## Como o cron funciona

Todos os dias às **07:00 UTC** (08:00 PT verão / 04:00 BR), automaticamente:

1. Marca como `late` parcelas pendentes cuja data passou
2. Marca como `due_today` parcelas cuja data é hoje
3. Identifica notificações a enviar (segundo `notification_rules` de cada cliente):
   - Se cliente tem regra "5 dias antes", procura parcelas que vencem em 5 dias
4. Insere em `notification_log` com status `queued`
5. **NÃO envia ainda** — fica em fila até `process-queue` ser chamado com keys configuradas

## Configurar Resend (email)

1. Cria conta em [resend.com](https://resend.com) (free tier: 3000 emails/mês, 100/dia)
2. Verifica o domínio `vyavenaadv.com` (adicionar SPF/DKIM nos DNS — Resend dá os valores)
3. Cria uma API Key
4. Adiciona as duas variáveis em **Cloudflare Dashboard → Worker → Settings → Variables → Add**:
   - `RESEND_API_KEY` = chave do Resend (Encrypt!)
   - `RESEND_FROM_ADDRESS` = `contacto@vyavenaadv.com` (ou outro do teu domínio)
5. Re-deploy: `git commit --allow-empty -m "trigger redeploy" && git push`

## Configurar Z-API (WhatsApp)

1. Cria conta em [z-api.io](https://z-api.io) — pago, mas é a opção mais barata e simples
2. Conecta uma instância (escaneia QR code com WhatsApp Business)
3. Adiciona em Cloudflare → Worker → Settings → Variables:
   - `ZAPI_INSTANCE_ID` (Encrypt)
   - `ZAPI_INSTANCE_TOKEN` (Encrypt)
   - `ZAPI_CLIENT_TOKEN` (Encrypt — encontras em Account Security)
4. Re-deploy

## Como testar o cron manualmente

```bash
TOKEN=$(curl -s -X POST https://vyavenaadv.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"vyvian@vyvianavena.com","password":"A299792xyz!"}' \
  | jq -r .token)

# Força execução do cron diário
curl -X POST https://vyavenaadv.com/api/cron/run \
  -H "Authorization: Bearer $TOKEN" | jq

# Processar fila de envios (após configurar Resend/Z-API)
curl -X POST https://vyavenaadv.com/api/notifications/process-queue \
  -H "Authorization: Bearer $TOKEN" | jq
```

## O que ainda falta

- **R2 bucket `vyvian-recibos`** — depende de ativação manual no dashboard
- **Geração de recibos PDF** — depois do R2 estar ativo
- **Endpoint `/api/recibos/:installmentId`** — gera + armazena + retorna URL
