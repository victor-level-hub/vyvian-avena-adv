# TODO — Site Vyvian Avena (vyavenaadv.com)
*Espelho do doc `claude/TODO.md` do projeto claude.ai · atualizado a 24 jul 2026*
*Regra: quem concluir/criar tarefas atualiza AMBOS (este ficheiro e o doc do projeto).*

## Regras de qualidade (aprendidas — aplicar SEMPRE)

- **27 jul 2026 · campos de escrita:** nunca deixar um campo de entrada sem cursor (caret) visível e sem foco garantido. Todo o input/textarea tem `caret-color` explícito e, em diálogos modais, o campo força e recupera o foco — o TipTap/ProseMirror rouba o teclado se o deixarem (diálogos emitem `adm-dialog-open/close` e o RichEditor desativa-se enquanto houver diálogo aberto).

- **27 jul 2026 · tooltips:** NUNCA usar o tooltip padrão do browser (atributo `title`) — sempre o tooltip do site (TipLayer em `rs/ui.jsx`): elementos usam `data-tip`, a camada é um portal em `document.body` que herda o tema light/dark do `.rs-scope` de origem e prende a caixa aos limites da janela — um tooltip NUNCA pode sair cortado (cuidado com `overflow` de invólucros).

## Prioridade alta (código)

- [ ] **PDF do plano de pagamento** no formato padrão da Dra. Vyvian, com envio automático ao cliente (área privada).
- [ ] **Filtro na lista de clientes** (área privada).

## Desenvolvimento — próximos

- [ ] **Títulos do blogue >60 caracteres** — aplicar os 4 títulos novos depois da aprovação da Dra.

## Ações do Victor / da Dra. (não é código)

- [ ] Victor: `git pull` em `C:\Users\victor.sousa\Projetos\vyvian-avena-adv` para trazer `134dd49`…HEAD (ver git log) (redesign, filtros, lightbox, marca de água, tema livre, fotos no corpo, Banco de Imagens).
- [ ] Victor (opcional): `IG_SYNC_KEY` foi rodada na integração da Fase B e o valor não ficou guardado. O cron diário não a usa; só serve para forçar uma sincronização manual. Repor com `npx wrangler secret put IG_SYNC_KEY < ficheiro.txt` (e apagar o ficheiro a seguir).
- [ ] Dra.: experimentar as abas **Insights** e **Instagram** e dar feedback.
- [ ] Victor: **créditos Recraft quase no fim (~40)** — fallback de imagem; recarregar se quiser manter o plano B.
- [ ] Dra.: aprovar os 4 títulos novos do blogue.
- [ ] Registos em diretórios (OA → Consulto → Lawzana → Jusbrasil → EscolherAdvogado), 1–2 por semana.

## Concluídas recentemente

