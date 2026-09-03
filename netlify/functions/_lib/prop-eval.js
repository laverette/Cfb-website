/**
 * Prop bet evaluator — season averages adjusted by opponent strength.
 * Educational lean only; not betting advice or true market pricing.
 */

const CFBD_BASE = "https://api.collegefootballdata.com";

const STAT_DEFS = [
  {
    id: "pass_yds",
    label: "Passing yards",
    category: "passing",
    keys: ["YDS", "YARDS"],
    side: "offense",
  },
  {
    id: "pass_td",
    label: "Passing TDs",
    category: "passing",
    keys: ["TD", "TDS"],
    side: "offense",
  },
  {
    id: "pass_comp",
    label: "Completions",
    category: "passing",
    keys: ["COMP", "COMPLETIONS"],
    side: "offense",
  },
  {
    id: "pass_att",
    label: "Pass attempts",
    category: "passing",
    keys: ["ATT", "ATTEMPTS"],
    side: "offense",
  },
  {
    id: "pass_int",
    label: "Interceptions thrown",
    category: "passing",
    keys: ["INT", "INTS"],
    side: "offense",
  },
  {
    id: "rush_yds",
    label: "Rushing yards",
    category: "rushing",
    keys: ["YDS", "YARDS"],
    side: "offense",
  },
  {
    id: "rush_td",
    label: "Rushing TDs",
    category: "rushing",
    keys: ["TD", "TDS"],
    side: "offense",
  },
  {
    id: "rush_att",
    label: "Rush attempts",
    category: "rushing",
    keys: ["CAR", "ATT", "ATTEMPTS"],
    side: "offense",
  },
  {
    id: "rec",
    label: "Receptions",
    category: "receiving",
    keys: ["REC", "RECEPTIONS"],
    side: "offense",
  },
  {
    id: "rec_yds",
    label: "Receiving yards",
    category: "receiving",
    keys: ["YDS", "YARDS"],
    side: "offense",
  },
  {
    id: "rec_td",
    label: "Receiving TDs",
    category: "receiving",
    keys: ["TD", "TDS"],
    side: "offense",
  },
  {
    id: "tackles",
    label: "Total tackles",
    category: "defensive",
    keys: ["TOT", "TOTAL", "TKL", "TACKLES"],
    side: "defense",
  },
  {
    id: "sacks",
    label: "Sacks",
    category: "defensive",
    keys: ["SACKS", "SACK"],
    side: "defense",
  },
];

