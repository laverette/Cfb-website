/**
 * GET /api/admin/cfbd-games?season_year=&week_number=&season_type=regular&classification=fbs
 *
 * Primary: CFBD /games + /teams + /lines + /rankings
 * Fallback: ESPN scoreboard (when CFBD is missing, rate-limited, or source=espn)
 *
 * Query source=auto|cfbd|espn (default auto).
 * classification: fbs | fcs | ii | iii | all (default fbs)
 */
const CFBD_BASE = "https://api.collegefootballdata.com";
const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const ESPN_GROUP =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons";

const { json } = require("./_http");
const { requireAdmin } = require("./_auth");
const { recordApiUsage } = require("./_lib/api-usage");

const FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const confNameCache = globalThis.__cfb_espn_conf_names || new Map();
globalThis.__cfb_espn_conf_names = confNameCache;

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readSourceMode(q) {
  const raw = String(q.source || process.env.ADMIN_GAMES_SOURCE || "auto")
    .trim()
    .toLowerCase();
  if (raw === "cfbd" || raw === "espn" || raw === "auto") return raw;
  return "auto";
}

/** Prefer consensus, then any provider with a spread. Spread is home-team oriented. */
function pickSpreadFromLinesEntry(entry) {
  const lines = Array.isArray(entry?.lines) ? entry.lines : [];
  if (!lines.length) return null;
  const preferred =
    lines.find((l) => String(l.provider || "").toLowerCase() === "consensus") ||
    lines.find((l) => numOrNull(l.spread) != null) ||
    lines[0];
  return numOrNull(preferred?.spread);
}

function buildSpreadByGameId(linesPayload) {
  const map = new Map();
  for (const entry of Array.isArray(linesPayload) ? linesPayload : []) {
    const id = entry?.id != null ? Number(entry.id) : NaN;
    if (!Number.isFinite(id)) continue;
    const spread = pickSpreadFromLinesEntry(entry);
    if (spread != null) map.set(id, spread);
  }
  return map;
}

function normalizeClassification(raw) {
  const v = String(raw || "fbs").trim().toLowerCase();
  if (v === "all" || v === "") return null;
  if (["fbs", "fcs", "ii", "iii"].includes(v)) return v;
  return "fbs";
}

function pickPreferredPoll(polls) {
  const list = Array.isArray(polls) ? polls : [];
  return (
    list.find((p) => /ap\s*top\s*25/i.test(String(p.poll || ""))) ||
    list.find((p) => /coaches/i.test(String(p.poll || ""))) ||
    list.find((p) => /playoff/i.test(String(p.poll || ""))) ||
    list[0] ||
    null
  );
}

/** school name (lower) → rank number */
function ranksFromPollWeek(weekEntry) {
  const poll = pickPreferredPoll(weekEntry?.polls);
  const map = new Map();
  if (!poll) return { map, pollName: null, week: weekEntry?.week ?? null };
  for (const r of Array.isArray(poll.ranks) ? poll.ranks : []) {
    const school = String(r.school || "").trim();
    const rank = numOrNull(r.rank);
    if (!school || rank == null) continue;
    map.set(school.toLowerCase(), rank);
  }
  return {
    map,
    pollName: poll.poll || null,
    week: weekEntry?.week ?? null,
  };
}

async function fetchRankBySchool({ headers, year, week, seasonType }) {
  const attempts = [];
  const seen = new Set();
  const pushWeek = (w) => {
    if (!Number.isFinite(w) || w < 1 || seen.has(w)) return;
    seen.add(w);
    attempts.push(w);
  };
  pushWeek(week);
  pushWeek(week - 1);
  pushWeek(1);

  for (const w of attempts) {
    const url = `${CFBD_BASE}/rankings?year=${year}&week=${w}&seasonType=${encodeURIComponent(
      seasonType
    )}`;
    const res = await fetch(url, { headers });
    recordApiUsage({ feature: "admin-slate", source: "cfbd", calls: 1 });
    if (!res.ok) continue;
    const payload = await res.json();
    const weeks = Array.isArray(payload) ? payload : [];
    if (!weeks.length) continue;
    const parsed = ranksFromPollWeek(weeks[0]);
    if (parsed.map.size) return parsed;
  }

  const yearUrl = `${CFBD_BASE}/rankings?year=${year}&seasonType=${encodeURIComponent(
    seasonType
  )}`;
  const yearRes = await fetch(yearUrl, { headers });
  recordApiUsage({ feature: "admin-slate", source: "cfbd", calls: 1 });
  if (yearRes.ok) {
    const payload = await yearRes.json();
    const weeks = Array.isArray(payload) ? payload : [];
    for (let i = weeks.length - 1; i >= 0; i--) {
      const parsed = ranksFromPollWeek(weeks[i]);
      if (parsed.map.size) return parsed;
    }
  }

  return { map: new Map(), pollName: null, week: null };
}

