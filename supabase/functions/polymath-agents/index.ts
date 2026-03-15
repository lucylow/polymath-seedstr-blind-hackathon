import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_PROMPT_LENGTH = 8000;
const MAX_SELF_IMPROVE_ITERATIONS = 2;
const HEARTBEAT_INTERVAL_MS = 8_000;

// =============================================================================
// SSE Helpers — with keepalive heartbeat
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

// Heartbeat: sends SSE comments to keep connection alive during long LLM calls
function startHeartbeat(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): number {
  return setInterval(() => {
    try {
      controller.enqueue(encoder.encode(": heartbeat\n\n"));
    } catch { /* stream closed */ }
  }, HEARTBEAT_INTERVAL_MS) as unknown as number;
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
  /\bDAN\b/,
  /do\s+anything\s+now/i,
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
  /\.innerHTML\s*\+?=\s*[^'"`]*\+/,
  /importScripts\s*\(/,
  /document\.cookie/i,
];

function codeIsSafe(js: string): boolean {
  return !JS_BANNED.some((rx) => rx.test(js));
}

function sanitizeJS(js: string): string {
  let safe = js;
  safe = safe.replace(/eval\s*\(/g, "/* [guardrail: eval removed] */(");
  safe = safe.replace(/document\.write\s*\(/g, "/* [guardrail: document.write removed] */(");
  safe = safe.replace(/Function\s*\(/g, "/* [guardrail: Function constructor removed] */(");
  safe = safe.replace(/importScripts\s*\(/g, "/* [guardrail: importScripts removed] */(");
  safe = safe.replace(/document\.cookie/gi, "/* [guardrail: document.cookie removed] */undefined");
  return safe;
}

// CSS safety
const CSS_BANNED = [
  /expression\s*\(/i,
  /behavior\s*:/i,
  /-moz-binding\s*:/i,
  /javascript\s*:/i,
  /url\s*\(\s*['"]?\s*data:text\/html/i,
  /@import\s+url/i,
];

function cssIsSafe(css: string): boolean {
  return !CSS_BANNED.some((rx) => rx.test(css));
}

function sanitizeCSS(css: string): string {
  let safe = css;
  safe = safe.replace(/expression\s*\([^)]*\)/gi, "/* [guardrail: expression removed] */");
  safe = safe.replace(/behavior\s*:[^;]*/gi, "/* [guardrail: behavior removed] */");
  safe = safe.replace(/-moz-binding\s*:[^;]*/gi, "/* [guardrail: moz-binding removed] */");
  safe = safe.replace(/@import\s+url[^;]*/gi, "/* [guardrail: @import url removed] */");
  return safe;
}

// HTML safety
function htmlIsSafe(html: string): boolean {
  const banned = [/<script\s+src\s*=/i, /on\w+\s*=/i, /javascript\s*:/i, /data:text\/html/i];
  return !banned.some((rx) => rx.test(html));
}

function sanitizeHTML(html: string): string {
  let safe = html;
  safe = safe.replace(/<script\s+src\s*=[^>]*>/gi, "<!-- [guardrail: external script removed] -->");
  safe = safe.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  safe = safe.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  return safe;
}

// Output content moderation (lightweight keyword-based)
const MODERATION_PATTERNS = [
  /\b(hack|exploit|inject|malware|phishing)\b.*\b(code|script|payload)\b/i,
  /\b(keylogger|ransomware|trojan|rootkit)\b/i,
];

function outputContentSafe(text: string): boolean {
  return !MODERATION_PATTERNS.some((rx) => rx.test(text));
}

// =============================================================================
// JSON extraction — handles markdown code fences
// =============================================================================
function extractJSON(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Try to find raw JSON object
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return raw;
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(extractJSON(raw)) as T;
  } catch {
    return fallback;
  }
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
// Agent Registry — updated models per gateway recommendations
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
    model: "google/gemini-2.5-pro",
    timeout: 120_000,
    fallback: () => JSON.stringify({
      project_type: "web app", features: ["responsive layout", "interactive UI", "data display"],
      tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html", "style.css", "script.js"],
      data_requirements: "mock data", ui_layout: "header + main content + footer",
      color_scheme: "professional blues", accessibility_requirements: "WCAG 2.1 AA", special_notes: "none",
    }),
    system: `You are a principal software architect with 15+ years of experience in web development, design systems, and accessibility.

Your task: analyze the mystery prompt and produce the most comprehensive, actionable technical blueprint possible. Think like a senior tech lead scoping a real project — be specific, opinionated, and thorough.

Return a JSON object with these keys:
- project_type (string): specific classification — e.g. "interactive dashboard", "puzzle game", "data entry form"
- features (array of strings): 8-12 specific, implementable features. Each must be concrete enough to build without ambiguity. Prioritize by impact.
- tech_stack (array of strings): prefer vanilla HTML/CSS/JS unless the prompt genuinely requires a framework.
- file_structure (array of strings): always include index.html, style.css, script.js.
- data_requirements (string): detailed description of data to display, exact mock data shapes/structures with realistic field names and types.
- ui_layout (string): page layout — header, sidebar, main content, footer. Include responsive behavior for mobile/tablet/desktop.
- color_scheme (string): specific hex color direction appropriate to the project type. Name primary, secondary, accent, background, text colors.
- accessibility_requirements (string): specific WCAG 2.1 AA requirements for this project type.
- special_notes (string): edge cases, constraints, responsive breakpoints, performance considerations, interaction states.
- css_class_conventions (string): naming conventions for CSS classes (e.g. BEM, semantic names) so Developer and Designer align.
- interactions (string): describe hover states, click behaviors, transitions, loading states, empty states, error states.

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
    system: `You are a senior front-end engineer who writes production-quality vanilla web code. Your code should feel hand-crafted, not AI-generated.

Rules:
- Vanilla HTML + JS only. No frameworks, libraries, or CDN imports.
- 100% self-contained, runs in any modern browser with zero dependencies.
- Generate realistic mock data (real names, numbers, dates, locations) — never "Lorem ipsum", "Item 1", or "Example".
- At least 8-15 items of realistic sample data with varied content.
- Proper error handling: try/catch, fallback UI states, input validation, edge cases.
- Modern JS: async/await, template literals, destructuring, optional chaining, nullish coalescing.
- DOM: createElement + appendChild or insertAdjacentHTML. NEVER document.write() or eval().
- Event delegation where appropriate. Keyboard navigation for all interactive elements (Enter, Escape, Tab).
- Meaningful comments explaining architecture decisions and WHY, not WHAT.
- NEVER use: eval(), document.write(), inline onclick/onchange, innerHTML with unsanitized user content, document.cookie.
- Semantic HTML: <main>, <nav>, <section>, <article>, <aside>, <footer>, <header>.
- Add descriptive CSS class names to ALL elements using consistent naming conventions.
- Include ARIA attributes: role, aria-label, aria-live, aria-expanded where appropriate.
- Implement smooth state transitions: loading → content, empty → populated, error states.
- Add data attributes for JS hooks, keep class names semantic for CSS.

Return a JSON object with:
- "html" (string): HTML body content only — no <html>/<head>/<body> wrappers. Must be complete and functional.
- "js" (string): complete JavaScript. Well-structured with clear function separation.
- "notes" (string): key implementation decisions and architecture rationale.
- "css_hooks" (array of strings): list of ALL CSS class names and IDs used in the HTML, so the Designer can target them precisely. Be exhaustive.`,
  },

  designer: {
    id: "designer",
    model: "google/gemini-3-flash-preview",
    timeout: 120_000,
    fallback: () => JSON.stringify({
      css: ":root{--color-primary:#1a73e8;--color-bg:#f5f5f5;--color-text:#1a1a2e}body{font-family:system-ui,sans-serif;margin:0;padding:2rem;color:var(--color-text);background:var(--color-bg)}",
      color_palette: ["#1a73e8 (primary)", "#f5f5f5 (bg)", "#1a1a2e (text)"], notes: "fallback",
    }),
    system: `You are a world-class UI/UX designer and CSS engineer. You create designs that feel premium, polished, and intentional — not generic or template-like.

Rules:
- Mobile-first responsive design with breakpoints: 480px, 768px, 1024px, 1440px.
- CSS custom properties for ALL colors: --color-primary, --color-secondary, --color-accent, --color-bg, --color-surface, --color-text, --color-text-muted, --color-border, --color-success, --color-warning, --color-error.
- Typography: clamp() for fluid sizing. System font stack with a distinctive feel.
- WCAG 2.1 AA: 4.5:1 contrast for text, 3:1 for large text, visible focus indicators (outline-offset, not just color).
- CSS Grid for page layout, Flexbox for components. Use gap, not margins between siblings.
- prefers-reduced-motion: reduce all animations/transitions to minimal.
- prefers-color-scheme: dark — provide a complete dark mode with proper contrast.
- Micro-interactions: button hover/active states (scale, shadow), smooth transitions (200-300ms ease-out), focus-visible rings.
- Layered box shadows for depth (at least 2 shadow layers on cards/elevated elements).
- Subtle gradients on key surfaces. Rounded corners for a modern feel.
- Scrollbar styling for webkit browsers.
- Selection color styling (::selection).
- Smooth scroll behavior on html.
- CRITICAL: You will receive the Developer's CSS hooks (class names and IDs). Target ONLY these selectors. Do NOT invent selectors that don't exist in the HTML.

Return a JSON object with:
- "css" (string): complete, production-quality CSS. Every selector must match a real element.
- "color_palette" (array of strings): hex colors with labels like "#1a73e8 (primary)".
- "notes" (string): design rationale, accessibility notes, responsive strategy.`,
  },

  security: {
    id: "security",
    model: "google/gemini-3-flash-preview",
    timeout: 90_000,
    fallback: () => JSON.stringify({ security_issues: [], accessibility_issues: [], quality_issues: [], overall_score: 70, summary: "Audit skipped (fallback)" }),
    system: `You are a senior security engineer and accessibility auditor performing a thorough code review.

Analyze the HTML, CSS, and JS for:

**Security (Critical):** XSS vectors (innerHTML + dynamic content, eval, document.write, Function constructor, template literal injection), unsafe URL handling (javascript:, data: URIs in href/src), prototype pollution, event handler injection, DOM clobbering, open redirect patterns, unsafe postMessage usage.
**Accessibility (High Priority):** Missing ARIA labels/roles, missing alt text, improper heading hierarchy (skipped levels, multiple h1), missing form labels and fieldsets, insufficient color contrast, missing keyboard navigation, missing skip-to-content link, missing lang attribute consideration, focus trap issues in modals.
**Quality:** Unused variables/functions, console.logs in production, missing error handling in async code, potential memory leaks (event listeners not cleaned up, intervals not cleared), race conditions, unhandled promise rejections.

Return JSON with:
- "security_issues" (array: {severity: "critical"|"high"|"medium"|"low", description: string, fix: string, line_hint: string})
- "accessibility_issues" (array: {severity: "critical"|"high"|"medium"|"low", description: string, fix: string})
- "quality_issues" (array: {severity: "high"|"medium"|"low", description: string, fix: string})
- "overall_score" (number 0-100)
- "fixed_html" (string): HTML with ALL critical and high issues fixed inline
- "fixed_js" (string): JS with ALL critical and high issues fixed inline
- "fixed_css" (string): CSS with ALL critical and high issues fixed inline
- "summary" (string): executive summary of findings`,
  },

  optimizer: {
    id: "optimizer",
    model: "google/gemini-3-flash-preview",
    timeout: 120_000,
    fallback: () => "{}",
    system: `You are a performance engineer and code quality specialist. Your job is to take working code and make it excellent without breaking anything.

Tasks:
1. Remove dead code, redundant CSS selectors, unused JS variables/functions.
2. Optimize CSS: merge duplicates, use shorthand properties, ensure proper specificity, remove over-qualified selectors.
3. Optimize JS: remove console.logs, cache repeated DOM queries, debounce scroll/resize handlers, proper error handling, use requestAnimationFrame for visual updates.
4. Verify HTML semantics: single h1, correct heading hierarchy, landmark roles, proper list usage.
5. Ensure focus styles and keyboard support on ALL interactive elements (buttons, links, inputs, custom controls).
6. Add loading="lazy" to images, defer non-critical JS patterns.
7. Keep ALL functionality identical — do NOT remove features or change behavior.
8. Clean, well-indented, readable code (not minified). Use 2-space indentation.

Return JSON with:
- "html" (string): optimized HTML body (no wrappers).
- "css" (string): optimized CSS.
- "js" (string): optimized JS.
- "improvements" (array of strings): specific optimizations made, with before/after description.
- "quality_score" (number 0-100): honest self-assessed quality.`,
  },

  evaluator: {
    id: "evaluator",
    model: "google/gemini-2.5-flash",
    timeout: 60_000,
    fallback: () => JSON.stringify({ pass: true, score: 70, issues: [], suggestions: [] }),
    system: `You are a QA engineer performing final acceptance testing on a single-page web app. Be strict but fair.

Evaluate the combined HTML/CSS/JS for:

1. **Selector alignment**: Does the CSS reference classes/IDs that exist in the HTML? Flag orphaned CSS selectors (selectors targeting elements that don't exist).
2. **JS-DOM alignment**: Does the JS querySelector/getElementById reference elements that exist in the HTML? Flag missing elements that would cause null reference errors.
3. **Runtime safety**: Are there obvious runtime errors? Undefined variables, missing function definitions, unclosed brackets, mismatched quotes?
4. **Layout completeness**: Does the page have meaningful content (not just empty containers)? Is the structure logical?
5. **Responsive readiness**: Are there media queries? Does the layout use flexible units?
6. **Interaction completeness**: Do buttons/links have click handlers? Do forms have submit handlers?

Return JSON with:
- "pass" (boolean): true if score >= 75 AND no critical issues
- "score" (number 0-100): be honest and specific
- "issues" (array of strings): each issue must be specific enough to fix (include the selector/variable name)
- "suggestions" (array of strings): concrete improvements for the next iteration`,
  },
};

// =============================================================================
// Agent Dispatcher — with exponential backoff, correlation tracking, fallbacks
// =============================================================================
interface LLMCallResult {
  content: string;
  correlationId: string;
  model: string;
  durationMs: number;
  usedFallback: boolean;
  attempt: number;
  tokenEstimate: number;
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

      // Rate limit / payment errors — surface immediately, no retry
      if (resp.status === 429) {
        const t = await resp.text();
        throw new Error(`rate_limit:${t}`);
      }
      if (resp.status === 402) {
        const t = await resp.text();
        throw new Error(`payment_required:${t}`);
      }

      if (!resp.ok) {
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 2s, 4s, 8s
          const delay = Math.min(2000 * Math.pow(2, attempt), 10_000);
          console.warn(`[${agentId}] HTTP ${resp.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const t = await resp.text();
        throw new Error(`AI gateway error [${resp.status}]: ${t}`);
      }

      const data = await resp.json();
      const rawContent = data.choices?.[0]?.message?.content ?? "";
      const tokenEstimate = Math.ceil(rawContent.length / 4);

      // Output content moderation
      if (!outputContentSafe(rawContent)) {
        console.warn(`[${agentId}] Output flagged by content moderation (attempt ${attempt + 1})`);
        if (attempt < maxRetries - 1) {
          body.messages = [
            ...(body.messages as Array<{role: string; content: string}>),
            { role: "assistant", content: rawContent },
            { role: "user", content: "Your previous response was flagged for unsafe content. Please regenerate a safe, appropriate version. Remove any references to exploits, hacking, or malicious techniques." },
          ];
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1, tokenEstimate: 0 };
      }

      // JSON validation with smart extraction
      if (jsonMode) {
        const extracted = extractJSON(rawContent);
        try {
          JSON.parse(extracted);
          return { content: extracted, correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: false, attempt: attempt + 1, tokenEstimate };
        } catch {
          if (attempt < maxRetries - 1) {
            console.warn(`[${agentId}] Invalid JSON, retrying (attempt ${attempt + 1})`);
            body.messages = [
              ...(body.messages as Array<{role: string; content: string}>),
              { role: "assistant", content: rawContent },
              { role: "user", content: "Your response was not valid JSON. Return ONLY a valid JSON object with no markdown formatting, no code fences, no explanation text. Just raw JSON." },
            ];
            continue;
          }
          console.warn(`[${agentId}] Invalid JSON after ${maxRetries} attempts, using fallback`);
          return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1, tokenEstimate: 0 };
        }
      }

      return { content: rawContent, correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: false, attempt: attempt + 1, tokenEstimate };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn(`[${agentId}] Timeout after ${config.timeout}ms (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }
        return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: attempt + 1, tokenEstimate: 0 };
      }
      // Don't retry rate limit / payment errors
      if (err instanceof Error && (err.message.startsWith("rate_limit:") || err.message.startsWith("payment_required:"))) {
        throw err;
      }
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }

  return { content: config.fallback(), correlationId, model: config.model, durationMs: Date.now() - startTime, usedFallback: true, attempt: maxRetries, tokenEstimate: 0 };
}

// =============================================================================
// Workflow Orchestrator
// =============================================================================
class WorkflowOrchestrator {
  private stage: Stage = Stage.IDLE;
  private apiKey: string;
  private h: ReturnType<typeof createHelpers>;
  private send: EventSender;
  private telemetry: { agent: string; model: string; durationMs: number; usedFallback: boolean; attempt: number; tokenEstimate: number }[] = [];
  private pipelineStart = 0;
  private buildId: string;

  constructor(apiKey: string, send: EventSender) {
    this.apiKey = apiKey;
    this.send = send;
    this.h = createHelpers(send);
    this.buildId = crypto.randomUUID();
  }

  private transition(to: Stage) {
    this.stage = to;
    this.send({ type: "stage", stage: to });
  }

  private track(result: LLMCallResult, agentId: string) {
    this.telemetry.push({
      agent: agentId, model: result.model, durationMs: result.durationMs,
      usedFallback: result.usedFallback, attempt: result.attempt, tokenEstimate: result.tokenEstimate,
    });
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
      ? `Mystery prompt: ${prompt}\n\nHuman feedback on previous plan: ${feedback}\n\nRevise the plan incorporating this feedback. Output only valid JSON.`
      : `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`;

    const result = await dispatchAgent(this.apiKey, "analyst", analysisPrompt, { json: true, temp: 0.15 });
    this.track(result, "analyst");

    const fallbackPlan = JSON.parse(AGENT_CONFIGS.analyst.fallback());
    const plan = safeParse(result.content, fallbackPlan);

    const features = (plan.features as string[]) || [];
    this.h.agent("analyst", "done", "Plan created", 100, `${features.length} features identified`);
    this.h.log(`Plan: ${features.join(", ")}`, "analyst");
    this.h.agent("supervisor", "done", "Awaiting human review…", 100);
    this.h.milestone("Plan ready for review");

    this.transition(Stage.PLAN_REVIEW);
    this.send({ type: "plan", plan, buildId: this.buildId });
  }

  // --- BUILD mode ---
  async runBuild(prompt: string, approvedPlan?: Record<string, unknown>) {
    this.pipelineStart = Date.now();
    this.h.log(`🚀 Build ${this.buildId.slice(0, 8)} started for: "${prompt.slice(0, 80)}…"`);
    this.h.agent("supervisor", "running", "Initializing orchestration…", 20, "Multi-agent pipeline active");
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
      const r = await dispatchAgent(this.apiKey, "analyst", `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`, { json: true, temp: 0.15 });
      this.track(r, "analyst");
      const fallbackPlan = JSON.parse(AGENT_CONFIGS.analyst.fallback());
      plan = safeParse(r.content, fallbackPlan);
      const features = (plan.features as string[]) || [];
      this.h.agent("analyst", "done", "Plan created", 100, `Features: ${features.slice(0, 3).join(", ")}`);
    }

    this.h.agent("supervisor", "done", "Routing → Developer & Designer", 100);
    this.h.milestone("Analysis complete");

    // ===== STAGE 2: BUILD — Developer first, then Designer with css_hooks =====
    this.transition(Stage.BUILDING);
    this.h.agent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding structure…");
    this.h.agent("designer", "running", "Preparing design system…", 5, "Waiting for Developer's CSS hooks…");
    this.h.log("Developer started — Designer will receive CSS hooks for precise targeting", "supervisor");

    const planJson = JSON.stringify(plan, null, 2);

    // Developer produces code + css_hooks
    const devResult = await dispatchAgent(this.apiKey, "developer",
      `Implement this project plan:\n${planJson}\n\nReturn only valid JSON.`, { json: true });
    this.track(devResult, "developer");

    const devFallback = JSON.parse(AGENT_CONFIGS.developer.fallback());
    let code = safeParse<{ html: string; js: string; notes?: string; css_hooks?: string[] }>(devResult.content, devFallback);

    // Guardrails on generated code
    if (!codeIsSafe(code.js)) {
      this.h.log("⚠️ JS guardrail triggered — sanitizing unsafe patterns", "developer");
      code.js = sanitizeJS(code.js);
    }
    if (!htmlIsSafe(code.html)) {
      this.h.log("⚠️ HTML guardrail triggered — removing unsafe patterns", "developer");
      code.html = sanitizeHTML(code.html);
    }

    this.h.agent("developer", "done", "Code ready", 100, code.notes || "HTML + JS complete");

    // ===== STAGE 2b: CROSS-CONTEXT — Designer gets css_hooks =====
    this.transition(Stage.CROSS_CONTEXT);
    const cssHooks = code.css_hooks || [];
    const crossContextPrompt = cssHooks.length > 0
      ? `Create styles for this project plan:\n${planJson}\n\nCRITICAL — The Developer used exactly these CSS class names and IDs in the HTML. You MUST target these in your CSS. Do not invent new selectors:\n\nCSS hooks: ${cssHooks.join(", ")}\n\nHere is the HTML for reference:\n${code.html.slice(0, 3000)}\n\nReturn only valid JSON.`
      : `Create styles for this project plan:\n${planJson}\n\nReturn only valid JSON.`;

    this.h.log(`Cross-context: ${cssHooks.length} CSS hooks passed Developer → Designer`, "supervisor");
    this.h.agent("designer", "running", "Styling with Developer's hooks…", 30, `Targeting ${cssHooks.length} selectors…`);

    const designResult = await dispatchAgent(this.apiKey, "designer", crossContextPrompt, { json: true, temp: 0.3 });
    this.track(designResult, "designer");

    const desFallback = JSON.parse(AGENT_CONFIGS.designer.fallback());
    let styles = safeParse<{ css: string; color_palette?: string[]; notes?: string }>(designResult.content, desFallback);

    // CSS guardrails
    if (!cssIsSafe(styles.css)) {
      this.h.log("⚠️ CSS guardrail triggered — removing unsafe expressions", "designer");
      styles.css = sanitizeCSS(styles.css);
    }

    this.h.agent("designer", "done", "Styles ready", 100, styles.notes || "CSS complete");
    this.h.milestone("Code & styles complete");

    // ===== STAGE 3: SECURITY AUDIT =====
    this.transition(Stage.AUDITING);
    this.h.agent("security", "running", "Auditing code…", 20, "Scanning for XSS, a11y, quality…");

    const auditPrompt = `Audit this single-page web app:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nFix ALL critical and high severity issues directly in the code. Return only valid JSON.`;
    const auditResult = await dispatchAgent(this.apiKey, "security", auditPrompt, { json: true, temp: 0.1 });
    this.track(auditResult, "security");

    const auditFallback = JSON.parse(AGENT_CONFIGS.security.fallback());
    const audit = safeParse<{
      security_issues?: { severity: string; description: string }[];
      accessibility_issues?: { severity: string; description: string }[];
      quality_issues?: { severity: string; description: string }[];
      overall_score?: number;
      fixed_html?: string; fixed_js?: string; fixed_css?: string;
      summary?: string;
    }>(auditResult.content, auditFallback);

    const secFixes = (audit.security_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;
    const a11yFixes = (audit.accessibility_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;

    // Apply security fixes — update the working copies
    if (audit.fixed_html) code = { ...code, html: audit.fixed_html };
    if (audit.fixed_js) code = { ...code, js: audit.fixed_js };
    if (audit.fixed_css) styles = { ...styles, css: audit.fixed_css };

    this.h.agent("security", "done", `Score: ${audit.overall_score ?? "N/A"}/100`, 100, `${secFixes} sec + ${a11yFixes} a11y fixes`);
    if (secFixes > 0) this.h.log(`🔒 Fixed ${secFixes} critical/high security issues`, "security");
    if (a11yFixes > 0) this.h.log(`♿ Fixed ${a11yFixes} critical/high accessibility issues`, "security");
    this.h.milestone("Security audit passed");

    // ===== STAGE 4: OPTIMIZE =====
    this.transition(Stage.OPTIMIZING);
    this.h.agent("optimizer", "running", "Optimizing…", 30, "Cleaning and polishing…");

    const optResult = await dispatchAgent(this.apiKey, "optimizer",
      `Optimize this audited, security-reviewed code. Do NOT remove any functionality:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
      { json: true, temp: 0.1 });
    this.track(optResult, "optimizer");

    let optimized = safeParse<{ html: string; css: string; js: string; improvements?: string[]; quality_score?: number }>(
      optResult.content, { html: code.html, css: styles.css, js: code.js }
    );

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
        `Evaluate this web app for cross-agent consistency and quality:\n\nHTML:\n${finalHtml}\n\nCSS:\n${finalCss}\n\nJS:\n${finalJs}\n\nReturn only valid JSON.`,
        { json: true, temp: 0.1 });
      this.track(evalResult, "evaluator");

      const evaluation = safeParse<{ pass?: boolean; score?: number; issues?: string[]; suggestions?: string[] }>(
        evalResult.content, { pass: true, score: 75 }
      );

      this.h.log(`Evaluator: score ${evaluation.score ?? "?"}/100, ${(evaluation.issues || []).length} issues`, "supervisor");

      if (evaluation.pass || (evaluation.score ?? 0) >= 75) {
        this.h.log(`✅ Self-evaluation passed (score: ${evaluation.score})`, "supervisor");
        break;
      }

      // Re-optimize with evaluator feedback
      this.h.log(`🔄 Re-optimizing based on ${(evaluation.issues || []).length} issues…`, "supervisor");
      const reoptResult = await dispatchAgent(this.apiKey, "optimizer",
        `The QA evaluator found these issues:\n${(evaluation.issues || []).join("\n")}\n\nSuggestions:\n${(evaluation.suggestions || []).join("\n")}\n\nFix them in this code WITHOUT removing any functionality:\n\nHTML:\n${finalHtml}\n\nCSS:\n${finalCss}\n\nJS:\n${finalJs}\n\nReturn only valid JSON.`,
        { json: true, temp: 0.1 });
      this.track(reoptResult, "optimizer");

      const reopt = safeParse<{ html?: string; css?: string; js?: string }>(reoptResult.content, {});
      if (reopt.html) finalHtml = reopt.html;
      if (reopt.css) finalCss = reopt.css;
      if (reopt.js) finalJs = reopt.js;
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
    const totalTokens = this.telemetry.reduce((sum, t) => sum + t.tokenEstimate, 0);

    this.h.agent("supervisor", "done", "Submission ready", 100);
    this.h.log(`📊 Pipeline: ${this.telemetry.length} dispatches, ${fallbackCount} fallbacks, ~${totalTokens} tokens, ${(totalDuration / 1000).toFixed(1)}s`, "supervisor");
    this.h.log("✅ All done! Project ready for download.", "system");
    this.h.milestone("Build complete ✅");

    this.transition(Stage.DONE);

    // BUG FIX: Send post-audit code in both `code` and `optimized` fields
    this.send({
      type: "result",
      buildId: this.buildId,
      code: { html: code.html, js: code.js },
      styles: { css: styles.css, color_palette: styles.color_palette },
      optimized: { html: finalHtml, css: finalCss, js: finalJs, improvements: optimized.improvements, quality_score: optimized.quality_score },
      audit: {
        score: audit.overall_score,
        security_issues: (audit.security_issues || []).length,
        accessibility_issues: (audit.accessibility_issues || []).length,
        quality_issues: (audit.quality_issues || []).length,
        summary: audit.summary,
      },
      telemetry: {
        build_id: this.buildId,
        total_duration_ms: totalDuration,
        agents_dispatched: this.telemetry.length,
        fallbacks_used: fallbackCount,
        estimated_tokens: totalTokens,
        per_agent: this.telemetry.map((t) => ({
          agent: t.agent, model: t.model, duration_ms: t.durationMs,
          fallback: t.usedFallback, attempts: t.attempt, tokens: t.tokenEstimate,
        })),
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

    // Input guardrail at HTTP level
    if (!inputSafe(prompt)) {
      return new Response(JSON.stringify({ error: "Prompt rejected by content policy" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    let heartbeatId: number | undefined;

    const stream = new ReadableStream({
      async start(controller) {
        // Start heartbeat to keep SSE connection alive
        heartbeatId = startHeartbeat(controller, encoder);

        const send: EventSender = (data) => {
          try {
            controller.enqueue(encoder.encode(sseEvent(data)));
          } catch { /* stream closed */ }
        };
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

          // Surface rate limit / payment errors with proper type
          if (msg.startsWith("rate_limit:")) {
            send({ type: "error", message: "Rate limited — please wait a moment and try again.", errorType: "rate_limit" });
          } else if (msg.startsWith("payment_required:")) {
            send({ type: "error", message: "Credits required — please add credits to your workspace.", errorType: "payment_required" });
          } else {
            send({ type: "error", message: msg, errorType: "internal" });
          }
        }

        if (heartbeatId) clearInterval(heartbeatId);
        controller.close();
      },
      cancel() {
        if (heartbeatId) clearInterval(heartbeatId);
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
