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

async function loadSeasonSnapshot(playerId, year, def, apiKey, signal) {
  if (year < 2015) return null;
  const overview = await loadSeasonOverview(playerId, year, apiKey, signal);
  if (!overview) return null;
  const total = extractStatTotal(overview, def);
  const games = toNum(overview.games) || 0;
  if (total == null || games <= 0) return null;
  return {
    year,
    total,
    games,
    avg: total / games,
    overview,
  };
}

/**
 * Early-season seasons are noisy. Blend current pace with prior-year pace
 * when the sample is small.
 */
function buildBaseline(current, prior) {
  if (!current && !prior) return null;
  if (!current) {
    return {
      avg: prior.avg,
      games: prior.games,
      seasonTotal: prior.total,
      seasonYear: prior.year,
      currentAvg: null,
      priorAvg: prior.avg,
      priorYear: prior.year,
      blendWeightCurrent: 0,
      sampleNote: `Using ${prior.year} average only (${prior.total} in ${prior.games} games).`,
    };
  }

  const games = current.games;
  let avg = current.avg;
  let blendWeightCurrent = 1;
  let sampleNote = `${current.total} ${current.year} total across ${games} game${games === 1 ? "" : "s"} (avg ${current.avg.toFixed(1)}).`;

  if (prior && games < 4) {
    // 1 game → 35% current / 65% prior; 3 games → 70% / 30%
    blendWeightCurrent = clamp(0.2 + games * 0.175, 0.35, 0.75);
    avg = current.avg * blendWeightCurrent + prior.avg * (1 - blendWeightCurrent);
    sampleNote =
      `Small ${current.year} sample (${current.total} in ${games}g, avg ${current.avg.toFixed(1)}). ` +
      `Blended with ${prior.year} (${prior.total} in ${prior.games}g, avg ${prior.avg.toFixed(1)}).`;
  } else if (games < 3) {
    sampleNote += " Small sample — treat projection cautiously.";
  }

  return {
    avg,
    games,
    seasonTotal: current.total,
    seasonYear: current.year,
    currentAvg: current.avg,
    priorAvg: prior ? prior.avg : null,
    priorYear: prior ? prior.year : null,
    blendWeightCurrent,
    sampleNote,
  };
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
  if (!key) return null;
  const abbrAliases = {
    ecu: "east carolina",
    "e carolina": "east carolina",
    "east carolina": "east carolina",
    "ole miss": "ole miss",
    "miss state": "mississippi state",
    "miami fl": "miami",
    "miami ohio": "miami (oh)",
  };
  const needle = abbrAliases[key] || key;

  const scored = teams
    .map((t) => {
      const n = String(t.name || "").toLowerCase();
      const ab = String(t.abbreviation || "").toLowerCase();
      let score = 0;
      if (n === needle || ab === key || ab === needle) score = 100;
      else if (n.startsWith(needle) || needle.startsWith(n)) score = 80;
      else if (n.includes(needle) || needle.includes(n)) score = 60;
      else if (ab && (needle.includes(ab) || ab.includes(needle))) score = 40;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.t || null;
}

/**
 * Adjust baseline by relative team strength (player team vs opponent),
 * not opponent absolute rating alone — Alabama vs ECU should boost offense.
 */
function adjustForOpponent(avg, def, oppTeam, playerTeamRating) {
  if (!oppTeam || avg == null) {
    return { expected: avg, adjustmentPct: 0, reason: "No opponent rating applied" };
  }

  const oppRaw = toNum(oppTeam.rawPower) ?? 0;
  const oppDef = toNum(oppTeam.defenseRating);
  const oppOff = toNum(oppTeam.offenseRating);
  const playerRaw = toNum(playerTeamRating?.rawPower);

  let adjPct = 0;
  let reason = "";

  if (def.side === "offense") {
    // Relative power gap: stronger own team / weaker opponent → more production
    if (playerRaw != null) {
      const gap = playerRaw - oppRaw;
      adjPct = clamp(gap / 40, -0.35, 0.45);
      reason = `Matchup gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} power (player team ${playerRaw.toFixed(1)} vs opp ${oppRaw.toFixed(1)}) → ${(adjPct * 100).toFixed(0)}%`;
    } else {
      const signal = oppDef != null ? oppDef : oppRaw;
      adjPct = -clamp(signal / 40, -0.35, 0.35);
      reason =
        oppDef != null
          ? `Opponent defense ${oppDef.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs baseline`
          : `Opponent raw power ${oppRaw.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs baseline`;
    }
  } else {
    if (playerRaw != null) {
      const gap = oppRaw - playerRaw;
      adjPct = clamp(gap / 40, -0.35, 0.45);
      reason = `Matchup gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} (opponent offense environment) → ${(adjPct * 100).toFixed(0)}%`;
    } else {
      const signal = oppOff != null ? oppOff : oppRaw;
      adjPct = clamp(signal / 40, -0.35, 0.35);
      reason =
        oppOff != null
          ? `Opponent offense ${oppOff.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs baseline`
          : `Opponent raw power ${oppRaw.toFixed(1)} → ${(adjPct * 100).toFixed(0)}% vs baseline`;
    }
  }

  return {
    expected: avg * (1 + adjPct),
    adjustmentPct: adjPct,
    reason,
  };
}

function buildVerdict(expected, line, games, blended) {
  const edge = expected - line;
  const rel = Math.abs(line) > 0.01 ? Math.abs(edge) / Math.abs(line) : Math.abs(edge);
  const sampleGames = Number(games) || 0;
  const sampleFactor = clamp(sampleGames / 8, blended ? 0.28 : 0.35, 1);

  let lean = "tossup";
  // Counting stats / small edges stay toss-up more often
  const thresh = 0.1 * Math.max(Math.abs(line), 1);
  if (edge > thresh) lean = "over";
  else if (edge < -thresh) lean = "under";

  let confidence = Math.round(clamp(rel * 170 * sampleFactor, 15, 86));
  if (lean === "tossup") confidence = Math.min(confidence, 42);
  if (sampleGames > 0 && sampleGames < 3) confidence = Math.min(confidence, 48);
  if (blended) confidence = Math.min(confidence, 58);

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
  const [current, prior] = await Promise.all([
    loadSeasonSnapshot(playerId, seasonYear, def, apiKey, signal),
    loadSeasonSnapshot(playerId, seasonYear - 1, def, apiKey, signal),
  ]);

  const baseline = buildBaseline(current, prior);
  if (!baseline) {
    const err = new Error(`No ${def.label} found in recent seasons`);
    err.code = "NO_STAT_VALUE";
    throw err;
  }

  const overview = current?.overview || prior?.overview || null;
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
  const playerTeamRating = findTeamRating(powerTeams, playerTeam);
  const adjusted = adjustForOpponent(
    baseline.avg,
    def,
    oppRating,
    playerTeamRating
  );
  const blended = baseline.blendWeightCurrent != null && baseline.blendWeightCurrent < 1;
  const verdict = buildVerdict(
    adjusted.expected,
    lineNum,
    baseline.games,
    blended
  );

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
    seasonYear: baseline.seasonYear,
    games: baseline.games,
    seasonTotal: baseline.seasonTotal,
    seasonAvg: baseline.currentAvg != null ? baseline.currentAvg : baseline.avg,
    baselineAvg: baseline.avg,
    priorAvg: baseline.priorAvg,
    priorYear: baseline.priorYear,
    blendWeightCurrent: baseline.blendWeightCurrent,
    sampleNote: baseline.sampleNote,
    expected: adjusted.expected,
    adjustmentPct: adjusted.adjustmentPct,
    adjustmentReason: adjusted.reason,
    opponent: oppName
      ? {
          name: oppRating?.name || oppName,
          ranking: oppRating?.ranking ?? null,
          rawPower: oppRating?.rawPower ?? null,
          offenseRating: oppRating?.offenseRating ?? null,
          defenseRating: oppRating?.defenseRating ?? null,
          record: oppRating?.record ?? null,
          logoUrl: oppRating?.logoUrl ?? null,
          fromSchedule: Boolean(nextGame),
          week: nextGame?.week ?? null,
          homeAway: nextGame?.homeAway ?? null,
          matched: Boolean(oppRating),
        }
      : null,
    playerTeamRating: playerTeamRating
      ? {
          name: playerTeamRating.name,
          ranking: playerTeamRating.ranking ?? null,
          rawPower: playerTeamRating.rawPower ?? null,
          logoUrl: playerTeamRating.logoUrl ?? null,
        }
      : null,
    lean: verdict.lean,
    edge: verdict.edge,
    confidence: verdict.confidence,
    availableStats: listAvailableStats(overview),
    disclaimer:
      "Educational model only — not betting advice. Early-season props blend prior-year pace when the sample is thin.",
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
