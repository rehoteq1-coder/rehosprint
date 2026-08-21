/**
 * RehoSprint / Lesson AI — Cloudflare Worker
 *
 * Groq retired llama-3.3-70b-versatile on 16 Aug 2026.
 * Defaults to openai/gpt-oss-120b. Uses any Groq secret already on the worker
 * (GROQ_API_KEY, GROQ_KEY, API_KEY, or a value starting with gsk_).
 *
 * Deploy: Cloudflare → Workers → lesson-ai → Edit code → paste → Save & Deploy.
 */
function groqKey(env) {
  const named = env.GROQ_API_KEY || env.GROQ_KEY || env.API_KEY || env.GROQ
    || env.GROQAPIKEY || env.GROQ_TOKEN || env.AI_KEY || env.LESSON_AI_KEY;
  if (named) return named;
  for (const value of Object.values(env || {})) {
    if (typeof value === "string" && value.startsWith("gsk_")) return value;
  }
  return "";
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    const key = groqKey(env);
    if (!key) {
      return json({
        error: {
          message: "No Groq key on this Worker. In lesson-ai → Settings → Variables and Secrets, add a Secret named GROQ_API_KEY (your Groq key starts with gsk_)."
        }
      }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ error: { message: "Invalid JSON body." } }, 400, cors);
    }

    const prompt = body.prompt
      || (Array.isArray(body.messages) && body.messages[0] && body.messages[0].content)
      || "";
    if (!prompt) {
      return json({ error: { message: "Missing prompt." } }, 400, cors);
    }

    const model = body.model || "openai/gpt-oss-120b";
    const messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages
      : [{ role: "user", content: prompt }];

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: typeof body.temperature === "number" ? body.temperature : 0.4
        })
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json", ...cors }
      });
    } catch (err) {
      return json({ error: { message: err.message || "Upstream request failed." } }, 502, cors);
    }
  }
};
