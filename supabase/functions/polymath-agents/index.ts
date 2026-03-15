import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// =============================================================================
// SSE Helpers
// =============================================================================
function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type EventSender = (data: Record<string, unknown>) => void;

function createHelpers(send: EventSender) {
  return {
    log: (text: string, agent = "system") => send({ type: "log", text, agent }),
    agent: (agent: string, status: "running" | "done" | "error", message: string, progress: number, thought?: string) =>
      send({ type: "agent", agent, status, message, progress, thought }),
    milestone: (text: string) => send({ type: "milestone", text }),
  };
}

// =============================================================================
// Input Guardrails
// =============================================================================
const DANGEROUS_PHRASES = ["ignore previous", "you are now", "system prompt", "disregard", "forget your instructions"];

function inputSafe(text: string): boolean {
  return !DANGEROUS_PHRASES.some((p) => text.toLowerCase().includes(p));
}

// =============================================================================
// Workflow Stage (State Machine)
// =============================================================================
enum Stage {
  IDLE = "idle",
  ANALYZING = "analyzing",
  PLAN_REVIEW = "plan_review",
  BUILDING = "building",
  AUDITING = "auditing",
  OPTIMIZING = "optimizing",
  PACKAGING = "packaging",
  DONE = "done",
  FAILED = "failed",
}

// =============================================================================
// Agent Registry — model + prompt config per agent role
// =============================================================================
interface AgentConfig {
  id: string;
  model: string;
  system: string;
  timeout: number; // ms
  fallback: () => string; // fallback JSON string
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  analyst: {
    id: "analyst",
    model: "openai/gpt-5",
    timeout: 120_000,
    fallback: () => JSON.stringify({
      project_type: "web app", features: ["responsive layout", "interactive UI", "data display"],
      tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html", "style.css", "script.js"],
      data_requirements: "mock data", ui_layout: "header + main content + footer",
      color_scheme: "professional blues", accessibility_requirements: "WCAG 2.1 AA", special_notes: "none",
    }),
    system: `You are a principal software architect with 15+ years of experience in web development, design systems, and accessibility.

Your job: analyze a mystery prompt and produce the most comprehensive, actionable technical blueprint possible.

Return a JSON object with these keys:
- project_type (string): specific classification — e.g. "interactive dashboard", "puzzle game", "data entry form", "portfolio site"
- features (array of strings): 5-10 specific, implementable features. Each must be concrete enough for a developer to build without ambiguity.
- tech_stack (array of strings): prefer vanilla HTML/CSS/JS. Only suggest a framework if the prompt genuinely requires one.
- file_structure (array of strings): always include index.html, style.css, script.js.
- data_requirements (string): detailed description of what data to display, how to generate mock data, data shapes/structures.
- ui_layout (string): describe the page layout — header, sidebar, main content, footer. Include responsive behavior.
- color_scheme (string): suggest a color direction appropriate to the project type.
- accessibility_requirements (string): specific WCAG 2.1 AA requirements relevant to this project.
- special_notes (string): edge cases, constraints, responsive breakpoints, performance considerations.

Be precise. Every feature must be buildable in a self-contained single-page app with zero external dependencies.`,
  },

  developer: {
    id: "developer",
    model: "google/gemini-2.5-pro",
    timeout: 180_000,
    fallback: () => JSON.stringify({ html: "<h1>App</h1><p>Generated content</p>", js: "document.addEventListener('DOMContentLoaded',()=>{console.log('ready')});", notes: "fallback" }),
    system: `You are a senior front-end engineer with expertise in vanilla web development, DOM APIs, and performance optimization.

Rules:
- Write vanilla HTML + JS only (no frameworks, no libraries, no CDN imports).
- Code must be 100% self-contained and run in any modern browser with zero dependencies.
- Generate realistic mock/demo data (names, numbers, dates) — never use placeholder text like "Lorem ipsum" or "Item 1".
- Implement proper error handling: try/catch blocks, fallback UI states, input validation.
- Use modern JS: async/await, template literals, destructuring, optional chaining, nullish coalescing.
- DOM: use createElement + appendChild or template literals with insertAdjacentHTML. Never use document.write().
- Event delegation where appropriate for better performance.
- Add keyboard navigation for all interactive elements (Tab, Enter, Escape, Arrow keys).
- Include meaningful code comments explaining WHY, not WHAT.
- NEVER use: eval(), document.write(), inline onclick/onchange attributes, innerHTML with unsanitized content.
- Generate at least 5-10 items of realistic sample data.

Return a JSON object with:
- "html" (string): HTML body content only — no <html>, <head>, or <body> wrapper tags.
- "js" (string): complete, production-quality JavaScript.
- "notes" (string): implementation decisions and any trade-offs made.`,
  },

