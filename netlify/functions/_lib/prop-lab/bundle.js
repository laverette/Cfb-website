const { createClient } = require("./cfbd-client");
const { searchPlayers } = require("../prop-eval");
const {
  parseSchedule,
  nextUnplayed,
  parsePlayerGameLogs,
  extractOverviewTotal,
  extractStatValue,
  indexTeamSeasonStats,
  indexAdvanced,
  lookupTeamMap,
  pick,
} = require("./parse");
const { sameTeam, findTeamRating } = require("./names");
const { toNum } = require("./math");

async function loadOverview(cfbd, playerId, year) {
  let data = await cfbd.getOptional("/player/season/overview", { year, playerId });
  if (!data) {
    data = await cfbd.getOptional("/player/season/overview", { year, player_id: playerId });
  }
  return data;
}

function scheduleIndex(schedule) {
  const map = new Map();
  for (const g of schedule || []) {
    if (g.gameId != null) map.set(String(g.gameId), g);
  }
  return map;
}

function attachValues(logs, statId) {
  return (logs || []).map((g) => ({
    ...g,
    value: extractStatValue(g.stats || {}, statId),
  }));
}

function usageFromLogs(logs) {
  const n = (logs || []).filter((g) => g.stats).length;
  if (!n) return null;
  const sum = (key) =>
    logs.reduce((s, g) => s + (Number.isFinite(g.stats?.[key]) ? g.stats[key] : 0), 0);

  // Longest rush only means something in games the player actually carried it.
  // Averaging in zeros from games he never touched the ball would drag the
  // projection toward nothing.
  const carried = logs.filter((g) => Number(g.stats?.rush_att) > 0 && Number.isFinite(g.stats?.rush_long));
  const rushLong = carried.length
    ? carried.reduce((s, g) => s + g.stats.rush_long, 0) / carried.length
    : null;
  const rushLongMax = carried.length ? Math.max(...carried.map((g) => g.stats.rush_long)) : null;

  return {
    games: n,
    rushLong,
    rushLongMax,
    rushLongGames: carried.length,
    rec: sum("rec") / n,
    recYds: sum("rec_yds") / n,
    rushAtt: sum("rush_att") / n,
    rushYds: sum("rush_yds") / n,
    passAtt: sum("pass_att") / n,
    passYds: sum("pass_yds") / n,
    passTd: sum("pass_td") / n,
    rushTd: sum("rush_td") / n,
    recTd: sum("rec_td") / n,
    fgMade: sum("fg_made") / n,
    fgAtt: sum("fg_att") / n,
    xpMade: sum("xp_made") / n,
    kickingPts: sum("kicking_pts") / n,
  };
}

function last3Usage(logs) {
  const recent = (logs || []).slice(-3);
  return usageFromLogs(recent);
}

/**
 * Load a reusable player/game bundle. Line changes must not refetch this.
 */
