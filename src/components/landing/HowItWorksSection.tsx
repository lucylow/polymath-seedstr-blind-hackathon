const steps = [
  { num: 1, title: "Mystery prompt", desc: "The secret prompt is revealed — our system receives it and starts the engine." },
  { num: 2, title: "Analysis & plan", desc: "The Analyst creates a comprehensive blueprint tailored to the prompt." },
  { num: 3, title: "Parallel building", desc: "Developer and Designer work simultaneously to create code and styles." },
  { num: 4, title: "Optimization", desc: "The Optimizer runs performance checks and improves speed & size." },
  { num: 5, title: "Submission", desc: "A polished .zip file is produced, ready to upload to Seedstr." },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-20">
      <div className="container">
        <h2 className="text-center text-3xl md:text-[2.5rem] font-bold mb-12">
          How it <span className="gradient-text">works</span>
        </h2>
        <div className="flex flex-wrap justify-center gap-8 mt-12">
          {steps.map((step) => (
            <div key={step.num} className="flex-1 min-w-[200px] max-w-[220px] text-center">
              <div className="w-[60px] h-[60px] rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-5 text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
                {step.num}
              </div>
              <h4 className="text-lg font-bold mb-2 text-foreground">{step.title}</h4>
              <p className="text-muted-foreground text-sm">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export { HowItWorksSection };
