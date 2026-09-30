/**
 * Opponent defensive profile loader — independent of schedule/opponent resolution.
 *
 * Priority:
 *   1. CFBD season / advanced stats already loaded into the bundle
 *   2. ESPN team statistics `results.opponent` (allowed production)
 *   3. ESPN boxscore reconstruction from completed games before the prop week/date
 *
 * Missing metrics stay null — never coerced to 0.
 */
const { toNum } = require("../math");
const { dataLog } = require("./log");
const { SITE, cachedEspnGet, mapPool } = require("./espn/http");
const { resolveEspnTeamId } = require("./espn/resolve");
const { schoolFromEspnTeam } = require("./espn/parse");
const { aliasTeam, normalizeTeam, sameTeam } = require("../names");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FBS_RANK_DENOM = 136;

const profileCache = globalThis.__cfb_def_profile || new Map();
globalThis.__cfb_def_profile = profileCache;
const inflight = globalThis.__cfb_def_inflight || new Map();
globalThis.__cfb_def_inflight = inflight;

function numOrNull(v) {
  const n = toNum(v);
  return n == null ? null : n;
}

function parseSlashPair(display) {
  const m = String(display || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]) };
}

function flattenOpponentCategories(categories) {
  const flat = {};
  const ranks = {};
  if (!Array.isArray(categories)) return { flat, ranks };
  for (const cat of categories) {
    for (const s of cat.stats || []) {
      const name = String(s.name || "").trim();
      if (!name) continue;
      if (flat[name] == null) {
        const v = numOrNull(s.value);
        if (v != null) flat[name] = v;
        else if (s.displayValue != null && s.displayValue !== "-") {
          const parsed = numOrNull(String(s.displayValue).replace(/,/g, ""));
          if (parsed != null) flat[name] = parsed;
        }
      }
      if (ranks[name] == null && Number.isFinite(Number(s.rank))) {
        ranks[name] = Number(s.rank);
      }
    }
  }
  return { flat, ranks };
}

function inferGames(flat, scheduleGames) {
  if (Number.isFinite(scheduleGames) && scheduleGames > 0) return scheduleGames;
  const pairs = [
    ["netPassingYards", "netPassingYardsPerGame"],
    ["passingYards", "passingYardsPerGame"],
    ["rushingYards", "rushingYardsPerGame"],
    ["totalPoints", "totalPointsPerGame"],
  ];
  for (const [tot, pg] of pairs) {
    const t = numOrNull(flat[tot]);
    const p = numOrNull(flat[pg]);
    if (t != null && p != null && p > 0) {
      const g = Math.round(t / p);
      if (g >= 1 && g <= 20) return g;
    }
  }
  return null;
}

/**
 * Map ESPN opponent-allowed aggregates into CFBD-compatible season-stat keys
 * that matchup.js already understands.
 */
