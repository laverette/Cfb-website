/**
 * Normalize ESPN game packages into provider-neutral matchup inputs.
 * Never invent metrics — missing → null.
 */

function numOrNull(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").replace(/%/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === "--") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickCompetitor(competitors, homeAway) {
  const list = Array.isArray(competitors) ? competitors : [];
  return list.find((c) => String(c.homeAway || "").toLowerCase() === homeAway) || null;
}

function parseStatMap(statistics) {
  const out = {};
  for (const s of statistics || []) {
    const key = String(s.name || s.abbreviation || s.label || "")
      .trim()
      .replace(/\s+/g, "");
    if (!key) continue;
    const val = numOrNull(s.value != null ? s.value : s.displayValue);
    out[key] = val;
    if (s.name) out[String(s.name)] = val;
  }
  return out;
}

function boxTeamMetrics(boxTeams, teamId) {
  const row = (boxTeams || []).find((t) => String(t.team?.id) === String(teamId));
  if (!row) return null;
  const m = parseStatMap(row.statistics);
  return {
    pointsPerGame: m.totalPointsPerGame ?? m.pointsPerGame ?? null,
    yardsPerGame: m.yardsPerGame ?? m.totalYardsPerGame ?? null,
    passingYardsPerGame: m.passingYardsPerGame ?? null,
    rushingYardsPerGame: m.rushingYardsPerGame ?? null,
    pointsAllowedPerGame: m.totalPointsPerGameAllowed ?? m.pointsAllowedPerGame ?? null,
    yardsAllowedPerGame: m.yardsPerGameAllowed ?? m.totalYardsAllowedPerGame ?? null,
    passingYardsAllowedPerGame: m.passingYardsPerGameAllowed ?? null,
    rushingYardsAllowedPerGame: m.rushingYardsPerGameAllowed ?? null,
  };
}

function parseLastFive(lastFiveGames, teamId, { beforeMs = null, excludeEventId = null } = {}) {
  const blocks = Array.isArray(lastFiveGames)
    ? lastFiveGames
    : lastFiveGames && typeof lastFiveGames === "object"
      ? Object.values(lastFiveGames)
      : [];
  const block = blocks.find((b) => String(b.team?.id) === String(teamId));
  if (!block) return { games: [], avgMargin: null, wins: null, losses: null };

  const games = [];
  for (const ev of block.events || []) {
    const eid = ev.id != null ? String(ev.id) : null;
    if (excludeEventId && eid && String(excludeEventId) === eid) continue;
    const ts = ev.gameDate ? Date.parse(ev.gameDate) : NaN;
    if (beforeMs != null && Number.isFinite(ts) && ts >= beforeMs) continue;

    const homeId = String(ev.homeTeamId ?? "");
    const awayId = String(ev.awayTeamId ?? "");
    const homeScore = numOrNull(ev.homeTeamScore);
    const awayScore = numOrNull(ev.awayTeamScore);
    if (homeScore == null || awayScore == null) continue;

    const isHome = homeId === String(teamId);
    const isAway = awayId === String(teamId);
    if (!isHome && !isAway) continue;

    const scored = isHome ? homeScore : awayScore;
    const allowed = isHome ? awayScore : homeScore;
    const margin = scored - allowed;
    const result = String(ev.gameResult || "").toUpperCase() || (margin > 0 ? "W" : margin < 0 ? "L" : "T");
    games.push({
      eventId: eid,
      week: ev.week ?? null,
      gameDate: ev.gameDate || null,
      opponentId: isHome ? awayId : homeId,
      opponentName: ev.opponent?.displayName || ev.opponent?.abbreviation || null,
      scored,
      allowed,
      margin,
      result,
      homeAway: isHome ? "home" : "away",
    });
  }

  // Prefer most recent completed prior games (already chronological in ESPN; take last 5).
  const recent = games.slice(-5);
  const margins = recent.map((g) => g.margin).filter((n) => Number.isFinite(n));
  const wins = recent.filter((g) => g.result === "W").length;
  const losses = recent.filter((g) => g.result === "L").length;
  const avgMargin =
    margins.length > 0 ? margins.reduce((s, x) => s + x, 0) / margins.length : null;

  return { games: recent, avgMargin, wins: recent.length ? wins : null, losses: recent.length ? losses : null };
}

function parseMarketOdds(pkg) {
  const pick = Array.isArray(pkg?.pickcenter) ? pkg.pickcenter[0] : null;
  const details = pick?.details ? String(pick.details) : null;
  const overUnder = numOrNull(pick?.overUnder);
  const spreadAbs = numOrNull(pick?.spread);

  let favoriteTeamId = null;
  let favoriteSpread = null; // negative magnitude for favorite
  if (pick?.awayTeamOdds?.favorite) {
    favoriteTeamId = String(pick.awayTeamOdds.team?.id || "");
    const line = numOrNull(pick?.pointSpread?.away?.close?.line);
    favoriteSpread = line != null ? line : spreadAbs != null ? -Math.abs(spreadAbs) : null;
  } else if (pick?.homeTeamOdds?.favorite) {
    favoriteTeamId = String(pick.homeTeamOdds.team?.id || "");
    const line = numOrNull(pick?.pointSpread?.home?.close?.line);
    favoriteSpread = line != null ? line : spreadAbs != null ? -Math.abs(spreadAbs) : null;
  } else if (details) {
    const m = details.match(/^([A-Z0-9]+)\s*([+-]?\d+(?:\.\d+)?)/i);
    if (m) {
      favoriteSpread = numOrNull(m[2]);
    }
  }

  return {
    details,
    overUnder,
    favoriteTeamId: favoriteTeamId || null,
    favoriteSpread,
    rawSpreadField: spreadAbs,
  };
}

