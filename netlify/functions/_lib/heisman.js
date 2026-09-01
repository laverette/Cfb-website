/**
 * Heisman Trophy odds (ESPN futures) + user picks / lock / results.
 */

const { getSupabase, listPublicUsers } = require("../db");

const SEASON_YEAR = 2026;
const ESPN_BASE =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";
const DEFAULT_TTL_HOURS = 3;
const ATHLETE_CONCURRENCY = 12;

const memoryOdds = new Map();
const teamCache = new Map();

function hexColor(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.startsWith("#") ? s : `#${s}`;
}

async function resolveTeamFromRef(ref, signal) {
  const refUrl =
    typeof ref === "string" ? ref : ref && (ref.$ref || ref.href || ref.url);
  if (!refUrl) return null;
  const url = refUrl.startsWith("http")
    ? refUrl
    : `https://sports.core.api.espn.com${refUrl}`;
  if (teamCache.has(url)) return teamCache.get(url);
  try {
    const data = await fetchJson(url, signal);
    const teamId = data.id != null ? String(data.id) : null;
    const info = {
      teamId,
      teamName:
        data.displayName || data.name || data.shortDisplayName || null,
      teamAbbr: data.abbreviation || data.shortDisplayName || null,
      teamColor: hexColor(data.color),
      teamAltColor: hexColor(data.alternateColor),
      teamLogo:
        (Array.isArray(data.logos) && data.logos[0] && data.logos[0].href) ||
        (teamId
          ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`
          : null),
    };
    teamCache.set(url, info);
    return info;
  } catch {
    return null;
  }
}

function normalizeSeason(season) {
  const y = Number(season);
  return Number.isFinite(y) && y >= 2000 ? y : SEASON_YEAR;
}

function ttlMs() {
  const h = Number(process.env.HEISMAN_ODDS_TTL_HOURS);
  const hours = Number.isFinite(h) && h > 0 ? h : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

function parseAmericanOdds(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function impliedFromAmerican(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return Math.round((100 / (a + 100)) * 100000) / 100000;
  const abs = Math.abs(a);
  return Math.round((abs / (abs + 100)) * 100000) / 100000;
}

function formatAmerican(american) {
  if (american == null || !Number.isFinite(Number(american))) return "—";
  const n = Number(american);
  return n > 0 ? `+${n}` : String(n);
}

function extractIdFromRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/\/(?:athletes|teams)\/(\d+)/i);
  return m ? m[1] : null;
}

async function fetchJson(url, signal) {
  const resp = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "CFB-Heisman/1.0" },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`ESPN ${resp.status}: ${text.slice(0, 160)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
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

function pickBestFuturesBlock(futuresArr) {
  if (!Array.isArray(futuresArr) || !futuresArr.length) return null;
  const preferred = ["draftkings", "espn bet", "fanduel", "betmgm"];
  const scored = futuresArr
    .filter((f) => f && Array.isArray(f.books) && f.books.length)
    .map((f) => {
      const name = String(f.provider?.name || "").toLowerCase();
      const prefIdx = preferred.findIndex((p) => name.includes(p));
      return {
        f,
        score:
          (prefIdx === -1 ? 50 : prefIdx) * 1000 - (f.books?.length || 0),
      };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0]?.f || futuresArr[0];
}

async function resolveAthlete(athleteId, seasonYear, signal) {
  const data = await fetchJson(
    `${ESPN_BASE}/seasons/${seasonYear}/athletes/${athleteId}?lang=en&region=us`,
    signal
  );
  let teamInfo = null;
  if (data.team) {
    teamInfo = await resolveTeamFromRef(data.team, signal);
  }
  return {
    playerKey: String(athleteId),
    playerName:
      data.displayName ||
      data.fullName ||
      `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
      `Athlete ${athleteId}`,
    team: teamInfo?.teamName || null,
    teamId: teamInfo?.teamId || null,
    teamAbbr: teamInfo?.teamAbbr || null,
    teamColor: teamInfo?.teamColor || null,
    teamAltColor: teamInfo?.teamAltColor || null,
    teamLogo: teamInfo?.teamLogo || null,
    position: data.position?.abbreviation || data.position?.displayName || null,
    jersey: data.jersey != null ? String(data.jersey) : null,
    headshot: data.headshot?.href || null,
  };
}

async function resolveAthleteWithRetry(athleteId, seasonYear, signal, attempts = 3) {
  let lastErr = null;
  for (let n = 0; n < attempts; n += 1) {
    try {
      return await resolveAthlete(athleteId, seasonYear, signal);
    } catch (err) {
      lastErr = err;
      if (err && err.name === "AbortError") throw err;
      if (n < attempts - 1) {
        await new Promise((r) => setTimeout(r, 150 * (n + 1)));
      }
    }
  }
  throw lastErr || new Error(`Failed to resolve athlete ${athleteId}`);
}

function isUnresolvedAthleteName(name, playerKey) {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/^athlete\s+\d+$/i.test(n)) return true;
  if (playerKey && n === String(playerKey)) return true;
  return false;
}

async function fetchEspnHeismanBoard(seasonYear, signal) {
  const index = await fetchJson(
    `${ESPN_BASE}/seasons/${seasonYear}/futures?limit=100&lang=en&region=us`,
    signal
  );
  const items = Array.isArray(index.items) ? index.items : [];
  const market = items.find(
    (i) =>
      /heisman/i.test(String(i.name || "")) ||
      /heisman/i.test(String(i.displayName || ""))
  );
  if (!market) {
    const err = new Error(`No Heisman futures market found for ${seasonYear}`);
    err.code = "NO_MARKET";
    throw err;
  }

  const block = pickBestFuturesBlock(market.futures);
  if (!block || !Array.isArray(block.books) || !block.books.length) {
    const err = new Error("Heisman market has no book odds");
    err.code = "NO_BOOKS";
    throw err;
  }

  const providerName = block.provider?.name || "Sportsbook";

  const raw = [];
  for (const book of block.books) {
    const athleteId = extractIdFromRef(book.athlete?.$ref);
    if (!athleteId) continue;
    const american = parseAmericanOdds(book.value);
    if (american == null) continue;
    raw.push({
      playerKey: String(athleteId),
      americanOdds: american,
      americanDisplay: formatAmerican(american),
      impliedProb: impliedFromAmerican(american),
    });
  }

  raw.sort((a, b) => {
    const ia = a.impliedProb == null ? -1 : a.impliedProb;
    const ib = b.impliedProb == null ? -1 : b.impliedProb;
    if (ib !== ia) return ib - ia;
    return (a.americanOdds || 0) - (b.americanOdds || 0);
  });

  const hydrated = await mapPool(raw, ATHLETE_CONCURRENCY, async (row) => {
    let meta = {
      playerName: `Athlete ${row.playerKey}`,
      team: null,
      position: null,
      jersey: null,
      headshot: null,
    };
    try {
      meta = await resolveAthleteWithRetry(row.playerKey, seasonYear, signal);
    } catch {
      /* keep fallback */
    }
    return {
      ...meta,
      playerKey: row.playerKey,
      americanOdds: row.americanOdds,
      americanDisplay: row.americanDisplay,
      impliedProb: row.impliedProb,
      impliedPct:
        row.impliedProb != null
          ? Math.round(row.impliedProb * 1000) / 10
          : null,
    };
  });

  const candidates = hydrated.filter(Boolean).map((c, i) => ({ ...c, rank: i + 1 }));

  return {
    seasonYear,
    marketName: market.displayName || market.name || "Heisman Trophy",
    provider: providerName,
    source: "espn",
    fetchedAt: new Date().toISOString(),
    candidates,
  };
}

async function backfillUnresolvedNames(board, signal) {
  if (!board || !Array.isArray(board.candidates) || !board.candidates.length) {
    return { board, changed: false };
  }
  const seasonYear = board.seasonYear || SEASON_YEAR;
  const need = board.candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => isUnresolvedAthleteName(c.playerName, c.playerKey));
  if (!need.length) return { board, changed: false };

  const next = board.candidates.slice();
  await mapPool(need, ATHLETE_CONCURRENCY, async ({ c, i }) => {
    try {
      const meta = await resolveAthleteWithRetry(c.playerKey, seasonYear, signal);
      next[i] = {
        ...c,
        playerName: meta.playerName,
        team: meta.team,
        teamId: meta.teamId,
        teamAbbr: meta.teamAbbr,
        teamColor: meta.teamColor,
        teamAltColor: meta.teamAltColor,
        teamLogo: meta.teamLogo,
        position: meta.position,
        jersey: meta.jersey,
        headshot: meta.headshot,
      };
    } catch {
      /* keep placeholder */
    }
  });

  return {
    board: { ...board, candidates: next, fetchedAt: new Date().toISOString() },
    changed: true,
  };
}

function readMemoryOdds(seasonYear) {
  const hit = memoryOdds.get(seasonYear);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memoryOdds.delete(seasonYear);
    return null;
  }
  return hit.payload;
}

function writeMemoryOdds(seasonYear, payload, expiresAtMs) {
  memoryOdds.set(seasonYear, { payload, expiresAt: expiresAtMs });
}

async function readDbOdds(seasonYear) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("heisman_odds_cache")
      .select("payload, expires_at")
      .eq("season_year", seasonYear)
      .maybeSingle();
    if (error) {
      console.warn("heisman odds cache read:", error.message || error);
      return null;
    }
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    return data.payload;
  } catch (err) {
    console.warn("heisman odds cache read failed:", err.message || err);
    return null;
  }
}

async function writeDbOdds(seasonYear, payload, expiresAtIso) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("heisman_odds_cache").upsert(
      {
        season_year: seasonYear,
        payload,
        expires_at: expiresAtIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season_year" }
    );
    if (error) console.warn("heisman odds cache write:", error.message || error);
  } catch (err) {
    console.warn("heisman odds cache write failed:", err.message || err);
  }
}

async function getOddsBoard(season, { forceRefresh = false } = {}) {
  const seasonYear = normalizeSeason(season);
  if (!forceRefresh) {
    const mem = readMemoryOdds(seasonYear);
    if (mem) {
      const patched = await maybePatchCachedBoard(seasonYear, mem, "memory");
      if (patched) return patched;
    }
    const db = await readDbOdds(seasonYear);
    if (db) {
      writeMemoryOdds(seasonYear, db, Date.now() + ttlMs());
      const patched = await maybePatchCachedBoard(seasonYear, db, "database");
      if (patched) return patched;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const board = await fetchEspnHeismanBoard(seasonYear, controller.signal);
    const expiresAtMs = Date.now() + ttlMs();
    writeMemoryOdds(seasonYear, board, expiresAtMs);
    await writeDbOdds(seasonYear, board, new Date(expiresAtMs).toISOString());
    return {
      ...board,
      cache: {
        hit: false,
        source: "live",
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function backfillTeamMeta(board, signal) {
  if (!board || !Array.isArray(board.candidates) || !board.candidates.length) {
    return { board, changed: false };
  }
  const seasonYear = board.seasonYear || SEASON_YEAR;
  const need = board.candidates
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c }) =>
        c.playerKey && (!c.team || !c.teamLogo || !c.headshot)
    );
  if (!need.length) return { board, changed: false };

  const next = board.candidates.slice();
  await mapPool(need, ATHLETE_CONCURRENCY, async ({ c, i }) => {
    try {
      const meta = await resolveAthleteWithRetry(c.playerKey, seasonYear, signal);
      next[i] = {
        ...c,
        playerName: isUnresolvedAthleteName(c.playerName, c.playerKey)
          ? meta.playerName
          : c.playerName,
        team: meta.team || c.team,
        teamId: meta.teamId || c.teamId,
        teamAbbr: meta.teamAbbr || c.teamAbbr,
        teamColor: meta.teamColor || c.teamColor,
        teamAltColor: meta.teamAltColor || c.teamAltColor,
        teamLogo: meta.teamLogo || c.teamLogo,
        position: meta.position || c.position,
        jersey: meta.jersey || c.jersey,
        headshot: meta.headshot || c.headshot,
      };
    } catch {
      /* keep row */
    }
  });

  return {
    board: { ...board, candidates: next, fetchedAt: new Date().toISOString() },
    changed: true,
  };
}

async function maybePatchCachedBoard(seasonYear, board, source) {
  const needsNames =
    Array.isArray(board.candidates) &&
    board.candidates.some((c) =>
      isUnresolvedAthleteName(c.playerName, c.playerKey)
    );
  const needsTeams =
    Array.isArray(board.candidates) &&
    board.candidates.some((c) => c.playerKey && (!c.team || !c.teamLogo));

  if (!needsNames && !needsTeams) {
    return { ...board, cache: { hit: true, source } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    let working = board;
    let anyChanged = false;

    if (needsNames) {
      const { board: filled, changed } = await backfillUnresolvedNames(
        working,
        controller.signal
      );
      working = filled;
      anyChanged = anyChanged || changed;
    }
    if (needsTeams || needsNames) {
      const { board: filled, changed } = await backfillTeamMeta(
        working,
        controller.signal
      );
      working = filled;
      anyChanged = anyChanged || changed;
    }

    if (anyChanged) {
      const expiresAtMs = Date.now() + ttlMs();
      writeMemoryOdds(seasonYear, working, expiresAtMs);
      await writeDbOdds(seasonYear, working, new Date(expiresAtMs).toISOString());
      return {
        ...working,
        cache: {
          hit: true,
          source: `${source}+backfill`,
          expiresAt: new Date(expiresAtMs).toISOString(),
        },
      };
    }
  } catch (err) {
    console.warn("heisman cache backfill failed:", err.message || err);
  } finally {
    clearTimeout(timeout);
  }
  return { ...board, cache: { hit: true, source } };
}

function mapPickRow(row, user = null) {
  if (!row) return null;
  return {
    userId: Number(row.user_id),
    username: user?.username || null,
    displayName: user
      ? user.displayName || user.display_name || user.username
      : null,
    seasonYear: Number(row.season_year),
    playerKey: row.player_key,
    playerName: row.player_name,
    team: row.team || null,
    americanOddsAtPick: row.american_odds_at_pick,
    americanDisplay: formatAmerican(row.american_odds_at_pick),
    impliedProbAtPick:
      row.implied_prob_at_pick != null ? Number(row.implied_prob_at_pick) : null,
    isLocked: Boolean(row.is_locked),
    lockedAt: row.locked_at,
    updatedAt: row.updated_at,
  };
}

async function getCommunityStats(seasonYear) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("heisman_picks")
    .select(
      "user_id, player_key, player_name, team, american_odds_at_pick, implied_prob_at_pick, is_locked, locked_at"
    )
    .eq("season_year", seasonYear);
  if (error) throw error;
  const rows = data || [];
  const total = rows.length;
  const byKey = new Map();
  for (const row of rows) {
    const key = String(row.player_key);
    if (!byKey.has(key)) {
      byKey.set(key, {
        playerKey: key,
        playerName: row.player_name,
        team: row.team || null,
        pickCount: 0,
        lockedCount: 0,
      });
    }
    const entry = byKey.get(key);
    entry.pickCount += 1;
    if (row.is_locked) entry.lockedCount += 1;
  }

  const distribution = [...byKey.values()]
    .map((e) => ({
      ...e,
      pickPct: total > 0 ? Math.round((e.pickCount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.pickCount - a.pickCount || a.playerName.localeCompare(b.playerName));

  const lockedLongshots = rows
    .filter((r) => r.is_locked && Number(r.american_odds_at_pick) >= 500)
    .map((r) => ({
      playerKey: r.player_key,
      playerName: r.player_name,
      team: r.team,
      americanOdds: r.american_odds_at_pick,
      americanDisplay: formatAmerican(r.american_odds_at_pick),
      impliedProb:
        r.implied_prob_at_pick != null ? Number(r.implied_prob_at_pick) : null,
    }))
    .sort((a, b) => (b.americanOdds || 0) - (a.americanOdds || 0))
    .slice(0, 25);

  return {
    totalPicks: total,
    distribution,
    lockedLongshots,
  };
}

async function getUserPick(userId, seasonYear) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("heisman_picks")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear)
    .maybeSingle();
  if (error) throw error;
  return mapPickRow(data);
}

async function getResult(seasonYear) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("heisman_results")
    .select("*")
    .eq("season_year", seasonYear)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    seasonYear: Number(data.season_year),
    winnerPlayerKey: data.winner_player_key,
    winnerName: data.winner_name,
    setAt: data.set_at,
  };
}

async function getProphetBoard(seasonYear, winnerPlayerKey) {
  if (!winnerPlayerKey) return [];
  const supabase = getSupabase();
  const users = await listPublicUsers();
  const byId = new Map(users.map((u) => [Number(u.id), u]));
  const { data, error } = await supabase
    .from("heisman_picks")
    .select("*")
    .eq("season_year", seasonYear)
    .eq("player_key", String(winnerPlayerKey))
    .eq("is_locked", true);
  if (error) throw error;
  return (data || [])
    .map((row) => {
      const u = byId.get(Number(row.user_id));
      if (!u) return null;
      return {
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        playerName: row.player_name,
        americanOddsAtLock: row.american_odds_at_pick,
        americanDisplay: formatAmerican(row.american_odds_at_pick),
        impliedProbAtLock:
          row.implied_prob_at_pick != null
            ? Number(row.implied_prob_at_pick)
            : null,
        lockedAt: row.locked_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const oa = a.americanOddsAtLock == null ? -99999 : a.americanOddsAtLock;
      const ob = b.americanOddsAtLock == null ? -99999 : b.americanOddsAtLock;
      if (ob !== oa) return ob - oa;
      return String(a.displayName || a.username).localeCompare(
        String(b.displayName || b.username)
      );
    });
}

async function getHeismanPage(season, { userId = null, forceRefresh = false } = {}) {
  const seasonYear = normalizeSeason(season);
  const [board, community, result, myPick] = await Promise.all([
    getOddsBoard(seasonYear, { forceRefresh }),
    getCommunityStats(seasonYear),
    getResult(seasonYear),
    userId ? getUserPick(userId, seasonYear) : Promise.resolve(null),
  ]);

  const pickPctByKey = new Map(
    community.distribution.map((d) => [d.playerKey, d])
  );
  const candidates = (board.candidates || []).map((c) => {
    const dist = pickPctByKey.get(c.playerKey);
    return {
      ...c,
      pickCount: dist ? dist.pickCount : 0,
      pickPct: dist ? dist.pickPct : 0,
      lockedCount: dist ? dist.lockedCount : 0,
    };
  });

  let prophets = [];
  if (result?.winnerPlayerKey) {
    prophets = await getProphetBoard(seasonYear, result.winnerPlayerKey);
  }

  return {
    seasonYear,
    board: {
      marketName: board.marketName,
      provider: board.provider,
      source: board.source,
      fetchedAt: board.fetchedAt,
      cache: board.cache,
      candidates,
    },
    community,
    myPick,
    result,
    prophets,
  };
}

function findCandidate(board, playerKey) {
  return (board.candidates || []).find(
    (c) => String(c.playerKey) === String(playerKey)
  );
}

async function savePick({ userId, season, playerKey }) {
  const seasonYear = normalizeSeason(season);
  const key = String(playerKey || "").trim();
  if (!key) {
    const err = new Error("playerKey required");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const existing = await getUserPick(userId, seasonYear);
  if (existing?.isLocked) {
    const err = new Error("Pick is locked and cannot be changed");
    err.code = "LOCKED";
    throw err;
  }

  const board = await getOddsBoard(seasonYear);
  const cand = findCandidate(board, key);
  if (!cand) {
    const err = new Error("Player not found on current Heisman odds board");
    err.code = "NOT_ON_BOARD";
    throw err;
  }

  const row = {
    user_id: userId,
    season_year: seasonYear,
    player_key: cand.playerKey,
    player_name: cand.playerName,
    team: cand.team,
    american_odds_at_pick: cand.americanOdds,
    implied_prob_at_pick: cand.impliedProb,
    is_locked: false,
    locked_at: null,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("heisman_picks")
    .upsert(row, { onConflict: "user_id,season_year" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return mapPickRow(data);
}

async function lockPick({ userId, season }) {
  const seasonYear = normalizeSeason(season);
  const existing = await getUserPick(userId, seasonYear);
  if (!existing) {
    const err = new Error("Save a pick before locking");
    err.code = "NO_PICK";
    throw err;
  }
  if (existing.isLocked) {
    const err = new Error("Pick is already locked");
    err.code = "LOCKED";
    throw err;
  }

  // Refresh odds snapshot at lock time from current board when possible
  const board = await getOddsBoard(seasonYear);
  const cand = findCandidate(board, existing.playerKey);

  const supabase = getSupabase();
  const patch = {
    is_locked: true,
    locked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (cand) {
    patch.american_odds_at_pick = cand.americanOdds;
    patch.implied_prob_at_pick = cand.impliedProb;
    patch.player_name = cand.playerName;
    patch.team = cand.team;
  }

  const { data, error } = await supabase
    .from("heisman_picks")
    .update(patch)
    .eq("user_id", userId)
    .eq("season_year", seasonYear)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return mapPickRow(data);
}

async function setWinner({ season, winnerPlayerKey, winnerName, setBy }) {
  const seasonYear = normalizeSeason(season);
  const key = String(winnerPlayerKey || "").trim();
  if (!key) {
    const err = new Error("winnerPlayerKey required");
    err.code = "BAD_REQUEST";
    throw err;
  }

  let name = String(winnerName || "").trim();
  if (!name) {
    try {
      const board = await getOddsBoard(seasonYear);
      const cand = findCandidate(board, key);
      if (cand) name = cand.playerName;
    } catch {
      /* ignore */
    }
  }
  if (!name) name = `Player ${key}`;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("heisman_results")
    .upsert(
      {
        season_year: seasonYear,
        winner_player_key: key,
        winner_name: name,
        set_by: setBy || null,
        set_at: new Date().toISOString(),
      },
      { onConflict: "season_year" }
    )
    .select("*")
    .maybeSingle();
  if (error) throw error;

  const prophets = await getProphetBoard(seasonYear, key);
  return {
    result: {
      seasonYear,
      winnerPlayerKey: data.winner_player_key,
      winnerName: data.winner_name,
      setAt: data.set_at,
    },
    prophets,
  };
}

module.exports = {
  SEASON_YEAR,
  normalizeSeason,
  formatAmerican,
  getHeismanPage,
  getOddsBoard,
  savePick,
  lockPick,
  setWinner,
  getUserPick,
};
