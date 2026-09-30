/**
 * Opponent resolution for Prop Lab — schedule/source separate from defensive stats.
 *
 * Priority:
 *   1. Prop ESPN event id (summary)
 *   2. Site Weekly Picks games table (normalized ESPN schedule already stored)
 *   3. Shared Weekly Picks ESPN getWeeklyGames (date-range / week / web-host)
 *   4. ESPN team schedule (?season=&seasontype=2) — includes finals
 *   5. Legacy CFBD team schedule (interactive only)
 *   6. bye | unresolved with specific reason codes
 *
 * Completed/final games are valid opponents. Never use nextUnplayed for an
 * explicit Prop Lab week selection.
 */
const { sameTeam, aliasTeam, normalizeTeam } = require("../names");
const { nextUnplayed, parseSchedule, getTeamGameForWeek } = require("../parse");
const { dataLog } = require("./log");
const { SITE, cachedEspnGet, dedupedFetch } = require("./espn/http");
const { resolveEspnTeamId } = require("./espn/resolve");
const { mapScheduleEvent, schoolFromEspnTeam } = require("./espn/parse");
const { isEspnEventId } = require("../../espn-game-results");
const { getWeeklyGames } = require("../../espn-admin-schedule");

const HOUR = 60 * 60 * 1000;
const weekBoardCache = globalThis.__cfb_prop_week_board || new Map();
globalThis.__cfb_prop_week_board = weekBoardCache;
const inflightWeek = globalThis.__cfb_prop_week_inflight || new Map();
globalThis.__cfb_prop_week_inflight = inflightWeek;