async function loadPlayerBundle({
  playerId,
  team,
  name,
  opponent,
  season,
  week,
  apiKey,
  cfbd,
  powerTeams,
  signal,
  asOfWeek = null,
}) {
  const client = cfbd || createClient(apiKey, { signal });
  const seasonYear = Number(season) || new Date().getFullYear();
  const pid = String(playerId);

  const [currentOv, priorOv, scheduleRaw, teamStatsAll, advAll, ppaAll] = await Promise.all([
    loadOverview(client, pid, seasonYear),
    loadOverview(client, pid, seasonYear - 1),
    team
      ? client.getOptional("/games", { year: seasonYear, team, seasonType: "regular" })
      : Promise.resolve(null),
    client.getOptional("/stats/season", { year: seasonYear, seasonType: "regular" }),
    client.getOptional("/stats/season/advanced", { year: seasonYear, startWeek: 1 }),
    client.getOptional("/ppa/teams", { year: seasonYear, excludeGarbageTime: true }),
  ]);

  const playerTeam =
    team ||
    pick(currentOv, "team", "teamName") ||
    pick(priorOv, "team", "teamName") ||
    null;

  let schedule = parseSchedule(scheduleRaw, playerTeam);
  if ((!schedule.length || !scheduleRaw) && playerTeam) {
    const alt = await client.getOptional("/games", {
      year: seasonYear,
      team: playerTeam,
      seasonType: "regular",
    });
    schedule = parseSchedule(alt, playerTeam);
  }

  if (asOfWeek != null) {
    schedule = schedule.map((g) => ({
      ...g,
      completed: g.completed && Number(g.week) < Number(asOfWeek),
    }));
  }

  const nextGame =
    opponent && String(opponent).trim()
      ? schedule.find((g) => sameTeam(g.opponent, opponent)) || {
          opponent: String(opponent).trim(),
          week: week ?? null,
          homeAway: null,
          completed: false,
          oppIsFcs: false,
        }
      : nextUnplayed(schedule, week);

  const [playerBox, priorBox, priorScheduleRaw, lines] = await Promise.all([
    playerTeam
      ? client.getOptional("/games/players", {
          year: seasonYear,
          team: playerTeam,
          seasonType: "regular",
        })
      : Promise.resolve(null),
    playerTeam
      ? client.getOptional("/games/players", {
          year: seasonYear - 1,
          team: pick(priorOv, "team", "teamName") || playerTeam,
          seasonType: "regular",
        })
      : Promise.resolve(null),
    client.getOptional("/games", {
      year: seasonYear - 1,
      team: pick(priorOv, "team", "teamName") || playerTeam,
      seasonType: "regular",
    }),
    nextGame?.week
      ? client.getOptional("/lines", {
          year: seasonYear,
          week: nextGame.week,
          team: playerTeam,
          seasonType: "regular",
        })
      : client.getOptional("/lines", { year: seasonYear, team: playerTeam, seasonType: "regular" }),
  ]);

  const priorSchedule = parseSchedule(
    priorScheduleRaw,
    pick(priorOv, "team", "teamName") || playerTeam
  );

  let gameLogs = parsePlayerGameLogs(playerBox, {
    playerId: pid,
    playerName: name || pick(currentOv, "name", "athleteName"),
    team: playerTeam,
    scheduleById: scheduleIndex(schedule),
  });
  let priorLogs = parsePlayerGameLogs(priorBox, {
    playerId: pid,
    playerName: name || pick(priorOv, "name", "athleteName") || pick(currentOv, "name"),
    team: pick(priorOv, "team", "teamName") || playerTeam,
    scheduleById: scheduleIndex(priorSchedule),
  });

  if (asOfWeek != null) {
    gameLogs = gameLogs.filter((g) => g.week == null || Number(g.week) < Number(asOfWeek));
  }

  const teamStatsIndex = indexTeamSeasonStats(teamStatsAll);
  const advIndex = indexAdvanced(Array.isArray(advAll) ? advAll : advAll ? [advAll] : []);
  const ppaIndex = new Map();
  if (Array.isArray(ppaAll)) {
    for (const row of ppaAll) {
      const t = pick(row, "team");
      if (t) ppaIndex.set(String(t).toLowerCase(), row);
    }
  }

  const teamOffense = lookupTeamMap(teamStatsIndex, playerTeam) || {};
  const teamAdv = lookupTeamMap(advIndex, playerTeam);
  const oppName = nextGame?.opponent || null;
  const oppDefense = lookupTeamMap(teamStatsIndex, oppName) || {};
  const oppAdv = lookupTeamMap(advIndex, oppName);
  const teamPpa = lookupTeamMap(ppaIndex, playerTeam);
  const oppPpa = lookupTeamMap(ppaIndex, oppName);

  const playerRating = findTeamRating(powerTeams, playerTeam);
  const oppRating = findTeamRating(powerTeams, oppName);

  const consensusLine = extractConsensusLine(lines, playerTeam, oppName);

  const flags = [];
  if (!gameLogs.length) flags.push("Missing Data");
  if (gameLogs.length > 0 && gameLogs.length < 3) flags.push("Small Sample");
  if (!priorLogs.length && gameLogs.length < 5) flags.push("Limited History");
  const fcsGames = gameLogs.filter((g) => g.isFcs).length;
  if (gameLogs.length && fcsGames / gameLogs.length >= 0.4) flags.push("FCS-Heavy Sample");

  const pos = pick(currentOv, "position") || pick(priorOv, "position") || null;
  const classYear = pick(currentOv, "year", "class") || null;
  if (classYear && /fr|freshman/i.test(String(classYear))) flags.push("New Starter");

  const currentTeam = pick(currentOv, "team", "teamName");
  const priorTeam = pick(priorOv, "team", "teamName");
  if (currentTeam && priorTeam && !sameTeam(currentTeam, priorTeam)) flags.push("Transfer");

  return {
    player: {
      id: pid,
      name: name || pick(currentOv, "name", "athleteName") || "Player",
      team: playerTeam,
      position: pos,
      year: classYear,
      jersey: pick(currentOv, "jersey") || null,
    },
    seasonYear,
    week: nextGame?.week ?? week ?? null,
    opponent: nextGame
      ? {
          name: nextGame.opponent,
          week: nextGame.week,
          homeAway: nextGame.homeAway,
          startDate: nextGame.startDate || null,
          isFcs: Boolean(nextGame.oppIsFcs),
          fromSchedule: Boolean(nextGame.gameId || nextGame.opponent),
        }
      : null,
    schedule,
    gameLogs,
    priorLogs,
    currentOverview: currentOv,
    priorOverview: priorOv,
    currentTotals: {
      games: toNum(pick(currentOv, "games")) || gameLogs.length,
      pass_yds: extractOverviewTotal(currentOv, "pass_yds"),
      rec_yds: extractOverviewTotal(currentOv, "rec_yds"),
      rec: extractOverviewTotal(currentOv, "rec"),
      rush_yds: extractOverviewTotal(currentOv, "rush_yds"),
    },
    priorTotals: priorOv
      ? {
          games: toNum(pick(priorOv, "games")) || priorLogs.length,
          pass_yds: extractOverviewTotal(priorOv, "pass_yds"),
          rec_yds: extractOverviewTotal(priorOv, "rec_yds"),
          rec: extractOverviewTotal(priorOv, "rec"),
          rush_yds: extractOverviewTotal(priorOv, "rush_yds"),
        }
      : null,
    usage: usageFromLogs(gameLogs),
    usageL3: last3Usage(gameLogs),
    teamOffense,
    teamAdv,
    oppDefense,
    oppAdv,
    teamPpa,
    oppPpa,
    leagueTeamStats: teamStatsIndex,
    leagueAdvanced: advIndex,
    playerTeamRating: playerRating,
    oppRating,
    market: consensusLine,
    flags,
    apiUsage: client.usage,
  };
}

