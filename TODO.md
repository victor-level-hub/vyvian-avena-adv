# TODO — Site Vyvian Avena (vyavenaadv.com)
*Espelho do doc `claude/TODO.md` do projeto claude.ai · atualizado a 24 jul 2026*
*Regra: quem concluir/criar tarefas atualiza AMBOS (este ficheiro e o doc do projeto).*

## Prioridade alta (código)

- [ ] **PDF do plano de pagamento** no formato padrão da Dra. Vyvian, com envio automático ao cliente (área privada).
- [ ] **Filtro na lista de clientes** (área privada).

## Desenvolvimento — próximos

- [ ] **Títulos do blogue >60 caracteres** — aplicar os 4 títulos novos depois da aprovação da Dra.

## Ações do Victor / da Dra. (não é código)

- [ ] Victor (opcional): `IG_SYNC_KEY` foi rodada na integração da Fase B e o valor não ficou guardado. O cron diário não a usa; só serve para forçar uma sincronização manual. Repor com `npx wrangler secret put IG_SYNC_KEY < ficheiro.txt` (e apagar o ficheiro a seguir).
- [ ] Dra.: experimentar as abas **Insights** e **Instagram** e dar feedback.
- [ ] Victor: **créditos Recraft quase no fim (~40)** — fallback de imagem; recarregar se quiser manter o plano B.
- [ ] Dra.: aprovar os 4 títulos novos do blogue.
- [ ] Registos em diretórios (OA → Consulto → Lawzana → Jusbrasil → EscolherAdvogado), 1–2 por semana.

## Concluídas recentemente

- 24 jul 2026 — **Redes Sociais: teste ponta-a-ponta autenticado** das duas abas novas, em produção. Instagram (KPIs, gráfico, grelha) e Insights (Atualizar → 10 temas com fontes cruzadas → gerar artigo → 4 imagens → capa → pré-visualizar → Fontes com adição por link) verificados. Dois defeitos encontrados e corrigidos (`79500da`): tags `<cite>` da pesquisa web a passarem para o artigo (itálico na pré-visualização) e contraste do título do herói na pré-visualização.
- 24 jul 2026 — **Estatísticas Fase B — Instagram** em produção: aba Instagram real (seguidores, novos no período, publicações, curtidas recentes, gráfico de evolução, últimas 12 publicações com miniaturas). Token de longa duração no KV com auto-renovação, sync no cron diário, miniaturas no R2, migração `0018_instagram.sql`.
- 24 jul 2026 — **Aba Insights nas Redes Sociais** em produção (temas IA + fontes cruzadas, artigos com editor rico, 4 imagens Gemini→R2, pré-visualização, secção Fontes). Menu renomeado "Redes Sociais". GitHub posto em dia.
- 23 jul 2026 — Estatísticas Fase A (acessos ao site).
