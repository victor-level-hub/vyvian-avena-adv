import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

/**
 * "Ouvir este artigo" — narração ElevenLabs com leitura acompanhada.
 *
 * Ficheiros esperados (gerados por scripts/gerar-audio-blogue.mjs):
 *   /blog-audio/{slug}.mp3          — narração (intro + corpo do artigo)
 *   /blog-audio/{slug}.json         — { duracao, intro_fim, palavras: [[ini,fim],...] }
 *
 * As `palavras` são timestamps (segundos) das palavras do CORPO do artigo,
 * na mesma ordem em que os text nodes aparecem no DOM de `.blog-prose`
 * (garantido pelo script de geração, que extrai o texto do mesmo HTML do
 * marked). O componente envolve cada palavra num <span class="aw"> na
 * primeira reprodução e vai acendendo-as ao ritmo do áudio.
 *
 * Se o JSON não existir (artigo sem áudio gerado), o componente não
 * renderiza nada — o frontmatter `audio: sim` só liga a tentativa.
 */

const VELOCIDADES = [1, 1.25, 1.5];

const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
};

/** Envolve cada palavra dos text nodes de `root` num span.aw; devolve os spans por ordem. */
function envolverPalavras(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const spans = [];
  for (const node of nodes) {
    const partes = node.nodeValue.split(/(\s+)/);
    const frag = document.createDocumentFragment();
    for (const parte of partes) {
      if (!parte) continue;
      if (/^\s+$/.test(parte)) {
        frag.appendChild(document.createTextNode(parte));
      } else {
        const s = document.createElement("span");
        s.className = "aw";
        s.textContent = parte;
        frag.appendChild(s);
        spans.push(s);
      }
    }
    node.parentNode.replaceChild(frag, node);
  }
  return spans;
}

