import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section id="cta" className="py-16">
      <div className="container">
        <div className="relative rounded-[2.5rem] p-12 md:p-16 text-center overflow-hidden" style={{ background: "var(--gradient-surface)" }}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/8 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-secondary/8 rounded-full blur-[80px] pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-[2.5rem] font-bold mb-4 text-foreground">
              Ready to <span className="gradient-text">dominate</span> the hackathon?
            </h2>
            <p className="text-lg text-muted-foreground max-w-[600px] mx-auto mb-8 leading-relaxed">
              We're fine‑tuning the Polymath for the March 9th deadline. Get early access to the code and be the first to see it in action.
            </p>
            <Button variant="hero" size="lg" asChild>
              <Link to="/dashboard">Try the Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export { CTASection };
