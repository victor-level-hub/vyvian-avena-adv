import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import Seo from './components/Seo';
import Home from './pages/Home';
import Sobre from './pages/Sobre';
import Areas from './pages/Areas';
import AreaDetalhe from './pages/AreaDetalhe';
import Apoio from './pages/Apoio';
import Contacto from './pages/Contacto';
import PoliticaCookies from './pages/PoliticaCookies';
import NaoEncontrado from './pages/NaoEncontrado';
import Blog from './pages/Blog';
import BlogArtigo from './pages/BlogArtigo';
import AdminApp from './admin/AdminApp';
import UploadPage from './upload/UploadPage';

// Injecta as meta tags correspondentes à rota pública activa.
// As rotas dinâmicas gerem o seu próprio <Seo> (título, JSON-LD, noindex),
// e o Helmet não permite "remover" tags de uma instância anterior — apenas
// sobrepor. Por isso o RouteSeo abstém-se nessas rotas, para não deixar um
// canonical ou robots global a sobreviver ao da página.
const ROTAS_COM_SEO_PROPRIO = [/^\/areas(\/|$)/, /^\/blog(\/|$)/];

function RouteSeo() {
  const { pathname } = useLocation();
  const path =
    pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (ROTAS_COM_SEO_PROPRIO.some((re) => re.test(path))) return null;
  return <Seo path={path} />;
}

function PublicSite() {
  return (
    <>
      <ScrollToTop />
      <RouteSeo />
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sobre" element={<Sobre />} />
          <Route path="/areas" element={<Areas />} />
          <Route path="/areas/:slug" element={<AreaDetalhe />} />
          <Route path="/apoio" element={<Apoio />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/politica-cookies" element={<PoliticaCookies />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogArtigo />} />
          <Route path="*" element={<NaoEncontrado />} />
        </Routes>
      </Layout>
    </>
  );
}

/**
 * Árvore de rotas sem router. Usada tanto pelo BrowserRouter (browser) como pelo
 * StaticRouter (prerender em scripts/prerender.mjs), que nao pode usar BrowserRouter.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/upload/:token" element={<UploadPage />} />
      <Route path="/*" element={<PublicSite />} />
    </Routes>
  );
}

/** Apenas as rotas publicas — o prerender nao deve tocar em /admin nem /upload. */
export function PublicRoutes() {
  return <PublicSite />;
}

export default function App() {
  return (
    <HelmetProvider>
      <Router>
        <AppRoutes />
      </Router>
    </HelmetProvider>
  );
}
