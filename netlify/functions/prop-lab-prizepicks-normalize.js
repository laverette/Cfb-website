/**
 * Admin: normalize a browser-fetched PrizePicks partner-api payload into a
 * slim week-board prop list. Used when Netlify egress cannot reach PrizePicks.
 *
 * POST { partnerPayload: { data, included, ... } }
 * Auth: admin Bearer
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const {
  boardFromPartnerPayload,
  uniqueEvalTargets,
  DEFAULT_PARTNER_URL,
} = require("./_lib/prop-lab/data/prizepicks-mirror");

exports.handler = async (event) => {
  const method = (event.httpMethod || "POST").toUpperCase();
  if (method === "OPTIONS") return json(204, {});
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = requireAdmin(event);
  if (admin) return admin;

  const body = parseJsonBody(event) || {};
  const payload = body.partnerPayload || body.payload || body;
  if (!payload || !Array.isArray(payload.data)) {
    return json(400, {
      error: "partnerPayload with JSON:API data[] is required",
    });
  }

  try {
    const board = boardFromPartnerPayload(payload, {
      source: "browser-partner",
      sourceUrl: body.sourceUrl || DEFAULT_PARTNER_URL,
    });
    const props = uniqueEvalTargets(board.props);
    return json(200, {
      ok: true,
      board: {
        ...board,
        props,
        supportedCount: props.length,
      },
    });
  } catch (err) {
    console.error("prop-lab-prizepicks-normalize:", err);
    return json(500, { error: err.message || "Normalize failed" });
  }
};
