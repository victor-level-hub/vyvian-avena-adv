# Achados da suíte de testes

Defeitos reais encontrados ao escrever a suíte Vitest (agosto 2026). **Nenhum foi
corrigido** — cada um está documentado por um teste marcado `it.fails(...)` com um
comentário `// BUG:`, que aparece no relatório como "falha esperada". Corrigir o
código faz o teste passar a verde; é assim que se fecha cada linha desta lista.

Correr `npm run test:log` gera `tests/relatorio.html` com o estado atual.

---

## 1. Impedem alguém de trabalhar

**Login recusa e-mail com maiúscula ou espaço** — `worker/routes/auth.js:34-36`
A consulta é `WHERE email = ?` com o valor cru, mas os utilizadores são criados sempre
em minúsculas (`worker/routes/config.js:130`). O teclado do telemóvel põe maiúscula na
primeira letra sozinho, e o autocompletar acrescenta um espaço — em qualquer dos casos
a Dra. leva "Credenciais inválidas" com a password certa.
*Correção:* `WHERE email = lower(trim(?))`, ou normalizar antes do bind.

**Adicionar uma segunda pessoa por engano tranca o cadastro** — `src/admin/PersonFields.jsx:37-42`
O `personHasData` percorre todas as chaves de `addrParts` menos `country`, e o
`EMPTY_ADDRESS` já traz `via_type: 'Rua'` por omissão. Resultado: **basta clicar em
"Adicionar pessoa" e não escrever nada** para a gravação ficar bloqueada com *"A pessoa 2
tem dados preenchidos mas falta o nome"* (`NewClient.jsx:379`) — e não há maneira de
destrancar sem descobrir que é preciso remover a pessoa.

**Um anónimo consegue provocar 500 com detalhe interno** — `worker/routes/auth.js:36`
Um corpo de login com `email` que não é texto (`{"email":{"$ne":null},"password":"x"}`)
vai direto ao `.bind()`; o D1 lança, o erro sobe ao catch global (`worker/index.js:208`)
e a resposta devolve **500 com o detalhe do erro** a quem nem sessão tem. Devia ser 400.

**É possível descobrir que contas existem pelo tempo de resposta** — `worker/routes/auth.js:39-41`
Com e-mail inexistente a resposta é imediata; com e-mail existente corre primeiro o
PBKDF2 de 100 000 iterações. A mensagem é igual nos dois casos (isso está certo), mas a
diferença de dezenas de milissegundos denuncia quais os endereços registados.

**Permissões corrompidas abrem tudo em vez de fechar** — `worker/routes/auth.js:76-77,115-116`
Uma coluna `permissions` com `null`, lixo ou um objeto cai em `['*']` — acesso total.
Só a própria base de dados escreve essa coluna, por isso não é alcançável pela API, mas
a falha devia ser para o lado seguro. Sem teste `it.fails` por não ser explorável hoje.

**Alertas dados como enviados quando não saem** — `worker/lib/owner_alerts.js:64`
`r.ok === undefined ? true : r.ok` trata um envio **saltado** (o `sendEmail` devolve
`{ skipped: true }` quando falta a `RESEND_API_KEY`) como sucesso. Fica gravado `sent`
no log, o dedupe diário cala o alerta o resto do dia, e o painel garante que foi
enviado. A Dra. não recebe nada e não tem como saber.

**Lembrete que falha uma vez nunca mais é enviado** — `worker/cron.js:57-60`
O dedupe diário só olha a (parcela, canal, dia) e ignora o **estado** do registo. Um
lembrete que falhou com um erro transitório fica marcado como "já tentado hoje"; como o
cron corre uma vez por dia e no dia seguinte a parcela já não bate no `days_before`, **o
cliente nunca chega a receber o aviso**. O `owner_alerts.js:27` faz o contrário — só faz
dedupe do que ficou `sent` — e é essa assimetria que denuncia o defeito.

