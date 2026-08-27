/**
 * POST /api/cfp/bracket  — save (auth)
 * DELETE /api/cfp/bracket?season=2026 — reset saved (auth)
 */
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const { saveBracket, deleteBracket, normalizeSeason } = require("./_lib/cfp-brackets");

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  if (event.httpMethod === "DELETE") {
    const q = event.queryStringParameters || {};
    try {
      const result = await deleteBracket({
        userId,
        season: q.season ?? q.year,
      });
      return json(200, { message: "Bracket deleted", ...result });
    } catch (err) {
      console.error("cfp-bracket-save delete:", err);
      return json(500, { message: "Failed to delete bracket" });
    }
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  try {
    const bracket = await saveBracket({
      userId,
      season: body.season ?? body.seasonYear,
      teams: body.teams,
      slots: body.slots,
      picks: body.picks,
    });
    return json(200, { message: "Bracket saved", bracket });
  } catch (err) {
    console.error("cfp-bracket-save:", err);
    if (err.code === "INCOMPLETE_SEEDS") {
      return json(400, { message: err.message, code: err.code });
    }
    return json(500, { message: "Failed to save bracket" });
  }
};
