import { Brain, BarChart3, Code2, Palette, Zap } from "lucide-react";

const agents = [
  { icon: Brain, title: "Supervisor", desc: "Orchestrates the workflow: receives the mystery prompt, delegates tasks, and synthesizes the final output. The brain of the operation." },
  { icon: BarChart3, title: "Analyst", desc: "Deconstructs the prompt into a detailed technical plan: project type, features, tech stack, file structure, and data requirements." },
  { icon: Code2, title: "Developer", desc: "Writes clean, functional HTML and JavaScript that implements the plan. Self-contained, efficient, and ready to run." },
  { icon: Palette, title: "Designer", desc: "Generates beautiful, responsive CSS with micro‑interactions, accessibility, and a perfect color palette aligned with the prompt." },
  { icon: Zap, title: "Optimizer", desc: "Measures performance, minifies code, and refines the output to ensure lightning‑fast load times and smooth interactions." },
];

const AgentsSection = () => {
  return (
    <section id="agents" className="py-20">
      <div className="container">
        <h2 className="text-center text-3xl md:text-[2.5rem] font-bold mb-12">
          Meet the <span className="gradient-text">agents</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {agents.map((agent) => (
            <div
              key={agent.title}
              className="glass-card rounded-3xl p-6 group"
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-secondary-foreground shrink-0 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <agent.icon size={22} />
                </div>
                <h3 className="text-lg font-bold text-foreground">{agent.title}</h3>
              </div>
              <p className="text-muted-foreground text-sm">{agent.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export { AgentsSection };
