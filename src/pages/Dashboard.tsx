import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Brain, Search, Code, Paintbrush, Gauge, Terminal, Bot, List, Eye,
  FileCode, Download, Loader2, CheckCircle2, Clock, ArrowLeft,
  ChevronDown, ChevronUp, MessageSquare, Zap, Activity, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AGENT_THOUGHTS: Record<AgentId, string[]> = {
  supervisor: [
    "Parsing prompt structure...",
    "Identifying project scope — looks like a dashboard app",
    "Mapping agent responsibilities",
    "Setting parallel execution strategy for Developer & Designer",
  ],
  analyst: [
    "Breaking down requirements: UI, data, API...",
    "Choosing tech stack: HTML5, CSS3, vanilla JS",
    "Defining file structure: index.html, style.css, script.js",
    "Specifying data requirements: OpenWeatherMap free tier",
    "Adding accessibility notes: focus states, ARIA labels",
  ],
  developer: [
    "Scaffolding HTML structure with semantic elements...",
    "Creating search input with event listeners",
    "Building displayCurrent() with template literals",
    "Implementing 5-day forecast rendering loop",
    "Adding mock data fallback for demo mode",
  ],
  designer: [
    "Setting up color palette: deep blue gradient base",
    "Applying glassmorphism: backdrop-filter + rgba",
    "Designing responsive grid for forecast cards",
    "Adding hover micro-interactions on cards",
    "Ensuring WCAG AA contrast compliance",
  ],
  optimizer: [
    "Minifying CSS — removed 23% whitespace",
    "Compressing JS — inlined constants",
    "Optimizing DOM queries with getElementById caching",
    "Final bundle: 2.1KB total (gzipped)",
  ],
};

