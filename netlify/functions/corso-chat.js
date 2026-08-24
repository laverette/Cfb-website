/**
 * POST /api/corso/chat
 * Body: { message: string, history?: [{ role: 'user'|'model', text: string }] }
 * Calls Gemini with a Lee Corso persona. Requires GEMINI_API_KEY.
 */
const { json, parseJsonBody } = require("./_http");

const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 12;
const MAX_HISTORY_CHARS = 600;

const CORSO_SYSTEM = `You are Lee Corso, the legendary college football analyst from ESPN's College GameDay.
Respond as Lee Corso would: energetic, folksy, punchy, and opinionated about college football.
Use his signature flair — short takes, mascot energy, "not so fast my friend" when disagreeing, and bold picks when asked.
Stay in character. Keep answers concise (usually 2–5 sentences) unless the fan asks for more detail.
Stick to college football; if asked about something else, steer it back with Corso charm.
Do not claim to be an AI. You are Coach Corso.`;

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}

function sanitizeText(value, max) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function buildContents(message, history) {
  const contents = [];
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

  for (const turn of list) {
    if (!turn || typeof turn !== "object") continue;
    const role = turn.role === "model" ? "model" : "user";
    const text = sanitizeText(turn.text ?? turn.content, MAX_HISTORY_CHARS);
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }

  const userPrompt = `${message}\n\n(Respond as if you were Lee Corso.)`;
  contents.push({ role: "user", parts: [{ text: userPrompt }] });
  return contents;
}

function extractReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" }, corsHeaders());
  }

  const apiKey = process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim();
  if (!apiKey) {
    return json(
      503,
      {
        error: "Coach Corso is offline",
        details: "GEMINI_API_KEY is not configured on the server.",
      },
      corsHeaders()
    );
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { error: "Invalid JSON body" }, corsHeaders());
  }

  const message = sanitizeText(body.message, MAX_MESSAGE_CHARS);
  if (!message) {
    return json(400, { error: "Message is required" }, corsHeaders());
  }

  const model =
    (process.env.GEMINI_MODEL && String(process.env.GEMINI_MODEL).trim()) ||
    "gemini-2.5-flash";

  const contents = buildContents(message, body.history);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: CORSO_SYSTEM }],
        },
        contents,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 512,
        },
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const details =
        data?.error?.message ||
        (typeof data?.error === "string" ? data.error : null) ||
        `Gemini request failed (${resp.status})`;
      console.error("corso-chat gemini error:", resp.status, details);
      return json(
        resp.status >= 400 && resp.status < 600 ? resp.status : 502,
        { error: "Coach Corso couldn't answer that", details: String(details).slice(0, 240) },
        corsHeaders()
      );
    }

    const reply = extractReply(data);
    if (!reply) {
      return json(
        502,
        { error: "Coach Corso came up empty", details: "No text in Gemini response." },
        corsHeaders()
      );
    }

    return json(200, { reply, model }, corsHeaders());
  } catch (err) {
    console.error("corso-chat:", err);
    return json(
      500,
      {
        error: "Coach Corso stumbled",
        details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
      },
      corsHeaders()
    );
  }
};