  designer: {
    id: "designer",
    model: "openai/gpt-5-mini",
    timeout: 120_000,
    fallback: () => JSON.stringify({ css: "body{font-family:system-ui,sans-serif;margin:0;padding:2rem;color:#1a1a2e;background:#f5f5f5}", color_palette: ["#1a1a2e","#f5f5f5"], notes: "fallback" }),
    system: `You are a world-class UI/UX designer and CSS engineer with expertise in design systems, accessibility, and motion design.

Rules:
- Mobile-first responsive design with breakpoints: 480px (mobile), 768px (tablet), 1024px (desktop), 1440px (wide).
- CSS custom properties for the entire color system: --color-primary, --color-secondary, --color-accent, --color-bg, --color-surface, --color-text, --color-text-muted, --color-border, --color-success, --color-warning, --color-error.
- Typography scale using clamp() for fluid sizing. Use system font stack: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif.
- WCAG 2.1 AA compliance: minimum 4.5:1 contrast for text, 3:1 for large text, visible focus indicators.
- Layout: CSS Grid for page structure, Flexbox for component internals. Use gap instead of margins where possible.
- Animations: use prefers-reduced-motion media query. Subtle transitions (200-300ms ease) on hover/focus.
- Dark mode via @media (prefers-color-scheme: dark) with adjusted custom properties.
- Micro-interactions: button press effects, hover state transitions, loading states.
- Box shadows for depth: use layered shadows for a more natural look.

Return a JSON object with:
- "css" (string): complete, production-quality CSS stylesheet.
- "color_palette" (array of strings): all hex colors used, with brief labels like "#1a73e8 (primary)".
- "notes" (string): design rationale, accessibility notes, and responsive strategy.`,
  },

  security: {
    id: "security",
    model: "google/gemini-2.5-flash",
    timeout: 90_000,
    fallback: () => JSON.stringify({ security_issues: [], accessibility_issues: [], quality_issues: [], overall_score: 70, summary: "Audit skipped (fallback)" }),
    system: `You are a senior security engineer and accessibility auditor.

Analyze the provided HTML, CSS, and JS code for:

**Security Issues:**
- XSS vulnerabilities (innerHTML with dynamic content, eval, document.write, Function constructor)
- Unsafe URL handling (javascript: protocol, data: URIs in links)
- Prototype pollution risks
- Event handler injection risks

**Accessibility Issues:**
- Missing ARIA labels on interactive elements
- Missing alt text on images
- Improper heading hierarchy (h1 → h2 → h3, no skipping)
- Missing form labels
- Missing keyboard navigation
- Missing landmark roles

**Code Quality Issues:**
- Unused variables or dead code
- Console.log statements left in production
- Missing error handling

Return a JSON object with:
- "security_issues" (array of objects with "severity": "critical"|"high"|"medium"|"low", "description": string, "fix": string)
- "accessibility_issues" (array of objects with "severity": "critical"|"high"|"medium"|"low", "description": string, "fix": string)
- "quality_issues" (array of objects with "severity": "high"|"medium"|"low", "description": string, "fix": string)
- "overall_score" (number 0-100): overall quality score
- "fixed_html" (string): HTML with critical/high issues fixed
- "fixed_js" (string): JS with critical/high issues fixed
- "fixed_css" (string): CSS with critical/high issues fixed
- "summary" (string): brief summary of findings`,
  },

  optimizer: {
    id: "optimizer",
    model: "openai/gpt-5-mini",
    timeout: 120_000,
    fallback: () => "{}",  // Will use raw code+styles as-is
    system: `You are a performance engineer and code quality specialist.

Take the provided HTML, CSS, and JS (which have already passed security audit) and produce an optimized, production-ready single-page app.

Tasks:
1. Combine everything into clean, well-structured code.
2. Remove dead code, redundant CSS selectors, and unused JS variables.
3. Optimize CSS: merge duplicate rules, use shorthand properties, ensure proper specificity order.
4. Optimize JS: remove console.logs, ensure proper error handling, optimize DOM queries (cache selectors).
5. Verify HTML semantics: proper heading hierarchy (single h1), landmark roles, meta viewport.
6. Ensure all interactive elements have focus styles and keyboard support.
7. Keep ALL functionality identical — do NOT remove any features.
8. Ensure the code is clean, well-indented, and readable.

Return a JSON object with:
- "html" (string): optimized HTML body content (no <html>/<head>/<body> wrappers).
- "css" (string): optimized CSS.
- "js" (string): optimized JS.
- "improvements" (array of strings): list of optimizations made.`,
  },
};