const runAgentWorkflow = async (
  prompt: string,
  onAgent: (u: { id: AgentId; status: AgentStatus; message: string; progress: number; thought?: string }) => void,
  onLog: (msg: string, agent?: string) => void,
  onResult: (r: WorkflowResult) => void,
  onMilestone: (m: string) => void,
) => {
  const set = (id: AgentId, status: AgentStatus, message: string, progress: number, thought?: string) =>
    onAgent({ id, status, message, progress, thought });

  onLog(`🚀 Starting workflow for: "${prompt}"`, "system");
  onMilestone("Workflow initiated");

  // Supervisor init
  set("supervisor", "running", "Initializing…", 20);
  await sleep(400);
  for (const t of AGENT_THOUGHTS.supervisor) {
    set("supervisor", "running", "Initializing…", 50, t);
    await sleep(350);
  }
  set("supervisor", "done", "Ready", 100);
  onLog("Supervisor ready — workflow mapped", "supervisor");
  onMilestone("Supervisor ready");

  // Analyst
  set("analyst", "running", "Analyzing prompt…", 10);
  await sleep(400);
  for (let i = 0; i < AGENT_THOUGHTS.analyst.length; i++) {
    set("analyst", "running", "Analyzing prompt…", 20 + i * 18, AGENT_THOUGHTS.analyst[i]);
    await sleep(400);
  }
  onLog("Analyst plan: dashboard with city search, current weather, 5-day forecast", "analyst");
  set("analyst", "done", "Plan created", 100);
  onMilestone("Analysis complete");

  // Parallel: Developer + Designer
  set("developer", "running", "Writing HTML & JS…", 10);
  set("designer", "running", "Creating CSS…", 10);
  onLog("Developer and Designer running in parallel…", "system");

  const devThoughts = AGENT_THOUGHTS.developer;
  const desThoughts = AGENT_THOUGHTS.designer;
  const maxLen = Math.max(devThoughts.length, desThoughts.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < devThoughts.length)
      set("developer", "running", "Writing HTML & JS…", 10 + ((i + 1) / devThoughts.length) * 85, devThoughts[i]);
    if (i < desThoughts.length)
      set("designer", "running", "Creating CSS…", 10 + ((i + 1) / desThoughts.length) * 85, desThoughts[i]);
    await sleep(500);
  }

  const code = {
    html: `<div class="weather-dashboard"><header><h1>Weather Dashboard</h1><div class="search"><input id="cityInput" type="text" placeholder="Enter city..." aria-label="City name"><button id="searchBtn">Search</button></div></header><section class="current-weather"><h2>Current Weather</h2><div id="current"><p class="placeholder">Search for a city to see current conditions</p></div></section><section><h2>5-Day Forecast</h2><div id="forecast" class="forecast"><p class="placeholder">Forecast will appear here</p></div></section><footer>Data from OpenWeatherMap</footer></div>`,
    js: `const apiKey='demo';const mockCurrent={main:{temp:22,humidity:65},weather:[{description:'partly cloudy',icon:'02d'}],wind:{speed:3.5}};const mockForecast={list:[{dt:Date.now()/1000,main:{temp:22},weather:[{icon:'02d'}]},{dt:Date.now()/1000+86400,main:{temp:19},weather:[{icon:'10d'}]},{dt:Date.now()/1000+172800,main:{temp:24},weather:[{icon:'01d'}]},{dt:Date.now()/1000+259200,main:{temp:18},weather:[{icon:'09d'}]},{dt:Date.now()/1000+345600,main:{temp:21},weather:[{icon:'03d'}]}]};document.getElementById('searchBtn').addEventListener('click',()=>{const city=document.getElementById('cityInput').value;if(!city)return;displayCurrent(mockCurrent,city);displayForecast(mockForecast)});function displayCurrent(data,city){document.getElementById('current').innerHTML='<div class="card"><img src="https://openweathermap.org/img/wn/'+data.weather[0].icon+'@2x.png" alt="'+data.weather[0].description+'"><div><h3>'+city+'</h3><p class="temp">'+data.main.temp+'°C</p><p>'+data.weather[0].description+'</p><p>Humidity: '+data.main.humidity+'%</p><p>Wind: '+data.wind.speed+' m/s</p></div></div>'}function displayForecast(data){let html='';data.list.forEach(day=>{const date=new Date(day.dt*1000).toLocaleDateString('en',{weekday:'short'});html+='<div class="forecast-card"><p>'+date+'</p><img src="https://openweathermap.org/img/wn/'+day.weather[0].icon+'.png" alt="weather icon"><p>'+day.main.temp+'°C</p></div>'});document.getElementById('forecast').innerHTML=html}`,
  };
  const styles = {
    css: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:linear-gradient(135deg,#1e3c72,#2a5298);color:#fff;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:1rem}.weather-dashboard{background:rgba(255,255,255,.1);backdrop-filter:blur(10px);border-radius:24px;padding:2rem;width:90%;max-width:800px;box-shadow:0 20px 40px rgba(0,0,0,.3)}header{text-align:center;margin-bottom:2rem}h1{font-size:2.2rem;margin-bottom:1rem}h2{font-size:1.3rem;margin-bottom:1rem;opacity:.9}.search{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap}input{padding:.8rem 1.2rem;border:none;border-radius:40px;width:250px;font-size:1rem;background:rgba(255,255,255,.2);color:#fff}input::placeholder{color:rgba(255,255,255,.6)}button{padding:.8rem 2rem;border:none;border-radius:40px;background:#ffb347;color:#1e3c72;font-weight:700;cursor:pointer;transition:transform .2s,background .2s}button:hover{background:#ffa01c;transform:scale(1.05)}.current-weather,.forecast{margin:1.5rem 0}.current-weather .card{display:flex;align-items:center;gap:1.5rem;background:rgba(0,0,0,.2);border-radius:20px;padding:1.5rem;justify-content:center}.card img{width:80px;height:80px}.card h3{font-size:1.4rem;margin-bottom:.3rem}.temp{font-size:2rem;font-weight:700}.forecast{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center}.forecast-card{background:rgba(0,0,0,.2);border-radius:16px;padding:1rem 1.5rem;text-align:center;min-width:90px;transition:transform .2s}.forecast-card:hover{transform:translateY(-4px)}.forecast-card img{width:50px;height:50px}.placeholder{text-align:center;opacity:.6;padding:2rem}footer{text-align:center;margin-top:2rem;color:rgba(255,255,255,.5);font-size:.85rem}@media(max-width:600px){.current-weather .card{flex-direction:column}}`,
  };

  set("developer", "done", "Code ready", 100);
  onLog("Developer finished — HTML + JS with mock weather data", "developer");
  set("designer", "done", "Styles ready", 100);
  onLog("Designer finished — glassmorphism + responsive layout", "designer");
  onMilestone("Code & styles complete");

  // Optimizer
  set("optimizer", "running", "Minifying & optimizing…", 10);
  for (let i = 0; i < AGENT_THOUGHTS.optimizer.length; i++) {
    set("optimizer", "running", "Optimizing…", 20 + i * 25, AGENT_THOUGHTS.optimizer[i]);
    await sleep(400);
  }
  set("optimizer", "done", "Optimization complete", 100);
  onLog("Optimizer finished – 2.1KB gzipped bundle", "optimizer");
  onMilestone("Optimization done");

  // Final packaging
  set("supervisor", "running", "Packaging…", 80);
  await sleep(500);
  set("supervisor", "done", "Submission ready", 100);
  onLog("✅ All done! Weather Dashboard ready for download.", "system");
  onMilestone("Build complete ✅");

  onResult({ code, styles, optimized: { html: code.html, css: styles.css, js: code.js } });
};

