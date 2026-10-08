/**
 * Shared daily CFBD league matchup snapshot.
 *
 * Loads /stats/season + /stats/season/advanced + /ppa/teams once, caches ~12h,
 * and reuses across every Prop Lab eval / week-board score. This is the only
 * CFBD path needed for PPA/advanced enrichment under a ~3k/month budget.
 */
const { createClient } = require("../cfbd-client");
const { cached } = require("../cache");
const { dataLog } = require("./log");
const { cfbdMatchupEnabled } = require("./provider-mode");
const { withExecutionContext, getExecutionCaller } = require("../../execution-context");
const { cfbdUsageSnapshot } = require("../../cfbd-guard");

const HOUR = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 12 * HOUR;

function snapshotKey(season) {
  return `league-matchup:v1:${Number(season) || new Date().getFullYear()}`;
}

function ttlMs() {
  const raw = Number(process.env.PROP_LAB_LEAGUE_SNAPSHOT_TTL_HOURS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(48, raw) * HOUR;
  return DEFAULT_TTL_MS;
}

function matchupExplicitlyOff() {
  const v = String(process.env.PROP_LAB_CFBD_MATCHUP || "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Whether the league snapshot warmer may hit CFBD (including background cron).
 */
function allowLeagueSnapshotCfbd() {
  if (matchupExplicitlyOff()) return false;
  if (!cfbdMatchupEnabled()) return false;
  return true;
}

async function fetchLeagueSnapshot(apiKey, season, { signal } = {}) {
  if (!apiKey) {
    const err = new Error("CFBD_API_KEY required for league matchup snapshot");
    err.code = "CFBD_KEY_MISSING";
    throw err;
  }
  const usage = cfbdUsageSnapshot();
  const headroom = Math.max(0, (usage.limit || 500) - (usage.allowed || 0));
  if (headroom < 3) {
    const err = new Error(
      `CFBD daily soft limit too close for league snapshot (${usage.allowed}/${usage.limit})`
    );
    err.code = "CFBD_DAILY_LIMIT";
    throw err;
  }
  const year = Number(season) || new Date().getFullYear();
  const client = createClient(apiKey, {
    signal,
    caller: getExecutionCaller() || "prop-lab-league-snapshot",
  });
  const before = usage;
  const [teamStats, advanced, ppa] = await Promise.all([
    client.getOptional("/stats/season", { year, seasonType: "regular" }),
    client.getOptional("/stats/season/advanced", { year, startWeek: 1 }),
    client.getOptional("/ppa/teams", { year, excludeGarbageTime: true }),
  ]);
  const after = cfbdUsageSnapshot();
  const cfbdCalls = Math.max(0, (after.allowed || 0) - (before.allowed || 0));
  dataLog(
    "LeagueSnapshot",
    `Fetched season=${year} stats=${Array.isArray(teamStats) ? teamStats.length : 0} adv=${
      Array.isArray(advanced) ? advanced.length : 0
    } ppa=${Array.isArray(ppa) ? ppa.length : 0} cfbdCalls=${cfbdCalls}`
  );
  return {
    season: year,
    fetchedAt: new Date().toISOString(),
    teamStats: Array.isArray(teamStats) ? teamStats : teamStats ? [teamStats] : [],
    advanced: Array.isArray(advanced) ? advanced : advanced ? [advanced] : [],
    ppa: Array.isArray(ppa) ? ppa : ppa ? [ppa] : [],
    cfbdCalls,
    apiUsage: client.usage || null,
  };
}

/**
 * @returns {Promise<{
 *   season: number,
 *   teamStats: object[],
 *   advanced: object[],
 *   ppa: object[],
 *   cache: 'HIT'|'MISS'|'SKIP',
 *   fetchedAt?: string,
 *   cfbdCalls?: number,
 * }|null>}
 */
async function getLeagueMatchupSnapshot(season, { apiKey, signal, force = false } = {}) {
  if (!allowLeagueSnapshotCfbd()) {
    return { season: Number(season) || new Date().getFullYear(), teamStats: [], advanced: [], ppa: [], cache: "SKIP" };
  }
  if (!apiKey) {
    dataLog("LeagueSnapshot", "No CFBD key — skip league snapshot");
    return { season: Number(season) || new Date().getFullYear(), teamStats: [], advanced: [], ppa: [], cache: "SKIP" };
  }

  const year = Number(season) || new Date().getFullYear();
  const key = snapshotKey(year);
  const ttl = ttlMs();

  const load = async () => {
    // Narrow background exception: run fetch under league-snapshot caller.
    const run = () => fetchLeagueSnapshot(apiKey, year, { signal });
    const caller = getExecutionCaller();
    if (caller && caller !== "prop-lab-league-snapshot") {
      return withExecutionContext("interactive", run, { caller: "prop-lab-league-snapshot" });
    }
    return run();
  };

  if (force) {
    const value = await load();
    // Write through cache helper by simulating a miss path.
    const { writeMemory, writeDb } = require("../cache");
    writeMemory(key, value, ttl);
    await writeDb(key, value, ttl);
    return { ...value, cache: "MISS" };
  }

  const hit = await cached(key, ttl, load, { persist: true });
  const value = hit.value || {};
  return {
    season: year,
    teamStats: value.teamStats || [],
    advanced: value.advanced || [],
    ppa: value.ppa || [],
    fetchedAt: value.fetchedAt || null,
    cfbdCalls: value.cfbdCalls || 0,
    apiUsage: value.apiUsage || null,
    cache: hit.source === "network" ? "MISS" : "HIT",
  };
}

module.exports = {
  getLeagueMatchupSnapshot,
  allowLeagueSnapshotCfbd,
  snapshotKey,
  ttlMs,
};
