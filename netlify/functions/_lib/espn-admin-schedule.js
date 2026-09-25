/**
 * ESPN college-football schedule for Weekly Picks admin.
 *
 * Verified against site.api.espn.com (2026):
 * - dates=YYYYMMDD-YYYYMMDD → HTTP 400 "Failed to get events endpoint."
 * - dates=YYYYMMDD&groups=80 → per-day board (union days for a week)
 * - seasontype=2&week=N&groups=80&limit=300 → full week slate in one call
 *
 * Preferred strategy: resolve ESPN calendar window → fetch each YYYYMMDD day.
 * Fallback: week + seasontype query.
 *
 * Netlify egress often receives HTTP 403 from ESPN; the admin UI can fetch in
 * the browser (CORS *) and POST events here for normalization.
 */
const { recordApiUsage } = require("./api-usage");

const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const ESPN_SB_WEB =
  "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

const FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://www.espn.com/college-football/scoreboard",
  origin: "https://www.espn.com",
};

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const scheduleCache = globalThis.__cfb_espn_admin_schedule_cache || new Map();
globalThis.__cfb_espn_admin_schedule_cache = scheduleCache;

const confNameCache = globalThis.__cfb_espn_conf_names || new Map();
globalThis.__cfb_espn_conf_names = confNameCache;

const ESPN_CONF_BY_ID = {
  "1": "ACC",
  "4": "Big 12",
  "5": "Big Ten",
  "8": "SEC",
  "9": "Pac-12",
  "12": "Conference USA",
  "15": "Mid-American",
  "17": "Mountain West",
  "18": "American Athletic",
  "37": "Sun Belt",
  "151": "FBS Independents",
  "20": "Big Sky",
  "21": "Colonial",
  "22": "Ivy",
  "24": "MEAC",
  "25": "Missouri Valley",
  "26": "Northeast",
  "27": "Ohio Valley",
  "28": "Patriot",
  "29": "Pioneer",
  "30": "Southern",
  "31": "Southland",
  "32": "SWAC",
  "48": "Big South",
  "177": "United Athletic",
  "179": "Ohio Valley",
  "211": "United Athletic",
};

const DEBUG =
  process.env.ESPN_SCHEDULE_DEBUG === "1" ||
  process.env.NODE_ENV === "development" ||
  process.env.CONTEXT === "dev";