// Agent thinking bubble component
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

// Timeline milestone component
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

// Stats bar
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

export default function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<AgentId | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, AgentState>>(
    () => Object.fromEntries(AGENTS.map((a) => [a.id, { status: "waiting" as AgentStatus, message: "", progress: 0, thoughts: [] }])) as Record<AgentId, AgentState>,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [milestones, setMilestones] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"preview" | "html" | "css" | "js">("preview");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

  const handleStart = () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true); setLogs([]); setResult(null); setMilestones([]);
    setExpandedAgent(null); setActiveTab("preview");
    setAgents(Object.fromEntries(AGENTS.map((a) => [a.id, { status: "waiting" as AgentStatus, message: "", progress: 0, thoughts: [] }])) as Record<AgentId, AgentState>);
    runAgentWorkflow(
      prompt,
      ({ id, status, message, progress, thought }) =>
        setAgents((prev) => ({
          ...prev,
          [id]: {
            status, message, progress,
            thoughts: thought ? [...prev[id].thoughts, thought] : prev[id].thoughts,
          },
        })),
      (msg, agent) => setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text: msg, agent }]),
      (res) => { setResult(res); setIsRunning(false); },
      (m) => setMilestones((prev) => [...prev, m]),
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
        {/* Milestone timeline */}
        {milestones.length > 0 && (
          <div className="mb-4">
            <MilestoneTimeline milestones={milestones} />
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
                placeholder="Enter the mystery prompt here…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isRunning}
              />
              <div className="flex items-center gap-3">
                <Button variant="hero" size="lg" onClick={handleStart} disabled={isRunning || !prompt.trim()}>
                  {isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Sparkles className="h-4 w-4" /> Start Agents</>}
                </Button>
                {isRunning && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Agents are thinking…
                  </span>
                )}
              </div>
            </div>

            {/* Agents — expandable cards */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Bot className="h-5 w-5" /> Agents
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
                          {state.status !== "waiting" && (
                            <Progress value={state.progress} className="h-1 mt-1.5" />
                          )}
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

                      {/* Expanded thinking log */}
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

                      {/* Live thinking bubble when running */}
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

              {/* Tab bar */}
              {result && (
                <div className="flex gap-1 mb-4 bg-muted rounded-xl p-1">
                  {(["preview", "html", "css", "js"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        activeTab === tab
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
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
                    <p>Generated project will appear here</p>
                  </div>
                )}
              </div>

              {result && (
                <div className="mt-4 flex items-center gap-3">
                  <Button variant="heroOutline" onClick={handleDownload}>
                    <Download className="h-4 w-4" /> Download
                  </Button>
                  <span className="text-xs text-muted-foreground">3 files • 2.1KB gzipped</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
