/**
 * POST /api/corso/chat
 * Body: {
 *   message: string,
 *   history?: [{ role: 'user'|'model', text: string }],
 *   weekContext?: { weekNumber, seasonYear, games?: [...] }
 * }
 * Mistral Conversations API + web_search for current-season facts.
 * Prompt stays lean: persona + date + Game 1–N slate only.
 */
const { json, parseJsonBody } = require("./_http");

const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 8;
const MAX_HISTORY_CHARS = 400;
const MAX_CONTEXT_GAMES = 20;
const MISTRAL_URL = "https://api.mistral.ai/v1/conversations";

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

function readMistralKey() {
  const raw = process.env.MISTRAL_API_KEY && String(process.env.MISTRAL_API_KEY).trim();
  return raw || "";
}

function formatTodayLabel() {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildInstructions(weekContext) {
  const today = formatTodayLabel();
  const year = new Date().getFullYear();
  const weekNumber = weekContext?.weekNumber ?? weekContext?.week_number ?? null;
  const seasonYear =
    weekContext?.seasonYear ?? weekContext?.season_year ?? year;

  const lines = [
    "You are Lee Corso from ESPN College GameDay: energetic, folksy, punchy, opinionated.",
    'Use Corso flair ("not so fast my friend", bold picks). Stay in character. Never say you are an AI.',
    "Finish complete sentences. Keep answers to about 3–6 sentences unless asked for more.",
    "",
    `Today (Eastern): ${today}. Season in focus: ${seasonYear}.`,
    weekNumber
      ? `This site's picks slate is Week ${weekNumber}, ${seasonYear}.`
      : `This site's picks slate is the ${seasonYear} season.`,
    "",
    "CRITICAL — LOOK UP EACH TEAM BEFORE YOU TALK ABOUT IT:",
    `You have web_search. Before you discuss ANY team, SEARCH that team's CURRENT ${seasonYear} state: head coach, record, and how they looked recently (last game / this season).`,
    "For a matchup, search BOTH teams (or the Game N matchup) first, then give your take.",
    "Never rely on training memory for coaches, staff, or records — that data goes stale. Use search results for the current season only.",
    "In your answer, briefly reflect what you found (coach / form / recent result) before the pick.",
    "If search comes up empty, say you're unsure on that detail and still pick from the slate matchup.",
    "",
    "Use the OFFICIAL PICKS SLATE below for Game 1 / Game 2 / etc. numbering.",
    "Stick to college football.",
  ];

  const games = Array.isArray(weekContext?.games) ? weekContext.games : [];
  if (games.length) {
    lines.push("", `OFFICIAL PICKS SLATE (${games.length} games):`);
    const ordered = [...games].sort((a, b) => {
      const an = Number(a.gameNumber ?? a.game_number) || 0;
      const bn = Number(b.gameNumber ?? b.game_number) || 0;
      return an - bn;
    });
    ordered.slice(0, MAX_CONTEXT_GAMES).forEach((g, i) => {
      const n = Number(g.gameNumber ?? g.game_number) || i + 1;
      const away = g.away || "TBD";
      const home = g.home || "TBD";
      const line = g.line;
      const lineBit = line != null && line !== "" ? ` (${line})` : "";
      lines.push(`Game ${n}: ${away} at ${home}${lineBit}`);
    });
  }

  return lines.join("\n");
}

function buildInputs(message, history, weekContext) {
  const inputs = [];
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

  for (const turn of list) {
    if (!turn || typeof turn !== "object") continue;
    const role = turn.role === "model" ? "assistant" : "user";
    const content = sanitizeText(turn.text ?? turn.content, MAX_HISTORY_CHARS);
    if (!content) continue;
    inputs.push({ role, content });
  }

  const seasonYear =
    weekContext?.seasonYear ?? weekContext?.season_year ?? new Date().getFullYear();

  const userPrompt = [
    message,
    "",
    `(Lee Corso voice. Today is ${formatTodayLabel()}.`,
    `Before talking about a team, web-search that team's current ${seasonYear} coach, record, and recent form.`,
    "Use OFFICIAL PICKS SLATE for Game N. Clear pick when asked who wins.)",
  ].join(" ");

  inputs.push({ role: "user", content: userPrompt });
  return inputs;
}

function extractConversationReply(data) {
  const outputs = Array.isArray(data?.outputs) ? data.outputs : [];
  const texts = [];
  for (const output of outputs) {
    if (!output || output.type !== "message.output") continue;
    const content = output.content;
    if (typeof content === "string") {
      texts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      texts.push(
        content
          .map((chunk) => {
            if (!chunk || typeof chunk !== "object") return "";
            if (chunk.type === "text" && typeof chunk.text === "string") return chunk.text;
            if (typeof chunk.text === "string") return chunk.text;
            return "";
          })
          .join("")
      );
    }
  }
  return texts.join("\n").trim();
}

function mistralErrorForClient(status, details) {
  const msg = String(details || "").toLowerCase();
  if (
    status === 429 ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("capacity") ||
    msg.includes("too many requests")
  ) {
    return {
      status: 429,
      error: "Coach Corso is on the bench",
      details:
        "The Mistral API quota or rate limit was hit. Check usage in the Mistral console, or try again later.",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    error: "Coach Corso couldn't answer that",
    details: String(details || "Unknown error").slice(0, 240),
  };
}

function sanitizeWeekContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gamesIn = Array.isArray(raw.games) ? raw.games.slice(0, MAX_CONTEXT_GAMES) : [];
  return {
    weekNumber: raw.weekNumber ?? raw.week_number ?? null,
    seasonYear: raw.seasonYear ?? raw.season_year ?? null,
    games: gamesIn.map((g) => ({
      gameNumber: g.gameNumber ?? g.game_number ?? null,
      away: sanitizeText(g.away ?? g.awayTeamName, 80),
      home: sanitizeText(g.home ?? g.homeTeamName, 80),
      line: g.line ?? g.bettingLine ?? g.betting_line ?? null,
    })),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" }, corsHeaders());
  }

  const apiKey = readMistralKey();
  if (!apiKey) {
    return json(
      503,
      {
        error: "Coach Corso is offline",
        details:
          "MISTRAL_API_KEY is not configured on the server. In Netlify, add MISTRAL_API_KEY with Functions scope, then trigger a new deploy.",
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

  const weekContext = sanitizeWeekContext(body.weekContext);
  const model =
    (process.env.MISTRAL_MODEL && String(process.env.MISTRAL_MODEL).trim()) ||
    "mistral-small-latest";

  try {
    const resp = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: buildInstructions(weekContext),
        inputs: buildInputs(message, body.history, weekContext),
        tools: [{ type: "web_search" }],
        completion_args: {
          temperature: 0.85,
          max_tokens: 1024,
        },
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const details =
        data?.message ||
        data?.detail ||
        data?.error?.message ||
        (typeof data?.error === "string" ? data.error : null) ||
        `Mistral request failed (${resp.status})`;
      console.error("corso-chat mistral error:", resp.status, details);
      const clientErr = mistralErrorForClient(resp.status, details);
      return json(
        clientErr.status,
        { error: clientErr.error, details: clientErr.details },
        corsHeaders()
      );
    }

    const reply = extractConversationReply(data);
    if (!reply) {
      return json(
        502,
        {
          error: "Coach Corso came up empty",
          details: "No text in Mistral conversation response.",
        },
        corsHeaders()
      );
    }

    return json(200, { reply, model, provider: "mistral-conversations" }, corsHeaders());
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
