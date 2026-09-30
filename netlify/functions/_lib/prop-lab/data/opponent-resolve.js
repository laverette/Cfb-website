/**
 * Opponent resolution for Prop Lab — schedule/source separate from defensive stats.
 *
 * Priority:
 *   1. Prop ESPN event id (summary)
 *   2. Cached / fresh weekly ESPN scoreboard (team ESPN id match)
 *   3. ESPN team schedule (?season=&seasontype=2)
 *   4. Legacy CFBD team schedule
 *   5. bye | unresolved
 */
const { sameTeam, aliasTeam, normalizeTeam } = require("../names");
const { nextUnplayed, parseSchedule } = require("../parse");
const { dataLog } = require("./log");
const { readMemory, writeMemory } = require("../cache");
const { SITE, cachedEspnGet, dedupedFetch } = require("./espn/http");
const { resolveEspnTeamId } = require("./espn/resolve");
const { mapScheduleEvent, schoolFromEspnTeam } = require("./espn/parse");
const { isEspnEventId } = require("../../espn-game-results");

const HOUR = 60 * 60 * 1000;
const weekBoardCache = globalThis.__cfb_prop_week_board || new Map();
globalThis.__cfb_prop_week_board = weekBoardCache;
const inflightWeek = globalThis.__cfb_prop_week_inflight || new Map();
globalThis.__cfb_prop_week_inflight = inflightWeek;

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function teamKey(name) {
  return aliasTeam(name) || normalizeTeam(name);
}

function normalizeOppTeam({ name, espnId, abbreviation = null }) {
  const n = String(name || "").trim();
  if (!n && espnId == null) return null;
  return {
    name: n || null,
    espnId: espnId != null ? String(espnId) : null,
    abbreviation: abbreviation || null,
  };
}

function otherCompetitor(home, away, playerEspnId, playerTeam) {
  const homeId = toInt(home?.team?.id ?? home?.id);
  const awayId = toInt(away?.team?.id ?? away?.id);
  const pid = toInt(playerEspnId);
  if (pid != null && homeId === pid) {
    return {
      opponent: normalizeOppTeam({
        name: schoolFromEspnTeam(away?.team) || away?.team?.location,
        espnId: awayId,
        abbreviation: away?.team?.abbreviation,
      }),
      homeAway: "home",
      homeEspnId: homeId,
      awayEspnId: awayId,
    };
  }
  if (pid != null && awayId === pid) {
    return {
      opponent: normalizeOppTeam({
        name: schoolFromEspnTeam(home?.team) || home?.team?.location,
        espnId: homeId,
        abbreviation: home?.team?.abbreviation,
      }),
      homeAway: "away",
      homeEspnId: homeId,
      awayEspnId: awayId,
    };
  }
  const homeName = schoolFromEspnTeam(home?.team) || home?.team?.location;
  const awayName = schoolFromEspnTeam(away?.team) || away?.team?.location;
  if (playerTeam && sameTeam(playerTeam, homeName)) {
    return {
      opponent: normalizeOppTeam({ name: awayName, espnId: awayId }),
      homeAway: "home",
      homeEspnId: homeId,
      awayEspnId: awayId,
    };
  }
  if (playerTeam && sameTeam(playerTeam, awayName)) {
    return {
      opponent: normalizeOppTeam({ name: homeName, espnId: homeId }),
      homeAway: "away",
      homeEspnId: homeId,
      awayEspnId: awayId,
    };
  }
  return null;
}

function eventToResolved(evt, playerEspnId, playerTeam, seasonYear) {
  const comp = Array.isArray(evt?.competitions) ? evt.competitions[0] : null;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const side = otherCompetitor(home, away, playerEspnId, playerTeam);
  if (!side?.opponent?.name) return null;
  if (
    side.opponent.espnId &&
    playerEspnId &&
    String(side.opponent.espnId) === String(playerEspnId)
  ) {
    return null;
  }
  const status = evt?.status?.type || comp?.status?.type || {};
  const completed =
    status.completed === true ||
    String(status.state || "").toLowerCase() === "post" ||
    /final/i.test(String(status.name || ""));
  return {
    status: "ok",
    source: "espn",
    strategy: null,
    gameId: evt.id != null ? String(evt.id) : null,
    espnEventId: evt.id != null ? String(evt.id) : null,
    week: toInt(evt.week?.number ?? evt.week),
    season: toInt(evt.season?.year) || seasonYear,
    startDate: evt.date || comp.date || null,
    completed,
    homeAway: side.homeAway,
    opponent: side.opponent,
    playerEspnId: playerEspnId != null ? String(playerEspnId) : null,
    oppIsFcs: false,
  };
}

