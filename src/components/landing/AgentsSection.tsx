import { Brain, BarChart3, Code2, Palette, Shield, Zap } from "lucide-react";

const agents = [
  { icon: Brain, title: "Supervisor", desc: "Orchestrates the workflow: receives the mystery prompt, delegates tasks, and synthesizes the final output. The brain of the operation." },
  { icon: BarChart3, title: "Analyst", desc: "Deconstructs the prompt into a detailed technical plan with features, layout, color scheme, and accessibility requirements. Supports human review." },
  { icon: Code2, title: "Developer", desc: "Writes clean, self-contained HTML and JavaScript with realistic mock data, keyboard navigation, and proper error handling." },
  { icon: Palette, title: "Designer", desc: "Creates responsive CSS with design system tokens, WCAG 2.1 AA compliance, dark mode support, and fluid typography." },
  { icon: Shield, title: "Security Auditor", desc: "Scans generated code for XSS vulnerabilities, accessibility violations, and code quality issues. Automatically fixes critical problems." },
  { icon: Zap, title: "Optimizer", desc: "Combines, cleans, and polishes the final output: removes dead code, optimizes selectors, and ensures semantic HTML." },
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
