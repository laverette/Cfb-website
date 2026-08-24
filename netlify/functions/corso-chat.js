/**
 * POST /api/corso/chat
 * Body: {
 *   message: string,
 *   history?: [{ role: 'user'|'model', text: string }],
 *   weekContext?: { weekNumber, seasonYear, games?: [...] }
 * }
 * Calls Mistral as Lee Corso with current week picks context.
 */
const { json, parseJsonBody } = require("./_http");

const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 12;
const MAX_HISTORY_CHARS = 600;
const MAX_CONTEXT_GAMES = 20;
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

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
    "When evaluating a matchup, briefly mention recent form (last week / this year) before making your pick.",
    "Use the OFFICIAL PICKS SLATE for game numbers and matchups. Prefer slate facts over outdated assumptions.",
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

function buildMessages(message, history, weekContext) {
  const messages = [{ role: "system", content: buildSystemPrompt(weekContext) }];
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

  for (const turn of list) {
    if (!turn || typeof turn !== "object") continue;
    const role = turn.role === "model" ? "assistant" : "user";
    const content = sanitizeText(turn.text ?? turn.content, MAX_HISTORY_CHARS);
    if (!content) continue;
    messages.push({ role, content });
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
    `Ground your take in ${weekBit} using the OFFICIAL PICKS SLATE.`,
    'If they mention Game 1, Game 2, etc., use the OFFICIAL PICKS SLATE numbering from your instructions.',
    "Give a complete answer with a clear pick when asked who wins.)",
  ].join(" ");

  messages.push({ role: "user", content: userPrompt });
  return messages;
}

function extractReply(data) {
  const choice = data?.choices?.[0];
  const reply = choice?.message?.content;
  const finishReason = choice?.finish_reason || null;
  return {
    reply: typeof reply === "string" ? reply.trim() : "",
    finishReason,
  };
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

  const messages = buildMessages(message, body.history, weekContext);

  try {
    const resp = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.85,
        max_tokens: 1024,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const details =
        data?.message ||
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

    const { reply, finishReason } = extractReply(data);
    if (!reply) {
      return json(
        502,
        {
          error: "Coach Corso came up empty",
          details: finishReason
            ? `No text in Mistral response (${finishReason}).`
            : "No text in Mistral response.",
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
        truncated: finishReason === "length",
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
