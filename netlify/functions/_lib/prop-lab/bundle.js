const { createClient } = require("./cfbd-client");
const { searchPlayers } = require("../prop-eval");
const {
  nextUnplayed,
  extractOverviewTotal,
  extractStatValue,
  indexTeamSeasonStats,
  indexAdvanced,
  lookupTeamMap,
  pick,
} = require("./parse");
const { sameTeam, findTeamRating } = require("./names");
const { toNum } = require("./math");
const {
  getPlayerGameLog,
  getTeamScheduleData,
  readProviderMode,
} = require("./data/player-stats");
const { forcesEspn } = require("./data/provider-mode");
const { dataLog } = require("./data/log");

async function loadOverview(cfbd, playerId, year) {
  if (!cfbd || forcesEspn()) return null;
  let data = await cfbd.getOptional("/player/season/overview", { year, playerId });
  if (!data) {
    data = await cfbd.getOptional("/player/season/overview", { year, player_id: playerId });
  }
  return data;
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

  // Max stats only count games where the volume opportunity actually happened.
  const avgLong = (volumeKey, longKey) => {
    const rows = logs.filter(
      (g) => Number(g.stats?.[volumeKey]) > 0 && Number.isFinite(g.stats?.[longKey])
    );
    if (!rows.length) return { avg: null, max: null, games: 0 };
    return {
      avg: rows.reduce((s, g) => s + g.stats[longKey], 0) / rows.length,
      max: Math.max(...rows.map((g) => g.stats[longKey])),
      games: rows.length,
    };
  };
  const rushLong = avgLong("rush_att", "rush_long");
  const passLong = avgLong("pass_comp", "pass_long");
  // Completions are often missing early; fall back to attempts as volume proxy.
  const passLongFallback =
    passLong.games > 0 ? passLong : avgLong("pass_att", "pass_long");
  const recLong = avgLong("rec", "rec_long");

  return {
    games: n,
    rushLong: rushLong.avg,
    rushLongMax: rushLong.max,
    rushLongGames: rushLong.games,
    passLong: passLongFallback.avg,
    passLongMax: passLongFallback.max,
    passLongGames: passLongFallback.games,
    recLong: recLong.avg,
    recLongMax: recLong.max,
    recLongGames: recLong.games,
    rec: sum("rec") / n,
    recYds: sum("rec_yds") / n,
    rushAtt: sum("rush_att") / n,
    rushYds: sum("rush_yds") / n,
    passAtt: sum("pass_att") / n,
    passYds: sum("pass_yds") / n,
    passTd: sum("pass_td") / n,
    passComp: sum("pass_comp") / n,
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

function dataSourceLabel(meta) {
  const src = meta?.source || null;
  const original = meta?.originalSource || null;
  if (src === "cache" && original === "espn") return "ESPN fallback (cache)";
  if (src === "cache" && original === "cfbd") return "CFBD (cache)";
  if (src === "cache") return `Cache (${original || "unknown"})`;
  if (src === "espn") return "ESPN fallback";
  if (src === "cfbd") return "CFBD";
  return src || "unknown";
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
  const providerMode = readProviderMode();
  const client =
    cfbd ||
    (apiKey && !forcesEspn(providerMode) ? createClient(apiKey, { signal }) : null);
  const seasonYear = Number(season) || new Date().getFullYear();
  const pid = playerId != null ? String(playerId) : "";

  const playerNameHint = name || null;

  const [currentOv, priorOv, teamStatsAll, advAll, ppaAll] = await Promise.all([
    pid ? loadOverview(client, pid, seasonYear) : Promise.resolve(null),
    pid ? loadOverview(client, pid, seasonYear - 1) : Promise.resolve(null),
    client
      ? client.getOptional("/stats/season", { year: seasonYear, seasonType: "regular" })
      : Promise.resolve(null),
    client
      ? client.getOptional("/stats/season/advanced", { year: seasonYear, startWeek: 1 })
      : Promise.resolve(null),
    client
      ? client.getOptional("/ppa/teams", { year: seasonYear, excludeGarbageTime: true })
      : Promise.resolve(null),
  ]);

  const playerTeam =
    team ||
    pick(currentOv, "team", "teamName") ||
    pick(priorOv, "team", "teamName") ||
    null;

  const resolvedName =
    playerNameHint ||
    pick(currentOv, "name", "athleteName") ||
    pick(priorOv, "name", "athleteName") ||
    "Player";
  const posHint = pick(currentOv, "position") || pick(priorOv, "position") || null;
  const jerseyHint = pick(currentOv, "jersey") || null;

  let schedule = [];
  let scheduleMeta = { source: null, cache: "MISS" };
  if (playerTeam) {
    try {
      const schedResult = await getTeamScheduleData({
        team: playerTeam,
        season: seasonYear,
        cfbd: client,
        signal,
        mode: providerMode,
      });
      schedule = schedResult.schedule || [];
      scheduleMeta = {
        source: schedResult.source,
        originalSource: schedResult.originalSource,
        cache: schedResult.cache,
      };
    } catch (err) {
      dataLog("PlayerData", `Schedule load failed: ${err.message}`);
      schedule = [];
    }
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

  let gameLogs = [];
  let priorLogs = [];
  let gameLogMeta = { source: null, cache: "MISS" };
  let priorLogMeta = { source: null, cache: "MISS" };

  if (playerTeam) {
    try {
      const current = await getPlayerGameLog({
        playerId: pid || null,
        playerName: resolvedName,
        team: playerTeam,
        season: seasonYear,
        position: posHint,
        jersey: jerseyHint,
        cfbd: client,
        signal,
        mode: providerMode,
      });
      gameLogs = current.games || [];
      gameLogMeta = current.meta || {
        source: current.source,
        originalSource: current.originalSource,
        cache: current.cache,
      };
      if ((!schedule.length || scheduleMeta.source == null) && current.schedule?.length) {
        schedule = current.schedule;
        scheduleMeta = {
          source: current.source,
          originalSource: current.originalSource,
          cache: current.cache,
        };
      }
    } catch (err) {
      if (err.code === "PLAYER_DATA_UNAVAILABLE") {
        dataLog("PlayerData", err.message);
      } else {
        dataLog("PlayerData", `Current game log failed: ${err.message}`);
      }
      gameLogs = [];
      gameLogMeta = { source: null, cache: "MISS", error: err.code || err.message };
    }

    const priorTeam = pick(priorOv, "team", "teamName") || playerTeam;
    try {
      const prior = await getPlayerGameLog({
        playerId: pid || null,
        playerName: resolvedName,
        team: priorTeam,
        season: seasonYear - 1,
        position: posHint,
        jersey: jerseyHint,
        cfbd: client,
        signal,
        mode: providerMode,
      });
      priorLogs = prior.games || [];
      priorLogMeta = prior.meta || {
        source: prior.source,
        originalSource: prior.originalSource,
        cache: prior.cache,
      };
    } catch (err) {
      dataLog("PlayerData", `Prior game log failed: ${err.message}`);
      priorLogs = [];
    }
  }

  let lines = null;
  if (client && playerTeam) {
    lines = nextGame?.week
      ? await client.getOptional("/lines", {
          year: seasonYear,
          week: nextGame.week,
          team: playerTeam,
          seasonType: "regular",
        })
      : await client.getOptional("/lines", {
          year: seasonYear,
          team: playerTeam,
          seasonType: "regular",
        });
  }

  if (asOfWeek != null) {
    gameLogs = gameLogs.filter((g) => g.week == null || Number(g.week) < Number(asOfWeek));
  }

  // Recompute nextGame if schedule arrived via game-log path after opponent resolve.
  const resolvedNext =
    opponent && String(opponent).trim()
      ? schedule.find((g) => sameTeam(g.opponent, opponent)) || nextGame
      : nextUnplayed(schedule, week) || nextGame;

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
  const oppName = resolvedNext?.opponent || null;
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

  const pos = posHint;
  const classYear = pick(currentOv, "year", "class") || null;
  if (classYear && /fr|freshman/i.test(String(classYear))) flags.push("New Starter");

  const currentTeam = pick(currentOv, "team", "teamName");
  const priorTeamName = pick(priorOv, "team", "teamName");
  if (currentTeam && priorTeamName && !sameTeam(currentTeam, priorTeamName)) flags.push("Transfer");

  const dataSource = {
    mode: providerMode,
    gameLogs: gameLogMeta,
    priorLogs: priorLogMeta,
    schedule: scheduleMeta,
    label: dataSourceLabel(gameLogMeta),
    cache: gameLogMeta.cache || "MISS",
  };

  return {
    player: {
      id: pid,
      name: resolvedName,
      team: playerTeam,
      position: pos,
      year: classYear,
      jersey: jerseyHint,
    },
    seasonYear,
    week: resolvedNext?.week ?? week ?? null,
    opponent: resolvedNext
      ? {
          name: resolvedNext.opponent,
          week: resolvedNext.week,
          homeAway: resolvedNext.homeAway,
          startDate: resolvedNext.startDate || null,
          isFcs: Boolean(resolvedNext.oppIsFcs),
          fromSchedule: Boolean(resolvedNext.gameId || resolvedNext.opponent),
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
    apiUsage: client?.usage || { requests: 0, cacheHits: 0, cacheMisses: 0, paths: [] },
    dataSource,
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
  dataSourceLabel,
};