export default function AudioArtigo({ slug, proseRef }) {
  const [dados, setDados] = useState(null); // timings JSON
  const [pronto, setPronto] = useState(false); // metadata do áudio carregada
  const [aTocar, setATocar] = useState(false);
  const [terminou, setTerminou] = useState(false);
  const [t, setT] = useState(0);
  const [vel, setVel] = useState(0);

  const audioRef = useRef(null);
  const spansRef = useRef(null); // [{el}] após envolver
  const idxRef = useRef(-1); // última palavra acesa
  const rafRef = useRef(0);
  const scrollTsRef = useRef(0);

  // Carrega os timings; sem eles o player não existe.
  useEffect(() => {
    let vivo = true;
    fetch(`/blog-audio/${slug}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && d && Array.isArray(d.palavras) && setDados(d))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [slug]);

  const prepararSpans = () => {
    if (spansRef.current || !proseRef.current || !dados) return;
    const spans = envolverPalavras(proseRef.current);
    // Defesa: se o DOM divergir dos timings (ex.: artigo editado sem regenerar
    // o áudio), seguimos até ao mínimo comum — o resto fica simplesmente sem destaque.
    spansRef.current = spans.slice(0, dados.palavras.length);
  };

  const atualizar = () => {
    const a = audioRef.current;
    if (!a || !dados) return;
    const agora = a.currentTime;
    setT(agora);

    const spans = spansRef.current;
    if (spans && proseRef.current) {
      const { palavras, intro_fim } = dados;
      let i = idxRef.current;
      if (agora < (palavras[i]?.[0] ?? 0) - 0.05) {
        // saltou para trás (seek): recomeça a contagem
        for (const s of spans) s.classList.remove("aw-on", "aw-lida");
        i = -1;
      }
      while (i + 1 < palavras.length && palavras[i + 1][0] <= agora) i += 1;
      if (i !== idxRef.current) {
        if (idxRef.current >= 0 && spans[idxRef.current]) {
          spans[idxRef.current].classList.remove("aw-on");
          spans[idxRef.current].classList.add("aw-lida");
        }
        for (let k = Math.max(idxRef.current, 0); k < i; k += 1) {
          spans[k]?.classList.add("aw-lida");
          spans[k]?.classList.remove("aw-on");
        }
        if (i >= 0 && spans[i]) {
          spans[i].classList.add("aw-on");
          // auto-scroll suave, no máximo 1x/segundo, mantendo a palavra à vista
          const r = spans[i].getBoundingClientRect();
          const alvoOk = r.top > window.innerHeight * 0.2 && r.bottom < window.innerHeight * 0.72;
          if (!alvoOk && Date.now() - scrollTsRef.current > 900) {
            scrollTsRef.current = Date.now();
            spans[i].scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
        idxRef.current = i;
      }
      void intro_fim; // (durante a introdução i fica em -1: nada aceso)
    }
    rafRef.current = requestAnimationFrame(atualizar);
  };

  const play = () => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio(`/blog-audio/${slug}.mp3`);
      a.preload = "auto";
      a.playbackRate = VELOCIDADES[vel];
      a.addEventListener("loadedmetadata", () => setPronto(true));
      a.addEventListener("ended", () => {
        setATocar(false);
        setTerminou(true);
        proseRef.current?.classList.remove("audio-escuta");
        cancelAnimationFrame(rafRef.current);
      });
      audioRef.current = a;
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: document.title,
          artist: "Dra. Vyvian Avena · Advogada",
        });
      }
    }
    prepararSpans();
    proseRef.current?.classList.add("audio-escuta");
    setTerminou(false);
    a.play();
    setATocar(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(atualizar);
  };

  const pause = () => {
    audioRef.current?.pause();
    setATocar(false);
    proseRef.current?.classList.remove("audio-escuta");
    cancelAnimationFrame(rafRef.current);
  };

  const recomecar = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    idxRef.current = -1;
    spansRef.current?.forEach((s) => s.classList.remove("aw-on", "aw-lida"));
    play();
  };

  const mudarVel = () => {
    const nv = (vel + 1) % VELOCIDADES.length;
    setVel(nv);
    if (audioRef.current) audioRef.current.playbackRate = VELOCIDADES[nv];
  };

  const procurar = (e) => {
    const a = audioRef.current;
    if (!a || !dados) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    a.currentTime = frac * (a.duration || dados.duracao);
    setT(a.currentTime);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
    },
    []
  );

  if (!dados) return null;

  const dur = (pronto && audioRef.current?.duration) || dados.duracao;
  const naIntro = aTocar && t < dados.intro_fim;

  return (
    <div className="mb-10 border border-gold/35 bg-[#f7f2e9] px-5 py-4 md:px-6 md:py-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={aTocar ? pause : play}
          aria-label={aTocar ? "Pausar a narração" : "Ouvir este artigo"}
          className="shrink-0 w-12 h-12 rounded-full bg-gold text-forest flex items-center justify-center hover:bg-[#a07d4a] hover:text-warmwhite transition-colors duration-300"
        >
          {aTocar ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-[1px]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-heading text-[17px] text-forest leading-tight">
              Ouvir este artigo
            </div>
            <div className="font-body text-[12px] text-forest/50 tabular-nums shrink-0">
              {fmt(t)} / {fmt(dur)}
            </div>
          </div>
          <div className="font-body text-[12.5px] text-forest/55 mt-0.5">
            {naIntro
              ? "Introdução"
              : aTocar
                ? "A acompanhar a leitura no texto"
                : "Narração do artigo · voz sintetizada"}
          </div>

          <div
            role="slider"
            aria-label="Posição da narração"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(t)}
            tabIndex={0}
            onClick={procurar}
            className="mt-2.5 h-4 flex items-center cursor-pointer group"
          >
            <div className="relative h-[3px] w-full bg-forest/15">
              <div
                className="absolute inset-y-0 left-0 bg-gold transition-[width] duration-150"
                style={{ width: `${dur ? (t / dur) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={mudarVel}
            aria-label="Velocidade da narração"
            className="font-body text-[12px] tracking-wide text-forest/70 border border-forest/20 px-2 py-0.5 hover:border-gold hover:text-gold transition-colors duration-300 tabular-nums"
          >
            {VELOCIDADES[vel]}x
          </button>
          {terminou && (
            <button
              type="button"
              onClick={recomecar}
              aria-label="Ouvir de novo"
              className="text-forest/50 hover:text-gold transition-colors duration-300"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
