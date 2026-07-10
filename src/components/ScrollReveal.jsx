import { useEffect, useRef, useState } from "react";

// Durante o prerender (react-dom/server) nao ha IntersectionObserver e o useEffect
// nao corre: sem isto o HTML estatico sairia todo com opacity-0, o que esconde o
// conteudo dos crawlers e degrada a pagina se o JS falhar.
const IS_SSR = typeof window === "undefined";

export default function ScrollReveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(IS_SSR);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </div>
  );
}