function toCfbdCompatibleStats(flat, ranks, games) {
  const g = games && games > 0 ? games : null;
  const perGame = (totalKey, perGameKey) => {
    const pg = numOrNull(flat[perGameKey]);
    if (pg != null) return pg;
    const tot = numOrNull(flat[totalKey]);
    if (tot != null && g) return tot / g;
    return null;
  };

  const passYds = perGame("netPassingYards", "netPassingYardsPerGame") ??
    perGame("passingYards", "passingYardsPerGame");
  const rushYds = perGame("rushingYards", "rushingYardsPerGame");
  const passTdTot = numOrNull(flat.passingTouchdowns);
  const rushTdTot = numOrNull(flat.rushingTouchdowns);
  const recTot = numOrNull(flat.receptions);
  const recYds = perGame("receivingYards", "receivingYardsPerGame");

  const stats = {
    passyardsallowed: passYds,
    netpassingyardsallowed: passYds,
    passingyardsallowed: passYds,
    rushingyardsallowed: rushYds,
    yardsperpassallowed: numOrNull(flat.yardsPerPassAttempt),
    passingyardsperattemptallowed: numOrNull(flat.yardsPerPassAttempt),
    yardsperrushallowed: numOrNull(flat.yardsPerRushAttempt),
    rushingyardsaverageallowed: numOrNull(flat.yardsPerRushAttempt),
    passingtdsallowed: passTdTot != null && g ? passTdTot / g : null,
    passingtouchdownsallowed: passTdTot != null && g ? passTdTot / g : null,
    rushingtdsallowed: rushTdTot != null && g ? rushTdTot / g : null,
    rushingtouchdownsallowed: rushTdTot != null && g ? rushTdTot / g : null,
    sacks: numOrNull(flat.sacks),
    receptionsallowed: recTot != null && g ? recTot / g : null,
    receivingyardsallowed: recYds,
    totalyardsallowed: perGame("totalYards", "yardsPerGame"),
    pointsallowed: perGame("totalPoints", "totalPointsPerGame"),
  };

  // Drop undefined keys so Object.keys reflects real data; keep nulls as "known missing".
  const cleaned = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v != null) cleaned[k] = v;
  }

  return {
    stats: cleaned,
    ranks: {
      passYds: ranks.netPassingYardsPerGame ?? ranks.passingYardsPerGame ?? null,
      rushYds: ranks.rushingYardsPerGame ?? null,
      ypa: ranks.yardsPerPassAttempt ?? null,
      ypc: ranks.yardsPerRushAttempt ?? null,
      passTd: ranks.passingTouchdowns ?? null,
      rushTd: ranks.rushingTouchdowns ?? null,
      points: ranks.totalPointsPerGame ?? null,
      denom: FBS_RANK_DENOM,
    },
    games: g,
  };
}

function boxStatValue(teamBlock, name) {
  const row = (teamBlock?.statistics || []).find(
    (s) => String(s.name || "").toLowerCase() === String(name).toLowerCase()
  );
  if (!row) return null;
  const v = numOrNull(row.value);
  if (v != null) return v;
  const disp = row.displayValue;
  if (disp == null || disp === "-") return null;
  const pair = parseSlashPair(disp);
  if (pair && /completion|comp/i.test(name)) return pair;
  return numOrNull(String(disp).replace(/,/g, ""));
}

function allowedFromBoxscore(summary, defenseEspnId, defenseName) {
  const teams = summary?.boxscore?.teams || [];
  if (!teams.length) return null;
  const defId = defenseEspnId != null ? String(defenseEspnId) : null;
  let offense = null;
  let defense = null;
  for (const t of teams) {
    const id = t.team?.id != null ? String(t.team.id) : null;
    const name = schoolFromEspnTeam(t.team) || t.team?.location;
    const isDef =
      (defId && id === defId) ||
      (defenseName && sameTeam(name, defenseName));
    if (isDef) defense = t;
    else offense = t;
  }
  if (!offense) {
    // Fallback: pick the non-matching side
    defense =
      teams.find(
        (t) =>
          (defId && String(t.team?.id) === defId) ||
          (defenseName && sameTeam(schoolFromEspnTeam(t.team), defenseName))
      ) || null;
    offense = teams.find((t) => t !== defense) || null;
  }
  if (!offense) return null;

  const passYds = boxStatValue(offense, "netPassingYards");
  const rushYds = boxStatValue(offense, "rushingYards");
  const rushAtt = boxStatValue(offense, "rushingAttempts");
  const ypa = boxStatValue(offense, "yardsPerPass");
  const ypc = boxStatValue(offense, "yardsPerRushAttempt");
  const totalYds = boxStatValue(offense, "totalYards");
  const compAtt = boxStatValue(offense, "completionAttempts");
  const comps =
    compAtt && typeof compAtt === "object"
      ? compAtt.a
      : null;
  const passAtt =
    compAtt && typeof compAtt === "object"
      ? compAtt.b
      : null;

  // TD counts from scoring plays attributed to the offense team
  const offenseId = offense.team?.id != null ? String(offense.team.id) : null;
  let passTd = null;
  let rushTd = null;
  const plays = Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : [];
  if (plays.length && offenseId) {
    passTd = 0;
    rushTd = 0;
    for (const p of plays) {
      if (String(p.team?.id) !== offenseId) continue;
      const text = String(p.type?.text || p.text || "").toLowerCase();
      if (text.includes("passing touchdown") || text.includes("pass from")) passTd += 1;
      else if (text.includes("rushing touchdown") || /\brush\b/.test(text)) rushTd += 1;
    }
  }

  const headerComps = summary?.header?.competitions?.[0]?.competitors || [];
  const offenseScoreRow = headerComps.find((c) => String(c.id) === offenseId);
  const points = numOrNull(offenseScoreRow?.score);

  return {
    passYds,
    rushYds,
    rushAtt,
    ypa,
    ypc,
    totalYds,
    comps,
    passAtt,
    passTd,
    rushTd,
    points,
  };
}

