/**
 * Netlify Background Function — scores the full PrizePicks week board in one job.
 *
 * Platform returns 202 immediately; this handler may run up to ~15 minutes.
 * Trigger from Prop Lab (admin) when you want the board built.
 *
 * Auth: admin Bearer, or ?secret=CRON_SECRET
 */
const { parseJsonBody } = require("./_http");
const { loadCurrentWeek } = require("./db");
const { requireAdmin } = require("./_auth");
const store = require("./_lib/power/store");
const { withExecutionContext } = require("./_lib/execution-context");
const { runWeekBoardToCompletion } = require("./_lib/prop-lab/week-board");

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
  const method = (event.httpMethod || "POST").toUpperCase();
  if (method === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const qs = event.queryStringParameters || {};
  const body = method === "POST" ? parseJsonBody(event) || {} : {};
  const { season, week } = await resolveSeasonWeek(qs, body);
  if (!Number.isFinite(week)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Could not resolve current week" }),
    };
  }

  const force = qs.force === "1" || qs.force === "true" || body.force === true;
  const apiKey = readCfbdKey();
  const powerTeams = await loadPowerTeams(season);

  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runWeekBoardToCompletion({
          season,
          week,
          apiKey,
          powerTeams,
          force,
          maxMs: 14 * 60 * 1000,
        });
        console.log(
          "prop-lab-week-board-background:",
          JSON.stringify({
            status: result.status,
            complete: result.complete,
            batches: result.batchesThisRun,
            scored: result.propsScored,
            pending: result.pendingRemaining,
            cfbd: result.cfbdCallsThisRun,
            ms: result.ms,
          })
        );
        return {
          statusCode: 200,
          body: JSON.stringify({ ok: true, ...result, picks: undefined, row: undefined }),
        };
      } catch (err) {
        console.error("prop-lab-week-board-background:", err);
        return {
          statusCode: err.code === "SCHEMA_MISSING" ? 503 : 500,
          body: JSON.stringify({
            ok: false,
            error: err.message || "Internal server error",
            code: err.code || null,
          }),
        };
      }
    },
    { caller: "prop-lab-week-board" }
  );
};
