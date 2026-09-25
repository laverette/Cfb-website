const CFBD_BASE = "https://api.collegefootballdata.com";
const { cached } = require("./cache");
const { recordApiUsage } = require("../api-usage");
const {
  assertCfbdAvailable,
  isRateLimitError,
  tripCfbdCircuit,
  isCfbdCircuitOpen,
  cfbdCircuitInfo,
} = require("./data/circuit-breaker");
const { dataLog } = require("./data/log");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ttlFor(path, query = {}) {
  const p = String(path || "");
  const year = Number(query.year || query.season);
  const currentYear = new Date().getFullYear();
  const isPrior = Number.isFinite(year) && year < currentYear;

  if (p.startsWith("/player/search")) return 10 * 60 * 1000;
  if (p.startsWith("/games/players")) return isPrior ? 14 * DAY : 3 * HOUR;
  if (p === "/games" || p.startsWith("/games")) {
    if (query.team && isPrior) return 14 * DAY;
    return 4 * HOUR;
  }
  if (p.startsWith("/player/season/overview")) return isPrior ? 7 * DAY : 4 * HOUR;
  if (p.startsWith("/stats/season/advanced")) return 8 * HOUR;
  if (p.startsWith("/stats/season")) return 8 * HOUR;
  if (p.startsWith("/stats/player/season")) return isPrior ? 7 * DAY : 4 * HOUR;
  if (p.startsWith("/ppa/teams")) return 8 * HOUR;
  if (p.startsWith("/lines")) return 4 * HOUR;
  if (p.startsWith("/teams")) return DAY;
  if (p.startsWith("/calendar")) return DAY;
  return 2 * HOUR;
}

function cacheKey(path, query) {
  const q = Object.entries(query || {})
    .filter(([, v]) => v != null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${path}?${q}`;
}

function createUsage() {
  return { requests: 0, cacheHits: 0, cacheMisses: 0, paths: [] };
}

function createClient(apiKey, { signal, usage } = {}) {
  const log = usage || createUsage();

  async function rawGet(path, query) {
    assertCfbdAvailable();
    const url = new URL(CFBD_BASE + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    log.requests += 1;
    log.paths.push(path);
    let resp;
    try {
      resp = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const wrapped = new Error(`CFBD ${path} network error: ${err.message}`);
      wrapped.code = "CFBD_NETWORK";
      wrapped.cause = err;
      throw wrapped;
    }
    recordApiUsage({ feature: "prop-lab", source: "cfbd", calls: 1 });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const err = new Error(`CFBD ${path} failed (${resp.status}): ${text.slice(0, 180)}`);
      err.status = resp.status;
      err.headers = resp.headers;
      if (isRateLimitError(err)) {
        const trip = tripCfbdCircuit(err, resp.headers);
        dataLog("PlayerData", `CFBD circuit open for ${Math.ceil(trip.cooldownMs / 1000)}s`);
      }
      throw err;
    }
    return resp.json();
  }

  async function get(path, query, opts = {}) {
    if (isCfbdCircuitOpen() && opts.bypassCircuit !== true) {
      assertCfbdAvailable();
    }
    const ttl = opts.ttlMs != null ? opts.ttlMs : ttlFor(path, query);
    const key = cacheKey(path, query);
    const persist = opts.persist !== false;
    const hit = await cached(key, ttl, () => rawGet(path, query), { persist });
    if (hit.source === "network") log.cacheMisses += 1;
    else log.cacheHits += 1;
    return hit.value;
  }

  async function getOptional(path, query, opts = {}) {
    try {
      return await get(path, query, opts);
    } catch (err) {
      if (err?.code === "CFBD_CIRCUIT_OPEN" || isRateLimitError(err)) {
        // Propagate rate-limit awareness without throwing into every caller.
        log.circuitOpen = true;
      }
      return null;
    }
  }

  return {
    get,
    getOptional,
    usage: log,
    rawGet,
    circuit: () => cfbdCircuitInfo(),
  };
}

module.exports = { createClient, createUsage, ttlFor, cacheKey };
