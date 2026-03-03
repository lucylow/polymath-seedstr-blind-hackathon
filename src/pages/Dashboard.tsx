import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Brain, Search, Code, Paintbrush, Gauge, Terminal, Bot, List, Eye,
  FileCode, Download, Loader2, CheckCircle2, Clock, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const AGENTS = [
  { id: "supervisor", name: "Supervisor", desc: "Orchestrates the workflow", icon: Brain, colorClass: "bg-secondary" },
  { id: "analyst", name: "Analyst", desc: "Analyzes and plans", icon: Search, colorClass: "bg-primary" },
  { id: "developer", name: "Developer", desc: "Writes the code", icon: Code, colorClass: "bg-accent" },
  { id: "designer", name: "Designer", desc: "Creates the styles", icon: Paintbrush, colorClass: "bg-[hsl(45,90%,55%)]" },
  { id: "optimizer", name: "Optimizer", desc: "Optimizes output", icon: Gauge, colorClass: "bg-destructive" },
] as const;

type AgentId = (typeof AGENTS)[number]["id"];
type AgentStatus = "waiting" | "running" | "done";

interface AgentState { status: AgentStatus; message: string; }
interface LogEntry { time: string; text: string; }
interface WorkflowResult {
  code: { html: string; js: string };
  styles: { css: string };
  optimized: { html: string; css: string; js: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runAgentWorkflow = async (
  prompt: string,
  onAgent: (u: { id: AgentId; status: AgentStatus; message: string }) => void,
  onLog: (msg: string) => void,
  onResult: (r: WorkflowResult) => void,
) => {
  const set = (id: AgentId, status: AgentStatus, message: string) => onAgent({ id, status, message });
  onLog(`🚀 Starting workflow for: "${prompt}"`);

  set("supervisor", "running", "Initializing…"); await sleep(800);
  set("supervisor", "done", "Ready"); onLog("Supervisor ready");

  set("analyst", "running", "Analyzing prompt…"); await sleep(1500);
  set("analyst", "done", "Plan created"); onLog("Analyst created technical plan");

  set("developer", "running", "Writing code…");
  set("designer", "running", "Creating styles…");
  await sleep(2000);

  const code = {
    html: `<div class="app"><h1>${prompt}</h1><p>Generated dashboard content</p><div class="cards"><div class="card">Feature 1</div><div class="card">Feature 2</div><div class="card">Feature 3</div></div></div>`,
    js: `document.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => c.style.transform = 'scale(1.05)'))`,
  };
  const styles = {
    css: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b;display:flex;justify-content:center;padding:2rem}.app{max-width:700px;width:100%}h1{font-size:2rem;margin-bottom:.5rem;color:#3b82f6}p{color:#64748b;margin-bottom:1.5rem}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;transition:transform .2s,box-shadow .2s}.card:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}`,
  };

  set("developer", "done", "Code ready"); onLog("Developer finished writing code");
  set("designer", "done", "Styles ready"); onLog("Designer finished creating styles");

  set("optimizer", "running", "Optimizing…"); await sleep(1200);
  set("optimizer", "done", "Optimization complete"); onLog("Optimizer finished – minified and improved");

  set("supervisor", "running", "Packaging…"); await sleep(500);
  set("supervisor", "done", "Submission ready"); onLog("✅ All done! Output ready for download.");

  onResult({ code, styles, optimized: { html: code.html, css: styles.css, js: code.js } });
};

export default function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [agents, setAgents] = useState<Record<AgentId, AgentState>>(
    () => Object.fromEntries(AGENTS.map((a) => [a.id, { status: "waiting" as AgentStatus, message: "" }])) as Record<AgentId, AgentState>,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

  const handleStart = () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true); setLogs([]); setResult(null);
    setAgents(Object.fromEntries(AGENTS.map((a) => [a.id, { status: "waiting" as AgentStatus, message: "" }])) as Record<AgentId, AgentState>);
    runAgentWorkflow(
      prompt,
      ({ id, status, message }) => setAgents((prev) => ({ ...prev, [id]: { status, message } })),
      (msg) => setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text: msg }]),
      (res) => { setResult(res); setIsRunning(false); },
    );
  };

  const previewHTML = result
    ? `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${result.optimized.css}</style></head><body>${result.optimized.html}<script>${result.optimized.js}<\/script></body></html>`
    : "";

  const handleDownload = () => {
    if (!result) return;
    const content = `<!-- index.html -->\n${result.optimized.html}\n\n/* style.css */\n${result.optimized.css}\n\n// script.js\n${result.optimized.js}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "polymath-output.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard header */}
      <header className="sticky top-0 bg-background/90 backdrop-blur-md border-b border-border z-50">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 flex items-center h-[70px] gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon" aria-label="Back to home">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl md:text-3xl font-extrabold gradient-text">Polymath Dashboard</h1>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 md:p-8">
        <p className="text-muted-foreground text-lg mb-8">
          Multi‑agent AI system that builds anything from a mystery prompt
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column */}
          <div className="space-y-6">
            {/* Control Panel */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Terminal className="h-5 w-5 text-primary" /> Control Panel
              </h2>
              <textarea
                className="w-full p-4 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground resize-y focus-visible:ring-2 focus-visible:ring-ring mb-4 transition-colors"
                rows={3}
                placeholder="Enter the mystery prompt here…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isRunning}
              />
              <Button variant="hero" size="lg" onClick={handleStart} disabled={isRunning || !prompt.trim()}>
                {isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : "🚀 Start Agents"}
              </Button>
            </div>

            {/* Agents */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Bot className="h-5 w-5" /> Agents
              </h2>
              <div className="space-y-3">
                {AGENTS.map((agent) => {
                  const state = agents[agent.id];
                  const Icon = agent.icon;
                  return (
                    <div
                      key={agent.id}
                      className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                        state.status === "running" ? "bg-primary/5 border border-primary/20" : "border border-transparent"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${agent.colorClass}`}>
                        <Icon className="h-5 w-5 text-background" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{agent.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{agent.desc}</div>
                      </div>
                      <span className={`status-badge status-badge-${state.status}`}>
                        {state.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {state.status === "done" && <CheckCircle2 className="h-3 w-3" />}
                        {state.status === "waiting" && <Clock className="h-3 w-3" />}
                        {state.message || (state.status === "waiting" ? "Idle" : "")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Log */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <List className="h-5 w-5" /> Log
              </h2>
              <div ref={logRef} className="bg-muted rounded-xl p-4 font-mono text-sm max-h-[250px] overflow-y-auto space-y-1">
                {logs.length === 0 && <div className="text-muted-foreground">No activity yet</div>}
                {logs.map((l, i) => (
                  <div key={i} className="text-muted-foreground border-l-2 border-primary/30 pl-2">
                    <span className="text-muted-foreground/60 mr-2">[{l.time}]</span>{l.text}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div>
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Eye className="h-5 w-5" /> Live Preview
              </h2>
              <div className="bg-foreground/5 rounded-2xl overflow-hidden h-[400px] resize-y border border-border">
                {result ? (
                  <iframe srcDoc={previewHTML} title="preview" sandbox="allow-scripts" className="w-full h-full border-none" />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
                    <Code className="h-12 w-12" />
                    <p>Generated project will appear here</p>
                  </div>
                )}
              </div>

              {result && (
                <>
                  <div className="bg-muted rounded-xl mt-4 divide-y divide-border">
                    {["index.html", "style.css", "script.js"].map((f) => (
                      <div key={f} className="flex items-center gap-2 px-4 py-2 font-mono text-sm">
                        <FileCode className="h-4 w-4 text-primary" /> {f}
                      </div>
                    ))}
                  </div>
                  <Button variant="heroOutline" className="mt-4" onClick={handleDownload}>
                    <Download className="h-4 w-4" /> Download .zip (simulated)
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    * In the real system this would be a proper .zip file.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
