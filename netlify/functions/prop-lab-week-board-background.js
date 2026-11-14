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
const {
  runWeekBoardToCompletion,
  loadStashedBoard,
} = require("./_lib/prop-lab/week-board");

const MAX_CHAIN_DEPTH = 24;

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

function resolveSiteBase(event) {
  const proto =
    (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https")
      .toString()
      .split(",")[0]
      .trim() || "https";
  const host = (event.headers.host || event.headers.Host || "").toString();
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.SITE_URL ||
    (host ? `${proto}://${host}` : "")
  )
    .toString()
    .replace(/\/$/, "");
}

/**
 * Netlify background jobs die around 15 minutes. Re-queue ourselves so a large
 * board can finish across chained invocations without wiping progress.
 */
function kickContinueChain(event, { season, week, scrapeHash, chainDepth }) {
  const base = resolveSiteBase(event);
  if (!base || !scrapeHash) return false;
  const cronSecret = (process.env.CRON_SECRET && String(process.env.CRON_SECRET).trim()) || "";
  const url = new URL(`${base}/.netlify/functions/prop-lab-week-board-background`);
  if (cronSecret) url.searchParams.set("secret", cronSecret);
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (!cronSecret && authHeader) headers.authorization = authHeader;
  fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      season,
      week,
      scrapeHash,
      chainDepth,
      resume: true,
    }),
  }).catch((err) =>
    console.warn("prop-lab-week-board-background chain kick:", err.message || err)
  );
  return true;
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
  const chainDepth = Math.max(0, Number(body.chainDepth) || 0);
  const apiKey = readCfbdKey();
  const powerTeams = await loadPowerTeams(season);

  // Prefer stashed board handle (scrapeHash) — avoids 413 on large POST bodies.
  let board = null;
  const scrapeHash = body.scrapeHash ? String(body.scrapeHash) : "";
  if (scrapeHash) {
    board = await loadStashedBoard({ season, week, scrapeHash });
    if (!board) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "Stashed board not found — normalize/stash again before scoring",
          scrapeHash,
        }),
      };
    }
  }

  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runWeekBoardToCompletion({
          season,
          week,
          apiKey,
          powerTeams,
          // Stash already created a fresh row for this scrapeHash.
          force: board ? false : force,
          maxMs: 14 * 60 * 1000,
          board,
        });
        const hashForChain = scrapeHash || result.scrapeHash || null;
        const shouldChain =
          Boolean(result.needsContinue || (result.continue && result.status !== "complete")) &&
          Boolean(hashForChain) &&
          chainDepth < MAX_CHAIN_DEPTH &&
          Number(result.pendingRemaining) > 0;
        let chained = false;
        if (shouldChain) {
          chained = kickContinueChain(event, {
            season,
            week,
            scrapeHash: hashForChain,
            chainDepth: chainDepth + 1,
          });
        }
        console.log(
          "prop-lab-week-board-background:",
          JSON.stringify({
            status: result.status,
            complete: result.complete,
            batches: result.batchesThisRun,
            scored: result.propsScored,
            pending: result.pendingRemaining,
            cfbd: result.cfbdCallsThisRun,
            boardSource: result.boardSource || board?.source || null,
            boardProps: result.boardProps || board?.supportedCount || null,
            scrapeHash: hashForChain,
            chainDepth,
            chained,
            ms: result.ms,
          })
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            ...result,
            chainDepth,
            chained,
            picks: undefined,
            row: undefined,
          }),
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
