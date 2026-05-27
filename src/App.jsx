import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import Sobre from './pages/Sobre';
import Areas from './pages/Areas';
import Apoio from './pages/Apoio';
import Contacto from './pages/Contacto';
import PoliticaCookies from './pages/PoliticaCookies';
import AdminApp from './admin/AdminApp';

function PublicSite() {
  return (
    <>
      <ScrollToTop />
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

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<PublicSite />} />
      </Routes>
    </Router>
  );
}