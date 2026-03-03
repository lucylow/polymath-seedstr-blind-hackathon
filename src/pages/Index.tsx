import { Header } from "@/components/landing/Header";
import { HeroSection } from "@/components/landing/HeroSection";
import { AgentsSection } from "@/components/landing/AgentsSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { WhyWeWinSection } from "@/components/landing/WhyWeWinSection";
import { CTASection } from "@/components/landing/CTASection";
import { Footer } from "@/components/landing/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Header />
      <main id="main-content">
        <HeroSection />
        <AgentsSection />
        <HowItWorksSection />
        <WhyWeWinSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
