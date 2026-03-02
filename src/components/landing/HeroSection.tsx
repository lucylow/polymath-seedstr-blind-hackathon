import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-network.png";

const HeroSection = () => {
  return (
    <section className="pt-[150px] pb-[100px]" style={{ background: "radial-gradient(circle at 70% 30%, hsl(217 33% 17%), hsl(var(--background)))" }}>
      <div className="container">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div className="animate-fade-in-up">
            <h1 className="text-4xl md:text-[3.8rem] font-extrabold leading-tight mb-6">
              One agent to{" "}
              <span className="gradient-text">build anything</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-10 max-w-lg">
              The Full‑Stack Polymath is a multi‑agent AI system that receives a mystery prompt and autonomously generates a complete, production‑ready front‑end project — with functionality, design, and speed that judges love.
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
