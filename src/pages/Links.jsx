// /links — destino único da bio do Instagram e do Facebook (substitui o Linktree).
// Handoff: design_handoff_links (links-a.html, aprovado pela cliente) — o markup
// e os valores de estilo estão portados 1:1; ver src/pages/links.css.
//
// Renderiza FORA do Layout (sem navegação nem footer do site — ver App.jsx):
// a página é o próprio destino, nada acima da dobra que não seja clicável.
//
// Ordem dos blocos = "porque é que alguém chega aqui": ler (artigos) → falar
// (WhatsApp, consulta, email, telefone) → seguir (site e redes) → explorar.
import { Helmet } from "react-helmet-async";
import Seo from "../components/Seo";
import { POSTS } from "../data/blog";
import { getArea } from "../data/areas";
import { capaSrcSet } from "../lib/imagens";
import blogConfig from "../config/blog.json";
import "./links.css";

const WHATSAPP =
  "https://wa.me/351911831530?text=Ol%C3%A1%2C%20gostaria%20de%20agendar%20uma%20consulta.";

const Chev = ({ className = "chev" }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const Pin = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21s7-6.16 7-11a7 7 0 1 0-14 0c0 4.84 7 11 7 11" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export default function Links() {
  // Os 2 posts mais recentes (POSTS já vem ordenado por data desc). Se o blogue
  // ainda não estiver publicado ou não houver posts, a secção esconde-se por
  // inteiro — nunca cartões vazios (spec §4 do handoff).
  const destaques = blogConfig.publicado ? POSTS.slice(0, 2) : [];

  return (
    <div className="lk">
      <Seo
        path="/links"
        title="Links | Vyvian Avena — Advogada"
        desc="Fale com a Dra. Vyvian Avena — WhatsApp, consulta, email e telefone — e leia os artigos mais recentes do blogue. Advogada em Portugal e no Brasil."
      />
      <Helmet>
        <meta name="theme-color" content="#12302a" />
      </Helmet>

      <h1 className="sr">Vyvian Avena — Advogada · Links</h1>

      <div className="page">
        <header className="hd">
          <img src="/logo-vyvian-vertical-gold.svg" alt="Vyvian Avena — Advogada" />
          <p className="ov">Advogada · Portugal e Brasil</p>
          <div className="rule" />
        </header>

        {destaques.length > 0 && (
          <>
            <div className="sec"><span>Em destaque</span><i /></div>
            <div className="arts">
              {destaques.map((p) => (
                <a className="art" key={p.slug} href={`/blog/${p.slug}`}>
                  <img
                    src={p.imagem}
                    srcSet={capaSrcSet(p.imagem)}
                    sizes="88px"
                    alt=""
                    loading="lazy"
                  />
                  <div>
                    <div className="am">
                      {[getArea(p.area)?.title, `${p.minutos} min`].filter(Boolean).join(" · ")}
                    </div>
                    <h2>{p.titulo}</h2>
                  </div>
                  <Chev />
                </a>
              ))}
            </div>
          </>
        )}

        <div className="sec"><span>Falar comigo</span><i /></div>
        <a className="wa" href={WHATSAPP}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.886-9.885 9.886m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" /></svg>
          WhatsApp
        </a>
        <div className="rows">
          <a className="row" href="/contacto">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            <span className="rl"><b>Agendar consulta</b><em>Formulário de contacto</em></span>
            <Chev />
          </a>
          <a className="row" href="mailto:vyavena@gmail.com">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" /><path d="M3 7l9 6 9-6" /></svg>
            <span className="rl"><b>Email</b><em>vyavena@gmail.com</em></span>
            <Chev />
          </a>
          <a className="row" href="tel:+351911831530">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1" /></svg>
            <span className="rl"><b>Telefone</b><em>+351 911 831 530</em></span>
            <Chev />
          </a>
        </div>

        <div className="sec"><span>Redes</span><i /></div>
        <div className="two">
          <a className="soc wide" href="/" aria-label="Site — vyavenaadv.com">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0m0 2.16c1.4 0 2.9 2.2 3.5 5.7H8.5c.6-3.5 2.1-5.7 3.5-5.7M7.6 2.94A15.9 15.9 0 0 0 6.3 7.86H3.2a9.9 9.9 0 0 1 4.4-4.92m8.8 0a9.9 9.9 0 0 1 4.4 4.92h-3.1a15.9 15.9 0 0 0-1.3-4.92M2.35 10.02h3.7A25 25 0 0 0 5.9 12c0 .68.05 1.34.14 1.98h-3.7A9.9 9.9 0 0 1 2.16 12c0-.68.07-1.33.19-1.98m5.87 0h7.56c.1.64.16 1.3.16 1.98s-.06 1.34-.16 1.98H8.22A17 17 0 0 1 8.06 12c0-.68.06-1.34.16-1.98m9.73 0h3.7c.12.65.19 1.3.19 1.98s-.07 1.33-.19 1.98h-3.7c.09-.64.14-1.3.14-1.98s-.05-1.34-.14-1.98M3.2 16.14h3.1c.3 1.78.74 3.43 1.3 4.92a9.9 9.9 0 0 1-4.4-4.92m5.3 0h7c-.6 3.5-2.1 5.7-3.5 5.7s-2.9-2.2-3.5-5.7m9.2 0h3.1a9.9 9.9 0 0 1-4.4 4.92c.56-1.49 1-3.14 1.3-4.92" /></svg>
            <span className="rl"><b>vyavenaadv.com</b><em>Site oficial</em></span>
          </a>
          <a className="soc" href="https://www.instagram.com/vyvianavenaadv/" aria-label="Instagram — @vyvianavenaadv">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.15.63c-.79.3-1.46.71-2.12 1.38C1.36 2.67.95 3.34.63 4.13.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.9.3.79.71 1.46 1.38 2.12.66.66 1.33 1.07 2.12 1.38.75.3 1.63.5 2.9.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.9-.56.79-.3 1.46-.71 2.12-1.38.66-.66 1.07-1.33 1.38-2.12.3-.75.5-1.63.56-2.9.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.9-.3-.79-.71-1.46-1.38-2.12C21.31 1.36 20.64.95 19.85.63c-.75-.3-1.63-.5-2.9-.56C15.67.01 15.26 0 12 0m0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0" /></svg>
            <b>Instagram</b>
          </a>
          <a className="soc" href="https://facebook.com/vyavenaadv" aria-label="Facebook — Vyvian Avena Advogada">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07" /></svg>
            <b>Facebook</b>
          </a>
        </div>

        <div className="sec"><span>No site</span><i /></div>
        <nav className="mini" aria-label="Secções do site">
          <a href="/areas">Áreas de atuação<Chev /></a>
          <a href="/blog">Blogue<Chev /></a>
          <a href="/sobre">Sobre a Dra. Vyvian<Chev /></a>
        </nav>

        <footer className="ft">
          <div className="rule" />
          <div className="ofc">
            <span><Pin /><em><b>Cacilhas</b> · Almada</em></span>
            <span><Pin /><em><b>Santa Maria da Feira</b> · Aveiro</em></span>
            <span><Pin /><em><b>Barra Olímpica</b> · Rio de Janeiro</em></span>
          </div>
          <div className="lg">
            <a href="/politica-cookies">Política de Cookies</a>
          </div>
          <p className="cop">© 2026 Vyvian Avena — Advogada</p>
        </footer>
      </div>

      <div className="site">
        <a href="/">
          <span className="dot" />
          <span className="st"><em>Site oficial</em><b>vyavenaadv.com</b></span>
          <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg>
        </a>
      </div>
    </div>
  );
}
