/**
 * Provider-neutral player/game data orchestrator for Prop Lab.
 *
 * Order (mode=auto):
 *   fresh cache → CFBD → ESPN → stale cache → PLAYER_DATA_UNAVAILABLE
 */

const { readMemory, writeMemory } = require("../cache");
const {
  parsePlayerGameLogs,
  parseSchedule,
} = require("../parse");
const { dataLog } = require("./log");
const {
  readProviderMode,
  allowsCfbd,
  allowsEspn,
  forcesEspn,
  forcesCfbd,
} = require("./provider-mode");
const {
  shouldFallbackToEspn,
  isRateLimitError,
  tripCfbdCircuit,
  isCfbdCircuitOpen,
  assertCfbdAvailable,
  cfbdCircuitInfo,
  isProgrammerCfbdError,
} = require("./circuit-breaker");
const { dedupeGameLogs, gameKey } = require("./game-key");
const espn = require("./espn");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const inflightLogs = globalThis.__cfb_player_log_inflight || new Map();
globalThis.__cfb_player_log_inflight = inflightLogs;

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function logCacheKey({ playerId, playerName, team, season }) {
  const id = playerId || slug(playerName);
  return `player-gamelog:v1:${season}:${id}:${slug(team)}`;
}

function scheduleCacheKey(team, season) {
  return `team-schedule:v1:${season}:${slug(team)}`;
}

function ttlForLogs(season) {
  const year = Number(season);
  const current = new Date().getFullYear();
  if (Number.isFinite(year) && year < current) return 14 * DAY;
  return 8 * HOUR;
}

async function readDbPayload(key) {
  try {
    const { getSupabase, hasSupabase } = require("../../../db");
    if (!hasSupabase()) return null;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("prop_lab_cfbd_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return {
      payload: data.payload,
      expiresAt: data.expires_at ? Date.parse(data.expires_at) : 0,
    };
  } catch {
    return null;
  }
}

