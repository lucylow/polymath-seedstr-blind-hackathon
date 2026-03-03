import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-network.png";

const HeroSection = () => {
  return (
    <section className="pt-[140px] pb-24 relative overflow-hidden" style={{ background: "radial-gradient(circle at 70% 30%, hsl(217 33% 17%), hsl(var(--background)))" }}>
      {/* Decorative blurred orbs */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-secondary/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="container relative z-10">
        <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="animate-fade-in">
            <span className="inline-block text-xs font-semibold tracking-widest uppercase text-primary mb-4 px-3 py-1 rounded-full border border-primary/30 bg-primary/5">
              Multi-Agent AI System
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-[3.8rem] font-extrabold leading-[1.1] mb-6">
              One agent to{" "}
              <span className="gradient-text">build anything</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground mb-10 max-w-lg leading-relaxed">
              The Full‑Stack Polymath receives a mystery prompt and autonomously generates a complete, production‑ready front‑end project — with functionality, design, and speed that judges love.
            </p>
            <div className="flex gap-4 flex-wrap">
              <Button variant="hero" size="lg" asChild>
                <a href="#agents">Meet the agents</a>
              </Button>
              <Button variant="heroOutline" size="lg" asChild>
                <a href="#how-it-works">How it works</a>
              </Button>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 shadow-[var(--shadow-deep)] animate-float">
            <img
              src={heroImage}
              alt="AI neural network visualization representing the multi-agent system"
              className="w-full h-auto rounded-xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export { HeroSection };
