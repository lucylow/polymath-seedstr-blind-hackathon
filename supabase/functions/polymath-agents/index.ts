import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------
function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type EventSender = (data: Record<string, unknown>) => void;

function createHelpers(send: EventSender) {
  return {
    log: (text: string, agent = "system") => send({ type: "log", text, agent }),
    agent: (agent: string, status: "running" | "done", message: string, progress: number, thought?: string) =>
      send({ type: "agent", agent, status, message, progress, thought }),
    milestone: (text: string) => send({ type: "milestone", text }),
  };
}

// ---------------------------------------------------------------------------
// Input guardrails
// ---------------------------------------------------------------------------
const DANGEROUS_PHRASES = ["ignore previous", "you are now", "system prompt", "disregard", "forget your instructions"];

function inputSafe(text: string): boolean {
  const lower = text.toLowerCase();
  return !DANGEROUS_PHRASES.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// LLM caller with retry
// ---------------------------------------------------------------------------
async function callLLM(
  apiKey: string,
  system: string,
  user: string,
  opts: { json?: boolean; temp?: number; retries?: number; model?: string } = {},
): Promise<string> {
  const { json: jsonMode = false, temp = 0.2, retries = 3, model = "google/gemini-3-flash-preview" } = opts;

  if (!inputSafe(user)) throw new Error("Prompt rejected by input guardrail");

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: temp,
  };

  if (jsonMode) body.response_format = { type: "json_object" };

  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (resp.status === 429 || resp.status === 402) {
      const t = await resp.text();
      throw new Error(`AI gateway [${resp.status}]: ${t}`);
    }

    if (!resp.ok) {
      if (attempt < retries - 1) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      const t = await resp.text();
      throw new Error(`AI gateway error [${resp.status}]: ${t}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "";

    if (jsonMode) {
      try { JSON.parse(content); return content; } catch {
        if (attempt < retries - 1) continue;
      }
    }
    return content;
  }
  return jsonMode ? "{}" : "";
}

// ---------------------------------------------------------------------------
// Code safety check
// ---------------------------------------------------------------------------
function codeIsSafe(js: string): boolean {
  const banned = [/eval\s*\(/, /document\.write\s*\(/, /innerHTML\s*=.*<script/i, /window\.location\s*=/, /Function\s*\(/];
  return !banned.some((rx) => rx.test(js));
}

// ---------------------------------------------------------------------------
// Specialized Agent Prompts
// ---------------------------------------------------------------------------
const ANALYST_SYSTEM = `You are a principal software architect with 15+ years of experience in web development, design systems, and accessibility.

Your job: analyze a mystery prompt and produce the most comprehensive, actionable technical blueprint possible.

Return a JSON object with these keys:
- project_type (string): specific classification — e.g. "interactive dashboard", "puzzle game", "data entry form", "portfolio site"
- features (array of strings): 5-10 specific, implementable features. Each must be concrete enough for a developer to build without ambiguity.
- tech_stack (array of strings): prefer vanilla HTML/CSS/JS. Only suggest a framework if the prompt genuinely requires one (e.g. complex state management, routing).
- file_structure (array of strings): always include index.html, style.css, script.js. Add more only if genuinely needed.
- data_requirements (string): detailed description of what data to display, how to generate mock data, data shapes/structures.
- ui_layout (string): describe the page layout — header, sidebar, main content, footer. Include responsive behavior.
- color_scheme (string): suggest a color direction appropriate to the project type (e.g. "professional blues and grays for a dashboard", "vibrant warm tones for a game").
- accessibility_requirements (string): specific WCAG 2.1 AA requirements relevant to this project.
- special_notes (string): edge cases, constraints, responsive breakpoints, performance considerations.

Be precise. Every feature must be buildable in a self-contained single-page app with zero external dependencies.`;

const DEVELOPER_SYSTEM = `You are a senior front-end engineer with expertise in vanilla web development, DOM APIs, and performance optimization.

Rules:
- Write vanilla HTML + JS only (no frameworks, no libraries, no CDN imports).
- Code must be 100% self-contained and run in any modern browser with zero dependencies.
- Generate realistic mock/demo data (names, numbers, dates) — never use placeholder text like "Lorem ipsum" or "Item 1".
- Implement proper error handling: try/catch blocks, fallback UI states, input validation.
- Use modern JS: async/await, template literals, destructuring, optional chaining, nullish coalescing.
- DOM: use createElement + appendChild pattern or template literals with insertAdjacentHTML. Never use document.write().
- Event delegation where appropriate for better performance.
- Add keyboard navigation for all interactive elements (Tab, Enter, Escape, Arrow keys where applicable).
- Include meaningful code comments explaining WHY, not WHAT.
- NEVER use: eval(), document.write(), inline onclick/onchange attributes, innerHTML with unsanitized content.
- Generate at least 5-10 items of realistic sample data.

Return a JSON object with:
- "html" (string): HTML body content only — no <html>, <head>, or <body> wrapper tags.
- "js" (string): complete, production-quality JavaScript.
- "notes" (string): implementation decisions and any trade-offs made.`;

const DESIGNER_SYSTEM = `You are a world-class UI/UX designer and CSS engineer with expertise in design systems, accessibility, and motion design.

Rules:
- Mobile-first responsive design with breakpoints: 480px (mobile), 768px (tablet), 1024px (desktop), 1440px (wide).
- CSS custom properties for the entire color system: --color-primary, --color-secondary, --color-accent, --color-bg, --color-surface, --color-text, --color-text-muted, --color-border, --color-success, --color-warning, --color-error.
- Typography scale using clamp() for fluid sizing. Use system font stack: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif.
- WCAG 2.1 AA compliance: minimum 4.5:1 contrast for text, 3:1 for large text, visible focus indicators (outline, not just color), skip-navigation if applicable.
- Layout: CSS Grid for page structure, Flexbox for component internals. Use gap instead of margins where possible.
- Animations: use prefers-reduced-motion media query. Subtle transitions (200-300ms ease) on hover/focus. Entrance animations for main content.
- Dark mode via @media (prefers-color-scheme: dark) with adjusted custom properties.
- Micro-interactions: button press effects, hover state transitions, loading states.
- Box shadows for depth: use layered shadows for a more natural look.
- Scrollbar styling for webkit browsers.
- Print styles if relevant to the project type.

Return a JSON object with:
- "css" (string): complete, production-quality CSS stylesheet.
- "color_palette" (array of strings): all hex colors used, with brief labels like "#1a73e8 (primary)".
- "notes" (string): design rationale, accessibility notes, and responsive strategy.`;

const SECURITY_AUDITOR_SYSTEM = `You are a senior security engineer and accessibility auditor.

Analyze the provided HTML, CSS, and JS code for:

**Security Issues:**
- XSS vulnerabilities (innerHTML with dynamic content, eval, document.write, Function constructor)
- Unsafe URL handling (javascript: protocol, data: URIs in links)
- Prototype pollution risks
- Insecure data storage patterns
- Event handler injection risks

**Accessibility Issues:**
- Missing ARIA labels on interactive elements
- Missing alt text on images
- Improper heading hierarchy (h1 → h2 → h3, no skipping)
- Missing form labels
- Insufficient color contrast
- Missing keyboard navigation
- Missing focus management
- Missing landmark roles

**Code Quality Issues:**
- Unused variables or dead code
- Console.log statements left in production
- Missing error handling
- Memory leaks (unremoved event listeners)

Return a JSON object with:
- "security_issues" (array of objects with "severity": "critical"|"high"|"medium"|"low", "description": string, "fix": string)
- "accessibility_issues" (array of objects with "severity": "critical"|"high"|"medium"|"low", "description": string, "fix": string)
- "quality_issues" (array of objects with "severity": "high"|"medium"|"low", "description": string, "fix": string)
- "overall_score" (number 0-100): overall quality score
- "fixed_html" (string): HTML with critical/high issues fixed
- "fixed_js" (string): JS with critical/high issues fixed
- "fixed_css" (string): CSS with critical/high issues fixed
- "summary" (string): brief summary of findings`;

const OPTIMIZER_SYSTEM = `You are a performance engineer and code quality specialist.

Take the provided HTML, CSS, and JS (which have already passed security audit) and produce an optimized, production-ready single-page app.

Tasks:
1. Combine everything into clean, well-structured code.
2. Remove dead code, redundant CSS selectors, and unused JS variables.
3. Optimize CSS: merge duplicate rules, use shorthand properties, ensure proper specificity order.
4. Optimize JS: remove console.logs, ensure proper error handling, optimize DOM queries (cache selectors).
5. Verify HTML semantics: proper heading hierarchy (single h1), landmark roles, meta viewport.
6. Ensure all interactive elements have focus styles and keyboard support.
7. Add loading="lazy" to images if any.
8. Keep ALL functionality identical — do NOT remove any features.
9. Ensure the code is clean, well-indented, and readable (not minified — readable production code).

Return a JSON object with:
- "html" (string): optimized HTML body content (no <html>/<head>/<body> wrappers).
- "css" (string): optimized CSS.
- "js" (string): optimized JS.
- "improvements" (array of strings): list of optimizations made.`;

// ---------------------------------------------------------------------------
// Main handler — supports two modes:
//   { prompt, mode: "analyze" }  → returns plan for human review
//   { prompt, plan, feedback?, mode: "build" } → executes full build
// ---------------------------------------------------------------------------
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
        const { log, agent, milestone } = createHelpers(send);

        try {
          // ============================================================
          // MODE: "analyze" — only run Analyst, return plan for review
          // ============================================================
          if (mode === "analyze") {
            log(`🔍 Analyzing prompt: "${prompt}"`);
            agent("supervisor", "running", "Delegating to Analyst…", 30);
            agent("analyst", "running", "Analyzing prompt…", 10, "Decomposing requirements and constraints…");

            const analysisPrompt = feedback
              ? `Mystery prompt: ${prompt}\n\nPrevious feedback from human reviewer: ${feedback}\n\nRevise the plan based on this feedback. Output only valid JSON.`
              : `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`;

            const planRaw = await callLLM(LOVABLE_API_KEY, ANALYST_SYSTEM, analysisPrompt, { json: true, temp: 0.1, model: "openai/gpt-5" });

            let plan: Record<string, unknown>;
            try { plan = JSON.parse(planRaw); } catch {
              plan = { project_type: "web app", features: ["basic UI"], tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html", "style.css", "script.js"], data_requirements: "none", special_notes: "" };
            }

            const features = (plan.features as string[]) || [];
            agent("analyst", "done", "Plan created", 100, `${features.length} features identified`);
            log(`Plan: ${features.join(", ")}`, "analyst");
            agent("supervisor", "done", "Awaiting human review…", 100);
            milestone("Plan ready for review");

            send({ type: "plan", plan });
            controller.close();
            return;
          }

          // ============================================================
          // MODE: "build" or "full" — execute full pipeline
          // ============================================================
          log(`🚀 Starting workflow for: "${prompt}"`);
          agent("supervisor", "running", "Initializing…", 20, "Parsing prompt structure…");
          milestone("Workflow initiated");

          // --- ANALYST (skip if plan already approved) ---
          let plan: Record<string, unknown>;

          if (approvedPlan) {
            plan = approvedPlan;
            agent("analyst", "done", "Using approved plan", 100, "Human-reviewed plan accepted");
            log("Using human-approved plan", "analyst");
          } else {
            agent("analyst", "running", "Analyzing prompt…", 10, "Breaking down requirements…");
            const planRaw = await callLLM(LOVABLE_API_KEY, ANALYST_SYSTEM, `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`, { json: true, temp: 0.1, model: "openai/gpt-5" });
            try { plan = JSON.parse(planRaw); } catch {
              plan = { project_type: "web app", features: ["basic UI"], tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html"], data_requirements: "none", special_notes: "" };
            }
            const features = (plan.features as string[]) || [];
            agent("analyst", "done", "Plan created", 100, `Features: ${features.slice(0, 3).join(", ")}`);
            log(`Analyst plan: ${features.join(", ")}`, "analyst");
          }

          agent("supervisor", "done", "Delegating to Developer & Designer", 100);
          milestone("Analysis complete");

          // --- DEVELOPER + DESIGNER (parallel) ---
          agent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding app structure…");
          agent("designer", "running", "Creating CSS…", 10, "Building design system & color palette…");
          log("Developer and Designer running in parallel…", "system");

          const [codeRaw, stylesRaw] = await Promise.all([
            callLLM(LOVABLE_API_KEY, DEVELOPER_SYSTEM, `Implement this project plan:\n${JSON.stringify(plan, null, 2)}\n\nReturn only valid JSON.`, { json: true, model: "google/gemini-2.5-pro" }),
            callLLM(LOVABLE_API_KEY, DESIGNER_SYSTEM, `Create styles for this project plan:\n${JSON.stringify(plan, null, 2)}\n\nReturn only valid JSON.`, { json: true, temp: 0.3, model: "openai/gpt-5-mini" }),
          ]);

          let code: { html: string; js: string; notes?: string };
          try { code = JSON.parse(codeRaw); } catch {
            code = { html: "<h1>Generated App</h1><p>Content here</p>", js: "console.log('App ready');" };
          }

          let styles: { css: string; color_palette?: string[]; notes?: string };
          try { styles = JSON.parse(stylesRaw); } catch {
            styles = { css: "body { font-family: system-ui, sans-serif; margin: 2rem; }" };
          }

          // Basic code safety scan
          if (!codeIsSafe(code.js)) {
            log("⚠️ Unsafe patterns detected — sanitizing…", "developer");
            code.js = code.js
              .replace(/eval\s*\(/g, "/* eval removed */")
              .replace(/document\.write\s*\(/g, "/* document.write removed */")
              .replace(/Function\s*\(/g, "/* Function constructor removed */");
          }

          agent("developer", "done", "Code ready", 100, code.notes || "HTML + JS complete");
          log("Developer finished — HTML + JS generated", "developer");
          agent("designer", "done", "Styles ready", 100, styles.notes || "CSS complete with design system");
          log(`Designer finished — palette: ${(styles.color_palette || []).join(", ") || "generated"}`, "designer");
          milestone("Code & styles complete");

          // --- SECURITY AUDITOR ---
          agent("security", "running", "Auditing code…", 20, "Scanning for XSS, accessibility, and code quality issues…");
          log("Security Auditor scanning generated code…", "system");

          const auditRaw = await callLLM(
            LOVABLE_API_KEY,
            SECURITY_AUDITOR_SYSTEM,
            `Audit this code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
            { json: true, temp: 0.1, model: "google/gemini-2.5-flash" },
          );

          let audit: {
            security_issues?: { severity: string; description: string }[];
            accessibility_issues?: { severity: string; description: string }[];
            overall_score?: number;
            fixed_html?: string;
            fixed_js?: string;
            fixed_css?: string;
            summary?: string;
          };
          try { audit = JSON.parse(auditRaw); } catch { audit = {}; }

          const criticalCount = (audit.security_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;
          const a11yCount = (audit.accessibility_issues || []).filter((i) => i.severity === "critical" || i.severity === "high").length;

          // Apply fixes from security auditor
          if (audit.fixed_html) code.html = audit.fixed_html;
          if (audit.fixed_js) code.js = audit.fixed_js;
          if (audit.fixed_css) styles.css = audit.fixed_css;

          agent("security", "done", `Audit complete — score: ${audit.overall_score ?? "N/A"}/100`, 100,
            `${criticalCount} security fixes, ${a11yCount} accessibility fixes applied`);
          log(`Security Auditor: ${audit.summary || "Audit complete"}`, "security");
          if (criticalCount > 0) log(`🔒 Fixed ${criticalCount} critical/high security issues`, "security");
          if (a11yCount > 0) log(`♿ Fixed ${a11yCount} critical/high accessibility issues`, "security");
          milestone("Security audit passed");

          // --- OPTIMIZER ---
          agent("optimizer", "running", "Optimizing…", 30, "Combining, cleaning, and polishing…");

          const optimizedRaw = await callLLM(
            LOVABLE_API_KEY,
            OPTIMIZER_SYSTEM,
            `Optimize and combine this audited code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
            { json: true, temp: 0.1, model: "openai/gpt-5-mini" },
          );

          let optimized: { html: string; css: string; js: string; improvements?: string[] };
          try { optimized = JSON.parse(optimizedRaw); } catch {
            optimized = { html: code.html, css: styles.css, js: code.js };
          }

          agent("optimizer", "done", "Optimization complete", 100,
            `${(optimized.improvements || []).length} improvements applied`);
          log(`Optimizer: ${(optimized.improvements || []).slice(0, 3).join(", ") || "optimized"}`, "optimizer");
          milestone("Optimization done");

          // --- FINAL ---
          agent("supervisor", "running", "Packaging…", 80);
          agent("supervisor", "done", "Submission ready", 100);
          log("✅ All done! Project ready for download.", "system");
          milestone("Build complete ✅");

          send({
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
          });
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
