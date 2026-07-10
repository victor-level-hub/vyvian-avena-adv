import { StaticRouter } from 'react-router-dom/server';
import { HelmetProvider } from 'react-helmet-async';
import { renderToString } from 'react-dom/server';
import { PublicRoutes } from './App.jsx';

/**
 * Renderiza uma rota publica para HTML + as meta tags recolhidas pelo Helmet.
 * Chamado por scripts/prerender.mjs depois do bundle SSR ser construido pelo Vite.
 */
export function render(url) {
  const helmetContext = {};

  const html = renderToString(
    <HelmetProvider context={helmetContext}>
      <StaticRouter location={url}>
        <PublicRoutes />
      </StaticRouter>
    </HelmetProvider>
  );

  const { helmet } = helmetContext;

  // Cada campo do Helmet expoe .toString() com as tags ja serializadas.
  const head = [
    helmet?.title?.toString(),
    helmet?.meta?.toString(),
    helmet?.link?.toString(),
    helmet?.script?.toString(),
  ]
    .filter(Boolean)
    .join('\n    ');

  return { html, head };
}