- 27 jul 2026 — **Banco de Imagens v3** (`be2d716`): sem duplicados — «Usar imagem do banco» recusa imagens que já estão nas opções do artigo (origem na ronda atual ou cópia existente) e o modal esmaece-as com o selo «NO ARTIGO»; blockquote do editor legível no tema dark (`8368f11`).
- 27 jul 2026 — **Banco de Imagens v2** (`082cf63`): remover do banco apaga o ficheiro do R2 quando a imagem já não está em uso em nenhum artigo (capa/corpo/opções atuais — senão mantém-se e o toast explica); botão «Usar imagem do banco» no editor abre modal com as guardadas, seleção múltipla e «Adicionar N no artigo» (cópia R2 com chave determinística — sem duplicados na ronda).
- 27 jul 2026 — **Banco de Imagens** (`0fb59e9`): nova vista «IMAGENS» na pílula do Insights com as imagens guardadas pela Dra. (data, artigo de origem, ampliação, remoção); botão «Salvar imagens» na sidebar do editor (abaixo de «Ver ampliadas», usa a seleção «+») e «Salvar imagem» no lightbox; duplicados detetados pelo ID («Imagem salva com sucesso.» / «Esta imagem já foi salva no dia X.»); tabela D1 `image_bank` (migração 0019) e endpoints `/api/insights/banco`.
- 27 jul 2026 — **Tema livre, fotos no corpo do artigo e fix definitivo do cursor** (`196e512`, `500b413`): vista «TEMA LIVRE» (a Dra. escreve o assunto → artigo no editor; lista de anteriores), fotos marcadas com «+» inseridas pela IA após o parágrafo mais relacionado (TipTap com Image; imagens públicas em GET), e caret dourado + editor desativado durante diálogos (causa-raiz do campo «não editável»).
- 25 jul 2026 — **Insights: campo «Correções de imagem»**: a Dra. aponta erros grotescos das imagens (ex.: ecrã do telemóvel ao contrário) na sidebar do editor ou no botão «Reportar erro» do lightbox; cada nota vira regra permanente injetada no prompt de todas as gerações seguintes (KV, endpoints /api/insights/image-rules). Primeira regra registada: ecrã do telemóvel virado para quem o segura.
- 25 jul 2026 — **Insights: lightbox das capas + marca de água com o favicon** (`da9dc7b`): ampliação a ecrã inteiro com setas/teclado/swipe, miniaturas e «Usar como capa»; marca de água no padrão do blogue (logo-coluna, canto inferior direito, dourado/verde conforme o canto) composta no browser e gravada no R2 via novo `PUT /api/insights/images/:id` — aplicada automaticamente a cada geração e retroativamente às 4 imagens do artigo de teste. Prompt de imagem corrigido: ecrãs de telemóvel virados para quem os usa.
- 25 jul 2026 — **Filtros de período e agrupamento nas Redes Sociais** (`eb0634a`): períodos 1/7/15/30/60/90/120 dias, «Agrupar por» dias · semanas · meses (soma p/ visitas e curtidas, último valor p/ seguidores, diferença p/ novos), legenda do filtro em chip, rótulos do eixo Y nas linhas-guia e legenda «Eixo X / Eixo Y» em todos os gráficos e sparklines das abas Instagram e Site.
- 25 jul 2026 — **Redesign visual do menu Redes Sociais** em produção (`ee52dca`), a partir do pack «Vyvian Avena Design System v3» do Claude Design: secção escura por defeito com modo claro, fundo vivo (auroras + spotlight), abas tubelight, bento com KPIs animados, gráficos novos, grelha Instagram com tilt/focus, cartões de tema com score em gradiente, StepLoader narrado nos 3 fluxos lentos + confetti, Fontes com AI-input e barras de nível, editor e pré-visualização re-skinnados (contraste AA por construção). Endpoints e fluxos inalterados.
- 24 jul 2026 — **Redes Sociais: teste ponta-a-ponta autenticado** das duas abas novas, em produção. Instagram (KPIs, gráfico, grelha) e Insights (Atualizar → 10 temas com fontes cruzadas → gerar artigo → 4 imagens → capa → pré-visualizar → Fontes com adição por link) verificados. Dois defeitos encontrados e corrigidos (`79500da`): tags `<cite>` da pesquisa web a passarem para o artigo (itálico na pré-visualização) e contraste do título do herói na pré-visualização.
- 24 jul 2026 — **Estatísticas Fase B — Instagram** em produção: aba Instagram real (seguidores, novos no período, publicações, curtidas recentes, gráfico de evolução, últimas 12 publicações com miniaturas). Token de longa duração no KV com auto-renovação, sync no cron diário, miniaturas no R2, migração `0018_instagram.sql`.
- 24 jul 2026 — **Aba Insights nas Redes Sociais** em produção (temas IA + fontes cruzadas, artigos com editor rico, 4 imagens Gemini→R2, pré-visualização, secção Fontes). Menu renomeado "Redes Sociais". GitHub posto em dia.
- 23 jul 2026 — Estatísticas Fase A (acessos ao site).