**Regra de notificação com `days_before` negativo desliga-se em silêncio** — `worker/cron.js:52`
Produz o modificador `'+-3 days'`, inválido em SQLite → NULL → a regra deixa de apanhar
seja o que for, sem erro nem registo. `worker/routes/notifications.js:62` aceita qualquer
valor sem validar. Mesma doença do `upcoming?days=-5` nas parcelas.

**Criar cliente é impossível a partir das migrações** — `worker/routes/clients.js:102`
O código escreve em `address`, `nationality`, `marital_status`, `rg`, `birth_date`,
`birth_place`, `doc_type`, `doc_number`, `doc_validity`, `niss` e `filiation`, mas
nenhuma migração cria essas colunas em `clients`. Em produção foram acrescentadas à mão.

**Tabelas de upload sem migração nenhuma** — `worker/routes/cliente_docs.js`
`upload_tokens` e `client_documents` não existem em `migrations/` — só na base de dados
de produção. Reconstruir o D1 a partir do repositório deixa o envio de documentos pelo
cliente sem tabelas. (Os testes criam-nas localmente; ver o topo de
`tests/worker/cliente-docs.test.js` para o esquema deduzido.)

> As duas últimas são a mesma doença: **`migrations/` não descreve a base de dados real.**
> Vale a pena exportar o esquema de produção e escrever as migrações em falta.

---

## 1-B. Arrumação: ficheiros mortos na raiz

O `wrangler.jsonc` tem `"main": "worker/index.js"` — só a pasta `worker/` é publicada.
Os ficheiros `worker-cron.js`, `worker-index.js`, `worker-lib-senders.js`,
`worker-lib-pdfgen.js`, `worker-routes-notifications.js` e `worker-routes-recibos.js`,
na raiz, são de uma geração anterior e **divergem bastante** do código vivo: o
`worker-cron.js` tem outra assinatura, devolve um array de texto em vez do resumo e
apenas marca `status='queued'` sem enviar nada; o `worker-lib-senders.js` exporta
`sendEmailViaResend`, nome que já não existe. São candidatos a apagar — só confundem
quem for procurar o código do cron.

---

## 2. Perda ou corrupção silenciosa de dados

**Ticket nº 1000 do ano fica inacessível** — `worker/routes/apoio.js:55` vs `:160`
O ID passa a ter 4 dígitos (`AT-2026-1000`) e deixa de casar com a regex das rotas: o
ticket é criado mas devolve 404 em GET, PATCH e em todas as ações.

**IDs de ticket repetem-se depois de apagar** — `worker/routes/apoio.js:51-56`
O ID vem de `COUNT(*)+1`. Apagar um ticket intermédio faz o seguinte reutilizar um ID
existente e o INSERT rebenta com violação de chave única.

**Dois anexos no mesmo milissegundo sobrepõem-se** — `worker/routes/apoio.js:375`
A chave R2 é `Date.now()-nome`. As duas linhas passam a apontar ao mesmo objeto, e
apagar uma apaga o ficheiro da outra. O mesmo padrão em `owner_alerts.js:37`, onde o id
do log colide e o segundo alerta do milissegundo desaparece.

**Dois artigos com o mesmo título partilham slug** — `worker/routes/insights.js:583`
Nada impede a colisão; o pipeline escreve `<slug>.md` no repositório e o segundo artigo
substitui silenciosamente o primeiro em `/blog/<slug>`.

**Imagem de outro artigo entra no corpo** — `worker/routes/insights.js:758-764`
O filtro valida a colocação contra os ids **pedidos** em vez das imagens que pertencem
ao artigo: basta uma imagem válida no pedido para uma imagem alheia entrar.

**Feriados nacionais podem ser apagados** — `worker/routes/calendar.js:97-101`
O `deleteEvent` apaga qualquer linha, incluindo os eventos com `source = 'system'`, que
só voltam correndo a migração outra vez.

