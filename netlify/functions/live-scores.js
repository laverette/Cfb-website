/**
 * GET /api/live-scores?dates=20260829,20260830
 * or ?season=2026&week=1
 *
 * Live CFB scores for the weekly picks page.
 * Prefers ESPN scoreboard (real-time), falls back to CFBD /games + /scoreboard.
 */
const { json } = require("./_http");

const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const CFBD_BASE = "https://api.collegefootballdata.com";

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

function ymdFromDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseDatesParam(q) {
  if (q.dates) {
    return String(q.dates)
      .split(",")
      .map((s) => s.trim().replace(/-/g, ""))
      .filter((s) => /^\d{8}$/.test(s));
  }
  // Default: yesterday / today / tomorrow in ET-ish window (UTC±)
  const now = new Date();
  const out = [];
  for (let i = -1; i <= 1; i += 1) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    out.push(ymdFromDate(d));
  }
  return out;
}

async function fetchJson(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...headers,
    },
  });
  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = { raw: String(text || "").slice(0, 200) };
  }
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeEspnEvent(evt) {
  const comp = Array.isArray(evt?.competitions) ? evt.competitions[0] : null;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const statusName = String(evt?.status?.type?.name || "");
  const statusState = String(evt?.status?.type?.state || "").toLowerCase();
  const detail = String(evt?.status?.type?.detail || evt?.status?.type?.shortDetail || "");
  const periodRaw = evt?.status?.period;
  const period = periodRaw == null || periodRaw === "" ? null : Number(periodRaw);
  const clock = evt?.status?.displayClock || null;
  const completed =
    statusState === "post" || /final/i.test(statusName) || /final/i.test(detail);
  const scheduled =
    statusState === "pre" ||
    /status_scheduled|scheduled|pregame|pre-game|pre game/i.test(statusName) ||
    /status_scheduled|scheduled|pregame|pre-game/i.test(detail);

  let statusRaw = statusName || detail || statusState;
  // Never label pregame as Q0 — ESPN uses period 0 before kickoff.
  if (!completed && !scheduled && statusState === "in") {
    if (Number.isFinite(period) && period > 0 && clock) statusRaw = `Q${period} ${clock}`;
    else if (/halftime/i.test(detail)) statusRaw = "Halftime";
    else if (Number.isFinite(period) && period > 0) statusRaw = `Q${period}`;
    else statusRaw = detail || "IN_PROGRESS";
  } else if (scheduled) {
    statusRaw = "SCHEDULED";
  }

  return {
    id: evt.id != null ? Number(evt.id) : null,
    source: "espn",
    awayTeam: away.team?.location || away.team?.displayName || away.team?.shortDisplayName || null,
    homeTeam: home.team?.location || home.team?.displayName || home.team?.shortDisplayName || null,
    awayEspnId: toInt(away.team?.id ?? away.id),
    homeEspnId: toInt(home.team?.id ?? home.id),
    awayPoints: toInt(away.score),
    homePoints: toInt(home.score),
    completed,
    scheduled,
    statusState,
    statusRaw,
    period: Number.isFinite(period) ? period : null,
    clock,
    startDate: evt.date || comp.date || null,
  };
}

async function fetchEspnScores(dates) {
  const byKey = new Map();
  // Current board + at most 2 date boards, in parallel (avoid slow serial loops).
  const urls = [
    `${ESPN_SB}?groups=80&limit=300`,
    ...(dates || []).slice(0, 2).map(
      (date) =>
        `${ESPN_SB}?dates=${encodeURIComponent(date)}&groups=80&limit=300`
    ),
  ];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const data = await fetchJson(url);
        const events = Array.isArray(data?.events) ? data.events : [];
        events.forEach((evt) => {
          const g = normalizeEspnEvent(evt);
          if (!g) return;
          const key =
            g.awayEspnId && g.homeEspnId
              ? `espn:${g.awayEspnId}:${g.homeEspnId}`
              : `name:${String(g.awayTeam).toLowerCase()}@${String(g.homeTeam).toLowerCase()}`;
          byKey.set(key, g);
        });
      } catch (err) {
        console.warn("espn scoreboard", err.status || err.message, url);
      }
    })
  );
  return Array.from(byKey.values());
}

