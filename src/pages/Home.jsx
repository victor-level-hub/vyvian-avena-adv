import HeroSection from "../components/home/HeroSection";
import PracticeAreasGrid from "../components/home/PracticeAreasGrid";
import PhilosophySection from "../components/home/PhilosophySection";
import OfficesSection from "../components/home/OfficesSection";

const HERO_IMAGE = "https://media.base44.com/images/public/69d8fac37a82caf2f57459fa/7af30e967_generated_6536b44b.png";
const OCEAN_IMAGE = "https://media.base44.com/images/public/69d8fac37a82caf2f57459fa/650ac1b18_generated_dbc5a1b0.png";

export default function Home() {
  return (
    <div>
      <HeroSection heroImage={HERO_IMAGE} />
      <PracticeAreasGrid />
      <PhilosophySection oceanImage={OCEAN_IMAGE} />
      <OfficesSection />
    </div>
  );
}