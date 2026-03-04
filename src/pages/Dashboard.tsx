import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Brain, Search, Code, Paintbrush, Gauge, Terminal, Bot, List, Eye,
  FileCode, Download, Loader2, CheckCircle2, Clock, ArrowLeft,
  ChevronDown, ChevronUp, MessageSquare, Zap, Activity, Sparkles, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";

const AGENTS = [
  { id: "supervisor", name: "Supervisor", desc: "Orchestrates the workflow", icon: Brain, colorClass: "bg-secondary" },
  { id: "analyst", name: "Analyst", desc: "Analyzes and plans", icon: Search, colorClass: "bg-primary" },
  { id: "developer", name: "Developer", desc: "Writes the code", icon: Code, colorClass: "bg-accent" },
  { id: "designer", name: "Designer", desc: "Creates the styles", icon: Paintbrush, colorClass: "bg-[hsl(45,90%,55%)]" },
  { id: "optimizer", name: "Optimizer", desc: "Optimizes output", icon: Gauge, colorClass: "bg-destructive" },
] as const;

type AgentId = (typeof AGENTS)[number]["id"];
type AgentStatus = "waiting" | "running" | "done";

interface AgentState { status: AgentStatus; message: string; progress: number; thoughts: string[]; }
interface LogEntry { time: string; text: string; agent?: string; }
interface WorkflowResult {
  code: { html: string; js: string };
  styles: { css: string };
  optimized: { html: string; css: string; js: string };
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/polymath-agents`;

function MilestoneTimeline({ milestones }: { milestones: string[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-3 px-1 scrollbar-none">
      {milestones.map((m, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0 animate-fade-in">
          <div className="w-2.5 h-2.5 rounded-full bg-accent border-2 border-accent/30" />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{m}</span>
          {i < milestones.length - 1 && <div className="w-6 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}

function WorkflowStats({ agents }: { agents: Record<AgentId, AgentState> }) {
  const total = AGENTS.length;
  const done = AGENTS.filter(a => agents[a.id].status === "done").length;
  const running = AGENTS.filter(a => agents[a.id].status === "running").length;
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span>{running} active</span>
      </div>
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
        <span>{done}/{total} complete</span>
      </div>
      <div className="flex-1">
        <Progress value={(done / total) * 100} className="h-1.5" />
      </div>
    </div>
  );
}

function ThinkingBubble({ thoughts }: { thoughts: string[] }) {
  if (thoughts.length === 0) return null;
  const latest = thoughts[thoughts.length - 1];
  return (
    <div className="mt-2 ml-13 animate-fade-in">
      <div className="relative bg-primary/10 border border-primary/20 rounded-xl px-3 py-2 text-xs text-primary">
        <MessageSquare className="absolute -left-1 -top-1 h-3 w-3 text-primary/50" />
        <span className="italic">{latest}</span>
      </div>
    </div>
  );
}

const initAgents = () =>
  Object.fromEntries(AGENTS.map((a) => [a.id, { status: "waiting" as AgentStatus, message: "", progress: 0, thoughts: [] }])) as Record<AgentId, AgentState>;

export default function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<AgentId | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, AgentState>>(initAgents);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [milestones, setMilestones] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"preview" | "html" | "css" | "js">("preview");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

  const handleStart = async () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setResult(null);
    setMilestones([]);
    setExpandedAgent(null);
    setActiveTab("preview");
    setError(null);
    setAgents(initAgents());

    try {
      const resp = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          toast({ title: "Rate limited", description: "Too many requests. Please wait and try again.", variant: "destructive" });
          setIsRunning(false);
          return;
        }
        if (resp.status === 402) {
          toast({ title: "Credits required", description: "Please add credits to your workspace.", variant: "destructive" });
          setIsRunning(false);
          return;
        }
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const evt = JSON.parse(jsonStr);

            if (evt.type === "agent") {
              const id = evt.agent as AgentId;
              setAgents((prev) => ({
                ...prev,
                [id]: {
                  status: evt.status,
                  message: evt.message,
                  progress: evt.progress,
                  thoughts: evt.thought ? [...prev[id].thoughts, evt.thought] : prev[id].thoughts,
                },
              }));
            } else if (evt.type === "log") {
              setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text: evt.text, agent: evt.agent }]);
            } else if (evt.type === "milestone") {
              setMilestones((prev) => [...prev, evt.text]);
            } else if (evt.type === "result") {
              setResult(evt as unknown as WorkflowResult);
            } else if (evt.type === "error") {
              setError(evt.message);
              toast({ title: "Agent Error", description: evt.message, variant: "destructive" });
            }
          } catch {
            // partial JSON, wait for more
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  };

  const previewHTML = result
    ? `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${result.optimized.css}</style></head><body>${result.optimized.html}<script>${result.optimized.js}<\/script></body></html>`
    : "";

  const handleDownload = () => {
    if (!result) return;
    const full = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<style>\n${result.optimized.css}\n</style>\n</head>\n<body>\n${result.optimized.html}\n<script>\n${result.optimized.js}\n</script>\n</body>\n</html>`;
    const blob = new Blob([full], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "polymath-output.html"; a.click();
    URL.revokeObjectURL(url);
  };