async function writeDbPayload(key, payload, ttlMs) {
  writeMemory(key, payload, ttlMs);
  try {
    const { getSupabase, hasSupabase } = require("../../../db");
    if (!hasSupabase()) return;
    const supabase = getSupabase();
    await supabase.from("prop_lab_cfbd_cache").upsert(
      {
        cache_key: key,
        payload,
        expires_at: new Date(Date.now() + Math.max(5_000, ttlMs)).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch {
    // optional
  }
}

async function readFreshCache(key) {
  const mem = readMemory(key);
  if (mem != null) return { value: mem, cacheSource: "memory", stale: false };
  const db = await readDbPayload(key);
  if (!db?.payload) return null;
  if (db.expiresAt && db.expiresAt <= Date.now()) {
    return { value: db.payload, cacheSource: "db", stale: true };
  }
  writeMemory(key, db.payload, Math.max(5_000, db.expiresAt - Date.now()));
  return { value: db.payload, cacheSource: "db", stale: false };
}

function scheduleIndex(schedule) {
  const map = new Map();
  for (const g of schedule || []) {
    if (g.gameId != null) map.set(String(g.gameId), g);
  }
  return map;
}

async function loadFromCfbd(cfbd, { playerId, playerName, team, season }) {
  assertCfbdAvailable();
  if (!cfbd) {
    const err = new Error("CFBD client not available");
    err.code = "CFBD_UNAVAILABLE";
    throw err;
  }
  if (!team) {
    const err = new Error("team required");
    err.code = "BAD_PARAMS";
    throw err;
  }

  const seasonYear = Number(season);
  let box;
  try {
    box = await cfbd.get("/games/players", {
      year: seasonYear,
      team,
      seasonType: "regular",
    });
  } catch (err) {
    if (isRateLimitError(err)) tripCfbdCircuit(err, err.headers);
    throw err;
  }

  let scheduleRaw = null;
  try {
    scheduleRaw = await cfbd.getOptional("/games", {
      year: seasonYear,
      team,
      seasonType: "regular",
    });
  } catch {
    scheduleRaw = null;
  }
  const schedule = parseSchedule(scheduleRaw, team);
  const logs = parsePlayerGameLogs(box, {
    playerId: playerId != null ? String(playerId) : null,
    playerName,
    team,
    scheduleById: scheduleIndex(schedule),
  }).map((g) => ({
    ...g,
    team,
    season: g.season ?? seasonYear,
    source: "cfbd",
    originalSource: "cfbd",
  }));

  if (!logs.length) {
    const err = new Error("CFBD returned no player game stats");
    err.code = "PLAYER_STATS_MISSING";
    throw err;
  }

  return {
    games: dedupeGameLogs(logs),
    schedule,
    source: "cfbd",
    originalSource: "cfbd",
  };
}

async function loadFromEspn(args) {
  const result = await espn.getEspnPlayerGameLog(args);
  let schedule = [];
  try {
    const sched = await espn.getEspnTeamSchedule(args.team, args.season, {
      signal: args.signal,
    });
    schedule = sched.schedule;
  } catch {
    schedule = [];
  }
  return {
    games: result.games,
    schedule,
    source: "espn",
    originalSource: "espn",
    cacheSource: result.cacheSource,
    athlete: result.athlete,
    path: result.path,
  };
}

/**
 * High-level entry used by loadPlayerBundle.
 */
async function getPlayerGameLog({
  playerId,
  playerName,
  team,
  season,
  position,
  jersey,
  cfbd,
  signal,
  mode,
} = {}) {
  const providerMode = mode || readProviderMode();
  const seasonYear = Number(season) || new Date().getFullYear();
  const key = logCacheKey({ playerId, playerName, team, season: seasonYear });
  const label = `${playerName || playerId || "player"} ${seasonYear}`;

  if (inflightLogs.has(key)) {
    dataLog("PlayerData", `Inflight join: ${label}`);
    return inflightLogs.get(key);
  }

  const work = (async () => {
    const meta = {
      mode: providerMode,
      source: null,
      originalSource: null,
      cache: "MISS",
      stale: false,
      circuit: cfbdCircuitInfo(),
    };

    const cachedHit = await readFreshCache(key);
    if (cachedHit && !cachedHit.stale && Array.isArray(cachedHit.value?.games)) {
      dataLog("PlayerData", `Cache hit: ${label}`);
      return {
        games: cachedHit.value.games,
        schedule: cachedHit.value.schedule || [],
        source: "cache",
        originalSource: cachedHit.value.originalSource || cachedHit.value.source || null,
        cache: "HIT",
        stale: false,
        meta: {
          ...meta,
          source: "cache",
          originalSource: cachedHit.value.originalSource || cachedHit.value.source,
          cache: "HIT",
        },
      };
    }

    const stale = cachedHit?.stale ? cachedHit : null;
    let cfbdErr = null;

    if (allowsCfbd(providerMode) && !forcesEspn(providerMode) && !isCfbdCircuitOpen()) {
      try {
        dataLog("PlayerData", `CFBD request: ${label}`);
        const fromCfbd = await loadFromCfbd(cfbd, {
          playerId,
          playerName,
          team,
          season: seasonYear,
        });
        const payload = {
          games: fromCfbd.games,
          schedule: fromCfbd.schedule,
          source: "cfbd",
          originalSource: "cfbd",
          updatedAt: new Date().toISOString(),
        };
        await writeDbPayload(key, payload, ttlForLogs(seasonYear));
        return {
          ...payload,
          cache: "MISS",
          stale: false,
          meta: { ...meta, source: "cfbd", originalSource: "cfbd", cache: "MISS" },
        };
      } catch (err) {
        cfbdErr = err;
        dataLog("PlayerData", `CFBD request failed: ${err.status || err.code || err.message}`);
        if (isProgrammerCfbdError(err) && forcesCfbd(providerMode)) throw err;
        if (!shouldFallbackToEspn(err) && forcesCfbd(providerMode)) throw err;
        if (!allowsEspn(providerMode)) {
          if (stale?.value?.games?.length) {
            dataLog("PlayerData", `Returning stale cache after CFBD error: ${label}`);
            return {
              games: stale.value.games,
              schedule: stale.value.schedule || [],
              source: "cache",
              originalSource: stale.value.originalSource || stale.value.source,
              cache: "STALE",
              stale: true,
              meta: {
                ...meta,
                source: "cache",
                originalSource: stale.value.originalSource || stale.value.source,
                cache: "STALE",
                stale: true,
                cfbdError: String(err.message || err),
              },
            };
          }
          throw err;
        }
        if (shouldFallbackToEspn(err) || err.code === "PLAYER_STATS_MISSING") {
          dataLog("PlayerData", "Falling back to ESPN");
        } else if (isProgrammerCfbdError(err)) {
          dataLog("PlayerData", `Not falling back (programmer error): ${err.message}`);
          throw err;
        } else {
          dataLog("PlayerData", "Falling back to ESPN");
        }
      }
    } else if (isCfbdCircuitOpen() && allowsEspn(providerMode)) {
      dataLog("PlayerData", "CFBD circuit open — using ESPN");
    }

    if (allowsEspn(providerMode)) {
      try {
        const fromEspn = await loadFromEspn({
          playerId,
          playerName,
          team,
          season: seasonYear,
          position,
          jersey,
          signal,
        });
        const payload = {
          games: fromEspn.games,
          schedule: fromEspn.schedule,
          source: "espn",
          originalSource: "espn",
          updatedAt: new Date().toISOString(),
          athlete: fromEspn.athlete || null,
        };
        await writeDbPayload(key, payload, ttlForLogs(seasonYear));
        return {
          ...payload,
          cache: fromEspn.cacheSource === "network" ? "MISS" : "HIT",
          stale: false,
          meta: {
            ...meta,
            source: "espn",
            originalSource: "espn",
            cache: fromEspn.cacheSource === "network" ? "MISS" : "HIT",
            path: fromEspn.path,
            cfbdError: cfbdErr ? String(cfbdErr.message || cfbdErr) : null,
          },
        };
      } catch (espnErr) {
        dataLog("PlayerData", `ESPN failed: ${espnErr.message}`);
        if (stale?.value?.games?.length) {
          dataLog("PlayerData", `Returning stale cache: ${label}`);
          return {
            games: stale.value.games,
            schedule: stale.value.schedule || [],
            source: "cache",
            originalSource: stale.value.originalSource || stale.value.source,
            cache: "STALE",
            stale: true,
            meta: {
              ...meta,
              source: "cache",
              originalSource: stale.value.originalSource || stale.value.source,
              cache: "STALE",
              stale: true,
              espnError: String(espnErr.message || espnErr),
              cfbdError: cfbdErr ? String(cfbdErr.message || cfbdErr) : null,
            },
          };
        }
        const err = new Error("Player statistics are temporarily unavailable.");
        err.code = "PLAYER_DATA_UNAVAILABLE";
        err.cfbdError = cfbdErr ? String(cfbdErr.message || cfbdErr) : null;
        err.espnError = String(espnErr.message || espnErr);
        throw err;
      }
    }

    if (stale?.value?.games?.length) {
      return {
        games: stale.value.games,
        schedule: stale.value.schedule || [],
        source: "cache",
        originalSource: stale.value.originalSource || stale.value.source,
        cache: "STALE",
        stale: true,
        meta: {
          ...meta,
          source: "cache",
          cache: "STALE",
          stale: true,
        },
      };
    }

    const err = new Error("Player statistics are temporarily unavailable.");
    err.code = "PLAYER_DATA_UNAVAILABLE";
    err.cfbdError = cfbdErr ? String(cfbdErr.message || cfbdErr) : null;
    throw err;
  })().finally(() => {
    inflightLogs.delete(key);
  });

  inflightLogs.set(key, work);
  return work;
}

async function getTeamScheduleData({ team, season, cfbd, signal, mode } = {}) {
  const providerMode = mode || readProviderMode();
  const seasonYear = Number(season) || new Date().getFullYear();
  const key = scheduleCacheKey(team, seasonYear);

  const fresh = await readFreshCache(key);
  if (fresh && !fresh.stale && Array.isArray(fresh.value?.schedule)) {
    return {
      schedule: fresh.value.schedule,
      source: "cache",
      originalSource: fresh.value.originalSource || fresh.value.source,
      cache: "HIT",
    };
  }

  if (allowsCfbd(providerMode) && !forcesEspn(providerMode) && !isCfbdCircuitOpen() && cfbd) {
    try {
      assertCfbdAvailable();
      const raw = await cfbd.get("/games", {
        year: seasonYear,
        team,
        seasonType: "regular",
      });
      const schedule = parseSchedule(raw, team);
      if (schedule.length) {
        const payload = { schedule, source: "cfbd", originalSource: "cfbd" };
        await writeDbPayload(key, payload, Math.min(ttlForLogs(seasonYear), 4 * HOUR));
        return { ...payload, cache: "MISS" };
      }
    } catch (err) {
      dataLog("PlayerData", `CFBD schedule failed: ${err.message}`);
      if (isRateLimitError(err)) tripCfbdCircuit(err, err.headers);
      if (!allowsEspn(providerMode) && !shouldFallbackToEspn(err)) throw err;
    }
  }

  if (allowsEspn(providerMode)) {
    const espnSched = await espn.getEspnTeamSchedule(team, seasonYear, { signal });
    const payload = {
      schedule: espnSched.schedule,
      source: "espn",
      originalSource: "espn",
    };
    await writeDbPayload(key, payload, Math.min(ttlForLogs(seasonYear), 4 * HOUR));
    return { ...payload, cache: "MISS" };
  }

  if (fresh?.stale && Array.isArray(fresh.value?.schedule)) {
    return {
      schedule: fresh.value.schedule,
      source: "cache",
      originalSource: fresh.value.originalSource || fresh.value.source,
      cache: "STALE",
      stale: true,
    };
  }

  return { schedule: [], source: null, cache: "MISS" };
}

function mergePreferCfbd(primary, fallback) {
  return dedupeGameLogs([...(primary || []), ...(fallback || [])]);
}

module.exports = {
  getPlayerGameLog,
  getTeamScheduleData,
  logCacheKey,
  scheduleCacheKey,
  mergePreferCfbd,
  gameKey,
  readProviderMode,
  _inflightLogs: inflightLogs,
};
