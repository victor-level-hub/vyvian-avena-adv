# Otimização de performance — julho 2026

Alterações feitas a partir da auditoria PageSpeed Insights (mobile 76 → objetivo 90+,
desktop 99) e do relatório SEOptimer.

## O que foi feito

**JS e CSS no caminho crítico**

- `src/App.jsx`: a área privada (`AdminApp`) e o upload tokenizado (`UploadPage`)
  passaram a `React.lazy` — saíram do bundle público (520 → 367 KB raw).
- `src/admin/admin.css`: removido o `@import` do Google Fonts. Ele entrava no CSS
  principal e bloqueava o render de todas as páginas públicas (~750 ms no 4G).
  As fontes já são auto-hospedadas em `public/fonts/`.
- `index.html`: o `fonts.css` passou a estar inline num `<style>` (menos um pedido
  bloqueante). A fonte de verdade continua a ser `public/fonts/fonts.css`.
- `scripts/inline-css.mjs` (novo, corre no `npm run build`): faz inline do CSS do
  bundle em cada HTML prerenderizado — zero CSS bloqueante no primeiro render.

**Imagens**

- Capas do blogue: variantes WebP em 480/800/1200 px ao lado dos JPG originais
  (o JPG fica como fallback e como `og:image` — WhatsApp/Facebook não aceitam WebP
  de forma fiável). Componentes usam `srcSet` via `src/lib/imagens.js`.
- Hero (`hero-escritorio`): variantes 480/864 + `fetchpriority="high"`.
- Oceano (`oceano-dois-paises`): variantes 768/1536 com qualidade reduzida
  (é decorativa, opacity 10%) + `loading="lazy"`.

Para gerar variantes de uma capa nova (requer `npm i -D sharp` temporário):

```js
const sharp = require('sharp');
for (const w of [480, 800, 1200])
  await sharp('public/blog/SLUG.jpg').resize(w).webp({ quality: 78 }).toFile(`public/blog/SLUG-${w}.webp`);
```

**Acessibilidade (95 → 100)**

- Botões dourados (hero "Consulta Inicial", WhatsApp, cookies "Aceitar Todos"):
  texto passou de branco-quente (2,7:1, reprovava AA) para verde-floresta (5,0:1).
- Rodapé: `text-warmwhite/50` → `/60` (4,5:1 no limite → 5,8:1).
- Botão WhatsApp: `aria-label` agora contém o texto visível ("Fale connosco…").

**SEO (SEOptimer)**

- `worker/index.js`: redirect 301 http → https.
- Título da home: 61 → 53 caracteres ("Vyvian Avena | Advogada de Família, Civil
  e Comercial") em `index.html` e `src/components/Seo.jsx`.
- `vite.config.js`: `sourcemap: true` (limpa o aviso do Lighthouse; os .map só
  descarregam com o DevTools aberto).
- `scripts/seo-check.mjs`: ignora blocos `<style>` (senão o CSS inline dispara
  falso positivo no check do ScrollReveal).

## Pendentes (não são código)

- **Link building** (SEOptimer, prioridade alta): registos em diretórios de
  advogados PT/BR, perfil Google Business para os 3 escritórios, guest posts.
- ~41 KB de JS ainda "não usado" no bundle público (react-router/marked/lucide
  parciais) — ganho pequeno, exigiria dividir o conteúdo do blogue do bundle;
  só vale a pena se o blogue crescer muito.
- Os títulos de 3 artigos do blogue passam de 60 caracteres (aviso do seo-check);
  são editoriais — mudar só com aprovação da Dra. Vyvian.
