/**
 * Server-side player profile assembly + Supabase cache.
 * Browser hits /api/player once; CFBD is only called on cache miss.
 */

const CFBD_BASE = "https://api.collegefootballdata.com";
const { getSupabase } = require("../db");

const SEASON_YEAR = 2026;
const CAREER_START_YEAR = 2018;
const CAREER_CONCURRENCY = 3;
const DEFAULT_TTL_HOURS = 12;

/** Warm-isolate memory cache (survives across requests in the same instance). */
const memoryCache = new Map();

function ttlMs() {
  const h = Number(process.env.PLAYER_CACHE_TTL_HOURS);
  const hours = Number.isFinite(h) && h > 0 ? h : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

function pick(obj, ...keys) {
  if (!obj) return null;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

async function cfbdGet(path, query, apiKey, signal) {
  const url = new URL(CFBD_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`CFBD ${path} failed (${resp.status}): ${text.slice(0, 180)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function cfbdGetOptional(path, query, apiKey, signal) {
  try {
    return await cfbdGet(path, query, apiKey, signal);
  } catch {
    return null;
  }
}

async function mapPool(items, limit, worker) {
  let i = 0;
  const results = new Array(items.length);
  async function next() {
    if (i >= items.length) return;
    const idx = i;
    i += 1;
    results[idx] = await worker(items[idx], idx);
    return next();
  }
  const starters = [];
  for (let c = 0; c < Math.min(limit, items.length); c += 1) {
    starters.push(next());
  }
  await Promise.all(starters);
  return results;
}

function categoriesFrom(overview) {
  if (!overview) return [];
  const box = pick(overview, "boxScoreStats", "box_score_stats") || {};
  const cats = pick(box, "categories") || [];
  return Array.isArray(cats) ? cats : [];
}

function hasUsefulStats(overview) {
  if (!overview) return false;
  if (overview.games != null && Number(overview.games) > 0) return true;
  return categoriesFrom(overview).some(
    (c) => Array.isArray(c.stats) && c.stats.length > 0
  );
}

function cacheKey(playerId, seasonYear) {
  return `${String(playerId)}:${seasonYear}`;
}

function readMemory(playerId, seasonYear) {
  const key = cacheKey(playerId, seasonYear);
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeMemory(playerId, seasonYear, payload, expiresAtMs) {
  memoryCache.set(cacheKey(playerId, seasonYear), {
    payload,
    expiresAt: expiresAtMs,
  });
}

async function readDbCache(playerId, seasonYear) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("cfbd_player_cache")
      .select("payload, expires_at")
      .eq("player_id", String(playerId))
      .eq("season_year", seasonYear)
      .maybeSingle();
    if (error) {
      // Table missing or RLS — treat as cache miss
      console.warn("player-cache read:", error.message || error);
      return null;
    }
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    return data.payload;
  } catch (err) {
    console.warn("player-cache read failed:", err.message || err);
    return null;
  }
}

async function writeDbCache(playerId, seasonYear, payload, expiresAtIso) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("cfbd_player_cache").upsert(
      {
        player_id: String(playerId),
        season_year: seasonYear,
        payload,
        expires_at: expiresAtIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id,season_year" }
    );
    if (error) console.warn("player-cache write:", error.message || error);
  } catch (err) {
    console.warn("player-cache write failed:", err.message || err);
  }
}

async function loadRosterPlayer({ team, playerId, name, year, apiKey, signal }) {
  if (!team) return null;
  const roster = await cfbdGetOptional("/roster", { team, year }, apiKey, signal);
  const arr = Array.isArray(roster) ? roster : [];
  let hit = arr.find((r) => String(r.id) === String(playerId));
  if (!hit && name) {
    const needle = String(name).toLowerCase();
    hit = arr.find((r) => {
      const n = `${r.firstName || ""} ${r.lastName || ""}`.trim().toLowerCase();
      return n === needle || n.includes(needle);
    });
  }
  return hit || null;
}

async function loadSeasonOverview(playerId, year, apiKey, signal) {
  let data = await cfbdGetOptional(
    "/player/season/overview",
    { year, playerId },
    apiKey,
    signal
  );
  if (!data) {
    data = await cfbdGetOptional(
      "/player/season/overview",
      { year, player_id: playerId },
      apiKey,
      signal
    );
  }
  return data;
}

async function loadUsageYear(playerId, year, apiKey, signal) {
  let rows = await cfbdGetOptional(
    "/player/usage",
    { year, playerId },
    apiKey,
    signal
  );
  if (!Array.isArray(rows) || !rows.length) {
    rows = await cfbdGetOptional(
      "/player/usage",
      { year, player_id: playerId },
      apiKey,
      signal
    );
  }
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function displayName(bio, fallbackName) {
  if (bio?.name) return bio.name;
  const full = `${bio?.firstName || ""} ${bio?.lastName || ""}`.trim();
  return full || fallbackName || "Player";
}

async function buildPlayerProfile({
  playerId,
  team = "",
  name = "",
  apiKey,
  forceRefresh = false,
}) {
  const id = String(playerId || "").trim();
  if (!id) {
    const err = new Error("player id required");
    err.code = "MISSING_ID";
    throw err;
  }
  if (!apiKey) {
    const err = new Error("CFBD_API_KEY not configured");
    err.code = "NO_API_KEY";
    throw err;
  }

  const seasonYear = SEASON_YEAR;

  if (!forceRefresh) {
    const mem = readMemory(id, seasonYear);
    if (mem) {
      return { ...mem, cache: { hit: true, source: "memory" } };
    }
    const db = await readDbCache(id, seasonYear);
    if (db) {
      writeMemory(id, seasonYear, db, Date.now() + ttlMs());
      return { ...db, cache: { hit: true, source: "database" } };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const signal = controller.signal;

  try {
    let teamName = String(team || "").trim();
    let playerName = String(name || "").trim();

    let fromRoster =
      (await loadRosterPlayer({
        team: teamName,
        playerId: id,
        name: playerName,
        year: seasonYear,
        apiKey,
        signal,
      })) ||
      (await loadRosterPlayer({
        team: teamName,
        playerId: id,
        name: playerName,
        year: seasonYear - 1,
        apiKey,
        signal,
      })) ||
      (await loadRosterPlayer({
        team: teamName,
        playerId: id,
        name: playerName,
        year: seasonYear - 2,
        apiKey,
        signal,
      }));

    let fromSearch = null;
    const searchTerm =
      playerName ||
      (fromRoster
        ? `${fromRoster.firstName || ""} ${fromRoster.lastName || ""}`.trim()
        : "");
    if (searchTerm) {
      const hits = await cfbdGetOptional(
        "/player/search",
        {
          searchTerm,
          team: teamName || undefined,
          year: seasonYear - 1,
        },
        apiKey,
        signal
      );
      if (Array.isArray(hits) && hits.length) {
        fromSearch =
          hits.find((h) => String(h.id) === String(id)) || hits[0];
      }
    }

    const bio = Object.assign({}, fromSearch || {}, fromRoster || {}, {
      id,
    });
    if (!teamName && bio.team) teamName = bio.team;
    if (!playerName) playerName = displayName(bio, name);

    const seasonOverview = await loadSeasonOverview(id, seasonYear, apiKey, signal);

    const years = [];
    for (let y = seasonYear; y >= CAREER_START_YEAR; y -= 1) years.push(y);

    const overviews = await mapPool(years, CAREER_CONCURRENCY, async (year) => {
      const data = await loadSeasonOverview(id, year, apiKey, signal);
      return { year, data };
    });

    let career = overviews.filter((r) => r && hasUsefulStats(r.data));

    const missing = years.filter((y) => !career.some((f) => f.year === y));
    if (missing.length) {
      const usageYears = (
        await mapPool(missing, CAREER_CONCURRENCY, async (year) => {
          const u = await loadUsageYear(id, year, apiKey, signal);
          return u ? year : null;
        })
      ).filter(Boolean);

      const extras = await mapPool(usageYears, CAREER_CONCURRENCY, async (year) => {
        const data = await loadSeasonOverview(id, year, apiKey, signal);
        if (hasUsefulStats(data)) return { year, data };
        return {
          year,
          data: {
            season: year,
            team: (data && data.team) || teamName,
            games: null,
            boxScoreStats: { categories: [] },
            _usageOnly: true,
          },
        };
      });
      for (const row of extras.filter(Boolean)) {
        if (!career.some((f) => f.year === row.year)) career.push(row);
      }
    }

    career.sort((a, b) => b.year - a.year);

    const payload = {
      playerId: id,
      seasonYear,
      team: teamName,
      name: playerName,
      bio,
      seasonOverview: seasonOverview || null,
      career,
      fetchedAt: new Date().toISOString(),
    };

    const expiresAtMs = Date.now() + ttlMs();
    writeMemory(id, seasonYear, payload, expiresAtMs);
    await writeDbCache(id, seasonYear, payload, new Date(expiresAtMs).toISOString());

    return {
      ...payload,
      cache: { hit: false, source: "live", expiresAt: new Date(expiresAtMs).toISOString() },
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  SEASON_YEAR,
  CAREER_START_YEAR,
  buildPlayerProfile,
  hasUsefulStats,
  categoriesFrom,
};