function normalizeCfbdGame(g) {
  if (!g || typeof g !== "object") return null;
  if (g.homeTeam && typeof g.homeTeam === "object") {
    return {
      id: g.id != null ? Number(g.id) : null,
      source: "cfbd-scoreboard",
      awayTeam: g.awayTeam?.name || g.awayTeam?.school || null,
      homeTeam: g.homeTeam?.name || g.homeTeam?.school || null,
      awayEspnId: toInt(g.awayTeam?.id),
      homeEspnId: toInt(g.homeTeam?.id),
      awayPoints: toInt(g.awayTeam?.points),
      homePoints: toInt(g.homeTeam?.points),
      completed: /final|completed/i.test(String(g.status || "")),
      statusRaw: g.status || null,
      period: g.period ?? null,
      clock: g.clock || null,
      startDate: g.startDate || g.start_date || null,
    };
  }
  return {
    id: g.id != null ? Number(g.id) : null,
    source: "cfbd-games",
    awayTeam: g.away_team ?? g.awayTeam ?? null,
    homeTeam: g.home_team ?? g.homeTeam ?? null,
    awayEspnId: toInt(g.away_id ?? g.awayId),
    homeEspnId: toInt(g.home_id ?? g.homeId),
    awayPoints: toInt(g.away_points ?? g.awayPoints),
    homePoints: toInt(g.home_points ?? g.homePoints),
    completed: Boolean(g.completed),
    statusRaw: g.status || null,
    period: g.period ?? null,
    clock: g.clock || null,
    startDate: g.start_date ?? g.startDate ?? null,
  };
}

async function fetchCfbdScores({ season, week }) {
  const key = readCfbdKey();
  if (!key) return [];
  const headers = { Authorization: `Bearer ${key}` };
  const byId = new Map();

  if (season && week) {
    try {
      const url = `${CFBD_BASE}/games?year=${encodeURIComponent(season)}&week=${encodeURIComponent(week)}&seasonType=regular`;
      const games = await fetchJson(url, headers);
      (Array.isArray(games) ? games : []).forEach((raw) => {
        const g = normalizeCfbdGame(raw);
        if (g && Number.isFinite(g.id)) byId.set(g.id, g);
      });
    } catch (err) {
      console.warn("cfbd games", err.status || err.message);
    }
  }

  try {
    const board = await fetchJson(
      `${CFBD_BASE}/scoreboard?classification=fbs`,
      headers
    );
    (Array.isArray(board) ? board : []).forEach((raw) => {
      const g = normalizeCfbdGame(raw);
      if (!g || !Number.isFinite(g.id)) return;
      const prev = byId.get(g.id) || {};
      byId.set(g.id, { ...prev, ...g, source: g.source || prev.source });
    });
  } catch (err) {
    console.warn("cfbd scoreboard", err.status || err.message);
  }

  return Array.from(byId.values());
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const dates = parseDatesParam(q);
  const season = q.season != null && q.season !== "" ? Number(q.season) : null;
  const week = q.week != null && q.week !== "" ? Number(q.week) : null;

  try {
    const [espn, cfbd] = await Promise.all([
      fetchEspnScores(dates),
      fetchCfbdScores({
        season: Number.isFinite(season) ? season : null,
        week: Number.isFinite(week) ? week : null,
      }),
    ]);

    // Prefer ESPN rows (true live scores); keep CFBD for id/name fallbacks
    const merged = [];
    const seen = new Set();

    const push = (g) => {
      if (!g) return;
      const key =
        g.awayEspnId && g.homeEspnId
          ? `e:${g.awayEspnId}:${g.homeEspnId}`
          : g.id
            ? `c:${g.id}`
            : `n:${normName(g.awayTeam)}@${normName(g.homeTeam)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(g);
    };

    espn.forEach(push);
    cfbd.forEach((g) => {
      const hasEspn = espn.some(
        (e) =>
          (e.awayEspnId &&
            e.homeEspnId &&
            e.awayEspnId === g.awayEspnId &&
            e.homeEspnId === g.homeEspnId) ||
          (normName(e.awayTeam) === normName(g.awayTeam) &&
            normName(e.homeTeam) === normName(g.homeTeam) &&
            (e.awayPoints != null || e.homePoints != null))
      );
      if (!hasEspn) push(g);
    });

    return json(
      200,
      {
        games: merged,
        meta: {
          dates,
          season: Number.isFinite(season) ? season : null,
          week: Number.isFinite(week) ? week : null,
          espnCount: espn.length,
          cfbdCount: cfbd.length,
        },
      },
      {
        "cache-control": "public, max-age=20, s-maxage=20",
      }
    );
  } catch (err) {
    console.error("live-scores:", err);
    return json(500, {
      error: "Failed to load live scores",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