function lookupRank(rankBySchool, teamName) {
  if (!teamName) return null;
  const key = String(teamName).trim().toLowerCase();
  if (!key) return null;
  if (rankBySchool.has(key)) return rankBySchool.get(key);
  return null;
}

function isCfbdUnavailable(errOrStatus) {
  const status = Number(errOrStatus?.status || errOrStatus);
  if ([429, 502, 503, 504].includes(status)) return true;
  const msg = String(errOrStatus?.message || errOrStatus || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("quota") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
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

function espnSeasonType(seasonType) {
  const t = String(seasonType || "regular").toLowerCase();
  if (t === "postseason" || t === "post") return 3;
  if (t === "preseason" || t === "pre") return 1;
  return 2;
}

function espnGroupsForClassification(classification) {
  // ESPN scoreboard group ids: 80 = FBS, 81 = FCS (approx).
  if (classification === "fbs") return ["80"];
  if (classification === "fcs") return ["81"];
  if (classification == null || classification === "all") return ["80", "81"];
  // ii / iii — try ungrouped board (may be sparse)
  return [null];
}

async function resolveConferenceName(year, conferenceId) {
  const id = String(conferenceId || "").trim();
  if (!id) return null;
  if (confNameCache.has(id)) return confNameCache.get(id);
  try {
    const url = `${ESPN_GROUP}/${year}/types/2/groups/${id}?lang=en&region=us`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) {
      confNameCache.set(id, null);
      return null;
    }
    const body = await res.json();
    const name =
      body?.name ||
      body?.shortName ||
      body?.abbreviation ||
      body?.displayName ||
      null;
    confNameCache.set(id, name);
    return name;
  } catch {
    confNameCache.set(id, null);
    return null;
  }
}

function pickEspnSpread(comp) {
  const odds = Array.isArray(comp?.odds) ? comp.odds : [];
  const preferred =
    odds.find((o) => /consensus/i.test(String(o.provider?.name || ""))) ||
    odds.find((o) => numOrNull(o.spread) != null) ||
    odds[0];
  return numOrNull(preferred?.spread);
}

function curatedRank(competitor) {
  const rank = numOrNull(competitor?.curatedRank?.current);
  if (rank == null || rank <= 0 || rank > 25) return null;
  return rank;
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
  if (eventId == null || homeId == null || awayId == null) return null;

  return {
    cfbd_game_id: eventId, // unique game key for upsert; ESPN event id when source=espn
    home_team_name: homeName,
    away_team_name: awayName,
    home_team_espn_id: homeId,
    away_team_espn_id: awayId,
    home_team_logo_url: logoUrlForEspnTeam(homeTeam),
    away_team_logo_url: logoUrlForEspnTeam(awayTeam),
    home_conference: (homeConfId && confById.get(homeConfId)) || null,
    away_conference: (awayConfId && confById.get(awayConfId)) || null,
    home_classification: null,
    away_classification: null,
    home_rank: homeRank,
    away_rank: awayRank,
    has_ranked_team: homeRank != null || awayRank != null,
    game_date: evt.date || comp.date || null,
    venue: comp.venue?.fullName != null ? String(comp.venue.fullName) : null,
    betting_line: pickEspnSpread(comp),
    is_completed: completed,
  };
}

async function fetchEspnWeekGames({ year, week, seasonType, classification }) {
  const espnType = espnSeasonType(seasonType);
  const groups = espnGroupsForClassification(classification);
  const byId = new Map();

  for (const group of groups) {
    const params = new URLSearchParams({
      seasontype: String(espnType),
      week: String(week),
      dates: String(year),
      limit: "300",
    });
    if (group != null) params.set("groups", String(group));
    const url = `${ESPN_SB}?${params}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    recordApiUsage({ feature: "admin-slate", source: "espn", calls: 1 });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`ESPN scoreboard failed (${res.status}): ${text.slice(0, 160)}`);
      err.status = res.status;
      // If one group fails, try the next; only throw if nothing loaded.
      console.warn("admin-cfbd-games ESPN:", err.message);
      continue;
    }
    const payload = await res.json();
    for (const evt of Array.isArray(payload?.events) ? payload.events : []) {
      // Keep only events for the requested week when ESPN includes extras.
      const evtWeek = numOrNull(evt?.week?.number ?? payload?.week?.number);
      if (evtWeek != null && Number(evtWeek) !== Number(week)) continue;
      byId.set(String(evt.id), evt);
    }
  }

  if (!byId.size) {
    const err = new Error("ESPN returned no games for this week");
    err.status = 404;
    throw err;
  }

  const confIds = new Set();
  for (const evt of byId.values()) {
    for (const c of evt?.competitions?.[0]?.competitors || []) {
      if (c?.team?.conferenceId != null) confIds.add(String(c.team.conferenceId));
    }
  }
  const confById = new Map();
  await Promise.all(
    [...confIds].map(async (id) => {
      confById.set(id, await resolveConferenceName(year, id));
    })
  );

  const list = [...byId.values()]
    .map((evt) => mapEspnEventToAdminGame(evt, confById))
    .filter(Boolean);

  list.sort((a, b) => {
    const da = a.game_date ? Date.parse(a.game_date) : 0;
    const db = b.game_date ? Date.parse(b.game_date) : 0;
    return da - db;
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
  };
}

async function fetchCfbdWeekGames({ apiKey, year, week, seasonType, classification }) {
  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };
  const classParam = classification
    ? `&classification=${encodeURIComponent(classification)}`
    : "";
  const gamesUrl = `${CFBD_BASE}/games?year=${year}&week=${week}&seasonType=${encodeURIComponent(
    seasonType
  )}${classParam}`;
  const teamsUrl = `${CFBD_BASE}/teams?year=${year}`;
  const linesUrl = `${CFBD_BASE}/lines?year=${year}&week=${week}&seasonType=${encodeURIComponent(
    seasonType
  )}`;

  const [gamesRes, teamsRes, linesRes, rankInfo] = await Promise.all([
    fetch(gamesUrl, { headers }),
    fetch(teamsUrl, { headers }),
    fetch(linesUrl, { headers }),
    fetchRankBySchool({ headers, year, week, seasonType }),
  ]);
  recordApiUsage({ feature: "admin-slate", source: "cfbd", calls: 3 });

  if (!gamesRes.ok) {
    const detail = await gamesRes.text();
    const err = new Error(`CFBD games request failed (${gamesRes.status}): ${detail.slice(0, 180)}`);
    err.status = gamesRes.status;
    err.detail = detail.slice(0, 800);
    throw err;
  }
  if (!teamsRes.ok) {
    const detail = await teamsRes.text();
    const err = new Error(`CFBD teams request failed (${teamsRes.status}): ${detail.slice(0, 180)}`);
    err.status = teamsRes.status;
    err.detail = detail.slice(0, 800);
    throw err;
  }

  const games = await gamesRes.json();
  const teams = await teamsRes.json();

  let spreadByGameId = new Map();
  if (linesRes.ok) {
    const linesPayload = await linesRes.json();
    spreadByGameId = buildSpreadByGameId(linesPayload);
  } else {
    console.warn("admin-cfbd-games: lines request failed", linesRes.status);
  }

  const logoByTeamId = new Map();
  for (const t of Array.isArray(teams) ? teams : []) {
    const logos = Array.isArray(t.logos) ? t.logos.filter(Boolean) : [];
    logoByTeamId.set(t.id, logos[0] || "");
  }

  const rankBySchool = rankInfo.map;

  const list = (Array.isArray(games) ? games : []).map((g) => {
    const homeId = g.homeId;
    const awayId = g.awayId;
    const cfbdId = g.id;
    const homeName = g.homeTeam || "";
    const awayName = g.awayTeam || "";
    const homeConf = g.homeConference || g.home_conference || null;
    const awayConf = g.awayConference || g.away_conference || null;
    const homeClass = g.homeClassification || g.home_classification || null;
    const awayClass = g.awayClassification || g.away_classification || null;
    const homeRank = lookupRank(rankBySchool, homeName);
    const awayRank = lookupRank(rankBySchool, awayName);
    return {
      cfbd_game_id: cfbdId,
      home_team_name: homeName,
      away_team_name: awayName,
      home_team_espn_id: homeId,
      away_team_espn_id: awayId,
      home_team_logo_url: logoByTeamId.get(homeId) || "",
      away_team_logo_url: logoByTeamId.get(awayId) || "",
      home_conference: homeConf,
      away_conference: awayConf,
      home_classification: homeClass,
      away_classification: awayClass,
      home_rank: homeRank,
      away_rank: awayRank,
      has_ranked_team: homeRank != null || awayRank != null,
      game_date: g.startDate || null,
      venue: g.venue != null ? String(g.venue) : null,
      betting_line: spreadByGameId.has(Number(cfbdId))
        ? spreadByGameId.get(Number(cfbdId))
        : null,
      is_completed: Boolean(g.completed),
    };
  });

  list.sort((a, b) => {
    const da = a.game_date ? Date.parse(a.game_date) : 0;
    const db = b.game_date ? Date.parse(b.game_date) : 0;
    return da - db;
  });

  const conferences = [
    ...new Set(
      list
        .flatMap((g) => [g.home_conference, g.away_conference])
        .filter(Boolean)
        .map((c) => String(c))
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    games: list,
    conferences,
    classification: classification || "all",
    rankings: {
      poll: rankInfo.pollName,
      week: rankInfo.week,
      teamsRanked: rankBySchool.size,
      gamesWithRankedTeam: list.filter((g) => g.has_ranked_team).length,
    },
    linesAttached: list.filter((g) => g.betting_line != null).length,
    source: "cfbd",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const q = event.queryStringParameters || {};
  const year = parseInt(q.season_year ?? q.year ?? "", 10);
  const week = parseInt(q.week_number ?? q.week ?? "", 10);
  const seasonType = (q.season_type || "regular").toLowerCase();
  const classification = normalizeClassification(q.classification);
  const sourceMode = readSourceMode(q);
  const apiKey = (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";

  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    return json(400, { error: "season_year and week_number are required" });
  }

  try {
    if (sourceMode === "espn" || (sourceMode === "auto" && !apiKey)) {
      const payload = await fetchEspnWeekGames({
        year,
        week,
        seasonType,
        classification,
      });
      return json(200, {
        ...payload,
        fallbackReason: !apiKey ? "CFBD_API_KEY not configured" : null,
      });
    }

    if (sourceMode === "cfbd" && !apiKey) {
      return json(500, { error: "CFBD API not configured" });
    }

    try {
      const payload = await fetchCfbdWeekGames({
        apiKey,
        year,
        week,
        seasonType,
        classification,
      });
      return json(200, payload);
    } catch (cfbdErr) {
      if (sourceMode === "cfbd" || !isCfbdUnavailable(cfbdErr)) {
        return json(502, {
          error: cfbdErr.message || "CFBD request failed",
          status: cfbdErr.status || null,
          detail: cfbdErr.detail || null,
        });
      }
      console.warn(
        "admin-cfbd-games: CFBD failed, falling back to ESPN:",
        cfbdErr.message
      );
      const payload = await fetchEspnWeekGames({
        year,
        week,
        seasonType,
        classification,
      });
      return json(200, {
        ...payload,
        fallbackReason: cfbdErr.message || "CFBD unavailable",
      });
    }
  } catch (err) {
    console.error("admin-cfbd-games:", err);
    return json(500, {
      error: err.message || "Internal server error",
      status: err.status || null,
    });
  }
};
