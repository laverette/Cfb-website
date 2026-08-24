/**
 * POST /api/corso/chat
 * Body: {
 *   message: string,
 *   history?: [{ role: 'user'|'model', text: string }],
 *   weekContext?: { weekNumber, seasonYear, games?: [...] }
 * }
 * Calls Gemini as Lee Corso with Google Search grounding + current week context.
 */
const { json, parseJsonBody } = require("./_http");

const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 12;
const MAX_HISTORY_CHARS = 600;
const MAX_CONTEXT_GAMES = 20;

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

function readGeminiKey() {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.Gemini_API_Key,
  ];
  for (const candidate of candidates) {
    const raw = candidate && String(candidate).trim();
    if (raw) return raw;
  }
  return "";
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

function buildSystemPrompt(weekContext) {
  const today = formatTodayLabel();
  const year = new Date().getFullYear();
  const weekNumber = weekContext?.weekNumber ?? weekContext?.week_number ?? null;
  const seasonYear =
    weekContext?.seasonYear ?? weekContext?.season_year ?? year;

  const lines = [
    "You are Lee Corso, the legendary college football analyst from ESPN's College GameDay.",
    "Respond as Lee Corso would: energetic, folksy, punchy, and opinionated about college football.",
    'Use his signature flair — mascot energy, "not so fast my friend" when disagreeing, and bold picks when asked.',
    "Stay in character. Do not claim to be an AI. You are Coach Corso.",
    "Always finish your thought with complete sentences — never stop mid-sentence.",
    "Keep answers tight (about 3–6 complete sentences) unless the fan asks for more detail.",
    "",
    `Today's date (Eastern): ${today}.`,
    `Current calendar year: ${year}. College football season year in focus: ${seasonYear}.`,
    weekNumber
      ? `This site's active picks slate is Week ${weekNumber} of the ${seasonYear} season.`
      : `This site is running a ${seasonYear} college football picks slate.`,
    "",
    "You have Google Search. USE it for recent results, injuries, rankings, and how teams looked last week / this season.",
    "When evaluating a matchup, briefly mention recent form (last week / this year) before making your pick.",
    "Prefer current-season facts over outdated coaching/roster assumptions.",
    "Stick to college football; if asked about something else, steer it back with Corso charm.",
  ];

  const games = Array.isArray(weekContext?.games) ? weekContext.games : [];
  if (games.length) {
    lines.push(
      "",
      `OFFICIAL PICKS SLATE — ${games.length} games. Fans will say "Game 1", "Game 2", etc.`,
      "Those numbers map EXACTLY to this list (not TV order, not AP ranking order):"
    );
    const ordered = [...games].sort((a, b) => {
      const an = Number(a.gameNumber ?? a.game_number) || 0;
      const bn = Number(b.gameNumber ?? b.game_number) || 0;
      return an - bn;
    });
    ordered.slice(0, MAX_CONTEXT_GAMES).forEach((g, i) => {
      const n = Number(g.gameNumber ?? g.game_number) || i + 1;
      const away = g.away || g.awayTeamName || "TBD";
      const home = g.home || g.homeTeamName || "TBD";
      const when = g.start || g.startDate || g.start_date || g.gameDate || g.game_date || "";
      const line = g.line ?? g.bettingLine ?? g.betting_line;
      const completed = !!(g.completed ?? g.isCompleted ?? g.is_completed);
      const score =
        completed &&
        (g.awayScore != null || g.homeScore != null || g.away_score != null)
          ? ` final ${g.awayScore ?? g.away_score ?? "?"}–${g.homeScore ?? g.home_score ?? "?"}`
          : "";
      const lineBit = line != null && line !== "" ? ` line ${line}` : "";
      lines.push(
        `Game ${n}: ${away} at ${home}${when ? ` | ${when}` : ""}${lineBit}${score}`
      );
    });
    lines.push(
      "",
      'When a fan asks about "Game N", answer about that numbered matchup from this slate.',
      "If they ask who you like this week without a game number, you can run through several of these games."
    );
  } else {
    lines.push(
      "",
      "No picks-slate games were attached to this request. If the fan asks about Game 1/2/etc., say you need the week's slate and ask which matchup they mean."
    );
  }

  return lines.join("\n");
}

function buildContents(message, history, weekContext) {
  const contents = [];
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

  for (const turn of list) {
    if (!turn || typeof turn !== "object") continue;
    const role = turn.role === "model" ? "model" : "user";
    const text = sanitizeText(turn.text ?? turn.content, MAX_HISTORY_CHARS);
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }

  const seasonYear =
    weekContext?.seasonYear ?? weekContext?.season_year ?? new Date().getFullYear();
  const weekNumber = weekContext?.weekNumber ?? weekContext?.week_number;
  const weekBit = weekNumber
    ? `Week ${weekNumber} of the ${seasonYear} college football season`
    : `the ${seasonYear} college football season`;

  const userPrompt = [
    message,
    "",
    `(Respond as if you were Lee Corso. Today is ${formatTodayLabel()}.`,
    `Ground your take in ${weekBit} and recent results — search if needed.`,
    'If they mention Game 1, Game 2, etc., use the OFFICIAL PICKS SLATE numbering from your instructions.',
    "Give a complete answer with a clear pick when asked who wins.)",
  ].join(" ");

  contents.push({ role: "user", parts: [{ text: userPrompt }] });
  return contents;
}

function extractReply(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return { reply: "", finishReason: candidate?.finishReason || null };
  const reply = parts
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      // Skip internal thinking/thought parts when present
      if (p.thought) return "";
      return typeof p.text === "string" ? p.text : "";
    })
    .join("")
    .trim();
  return { reply, finishReason: candidate?.finishReason || null };
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
      start: sanitizeText(g.start ?? g.startDate ?? g.start_date, 80),
      line: g.line ?? g.bettingLine ?? g.betting_line ?? null,
      completed: !!(g.completed ?? g.isCompleted ?? g.is_completed),
      awayScore: g.awayScore ?? g.away_score ?? null,
      homeScore: g.homeScore ?? g.home_score ?? null,
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

  const apiKey = readGeminiKey();
  if (!apiKey) {
    return json(
      503,
      {
        error: "Coach Corso is offline",
        details:
          "GEMINI_API_KEY is not configured on the server. In Netlify, the key name must be exactly GEMINI_API_KEY (all caps), with Functions scope, then trigger a new deploy.",
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
    (process.env.GEMINI_MODEL && String(process.env.GEMINI_MODEL).trim()) ||
    "gemini-3.6-flash";

  const contents = buildContents(message, body.history, weekContext);
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
          parts: [{ text: buildSystemPrompt(weekContext) }],
        },
        contents,
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 1,
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingLevel: "low",
          },
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

    const { reply, finishReason } = extractReply(data);
    if (!reply) {
      return json(
        502,
        {
          error: "Coach Corso came up empty",
          details: finishReason
            ? `No text in Gemini response (${finishReason}).`
            : "No text in Gemini response.",
        },
        corsHeaders()
      );
    }

    return json(
      200,
      {
        reply,
        model,
        finishReason,
        truncated: finishReason === "MAX_TOKENS",
      },
      corsHeaders()
    );
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
