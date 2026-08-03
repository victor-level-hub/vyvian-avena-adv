# Achados da suíte de testes

Defeitos reais encontrados ao escrever a suíte Vitest (agosto 2026). Os que ainda estão
por corrigir têm um teste marcado `it.fails(...)` com um comentário `// BUG:`, que
aparece no relatório como "falha esperada". **Corrigir o código faz esse teste passar a
verde — e é assim que se fecha cada linha desta lista**: o teste deixa de ser `it.fails`,
passa a teste normal, e a partir daí protege contra a regressão.

Correr `npm run test:log` gera `tests/relatorio.html` com o estado atual.

---

## ✅ Já corrigidos

Quatro entradas saíram da lista. Em cada uma, o teste que a documentava passou de
`it.fails` a teste normal — é isso que prova a correção, e é isso que impede a
regressão.

| O quê | Onde | Correção |
|---|---|---|
| Parcelas gravadas sem verificar o resultado | `NewClient.jsx:507` | passou a usar `installmentsApi.create` (que lança) e a mensagem diz que o cliente ficou criado mas o plano não |
| Adicionar pessoa por engano trancava o cadastro | `PersonFields.jsx:37` | `personHasData` só conta o que difere do valor por omissão (o `via_type: 'Rua'` deixou de contar) |
| Lembrete que falha uma vez nunca mais era enviado | `cron.js:57` | o dedupe passou a exigir `status = 'sent'`, como o `owner_alerts.js` já fazia |
| URL de fonte aceitava quebras de linha | `insights.js:1330` | passa por `new URL()` e recusa espaços, quebras de linha e `< > "` |

---

## 1. Impedem alguém de trabalhar

**Login recusa e-mail com maiúscula ou espaço** — `worker/routes/auth.js:34-36`
A consulta é `WHERE email = ?` com o valor cru, mas os utilizadores são criados sempre
em minúsculas (`worker/routes/config.js:130`). O teclado do telemóvel põe maiúscula na
primeira letra sozinho, e o autocompletar acrescenta um espaço — em qualquer dos casos
a Dra. leva "Credenciais inválidas" com a password certa.
*Correção:* `WHERE email = lower(trim(?))`, ou normalizar antes do bind.

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

## 1-A. O site público inteiro em branco no Safari com cookies bloqueados

**`src/components/CookieBanner.jsx:13`** lê o `localStorage` sem `try/catch`. No Safari
com cookies bloqueados (e em navegação privada de alguns browsers) o `getItem` atira
`SecurityError` — e como o banner vive dentro do `Layout`, **o site inteiro deixa de
renderizar**. Não é o banner que falha: é tudo. O `analytics.js` (`readConsent`) já faz
esta mesma leitura protegida, portanto a correção é copiar o que está ao lado.

**`src/components/ScrollReveal.jsx:13`** tem o mesmo tipo de risco: `new
IntersectionObserver` sem guarda de suporte. Num browser sem a API, atira `ReferenceError`
e a árvore desmonta — página em branco, pior do que simplesmente não animar.

---

## 1-B. SEO e consentimento

**O JSON-LD não escapa `</script>`** — `src/components/Seo.jsx:114`
Um título de artigo ou uma resposta de FAQ que contenha essa sequência fecha o
`<script>` a meio: o bloco deixa de fazer parse — é exatamente a falha "JSON-LD inválido"
que o `scripts/seo-check.mjs` procura — e o resto do JSON passa a **texto visível na
página**.

**Sem `path`, o canónico fica `https://vyavenaadv.comundefined`** — `src/components/Seo.jsx:79`
Hoje nenhuma página omite o prop, mas uma rota nova que se esqueça dele passa
despercebida e publica um canónico inválido.

**Os interruptores de preferências de cookies não funcionam por teclado** — `src/components/CookieBanner.jsx:99`
São `<div>` com `onClick`, sem `role`, sem `tabIndex` e sem tratamento de teclas. Quem
navega só por teclado ou com leitor de ecrã fica reduzido a "aceitar tudo" ou "só
essenciais", sem escolha granular. Num consentimento RGPD, no site de uma advogada, é o
mais sensível desta lista.

**A Política de Cookies é uma página órfã** — `src/components/Footer.jsx`
É indexável e entra no sitemap, mas o único caminho para lá num ecrã com Layout é o
banner — que desaparece assim que o visitante decide. A `/links` tem a ligação; o rodapé
não. Resultado: mal rastreada pelos motores de busca, e inacessível a quem já consentiu.

> Confirmado como **correto** pelos testes: recusar cookies nunca ativa a analítica nem
> injeta o `gtag.js`, e sem consentimento nenhum evento faz pedidos de rede.

---

## 1-C. Ecrãs que vão abaixo com um único registo estranho

Todos partilham a mesma causa: um campo em falta ou ilegível usado sem defesa, num
sítio por onde passa a lista inteira. Não é um aviso na consola — é a página em branco.

