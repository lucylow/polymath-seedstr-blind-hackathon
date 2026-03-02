import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section id="cta" className="py-10">
      <div className="container">
        <div className="rounded-[2.5rem] p-12 md:p-16 text-center" style={{ background: "var(--gradient-surface)" }}>
          <h2 className="text-3xl md:text-[2.5rem] font-bold mb-4 text-foreground">
            Ready to <span className="gradient-text">dominate</span> the hackathon?
          </h2>
          <p className="text-lg text-muted-foreground max-w-[600px] mx-auto mb-8">
            We're fine‑tuning the Polymath for the March 9th deadline. Get early access to the code and be the first to see it in action.
          </p>
          <Button variant="hero" size="lg" asChild>
            <Link to="/dashboard">Try the Dashboard</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

export { CTASection };