async function fetchWeekScoreboard(season, week, { signal } = {}) {
  const seasonYear = Number(season);
  const weekNum = Number(week);
  const cacheKey = `espn-week-board:${seasonYear}:${weekNum}`;
  const mem = weekBoardCache.get(cacheKey);
  if (mem && Date.now() - mem.at < 2 * HOUR && Array.isArray(mem.events)) {
    return { events: mem.events, cache: "HIT" };
  }
  if (inflightWeek.has(cacheKey)) return inflightWeek.get(cacheKey);

  const work = (async () => {
    const url = `${SITE}/scoreboard?seasontype=2&week=${weekNum}&dates=${seasonYear}&groups=80&limit=300`;
    dataLog("OpponentResolver", `Week board ${seasonYear} w${weekNum}`);
    const data = await dedupedFetch(url, { signal });
    const events = Array.isArray(data?.events) ? data.events : [];
    weekBoardCache.set(cacheKey, { at: Date.now(), events });
    writeMemory(cacheKey, { events }, 2 * HOUR);
    return { events, cache: "MISS" };
  })().finally(() => inflightWeek.delete(cacheKey));

  inflightWeek.set(cacheKey, work);
  return work;
}

async function resolveFromEventId(espnEventId, playerEspnId, playerTeam, seasonYear, signal) {
  const id = toInt(espnEventId);
  if (id == null) return null;
  const url = `${SITE}/summary?event=${id}`;
  try {
    const { value } = await cachedEspnGet(`espn:summary:${id}`, 30 * 60 * 1000, url, {
      signal,
    });
    const header = value?.header || value;
    const evt = {
      id,
      date: header?.competitions?.[0]?.date || header?.date,
      week: header?.week || value?.header?.week,
      season: header?.season || { year: seasonYear },
      status: header?.competitions?.[0]?.status || header?.status,
      competitions: header?.competitions || value?.competitions,
    };
    const resolved = eventToResolved(evt, playerEspnId, playerTeam, seasonYear);
    if (resolved) {
      resolved.strategy = "espn_event_id";
      return resolved;
    }
  } catch (err) {
    dataLog("OpponentResolver", `summary ${id} failed: ${err.message}`);
  }
  return null;
}

async function resolveFromWeekBoard({
  teamEspnId,
  team,
  season,
  week,
  signal,
}) {
  if (!Number.isFinite(Number(week))) return null;
  const { events, cache } = await fetchWeekScoreboard(season, week, { signal });
  dataLog(
    "OpponentResolver",
    `Week board events=${events.length} cache=${cache} teamEspnId=${teamEspnId}`
  );
  for (const evt of events) {
    const resolved = eventToResolved(evt, teamEspnId, team, Number(season));
    if (resolved) {
      resolved.strategy = "espn_week_scoreboard";
      resolved.boardCache = cache;
      resolved.boardEvents = events.length;
      return resolved;
    }
  }
  return { miss: true, boardEvents: events.length, cache };
}

