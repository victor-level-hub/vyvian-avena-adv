# Testes — Vyvian Avena Advogada

Suíte em [Vitest](https://vitest.dev). Objetivo: **esfolar** as funcionalidades da
Área Privada antes de a Dra. lhes tocar — caminhos felizes, erros, limites e abusos.

```bash
npm test              # corre tudo
npm run test:watch    # re-corre ao guardar
npm run test:log      # grava o log completo em tests/ULTIMO-LOG.txt
```

## Harness (`tests/helpers/`)

### `criarEnv(extra)` → env do Worker

```js
const env = criarEnv();                    // DB, RECIBOS (R2), SESSIONS (KV), AI, segredos
const env = criarEnv({ AI: undefined });   // simular binding em falta
const env = criarEnv({ GEMINI_API_KEY: '' });
```

### `env.DB` — `FakeD1`, SQLite **real** (`node:sqlite`)

Todas as migrações de `migrations/` são aplicadas. O SQL corre a sério: uma coluna
inexistente, um `NOT NULL` violado ou uma chave estrangeira partida **rebentam o teste**.

API igual à do D1: `prepare(sql).bind(...).first() | .all() | .run()`, `batch([...])`.
`all()` devolve `{ results }`. `RETURNING *` funciona.

Atalhos só para testes:

```js
db.linha('SELECT * FROM tickets WHERE id = ?', 'AT-2026-001')
db.linhas('SELECT * FROM ticket_log ORDER BY id')
db.conta('tickets', "status = 'aberto'")
db.exec('...')          // SQL cru (semear dados)
db.queries              // histórico de SQL emitido
```

### `env.RECIBOS` — `FakeR2`

`put(key, value, { httpMetadata })`, `get(key)` → `{ body, arrayBuffer(), httpMetadata }` ou `null`,
`delete(key)`, `list()`. `r2.store` é o Map por baixo. `r2.falhaNoPut = 'mensagem'` força erro.

### `env.SESSIONS` — `FakeKV`

`get(key)`, `get(key, 'json')`, `put`, `delete`. `kv.puts` regista as escritas.

### `env.AI` — `FakeAI`

`new FakeAI({ text: 'olá' })`, ou uma função `(modelo, args) => resposta`, ou um
`Error` para simular falha. `ai.chamadas` regista as invocações.

### Pedidos e respostas

```js
req('POST', '/api/apoio/tickets', { body: { titulo: 'x' } })
req('POST', '/api/apoio/tickets/AT-2026-001/anexos?tipo=audio&nome=a.webm',
    { binario: bytes, headers: { 'Content-Type': 'audio/webm' } })
await json(res)   // corpo JSON; nunca rebenta (devolve { __texto } se não for JSON)
```

### `fetch` controlado

```js
vi.stubGlobal('fetch', mockFetch([{ json: { id: 'x' } }, { status: 502, texto: 'boom' }]));
vi.stubGlobal('fetch', mockFetch((url) => url.includes('resend') ? { json: {} } : { status: 404 }));
geminiJson({ complexidade: 'alta' })   // resposta do Gemini já no formato certo
```

Repor sempre no fim: `afterEach(() => vi.unstubAllGlobals())`.

**A rede está fechada por omissão** (`tests/setup.js`): um teste que chegue ao `fetch`
sem o ter mockado falha com "Chamada de rede não mockada". É de propósito — sem isto,
um teste distraído bate mesmo na API do Gemini ou chega a enviar um e-mail a sério.

## Convenções

- Nomes de teste em português, a descrever **comportamento** ("recusa ticket sem título"),
  não implementação.
- Um `describe` por endpoint/função; `it` curto e com uma asserção clara.
- Defeitos reais encontrados ficam marcados com `// BUG:` e `it.fails(...)` — aparecem
  no log sem partir a suíte.
