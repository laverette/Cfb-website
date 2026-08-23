/**
 * POST /api/picks/submit
 * Body: { weekId, picks: [{ gameId?, gameNumber?, pickedTeamEspnId }] }
 * One submission per user per week. Updates are rejected.
 */
const { submitUserPicks } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");

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

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  const weekId = parseInt(String(body.weekId ?? body.week_id ?? ""), 10);
  if (!Number.isFinite(weekId) || weekId < 1) {
    return json(400, { message: "weekId is required" });
  }

  const picks = Array.isArray(body.picks) ? body.picks : [];
  if (!picks.length) {
    return json(400, { message: "picks are required" });
  }

  try {
    const result = await submitUserPicks({ userId, weekId, picks });
    return json(200, {
      message: "Picks submitted successfully",
      saved: result.saved,
      errors: 0,
    });
  } catch (err) {
    console.error("picks-submit:", err);
    if (err.code === "ALREADY_SUBMITTED") {
      return json(400, {
        message: "You have already submitted picks for this week. Only one submission per week is allowed.",
        code: "ALREADY_SUBMITTED",
      });
    }
    if (err.code === "INCOMPLETE_PICKS" || err.code === "NO_GAMES") {
      return json(400, { message: err.message, code: err.code });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  }
};