async function resolveFromTeamSchedule({ teamEspnId, team, season, week, signal }) {
  const seasonYear = Number(season);
  let teamId = teamEspnId;
  if (!teamId) {
    teamId = await resolveEspnTeamId(team);
  }
  if (!teamId) return null;

  const url = `${SITE}/teams/${teamId}/schedule?season=${seasonYear}&seasontype=2`;
  const { value, cacheSource } = await cachedEspnGet(
    `espn:schedule:${teamId}:${seasonYear}:st2`,
    3 * HOUR,
    url,
    { signal }
  );
  const events = Array.isArray(value?.events) ? value.events : [];
  dataLog(
    "OpponentResolver",
    `Team schedule ${teamId} events=${events.length} cache=${cacheSource}`
  );

  const mapped = events
    .map((evt) => mapScheduleEvent(evt, seasonYear, team))
    .filter(Boolean);
  const schedule = parseSchedule(mapped, team);

  if (week != null) {
    const hit = schedule.find((g) => Number(g.week) === Number(week));
    if (hit?.opponent) {
      // Prefer ESPN ids from the raw event
      const raw = events.find((e) => toInt(e.week?.number) === Number(week));
      const resolved = raw
        ? eventToResolved(raw, teamId, team, seasonYear)
        : null;
      if (resolved) {
        resolved.strategy = "espn_team_schedule";
        return resolved;
      }
      return {
        status: "ok",
        source: "espn",
        strategy: "espn_team_schedule",
        gameId: hit.gameId != null ? String(hit.gameId) : null,
        espnEventId: hit.gameId != null ? String(hit.gameId) : null,
        week: hit.week,
        season: hit.season || seasonYear,
        startDate: hit.startDate,
        completed: Boolean(hit.completed),
        homeAway: hit.homeAway,
        opponent: normalizeOppTeam({ name: hit.opponent }),
        playerEspnId: String(teamId),
        oppIsFcs: Boolean(hit.oppIsFcs),
      };
    }
    // Bye: schedule loaded, week absent, surrounding weeks exist
    if (isLikelyBye(schedule, week)) {
      return {
        status: "bye",
        source: "espn",
        strategy: "espn_team_schedule",
        week: Number(week),
        season: seasonYear,
        opponent: null,
        playerEspnId: String(teamId),
        scheduleGames: schedule.length,
      };
    }
    // Explicit week requested but no game and not a mid-season bye
    // (e.g. week 99) — do not silently jump to the next unplayed game.
    return {
      status: "unresolved",
      reason: "OPPONENT_NOT_FOUND",
      week: Number(week),
      season: seasonYear,
      opponent: null,
      playerEspnId: String(teamId),
      scheduleGames: schedule.length,
      strategy: "espn_team_schedule",
      source: "espn",
    };
  }

  const next = nextUnplayed(schedule, week);
  if (next?.opponent) {
    return {
      status: "ok",
      source: "espn",
      strategy: "espn_team_schedule_next",
      gameId: next.gameId != null ? String(next.gameId) : null,
      espnEventId: next.gameId != null ? String(next.gameId) : null,
      week: next.week,
      season: next.season || seasonYear,
      startDate: next.startDate,
      completed: Boolean(next.completed),
      homeAway: next.homeAway,
      opponent: normalizeOppTeam({ name: next.opponent }),
      playerEspnId: String(teamId),
      oppIsFcs: Boolean(next.oppIsFcs),
    };
  }

  return {
    status: "unresolved",
    reason: "TEAM_SCHEDULE_EMPTY",
    scheduleGames: schedule.length,
    playerEspnId: String(teamId),
  };
}

function isLikelyBye(schedule, week) {
  if (week == null || !Array.isArray(schedule) || schedule.length < 6) return false;
  const w = Number(week);
  if (schedule.some((g) => Number(g.week) === w)) return false;
  const weeks = schedule.map((g) => Number(g.week)).filter(Number.isFinite);
  const min = Math.min(...weeks);
  const max = Math.max(...weeks);
  return w > min && w < max;
}

async function resolveFromCfbd({ team, season, week, cfbd }) {
  if (!cfbd || !team) return null;
  try {
    const raw = await cfbd.getOptional("/games", {
      year: Number(season),
      team,
      seasonType: "regular",
    });
    const schedule = parseSchedule(raw, team);
    if (week != null) {
      const hit = schedule.find((g) => Number(g.week) === Number(week));
      if (hit?.opponent) {
        return {
          status: "ok",
          source: "cfbd",
          strategy: "cfbd_schedule",
          gameId: hit.gameId != null ? String(hit.gameId) : null,
          espnEventId: null,
          week: hit.week,
          season: hit.season || Number(season),
          startDate: hit.startDate,
          completed: Boolean(hit.completed),
          homeAway: hit.homeAway,
          opponent: normalizeOppTeam({ name: hit.opponent }),
          oppIsFcs: Boolean(hit.oppIsFcs),
        };
      }
      if (isLikelyBye(schedule, week)) {
        return {
          status: "bye",
          source: "cfbd",
          strategy: "cfbd_schedule",
          week: Number(week),
          season: Number(season),
          opponent: null,
          scheduleGames: schedule.length,
        };
      }
    }
    const next = nextUnplayed(schedule, week);
    if (next?.opponent) {
      return {
        status: "ok",
        source: "cfbd",
        strategy: "cfbd_schedule_next",
        gameId: next.gameId != null ? String(next.gameId) : null,
        week: next.week,
        season: next.season || Number(season),
        startDate: next.startDate,
        completed: Boolean(next.completed),
        homeAway: next.homeAway,
        opponent: normalizeOppTeam({ name: next.opponent }),
        oppIsFcs: Boolean(next.oppIsFcs),
      };
    }
  } catch (err) {
    dataLog("OpponentResolver", `CFBD schedule failed: ${err.message}`);
  }
  return null;
}

