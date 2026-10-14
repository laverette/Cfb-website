/**
 * Admin: stash a browser-normalized PrizePicks board for background scoring.
 *
 * Preferred (avoids 413): chunked slim props
 * POST {
 *   props: [...],
 *   scrapeHash, chunkIndex, chunkCount,
 *   season, week,
 *   totalProps?, scrapedAt?, scrapedDate?, source?, sourceUrl?, skipped?
 * }
 *
 * Legacy (may 413 on full partner JSON):
 * POST { partnerPayload: { data, included }, season, week, sourceUrl? }
 *
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
const {
  stashWeekBoard,
  stashWeekBoardChunk,
} = require("./_lib/prop-lab/week-board");

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
  const { season, week } = await resolveSeasonWeek(body);
  if (!Number.isFinite(week)) {
    return json(400, { error: "week required" });
  }

  try {
    // Chunked slim props from browser parse (keeps each POST tiny).
    if (Array.isArray(body.props) && body.scrapeHash) {
      const chunkCount = Math.max(1, Number(body.chunkCount) || 1);
      const chunkIndex = Math.max(0, Number(body.chunkIndex) || 0);
      const result = await stashWeekBoardChunk({
        season,
        week,
        scrapeHash: String(body.scrapeHash),
        props: body.props,
        chunkIndex,
        chunkCount,
        boardMeta: {
          totalProps: body.totalProps,
          scrapedAt: body.scrapedAt,
          scrapedDate: body.scrapedDate,
          source: body.source || "browser-partner",
          sourceUrl: body.sourceUrl || DEFAULT_PARTNER_URL,
          skipped: body.skipped || null,
        },
      });
      return json(200, {
        ok: true,
        season: result.season,
        week: result.week,
        scrapeHash: result.scrapeHash,
        supportedCount: result.supportedCount,
        complete: result.complete,
        chunkIndex: result.chunkIndex,
        chunkCount: result.chunkCount,
        source: result.source,
      });
    }

    // Legacy: full partner payload (may hit Netlify 413).
    const payload = body.partnerPayload || body.payload || null;
    if (!payload || !Array.isArray(payload.data)) {
      return json(400, {
        error: "props+scrapeHash (chunked) or partnerPayload.data[] required",
      });
    }

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
      complete: true,
      source: stashed.source,
    });
  } catch (err) {
    console.error("prop-lab-prizepicks-normalize:", err);
    return json(err.code === "SCHEMA_MISSING" ? 503 : 500, {
      error: err.message || "Normalize failed",
      code: err.code || null,
    });
  }
};