function dataLog(...args) {
  if (DEBUG) console.log("[ESPN Schedule]", ...args);
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYYMMDD compact date ESPN expects for dates= */
function formatEspnDate(date) {
  if (date == null) return null;
  if (typeof date === "string") {
    const compact = date.replace(/-/g, "");
    if (/^\d{8}$/.test(compact)) return compact;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return formatEspnDate(d);
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${mo}${day}`;
}

function espnSeasonType(seasonType) {
  const t = String(seasonType || "regular").toLowerCase();
  if (t === "postseason" || t === "post") return 3;
  if (t === "preseason" || t === "pre") return 1;
  return 2;
}

function espnGroupsForClassification(classification) {
  if (classification === "fbs") return ["80"];
  if (classification === "fcs") return ["81"];
  if (classification == null || classification === "all") return ["80", "81"];
  return [null];
}

function shortConferenceName(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+conference$/i, "").trim();
  const map = {
    "atlantic coast": "ACC",
    acc: "ACC",
    southeastern: "SEC",
    sec: "SEC",
    "big ten": "Big Ten",
    "big 12": "Big 12",
    "big twelve": "Big 12",
    "pac-12": "Pac-12",
    pac12: "Pac-12",
    american: "American Athletic",
    "american athletic": "American Athletic",
    "conference usa": "Conference USA",
    "c-usa": "Conference USA",
    "mid-american": "Mid-American",
    mac: "Mid-American",
    "mountain west": "Mountain West",
    "sun belt": "Sun Belt",
    independent: "Independent",
    "fbs independents": "FBS Independents",
  };
  if (map[key]) return map[key];
  return raw.replace(/\s+Conference$/i, "").trim() || raw;
}

function eachYmdInclusive(startIso, endIso, maxDays = 14) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  const cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  );
  for (let i = 0; i < maxDays && cur <= last; i += 1) {
    out.push(formatEspnDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out.filter(Boolean);
}

function logoUrlForEspnTeam(team) {
  if (team?.logo) return String(team.logo);
  const href = Array.isArray(team?.logos) ? team.logos[0]?.href : null;
  if (href) return String(href);
  const id = team?.id != null ? String(team.id) : "";
  if (!id) return "";
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function schoolName(team) {
  return (
    team?.location ||
    team?.shortDisplayName ||
    team?.displayName ||
    team?.name ||
    ""
  );
}

function curatedRank(competitor) {
  const rank = numOrNull(competitor?.curatedRank?.current);
  if (rank == null || rank <= 0 || rank > 25) return null;
  return rank;
}

function pickEspnSpread(comp) {
  const odds = Array.isArray(comp?.odds) ? comp.odds : [];
  const preferred =
    odds.find((o) => /consensus/i.test(String(o.provider?.name || ""))) ||
    odds.find((o) => numOrNull(o.spread) != null) ||
    odds[0];
  return numOrNull(preferred?.spread);
}

function pickNetwork(comp) {
  const broadcasts = Array.isArray(comp?.broadcasts) ? comp.broadcasts : [];
  for (const b of broadcasts) {
    const names = Array.isArray(b?.names) ? b.names.filter(Boolean) : [];
    if (names.length) return String(names[0]);
  }
  const geo = comp?.geoBroadcasts;
  if (Array.isArray(geo) && geo[0]?.media?.shortName) {
    return String(geo[0].media.shortName);
  }
  return null;
}

function resolveConferenceNameSync(conferenceId) {
  const id = String(conferenceId || "").trim();
  if (!id) return null;
  if (confNameCache.has(id)) return confNameCache.get(id);
  if (ESPN_CONF_BY_ID[id]) {
    confNameCache.set(id, ESPN_CONF_BY_ID[id]);
    return ESPN_CONF_BY_ID[id];
  }
  return null;
}

async function fetchEspnJson(url, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    dataLog("Request URL:", url);
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal });
    recordApiUsage({ feature: "admin-slate", source: "espn", calls: 1 });
    const text = await res.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    dataLog("Status:", res.status, "events:", Array.isArray(body?.events) ? body.events.length : 0);
    return { ok: res.ok, status: res.status, body, text: text.slice(0, 200), url };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 0,
      body: null,
      text: aborted ? "timeout" : String(err?.message || err),
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEspnJsonWithRetry(url, opts) {
  let res = await fetchEspnJson(url, opts);
  if (!res.ok && [502, 503, 504, 0].includes(res.status)) {
    dataLog("Retry once after", res.status);
    res = await fetchEspnJson(url, opts);
  }
  return res;
}

/**
 * Resolve ESPN calendar start/end for a season week.
 * Returns { startDate, endDate, label, dates: YYYYMMDD[] } or null.
 */
async function resolveWeekDateRange({ year, week, seasonType }) {
  const espnType = espnSeasonType(seasonType);
  const probe = await fetchEspnJsonWithRetry(
    `${ESPN_SB}?seasontype=${espnType}&dates=${year}&groups=80&limit=1`
  );
  if (!probe.ok) {
    // Try web host once for calendar only.
    const web = await fetchEspnJsonWithRetry(
      `${ESPN_SB_WEB}?seasontype=${espnType}&dates=${year}&groups=80&limit=1`
    );
    if (!web.ok) return { window: null, probeStatus: probe.status };
    probe.body = web.body;
    probe.ok = true;
    probe.status = web.status;
  }
  const calendar = probe.body?.leagues?.[0]?.calendar;
  const buckets = Array.isArray(calendar) ? calendar : [];
  const seasonBucket =
    buckets.find((b) => String(b.value) === String(espnType)) ||
    buckets.find((b) => /regular/i.test(String(b.label || ""))) ||
    null;
  const entries = Array.isArray(seasonBucket?.entries) ? seasonBucket.entries : [];
  const entry =
    entries.find((e) => Number(e.value) === Number(week)) ||
    entries.find((e) => String(e.label || "").toLowerCase() === `week ${week}`);
  if (!entry) return { window: null, probeStatus: probe.status };
  const dates = eachYmdInclusive(entry.startDate, entry.endDate, 14);
  return {
    window: {
      startDate: entry.startDate,
      endDate: entry.endDate,
      label: entry.label || `Week ${week}`,
      dates,
    },
    probeStatus: probe.status,
  };
}

function mapEspnEventToAdminGame(evt, confById) {
  const comp = Array.isArray(evt?.competitions) ? evt.competitions[0] : null;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const homeTeam = home.team || {};
  const awayTeam = away.team || {};
  const homeId = numOrNull(homeTeam.id ?? home.id);
  const awayId = numOrNull(awayTeam.id ?? away.id);
  const homeName = schoolName(homeTeam);
  const awayName = schoolName(awayTeam);
  if (!homeName || !awayName) return null;

  const homeConfId = homeTeam.conferenceId != null ? String(homeTeam.conferenceId) : null;
  const awayConfId = awayTeam.conferenceId != null ? String(awayTeam.conferenceId) : null;
  const homeRank = curatedRank(home);
  const awayRank = curatedRank(away);
  const status = evt?.status?.type || comp?.status?.type || {};
  const completed =
    Boolean(status.completed) ||
    String(status.state || "").toLowerCase() === "post" ||
    /final/i.test(String(status.name || status.detail || ""));

  const eventId = numOrNull(evt.id);
  const kickoff = evt.date || comp.date || null;
  if (eventId == null || homeId == null || awayId == null || !kickoff) {
    if (DEBUG) {
      console.warn("[ESPN Schedule] Skipping malformed event", evt?.id, {
        homeId,
        awayId,
        kickoff,
      });
    }
    return null;
  }

  const homeScore =
    home.score != null && home.score !== "" ? numOrNull(home.score) : null;
  const awayScore =
    away.score != null && away.score !== "" ? numOrNull(away.score) : null;

  return {
    cfbd_game_id: eventId, // ESPN event id stored in existing cfbd_game_id column
    espn_event_id: eventId,
    home_team_name: homeName,
    away_team_name: awayName,
    home_team_espn_id: homeId,
    away_team_espn_id: awayId,
    home_team_logo_url: logoUrlForEspnTeam(homeTeam),
    away_team_logo_url: logoUrlForEspnTeam(awayTeam),
    home_conference: (homeConfId && confById.get(homeConfId)) || resolveConferenceNameSync(homeConfId),
    away_conference: (awayConfId && confById.get(awayConfId)) || resolveConferenceNameSync(awayConfId),
    home_classification: null,
    away_classification: null,
    home_rank: homeRank,
    away_rank: awayRank,
    has_ranked_team: homeRank != null || awayRank != null,
    game_date: kickoff,
    venue: comp.venue?.fullName != null ? String(comp.venue.fullName) : null,
    network: pickNetwork(comp),
    betting_line: pickEspnSpread(comp),
    is_completed: completed,
    home_score: homeScore,
    away_score: awayScore,
    status: completed
      ? "final"
      : String(status.state || "").toLowerCase() === "in"
        ? "in_progress"
        : /postpon/i.test(String(status.name || ""))
          ? "postponed"
          : /cancel/i.test(String(status.name || ""))
            ? "canceled"
            : "scheduled",
    source: "espn",
  };
}

function buildAdminPayloadFromEspnEvents(
  events,
  { year, week, classification, via = "server", meta = {} } = {}
) {
  const listIn = Array.isArray(events) ? events : [];
  const confById = new Map();
  for (const evt of listIn) {
    for (const c of evt?.competitions?.[0]?.competitors || []) {
      const id = c?.team?.conferenceId != null ? String(c.team.conferenceId) : null;
      if (id && !confById.has(id)) {
        confById.set(id, resolveConferenceNameSync(id));
      }
    }
  }

  const list = listIn
    .map((evt) => mapEspnEventToAdminGame(evt, confById))
    .filter(Boolean);

  list.sort((a, b) => {
    const da = a.game_date ? Date.parse(a.game_date) : 0;
    const db = b.game_date ? Date.parse(b.game_date) : 0;
    if (da !== db) return da - db;
    return String(a.away_team_name).localeCompare(String(b.away_team_name));
  });

  const conferences = [
    ...new Set(
      list
        .flatMap((g) => [g.home_conference, g.away_conference])
        .filter(Boolean)
        .map((c) => String(c))
    ),
  ].sort((a, b) => a.localeCompare(b));

  const rankedGames = list.filter((g) => g.has_ranked_team).length;

  dataLog(
    `Normalized games: ${list.length} (raw events: ${listIn.length}) via=${via}`
  );

  return {
    games: list,
    conferences,
    classification: classification || "all",
    rankings: {
      poll: "ESPN curated",
      week,
      teamsRanked: null,
      gamesWithRankedTeam: rankedGames,
    },
    linesAttached: list.filter((g) => g.betting_line != null).length,
    source: "espn",
    via,
    meta: {
      seasonYear: year,
      week,
      rawEventCount: listIn.length,
      normalizedCount: list.length,
      ...meta,
    },
  };
}

/**
 * Fetch full FBS (or other) slate for a week.
 * @param {{ year:number, week:number, seasonType?:string, classification?:string|null, refresh?:boolean }} opts
 */
async function getWeeklyGames({
  year,
  week,
  seasonType = "regular",
  classification = "fbs",
  refresh = false,
} = {}) {
  const cacheKey = `espn:${year}:${week}:${seasonType}:${classification || "all"}`;
  if (!refresh) {
    const hit = scheduleCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.payload?.games?.length) {
      dataLog("Cache hit", cacheKey, "games", hit.payload.games.length);
      return {
        ...hit.payload,
        cached: true,
        cacheAgeMs: Date.now() - hit.at,
      };
    }
  }

  const espnType = espnSeasonType(seasonType);
  const groups = espnGroupsForClassification(classification);
  const byId = new Map();
  const diagnostics = [];
  let requestRange = null;
  let strategy = null;

  function ingest(payload, { requireWeekMatch = false, label = "" } = {}) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    let added = 0;
    for (const evt of events) {
      if (requireWeekMatch) {
        const evtWeek = numOrNull(evt?.week?.number ?? payload?.week?.number);
        if (evtWeek != null && Number(evtWeek) !== Number(week)) continue;
      }
      const id = evt?.id != null ? String(evt.id) : null;
      if (!id || byId.has(id)) continue;
      byId.set(id, evt);
      added += 1;
    }
    diagnostics.push(`${label}: events=${events.length} kept=+${added}`);
    dataLog(label, `raw=${events.length}`, `kept=+${added}`, `total=${byId.size}`);
    return added;
  }

  // Strategy A (preferred): ESPN calendar window → per-day dates=YYYYMMDD
  // Note: hyphenated dates=start-end returns HTTP 400 on this endpoint.
  const { window, probeStatus } = await resolveWeekDateRange({
    year,
    week,
    seasonType,
  });
  if (window?.dates?.length) {
    requestRange = `${window.dates[0]}..${window.dates[window.dates.length - 1]} (${window.label})`;
    dataLog("Request range:", requestRange);
    for (const ymd of window.dates) {
      for (const group of groups) {
        const params = new URLSearchParams({
          dates: ymd,
          limit: "300",
        });
        if (group != null) params.set("groups", String(group));
        const url = `${ESPN_SB}?${params}`;
        const res = await fetchEspnJsonWithRetry(url);
        if (!res.ok) {
          diagnostics.push(`date(${ymd})+group(${group}): HTTP ${res.status}`);
          continue;
        }
        ingest(res.body, {
          label: `date(${ymd})+group(${group})`,
          requireWeekMatch: false,
        });
      }
    }
    if (byId.size) strategy = "calendar-days";
  } else {
    diagnostics.push(
      `calendar: week window not found (probe HTTP ${probeStatus || "?"})`
    );
  }

  // Strategy B: week + seasontype (+ dates=year for season disambiguation)
  if (!byId.size) {
    for (const group of groups) {
      const params = new URLSearchParams({
        seasontype: String(espnType),
        week: String(week),
        dates: String(year),
        limit: "300",
      });
      if (group != null) params.set("groups", String(group));
      const url = `${ESPN_SB}?${params}`;
      const res = await fetchEspnJsonWithRetry(url);
      if (!res.ok) {
        diagnostics.push(`week+dates+group(${group}): HTTP ${res.status}`);
        continue;
      }
      ingest(res.body, {
        label: `week+dates+group(${group})`,
        requireWeekMatch: true,
      });
    }
    if (byId.size) strategy = "week-param";
  }

  if (!byId.size) {
    for (const group of groups) {
      const params = new URLSearchParams({
        seasontype: String(espnType),
        week: String(week),
        limit: "300",
      });
      if (group != null) params.set("groups", String(group));
      const url = `${ESPN_SB}?${params}`;
      const res = await fetchEspnJsonWithRetry(url);
      if (!res.ok) {
        diagnostics.push(`week+group(${group}): HTTP ${res.status}`);
        continue;
      }
      ingest(res.body, {
        label: `week+group(${group})`,
        requireWeekMatch: true,
      });
    }
    if (byId.size) strategy = "week-param-noyear";
  }

  // Strategy C: web host week query (sometimes less blocked)
  if (!byId.size) {
    for (const group of groups) {
      const params = new URLSearchParams({
        seasontype: String(espnType),
        week: String(week),
        dates: String(year),
        limit: "300",
      });
      if (group != null) params.set("groups", String(group));
      const url = `${ESPN_SB_WEB}?${params}`;
      const res = await fetchEspnJsonWithRetry(url);
      if (!res.ok) {
        diagnostics.push(`web-host group(${group}): HTTP ${res.status}`);
        continue;
      }
      ingest(res.body, {
        label: `web-host group(${group})`,
        requireWeekMatch: true,
      });
    }
    if (byId.size) strategy = "web-host-week";
  }

  if (!byId.size) {
    const blocked = diagnostics.some((d) => /HTTP 403/.test(d));
    const err = new Error(
      `Unable to load this week's ESPN schedule for ${year} week ${week} (${seasonType}). Tried: ${diagnostics.join(" | ")}`
    );
    err.status = blocked ? 403 : 404;
    err.code = blocked ? "ESPN_BLOCKED" : "ESPN_EMPTY";
    err.diagnostics = diagnostics;
    throw err;
  }

  const payload = buildAdminPayloadFromEspnEvents([...byId.values()], {
    year,
    week,
    classification,
    via: "server",
    meta: {
      strategy,
      requestRange,
      diagnostics,
      cached: false,
    },
  });

  scheduleCache.set(cacheKey, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

module.exports = {
  formatEspnDate,
  resolveWeekDateRange,
  getWeeklyGames,
  buildAdminPayloadFromEspnEvents,
  mapEspnEventToAdminGame,
  ESPN_SB,
  ESPN_CONF_BY_ID,
};
