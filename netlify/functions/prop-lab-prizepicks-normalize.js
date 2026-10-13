/**
 * Admin: normalize a browser-fetched PrizePicks partner-api payload and stash
 * it in Supabase for the background scorer (avoids 413 on large POSTs).
 *
 * POST {
 *   partnerPayload: { data, included },
 *   season, week,
 *   sourceUrl?
 * }
 * Auth: admin Bearer
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { loadCurrentWeek } = require("./db");
const {
  boardFromPartnerPayload,
  uniqueEvalTargets,
  DEFAULT_PARTNER_URL,
} = require("./_lib/prop-lab/data/prizepicks-mirror");
const { stashWeekBoard } = require("./_lib/prop-lab/week-board");

async function resolveSeasonWeek(body) {
  let season = Number(body.season);
  let week = Number(body.week);
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
  if (method === "OPTIONS") return json(204, {});
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = requireAdmin(event);
  if (admin) return admin;

  const body = parseJsonBody(event) || {};
  const payload = body.partnerPayload || body.payload || null;
  if (!payload || !Array.isArray(payload.data)) {
    return json(400, {
      error: "partnerPayload with JSON:API data[] is required",
    });
  }

  const { season, week } = await resolveSeasonWeek(body);
  if (!Number.isFinite(week)) {
    return json(400, { error: "week required" });
  }

  try {
    const board = boardFromPartnerPayload(payload, {
      source: "browser-partner",
      sourceUrl: body.sourceUrl || DEFAULT_PARTNER_URL,
    });
    board.props = uniqueEvalTargets(board.props);
    board.supportedCount = board.props.length;

    const stashed = await stashWeekBoard({ season, week, board });
    return json(200, {
      ok: true,
      season: stashed.season,
      week: stashed.week,
      scrapeHash: stashed.scrapeHash,
      supportedCount: stashed.supportedCount,
      source: stashed.source,
      // Do not echo full props — client only needs the job handle.
    });
  } catch (err) {
    console.error("prop-lab-prizepicks-normalize:", err);
    return json(err.code === "SCHEMA_MISSING" ? 503 : 500, {
      error: err.message || "Normalize failed",
      code: err.code || null,
    });
  }
};
