import { Link } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import Seo from "../components/Seo";

/**
 * Servida com HTTP 404 real pelo Worker (ver worker/index.js) para qualquer rota
 * publica desconhecida. Sem isto o Cloudflare cairia no fallback da SPA e responderia
 * 200 numa pagina inexistente — um soft-404 aos olhos do Google.
 */
export default function NaoEncontrado() {
  return (
    <div>
      <Seo
        path="/404"
        title="Página não encontrada | Vyvian Avena Advogada"
        desc="A página que procura não existe ou foi movida."
      />

      <section className="bg-forest pt-32 pb-20 px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-px w-16 bg-gold mb-6" />
          <p className="font-body text-gold text-sm tracking-widest uppercase mb-4">Erro 404</p>
          <h1 className="font-heading text-4xl md:text-5xl text-warmwhite mb-4">
            Página não encontrada
          </h1>
          <p className="font-body text-warmwhite/60 max-w-2xl text-lg">
            A página que procura não existe ou foi movida. Abaixo ficam alguns caminhos úteis.
          </p>
        </div>
      </section>

      <section className="py-24 px-6 md:px-12 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <Link
            to="/areas"
            className="group block p-6 bg-cream border border-border hover:border-gold transition-colors duration-300"
          >
            <h2 className="font-heading text-xl text-forest mb-2">Áreas de Atuação</h2>
            <p className="font-body text-sm text-forest/60 leading-relaxed">
              As seis áreas em que prestamos apoio jurídico.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-sm text-gold font-body">
              Ver áreas
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
            </span>
          </Link>

          <Link
            to="/apoio"
            className="group block p-6 bg-cream border border-border hover:border-gold transition-colors duration-300"
          >
            <h2 className="font-heading text-xl text-forest mb-2">Apoio ao Cliente</h2>
            <p className="font-body text-sm text-forest/60 leading-relaxed">
              Perguntas frequentes e como decorre o processo.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-sm text-gold font-body">
              Ver respostas
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
            </span>
          </Link>

          <Link
            to="/contacto"
            className="group block p-6 bg-cream border border-border hover:border-gold transition-colors duration-300"
          >
            <h2 className="font-heading text-xl text-forest mb-2">Contacto</h2>
            <p className="font-body text-sm text-forest/60 leading-relaxed">
              Marque uma consulta em Portugal ou no Brasil.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-sm text-gold font-body">
              Marcar consulta
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform duration-300" />
            </span>
          </Link>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-forest/60 hover:text-forest font-body transition-colors duration-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao início
        </Link>
      </section>
    </div>
  );
}