**Um cliente sem nome parte a pesquisa e a ordenação** — `src/admin/pages/Clients.jsx:130,142`
`c.name.toLowerCase()` na pesquisa e `a.name.localeCompare(...)` na ordenação não têm
`|| ''` (o e-mail, o NIF e os nomes extra têm). Basta escrever uma letra na pesquisa, ou
clicar na coluna «Cliente», para o ecrã cair.

**Uma parcela sem data de vencimento parte o ecrã das parcelas** — `src/admin/pages/Installments.jsx:134,145`
`i.due_date.slice(0, 7)` corre antes de qualquer filtro, por isso a lista nem chega a
desenhar-se. Liga-se ao defeito do backend que aceita gravar `due_date` inválido.

**Não há, em lado nenhum, forma de marcar uma parcela como paga**
— `src/admin/pages/Installments.jsx:110-123` **e** `src/admin/pages/ClientDetail.jsx:524`

Este é o achado mais sério do lote, e só se vê juntando as duas suítes. Nos **dois**
ecrãs o `handleMarkPaid` existe, completo, com confirmação, chamada à API e
recarregamento — e nos dois **nenhum botão o chama**. Na listagem, o redesenho v3 pôs a
coluna «Lembrete» onde estava a ação; na ficha, a coluna de ações só tem
Anexar/Ver/Remover documentos.

O único caminho que resta é **anexar o PDF do recibo**, porque anexar um Recibo ou
Fatura-Recibo marca a parcela como paga. Quem recebeu por transferência e ainda não
emitiu o recibo na AT não tem como registar o pagamento. O código está lá inteiro nos
dois sítios: é ligar um botão, ou decidir apagá-lo.

**Também não há forma de enviar o recibo ao cliente** — `src/admin/pages/ClientDetail.jsx:629`
O `handleSendRecibo` é código morto e a API existe e está exposta
(`apiClient.js:288`, `recibos.sendToClient`) — e tem testes de backend a passar
(`tests/worker/recibos.test.js`). Falta só o botão.

**Guardar o plano não grava o tipo de plano** — `src/admin/pages/ClientDetail.jsx:757-761`
O `handleSavePlan` envia `honorarios_total`, `honorarios_parcelas` e
`contract_start_date`, mas não o `plan_type`. Como a leitura dá prioridade ao valor
gravado (linha 1101), um cliente em avença que passe a parcelado **continua a ser lido
como avença**: a ficha mostra "Avença mensal" e "N meses ativo" em vez de Total
contratado / Em aberto / Progresso. O `PUT /api/clients` já aceita o campo
(`worker/routes/clients.js:159`) — é uma linha em falta.

**Números e datas ilegíveis mostrados em cru** — `Clients.jsx:37,38,53` e `Installments.jsx:15,18-21,155`
`€ NaN` na coluna do valor, `Invalid Date` (em inglês) na do vencimento, e o selo de
atraso a dizer **`NaND ATRASO`**. Pior: no cartão «Previsto» o total usa `Number()` cru e
mostra `NaN`, enquanto o subtítulo, que passa pelo formatador, mostra `€ 0` — dois sítios
do mesmo ecrã a dizer coisas diferentes.

---

## 1-D. O seletor de datas leva a página à frente

**Uma data mal formada rebenta o ecrã inteiro** — `src/admin/datepicker.jsx:52,72`
Abrir o calendário com um `value` que não seja ISO faz `new Date('lixoT00:00:00')` →
`Invalid Date` → `view = { y: NaN, m: NaN }` → `Array(NaN)` → **`RangeError: Invalid
array length`** durante o render. Não é um aviso na consola: é a página em branco.
Devia cair no mês de hoje, como já faz quando o valor está vazio. E como o
`installments.js` aceita gravar `due_date` inválido (ver secção 2), o valor mau pode vir
mesmo da base de dados.

**Redimensionar a janela deixa o calendário a flutuar** — `src/admin/datepicker.jsx:30,34`
O mesmo handler serve `scroll` e `resize`, mas no `resize` o `e.target` é a `window`, que
não é um nó do DOM: `ref.current.contains(window)` atira `TypeError` e o fecho nunca
corre. Como o popover é `position: fixed` com coordenadas já calculadas, fica fora do
campo. Acontece num browser a sério, não é artefacto do jsdom.

**Data mal formada aparece como `undefined/undefined/2026/07/14`** — `src/admin/datepicker.jsx:16`
O `fmtShow` não valida o que recebe.

**Estúdio de artigos preso no esqueleto para sempre** — `src/admin/insights/InsightsSection.jsx:419,575`
O `carregar()` do Banco de Imagens e o do diretório de Fontes só fazem um aviso no
`catch` e deixam o estado a `null`. Com a API em baixo, o ecrã fica **eternamente no
esqueleto de carregamento** — sem erro visível e sem forma de tentar de novo. O
`BancoPicker` do estúdio (`ArticleStudio.jsx:1216`) trata o mesmo caso com `setItens([])`,
por isso a intenção está provada: falta aqui.