const REASON = {
  TEAM_ID_UNRESOLVED: "TEAM_ID_UNRESOLVED",
  WEEK_RANGE_UNRESOLVED: "WEEK_RANGE_UNRESOLVED",
  ESPN_SCHEDULE_EMPTY: "ESPN_SCHEDULE_EMPTY",
  TEAM_NOT_IN_WEEK_SLATE: "TEAM_NOT_IN_WEEK_SLATE",
  TEAM_SCHEDULE_EMPTY: "TEAM_SCHEDULE_EMPTY",
  GAME_MATCH_FAILED: "GAME_MATCH_FAILED",
  OPPONENT_PARSE_FAILED: "OPPONENT_PARSE_FAILED",
  DEFENSE_PROFILE_UNAVAILABLE: "DEFENSE_PROFILE_UNAVAILABLE",
  OPPONENT_NOT_FOUND: "OPPONENT_NOT_FOUND",
  BYE: "BYE",
};

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function idEq(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
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

function logResolverTrace(trace) {
  const lines = [
    "[OpponentResolver]",
    `player = ${trace.player || "(n/a)"}`,
    `raw team = ${trace.rawTeam || "(n/a)"}`,
    `season = ${trace.season}`,
    `requested week = ${trace.week}`,
    `canonical team = ${trace.canonicalTeam || "?"}`,
    `internal team id = ${trace.internalTeamId || "?"}`,
    `ESPN team id = ${trace.espnTeamId || "?"}`,
    `schedule source = ${trace.scheduleSource || "?"}`,
    `schedule events returned = ${trace.scheduleEvents ?? "?"}`,
    `event IDs checked = ${(trace.eventIds || []).slice(0, 12).join(",") || "?"}`,
    `home team IDs = ${(trace.homeIds || []).slice(0, 12).join(",") || "?"}`,
    `away team IDs = ${(trace.awayIds || []).slice(0, 12).join(",") || "?"}`,
    `matching game found = ${trace.matchFound ?? "?"}`,
    `opponent = ${trace.opponent || "?"}`,
    `failure reason = ${trace.failureReason || "(none)"}`,
  ];
  dataLog("OpponentResolver", lines.join("\n"));
  if (process.env.PROP_LAB_OPP_DEBUG === "1" || process.env.NODE_ENV === "development") {
    console.log(lines.join("\n"));
  }
}

function otherCompetitor(home, away, playerEspnId, playerTeam) {
  const homeId = home?.team?.id ?? home?.id ?? home?.espnId;
  const awayId = away?.team?.id ?? away?.id ?? away?.espnId;
  const pid = playerEspnId != null ? String(playerEspnId) : null;

  if (pid != null && idEq(homeId, pid)) {
    return {
      opponent: normalizeOppTeam({
        name:
          home?.opponentName ||
          schoolFromEspnTeam(away?.team) ||
          away?.team?.location ||
          away?.name,
        espnId: awayId,
        abbreviation: away?.team?.abbreviation || away?.abbreviation,
      }),
      homeAway: "home",
      homeEspnId: homeId != null ? String(homeId) : null,
      awayEspnId: awayId != null ? String(awayId) : null,
    };
  }
  if (pid != null && idEq(awayId, pid)) {
    return {
      opponent: normalizeOppTeam({
        name:
          away?.opponentName ||
          schoolFromEspnTeam(home?.team) ||
          home?.team?.location ||
          home?.name,
        espnId: homeId,
        abbreviation: home?.team?.abbreviation || home?.abbreviation,
      }),
      homeAway: "away",
      homeEspnId: homeId != null ? String(homeId) : null,
      awayEspnId: awayId != null ? String(awayId) : null,
    };
  }

  const homeName =
    home?.name || schoolFromEspnTeam(home?.team) || home?.team?.location;
  const awayName =
    away?.name || schoolFromEspnTeam(away?.team) || away?.team?.location;
  if (playerTeam && sameTeam(playerTeam, homeName)) {
    return {
      opponent: normalizeOppTeam({ name: awayName, espnId: awayId }),
      homeAway: "home",
      homeEspnId: homeId != null ? String(homeId) : null,
      awayEspnId: awayId != null ? String(awayId) : null,
    };
  }
  if (playerTeam && sameTeam(playerTeam, awayName)) {
    return {
      opponent: normalizeOppTeam({ name: homeName, espnId: homeId }),
      homeAway: "away",
      homeEspnId: homeId != null ? String(homeId) : null,
      awayEspnId: awayId != null ? String(awayId) : null,
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
    idEq(side.opponent.espnId, playerEspnId)
  ) {
    return null;
  }
  const status = evt?.status?.type || comp?.status?.type || {};
  const completed =
    status.completed === true ||
    String(status.state || "").toLowerCase() === "post" ||
    /final/i.test(String(status.name || ""));
  // Canceled games are not usable opponents
  if (/cancel/i.test(String(status.name || status.detail || ""))) return null;
  return {
    status: "ok",
    source: "espn",
    strategy: null,
    reason: null,
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

function siteGameToResolved(game, playerEspnId, playerTeam, seasonYear, weekNum) {
  if (!game) return null;
  const homeId = game.home_team_espn_id ?? game.homeTeamEspnId;
  const awayId = game.away_team_espn_id ?? game.awayTeamEspnId;
  const homeName = game.home_team_name || game.homeTeamName;
  const awayName = game.away_team_name || game.awayTeamName;
  const side = otherCompetitor(
    { id: homeId, name: homeName },
    { id: awayId, name: awayName },
    playerEspnId,
    playerTeam
  );
  if (!side?.opponent?.name) return null;
  const eventId =
    game.cfbd_game_id ?? game.cfbdGameId ?? game.espn_event_id ?? game.espnEventId;
  return {
    status: "ok",
    source: "espn",
    strategy: "site_weekly_picks",
    reason: null,
    gameId: eventId != null ? String(eventId) : null,
    espnEventId: eventId != null && isEspnEventId(eventId) ? String(eventId) : null,
    week: weekNum,
    season: seasonYear,
    startDate: game.game_date || game.gameDate || null,
    completed: Boolean(game.is_completed ?? game.isCompleted),
    homeAway: side.homeAway,
    opponent: side.opponent,
    playerEspnId: playerEspnId != null ? String(playerEspnId) : null,
    oppIsFcs: false,
  };
}

function adminGameToResolved(game, playerEspnId, playerTeam, seasonYear, weekNum) {
  return siteGameToResolved(game, playerEspnId, playerTeam, seasonYear, weekNum);
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

/**
 * Resolve from the site's Weekly Picks games table — already normalized ESPN data.
 * Includes completed/final games. Does not call CFBD.
 */
async function resolveFromSiteWeeklyPicks({
  teamEspnId,
  team,
  season,
  week,
}) {
  if (!Number.isFinite(Number(week)) || !Number.isFinite(Number(season))) {
    return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED };
  }
  try {
    const db = require("../../../db");
    let supabase = null;
    try {
      supabase = db.getSupabase?.();
    } catch {
      return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED };
    }
    if (!supabase) return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED };

    const { data: weekRow, error: weekErr } = await supabase
      .from("weeks")
      .select("id, week_number, season_year, start_date, end_date")
      .eq("season_year", Number(season))
      .eq("week_number", Number(week))
      .maybeSingle();
    if (weekErr || !weekRow?.id) {
      return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED, weekErr: weekErr?.message };
    }

    const games = await db.loadGamesByWeek(weekRow.id);
    const eventIds = [];
    const homeIds = [];
    const awayIds = [];
    for (const g of games || []) {
      const eid = g.cfbd_game_id ?? g.cfbdGameId;
      if (eid != null) eventIds.push(String(eid));
      if (g.home_team_espn_id != null || g.homeTeamEspnId != null) {
        homeIds.push(String(g.home_team_espn_id ?? g.homeTeamEspnId));
      }
      if (g.away_team_espn_id != null || g.awayTeamEspnId != null) {
        awayIds.push(String(g.away_team_espn_id ?? g.awayTeamEspnId));
      }
    }

    if (!games?.length) {
      return {
        miss: true,
        reason: REASON.ESPN_SCHEDULE_EMPTY,
        scheduleEvents: 0,
        eventIds,
        homeIds,
        awayIds,
      };
    }

    const match = games.find((g) => {
      const homeId = g.home_team_espn_id ?? g.homeTeamEspnId;
      const awayId = g.away_team_espn_id ?? g.awayTeamEspnId;
      if (teamEspnId && (idEq(homeId, teamEspnId) || idEq(awayId, teamEspnId))) {
        return true;
      }
      if (
        team &&
        (sameTeam(team, g.home_team_name || g.homeTeamName) ||
          sameTeam(team, g.away_team_name || g.awayTeamName))
      ) {
        return true;
      }
      return false;
    });

    if (!match) {
      return {
        miss: true,
        reason: REASON.TEAM_NOT_IN_WEEK_SLATE,
        scheduleEvents: games.length,
        eventIds,
        homeIds,
        awayIds,
      };
    }

    const resolved = siteGameToResolved(
      match,
      teamEspnId,
      team,
      Number(season),
      Number(week)
    );
    if (!resolved) {
      return {
        miss: true,
        reason: REASON.OPPONENT_PARSE_FAILED,
        scheduleEvents: games.length,
        eventIds,
        homeIds,
        awayIds,
      };
    }
    return {
      ...resolved,
      scheduleEvents: games.length,
      eventIds,
      homeIds,
      awayIds,
      scheduleSource: "site_weekly_picks",
    };
  } catch (err) {
    dataLog("OpponentResolver", `site weekly picks failed: ${err.message}`);
    return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED, error: err.message };
  }
}

