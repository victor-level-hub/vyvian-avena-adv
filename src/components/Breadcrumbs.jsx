import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

const SITE = "https://vyavenaadv.com";

/**
 * Constroi o JSON-LD BreadcrumbList a partir dos mesmos items que sao mostrados.
 * Exportado para que a pagina o possa passar ao <Seo>, evitando duas fontes de verdade.
 */
export const breadcrumbJsonLd = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: item.name,
    item: `${SITE}${item.path}`,
  })),
});

/**
 * items: [{ name, path }] — o ultimo e' a pagina actual e nao e' um link.
 */
export default function Breadcrumbs({ items, className = "" }) {
  return (
    <nav aria-label="Percurso" className={`font-body text-sm ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1.5">
              {isLast ? (
                <span aria-current="page" className="text-warmwhite/50">
                  {item.name}
                </span>
              ) : (
                <>
                  <Link
                    to={item.path}
                    className="text-warmwhite/70 hover:text-gold transition-colors duration-300"
                  >
                    {item.name}
                  </Link>
                  <ChevronRight className="w-3.5 h-3.5 text-warmwhite/30" aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
