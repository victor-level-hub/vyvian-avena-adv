import HeroSection from "../components/home/HeroSection";
import PracticeAreasGrid from "../components/home/PracticeAreasGrid";
import PhilosophySection from "../components/home/PhilosophySection";
import OfficesSection from "../components/home/OfficesSection";
import BlogSection from "../components/home/BlogSection";

// Auto-hospedadas (antes vinham do media.base44.com, plataforma legada) e
// convertidas para WebP: a do hero e' o LCP da pagina, ~1.1 MB -> ~100 KB.
const HERO_IMAGE = "/hero-escritorio.webp";
const OCEAN_IMAGE = "/oceano-dois-paises.webp";

export default function Home() {
  return (
    <div>
      <HeroSection heroImage={HERO_IMAGE} />
      <PracticeAreasGrid />
      <PhilosophySection oceanImage={OCEAN_IMAGE} />
      <BlogSection />
      <OfficesSection />
    </div>
  );
}