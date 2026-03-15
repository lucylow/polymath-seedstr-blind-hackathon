const steps = [
  { num: 1, title: "Mystery prompt", desc: "The secret prompt is revealed — our system receives it and starts the engine." },
  { num: 2, title: "Analysis & plan", desc: "The Analyst creates a comprehensive blueprint tailored to the prompt." },
  { num: 3, title: "Human review", desc: "You review, edit, or approve the plan before building begins." },
  { num: 4, title: "Parallel building", desc: "Developer and Designer work simultaneously to create code and styles." },
  { num: 5, title: "Security audit", desc: "The Security Auditor scans for XSS, accessibility issues, and code quality." },
  { num: 6, title: "Optimize & submit", desc: "The Optimizer polishes the output, ready to download or submit." },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="absolute inset-0 bg-muted/30 pointer-events-none" />
      <div className="container relative z-10">
        <h2 className="text-center text-3xl md:text-[2.5rem] font-bold mb-4">
          How it <span className="gradient-text">works</span>
        </h2>
        <p className="text-center text-muted-foreground mb-14 max-w-md mx-auto">From mystery prompt to polished project in five automated steps.</p>
        <div className="flex flex-wrap justify-center gap-8">
          {steps.map((step, i) => (
            <div key={step.num} className="flex-1 min-w-[180px] max-w-[220px] text-center group" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-5 text-primary-foreground shadow-lg group-hover:scale-110 transition-transform duration-200" style={{ background: "var(--gradient-primary)" }}>
                {step.num}
              </div>
              <h4 className="text-base font-bold mb-2 text-foreground">{step.title}</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export { HowItWorksSection };
