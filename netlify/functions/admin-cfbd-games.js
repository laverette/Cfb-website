/**
 * GET  /api/admin/cfbd-games?season_year=&week_number=&season_type=regular&classification=fbs&source=espn|auto|cfbd&refresh=1
 * POST /api/admin/cfbd-games  { source:'espn', events:[...], season_year, week_number, ... }
 *
 * Weekly Picks admin schedule loader.
 * Primary: ESPN scoreboard (calendar day-walk → week-param fallback).
 * Emergency: CFBD only when source=cfbd or source=auto and ESPN fully fails.
 *
 * ESPN often returns HTTP 403 to Netlify function egress. The admin UI then
 * fetches ESPN from the browser (CORS allows *) and POSTs events here to normalize.
 *
 * Query/body source=espn|auto|cfbd (default espn).
 * classification: fbs | fcs | ii | iii | all (default fbs)
 */
const CFBD_BASE = "https://api.collegefootballdata.com";

const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { recordApiUsage } = require("./_lib/api-usage");
const {
  getWeeklyGames,
  buildAdminPayloadFromEspnEvents,
} = require("./_lib/espn-admin-schedule");

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readSourceMode(q) {
  const raw = String(q.source || process.env.ADMIN_GAMES_SOURCE || "espn")
    .trim()
    .toLowerCase();
  if (raw === "cfbd" || raw === "espn" || raw === "auto") return raw;
  return "espn";
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
  return { map, pollName: poll.poll || null, week: weekEntry?.week ?? null };
}

async function fetchRankBySchool({ headers, year, week, seasonType }) {
  try {
    const url = `${CFBD_BASE}/rankings?year=${year}&week=${week}&seasonType=${encodeURIComponent(
      seasonType
    )}`;
    const res = await fetch(url, { headers });
    recordApiUsage({ feature: "admin-slate", source: "cfbd", calls: 1 });
    if (!res.ok) return { map: new Map(), pollName: null, week: null };
    const payload = await res.json();
    const list = Array.isArray(payload) ? payload : [];
    const weekEntry =
      list.find((w) => Number(w.week) === Number(week)) || list[0] || null;
    return ranksFromPollWeek(weekEntry);
  } catch {
    return { map: new Map(), pollName: null, week: null };
  }
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
    const err = new Error(
      `CFBD games request failed (${gamesRes.status}): ${detail.slice(0, 180)}`
    );
    err.status = gamesRes.status;
    err.detail = detail.slice(0, 800);
    throw err;
  }
  if (!teamsRes.ok) {
    const detail = await teamsRes.text();
    const err = new Error(
      `CFBD teams request failed (${teamsRes.status}): ${detail.slice(0, 180)}`
    );
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
      source: "cfbd",
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

async function loadEspnOrThrow({ year, week, seasonType, classification, refresh }) {
  return getWeeklyGames({
    year,
    week,
    seasonType,
    classification,
    refresh,
  });
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return json(204, {});
  if (method !== "GET" && method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const q = event.queryStringParameters || {};
  const body = method === "POST" ? parseJsonBody(event) || {} : {};
  const year = parseInt(body.season_year ?? body.year ?? q.season_year ?? q.year ?? "", 10);
  const week = parseInt(
    body.week_number ?? body.week ?? q.week_number ?? q.week ?? "",
    10
  );
  const seasonType = String(
    body.season_type || q.season_type || "regular"
  ).toLowerCase();
  const classification = normalizeClassification(
    body.classification || q.classification
  );
  const sourceMode = readSourceMode({ source: body.source || q.source });
  const refresh = ["1", "true", "yes"].includes(
    String(body.refresh ?? q.refresh ?? "").toLowerCase()
  );
  const apiKey = (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";

  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    return json(400, { error: "season_year and week_number are required" });
  }

  try {
    // Browser-fetched ESPN events (avoids Netlify egress 403).
    if (method === "POST" && Array.isArray(body.events)) {
      if (!body.events.length) {
        return json(400, { error: "events array is empty" });
      }
      const payload = buildAdminPayloadFromEspnEvents(body.events, {
        year,
        week,
        classification,
        via: "browser",
        meta: {
          strategy: body.strategy || "browser",
          requestRange: body.requestRange || null,
          diagnostics: body.diagnostics || null,
        },
      });
      if (!payload.games.length) {
        return json(422, {
          error: "Could not parse any games from the provided ESPN events",
          code: "ESPN_PARSE_EMPTY",
        });
      }
      return json(200, {
        ...payload,
        fallbackReason: body.fallbackReason || "Browser ESPN fetch",
        cached: false,
      });
    }

    // ESPN primary (default espn, or auto).
    if (sourceMode === "espn" || sourceMode === "auto") {
      try {
        const payload = await loadEspnOrThrow({
          year,
          week,
          seasonType,
          classification,
          refresh,
        });
        return json(200, payload);
      } catch (espnErr) {
        if (sourceMode === "espn" || !apiKey) {
          return json(espnErr.status === 403 ? 403 : 502, {
            error:
              espnErr.message ||
              "Unable to load this week's ESPN schedule.",
            status: espnErr.status || null,
            code: espnErr.code || "ESPN_FAILED",
            diagnostics: espnErr.diagnostics || null,
            hint:
              espnErr.code === "ESPN_BLOCKED"
                ? "ESPN blocked the server request. The admin UI will retry from your browser."
                : null,
          });
        }
        // auto + CFBD key: emergency CFBD after ESPN failure
        console.warn(
          "admin-cfbd-games: ESPN failed, emergency CFBD:",
          espnErr.message
        );
        try {
          const payload = await fetchCfbdWeekGames({
            apiKey,
            year,
            week,
            seasonType,
            classification,
          });
          return json(200, {
            ...payload,
            fallbackReason: espnErr.message || "ESPN unavailable",
          });
        } catch (cfbdErr) {
          return json(espnErr.status === 403 ? 403 : 502, {
            error: espnErr.message || "ESPN request failed",
            status: espnErr.status || null,
            code: espnErr.code || "ESPN_FAILED",
            diagnostics: espnErr.diagnostics || null,
            cfbdError: cfbdErr.message || null,
            hint:
              "ESPN blocked the server. The admin UI will retry the ESPN fetch from your browser.",
          });
        }
      }
    }

    if (sourceMode === "cfbd") {
      if (!apiKey) {
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
        if (!isCfbdUnavailable(cfbdErr)) {
          return json(502, {
            error: cfbdErr.message || "CFBD request failed",
            status: cfbdErr.status || null,
            detail: cfbdErr.detail || null,
          });
        }
        // Last resort: try ESPN when CFBD-only was requested but CFBD is down.
        try {
          const payload = await loadEspnOrThrow({
            year,
            week,
            seasonType,
            classification,
            refresh,
          });
          return json(200, {
            ...payload,
            fallbackReason: cfbdErr.message || "CFBD unavailable",
          });
        } catch (espnErr) {
          return json(502, {
            error: cfbdErr.message || "CFBD request failed",
            status: cfbdErr.status || null,
            espnError: espnErr.message || null,
          });
        }
      }
    }

    return json(400, { error: "Invalid source mode" });
  } catch (err) {
    console.error("admin-cfbd-games:", err);
    return json(500, {
      error: err.message || "Internal server error",
      status: err.status || null,
      code: err.code || null,
    });
  }
};
