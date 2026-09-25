/**
 * ESPN college-football adapter for Prop Lab.
 *
 * Verified endpoints used:
 * - GET site.api.../teams?limit=500                          (team id index)
 * - GET site.api.../teams/{id}/roster                       (athlete resolve)
 * - GET site.api.../teams/{id}/schedule?season={year}       (schedule / event ids)
 * - GET site.web.api.../athletes/{id}/gamelog?season={year} (primary game logs)
 * - GET site.api.../summary?event={id}                      (boxscore fallback)
 * - GET sports.core.api.../athletes/{id}                    (optional athlete meta)
 *
 * statisticslog exists but only exposes season-aggregate $ref links for CFB —
 * per-game reconstruction uses gamelog, then summary boxscores.
 */

const { parseSchedule } = require("../../parse");
const { dataLog } = require("../log");
const { dedupeGameLogs } = require("../game-key");
const { SITE, WEB, CORE, cachedEspnGet, dedupedFetch, mapPool } = require("./http");
const {
  parseAthleteGameLog,
  parsePlayerFromSummary,
  mapScheduleEvent,
  enrichLogsWithSchedule,
  validateGameLogs,
} = require("./parse");
const { resolveEspnTeamId, resolveEspnAthlete } = require("./resolve");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ttlForSeason(season) {
  const year = Number(season);
  const current = new Date().getFullYear();
  if (Number.isFinite(year) && year < current) return 14 * DAY;
  return 6 * HOUR;
}

async function fetchTeamScheduleRaw(team, season, { signal } = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  const teamId = await resolveEspnTeamId(team);
  if (!teamId) {
    const err = new Error(`ESPN team unresolved for ${team}`);
    err.code = "ESPN_TEAM_UNRESOLVED";
    throw err;
  }
  const url = `${SITE}/teams/${teamId}/schedule?season=${seasonYear}`;
  const { value, cacheSource } = await cachedEspnGet(
    `espn:schedule:${teamId}:${seasonYear}`,
    Math.min(ttlForSeason(seasonYear), 4 * HOUR),
    url,
    { signal }
  );
  const events = Array.isArray(value?.events) ? value.events : [];
  const mapped = events
    .map((evt) => mapScheduleEvent(evt, seasonYear, team))
    .filter(Boolean);
  return { rows: mapped, teamId, cacheSource };
}

async function getEspnTeamSchedule(team, season, { signal } = {}) {
  const { rows, cacheSource } = await fetchTeamScheduleRaw(team, season, { signal });
  const schedule = parseSchedule(rows, team);
  return {
    schedule,
    source: "espn",
    cacheSource,
    originalSource: "espn",
  };
}

async function fetchAthleteGameLogRaw(athleteId, season, { signal } = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  const url = `${WEB}/athletes/${athleteId}/gamelog?season=${seasonYear}`;
  const { value, cacheSource } = await cachedEspnGet(
    `espn:gamelog:${athleteId}:${seasonYear}`,
    ttlForSeason(seasonYear),
    url,
    { signal }
  );
  return { payload: value, cacheSource };
}

async function reconstructFromSummaries({
  athleteId,
  playerName,
  team,
  season,
  signal,
}) {
  const { rows } = await fetchTeamScheduleRaw(team, season, { signal });
  const completed = rows.filter((g) => g.completed && g.id != null);
  if (!completed.length) return [];

  const pieces = await mapPool(completed, 3, async (game) => {
    try {
      const url = `${SITE}/summary?event=${game.id}`;
      const { value } = await cachedEspnGet(
        `espn:summary:${game.id}`,
        14 * DAY,
        url,
        { signal }
      );
      const parsed = parsePlayerFromSummary(value, {
        athleteId,
        playerName,
        team,
      });
      if (!parsed) return null;
      return {
        gameId: String(game.id),
        week: game.week,
        season: game.season || Number(season),
        team,
        opponent:
          parsed.opponent ||
          (sameTeamLocal(team, game.homeTeam) ? game.awayTeam : game.homeTeam),
        homeAway: parsed.homeAway,
        points: parsed.points,
        oppPoints: parsed.oppPoints,
        completed: true,
        isFcs: false,
        oppClassification: null,
        startDate: game.startDate || null,
        playerName,
        sourcePlayerId: String(athleteId),
        sourceGameId: String(game.id),
        source: "espn",
        stats: parsed.stats,
      };
    } catch (err) {
      dataLog("ESPN", `Summary failed for event ${game.id}: ${err.message}`);
      return null;
    }
  });

  return pieces.filter(Boolean);
}