/**
 * @returns {Promise<object>} resolved opponent descriptor
 */
async function resolveOpponent({
  team,
  season,
  week,
  gameDate = null,
  espnEventId = null,
  espnTeamId = null,
  cfbd = null,
  signal = null,
} = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  const weekNum = week != null ? Number(week) : null;
  const debug = {
    team,
    season: seasonYear,
    week: weekNum,
    espnEventId: espnEventId || null,
    steps: [],
  };

  let teamEspnId = espnTeamId ? String(espnTeamId) : null;
  if (!teamEspnId && team) {
    try {
      teamEspnId = await resolveEspnTeamId(team);
      debug.espnTeamId = teamEspnId;
    } catch (err) {
      debug.steps.push(`teamId resolve failed: ${err.message}`);
    }
  } else {
    debug.espnTeamId = teamEspnId;
  }

  // 1) Explicit event id
  if (espnEventId && (isEspnEventId(espnEventId) || toInt(espnEventId))) {
    const hit = await resolveFromEventId(
      espnEventId,
      teamEspnId,
      team,
      seasonYear,
      signal
    );
    debug.steps.push(hit ? `event_id ok → ${hit.opponent?.name}` : "event_id miss");
    if (hit) return { ...hit, debug };
  }

  // 2) Weekly ESPN scoreboard
  if (weekNum != null && teamEspnId) {
    try {
      const board = await resolveFromWeekBoard({
        teamEspnId,
        team,
        season: seasonYear,
        week: weekNum,
        signal,
      });
      if (board && !board.miss) {
        debug.steps.push(
          `week_board ok → ${board.opponent?.name} (events=${board.boardEvents})`
        );
        return { ...board, debug };
      }
      debug.steps.push(
        `week_board miss events=${board?.boardEvents ?? 0}`
      );
      // bye if board has games but team not on it and team schedule confirms
    } catch (err) {
      debug.steps.push(`week_board error: ${err.message}`);
    }
  }

  // 3) ESPN team schedule
  try {
    const sched = await resolveFromTeamSchedule({
      teamEspnId,
      team,
      season: seasonYear,
      week: weekNum,
      signal,
    });
    if (sched?.status === "ok") {
      debug.steps.push(`team_schedule ok → ${sched.opponent?.name}`);
      return { ...sched, debug };
    }
    if (sched?.status === "bye") {
      debug.steps.push("team_schedule bye");
      return { ...sched, debug };
    }
    debug.steps.push(`team_schedule ${sched?.reason || "empty"}`);
  } catch (err) {
    debug.steps.push(`team_schedule error: ${err.message}`);
  }

  // 4) CFBD fallback
  const cfbdHit = await resolveFromCfbd({
    team,
    season: seasonYear,
    week: weekNum,
    cfbd,
  });
  if (cfbdHit?.status === "ok" || cfbdHit?.status === "bye") {
    debug.steps.push(`cfbd ${cfbdHit.status} → ${cfbdHit.opponent?.name || "bye"}`);
    return { ...cfbdHit, debug };
  }
  debug.steps.push("cfbd miss");

  dataLog("OpponentResolver", "unresolved", debug);
  return {
    status: "unresolved",
    reason: "OPPONENT_NOT_FOUND",
    opponent: null,
    week: weekNum,
    season: seasonYear,
    playerEspnId: teamEspnId,
    debug,
  };
}

module.exports = {
  resolveOpponent,
  fetchWeekScoreboard,
  isLikelyBye,
  teamKey,
};