function averageNullable(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function reconstructFromBoxscores({
  team,
  teamEspnId,
  season,
  beforeWeek,
  beforeDate,
  signal,
}) {
  return (async () => {
    const seasonYear = Number(season);
    const teamId = teamEspnId || (await resolveEspnTeamId(team));
    if (!teamId) return null;

    const url = `${SITE}/teams/${teamId}/schedule?season=${seasonYear}&seasontype=2`;
    const { value } = await cachedEspnGet(
      `espn:schedule:${teamId}:${seasonYear}:st2`,
      4 * HOUR,
      url,
      { signal }
    );
    const events = Array.isArray(value?.events) ? value.events : [];
    const beforeTs = beforeDate ? Date.parse(beforeDate) : null;

    const eligible = events.filter((evt) => {
      const comp = evt.competitions?.[0];
      const status = comp?.status?.type || evt.status?.type || {};
      const completed =
        status.completed === true ||
        String(status.state || "").toLowerCase() === "post" ||
        /final/i.test(String(status.name || ""));
      if (!completed) return false;
      const week = Number(evt.week?.number ?? comp?.week?.number);
      if (beforeWeek != null && Number.isFinite(week) && week >= Number(beforeWeek)) {
        return false;
      }
      if (beforeTs != null && Number.isFinite(beforeTs)) {
        const ts = Date.parse(evt.date || comp?.date || "");
        if (Number.isFinite(ts) && ts >= beforeTs) return false;
      }
      return true;
    });

    if (!eligible.length) return null;

    // Recency weight: most recent game counts more when averaging for snapshot.
    const pieces = await mapPool(eligible, 3, async (evt) => {
      try {
        const { value: summary } = await cachedEspnGet(
          `espn:summary:${evt.id}`,
          14 * DAY,
          `${SITE}/summary?event=${evt.id}`,
          { signal }
        );
        return allowedFromBoxscore(summary, teamId, team);
      } catch (err) {
        dataLog("DefenseProfile", `boxscore ${evt.id} failed: ${err.message}`);
        return null;
      }
    });

    const rows = pieces.filter(Boolean);
    if (!rows.length) return null;

    // Weight recent games higher (last = heaviest).
    const weights = rows.map((_, i) => 0.65 + (0.35 * (i + 1)) / rows.length);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const wavg = (key) => {
      let s = 0;
      let w = 0;
      rows.forEach((r, i) => {
        if (r[key] == null || !Number.isFinite(r[key])) return;
        s += r[key] * weights[i];
        w += weights[i];
      });
      return w > 0 ? s / w : null;
    };

    const passYds = wavg("passYds");
    const rushYds = wavg("rushYds");
    const rushAtt = wavg("rushAtt");
    const stats = {};
    if (passYds != null) {
      stats.passyardsallowed = passYds;
      stats.netpassingyardsallowed = passYds;
      stats.passingyardsallowed = passYds;
    }
    if (rushYds != null) stats.rushingyardsallowed = rushYds;
    const ypa = wavg("ypa");
    const ypc = wavg("ypc");
    if (ypa != null) {
      stats.yardsperpassallowed = ypa;
      stats.passingyardsperattemptallowed = ypa;
    }
    if (ypc != null) {
      stats.yardsperrushallowed = ypc;
      stats.rushingyardsaverageallowed = ypc;
    } else if (rushYds != null && rushAtt != null && rushAtt > 0) {
      stats.yardsperrushallowed = rushYds / rushAtt;
      stats.rushingyardsaverageallowed = rushYds / rushAtt;
    }
    const passTd = wavg("passTd");
    const rushTd = wavg("rushTd");
    if (passTd != null) {
      stats.passingtdsallowed = passTd;
      stats.passingtouchdownsallowed = passTd;
    }
    if (rushTd != null) {
      stats.rushingtdsallowed = rushTd;
      stats.rushingtouchdownsallowed = rushTd;
    }
    const comps = wavg("comps");
    if (comps != null) stats.receptionsallowed = comps;
    const totalYds = wavg("totalYds");
    if (totalYds != null) stats.totalyardsallowed = totalYds;
    const points = wavg("points");
    if (points != null) stats.pointsallowed = points;

    return {
      stats,
      ranks: null,
      games: rows.length,
      source: "espn_boxscore",
      weightSum: wSum,
      sampleSize: rows.length,
    };
  })();
}

async function fetchEspnSeasonOpponentStats(team, teamEspnId, season, { signal } = {}) {
  const seasonYear = Number(season);
  const teamId = teamEspnId || (await resolveEspnTeamId(team));
  if (!teamId) return null;

  const url = `${SITE}/teams/${teamId}/statistics?season=${seasonYear}&seasontype=2`;
  const { value, cacheSource } = await cachedEspnGet(
    `espn:team-opp-stats:${teamId}:${seasonYear}`,
    6 * HOUR,
    url,
    { signal }
  );
  const categories = value?.results?.opponent;
  if (!Array.isArray(categories) || !categories.length) return null;
  const { flat, ranks } = flattenOpponentCategories(categories);
  const mapped = toCfbdCompatibleStats(flat, ranks, inferGames(flat, null));
  if (!Object.keys(mapped.stats).length) return null;
  return {
    ...mapped,
    source: "espn_season",
    cacheSource,
    teamEspnId: String(teamId),
    teamName: schoolFromEspnTeam(value?.team) || team,
  };
}

/**
 * Build a small league pool of pass/rush yards allowed from ESPN ranks is not
 * needed when ranks are present; when reconstructing boxscores we optionally
 * sample peer teams from the same week board.
 */
async function sampleLeaguePoolFromEspn(teamIds, season, { signal, limit = 24 } = {}) {
  const ids = [...new Set((teamIds || []).map(String))].slice(0, limit);
  const rows = await mapPool(ids, 4, async (id) => {
    try {
      const profile = await fetchEspnSeasonOpponentStats(null, id, season, { signal });
      if (!profile?.stats) return null;
      return {
        teamId: id,
        passyardsallowed: profile.stats.passyardsallowed ?? null,
        rushingyardsallowed: profile.stats.rushingyardsallowed ?? null,
      };
    } catch {
      return null;
    }
  });
  return rows.filter(Boolean);
}

function cacheKey(team, espnId, season, week) {
  const t = aliasTeam(team) || normalizeTeam(team) || "unknown";
  return `defprof:${season}:${week ?? "na"}:${espnId || t}`;
}

/**
 * @returns {Promise<{
 *   stats: Record<string, number>,
 *   ranks: object|null,
 *   games: number|null,
 *   source: string,
 *   confidence: 'high'|'medium'|'low',
 *   leagueSample?: Array,
 * }|null>}
 */
async function getOpponentDefenseProfile({
  opponentName,
  opponentEspnId = null,
  season,
  week = null,
  beforeDate = null,
  preferBoxscore = false,
  peerEspnIds = null,
  signal = null,
} = {}) {
  if (!opponentName && opponentEspnId == null) return null;

  const key = cacheKey(opponentName, opponentEspnId, season, week);
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < 6 * HOUR) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const work = (async () => {
    let profile = null;

    if (!preferBoxscore) {
      try {
        profile = await fetchEspnSeasonOpponentStats(
          opponentName,
          opponentEspnId,
          season,
          { signal }
        );
      } catch (err) {
        dataLog("DefenseProfile", `ESPN season stats failed: ${err.message}`);
      }
    }

    // Week-scoped / as-of evaluations: rebuild from boxscores before the prop
    // game so season-to-date endpoints cannot leak the game being projected.
    // For live current-week props, ESPN season opponent stats already exclude
    // unplayed games, so prefer that path (ranks + fewer API calls).
    if (preferBoxscore || !profile) {
      try {
        const box = await reconstructFromBoxscores({
          team: opponentName,
          teamEspnId: opponentEspnId || profile?.teamEspnId,
          season,
          beforeWeek: week,
          beforeDate,
          signal,
        });
        if (box && Object.keys(box.stats).length) {
          profile = {
            stats: box.stats,
            ranks: profile?.ranks || null,
            games: box.games,
            source: profile ? "espn_hybrid" : "espn_boxscore",
            teamEspnId: opponentEspnId || profile?.teamEspnId || null,
          };
        }
      } catch (err) {
        dataLog("DefenseProfile", `boxscore rebuild failed: ${err.message}`);
      }
    }

    if (!profile) return null;

    let leagueSample = null;
    if (peerEspnIds?.length && !profile.ranks) {
      try {
        leagueSample = await sampleLeaguePoolFromEspn(peerEspnIds, season, {
          signal,
          limit: 20,
        });
      } catch (err) {
        dataLog("DefenseProfile", `league sample failed: ${err.message}`);
      }
    }

    const games = profile.games || 0;
    let confidence = "medium";
    if (profile.source === "espn_season" && games >= 4) confidence = "high";
    else if (games <= 2) confidence = "low";
    else if (profile.source === "espn_boxscore" && games >= 3) confidence = "medium";

    const out = {
      ...profile,
      confidence,
      leagueSample,
      opponentName: opponentName || profile.teamName || null,
      opponentEspnId: opponentEspnId || profile.teamEspnId || null,
    };
    profileCache.set(key, { at: Date.now(), value: out });
    return out;
  })().finally(() => inflight.delete(key));

  inflight.set(key, work);
  return work;
}