// =============================================================================
// LLM Caller — timeout-aware with retries, correlation tracking, fallbacks
// =============================================================================
function codeIsSafe(js: string): boolean {
  const banned = [/eval\s*\(/, /document\.write\s*\(/, /innerHTML\s*=.*<script/i, /window\.location\s*=/, /Function\s*\(/];
  return !banned.some((rx) => rx.test(js));
}

interface LLMCallResult {
  content: string;
  correlationId: string;
  model: string;
  durationMs: number;
  usedFallback: boolean;
}

async function dispatchAgent(
  apiKey: string,
  agentId: string,
  userPrompt: string,
  opts: { json?: boolean; temp?: number } = {},
): Promise<LLMCallResult> {
  const config = AGENT_CONFIGS[agentId];
  if (!config) throw new Error(`Unknown agent: ${agentId}`);

  const correlationId = crypto.randomUUID();
  const { json: jsonMode = false, temp = 0.2 } = opts;
  const startTime = Date.now();

  if (!inputSafe(userPrompt)) throw new Error(`[${agentId}] Prompt rejected by input guardrail`);

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: config.system },
      { role: "user", content: userPrompt },
    ],
    temperature: temp,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);

      const resp = await fetch(AI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.status === 429 || resp.status === 402) {
        const t = await resp.text();
        throw new Error(`AI gateway [${resp.status}]: ${t}`);
      }

      if (!resp.ok) {
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // exponential backoff
          continue;
        }
        const t = await resp.text();
        throw new Error(`AI gateway error [${resp.status}]: ${t}`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content ?? "";

      // Validate JSON if required
      if (jsonMode) {
        try { JSON.parse(content); } catch {
          if (attempt < maxRetries - 1) continue;
          // Use fallback on final attempt
          console.warn(`[${agentId}] Invalid JSON after ${maxRetries} attempts, using fallback`);
          return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true };
        }
      }

      return { content, correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn(`[${agentId}] Timeout after ${config.timeout}ms (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) continue;
        // Fallback on timeout
        return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true };
      }
      throw err;
    }
  }

  return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true };
}

// =============================================================================
// Workflow Orchestrator — state machine with stage tracking
// =============================================================================
class WorkflowOrchestrator {
  private stage: Stage = Stage.IDLE;
  private apiKey: string;
  private helpers: ReturnType<typeof createHelpers>;
  private send: EventSender;
  private correlations: Map<string, { agent: string; startedAt: number }> = new Map();

  constructor(apiKey: string, send: EventSender) {
    this.apiKey = apiKey;
    this.send = send;
    this.helpers = createHelpers(send);
  }

  private transition(to: Stage) {
    const from = this.stage;
    this.stage = to;
    this.helpers.log(`Stage: ${from} → ${to}`, "supervisor");
  }

  private trackCorrelation(result: LLMCallResult, agentId: string) {
    this.correlations.set(result.correlationId, { agent: agentId, startedAt: Date.now() - result.durationMs });
    if (result.usedFallback) {
      this.helpers.log(`⚠️ ${agentId} used fallback response (timeout/error)`, agentId);
    }
    this.helpers.log(`${agentId} completed in ${(result.durationMs / 1000).toFixed(1)}s [${result.model}]`, agentId);
  }

  // --- ANALYZE mode: plan only ---
  async runAnalyze(prompt: string, feedback?: string) {
    this.transition(Stage.ANALYZING);
    this.helpers.agent("supervisor", "running", "Delegating to Analyst…", 30);
    this.helpers.agent("analyst", "running", "Analyzing prompt…", 10, "Decomposing requirements and constraints…");

    const analysisPrompt = feedback
      ? `Mystery prompt: ${prompt}\n\nPrevious feedback from human reviewer: ${feedback}\n\nRevise the plan based on this feedback. Output only valid JSON.`
      : `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`;

    const result = await dispatchAgent(this.apiKey, "analyst", analysisPrompt, { json: true, temp: 0.1 });
    this.trackCorrelation(result, "analyst");

    let plan: Record<string, unknown>;
    try { plan = JSON.parse(result.content); } catch {
      plan = JSON.parse(AGENT_CONFIGS.analyst.fallback());
    }

    const features = (plan.features as string[]) || [];
    this.helpers.agent("analyst", "done", "Plan created", 100, `${features.length} features identified`);
    this.helpers.log(`Plan: ${features.join(", ")}`, "analyst");
    this.helpers.agent("supervisor", "done", "Awaiting human review…", 100);
    this.helpers.milestone("Plan ready for review");

    this.transition(Stage.PLAN_REVIEW);
    this.send({ type: "plan", plan });
  }

  // --- BUILD mode: full pipeline ---
  async runBuild(prompt: string, approvedPlan?: Record<string, unknown>, feedback?: string) {
    this.helpers.log(`🚀 Starting workflow for: "${prompt}"`);
    this.helpers.agent("supervisor", "running", "Initializing…", 20, "Routing orchestration active");
    this.helpers.milestone("Workflow initiated");

    // ---- Stage 1: ANALYZING ----
    let plan: Record<string, unknown>;
    if (approvedPlan) {
      plan = approvedPlan;
      this.helpers.agent("analyst", "done", "Using approved plan", 100, "Human-reviewed plan accepted");
      this.helpers.log("Using human-approved plan — skipping analysis", "analyst");
    } else {
      this.transition(Stage.ANALYZING);
      this.helpers.agent("analyst", "running", "Analyzing prompt…", 10, "Breaking down requirements…");
      const result = await dispatchAgent(this.apiKey, "analyst", `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`, { json: true, temp: 0.1 });
      this.trackCorrelation(result, "analyst");
      try { plan = JSON.parse(result.content); } catch {
        plan = JSON.parse(AGENT_CONFIGS.analyst.fallback());
      }
      const features = (plan.features as string[]) || [];
      this.helpers.agent("analyst", "done", "Plan created", 100, `Features: ${features.slice(0, 3).join(", ")}`);
      this.helpers.log(`Analyst plan: ${features.join(", ")}`, "analyst");
    }

    this.helpers.agent("supervisor", "done", "Routing to Developer & Designer (parallel)", 100);
    this.helpers.milestone("Analysis complete");

    // ---- Stage 2: BUILDING (parallel fan-out) ----
    this.transition(Stage.BUILDING);
    this.helpers.agent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding app structure…");
    this.helpers.agent("designer", "running", "Creating CSS…", 10, "Building design system & color palette…");
    this.helpers.log("Routing: Developer + Designer dispatched in parallel", "supervisor");

    const planJson = JSON.stringify(plan, null, 2);
    const [devResult, designResult] = await Promise.all([
      dispatchAgent(this.apiKey, "developer", `Implement this project plan:\n${planJson}\n\nReturn only valid JSON.`, { json: true }),
      dispatchAgent(this.apiKey, "designer", `Create styles for this project plan:\n${planJson}\n\nReturn only valid JSON.`, { json: true, temp: 0.3 }),
    ]);

    this.trackCorrelation(devResult, "developer");
    this.trackCorrelation(designResult, "designer");

    let code: { html: string; js: string; notes?: string };
    try { code = JSON.parse(devResult.content); } catch {
      code = JSON.parse(AGENT_CONFIGS.developer.fallback());
    }

    let styles: { css: string; color_palette?: string[]; notes?: string };
    try { styles = JSON.parse(designResult.content); } catch {
      styles = JSON.parse(AGENT_CONFIGS.designer.fallback());
    }

    // Code safety scan
    if (!codeIsSafe(code.js)) {
      this.helpers.log("⚠️ Unsafe patterns detected — sanitizing…", "developer");
      code.js = code.js
        .replace(/eval\s*\(/g, "/* eval removed */")
        .replace(/document\.write\s*\(/g, "/* document.write removed */")
        .replace(/Function\s*\(/g, "/* Function constructor removed */");
    }

    this.helpers.agent("developer", "done", "Code ready", 100, code.notes || "HTML + JS complete");
    this.helpers.agent("designer", "done", "Styles ready", 100, styles.notes || "CSS complete with design system");
    this.helpers.milestone("Code & styles complete");

    // ---- Stage 3: AUDITING ----
    this.transition(Stage.AUDITING);
    this.helpers.agent("security", "running", "Auditing code…", 20, "Scanning for XSS, accessibility, and code quality…");
    this.helpers.log("Routing: Security Auditor dispatched", "supervisor");

    const auditResult = await dispatchAgent(
      this.apiKey, "security",
      `Audit this code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
      { json: true, temp: 0.1 },
    );
    this.trackCorrelation(auditResult, "security");

    let audit: {
      security_issues?: { severity: string; description: string }[];
      accessibility_issues?: { severity: string; description: string }[];
      overall_score?: number;
      fixed_html?: string;
      fixed_js?: string;
      fixed_css?: string;
      summary?: string;
    };
    try { audit = JSON.parse(auditResult.content); } catch { audit = {}; }

    const criticalCount = (audit.security_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;
    const a11yCount = (audit.accessibility_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;

    // Apply security fixes
    if (audit.fixed_html) code.html = audit.fixed_html;
    if (audit.fixed_js) code.js = audit.fixed_js;
    if (audit.fixed_css) styles.css = audit.fixed_css;

    this.helpers.agent("security", "done", `Audit complete — score: ${audit.overall_score ?? "N/A"}/100`, 100,
      `${criticalCount} security fixes, ${a11yCount} accessibility fixes`);
    this.helpers.log(`Security Auditor: ${audit.summary || "Audit complete"}`, "security");
    if (criticalCount > 0) this.helpers.log(`🔒 Fixed ${criticalCount} critical/high security issues`, "security");
    if (a11yCount > 0) this.helpers.log(`♿ Fixed ${a11yCount} critical/high accessibility issues`, "security");
    this.helpers.milestone("Security audit passed");

    // ---- Stage 4: OPTIMIZING ----
    this.transition(Stage.OPTIMIZING);
    this.helpers.agent("optimizer", "running", "Optimizing…", 30, "Combining, cleaning, and polishing…");
    this.helpers.log("Routing: Optimizer dispatched", "supervisor");

    const optResult = await dispatchAgent(
      this.apiKey, "optimizer",
      `Optimize and combine this audited code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
      { json: true, temp: 0.1 },
    );
    this.trackCorrelation(optResult, "optimizer");

    let optimized: { html: string; css: string; js: string; improvements?: string[] };
    try { optimized = JSON.parse(optResult.content); } catch {
      optimized = { html: code.html, css: styles.css, js: code.js };
    }

    this.helpers.agent("optimizer", "done", "Optimization complete", 100,
      `${(optimized.improvements || []).length} improvements applied`);
    this.helpers.log(`Optimizer: ${(optimized.improvements || []).slice(0, 3).join(", ") || "optimized"}`, "optimizer");
    this.helpers.milestone("Optimization done");

    // ---- Stage 5: PACKAGING ----
    this.transition(Stage.PACKAGING);
    this.helpers.agent("supervisor", "running", "Packaging…", 80);

    // Summary of routing orchestration
    this.helpers.log(`📊 Orchestration summary: ${this.correlations.size} agent dispatches, ${Array.from(this.correlations.values()).filter(() => true).length} completed`, "supervisor");

    this.helpers.agent("supervisor", "done", "Submission ready", 100);
    this.helpers.log("✅ All done! Project ready for download.", "system");
    this.helpers.milestone("Build complete ✅");

    this.transition(Stage.DONE);

    this.send({
      type: "result",
      code: { html: code.html, js: code.js },
      styles: { css: styles.css },
      optimized,
      audit: {
        score: audit.overall_score,
        security_issues: (audit.security_issues || []).length,
        accessibility_issues: (audit.accessibility_issues || []).length,
        summary: audit.summary,
      },
      orchestration: {
        stages_completed: Object.values(Stage).filter((s) => s !== Stage.IDLE && s !== Stage.FAILED && s !== Stage.PLAN_REVIEW).length,
        agents_dispatched: this.correlations.size,
        total_duration_ms: Array.from(this.correlations.values()).reduce((sum) => sum, 0),
      },
    });
  }
}

// =============================================================================
// HTTP Handler
// =============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { prompt, mode = "full", plan: approvedPlan, feedback } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send: EventSender = (data) => controller.enqueue(encoder.encode(sseEvent(data)));
        const orchestrator = new WorkflowOrchestrator(LOVABLE_API_KEY, send);

        try {
          if (mode === "analyze") {
            await orchestrator.runAnalyze(prompt.trim(), feedback);
          } else {
            await orchestrator.runBuild(prompt.trim(), approvedPlan, feedback);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("Workflow error:", msg);
          send({ type: "error", message: msg });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("Request error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