---

## 1-E. Gestão de utilizadores

**Falha da foto esconde que o utilizador já foi criado** — `src/admin/pages/Configuracoes.jsx:94-95`
O `uploadFoto` corre dentro do mesmo `try` do `createUser`. Se a foto falhar, a conta já
existe e o convite já seguiu, mas o ecrã só diz «Erro:», não fecha o modal nem recarrega
a lista. A Dra. carrega outra vez em «Criar» e leva um «e-mail duplicado» sem perceber
porquê.

**Mudar as próprias permissões não atualiza a sessão** — `src/admin/pages/Configuracoes.jsx:89-101`
Depois de se despromover, o `sessionStorage` continua com `['*']`: o menu continua a
mostrar abas a que já não tem acesso. O servidor recusa, mas **a interface mente** até
sair e voltar a entrar.

**«Reenviar convite» sem trava** — `src/admin/pages/Configuracoes.jsx:219-224`
Dois cliques geram dois tokens, e o link do primeiro e-mail — que a pessoa pode já ter
aberto — morre em silêncio.

**Botões de editar e apagar sem nome acessível** — `src/admin/pages/Configuracoes.jsx:270-282`
Só têm ícone `aria-hidden` e `data-tip`, num ecrã onde um deles apaga um utilizador. O
`ModalClose` do mesmo projeto usa `aria-label`, portanto é esquecimento, não convenção.

> Nota de âmbito: este ecrã é só gestão de utilizadores e permissões. As preferências de
> alertas e os templates vivem na aba Notificações, e as chaves de API são segredos do
> Worker — nunca chegam ao browser. A suíte prova isso: injeta `password_hash`,
> `invite_token` e chaves na resposta da API e confirma que nada disso chega ao DOM.

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

**€1200,50 gravado como €1,20 no calendário** — `src/admin/pages/Calendar.jsx:353`
`String(f.amount).replace(',', '.')` só troca a primeira vírgula e não tira o ponto dos
milhares: `1.200,50` vira `parseFloat("1.200.50")` = **1.2**. O evento fica gravado com
um valor mil vezes menor. (O `parseValor` do `ParcelasEditor` tem o mesmo defeito de
origem, mas ali os valores raramente levam separador de milhares.)

**Navegar no calendário salta um mês** — `src/admin/pages/Calendar.jsx:316`
`d.setMonth(d.getMonth() + dir)` num dia 31 transborda: 31 de agosto + 1 mês = 1 de
outubro, e setembro desaparece. Reproduzível pelo ecrã: vista de dia até ao dia 31,
voltar a mês, avançar. É a mesma família do salto de fevereiro no plano de pagamento.

**«+-2,4%» no crescimento de seguidores** — `src/admin/pages/Statistics.jsx:374`
O `+` está fixo no JSX e o valor já traz o próprio sinal. Sempre que a conta perde
seguidores no período — situação normal — o selo sai com os dois sinais.

**Dinheiro em formato inglês** — `src/admin/pages/Calendar.jsx:26`
O modo compacto produz `€ 1.2k` num ecrã todo em português, onde `1.200` se lê como mil
e duzentos. Ambíguo, e sobre dinheiro.

**Emojis coloridos no painel** — `src/admin/pages/Dashboard.jsx:80,152`
«Sem atrasos 🌿» — contra a regra do projeto de usar só glifos e SVGs monocromáticos.

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

### Acessibilidade: um padrão, não casos isolados

Quatro suítes independentes encontraram a mesma falha, o que faz disto um hábito do
código e não um esquecimento pontual. **Nenhum formulário do projeto liga as etiquetas
aos campos**, e vários botões só de ícone ficam sem nome acessível:

| Onde | O quê |
|---|---|
| `Contacto.jsx:68-131` | os cinco `<label>` do formulário público — nome, e-mail, mensagem, área — sem `htmlFor`, e os campos sem `id` nem `aria-label` |
| `Login.jsx:51,62` | idem; clicar na etiqueta nem sequer foca o campo |
| `Apoio.jsx:495-497` | rótulos do modal são `<span>` solto |
| `Apoio.jsx:695` | pesquisa só com *placeholder*, que desaparece ao escrever |
| `Apoio.jsx:744-746` | botão do lápis: só SVG `aria-hidden` + `data-tip` (que só serve o rato) |
| `Configuracoes.jsx:270-282` | editar/apagar/expandir sem nome — e um deles apaga um utilizador |
| `Calendar.jsx:531,533` | período anterior/seguinte anunciados só como «botão» |

O texto das etiquetas está lá e está correto; falta só a associação. É barato de corrigir
(um `id` e um `htmlFor` por campo, um `aria-label` por botão de ícone) e vale a pena
fazê-lo de uma vez, com um teste por formulário a exigir `getByLabelText`.

O `ModalClose` do próprio projeto já usa `aria-label` — portanto é esquecimento, não
convenção.

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
