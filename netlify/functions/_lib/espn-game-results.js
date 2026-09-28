/**
 * Fresh ESPN final-score lookups for Weekly Picks grading.
 * Does NOT use the admin schedule cache — always hits ESPN live endpoints.
 *
 * Primary: scoreboard by dates=YYYYMMDD (+ week board)
 * Fallback: summary?event={espnEventId}
 */
const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary";

const FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://www.espn.com/college-football/scoreboard",
  origin: "https://www.espn.com",
};

const DEBUG =
  process.env.ESPN_GRADE_DEBUG === "1" ||
  process.env.NODE_ENV === "development" ||
  process.env.CONTEXT === "dev";

function log(...args) {
  if (DEBUG) console.log("[Weekly Picks]", ...args);
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ESPN CFB event ids are typically 401xxxxxx (9 digits). CFBD ids are much smaller. */
function isEspnEventId(id) {
  const n = toInt(id);
  if (n == null) return false;
  return n >= 400000000;
}

function formatEspnDateFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}${m}${day}` : null;
}

function adjacentEtDays(ymd) {
  if (!ymd || !/^\d{8}$/.test(ymd)) return [];
  const out = new Set([ymd]);
  try {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const base = new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
    for (const delta of [-1, 1]) {
      const n = new Date(base.getTime() + delta * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(n);
      const yy = parts.find((p) => p.type === "year")?.value;
      const mm = parts.find((p) => p.type === "month")?.value;
      const dd = parts.find((p) => p.type === "day")?.value;
      if (yy && mm && dd) out.add(`${yy}${mm}${dd}`);
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

async function fetchEspnJson(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    log("ESPN request", url);
    const resp = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: ctrl.signal,
    });
    const text = await resp.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!resp.ok) {
      const err = new Error(`ESPN HTTP ${resp.status}`);
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEspnJsonRetry(url) {
  try {
    return await fetchEspnJson(url);
  } catch (err) {
    if ([502, 503, 504, 0].includes(Number(err.status)) || err.name === "AbortError") {
      return fetchEspnJson(url);
    }
    throw err;
  }
}

/**
 * Parse an ESPN event or summary competition into a normalized live-score row.
 */
function normalizeEspnEvent(evt) {
  if (!evt) return null;
  // summary endpoint nests under header.competitions; scoreboard under competitions
  const headerComp = Array.isArray(evt?.header?.competitions)
    ? evt.header.competitions[0]
    : null;
  const comp =
    headerComp ||
    (Array.isArray(evt?.competitions) ? evt.competitions[0] : null) ||
    null;
  if (!comp) return null;

  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const status = comp.status?.type || evt?.status?.type || evt?.header?.competitions?.[0]?.status?.type || {};
  const statusState = String(status.state || "").toLowerCase();
  const statusName = String(status.name || "");
  const detail = String(status.detail || status.shortDetail || "");
  const completedFlag = status.completed === true;
  const canceled =
    /cancel/i.test(statusName) ||
    /cancel/i.test(detail) ||
    statusState === "cancelled" ||
    statusState === "canceled";
  const postponed =
    /postpon/i.test(statusName) ||
    /postpon/i.test(detail) ||
    /delay/i.test(statusName);
  const completed =
    !canceled &&
    !postponed &&
    (completedFlag ||
      statusState === "post" ||
      /final/i.test(statusName) ||
      /final/i.test(detail));

  const eventId = toInt(evt.id ?? evt?.header?.id ?? comp.id);

  // Scores: never coerce missing → 0
  const homePoints =
    home.score != null && home.score !== "" ? toInt(home.score) : null;
  const awayPoints =
    away.score != null && away.score !== "" ? toInt(away.score) : null;

  return {
    id: eventId,
    espnEventId: eventId,
    source: "espn",
    awayTeam: away.team?.location || away.team?.displayName || null,
    homeTeam: home.team?.location || home.team?.displayName || null,
    awayEspnId: toInt(away.team?.id ?? away.id),
    homeEspnId: toInt(home.team?.id ?? home.id),
    awayPoints,
    homePoints,
    awayWinner: away.winner === true,
    homeWinner: home.winner === true,
    completed,
    canceled,
    postponed,
    statusState,
    statusRaw: statusName || detail,
  };
}

function datesForGames(games) {
  const dates = new Set();
  for (const g of games || []) {
    const ymd = formatEspnDateFromIso(g.game_date || g.gameDate);
    for (const d of adjacentEtDays(ymd)) dates.add(d);
  }
  return [...dates].slice(0, 10);
}

/**
 * Fetch scoreboard events for the given YYYYMMDD dates + optional week board.
 * Returns Map<stringEventId, normalizedRow>
 */
async function fetchEspnScoreboardIndex({ dates = [], week = null, seasonYear = null } = {}) {
  const byId = new Map();
  const urls = [];
  for (const date of [...new Set(dates)].filter((d) => /^\d{8}$/.test(d)).slice(0, 10)) {
    urls.push(`${ESPN_SB}?dates=${encodeURIComponent(date)}&groups=80&limit=300`);
  }
  if (Number.isFinite(Number(week)) && Number.isFinite(Number(seasonYear))) {
    urls.push(
      `${ESPN_SB}?seasontype=2&week=${Number(week)}&dates=${Number(seasonYear)}&groups=80&limit=300`
    );
  }
  // Current board as last resort for live windows
  urls.push(`${ESPN_SB}?groups=80&limit=300`);

  for (const url of urls) {
    try {
      const data = await fetchEspnJsonRetry(url);
      const events = Array.isArray(data?.events) ? data.events : [];
      log(`ESPN returned ${events.length} events`, url.replace(ESPN_SB, "scoreboard"));
      for (const evt of events) {
        const row = normalizeEspnEvent(evt);
        if (!row?.id) continue;
        byId.set(String(row.id), row);
      }
    } catch (err) {
      console.warn("[Weekly Picks] ESPN scoreboard failed:", err.status || err.message, url);
    }
  }
  return byId;
}

async function fetchEspnSummaryResult(espnEventId) {
  const id = toInt(espnEventId);
  if (id == null) return null;
  const url = `${ESPN_SUMMARY}?event=${encodeURIComponent(id)}`;
  try {
    const data = await fetchEspnJsonRetry(url);
    // Attach id for normalize
    const row = normalizeEspnEvent({ ...data, id });
    if (row) log(`summary event ${id} completed=${row.completed}`);
    return row;
  } catch (err) {
    console.warn("[Weekly Picks] ESPN summary failed:", id, err.status || err.message);
    return null;
  }
}

/**
 * Resolve fresh ESPN results for a list of slate games.
 * Prefer event-id match from scoreboard; summary fallback for misses.
 */
async function fetchEspnResultsForGames(games, { week = null, seasonYear = null } = {}) {
  const list = Array.isArray(games) ? games : [];
  const espnGames = list.filter((g) => isEspnEventId(g.cfbd_game_id ?? g.espn_event_id));
  const dates = datesForGames(list);
  log(`Fetching scores for dates ${dates.join(",") || "(none)"}`);

  const byId = await fetchEspnScoreboardIndex({ dates, week, seasonYear });
  log(`Scoreboard index size: ${byId.size}`);

  const out = new Map();
  const missing = [];

  for (const g of espnGames) {
    const eid = String(toInt(g.cfbd_game_id ?? g.espn_event_id));
    const hit = byId.get(eid);
    if (hit) {
      out.set(eid, hit);
    } else {
      missing.push(eid);
    }
  }

  // Also keep non-espn-id rows from scoreboard for team-id fallback matching
  for (const [id, row] of byId.entries()) {
    if (!out.has(id)) out.set(id, row);
  }

  for (const eid of missing.slice(0, 24)) {
    const row = await fetchEspnSummaryResult(eid);
    if (row) out.set(String(row.id || eid), row);
  }

  return out;
}

module.exports = {
  isEspnEventId,
  formatEspnDateFromIso,
  normalizeEspnEvent,
  fetchEspnScoreboardIndex,
  fetchEspnSummaryResult,
  fetchEspnResultsForGames,
  toInt,
};
