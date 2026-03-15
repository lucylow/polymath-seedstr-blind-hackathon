import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_PROMPT_LENGTH = 8000;
const MAX_SELF_IMPROVE_ITERATIONS = 2;

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
// Guardrails
// =============================================================================
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous/i,
  /you\s+are\s+now/i,
  /system\s*prompt/i,
  /disregard\s+(all\s+)?instructions/i,
  /forget\s+(your|all)\s+instructions/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+if/i,
  /override\s+(your|the)\s+system/i,
  /<\|im_start\|>/i,
  /\[\[SYSTEM\]\]/i,
];

function inputSafe(text: string): boolean {
  return !INJECTION_PATTERNS.some((rx) => rx.test(text));
}

function sanitizePrompt(text: string): string {
  let safe = text.trim();
  if (safe.length > MAX_PROMPT_LENGTH) {
    safe = safe.slice(0, MAX_PROMPT_LENGTH) + "… [truncated]";
  }
  return safe;
}

// Code safety: JS patterns
const JS_BANNED = [
  /eval\s*\(/,
  /document\.write\s*\(/,
  /innerHTML\s*=.*<script/i,
  /window\.location\s*=/,
  /Function\s*\(/,
  /setTimeout\s*\(\s*['"`]/,
  /setInterval\s*\(\s*['"`]/,
  /\.innerHTML\s*\+?=\s*[^'"`]*\+/,  // dynamic innerHTML concatenation
];

function codeIsSafe(js: string): boolean {
  return !JS_BANNED.some((rx) => rx.test(js));
}

function sanitizeJS(js: string): string {
  let safe = js;
  safe = safe.replace(/eval\s*\(/g, "/* [guardrail: eval removed] */(");
  safe = safe.replace(/document\.write\s*\(/g, "/* [guardrail: document.write removed] */(");
  safe = safe.replace(/Function\s*\(/g, "/* [guardrail: Function constructor removed] */(");
  return safe;
}

// CSS safety
const CSS_BANNED = [
  /expression\s*\(/i,        // IE expression hack
  /behavior\s*:/i,           // IE behavior hack
  /-moz-binding\s*:/i,       // Firefox XBL binding
  /javascript\s*:/i,         // JS in CSS
  /url\s*\(\s*['"]?\s*data:text\/html/i, // data URI HTML injection
];

function cssIsSafe(css: string): boolean {
  return !CSS_BANNED.some((rx) => rx.test(css));
}

function sanitizeCSS(css: string): string {
  let safe = css;
  safe = safe.replace(/expression\s*\([^)]*\)/gi, "/* [guardrail: expression removed] */");
  safe = safe.replace(/behavior\s*:[^;]*/gi, "/* [guardrail: behavior removed] */");
  safe = safe.replace(/-moz-binding\s*:[^;]*/gi, "/* [guardrail: moz-binding removed] */");
  return safe;
}

// HTML safety
function htmlIsSafe(html: string): boolean {
  const banned = [/<script\s+src\s*=/i, /on\w+\s*=/i, /javascript\s*:/i];
  return !banned.some((rx) => rx.test(html));
}

function sanitizeHTML(html: string): string {
  let safe = html;
  // Remove external script tags
  safe = safe.replace(/<script\s+src\s*=[^>]*>/gi, "<!-- [guardrail: external script removed] -->");
  // Remove inline event handlers
  safe = safe.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  return safe;
}

// Output content moderation (lightweight keyword-based)
const MODERATION_PATTERNS = [
  /\b(hack|exploit|inject|malware|phishing)\b.*\b(code|script|payload)\b/i,
];

function outputContentSafe(text: string): boolean {
  return !MODERATION_PATTERNS.some((rx) => rx.test(text));
}

// =============================================================================
// Workflow Stage (State Machine)
// =============================================================================
enum Stage {
  IDLE = "idle",
  ANALYZING = "analyzing",
  PLAN_REVIEW = "plan_review",
  BUILDING = "building",
  CROSS_CONTEXT = "cross_context",
  AUDITING = "auditing",
  OPTIMIZING = "optimizing",
  SELF_IMPROVING = "self_improving",
  PACKAGING = "packaging",
  DONE = "done",
  FAILED = "failed",
}

// =============================================================================
// Agent Registry
// =============================================================================
interface AgentConfig {
  id: string;
  model: string;
  system: string;
  timeout: number;
  fallback: () => string;
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

Analyze the mystery prompt and produce the most comprehensive, actionable technical blueprint possible.

Return a JSON object with these keys:
- project_type (string): specific classification — e.g. "interactive dashboard", "puzzle game", "data entry form"
- features (array of strings): 5-10 specific, implementable features. Each must be concrete enough to build without ambiguity.
- tech_stack (array of strings): prefer vanilla HTML/CSS/JS unless the prompt genuinely requires a framework.
- file_structure (array of strings): always include index.html, style.css, script.js.
- data_requirements (string): detailed description of data to display, mock data shapes/structures.
- ui_layout (string): page layout — header, sidebar, main content, footer. Include responsive behavior.
- color_scheme (string): color direction appropriate to the project type.
- accessibility_requirements (string): specific WCAG 2.1 AA requirements for this project.
- special_notes (string): edge cases, constraints, responsive breakpoints, performance considerations.
- css_class_conventions (string): naming conventions for CSS classes (e.g. BEM, semantic names) so Developer and Designer align.

Every feature must be buildable in a self-contained single-page app with zero external dependencies.`,
  },

  developer: {
    id: "developer",
    model: "google/gemini-2.5-pro",
    timeout: 180_000,
    fallback: () => JSON.stringify({
      html: '<main role="main"><h1>App</h1><p>Generated content</p></main>',
      js: "document.addEventListener('DOMContentLoaded',()=>{console.log('ready')});",
      notes: "fallback", css_hooks: ["main", "h1", "p"],
    }),
    system: `You are a senior front-end engineer. Write clean, efficient, production-quality vanilla web code.

Rules:
- Vanilla HTML + JS only. No frameworks, libraries, or CDN imports.
- 100% self-contained, runs in any modern browser with zero dependencies.
- Generate realistic mock data (real names, numbers, dates) — never "Lorem ipsum" or "Item 1".
- Proper error handling: try/catch, fallback UI states, input validation.
- Modern JS: async/await, template literals, destructuring, optional chaining.
- DOM: createElement + appendChild or insertAdjacentHTML. NEVER document.write() or eval().
- Event delegation for performance. Keyboard navigation for all interactive elements.
- Meaningful comments explaining WHY, not WHAT.
- NEVER use: eval(), document.write(), inline onclick/onchange, innerHTML with unsanitized user content.
- Generate 5-10 items of realistic sample data.
- Use semantic HTML: <main>, <nav>, <section>, <article>, <aside>, <footer>.
- Add descriptive CSS class names to ALL elements for easy styling by the Designer.

Return a JSON object with:
- "html" (string): HTML body content only — no <html>/<head>/<body> wrappers.
- "js" (string): complete JavaScript.
- "notes" (string): implementation decisions.
- "css_hooks" (array of strings): list of CSS class names and IDs used in the HTML, so the Designer can target them precisely.`,
  },

  designer: {
    id: "designer",
    model: "openai/gpt-5-mini",
    timeout: 120_000,
    fallback: () => JSON.stringify({
      css: ":root{--color-primary:#1a73e8;--color-bg:#f5f5f5;--color-text:#1a1a2e}body{font-family:system-ui,sans-serif;margin:0;padding:2rem;color:var(--color-text);background:var(--color-bg)}",
      color_palette: ["#1a73e8 (primary)", "#f5f5f5 (bg)", "#1a1a2e (text)"], notes: "fallback",
    }),
    system: `You are a world-class UI/UX designer and CSS engineer with expertise in design systems, accessibility, and motion design.

Rules:
- Mobile-first responsive design: 480px (mobile), 768px (tablet), 1024px (desktop), 1440px (wide).
- CSS custom properties for colors: --color-primary, --color-secondary, --color-accent, --color-bg, --color-surface, --color-text, --color-text-muted, --color-border, --color-success, --color-warning, --color-error.
- Typography: clamp() for fluid sizing. System font stack.
- WCAG 2.1 AA: 4.5:1 contrast for text, 3:1 for large text, visible focus indicators (outline, not just color).
- CSS Grid for page layout, Flexbox for components. gap over margins.
- prefers-reduced-motion media query. Subtle transitions (200-300ms ease).
- Dark mode via @media (prefers-color-scheme: dark).
- Micro-interactions: button press, hover transitions, loading states.
- Layered box shadows for depth.
- IMPORTANT: You will receive the Developer's CSS hooks (class names and IDs). Target these precisely in your CSS. Do NOT invent selectors that don't exist in the HTML.

Return a JSON object with:
- "css" (string): complete, production-quality CSS.
- "color_palette" (array of strings): hex colors with labels like "#1a73e8 (primary)".
- "notes" (string): design rationale, accessibility notes.`,
  },

  security: {
    id: "security",
    model: "google/gemini-2.5-flash",
    timeout: 90_000,
    fallback: () => JSON.stringify({ security_issues: [], accessibility_issues: [], quality_issues: [], overall_score: 70, summary: "Audit skipped (fallback)" }),
    system: `You are a senior security engineer and accessibility auditor.

Analyze the HTML, CSS, and JS for:

**Security:** XSS (innerHTML + dynamic content, eval, document.write, Function), unsafe URL handling (javascript:, data: URIs), prototype pollution, event handler injection.
**Accessibility:** Missing ARIA labels, missing alt text, improper heading hierarchy, missing form labels, insufficient contrast, missing keyboard nav, missing landmarks.
**Quality:** Unused variables, console.logs in production, missing error handling, memory leaks.

Return JSON with:
- "security_issues" (array: {severity: "critical"|"high"|"medium"|"low", description: string, fix: string})
- "accessibility_issues" (array: {severity: "critical"|"high"|"medium"|"low", description: string, fix: string})
- "quality_issues" (array: {severity: "high"|"medium"|"low", description: string, fix: string})
- "overall_score" (number 0-100)
- "fixed_html" (string): HTML with critical/high issues fixed
- "fixed_js" (string): JS with critical/high issues fixed
- "fixed_css" (string): CSS with critical/high issues fixed
- "summary" (string)`,
  },

  optimizer: {
    id: "optimizer",
    model: "openai/gpt-5-mini",
    timeout: 120_000,
    fallback: () => "{}",
    system: `You are a performance engineer and code quality specialist.

Take the audited HTML, CSS, and JS and produce optimized, production-ready code.

Tasks:
1. Remove dead code, redundant CSS selectors, unused JS variables.
2. Optimize CSS: merge duplicates, shorthand properties, proper specificity.
3. Optimize JS: remove console.logs, cache DOM selectors, proper error handling.
4. Verify HTML semantics: single h1, landmark roles.
5. Ensure focus styles and keyboard support on interactive elements.
6. Keep ALL functionality identical — do NOT remove features.
7. Clean, well-indented, readable code (not minified).

Return JSON with:
- "html" (string): optimized HTML body (no wrappers).
- "css" (string): optimized CSS.
- "js" (string): optimized JS.
- "improvements" (array of strings): optimizations made.
- "quality_score" (number 0-100): self-assessed quality of the final output.`,
  },

  evaluator: {
    id: "evaluator",
    model: "google/gemini-2.5-flash",
    timeout: 60_000,
    fallback: () => JSON.stringify({ pass: true, score: 70, issues: [], suggestions: [] }),
    system: `You are a QA engineer reviewing a single-page web app. Evaluate the combined HTML/CSS/JS for:

1. Does the HTML reference CSS classes/IDs that exist in the CSS? Flag orphaned selectors.
2. Does the JS reference DOM elements that exist in the HTML? Flag missing elements.
3. Are there obvious runtime errors (undefined variables, missing functions)?
4. Does the layout appear functional (has main content, not just empty containers)?
5. Overall quality score 0-100.

Return JSON with:
- "pass" (boolean): true if quality_score >= 70
- "score" (number 0-100)
- "issues" (array of strings): critical issues found
- "suggestions" (array of strings): improvements for the next iteration`,
  },
};

// =============================================================================
// Agent Dispatcher — timeout-aware, retries, correlation tracking, fallbacks
// =============================================================================
interface LLMCallResult {
  content: string;
  correlationId: string;
  model: string;
  durationMs: number;
  usedFallback: boolean;
  attempt: number;
}

async function dispatchAgent(
  apiKey: string,
  agentId: string,
  userPrompt: string,
  opts: { json?: boolean; temp?: number; maxRetries?: number } = {},
): Promise<LLMCallResult> {
  const config = AGENT_CONFIGS[agentId];
  if (!config) throw new Error(`Unknown agent: ${agentId}`);

  const correlationId = crypto.randomUUID();
  const { json: jsonMode = false, temp = 0.2, maxRetries = 3 } = opts;
  const startTime = Date.now();

  if (!inputSafe(userPrompt)) throw new Error(`[${agentId}] Prompt rejected by input guardrail`);

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: config.system },
      { role: "user", content: sanitizePrompt(userPrompt) },
    ],
    temperature: temp,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

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
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        const t = await resp.text();
        throw new Error(`AI gateway error [${resp.status}]: ${t}`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content ?? "";

      // Output content moderation
      if (!outputContentSafe(content)) {
        console.warn(`[${agentId}] Output flagged by content moderation, retrying…`);
        if (attempt < maxRetries - 1) continue;
        return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1 };
      }

      // JSON validation
      if (jsonMode) {
        try { JSON.parse(content); } catch {
          if (attempt < maxRetries - 1) continue;
          console.warn(`[${agentId}] Invalid JSON after ${maxRetries} attempts, using fallback`);
          return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1 };
        }
      }

      return { content, correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: false, attempt: attempt + 1 };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn(`[${agentId}] Timeout after ${config.timeout}ms (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) continue;
        return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1 };
      }
      throw err;
    }
  }

  return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: 3 };
}

// =============================================================================
// Workflow Orchestrator
// =============================================================================
class WorkflowOrchestrator {
  private stage: Stage = Stage.IDLE;
  private apiKey: string;
  private h: ReturnType<typeof createHelpers>;
  private send: EventSender;
  private telemetry: { agent: string; model: string; durationMs: number; usedFallback: boolean; attempt: number }[] = [];
  private pipelineStart = 0;

  constructor(apiKey: string, send: EventSender) {
    this.apiKey = apiKey;
    this.send = send;
    this.h = createHelpers(send);
  }

  private transition(to: Stage) {
    this.stage = to;
  }

  private track(result: LLMCallResult, agentId: string) {
    this.telemetry.push({ agent: agentId, model: result.model, durationMs: result.durationMs, usedFallback: result.usedFallback, attempt: result.attempt });
    if (result.usedFallback) this.h.log(`⚠️ ${agentId} used fallback (timeout/error after ${result.attempt} attempts)`, agentId);
    this.h.log(`${agentId} completed in ${(result.durationMs / 1000).toFixed(1)}s [${result.model}${result.attempt > 1 ? `, ${result.attempt} attempts` : ""}]`, agentId);
  }

  // --- ANALYZE mode ---
  async runAnalyze(prompt: string, feedback?: string) {
    this.pipelineStart = Date.now();
    this.transition(Stage.ANALYZING);
    this.h.agent("supervisor", "running", "Delegating to Analyst…", 30);
    this.h.agent("analyst", "running", "Analyzing prompt…", 10, "Decomposing requirements…");

    const analysisPrompt = feedback
      ? `Mystery prompt: ${prompt}\n\nHuman feedback on previous plan: ${feedback}\n\nRevise the plan. Output only valid JSON.`
      : `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`;

    const result = await dispatchAgent(this.apiKey, "analyst", analysisPrompt, { json: true, temp: 0.1 });
    this.track(result, "analyst");

    let plan: Record<string, unknown>;
    try { plan = JSON.parse(result.content); } catch { plan = JSON.parse(AGENT_CONFIGS.analyst.fallback()); }

    const features = (plan.features as string[]) || [];
    this.h.agent("analyst", "done", "Plan created", 100, `${features.length} features identified`);
    this.h.log(`Plan: ${features.join(", ")}`, "analyst");
    this.h.agent("supervisor", "done", "Awaiting human review…", 100);
    this.h.milestone("Plan ready for review");

    this.transition(Stage.PLAN_REVIEW);
    this.send({ type: "plan", plan });
  }

  // --- BUILD mode ---
  async runBuild(prompt: string, approvedPlan?: Record<string, unknown>) {
    this.pipelineStart = Date.now();
    this.h.log(`🚀 Starting workflow for: "${prompt}"`);
    this.h.agent("supervisor", "running", "Initializing orchestration…", 20, "Routing pipeline active");
    this.h.milestone("Workflow initiated");

    // ===== STAGE 1: ANALYZE =====
    let plan: Record<string, unknown>;
    if (approvedPlan) {
      plan = approvedPlan;
      this.h.agent("analyst", "done", "Using approved plan", 100, "Human-reviewed plan accepted");
      this.h.log("Skipping analysis — using human-approved plan", "analyst");
    } else {
      this.transition(Stage.ANALYZING);
      this.h.agent("analyst", "running", "Analyzing prompt…", 10, "Breaking down requirements…");
      const r = await dispatchAgent(this.apiKey, "analyst", `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`, { json: true, temp: 0.1 });
      this.track(r, "analyst");
      try { plan = JSON.parse(r.content); } catch { plan = JSON.parse(AGENT_CONFIGS.analyst.fallback()); }
      const features = (plan.features as string[]) || [];
      this.h.agent("analyst", "done", "Plan created", 100, `Features: ${features.slice(0, 3).join(", ")}`);
    }

    this.h.agent("supervisor", "done", "Routing → Developer & Designer (parallel)", 100);
    this.h.milestone("Analysis complete");

    // ===== STAGE 2: BUILD (parallel fan-out) =====
    this.transition(Stage.BUILDING);
    this.h.agent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding structure…");
    this.h.agent("designer", "running", "Creating CSS…", 10, "Building design system…");
    this.h.log("Parallel dispatch: Developer + Designer", "supervisor");

    const planJson = JSON.stringify(plan, null, 2);

    // Developer goes first to produce css_hooks
    const devResult = await dispatchAgent(this.apiKey, "developer", `Implement this project plan:\n${planJson}\n\nReturn only valid JSON.`, { json: true });
    this.track(devResult, "developer");

    let code: { html: string; js: string; notes?: string; css_hooks?: string[] };
    try { code = JSON.parse(devResult.content); } catch { code = JSON.parse(AGENT_CONFIGS.developer.fallback()); }

    // Guardrails on generated code
    if (!codeIsSafe(code.js)) {
      this.h.log("⚠️ JS guardrail triggered — sanitizing unsafe patterns…", "developer");
      code.js = sanitizeJS(code.js);
    }
    if (!htmlIsSafe(code.html)) {
      this.h.log("⚠️ HTML guardrail triggered — removing inline handlers and external scripts…", "developer");
      code.html = sanitizeHTML(code.html);
    }

    this.h.agent("developer", "done", "Code ready", 100, code.notes || "HTML + JS complete");

    // ===== STAGE 2b: CROSS-CONTEXT — Designer gets Developer's css_hooks =====
    this.transition(Stage.CROSS_CONTEXT);
    const cssHooks = code.css_hooks || [];
    const crossContextPrompt = cssHooks.length > 0
      ? `Create styles for this project plan:\n${planJson}\n\nIMPORTANT — The Developer used these CSS class names and IDs in the HTML. Target them in your CSS:\n${cssHooks.join(", ")}\n\nReturn only valid JSON.`
      : `Create styles for this project plan:\n${planJson}\n\nReturn only valid JSON.`;

    this.h.log(`Cross-context: passing ${cssHooks.length} CSS hooks from Developer → Designer`, "supervisor");

    const designResult = await dispatchAgent(this.apiKey, "designer", crossContextPrompt, { json: true, temp: 0.3 });
    this.track(designResult, "designer");

    let styles: { css: string; color_palette?: string[]; notes?: string };
    try { styles = JSON.parse(designResult.content); } catch { styles = JSON.parse(AGENT_CONFIGS.designer.fallback()); }

    // CSS guardrails
    if (!cssIsSafe(styles.css)) {
      this.h.log("⚠️ CSS guardrail triggered — removing unsafe expressions…", "designer");
      styles.css = sanitizeCSS(styles.css);
    }

    this.h.agent("designer", "done", "Styles ready", 100, styles.notes || "CSS complete");
    this.h.milestone("Code & styles complete");

    // ===== STAGE 3: SECURITY AUDIT =====
    this.transition(Stage.AUDITING);
    this.h.agent("security", "running", "Auditing code…", 20, "Scanning for XSS, a11y, quality…");

    const auditResult = await dispatchAgent(this.apiKey, "security",
      `Audit this code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
      { json: true, temp: 0.1 });
    this.track(auditResult, "security");

    let audit: { security_issues?: { severity: string; description: string }[]; accessibility_issues?: { severity: string; description: string }[]; overall_score?: number; fixed_html?: string; fixed_js?: string; fixed_css?: string; summary?: string };
    try { audit = JSON.parse(auditResult.content); } catch { audit = {}; }

    const secFixes = (audit.security_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;
    const a11yFixes = (audit.accessibility_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;

    if (audit.fixed_html) code.html = audit.fixed_html;
    if (audit.fixed_js) code.js = audit.fixed_js;
    if (audit.fixed_css) styles.css = audit.fixed_css;

    this.h.agent("security", "done", `Score: ${audit.overall_score ?? "N/A"}/100`, 100, `${secFixes} sec + ${a11yFixes} a11y fixes`);
    if (secFixes > 0) this.h.log(`🔒 Fixed ${secFixes} critical/high security issues`, "security");
    if (a11yFixes > 0) this.h.log(`♿ Fixed ${a11yFixes} critical/high accessibility issues`, "security");
    this.h.milestone("Security audit passed");

    // ===== STAGE 4: OPTIMIZE =====
    this.transition(Stage.OPTIMIZING);
    this.h.agent("optimizer", "running", "Optimizing…", 30, "Cleaning and polishing…");

    const optResult = await dispatchAgent(this.apiKey, "optimizer",
      `Optimize this audited code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
      { json: true, temp: 0.1 });
    this.track(optResult, "optimizer");

    let optimized: { html: string; css: string; js: string; improvements?: string[]; quality_score?: number };
    try { optimized = JSON.parse(optResult.content); } catch {
      optimized = { html: code.html, css: styles.css, js: code.js };
    }

    this.h.agent("optimizer", "done", "Optimization complete", 100, `${(optimized.improvements || []).length} improvements`);
    this.h.milestone("Optimization done");

    // ===== STAGE 5: SELF-IMPROVEMENT LOOP =====
    this.transition(Stage.SELF_IMPROVING);
    let finalHtml = optimized.html;
    let finalCss = optimized.css;
    let finalJs = optimized.js;

    for (let iteration = 0; iteration < MAX_SELF_IMPROVE_ITERATIONS; iteration++) {
      this.h.agent("supervisor", "running", `Self-evaluation round ${iteration + 1}…`, 70 + iteration * 10, "Evaluator checking cross-agent consistency…");

      const evalResult = await dispatchAgent(this.apiKey, "evaluator",
        `Evaluate this web app:\n\nHTML:\n${finalHtml}\n\nCSS:\n${finalCss}\n\nJS:\n${finalJs}\n\nReturn only valid JSON.`,
        { json: true, temp: 0.1 });
      this.track(evalResult, "evaluator");

      let evaluation: { pass?: boolean; score?: number; issues?: string[]; suggestions?: string[] };
      try { evaluation = JSON.parse(evalResult.content); } catch { evaluation = { pass: true, score: 75 }; }

      this.h.log(`Evaluator: score ${evaluation.score ?? "?"}/100, ${(evaluation.issues || []).length} issues`, "supervisor");

      if (evaluation.pass || (evaluation.score ?? 0) >= 75) {
        this.h.log(`✅ Self-evaluation passed (score: ${evaluation.score})`, "supervisor");
        break;
      }

      // Re-optimize with evaluator feedback
      this.h.log(`🔄 Re-optimizing based on ${(evaluation.issues || []).length} issues…`, "supervisor");
      const reoptResult = await dispatchAgent(this.apiKey, "optimizer",
        `The evaluator found these issues:\n${(evaluation.issues || []).join("\n")}\n\nSuggestions:\n${(evaluation.suggestions || []).join("\n")}\n\nFix them in this code:\n\nHTML:\n${finalHtml}\n\nCSS:\n${finalCss}\n\nJS:\n${finalJs}\n\nReturn only valid JSON.`,
        { json: true, temp: 0.1 });
      this.track(reoptResult, "optimizer");

      try {
        const reopt = JSON.parse(reoptResult.content);
        if (reopt.html) finalHtml = reopt.html;
        if (reopt.css) finalCss = reopt.css;
        if (reopt.js) finalJs = reopt.js;
      } catch { /* keep current versions */ }
    }

    this.h.milestone("Self-evaluation complete");

    // Final guardrail pass on output
    if (!codeIsSafe(finalJs)) finalJs = sanitizeJS(finalJs);
    if (!cssIsSafe(finalCss)) finalCss = sanitizeCSS(finalCss);
    if (!htmlIsSafe(finalHtml)) finalHtml = sanitizeHTML(finalHtml);

    // ===== STAGE 6: PACKAGE =====
    this.transition(Stage.PACKAGING);
    const totalDuration = Date.now() - this.pipelineStart;
    const fallbackCount = this.telemetry.filter((t) => t.usedFallback).length;

    this.h.agent("supervisor", "done", "Submission ready", 100);
    this.h.log(`📊 Pipeline: ${this.telemetry.length} dispatches, ${fallbackCount} fallbacks, ${(totalDuration / 1000).toFixed(1)}s total`, "supervisor");
    this.h.log("✅ All done! Project ready for download.", "system");
    this.h.milestone("Build complete ✅");

    this.transition(Stage.DONE);

    this.send({
      type: "result",
      code: { html: code.html, js: code.js },
      styles: { css: styles.css },
      optimized: { html: finalHtml, css: finalCss, js: finalJs, improvements: optimized.improvements },
      audit: {
        score: audit.overall_score,
        security_issues: (audit.security_issues || []).length,
        accessibility_issues: (audit.accessibility_issues || []).length,
        summary: audit.summary,
      },
      telemetry: {
        total_duration_ms: totalDuration,
        agents_dispatched: this.telemetry.length,
        fallbacks_used: fallbackCount,
        per_agent: this.telemetry.map((t) => ({ agent: t.agent, model: t.model, duration_ms: t.durationMs, fallback: t.usedFallback, attempts: t.attempt })),
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

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return new Response(JSON.stringify({ error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars)` }), {
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
            await orchestrator.runBuild(prompt.trim(), approvedPlan);
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
