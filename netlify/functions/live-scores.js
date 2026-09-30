/**
 * GET /api/live-scores?dates=20260829,20260830
 * or ?season=2026&week=1
 *
 * Live CFB scores for the weekly picks page.
 * ESPN ONLY — never calls CollegeFootballData (polling-safe).
 */
const { json } = require("./_http");
const { scheduleGradeFromLiveGames } = require("./_lib/grade-picks");
const { withExecutionContext } = require("./_lib/execution-context");

const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

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

function liveScoreKey(g) {
  const a = normName(g?.awayTeam);
  const h = normName(g?.homeTeam);
  if (a && h) {
    return a < h ? `n:${a}|${h}` : `n:${h}|${a}`;
  }
  if (g?.awayEspnId && g?.homeEspnId) {
    const ae = Number(g.awayEspnId);
    const he = Number(g.homeEspnId);
    return ae < he ? `e:${ae}:${he}` : `e:${he}:${ae}`;
  }
  if (g?.id) return `c:${g.id}`;
  return `n:${a}@${h}`;
}

function preferLiveScore(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (g) => {
    const period = Number(g.period);
    const hasPoints = g.awayPoints != null || g.homePoints != null;
    const inPlay =
      g.completed ||
      g.statusState === "in" ||
      (Number.isFinite(period) && period > 0) ||
      /final|in_progress|live|halftime/i.test(String(g.statusRaw || ""));
    return (
      (g.completed ? 16 : 0) +
      (inPlay && hasPoints ? 8 : 0) +
      (hasPoints ? 4 : 0) +
      (Number.isFinite(period) && period > 0 ? 2 : 0) +
      (g.source === "espn" ? 1 : 0)
    );
  };
  return score(b) > score(a) ? b : a;
}

async function fetchEspnScores(dates) {
  const byKey = new Map();
  const uniqueDates = [...new Set((dates || []).filter((d) => /^\d{8}$/.test(String(d))))].slice(
    0,
    7
  );
  const urls = [
    `${ESPN_SB}?groups=80&limit=300`,
    ...uniqueDates.map(
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
          const key = liveScoreKey(g);
          byKey.set(key, preferLiveScore(byKey.get(key), g));
        });
      } catch (err) {
        console.warn("espn scoreboard", err.status || err.message, url);
      }
    })
  );
  return Array.from(byKey.values());
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const dates = parseDatesParam(q);
  const season = q.season != null && q.season !== "" ? Number(q.season) : null;
  const week = q.week != null && q.week !== "" ? Number(q.week) : null;

  // Live scores + inline grading are unattended/polling-safe → background context
  // so any accidental CFBD import is structurally blocked.
  return withExecutionContext(
    "background",
    async () => {
      try {
        const espn = await fetchEspnScores(dates);
        const merged = espn;

        const skipGrade =
          q.lite === "1" ||
          q.lite === "true" ||
          q.skipGrade === "1" ||
          q.skipGrade === "true";

        if (!skipGrade) {
          try {
            await Promise.race([
              scheduleGradeFromLiveGames(merged),
              new Promise((resolve) => setTimeout(resolve, 20_000)),
            ]);
          } catch (err) {
            console.warn("live-scores grade:", err.message || err);
          }
        }

        return json(
          200,
          {
            games: merged,
            espn,
            cfbd: [],
            meta: {
              dates,
              season: Number.isFinite(season) ? season : null,
              week: Number.isFinite(week) ? week : null,
              espnCount: espn.length,
              cfbdCount: 0,
              cfbdDisabled: true,
              graded: !skipGrade,
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
    },
    { caller: "live-scores" }
  );
};