function pick(obj, ...keys) {
  if (!obj) return null;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function cfbdGet(path, query, apiKey, signal) {
  const url = new URL(CFBD_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`CFBD ${path} failed (${resp.status}): ${text.slice(0, 160)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function cfbdGetOptional(path, query, apiKey, signal) {
  try {
    return await cfbdGet(path, query, apiKey, signal);
  } catch {
    return null;
  }
}

function categoriesFrom(overview) {
  if (!overview) return [];
  const box = pick(overview, "boxScoreStats", "box_score_stats") || {};
  const cats = pick(box, "categories") || [];
  return Array.isArray(cats) ? cats : [];
}

function extractStatTotal(overview, def) {
  const cats = categoriesFrom(overview);
  const cat = cats.find(
    (c) => String(c.name || "").toLowerCase() === def.category.toLowerCase()
  );
  if (!cat || !Array.isArray(cat.stats)) return null;
  for (const key of def.keys) {
    const hit = cat.stats.find(
      (s) => String(s.stat || s.name || "").toUpperCase() === key
    );
    if (hit) {
      const n = toNum(hit.value ?? hit.statValue);
      if (n != null) return n;
    }
  }
  return null;
}

function listAvailableStats(overview) {
  return STAT_DEFS.filter((d) => extractStatTotal(overview, d) != null).map((d) => ({
    id: d.id,
    label: d.label,
    category: d.category,
  }));
}

async function searchPlayers({ q, team, year, apiKey, signal }) {
  const searchTerm = String(q || "").trim();
  if (searchTerm.length < 2) return [];
  const seasonYear = Number(year) || new Date().getFullYear();
  let hits = await cfbdGetOptional(
    "/player/search",
    {
      searchTerm,
      team: team || undefined,
      year: seasonYear,
    },
    apiKey,
    signal
  );
  if (!Array.isArray(hits) || !hits.length) {
    hits = await cfbdGetOptional(
      "/player/search",
      {
        searchTerm,
        team: team || undefined,
        year: seasonYear - 1,
      },
      apiKey,
      signal
    );
  }
  if (!Array.isArray(hits)) return [];
  return hits.slice(0, 20).map((h) => ({
    id: h.id != null ? String(h.id) : null,
    name:
      h.name ||
      `${h.firstName || ""} ${h.lastName || ""}`.trim() ||
      "Player",
    team: h.team || h.teamName || null,
    position: h.position || null,
    jersey: h.jersey != null ? String(h.jersey) : null,
    year: h.year || null,
  })).filter((h) => h.id);
}

async function loadSeasonOverview(playerId, year, apiKey, signal) {
  let data = await cfbdGetOptional(
    "/player/season/overview",
    { year, playerId },
    apiKey,
    signal
  );
  if (!data) {
    data = await cfbdGetOptional(
      "/player/season/overview",
      { year, player_id: playerId },
      apiKey,
      signal
    );
  }
  return data;
}

async function loadOverviewWithFallback(playerId, seasonYear, apiKey, signal) {
  for (const y of [seasonYear, seasonYear - 1, seasonYear - 2]) {
    if (y < 2015) continue;
    const overview = await loadSeasonOverview(playerId, y, apiKey, signal);
    if (overview && (toNum(overview.games) > 0 || categoriesFrom(overview).length)) {
      return { overview, seasonYear: y };
    }
  }
  return { overview: null, seasonYear };
}

function sameTeam(a, b) {
  return (
    String(a || "")
      .trim()
      .toLowerCase() ===
    String(b || "")
      .trim()
      .toLowerCase()
  );
}

async function findNextOpponent(team, seasonYear, apiKey, signal) {
  if (!team) return null;
  const games = await cfbdGetOptional(
    "/games",
    { year: seasonYear, team, seasonType: "regular" },
    apiKey,
    signal
  );
  if (!Array.isArray(games) || !games.length) return null;
  const now = Date.now();
  const upcoming = games
    .filter((g) => !g.completed)
    .map((g) => {
      const home = g.homeTeam || g.home_team;
      const away = g.awayTeam || g.away_team;
      const opponent = sameTeam(home, team) ? away : home;
      const start = g.startDate || g.start_date;
      const t = start ? Date.parse(start) : NaN;
      return {
        opponent,
        week: g.week,
        startDate: start || null,
        homeAway: sameTeam(home, team) ? "home" : "away",
        sortKey: Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((g) => g.opponent)
    .sort((a, b) => a.sortKey - b.sortKey);

  const next =
    upcoming.find((g) => g.sortKey >= now - 12 * 60 * 60 * 1000) || upcoming[0];
  return next || null;
}

function findTeamRating(teams, name) {
  if (!name || !Array.isArray(teams)) return null;
  const key = String(name).trim().toLowerCase();
  return (
    teams.find((t) => String(t.name || "").toLowerCase() === key) ||
    teams.find((t) => String(t.name || "").toLowerCase().includes(key)) ||
    teams.find((t) => key.includes(String(t.name || "").toLowerCase())) ||
    null
  );
}

/**
 * Adjust season average by opponent strength.
 * Offense props: tougher defense / stronger overall opponent → lower expectation.
 * Defense props: tougher offense opponent → higher expectation.
 */
function adjustForOpponent(avg, def, oppTeam) {
  if (!oppTeam || avg == null) {
    return { expected: avg, adjustmentPct: 0, reason: "No opponent rating applied" };
  }

  const raw = toNum(oppTeam.rawPower) ?? 0;
  const defR = toNum(oppTeam.defenseRating);
  const offR = toNum(oppTeam.offenseRating);

  let adjPct = 0;
  let reason = "";

  if (def.side === "offense") {
    // Prefer defense rating when present; else raw power
    const signal = defR != null ? defR : raw;
    // Positive signal = stronger opponent unit → suppress offensive production
    adjPct = -clamp(signal / 45, -0.28, 0.28);
    reason =
      defR != null
        ? `Opponent defense rating ${defR.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs season avg`
        : `Opponent raw power ${raw.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs season avg`;
  } else {
    const signal = offR != null ? offR : raw;
    adjPct = clamp(signal / 45, -0.28, 0.28);
    reason =
      offR != null
        ? `Opponent offense rating ${offR.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs season avg`
        : `Opponent raw power ${raw.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs season avg`;
  }

  return {
    expected: avg * (1 + adjPct),
    adjustmentPct: adjPct,
    reason,
  };
}

function buildVerdict(expected, line, games) {
  const edge = expected - line;
  const rel = Math.abs(line) > 0.01 ? Math.abs(edge) / Math.abs(line) : Math.abs(edge);
  const sampleFactor = clamp((Number(games) || 0) / 8, 0.35, 1);

  let lean = "tossup";
  if (edge > 0.08 * Math.max(Math.abs(line), 1)) lean = "over";
  else if (edge < -0.08 * Math.max(Math.abs(line), 1)) lean = "under";

  // Soft confidence 0–100
  let confidence = Math.round(clamp(rel * 180 * sampleFactor, 18, 88));
  if (lean === "tossup") confidence = Math.min(confidence, 45);

  return { lean, edge, confidence };
}

async function evaluateProp({
  playerId,
  team,
  name,
  statId,
  line,
  opponent,
  season,
  apiKey,
  powerTeams,
  signal,
}) {
  const def = STAT_DEFS.find((d) => d.id === statId);
  if (!def) {
    const err = new Error("Unknown stat");
    err.code = "BAD_STAT";
    throw err;
  }
  const lineNum = toNum(line);
  if (lineNum == null) {
    const err = new Error("Line must be a number");
    err.code = "BAD_LINE";
    throw err;
  }

  const seasonYear = Number(season) || new Date().getFullYear();
  const { overview, seasonYear: statsYear } = await loadOverviewWithFallback(
    playerId,
    seasonYear,
    apiKey,
    signal
  );
  if (!overview) {
    const err = new Error("No season stats found for this player");
    err.code = "NO_STATS";
    throw err;
  }

  const games = toNum(overview.games) || 0;
  const total = extractStatTotal(overview, def);
  if (total == null) {
    const err = new Error(`No ${def.label} found in season stats`);
    err.code = "NO_STAT_VALUE";
    throw err;
  }
  const gamesUsed = games > 0 ? games : 1;
  const avg = total / gamesUsed;

  const playerTeam =
    team ||
    pick(overview, "team", "teamName") ||
    null;

  let nextGame = null;
  let oppName = String(opponent || "").trim();
  if (!oppName && playerTeam) {
    nextGame = await findNextOpponent(playerTeam, seasonYear, apiKey, signal);
    if (nextGame?.opponent) oppName = nextGame.opponent;
  }

  const oppRating = findTeamRating(powerTeams, oppName);
  const adjusted = adjustForOpponent(avg, def, oppRating);
  const verdict = buildVerdict(adjusted.expected, lineNum, gamesUsed);

  return {
    player: {
      id: String(playerId),
      name:
        name ||
        pick(overview, "name", "athleteName") ||
        "Player",
      team: playerTeam,
      position: pick(overview, "position") || null,
    },
    stat: { id: def.id, label: def.label, category: def.category },
    line: lineNum,
    seasonYear: statsYear,
    games: gamesUsed,
    seasonTotal: total,
    seasonAvg: avg,
    expected: adjusted.expected,
    adjustmentPct: adjusted.adjustmentPct,
    adjustmentReason: adjusted.reason,
    opponent: oppName
      ? {
          name: oppName,
          ranking: oppRating?.ranking ?? null,
          rawPower: oppRating?.rawPower ?? null,
          offenseRating: oppRating?.offenseRating ?? null,
          defenseRating: oppRating?.defenseRating ?? null,
          record: oppRating?.record ?? null,
          logoUrl: oppRating?.logoUrl ?? null,
          fromSchedule: Boolean(nextGame),
          week: nextGame?.week ?? null,
          homeAway: nextGame?.homeAway ?? null,
        }
      : null,
    lean: verdict.lean,
    edge: verdict.edge,
    confidence: verdict.confidence,
    availableStats: listAvailableStats(overview),
    disclaimer:
      "Educational model only — not betting advice. Based on season averages and opponent power ratings.",
  };
}

module.exports = {
  STAT_DEFS,
  searchPlayers,
  evaluateProp,
  listAvailableStats,
  loadOverviewWithFallback,
  extractStatTotal,
};