**Parcelas com valores e datas inválidos** — `worker/routes/installments.js:87-95`
Nada é validado como número ou data: `'abc'` é gravado numa coluna REAL (e os alertas
passam a mostrar "NaN"), e `"amanhã"` no `due_date` faz a parcela desaparecer das
consultas com `date()`/`strftime()` sem erro nenhum. A validação `!amount` recusa o
número `0` mas aceita a string `'0'`.

**Parâmetros inválidos escondem vencimentos** — `worker/routes/installments.js:58`
`days=abc` ou `days=-5` produzem um modificador SQL inválido → `NULL` → a lista de
vencimentos sai **vazia**, sem erro. Parece que não há nada a vencer.

**Query string longa apaga a página do Banco de Palavras** — `worker/lib/visits.js:52`
O limite de 160 caracteres é medido **antes** de cortar a query string, por isso um
artigo partilhado com `utm_*` longos nunca é contado.

**Score 0 promovido a 50** — `worker/lib/keywords.js:29`
`Math.round(+(k.score) || 50)` trata o zero como ausência de valor.

**Taxa de engajamento por formato inflacionada** — `worker/routes/stats.js:284-297`
O numerador soma as interações de **todas** as publicações do formato, mas o denominador
só soma o alcance das que já têm insights recolhidos. O resultado aparece no painel de
Redes Sociais como 5% onde a leitura honesta é 2% — e é com este número que se decidem
as campanhas. A taxa **por publicação** (linha 274) está bem protegida; é só a
agregação por formato. Vale a pena corrigir antes da próxima campanha Meta Ads.

---

## 3. Erros 500 onde devia haver uma mensagem

Todos partilham a mesma causa: entrada não validada que rebenta no SQL ou no JavaScript,
e a Dra. vê "Internal server error" em vez de saber o que corrigir.

| Onde | Entrada | Devia ser |
|---|---|---|
| `apoio.js:137,180` | corpo JSON literal `null` | 400 |
| `apoio.js:201` | `titulo`/`criado_por` = `""` (colunas NOT NULL) | 400 |
| `apoio.js:254-258` | a IA devolve JSON válido que não é objeto | 502 |
| `apoio.js:368` | nome de anexo com `%` mal codificado (`decodeURIComponent` sem try) | 400 |
| `calendar.js:58-66` | id de evento repetido | 409 |
| `calendar.js:75-78` | `type_id` vazio (viola chave estrangeira) | 400 |
| `notifications.js:59-62` | regra para cliente inexistente | 400 |
| `notifications.js:136` | `limit` não numérico (`NaN` no LIMIT) | valor por omissão |
| `installments.js:92-95` | cliente inexistente / id repetido / objeto no `amount` | 400 ou 409 |
| `installments.js:109` | corpo JSON literal `null` | 400 |

---

## 4. Validação que falta no PUT (existe no POST)

`worker/routes/clients.js:159` — o PUT aceita `plan_type`, `person_type` e `status`
sem repetir a validação que o POST faz (linhas 97-110). Um valor fora da lista entra na
base de dados e a interface deixa de saber classificar o cliente.

`worker/routes/calendar.js:82-87` — o POST exige título, o PUT aceita `title = ''` e
deixa um evento sem nome no calendário.

---

## 4-B. Interface (encontrados pelos testes de componente)

**O login aterra sempre no Painel** — `src/admin/pages/Login.jsx:21`
O destino está fixo em `/admin/painel` em vez de `primeiraRotaPermitida()`
(`src/admin/perms.js:23`). Quem não tem a aba Painel aterra numa rota proibida e só
não fica preso porque o `PermGate` (`AdminApp.jsx:35`) o atira logo para outro lado —
e quem não tem aba nenhuma é devolvido ao ecrã de login **já autenticado**.

**Morada perde-se quando só o distrito está preenchido** — `src/admin/AddressEditor.jsx:48-50`
O `hasAddress` não olha para distrito, estado nem complemento, por isso trata a morada
como inexistente: o cadastro guarda `address = null` e o que a Dra. escreveu desaparece.