/**
 * Shared Weekly Picks ESPN loader (date-range preferred). Includes finals.
 */
async function resolveFromSharedWeeklyGames({
  teamEspnId,
  team,
  season,
  week,
}) {
  if (!Number.isFinite(Number(week))) {
    return { miss: true, reason: REASON.WEEK_RANGE_UNRESOLVED };
  }
  const cacheKey = `espn-weekly-games:${season}:${week}`;
  const mem = weekBoardCache.get(cacheKey);
  let payload = null;
  if (mem && Date.now() - mem.at < 2 * HOUR && mem.payload?.games?.length) {
    payload = mem.payload;
  } else if (inflightWeek.has(cacheKey)) {
    payload = await inflightWeek.get(cacheKey);
  } else {
    const work = (async () => {
      try {
        const result = await getWeeklyGames({
          year: Number(season),
          week: Number(week),
          classification: "fbs",
        });
        // Never cache empty boards — avoid poisoning after transient ESPN blocks
        if (result?.games?.length) {
          weekBoardCache.set(cacheKey, { at: Date.now(), payload: result });
        }
        return result;
      } catch (err) {
        dataLog("OpponentResolver", `getWeeklyGames failed: ${err.message}`);
        return { games: [], error: err.message, code: err.code };
      }
    })().finally(() => inflightWeek.delete(cacheKey));
    inflightWeek.set(cacheKey, work);
    payload = await work;
  }

  const games = Array.isArray(payload?.games) ? payload.games : [];
  const eventIds = games
    .map((g) => g.cfbd_game_id ?? g.espn_event_id)
    .filter((x) => x != null)
    .map(String);
  const homeIds = games.map((g) => String(g.home_team_espn_id)).filter(Boolean);
  const awayIds = games.map((g) => String(g.away_team_espn_id)).filter(Boolean);

  if (!games.length) {
    return {
      miss: true,
      reason: payload?.code === "ESPN_BLOCKED" ? REASON.ESPN_SCHEDULE_EMPTY : REASON.ESPN_SCHEDULE_EMPTY,
      scheduleEvents: 0,
      eventIds,
      homeIds,
      awayIds,
      scheduleSource: "espn_weekly_games",
      error: payload?.error,
    };
  }

  const match = games.find((g) => {
    if (teamEspnId && (idEq(g.home_team_espn_id, teamEspnId) || idEq(g.away_team_espn_id, teamEspnId))) {
      return true;
    }
    if (
      team &&
      (sameTeam(team, g.home_team_name) || sameTeam(team, g.away_team_name))
    ) {
      return true;
    }
    return false;
  });

  if (!match) {
    return {
      miss: true,
      reason: REASON.TEAM_NOT_IN_WEEK_SLATE,
      scheduleEvents: games.length,
      eventIds,
      homeIds,
      awayIds,
      scheduleSource: "espn_weekly_games",
    };
  }

  const resolved = adminGameToResolved(
    match,
    teamEspnId,
    team,
    Number(season),
    Number(week)
  );
  if (!resolved) {
    return {
      miss: true,
      reason: REASON.OPPONENT_PARSE_FAILED,
      scheduleEvents: games.length,
      eventIds,
      homeIds,
      awayIds,
    };
  }
  resolved.strategy = "espn_weekly_games";
  resolved.scheduleSource = "espn_weekly_games";
  resolved.scheduleEvents = games.length;
  resolved.eventIds = eventIds;
  resolved.homeIds = homeIds;
  resolved.awayIds = awayIds;
  return resolved;
}

