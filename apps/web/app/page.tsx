import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Preloader, Spotlight } from "@/components/marketing/fx";
import { Bento } from "@/components/marketing/bento";
import { Hero } from "@/components/marketing/hero";
import { IntegrationsHub } from "@/components/marketing/hub";
import { About, Engine, Faq, Features, FlowsSection, ImageCards, IndustriesSection, IntegrationStrip, PhotoWall, Pillars, Pricing, Statement, Templates, TryIt } from "@/components/marketing/sections";
import { ScrollStory } from "@/components/marketing/story";

export default function Home() {
  return (
    <div className="bg-canvas">
      <Preloader />
      <Spotlight />
      <SiteHeader />
      <main className="relative">
        <Hero />
        <IntegrationStrip />
        <ImageCards />
        <div id="how"><ScrollStory /></div>
        <About />
        <IndustriesSection />
        <FlowsSection />
        <PhotoWall />
        <Bento />
        <Pillars />
        <Templates />
        <Engine />
        <Features />
        <IntegrationsHub />
        <TryIt />
        <Statement />
        <Pricing />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