  const getAgentColor = (id: string) => {
    const colors: Record<string, string> = {
      supervisor: "text-secondary", analyst: "text-primary",
      developer: "text-accent", designer: "text-[hsl(45,90%,55%)]", optimizer: "text-destructive",
    };
    return colors[id] || "text-muted-foreground";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 bg-background/90 backdrop-blur-md border-b border-border z-50">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 flex items-center h-[70px] gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon" aria-label="Back to home">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl md:text-3xl font-extrabold gradient-text">Polymath Dashboard</h1>
          <div className="ml-auto">
            <WorkflowStats agents={agents} />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 md:p-8">
        {milestones.length > 0 && (
          <div className="mb-4">
            <MilestoneTimeline milestones={milestones} />
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

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
                placeholder="Enter the mystery prompt here… (e.g. 'Build a weather dashboard with 5-day forecast')"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isRunning}
              />
              <div className="flex items-center gap-3">
                <Button variant="hero" size="lg" onClick={handleStart} disabled={isRunning || !prompt.trim()}>
                  {isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /> AI Agents Working…</> : <><Sparkles className="h-4 w-4" /> Start AI Agents</>}
                </Button>
                {isRunning && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Real AI agents are building your app…
                  </span>
                )}
              </div>
            </div>

            {/* Agents */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Bot className="h-5 w-5" /> AI Agents
              </h2>
              <div className="space-y-2">
                {AGENTS.map((agent) => {
                  const state = agents[agent.id];
                  const Icon = agent.icon;
                  const isExpanded = expandedAgent === agent.id;
                  return (
                    <div key={agent.id} className="animate-fade-in">
                      <button
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer hover:bg-muted/50 ${
                          state.status === "running" ? "bg-primary/5 border border-primary/20" : "border border-transparent"
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${agent.colorClass} transition-transform ${state.status === "running" ? "scale-110" : ""}`}>
                          <Icon className="h-5 w-5 text-background" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="font-semibold text-sm">{agent.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{state.message || agent.desc}</div>
                          {state.status !== "waiting" && <Progress value={state.progress} className="h-1 mt-1.5" />}
                        </div>
                        <span className={`status-badge status-badge-${state.status} shrink-0`}>
                          {state.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                          {state.status === "done" && <CheckCircle2 className="h-3 w-3" />}
                          {state.status === "waiting" && <Clock className="h-3 w-3" />}
                          {state.status}
                        </span>
                        {state.thoughts.length > 0 && (
                          isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                      {isExpanded && state.thoughts.length > 0 && (
                        <div className="ml-[52px] mt-1 space-y-1 animate-fade-in">
                          {state.thoughts.map((t, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <Zap className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                              <span className="text-muted-foreground">{t}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!isExpanded && state.status === "running" && <ThinkingBubble thoughts={state.thoughts} />}
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
                  <div key={i} className="text-muted-foreground border-l-2 border-primary/30 pl-2 animate-fade-in">
                    <span className="text-muted-foreground/60 mr-2">[{l.time}]</span>
                    {l.agent && <span className={`font-semibold mr-1 ${getAgentColor(l.agent)}`}>{l.agent}:</span>}
                    {l.text}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div>
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Eye className="h-5 w-5" /> Output
              </h2>

              {result && (
                <div className="flex gap-1 mb-4 bg-muted rounded-xl p-1">
                  {(["preview", "html", "css", "js"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        activeTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab === "preview" ? "Preview" : tab.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              <div className="bg-foreground/5 rounded-2xl overflow-hidden h-[400px] border border-border">
                {result ? (
                  activeTab === "preview" ? (
                    <iframe srcDoc={previewHTML} title="preview" sandbox="allow-scripts" className="w-full h-full border-none" />
                  ) : (
                    <pre className="p-4 text-xs font-mono text-muted-foreground overflow-auto h-full whitespace-pre-wrap">
                      {activeTab === "html" && result.optimized.html}
                      {activeTab === "css" && result.optimized.css}
                      {activeTab === "js" && result.optimized.js}
                    </pre>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
                    <Code className="h-12 w-12" />
                    <p>{isRunning ? "AI agents are generating your app…" : "Generated project will appear here"}</p>
                    {isRunning && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
                  </div>
                )}
              </div>

              {result && (
                <div className="mt-4 flex items-center gap-3">
                  <Button variant="heroOutline" onClick={handleDownload}>
                    <Download className="h-4 w-4" /> Download HTML
                  </Button>
                  <span className="text-xs text-muted-foreground">AI-generated • 3 files</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
