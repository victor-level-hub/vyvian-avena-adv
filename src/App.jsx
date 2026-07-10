import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import Seo from './components/Seo';
import Home from './pages/Home';
import Sobre from './pages/Sobre';
import Areas from './pages/Areas';
import Apoio from './pages/Apoio';
import Contacto from './pages/Contacto';
import PoliticaCookies from './pages/PoliticaCookies';
import AdminApp from './admin/AdminApp';
import UploadPage from './upload/UploadPage';

// Injecta as meta tags correspondentes à rota pública activa.
function RouteSeo() {
  const { pathname } = useLocation();
  const path =
    pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
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
          <Route path="/apoio" element={<Apoio />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/politica-cookies" element={<PoliticaCookies />} />
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
