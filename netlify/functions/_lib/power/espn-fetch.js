/**
 * ESPN fetches for the matchup predictor.
 * Reuses Prop Lab ESPN HTTP helpers (dedupe + cache). Never touches CFBD.
 */

const { SITE, cachedEspnGet, dedupedFetch } = require("../prop-lab/data/espn/http");

const CDN = "https://cdn.espn.com/core/college-football";

const TTL_UPCOMING_MS = 30 * 60 * 1000;
const TTL_TEAM_MS = 6 * 60 * 60 * 1000;
const TTL_COMPLETED_MS = 7 * 24 * 60 * 60 * 1000;

function emptyCounters() {
  return {
    espnRequests: 0,
    cacheHits: 0,
    cfbdRequests: 0,
    matchup: 0,
    game: 0,
    summary: 0,
    teamStats: 0,
  };
}

async function trackedGet(counters, kind, cacheKey, ttlMs, url) {
  const hit = await cachedEspnGet(cacheKey, ttlMs, url, { persist: true });
  if (hit.cacheSource === "memory" || hit.cacheSource === "persist" || hit.cacheSource === "cache") {
    counters.cacheHits += 1;
  } else {
    counters.espnRequests += 1;
    if (kind && counters[kind] != null) counters[kind] += 1;
  }
  return hit.value;
}

async function fetchEspnSummary(eventId, counters = emptyCounters(), { completed = false } = {}) {
  const id = String(eventId);
  const ttl = completed ? TTL_COMPLETED_MS : TTL_UPCOMING_MS;
  return trackedGet(
    counters,
    "summary",
    `espn:summary:${id}`,
    ttl,
    `${SITE}/summary?event=${encodeURIComponent(id)}`
  );
}

async function fetchEspnGamePackage(eventId, counters = emptyCounters(), { completed = false } = {}) {
  const id = String(eventId);
  const ttl = completed ? TTL_COMPLETED_MS : TTL_UPCOMING_MS;
  return trackedGet(
    counters,
    "game",
    `espn:game:${id}`,
    ttl,
    `${CDN}/game?xhr=1&gameId=${encodeURIComponent(id)}`
  );
}

async function fetchEspnMatchupPackage(eventId, counters = emptyCounters(), { completed = false } = {}) {
  const id = String(eventId);
  const ttl = completed ? TTL_COMPLETED_MS : TTL_UPCOMING_MS;
  return trackedGet(
    counters,
    "matchup",
    `espn:matchup:${id}`,
    ttl,
    `${CDN}/matchup?xhr=1&gameId=${encodeURIComponent(id)}`
  );
}

async function fetchEspnTeamStatistics(teamId, season, counters = emptyCounters()) {
  const tid = String(teamId);
  const year = Number(season) || new Date().getFullYear();
  // Site team statistics endpoint is season-aware via current season context.
  return trackedGet(
    counters,
    "teamStats",
    `espn:team-stats:${year}:${tid}`,
    TTL_TEAM_MS,
    `${SITE}/teams/${encodeURIComponent(tid)}/statistics`
  );
}

/**
 * Load the richest available ESPN package for an event.
 * Priority: summary (stable, has lastFive + boxscore stats) → game xhr → matchup xhr.
 */
async function loadEspnEventPackage(eventId, counters = emptyCounters()) {
  const id = String(eventId);
  const errors = [];
  let summary = null;
  let game = null;
  let matchup = null;

  try {
    summary = await fetchEspnSummary(id, counters);
  } catch (err) {
    errors.push(`summary: ${err.message}`);
  }

  const hasBoxStats = (summary?.boxscore?.teams || []).some(
    (t) => Array.isArray(t.statistics) && t.statistics.length > 0
  );
  const hasLastFive = Array.isArray(summary?.lastFiveGames)
    ? summary.lastFiveGames.length > 0
    : Boolean(summary?.lastFiveGames);

  if (!summary || !hasBoxStats || !hasLastFive) {
    try {
      game = await fetchEspnGamePackage(id, counters);
    } catch (err) {
      errors.push(`game: ${err.message}`);
    }
  }

  if (!summary && !game) {
    try {
      matchup = await fetchEspnMatchupPackage(id, counters);
    } catch (err) {
      errors.push(`matchup: ${err.message}`);
    }
  }

  const packageJson =
    summary ||
    game?.gamepackageJSON ||
    matchup?.gamepackageJSON ||
    null;

  return {
    eventId: id,
    summary,
    game,
    matchup,
    packageJson,
    errors,
    counters,
  };
}

module.exports = {
  emptyCounters,
  fetchEspnSummary,
  fetchEspnGamePackage,
  fetchEspnMatchupPackage,
  fetchEspnTeamStatistics,
  loadEspnEventPackage,
  dedupedFetch,
  SITE,
  CDN,
};
