/**
 * RehoSprint / Lesson AI — Cloudflare Worker
 *
 * Groq retired llama-3.3-70b-versatile on 16 Aug 2026.
 * This worker defaults to openai/gpt-oss-120b and honours a client `model`.
 *
 * Deploy: Cloudflare Dashboard → Workers → lesson-ai → Edit code → paste → Save & Deploy.
 * Secret (already set if the old worker worked): GROQ_API_KEY  (also accepts GROQ_KEY)
 */
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

    const key = env.GROQ_API_KEY || env.GROQ_KEY || env.API_KEY;
    if (!key) {
      return json({ error: { message: "GROQ_API_KEY not configured on this Worker." } }, 500, cors);
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

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}