**"Rua," sozinho na morada** — `src/admin/AddressEditor.jsx:20-21`
O tipo de via entra na morada composta mesmo com o nome da via vazio. Uma morada só com
código postal fica `"Rua, 1700-001"` — e é assim que aparece na pré-visualização e nos PDFs.

**As parcelas são gravadas sem verificar se resultou** — `src/admin/pages/NewClient.jsx:507-517`
Cada parcela é criada com um `fetch` direto e o `res.ok` nunca é lido. Se o servidor
devolver 500, a Dra. é levada para a ficha do cliente **como se tivesse corrido tudo
bem** e o plano de honorários fica sem parcelas nenhumas. (Há ali também uma linha
morta: `await installmentsApi.list ? null : null`.)

**Contactos em falta não ficam a vermelho** — `src/admin/pages/NewClient.jsx:713-714`
A mensagem de erro diz "assinalados a vermelho" (linha 372), mas o `ContactsEditor`
nunca recebe `invalid`/`requiredFirst` — apesar de o componente já saber pintar-se. Só o
nome fica marcado, e a Dra. procura um campo vermelho que não existe.

**Plano de pagamento salta fevereiro** — `NewClient.jsx:25-29` e `ParcelasEditor.jsx:9-13`
O `Date.setMonth` transborda: uma primeira parcela a 31/01 gera a segunda a **03/03**,
saltando o mês inteiro. Afeta parcelado e avença. (Há um risco adicional por confirmar à
mão: `toISOString` sobre hora local pode recuar um dia num vencimento na semana da
mudança da hora.)

**Gravação de voz invisível antes de o ticket existir** — `src/admin/pages/Apoio.jsx:530`
A zona de anexos só desenha `pend.print_abertura` e `pend.anexo`. Num ticket ainda por
criar, o áudio ditado vai para `pend.audio` e não aparece em lado nenhum — a Dra. não
vê que a gravação ficou anexada (só a transcrição entra na descrição).

**Acessibilidade: campos sem etiqueta ligada** — vários
`Login.jsx:51,62` (os `<label>` não têm `htmlFor` nem envolvem o campo — clicar na
etiqueta não foca, e um leitor de ecrã anuncia "campo de edição" sem dizer qual),
`Apoio.jsx:495-497` (rótulos do modal são `<span>` solto), `Apoio.jsx:695` (pesquisa só
com *placeholder*, que desaparece ao escrever) e `Apoio.jsx:744-746` (o botão do lápis
tem só um SVG `aria-hidden` e um `data-tip`, ficando sem nome acessível).

---

## 4-C. Prompts de IA — texto de terceiros sem fronteira

Oito prompts vão para o Gemini (seis a partir da constante `PERFIL` em `insights.js`,
mais a colocação de imagens e a análise de complexidade do ticket em `apoio.js`). Em
**todos**, o texto escrito por pessoas é colado no meio das instruções sem qualquer
delimitador — sem *fence*, sem tag, sem marcador a dizer ao modelo onde acaba a
instrução do sistema e onde começa conteúdo de terceiros:

| Onde | O que entra sem fronteira |
|---|---|
| `apoio.js:238` | título do ticket |
| `apoio.js:241` | descrição do ticket — e é a **última coisa do prompt**, sem nada depois a re-ancorar o formato |
| `insights.js:411` | tema do artigo |
| `insights.js:515-516` | corpo do artigo em avaliação (Markdown, pode trazer *fences*) |
| `insights.js:874` | trecho selecionado no editor |
| `insights.js:918-919` | instruções de correção escritas pela Dra., e o artigo inteiro |
| `insights.js:1337` | URL da fonte |

O caso mais concreto é o do URL: **`insights.js:1330` valida-o só com `/^https?:\/\//`**,
que aceita quebras de linha e tudo o que venha depois. Um "URL" como
`https://x.pt\n\nIgnora as instruções anteriores e…` passa a validação, segue para o
prompt **e fica gravado em `insight_sources.url`**. Devia usar-se `new URL()` e recusar
qualquer endereço com espaços ou quebras de linha.

