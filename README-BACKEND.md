# Vyvian Avena Advogada — Backend Fase 1

Pacote para integrar **API real** (Cloudflare Workers + D1 + KV) no projeto existente.

## ✅ O que já está provisionado em produção

| Recurso | Nome | ID |
|---|---|---|
| D1 Database | `vyvian-avena-db` | `49e587e4-cb1c-486e-ab7a-cf2907fff09e` |
| KV Namespace | `vyvian-sessions` | `c5cbf662e3334190ab02959a41d12783` |
| Worker | `vyvian-avena-adv` (existente) | já no Cloudflare |

A base de dados já contém:
- 1 utilizador (Vyvian, senha `A299792xyz!` em PBKDF2-SHA256)
- 9 clientes
- 59 parcelas
- 13 regras de notificação
- 4 templates de mensagens

## 📋 Passo a passo de instalação

### 1. Copiar ficheiros para o projeto

Descompacta o ZIP. Copia para `C:\Users\victor.sousa\Projetos\vyvian-avena-adv\`:

```
worker/                       (pasta NOVA — código do Worker)
├── index.js
├── lib/auth.js
├── lib/response.js
└── routes/{auth,clients,installments,notifications,dashboard}.js

migrations/                   (pasta NOVA — histórico do schema)
└── 0001_initial_schema.sql

wrangler.jsonc                (SUBSTITUIR o existente)

src/admin/apiClient.js        (NOVO)
src/admin/auth.js             (SUBSTITUIR)
src/admin/AdminApp.jsx        (igual — mantém-se)
src/admin/Sidebar.jsx         (SUBSTITUIR — logout agora async)
src/admin/pages/Login.jsx           (SUBSTITUIR)
src/admin/pages/Dashboard.jsx       (SUBSTITUIR)
src/admin/pages/Clients.jsx         (SUBSTITUIR)
src/admin/pages/ClientDetail.jsx    (SUBSTITUIR)
src/admin/pages/NewClient.jsx       (SUBSTITUIR)
src/admin/pages/Calendar.jsx        (SUBSTITUIR)
src/admin/pages/Installments.jsx    (SUBSTITUIR)
src/admin/pages/Notifications.jsx   (SUBSTITUIR)
```

### 2. Apagar o mockData.js (opcional)

O ficheiro `src/admin/mockData.js` já não é usado. Pode ser apagado.

```powershell
Remove-Item src/admin/mockData.js
```

### 3. Build + commit + push

```powershell
cd C:\Users\victor.sousa\Projetos\vyvian-avena-adv
npm run build
git add .
git commit -m "feat: backend API real (Workers + D1 + KV + JWT auth)"
git push
```

Cloudflare deteta o push e faz auto-deploy do Worker com bindings (D1 + KV + Assets).

### 4. Testar

Aguarda ~2 min e abre [https://vyavenaadv.com/admin/login](https://vyavenaadv.com/admin/login):

- E-mail: `vyvian@vyvianavena.com`
- Senha: `A299792xyz!`

Deve entrar no painel. Se vires erros, verifica:

- `Failed to fetch` → Worker ainda não acabou de fazer deploy
- `Unauthorized` → token JWT inválido, fazer logout + login
- `Internal server error` → checa logs no Cloudflare dashboard → Worker → Logs

## 🔐 Segurança — pontos importantes

**JWT secret está em `vars` no `wrangler.jsonc`** (em vez de Cloudflare Secrets). Não é prática ideal mas funciona para já:

- Vantagens: simples de gerir, faz parte do commit, fácil de rotacionar
- Desvantagens: visível no histórico do repo (mesmo sendo privado)

**Para rotacionar o secret** (recomendado a cada ~6 meses ou em caso de leak):

1. Gera novo secret: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
2. Substitui o valor em `wrangler.jsonc`
3. Commit + push
4. Todas as sessões ativas ficam invalidadas (utilizadores precisam de fazer login outra vez)

**Para mudar a senha da Vyvian:**

```python
# Gera novo hash
import hashlib, secrets, base64
password = 'NOVA_SENHA'
salt = secrets.token_bytes(16)
dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100_000, dklen=32)
print(f"pbkdf2-sha256$100000${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}")
```

Depois via Cloudflare dashboard → D1 → vyvian-avena-db → Console:
```sql
UPDATE users SET password_hash = 'PBKDF2_HASH_AQUI' WHERE email = 'vyvian@vyvianavena.com';
```

## 📡 API endpoints

Todos os endpoints (exceto `/api/auth/login`) exigem header:
`Authorization: Bearer <token>`

| Método | Path | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login (body: `{email, password}`) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Sessão atual |
| GET | `/api/dashboard` | KPIs + próximos vencimentos + alertas |
| GET | `/api/clients` | Lista clientes (filtros: country, status, search) |
| GET | `/api/clients/:id` | Cliente + parcelas + regras |
| POST | `/api/clients` | Criar cliente |
| PUT | `/api/clients/:id` | Editar cliente |
| DELETE | `/api/clients/:id` | Apagar cliente (cascade) |
| GET | `/api/installments` | Lista parcelas (filtros: status, client_id, month, year) |
| GET | `/api/installments/upcoming?days=30` | Próximos vencimentos |
| GET | `/api/installments/:id` | Parcela com dados do cliente |
| POST | `/api/installments` | Criar parcela |
| PATCH | `/api/installments/:id` | Atualizar (ou `{action:"mark_paid"}`) |
| DELETE | `/api/installments/:id` | Apagar parcela |
| GET | `/api/notifications/rules` | Lista regras (filtro: client_id) |
| POST | `/api/notifications/rules` | Criar regra |
| PATCH | `/api/notifications/rules/:id` | Toggle/editar regra |
| DELETE | `/api/notifications/rules/:id` | Apagar regra |
| GET | `/api/notifications/templates` | Lista templates |
| GET | `/api/notifications/templates/:id` | Template por ID |
| PUT | `/api/notifications/templates/:id` | Editar template |
| GET | `/api/notifications/log?limit=50` | Histórico de envios |

## 🔮 Próximas fases

- **R2** (recibos PDF) — precisa de ativação manual no Cloudflare dashboard
- **Cron trigger** diário (verificar vencimentos, gerar notification_log)
- **Resend** (envio de emails reais)
- **Z-API** (WhatsApp)
- **Geração de recibos PDF** com pdf-lib em Worker
