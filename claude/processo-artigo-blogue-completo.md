# Processo completo: criar um artigo do blogue com fotos e Modo Leitor
*Documentado a 15 julho 2026, a partir do artigo "Cidadania portuguesa: como identificar
cobranças indevidas" — o primeiro a percorrer o fluxo de ponta a ponta.*
*Repetir este processo para todos os artigos futuros.*

## Visão geral do fluxo

```
texto (.md) ──► imagens (agente "Gerador de Imagens" ► Gemini ► pipeline) ──► áudio (ElevenLabs)
                                        │                                        │
                                        ▼                                        ▼
                              capa + fotos de corpo                    Modo Leitor (player +
                              com marca de água                        leitura acompanhada)
                                        └────────────► build + deploy ◄──────────┘
                                                        verificação em produção
```

## 1. Texto do artigo

- Ficheiro em `src/content/blog/{slug}.md` com frontmatter:
  `titulo` (≤60 caracteres — o seo-check do build avisa), `descricao`, `data`,
  `revisto_em`, `validade`, `imagem` (`/blog/{slug}.jpg`), `imagem_alt`, `area`
  (slug de `src/data/areas.js`) e **`audio: sim`** se o artigo vai ter Modo Leitor.
- Idioma conforme o público do artigo (PT-PT por defeito; PT-BR quando o alvo é
  o leitor brasileiro, como no artigo da cidadania).
- Rotas, sitemap e página do blogue são automáticos a partir do `.md`.
  **Manual:** acrescentar o URL ao `public/llms.txt`.
- A indexação do blogue é controlada globalmente por `src/config/blog.json`
  (`publicado: true`) — não há flag por artigo.
- ⚠ Se o texto for editado DEPOIS de gerar o áudio, o áudio tem de ser regenerado
  (o mapeamento palavra a palavra deixa de bater certo).

## 2. Imagens — agente "Gerador de Imagens" + Gemini

1. Invocar o agente no Claude com `modo imagens: [pedido]` (definição em
   `agente-imagens-vyvian.md`). O agente devolve prompts prontos para o Gemini,
   dentro da direção de arte da marca.
2. Gerar no Gemini (conta Pro `victorfulia@gmail.com`). **Enquadramento:** 16:9 na
   máxima resolução (≥1280 px de largura). O destino final da capa é 1200×630 com
   corte de ~6% em cima/baixo — nada importante junto às margens superior/inferior.
3. Gravar como `images\blogue-{N}-{1..n}.jpg` (N = posição do artigo na lista,
   ordenada por data desc). A nomenclatura já variou — listar a pasta antes de assumir.
4. Enviar as fotos ao Claude **no projeto do site**, indicando o artigo de destino.
   O Claude analisa o encaixe temático, propõe o mapeamento foto→secção e a capa
   (o Victor confirma ou troca — trocar a capa depois é operação de 2 minutos).

## 3. Pipeline de imagens no site (Claude executa)

### Capa (`public/blog/{slug}.jpg` + variantes)
1. Redimensionar para 1200 de largura e recorte central para **1200×630**.
2. **Carimbo do favicon dourado**: glifo de `public/favicon.svg` rasterizado
   (cairosvg 240px → 72px), tintado `#B99E5A` por máscara alpha, canto inferior
   direito (margens 26px), opacidade 92%, **sombra dupla** (larga blur 6 / curta blur 2).
3. **Marca invisível** dwtDctSvd (`invisible-watermark`), payload `vyavenaadv` —
   verificar que descodifica após gravar.
4. Gravar JPEG q82 e **só depois** inserir **EXIF** com `piexif`
   (Artist + Copyright) — o OpenCV do passo 3 descarta metadados, o EXIF é sempre
   o último passo.
5. Variantes `{slug}-480/800/1200.webp` q78 (a partir da capa carimbada).
6. Atualizar `imagem_alt` no frontmatter.

### Fotos de corpo (`public/blog/{tema}-{nome}.webp`)
1. WebP no tamanho original (1376px de largura, q80), nome descritivo com prefixo
   do tema (ex.: `cidadania-videochamada.webp`).
2. **Marca de água visível**: glifo do favicon a **64px**, margens **22px**,
   opacidade **88%**, canto inferior direito. Cor: **dourado `#B99E5A` por defeito**;
   **verde `#395963`** quando a média RGB do retângulo exato do logo é quente
   (r > b+18 e luminância > 35) ou muito clara (luminância > 185).
3. **Inspecionar os cantos** (montagem de crops ~300×180) antes de publicar.
4. Inserir no `.md` como HTML puro, a seguir ao parágrafo da secção relacionada:
   `<img src="/blog/....webp" alt="descrição em PT" width="1376" height="768" loading="lazy" />`
5. O respiro é automático: `.blog-prose img { display:block; width:100%; height:auto; margin:2.4rem 0; }`
   em `src/index.css` — não meter margens no HTML.
