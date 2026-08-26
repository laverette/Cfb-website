/**
 * POST /api/corso/chat
 * Body: {
 *   message: string,
 *   history?: [{ role: 'user'|'model', text: string }],
 *   weekContext?: { weekNumber, seasonYear, games?: [...] }
 * }
 * Mistral Conversations API + web_search for current-season facts.
 * Also injects a prior-week results brief for slate teams (CFBD) so Corso
 * can factor injuries/storylines from earlier in the season.
 */
const { json, parseJsonBody } = require("./_http");

const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 8;
const MAX_HISTORY_CHARS = 400;
const MAX_CONTEXT_GAMES = 20;
const MAX_STORYLINE_TEAMS = 24;
const MAX_PRIOR_GAMES_PER_TEAM = 8;
const CFBD_BASE = "https://api.collegefootballdata.com";
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

function readCfbdKey() {
  const raw = process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim();
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

function teamKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function collectSlateTeams(weekContext) {
  const games = Array.isArray(weekContext?.games) ? weekContext.games : [];
  const teams = [];
  const seen = new Set();
  for (const g of games) {
    for (const name of [g.away, g.home]) {
      const label = sanitizeText(name, 80);
      const key = teamKey(label);
      if (!label || !key || seen.has(key)) continue;
      seen.add(key);
      teams.push(label);
      if (teams.length >= MAX_STORYLINE_TEAMS) return teams;
    }
  }
  return teams;
}

function gameInvolvesTeam(game, key) {
  return teamKey(game?.homeTeam) === key || teamKey(game?.awayTeam) === key;
}

function formatPriorGameLine(game, teamName) {
  const key = teamKey(teamName);
  const home = game.homeTeam || "TBD";
  const away = game.awayTeam || "TBD";
  const week = game.week != null ? `W${game.week}` : "W?";
  const completed = Boolean(game.completed);
  const homePts = game.homePoints;
  const awayPts = game.awayPoints;

  if (!completed || homePts == null || awayPts == null) {
    const opp = teamKey(home) === key ? away : home;
    const loc = teamKey(home) === key ? "vs" : "@";
    return `${week}: ${loc} ${opp} (not final)`;
  }

  const isHome = teamKey(home) === key;
  const teamPts = isHome ? homePts : awayPts;
  const oppPts = isHome ? awayPts : homePts;
  const opp = isHome ? away : home;
  const loc = isHome ? "vs" : "@";
  const result = teamPts > oppPts ? "W" : teamPts < oppPts ? "L" : "T";
  return `${week}: ${result} ${loc} ${opp} ${teamPts}-${oppPts}`;
}

/**
 * Pull season-to-date results for slate teams from CFBD (prior weeks only).
 * Returns a compact brief Corso can use alongside web_search storylines.
 */
async function buildSeasonStorylineBrief(weekContext) {
  const apiKey = readCfbdKey();
  if (!apiKey) return null;

  const seasonYear = Number(weekContext?.seasonYear);
  const weekNumber = Number(weekContext?.weekNumber);
  if (!Number.isFinite(seasonYear)) return null;

  const teams = collectSlateTeams(weekContext);
  if (!teams.length) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = new URL(`${CFBD_BASE}/games`);
    url.searchParams.set("year", String(seasonYear));
    url.searchParams.set("seasonType", "regular");
    if (Number.isFinite(weekNumber) && weekNumber > 1) {
      // Prefer games before the current picks week when known.
      // CFBD has no "maxWeek"; we filter client-side after fetch.
    }

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn("corso-chat CFBD games:", resp.status);
      return null;
    }

    const payload = await resp.json().catch(() => []);
    const allGames = Array.isArray(payload) ? payload : [];

    const prior = allGames.filter((g) => {
      const w = Number(g.week);
      if (!Number.isFinite(w)) return false;
      if (Number.isFinite(weekNumber) && weekNumber > 0) return w < weekNumber;
      return Boolean(g.completed);
    });

    const lines = [
      `SEASON-TO-DATE RESULTS (through week before ${
        Number.isFinite(weekNumber) ? `Week ${weekNumber}` : "this slate"
      }, ${seasonYear}):`,
      "Use these as hard facts for prior weeks. Pair with web_search for injuries, suspensions, QB changes, and other storylines that scores alone do not show.",
    ];

    let any = false;
    for (const team of teams) {
      const key = teamKey(team);
      const teamGames = prior
        .filter((g) => gameInvolvesTeam(g, key))
        .sort((a, b) => Number(a.week) - Number(b.week) || Number(a.id) - Number(b.id))
        .slice(-MAX_PRIOR_GAMES_PER_TEAM);

      if (!teamGames.length) {
        lines.push(`- ${team}: no completed prior games found yet`);
        continue;
      }

      any = true;
      const wins = teamGames.filter((g) => {
        if (!g.completed || g.homePoints == null || g.awayPoints == null) return false;
        const isHome = teamKey(g.homeTeam) === key;
        const teamPts = isHome ? g.homePoints : g.awayPoints;
        const oppPts = isHome ? g.awayPoints : g.homePoints;
        return teamPts > oppPts;
      }).length;
      const losses = teamGames.filter((g) => {
        if (!g.completed || g.homePoints == null || g.awayPoints == null) return false;
        const isHome = teamKey(g.homeTeam) === key;
        const teamPts = isHome ? g.homePoints : g.awayPoints;
        const oppPts = isHome ? g.awayPoints : g.homePoints;
        return teamPts < oppPts;
      }).length;
      const recap = teamGames.map((g) => formatPriorGameLine(g, team)).join("; ");
      lines.push(`- ${team} (${wins}-${losses}): ${recap}`);
    }

    if (!any && teams.length) {
      lines.push("(No prior completed games yet for this slate — lean on web_search for Week 0/1 context.)");
    }

    return lines.join("\n");
  } catch (err) {
    console.warn("corso-chat storyline brief:", err && err.message ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildInstructions(weekContext, storylineBrief) {
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
    "CRITICAL — LOOK UP STORYLINES BEFORE YOU TALK ABOUT A TEAM OR MATCHUP:",
    `You have web_search. Before discussing ANY team on the slate, SEARCH that team's CURRENT ${seasonYear} situation:`,
    "- record / last game result",
    "- head coach",
    "- injuries, QB status, suspensions, portal returns, coaching drama",
    "- any week-by-week storyline that still matters THIS week (example: QB hurt in Week 1, questionable to return in Week 3)",
    "For a matchup, search BOTH teams (or the Game N matchup) for injury reports + preview notes, then give your take.",
    "Factor prior-week developments into the pick (availability, momentum, revenge games, trap spots).",
    "Never rely on training memory for coaches, staff, injuries, or records — that data goes stale. Prefer search + the season brief below.",
    "In your answer, briefly name the key storyline (injury / return / skid / hot streak) before the pick when it matters.",
    "If search comes up empty, say you're unsure on that detail and still pick from the slate matchup + season brief.",
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

  if (storylineBrief) {
    lines.push("", storylineBrief);
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
  const weekNumber = weekContext?.weekNumber ?? weekContext?.week_number ?? null;
  const weekBit = weekNumber != null ? ` ahead of Week ${weekNumber}` : "";

  const userPrompt = [
    message,
    "",
    `(Lee Corso voice. Today is ${formatTodayLabel()}.`,
    `Before talking about a team, web-search that team's current ${seasonYear}${weekBit} storylines: injuries, QB availability, suspensions, and how prior weeks shape this matchup.`,
    "Use SEASON-TO-DATE RESULTS for prior scores, and OFFICIAL PICKS SLATE for Game N. Clear pick when asked who wins.)",
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
    const storylineBrief = weekContext
      ? await buildSeasonStorylineBrief(weekContext)
      : null;

    const resp = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: buildInstructions(weekContext, storylineBrief),
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

    return json(
      200,
      {
        reply,
        model,
        provider: "mistral-conversations",
        storylinesAttached: Boolean(storylineBrief),
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