function mergeProfileIntoTeamStatsIndex(index, opponentName, profile) {
  const map = index instanceof Map ? index : new Map();
  if (!profile?.stats || !opponentName) return map;
  const key = String(opponentName).toLowerCase();
  const existing = map.get(key) || {};
  map.set(key, { ...existing, ...profile.stats });
  // Also index by aliases
  const alias = aliasTeam(opponentName);
  if (alias && alias !== key) {
    map.set(alias, { ...(map.get(alias) || {}), ...profile.stats });
  }
  return map;
}

function mergeLeagueSampleIntoIndex(index, sample) {
  const map = index instanceof Map ? index : new Map();
  if (!Array.isArray(sample)) return map;
  for (const row of sample) {
    if (!row) continue;
    const key = `espn:${row.teamId}`;
    const stats = {};
    if (row.passyardsallowed != null) stats.passyardsallowed = row.passyardsallowed;
    if (row.rushingyardsallowed != null) stats.rushingyardsallowed = row.rushingyardsallowed;
    if (Object.keys(stats).length) map.set(key, stats);
  }
  return map;
}

module.exports = {
  getOpponentDefenseProfile,
  fetchEspnSeasonOpponentStats,
  reconstructFromBoxscores,
  mergeProfileIntoTeamStatsIndex,
  mergeLeagueSampleIntoIndex,
  toCfbdCompatibleStats,
  FBS_RANK_DENOM,
};