6. A capa pode repetir-se no corpo quando é o melhor encaixe.

## 4. Modo Leitor (narração + leitura acompanhada)

### Gerar o áudio
```
ELEVENLABS_API_KEY=sk_... node scripts/gerar-audio-blogue.mjs --slug {slug} [--model turbo]
```
- Voz: **Claudia** (`JGnWZj684pcXmK2SxYIv`, pt), modelo `eleven_multilingual_v2`
  (melhor qualidade; textos longos em blocos ≤8,5k com *request stitching* e
  concatenação ffmpeg com `-write_xing 0`). `--model turbo` = pedido único até
  40k chars, sem ffmpeg (máquinas Windows).
- A introdução é montada do frontmatter: "Neste artigo: {descricao} Escrito pela
  Doutora Vyvian Avena, no dia {data por extenso}. Artigo com {N} minutos de leitura."
- **Normalização falada com mapeamento preservado**: `€175,00` → "cento e setenta
  e cinco euros", `18.º` → "décimo oitavo". Cada token do ecrã pode corresponder a
  várias palavras faladas; os timestamps são agregados por token, por isso o
  destaque continua certo.
- Saída: `public/blog-audio/{slug}.mp3` + `{slug}.json`
  (`{duracao, intro_fim, palavras:[[ini,fim],...]}` — 1 intervalo por token do ecrã).
- O script valida que a extração coincide palavra a palavra com o DOM e que o
  número de palavras temporizadas bate certo — se falhar, não grava.
- Custo: ~1k créditos/minuto de leitura (~14,5k para um artigo de 11 min).
  ⚠ O plano gratuito da ElevenLabs bloqueia pedidos de IPs de datacenter — é
  preciso plano pago para gerar a partir do ambiente do Claude.

### Como funciona no site (`src/components/blog/AudioArtigo.jsx`)
- Só renderiza se `audio: sim` no frontmatter **e** o `.json` existir — é seguro
  publicar o artigo antes do áudio.
- Ao tocar: envolve cada palavra da prosa num `<span class="aw">`, esbate o texto
  (`.audio-escuta`) e acende as palavras ao ritmo do áudio (palavra ativa com
  sublinhado dourado), com auto-scroll suave.
- Controlo: play/pausa, barra clicável, velocidades 1x/1.25x/1.5x (os tempos
  exibidos escalam com a velocidade), ✕ parar (limpa tudo).
- **Mini-player flutuante** quando o cartão sai do ecrã (IntersectionObserver):
  mesmos controlos, fundo verde-floresta; o pill do WhatsApp recolhe enquanto
  se ouve (`body.a-ouvir`).

## 5. Compilar, publicar e verificar

1. `npm run build` **com verificação real do exit code**
   (`set -o pipefail` + marcador BUILD_OK) — o seo-check corre no build e trava
   títulos longos, canonicals e sitemap.
2. Confirmar que `dist/blog-audio/` existe **se o áudio foi gerado depois do
   último build** (o Vite copia `public/` no build — áudio gerado depois do build
   não entra no deploy; foi a armadilha de 15 jul).
3. Deploy: `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit) + `CLOUDFLARE_ACCOUNT_ID`
   exportados → `npx wrangler deploy`.
4. **Verificar em produção** (esperar ~1 min pela propagação do edge; usar
   `?x=1` para furar cache na dúvida):
   - página do artigo (título, imagens do corpo pela ordem certa);
   - `blog-audio/{slug}.json` devolve JSON (não HTML de fallback) e o `.mp3`
     tem a duração esperada (ffprobe);
   - bundle novo no ar: comparar o **nome hashado** `index-*.js` local vs produção
     (nunca grep por nomes de variáveis — a minificação renomeia-os);
   - EXIF da capa em produção (piexif.load ao ficheiro descarregado);
   - sitemap inclui o slug.
5. Commit + push para `main` — **sempre**, no próprio dia. (Regra reforçada a
   15 jul: foi preciso reconstruir do site publicado o trabalho de 13-14 jul que
   tinha ficado só em produção.)

## Checklist rápido por artigo

- [ ] `.md` com frontmatter completo (`audio: sim` se aplicável), título ≤60
- [ ] `llms.txt` atualizado
- [ ] Prompts do agente → Gemini 16:9 ≥1280px → fotos em `images\`
- [ ] Mapeamento foto→secção proposto e capa confirmada
- [ ] Capa: 1200×630 + carimbo + dwtDctSvd + EXIF + 3 webp
- [ ] Corpo: webp 1376 q80 + marca 64/22/88% (cor por canto) + cantos inspecionados
- [ ] `<img>` inseridos com alt PT, width/height, lazy
- [ ] Áudio gerado + validação automática OK
- [ ] Build BUILD_OK → deploy → verificação em produção (lista acima)
- [ ] Commit + push no `main`