async function fetchTeamScheduleEvents(teamId, seasonYear, signal) {
  const urls = [
    `${SITE}/teams/${teamId}/schedule?season=${seasonYear}&seasontype=2`,
    // Web host sometimes less blocked from Netlify egress
    `https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/schedule?season=${seasonYear}&seasontype=2`,
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const { value, cacheSource } = await cachedEspnGet(
        `espn:schedule:${teamId}:${seasonYear}:st2:${url.includes("web.api") ? "web" : "site"}`,
        3 * HOUR,
        url,
        { signal }
      );
      const events = Array.isArray(value?.events) ? value.events : [];
      if (events.length) return { events, cacheSource, url };
    } catch (err) {
      lastErr = err;
      dataLog("OpponentResolver", `team schedule fetch failed: ${err.message}`);
    }
  }
  if (lastErr) throw lastErr;
  return { events: [], cacheSource: "MISS", url: urls[0] };
}

async function resolveFromTeamSchedule({ teamEspnId, team, season, week, signal }) {
  const seasonYear = Number(season);
  let teamId = teamEspnId;
  if (!teamId) {
    teamId = await resolveEspnTeamId(team);
  }
  if (!teamId) {
    return {
      status: "unresolved",
      reason: REASON.TEAM_ID_UNRESOLVED,
      opponent: null,
    };
  }

  const { events, cacheSource } = await fetchTeamScheduleEvents(teamId, seasonYear, signal);
  dataLog(
    "OpponentResolver",
    `Team schedule ${teamId} events=${events.length} cache=${cacheSource}`
  );

  if (!events.length) {
    return {
      status: "unresolved",
      reason: REASON.TEAM_SCHEDULE_EMPTY,
      scheduleGames: 0,
      playerEspnId: String(teamId),
      strategy: "espn_team_schedule",
      source: "espn",
    };
  }

  const mapped = events
    .map((evt) => mapScheduleEvent(evt, seasonYear, team))
    .filter(Boolean);
  const schedule = parseSchedule(mapped, team);

  if (week != null) {
    // Explicit week — include completed/final games
    const hit = getTeamGameForWeek(schedule, week);
    if (hit?.opponent) {
      const raw =
        events.find((e) => toInt(e.week?.number) === Number(week)) ||
        events.find((e) => idEq(e.id, hit.gameId));
      const resolved = raw ? eventToResolved(raw, teamId, team, seasonYear) : null;
      if (resolved) {
        resolved.strategy = "espn_team_schedule";
        return resolved;
      }
      return {
        status: "ok",
        source: "espn",
        strategy: "espn_team_schedule",
        reason: null,
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
    if (isLikelyBye(schedule, week)) {
      return {
        status: "bye",
        source: "espn",
        strategy: "espn_team_schedule",
        reason: REASON.BYE,
        week: Number(week),
        season: seasonYear,
        opponent: null,
        playerEspnId: String(teamId),
        scheduleGames: schedule.length,
      };
    }
    return {
      status: "unresolved",
      reason: REASON.GAME_MATCH_FAILED,
      week: Number(week),
      season: seasonYear,
      opponent: null,
      playerEspnId: String(teamId),
      scheduleGames: schedule.length,
      strategy: "espn_team_schedule",
      source: "espn",
    };
  }

  // No explicit week → next upcoming (completed games excluded by design)
  const next = nextUnplayed(schedule, week);
  if (next?.opponent) {
    return {
      status: "ok",
      source: "espn",
      strategy: "espn_team_schedule_next",
      reason: null,
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
    reason: REASON.TEAM_SCHEDULE_EMPTY,
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
      const hit = getTeamGameForWeek(schedule, week);
      if (hit?.opponent) {
        return {
          status: "ok",
          source: "cfbd",
          strategy: "cfbd_schedule",
          reason: null,
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
          reason: REASON.BYE,
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
        reason: null,
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
  playerName = null,
} = {}) {
  void gameDate;
  const seasonYear = Number(season) || new Date().getFullYear();
  const weekNum = week != null && week !== "" ? Number(week) : null;
  const canonical = teamKey(team);
  const debug = {
    team,
    canonicalTeam: canonical,
    season: seasonYear,
    week: weekNum,
    espnEventId: espnEventId || null,
    steps: [],
  };
  const trace = {
    player: playerName,
    rawTeam: team,
    season: seasonYear,
    week: weekNum,
    canonicalTeam: canonical,
    internalTeamId: null,
    espnTeamId: null,
    scheduleSource: null,
    scheduleEvents: null,
    eventIds: [],
    homeIds: [],
    awayIds: [],
    matchFound: false,
    opponent: null,
    failureReason: null,
  };

  let teamEspnId = espnTeamId != null ? String(espnTeamId) : null;
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
  trace.espnTeamId = teamEspnId;

  if (!teamEspnId && !team) {
    trace.failureReason = REASON.TEAM_ID_UNRESOLVED;
    logResolverTrace(trace);
    return {
      status: "unresolved",
      reason: REASON.TEAM_ID_UNRESOLVED,
      opponent: null,
      week: weekNum,
      season: seasonYear,
      debug,
    };
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
    if (hit) {
      trace.scheduleSource = "espn_event_id";
      trace.matchFound = true;
      trace.opponent = hit.opponent?.name;
      logResolverTrace(trace);
      return { ...hit, debug };
    }
  }

  // 2) Site Weekly Picks slate (includes finals) — preferred for Netlify
  if (weekNum != null) {
    const site = await resolveFromSiteWeeklyPicks({
      teamEspnId,
      team,
      season: seasonYear,
      week: weekNum,
    });
    if (site && !site.miss) {
      debug.steps.push(`site_weekly_picks ok → ${site.opponent?.name}`);
      trace.scheduleSource = "site_weekly_picks";
      trace.scheduleEvents = site.scheduleEvents;
      trace.eventIds = site.eventIds || [];
      trace.homeIds = site.homeIds || [];
      trace.awayIds = site.awayIds || [];
      trace.matchFound = true;
      trace.opponent = site.opponent?.name;
      logResolverTrace(trace);
      return { ...site, debug };
    }
    debug.steps.push(
      `site_weekly_picks miss reason=${site?.reason || "empty"} events=${site?.scheduleEvents ?? 0}`
    );
    if (site?.eventIds) trace.eventIds = site.eventIds;
    if (site?.homeIds) trace.homeIds = site.homeIds;
    if (site?.awayIds) trace.awayIds = site.awayIds;
  }

  // 3) Shared Weekly Picks ESPN scoreboard (date-range / week / web-host)
  if (weekNum != null) {
    try {
      const board = await resolveFromSharedWeeklyGames({
        teamEspnId,
        team,
        season: seasonYear,
        week: weekNum,
      });
      if (board && !board.miss) {
        debug.steps.push(
          `espn_weekly_games ok → ${board.opponent?.name} (events=${board.scheduleEvents})`
        );
        trace.scheduleSource = "espn_weekly_games";
        trace.scheduleEvents = board.scheduleEvents;
        trace.eventIds = board.eventIds || [];
        trace.homeIds = board.homeIds || [];
        trace.awayIds = board.awayIds || [];
        trace.matchFound = true;
        trace.opponent = board.opponent?.name;
        logResolverTrace(trace);
        return { ...board, debug };
      }
      debug.steps.push(
        `espn_weekly_games miss reason=${board?.reason || "empty"} events=${board?.scheduleEvents ?? 0}`
      );
    } catch (err) {
      debug.steps.push(`espn_weekly_games error: ${err.message}`);
    }
  }

  // 4) ESPN team schedule (includes finals for explicit week)
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
      trace.scheduleSource = "espn_team_schedule";
      trace.matchFound = true;
      trace.opponent = sched.opponent?.name;
      logResolverTrace(trace);
      return { ...sched, debug };
    }
    if (sched?.status === "bye") {
      debug.steps.push("team_schedule bye");
      trace.scheduleSource = "espn_team_schedule";
      trace.failureReason = REASON.BYE;
      logResolverTrace(trace);
      return { ...sched, debug };
    }
    debug.steps.push(`team_schedule ${sched?.reason || "empty"}`);
  } catch (err) {
    debug.steps.push(`team_schedule error: ${err.message}`);
  }

  // 5) CFBD fallback — interactive Prop Lab only (never background)
  const { policyAllowsCfbd } = require("../../cfbd-guard");
  const { isBackgroundContext } = require("../../execution-context");
  if (!isBackgroundContext() && policyAllowsCfbd("schedule") && cfbd) {
    const cfbdHit = await resolveFromCfbd({
      team,
      season: seasonYear,
      week: weekNum,
      cfbd,
    });
    if (cfbdHit?.status === "ok" || cfbdHit?.status === "bye") {
      debug.steps.push(`cfbd ${cfbdHit.status} → ${cfbdHit.opponent?.name || "bye"}`);
      trace.scheduleSource = "cfbd";
      trace.matchFound = cfbdHit.status === "ok";
      trace.opponent = cfbdHit.opponent?.name || null;
      logResolverTrace(trace);
      return { ...cfbdHit, debug };
    }
    debug.steps.push("cfbd miss");
  } else {
    debug.steps.push("cfbd skipped (background or policy)");
  }

  const failureReason =
    !teamEspnId && !team
      ? REASON.TEAM_ID_UNRESOLVED
      : weekNum != null
        ? REASON.GAME_MATCH_FAILED
        : REASON.OPPONENT_NOT_FOUND;
  trace.failureReason = failureReason;
  logResolverTrace(trace);
  dataLog("OpponentResolver", "unresolved", debug);
  return {
    status: "unresolved",
    reason: failureReason,
    opponent: null,
    week: weekNum,
    season: seasonYear,
    playerEspnId: teamEspnId,
    debug,
  };
}

module.exports = {
  resolveOpponent,
  isLikelyBye,
  teamKey,
  REASON,
  idEq,
  siteGameToResolved,
  eventToResolved,
  getTeamGameForWeek,
};
