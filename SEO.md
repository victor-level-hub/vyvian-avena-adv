# SEO — o que não se pode partir

O site é uma SPA. Sem prerender, os crawlers recebiam um `index.html` vazio.
O que existe hoje foi construído para resolver isso, e é frágil de formas que não
se vêem: o site continua bonito e a funcionar enquanto desaparece do Google.

`scripts/seo-check.mjs` corre no fim do build e **falha o build** se algo se partir.
Se ele reclamar, não contorne — corrija.

## Ao redesenhar o site

Seguro mudar: cores, espaçamentos, sombras, animações, arredondamentos, ícones,
tipografia, disposição visual.

**Cuidado com:**

| O quê | Porquê |
|---|---|
| `<h1>` | Exatamente um por página. Um título estilizado como `<div>` não conta para o Google. |
| `ScrollReveal.jsx` | Arranca **visível** em SSR (`useState(IS_SSR)`). Se voltar a `useState(false)`, todo o conteúdo fica escondido dos crawlers no HTML estático. |
| `App.jsx` | `HelmetProvider` + `RouteSeo` geram as meta tags por rota. Uma refatoração de layout pode removê-los sem intenção. |
| `index.html` | Contém o JSON-LD `LegalService` global. Parece código a mais; não é. |
| Texto em imagem | Um `<h2>` exportado como PNG é invisível ao Google. |
| `PracticeAreasGrid.jsx` | Liga para `/areas/{slug}`. Sem essas ligações internas, as páginas de área são mal rastreadas. |
| `index.html` (canonical/OG) | **Nunca** repor aqui tags que o Helmet já gera. Dois canonical por página fazem o Google colapsar as rotas na Home. |

## Estrutura

- `scripts/routes.mjs` — lista única de rotas públicas. Alimenta o prerender **e** o sitemap.
- `scripts/prerender.mjs` — gera HTML estático com `react-dom/server`. Sem browser: o Puppeteer não arranca no CI do Cloudflare (falta `libatk-1.0.so.0`).
- `scripts/sitemap.mjs` — gera `dist/sitemap.xml` a partir das rotas.
- `scripts/seo-check.mjs` — verifica o `dist/` e falha o build se necessário.
- `src/components/Seo.jsx` — title/description/canonical/OG/Twitter por rota.
- `src/data/areas.js` — fonte única das áreas de atuação.

O prerender escreve `areas/familia.html`, não `areas/familia/index.html`: com o
`html_handling` default do Cloudflare, um ficheiro individual é servido em
`/areas/familia`, enquanto um índice de pasta redirecionaria com um 307.

## Correr à parte

```bash
npm run build       # inclui o seo-check
npm run seo:check   # só o teste, sobre um dist/ já construído
```
