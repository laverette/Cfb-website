/**
 * POST /api/heisman/lock
 * Body: { season? }
 * Locks the user's current pick and freezes odds snapshot.
 */
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const { lockPick } = require("./_lib/heisman");

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
    const pick = await lockPick({
      userId,
      season: body.season ?? body.seasonYear,
    });
    return json(200, { message: "Pick locked", pick });
  } catch (err) {
    console.error("heisman-lock:", err);
    if (err.code === "LOCKED" || err.code === "NO_PICK") {
      return json(err.code === "LOCKED" ? 409 : 400, {
        error: err.message,
        code: err.code,
      });
    }
    return json(500, { error: "Failed to lock Heisman pick" });
  }
};