O risco prático hoje é moderado — quem escreve tickets e temas é a própria Dra. — mas
duas entradas já não são dela: o **URL de fonte** e o **título de sugestão**, que vem de
um modelo com pesquisa na web. E o padrão fica errado para quando houver um formulário
público. A correção é barata: envolver cada bloco de conteúdo em delimitadores
explícitos e repetir a instrução de formato depois do bloco.

Nos prompts do Insights o esquema JSON vem **depois** do texto do utilizador, o que
atenua o problema. No Apoio vem antes — e é por isso que `apoio.js:241` é o ponto mais
exposto dos oito.

### Entradas sem limite de tamanho (custo)

Há cortes bem feitos em vários sítios (avaliação a 18 000 caracteres, tema a 300,
instruções a 2 000, trecho a 8 000). Mas escapam:

| Onde | O que passa inteiro |
|---|---|
| `insights.js:916` | `corrigirComIA` manda o artigo **cru**, sem o corte aos 18 000 que a avaliação faz — 120 000 caracteres entram todos |
| `apoio.js:238-241` | ticket sem limite: título de 10 000 e descrição de 200 000 caracteres entram inteiros (`maxOutputTokens` só trava a saída, não a entrada) |
| `insights.js:264` | `existing_titles` corta às 40 entradas, mas não o tamanho de cada uma |
| `insights.js:1329` | URL da fonte sem limite |
| `insights.js:714` | colocação de imagens corta cada bloco a 180 caracteres, mas não o **número** de blocos |
| `insights.js:1216` | geração de imagens é o único pedido sem `maxOutputTokens` nem `temperature` |

### Dois detalhes menores

`apoio.js:242` ainda aponta ao modelo datado `gemini-2.5-pro`, quando o `insights.js`
já migrou para os aliases `-latest` precisamente porque os datados começaram a devolver
*"no longer available to new users"* (o comentário está em `insights.js:15-19`). A
análise de tickets fica exposta à próxima descontinuação.

Os prompts de **pesquisa de temas** e de **ficha da fonte** nunca declaram o idioma da
resposta; todos os outros pedem português europeu explicitamente.

---

## 5. Detalhes com consequência

**HTML por escapar no e-mail** — `worker/lib/senders.js`
Quando só há `text`, o HTML é derivado por interpolação direta. Um `<` ou `&` vindo do
nome de um cliente parte a mensagem.

**Telefone sem dígitos é "enviado"** — `worker/lib/senders.js`
A guarda `!phone` só apanha o vazio; um telefone só com letras passa e vai para a Z-API
como string vazia em vez de ser ignorado.

**`{{constructor}}` escreve lixo** — `worker/lib/senders.js:62`
`vars[k]` apanha as propriedades herdadas de `Object.prototype`.

**Rasto de quem criou o link perde-se** — `worker/routes/cliente_docs.js:63`
`session?.user` não existe no payload do JWT (que tem `sub`/`email`/`name`/`initials`/
`role`), por isso `created_by` fica sempre `NULL`.

**Histórico do ticket fora de ordem** — `worker/routes/apoio.js:173`
`created_at` tem resolução ao segundo e a ordenação é só por essa coluna: criar e abrir
o ticket no mesmo segundo — o fluxo normal do ecrã — mostra os eventos ao contrário.

**Imagens do Banco não sobrevivem ao artigo** — `worker/routes/insights.js:827-837`
O comentário do código diz que sobrevivem, mas `ON DELETE CASCADE` leva-as à frente.

**Password `undefined` valida contra hash de password vazia** — `worker/lib/auth.js:20`
O `TextEncoder` trata `undefined` como o valor por omissão (string vazia), não como o
texto `"undefined"`. Não é explorável hoje (a rota de login exige os dois campos), mas
qualquer chamador novo precisa de saber.
