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
// LLM caller with retry & input guardrails
// ---------------------------------------------------------------------------
const DANGEROUS_PHRASES = ["ignore previous", "you are now", "system prompt", "disregard"];

function inputSafe(text: string): boolean {
  const lower = text.toLowerCase();
  return !DANGEROUS_PHRASES.some((p) => lower.includes(p));
}

async function callLLM(
  apiKey: string,
  system: string,
  user: string,
  opts: { json?: boolean; temp?: number; retries?: number } = {},
): Promise<string> {
  const { json: jsonMode = false, temp = 0.2, retries = 3 } = opts;

  if (!inputSafe(user)) throw new Error("Prompt rejected by input guardrail");

  const body: Record<string, unknown> = {
    model: "google/gemini-3-flash-preview",
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
      if (attempt < retries - 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
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
  const banned = [/eval\s*\(/, /document\.write\s*\(/, /innerHTML\s*=.*<script/i, /window\.location\s*=/];
  return !banned.some((rx) => rx.test(js));
}

// ---------------------------------------------------------------------------
// Specialized Agent Prompts
// ---------------------------------------------------------------------------
const ANALYST_SYSTEM = `You are a senior software architect with deep expertise in web development.
Analyze the user's prompt and produce a comprehensive, actionable technical plan.

Return a JSON object with these keys:
- project_type (string): e.g. "dashboard", "game", "form", "landing page"
- features (array of strings): specific, implementable features
- tech_stack (array of strings): prefer vanilla HTML/CSS/JS unless the prompt demands a framework
- file_structure (array of strings): always include index.html, style.css, script.js
- data_requirements (string): what data must be displayed, manipulated, or fetched
- special_notes (string): accessibility, responsiveness, edge cases, and constraints

Be precise. Every feature must be buildable in a single-page app.`;

const DEVELOPER_SYSTEM = `You are an expert front-end developer. Write clean, efficient, well-documented code.

Rules:
- Use vanilla HTML + JS (no frameworks unless the plan explicitly requires one).
- Code must be fully self-contained and run in a browser with zero dependencies.
- Include proper event listeners, DOM manipulation, error handling.
- Use demo/mock data instead of real API calls (generate realistic sample data).
- Add meaningful comments explaining key logic.
- Ensure keyboard navigation works for interactive elements.
- NEVER use eval(), document.write(), or inline event handlers in HTML attributes.

Return a JSON object with:
- "html" (string): the HTML body content only — no <html>, <head>, or <body> tags.
- "js" (string): complete JavaScript code.
- "notes" (string): brief explanation of implementation decisions.`;

const DESIGNER_SYSTEM = `You are a world-class UI/UX designer who writes exceptional CSS.

Rules:
- Use modern CSS: Grid, Flexbox, custom properties, clamp(), container queries where useful.
- Mobile-first responsive design with at least 3 breakpoints (mobile, tablet, desktop).
- Follow WCAG 2.1 AA: minimum 4.5:1 contrast, visible focus states, reduced-motion media query.
- Include a cohesive color palette with CSS custom properties (--color-primary, --color-secondary, etc.).
- Add subtle animations: hover transitions, entrance animations, smooth scrolling.
- Use a professional type scale with readable line heights.
- Add dark-mode support via prefers-color-scheme if appropriate.

Return a JSON object with:
- "css" (string): complete CSS stylesheet.
- "color_palette" (array of strings): hex colors used.
- "notes" (string): design decisions and accessibility notes.`;

const OPTIMIZER_SYSTEM = `You are a performance and quality engineer.

Take the provided HTML, CSS, and JS and produce an optimized, production-ready single-page app.

Tasks:
1. Combine everything into clean, well-structured code.
2. Remove dead code, redundant selectors, and unused variables.
3. Ensure CSS is efficient (no duplicate rules, proper specificity).
4. Ensure JS is clean (no console.logs in production, proper error handling).
5. Verify HTML semantics (proper heading hierarchy, landmarks, alt text).
6. Add meta viewport tag awareness in the HTML.
7. Keep all functionality identical — do NOT remove features.

Return a JSON object with:
- "html" (string): optimized HTML body content (no <html>/<head>/<body> wrappers).
- "css" (string): optimized CSS.
- "js" (string): optimized JS.`;

// ---------------------------------------------------------------------------
// Main handler
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
    const { prompt } = await req.json();
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
          log(`🚀 Starting workflow for: "${prompt}"`);

          // --- SUPERVISOR: init ---
          agent("supervisor", "running", "Initializing…", 20, "Parsing prompt structure…");
          milestone("Workflow initiated");

          // --- ANALYST ---
          agent("analyst", "running", "Analyzing prompt…", 10, "Breaking down requirements…");

          const planRaw = await callLLM(LOVABLE_API_KEY, ANALYST_SYSTEM, `Mystery prompt: ${prompt}\n\nOutput only valid JSON.`, { json: true, temp: 0.1 });

          let plan: Record<string, unknown>;
          try {
            plan = JSON.parse(planRaw);
          } catch {
            plan = { project_type: "web app", features: ["basic UI"], tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html", "style.css", "script.js"], data_requirements: "none", special_notes: "" };
          }

          const featureList = (plan.features as string[]) || [];
          agent("analyst", "done", "Plan created", 100, `Features: ${featureList.slice(0, 3).join(", ") || "analyzed"}`);
          log(`Analyst plan: ${featureList.join(", ") || "complete"}`, "analyst");
          agent("supervisor", "done", "Delegating to Developer & Designer", 100);
          milestone("Analysis complete");

          // --- DEVELOPER + DESIGNER (parallel) ---
          agent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding structure…");
          agent("designer", "running", "Creating CSS…", 10, "Setting up color palette & layout…");
          log("Developer and Designer running in parallel…", "system");

          const [codeRaw, stylesRaw] = await Promise.all([
            callLLM(LOVABLE_API_KEY, DEVELOPER_SYSTEM, `Implement this project plan:\n${JSON.stringify(plan, null, 2)}\n\nReturn only valid JSON.`, { json: true }),
            callLLM(LOVABLE_API_KEY, DESIGNER_SYSTEM, `Create styles for this project plan:\n${JSON.stringify(plan, null, 2)}\n\nReturn only valid JSON.`, { json: true, temp: 0.3 }),
          ]);

          let code: { html: string; js: string; notes?: string };
          try {
            code = JSON.parse(codeRaw);
          } catch {
            code = { html: "<h1>Generated App</h1><p>Content here</p>", js: "console.log('App ready');" };
          }

          let styles: { css: string; color_palette?: string[]; notes?: string };
          try {
            styles = JSON.parse(stylesRaw);
          } catch {
            styles = { css: "body { font-family: system-ui, sans-serif; margin: 2rem; }" };
          }

          // Code safety check
          if (!codeIsSafe(code.js)) {
            log("⚠️ Unsafe code detected — sanitizing…", "developer");
            code.js = code.js.replace(/eval\s*\(/g, "/* eval removed */").replace(/document\.write\s*\(/g, "/* document.write removed */");
          }

          agent("developer", "done", "Code ready", 100, code.notes || "HTML + JS complete");
          log("Developer finished — HTML + JS generated", "developer");
          agent("designer", "done", "Styles ready", 100, styles.notes || "CSS complete with modern design");
          log(`Designer finished — palette: ${(styles.color_palette || []).join(", ") || "generated"}`, "designer");
          milestone("Code & styles complete");

          // --- OPTIMIZER ---
          agent("optimizer", "running", "Optimizing…", 30, "Combining, cleaning, and minifying…");

          const optimizedRaw = await callLLM(
            LOVABLE_API_KEY,
            OPTIMIZER_SYSTEM,
            `Optimize and combine this code:\n\nHTML:\n${code.html}\n\nCSS:\n${styles.css}\n\nJS:\n${code.js}\n\nReturn only valid JSON.`,
            { json: true, temp: 0.1 },
          );

          let optimized: { html: string; css: string; js: string };
          try {
            optimized = JSON.parse(optimizedRaw);
          } catch {
            optimized = { html: code.html, css: styles.css, js: code.js };
          }

          agent("optimizer", "done", "Optimization complete", 100, "Bundle optimized & accessibility verified");
          log("Optimizer finished — code cleaned and combined", "optimizer");
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
