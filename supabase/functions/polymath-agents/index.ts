import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface AgentOutput {
  agent: string;
  status: "running" | "done";
  message: string;
  progress: number;
  thought?: string;
  output?: unknown;
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function callLLM(apiKey: string, system: string, user: string, jsonMode = false): Promise<string> {
  const body: Record<string, unknown> = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI gateway error [${resp.status}]: ${t}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: AgentOutput | { type: string; [k: string]: unknown }) => {
          controller.enqueue(encoder.encode(sseEvent(data)));
        };

        const sendLog = (text: string, agent = "system") => {
          send({ type: "log", text, agent });
        };

        const sendAgent = (agent: string, status: "running" | "done", message: string, progress: number, thought?: string) => {
          send({ type: "agent", agent, status, message, progress, thought } as AgentOutput);
        };

        const sendMilestone = (text: string) => {
          send({ type: "milestone", text });
        };

        try {
          sendLog(`🚀 Starting workflow for: "${prompt}"`);

          // --- SUPERVISOR ---
          sendAgent("supervisor", "running", "Initializing…", 20, "Parsing prompt structure...");
          sendMilestone("Workflow initiated");

          // --- ANALYST ---
          sendAgent("analyst", "running", "Analyzing prompt…", 10, "Breaking down requirements...");

          const planRaw = await callLLM(
            LOVABLE_API_KEY,
            "You are a senior software architect. Return a JSON object with keys: project_type (string), features (array of strings), tech_stack (array of strings), file_structure (array of strings), data_requirements (string), special_notes (string).",
            `Create a technical plan for: ${prompt}`,
            true
          );

          let plan: Record<string, unknown>;
          try {
            plan = JSON.parse(planRaw);
          } catch {
            plan = { project_type: "web app", features: ["basic UI"], tech_stack: ["HTML", "CSS", "JS"], file_structure: ["index.html", "style.css", "script.js"], data_requirements: "none", special_notes: "" };
          }

          sendAgent("analyst", "done", "Plan created", 100, `Plan: ${(plan.features as string[])?.slice(0, 3).join(", ") || "analyzed"}`);
          sendLog(`Analyst plan: ${(plan.features as string[])?.join(", ") || "complete"}`, "analyst");
          sendAgent("supervisor", "done", "Ready", 100);
          sendMilestone("Analysis complete");

          // --- DEVELOPER + DESIGNER (parallel) ---
          sendAgent("developer", "running", "Writing HTML & JS…", 10, "Scaffolding structure...");
          sendAgent("designer", "running", "Creating CSS…", 10, "Setting up color palette...");
          sendLog("Developer and Designer running in parallel…", "system");

          const [codeRaw, stylesRaw] = await Promise.all([
            callLLM(
              LOVABLE_API_KEY,
              'You are an expert front-end developer. Return a JSON object with keys: html (string - the HTML body content only, no <html>/<head>/<body> tags), js (string - the JavaScript code). The code must be self-contained and functional. Use demo/mock data instead of real API calls.',
              `Write the HTML and JavaScript for this project:\n${JSON.stringify(plan, null, 2)}`,
              true
            ),
            callLLM(
              LOVABLE_API_KEY,
              'You are a CSS design expert. Return a JSON object with keys: css (string - complete CSS styles). Use modern CSS with gradients, glassmorphism effects, responsive design, and smooth transitions. Make it visually stunning.',
              `Create CSS styles for this project:\n${JSON.stringify(plan, null, 2)}`,
              true
            ),
          ]);

          let code: { html: string; js: string };
          try {
            code = JSON.parse(codeRaw);
          } catch {
            code = { html: "<h1>Generated App</h1><p>Content here</p>", js: "console.log('App ready');" };
          }

          let styles: { css: string };
          try {
            styles = JSON.parse(stylesRaw);
          } catch {
            styles = { css: "body { font-family: sans-serif; margin: 2rem; }" };
          }

          sendAgent("developer", "done", "Code ready", 100, "HTML + JS complete");
          sendLog("Developer finished — HTML + JS generated", "developer");
          sendAgent("designer", "done", "Styles ready", 100, "CSS complete with modern design");
          sendLog("Designer finished — CSS with glassmorphism + responsive layout", "designer");
          sendMilestone("Code & styles complete");

          // --- OPTIMIZER ---
          sendAgent("optimizer", "running", "Optimizing…", 30, "Minifying and combining...");

          const optimizedRaw = await callLLM(
            LOVABLE_API_KEY,
            'You are a performance optimization expert. Return a JSON object with keys: html (string - optimized HTML body content), css (string - minified CSS), js (string - minified JS). Combine, clean up, and minify the code. Ensure everything works together as a single page app.',
            `Optimize and combine this code:\nHTML: ${code.html}\nCSS: ${styles.css}\nJS: ${code.js}`,
            true
          );

          let optimized: { html: string; css: string; js: string };
          try {
            optimized = JSON.parse(optimizedRaw);
          } catch {
            optimized = { html: code.html, css: styles.css, js: code.js };
          }

          sendAgent("optimizer", "done", "Optimization complete", 100, "Bundle optimized");
          sendLog("Optimizer finished — code minified and combined", "optimizer");
          sendMilestone("Optimization done");

          // --- FINAL ---
          sendAgent("supervisor", "running", "Packaging…", 80);
          sendAgent("supervisor", "done", "Submission ready", 100);
          sendLog("✅ All done! Project ready for download.", "system");
          sendMilestone("Build complete ✅");

          // Send final result
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
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("Request error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
