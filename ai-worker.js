/**
 * RehoSprint / Lesson AI — Cloudflare Worker
 *
 * Must be ES Module format (export default). Reads GROQ_API_KEY from
 * env bindings or any secret whose value starts with gsk_.
 */
function groqKey(env) {
  const sources = [env, globalThis];
  for (const src of sources) {
    if (!src) continue;
    let keys = [];
    try { keys = Object.keys(src); } catch (e) { continue; }
    for (const k of keys) {
      let v;
      try { v = src[k]; } catch (e) { continue; }
      if (typeof v !== "string" || v.length < 8) continue;
      if (v.startsWith("gsk_")) return v;
      const norm = k.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (norm === "groqapikey" || norm === "groqkey" || norm === "apikey") return v;
    }
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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const key = groqKey(env);
    let envNames = [];
    try { envNames = env ? Object.keys(env) : []; } catch (e) { envNames = []; }

    if (request.method === "GET") {
      return json({ ok: true, hasKey: !!key, envNames }, 200, cors);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    if (!key) {
      return json({
        error: {
          message: "GROQ_API_KEY not found on this Worker. Add a Secret named exactly GROQ_API_KEY, then Save and Deploy. Bindings seen: " + (envNames.join(", ") || "(none)")
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
