/**
 * POST /api/heisman/pick
 * Body: { playerKey, season? }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const { savePick } = require("./_lib/heisman");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  const body = parseJsonBody(event) || {};
  try {
    const pick = await savePick({
      userId,
      season: body.season ?? body.seasonYear,
      playerKey: body.playerKey ?? body.player_key ?? body.id,
    });
    return json(200, { message: "Pick saved", pick });
  } catch (err) {
    console.error("heisman-pick:", err);
    if (err.code === "LOCKED") return json(409, { error: err.message, code: err.code });
    if (err.code === "NOT_ON_BOARD" || err.code === "BAD_REQUEST") {
      return json(400, { error: err.message, code: err.code });
    }
    return json(500, { error: "Failed to save Heisman pick" });
  }
};