function sameTeamLocal(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/**
 * Load normalized player game logs from ESPN.
 */
async function getEspnPlayerGameLog({
  playerId,
  playerName,
  team,
  season,
  position,
  jersey,
  signal,
} = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  if (!playerName && !playerId) {
    const err = new Error("playerName or playerId required for ESPN lookup");
    err.code = "BAD_PARAMS";
    throw err;
  }
  if (!team) {
    const err = new Error("team required for ESPN player lookup");
    err.code = "BAD_PARAMS";
    throw err;
  }

  const resolved = await resolveEspnAthlete({
    name: playerName,
    team,
    season: seasonYear,
    position,
    jersey,
    cfbdPlayerId: playerId,
    signal,
  });

  if (resolved.ambiguous) {
    const err = new Error("Ambiguous ESPN player match");
    err.code = "ESPN_AMBIGUOUS_PLAYER";
    err.candidates = resolved.candidates;
    throw err;
  }
  if (!resolved.espnPlayerId) {
    const err = new Error(resolved.reason || "ESPN athlete not found");
    err.code = "ESPN_PLAYER_NOT_FOUND";
    throw err;
  }

  const athleteId = resolved.espnPlayerId;
  let logs = [];
  let cacheSource = "network";
  let path = "gamelog";

  try {
    const raw = await fetchAthleteGameLogRaw(athleteId, seasonYear, { signal });
    cacheSource = raw.cacheSource;
    logs = parseAthleteGameLog(raw.payload, {
      season: seasonYear,
      playerName: resolved.playerName || playerName,
      team,
      athleteId,
    });
    dataLog("ESPN", `Parsed ${logs.length} games from gamelog`);
  } catch (err) {
    dataLog("ESPN", `Gamelog failed: ${err.message}`);
    path = "summary";
  }

  if (!logs.length) {
    path = "summary";
    logs = await reconstructFromSummaries({
      athleteId,
      playerName: resolved.playerName || playerName,
      team,
      season: seasonYear,
      signal,
    });
    dataLog("ESPN", `Parsed ${logs.length} games from summaries`);
  }

  try {
    const sched = await getEspnTeamSchedule(team, seasonYear, { signal });
    logs = enrichLogsWithSchedule(logs, sched.schedule);
  } catch (err) {
    dataLog("ESPN", `Schedule enrich skipped: ${err.message}`);
  }

  logs = dedupeGameLogs(logs);
  const validation = validateGameLogs(logs, {
    season: seasonYear,
    playerName: resolved.playerName || playerName,
    team,
  });
  if (!validation.ok) {
    const err = new Error(`ESPN game logs failed validation (${validation.reason})`);
    err.code = "ESPN_INVALID_DATA";
    throw err;
  }

  // Optional core athlete ping (cached) — validates id still resolves.
  try {
    await cachedEspnGet(
      `espn:athlete:${athleteId}`,
      7 * DAY,
      `${CORE}/athletes/${athleteId}`,
      { signal }
    );
  } catch {
    // non-fatal
  }

  return {
    games: logs,
    source: "espn",
    originalSource: "espn",
    cacheSource,
    path,
    athlete: resolved,
  };
}

module.exports = {
  getEspnPlayerGameLog,
  getEspnTeamSchedule,
  resolveEspnAthlete,
  resolveEspnTeamId,
  parseAthleteGameLog,
  parsePlayerFromSummary,
  validateGameLogs,
};
