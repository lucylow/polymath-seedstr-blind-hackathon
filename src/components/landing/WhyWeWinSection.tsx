import { Shuffle, CheckCircle, Paintbrush, Gauge, RefreshCcw, Shield } from "lucide-react";

const reasons = [
  { icon: Shuffle, title: "Handles any prompt", desc: "No matter what the mystery prompt is — dashboard, game, form, or data viz — our agents adapt instantly." },
  { icon: CheckCircle, title: "Functionality ≥ 9/10", desc: "All requested features work flawlessly, with edge cases handled and graceful error recovery." },
  { icon: Paintbrush, title: "Design 9/10", desc: "Responsive, accessible, and visually striking. Our Designer agent follows modern UI/UX principles." },
  { icon: Gauge, title: "Speed 8/10", desc: "Optimized code, minimal dependencies, and self‑verification loops guarantee fast load times." },
  { icon: RefreshCcw, title: "Self‑improving", desc: "The Optimizer refines the output, and the system can even learn from its own mistakes during a run." },
  { icon: Shield, title: "Production‑ready", desc: "Code includes comments, documentation, and follows security best practices — just like a human expert." },
];

const WhyWeWinSection = () => {
  return (
    <section id="why-win" className="py-24">
      <div className="container">
        <h2 className="text-center text-3xl md:text-[2.5rem] font-bold mb-4">
          Why we <span className="gradient-text">win</span>
        </h2>
        <p className="text-center text-muted-foreground mb-14 max-w-lg mx-auto">Built to score high on every judging criterion — functionality, design, and speed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {reasons.map((r) => (
            <div key={r.title} className="glass-card rounded-2xl p-6 group">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <r.icon className="text-primary" size={24} />
              </div>
              <h4 className="text-base font-bold mb-2 text-foreground">{r.title}</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export { WhyWeWinSection };
