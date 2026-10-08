/**
 * Manual / diagnostic week-board scorer (short sync run).
 *
 * Prefer prop-lab-week-board-background for a full one-shot score when you
 * decide to build the Friday board. This sync endpoint scores one time-boxed
 * chunk for debugging.
 *
 * Auth: admin Bearer, or ?secret=CRON_SECRET
 */
const { json, parseJsonBody } = require("./_http");
const { loadCurrentWeek } = require("./db");
const { requireAdmin } = require("./_auth");
const store = require("./_lib/power/store");
const { withExecutionContext } = require("./_lib/execution-context");
const {
  runWeekBoardBatch,
  getLatestWeekPicks,
  publicWeekPicksView,
} = require("./_lib/prop-lab/week-board");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

function isAuthorized(event) {
  const cronSecret = (process.env.CRON_SECRET && String(process.env.CRON_SECRET).trim()) || "";
  const qs = event.queryStringParameters || {};
  if (cronSecret && qs.secret === cronSecret) return true;
  const admin = requireAdmin(event);
  return !admin;
}

async function loadPowerTeams(season) {
  if (!store.hasSupabase()) return [];
  try {
    const snap = await store.loadLatestRatings({
      season: Number.isFinite(season) ? season : null,
      week: null,
    });
    return Array.isArray(snap?.teams) ? snap.teams : [];
  } catch {
    return [];
  }
}

async function resolveSeasonWeek(qs, body) {
  let season = Number(body.season || qs.season || qs.year);
  let week = Number(body.week || qs.week || qs.weekNumber);
  if (!Number.isFinite(season) || !Number.isFinite(week)) {
    try {
      const cur = await loadCurrentWeek();
      if (!Number.isFinite(season)) season = Number(cur?.season_year) || new Date().getFullYear();
      if (!Number.isFinite(week)) week = Number(cur?.week_number);
    } catch {
      /* ignore */
    }
  }
  if (!Number.isFinite(season)) season = new Date().getFullYear();
  return { season, week };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return json(204, {});

  const qs = event.queryStringParameters || {};
  const body = method === "POST" ? parseJsonBody(event) || {} : {};

  if (qs.action === "latest" || body.action === "latest") {
    const row = await getLatestWeekPicks({
      season: Number.isFinite(Number(qs.season)) ? Number(qs.season) : undefined,
      week: Number.isFinite(Number(qs.week)) ? Number(qs.week) : undefined,
    });
    return json(200, { picks: publicWeekPicksView(row) });
  }

  if (!isAuthorized(event)) {
    return json(401, { error: "Unauthorized" });
  }

  const { season, week } = await resolveSeasonWeek(qs, body);
  if (!Number.isFinite(week)) {
    return json(400, { error: "Could not resolve current week" });
  }

  const force = qs.force === "1" || qs.force === "true" || body.force === true;
  const apiKey = readCfbdKey();
  const powerTeams = await loadPowerTeams(season);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 24_000);

  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runWeekBoardBatch({
          season,
          week,
          apiKey,
          powerTeams,
          signal: controller.signal,
          force,
        });
        return json(200, result);
      } catch (err) {
        console.error("prop-lab-week-board:", err);
        return json(err.code === "SCHEMA_MISSING" ? 503 : 500, {
          ok: false,
          error: err.message || "Internal server error",
          code: err.code || null,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    { caller: "prop-lab-week-board" }
  );
};