function parsePredictor(pkg) {
  const p = pkg?.predictor;
  if (!p) return null;
  return {
    homeTeamId: p.homeTeam?.id != null ? String(p.homeTeam.id) : null,
    awayTeamId: p.awayTeam?.id != null ? String(p.awayTeam.id) : null,
    homeWinPct: numOrNull(p.homeTeam?.gameProjection),
    awayWinPct: numOrNull(p.awayTeam?.gameProjection),
  };
}

/**
 * Build a neutral matchup input from an ESPN package (summary / gamepackageJSON).
 */
function normalizeEspnMatchupPackage(pkg, { eventId, marketBettingLine = null } = {}) {
  if (!pkg || typeof pkg !== "object") return null;

  const header = pkg.header || {};
  const competition = Array.isArray(header.competitions) ? header.competitions[0] : null;
  if (!competition) return null;

  const competitors = competition.competitors || [];
  const home = pickCompetitor(competitors, "home");
  const away = pickCompetitor(competitors, "away");
  if (!home?.team?.id || !away?.team?.id) return null;

  const homeId = String(home.team.id);
  const awayId = String(away.team.id);
  const kickoff = competition.date || header.date || null;
  const kickoffMs = kickoff ? Date.parse(kickoff) : null;
  const neutralSite = Boolean(competition.neutralSite);
  const statusName = String(competition.status?.type?.name || competition.status?.type?.description || "").toLowerCase();
  const completed = Boolean(
    competition.status?.type?.completed || statusName.includes("final") || statusName === "status_final"
  );

  const boxTeams = pkg.boxscore?.teams || [];
  const homeMetrics = boxTeamMetrics(boxTeams, homeId);
  const awayMetrics = boxTeamMetrics(boxTeams, awayId);

  const odds = parseMarketOdds(pkg);
  const espnPredictor = parsePredictor(pkg);

  // Weekly Picks stores home-oriented line: >0 away favored, <0 home favored.
  let marketSpreadAway = null;
  let marketSpreadLabel = odds.details || null;
  if (marketBettingLine != null && Number.isFinite(Number(marketBettingLine))) {
    const n = Number(marketBettingLine);
    // Convert home-oriented to away-oriented (negative = away favorite).
    marketSpreadAway = -n;
    if (n > 0) marketSpreadLabel = `${away.team.abbreviation || away.team.displayName} -${n}`;
    else if (n < 0) marketSpreadLabel = `${home.team.abbreviation || home.team.displayName} ${n}`;
    else marketSpreadLabel = "PK";
  } else if (odds.favoriteTeamId && odds.favoriteSpread != null) {
    if (String(odds.favoriteTeamId) === awayId) marketSpreadAway = odds.favoriteSpread;
    else if (String(odds.favoriteTeamId) === homeId) marketSpreadAway = -odds.favoriteSpread;
  }

  const homeForm = parseLastFive(pkg.lastFiveGames, homeId, {
    beforeMs: Number.isFinite(kickoffMs) ? kickoffMs : null,
    excludeEventId: eventId,
  });
  const awayForm = parseLastFive(pkg.lastFiveGames, awayId, {
    beforeMs: Number.isFinite(kickoffMs) ? kickoffMs : null,
    excludeEventId: eventId,
  });

  const season = header.season?.year ?? null;
  const week = header.week?.number ?? null;

  return {
    eventId: String(eventId || header.id || ""),
    season,
    week,
    kickoff,
    neutralSite,
    completed,
    venue: neutralSite ? "neutral" : "b_home",
    homeTeam: {
      espnId: homeId,
      name: home.team.displayName || home.team.name || "Home",
      abbreviation: home.team.abbreviation || null,
      record: home.records?.[0]?.summary || home.record || null,
      metrics: homeMetrics,
      recentForm: homeForm,
    },
    awayTeam: {
      espnId: awayId,
      name: away.team.displayName || away.team.name || "Away",
      abbreviation: away.team.abbreviation || null,
      record: away.records?.[0]?.summary || away.record || null,
      metrics: awayMetrics,
      recentForm: awayForm,
    },
    marketSpreadAway,
    marketSpreadLabel,
    marketTotal: odds.overUnder,
    espnPredictor,
    source: "espn",
  };
}

function hasEnoughMetrics(input) {
  if (!input?.homeTeam?.metrics || !input?.awayTeam?.metrics) return false;
  const need = (m) => m.pointsPerGame != null || m.yardsPerGame != null;
  return need(input.homeTeam.metrics) && need(input.awayTeam.metrics);
}

module.exports = {
  numOrNull,
  normalizeEspnMatchupPackage,
  parseLastFive,
  parseMarketOdds,
  boxTeamMetrics,
  hasEnoughMetrics,
  pickCompetitor,
};