function extractConsensusLine(lines, team, opponent) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const game =
    lines.find((g) => {
      const home = pick(g, "homeTeam", "home_team");
      const away = pick(g, "awayTeam", "away_team");
      return (
        (sameTeam(home, team) || sameTeam(away, team)) &&
        (!opponent || sameTeam(home, opponent) || sameTeam(away, opponent))
      );
    }) || lines[0];
  const providers = pick(game, "lines") || [];
  const spreads = [];
  const totals = [];
  for (const p of providers) {
    const sp = toNum(pick(p, "spread"));
    const tot = toNum(pick(p, "overUnder", "over_under"));
    if (sp != null) spreads.push(sp);
    if (tot != null) totals.push(tot);
  }
  if (!spreads.length && !totals.length) return null;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const home = pick(game, "homeTeam", "home_team");
  const isHome = sameTeam(home, team);
  const spreadHome = avg(spreads);
  return {
    spread: spreadHome == null ? null : isHome ? spreadHome : -spreadHome,
    total: avg(totals),
    home: isHome,
    source: "cfbd_lines",
  };
}

async function searchAndResolve(q, { year, team, apiKey, signal }) {
  return searchPlayers({ q, team, year, apiKey, signal });
}

module.exports = {
  loadPlayerBundle,
  attachValues,
  usageFromLogs,
  last3Usage,
  searchAndResolve,
};
