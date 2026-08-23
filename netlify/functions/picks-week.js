/**
 * GET /api/picks/week/:weekId — the logged-in user's picks for that week
 */
const { getUserPicksForWeek } = require("./db");
const { json } = require("./_http");
const { requireAuth } = require("./_auth");
const { parseWeekId, invalidWeekIdPayload } = require("./_parseWeekId");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const weekId = parseWeekId(event);
  if (weekId == null) {
    return json(400, invalidWeekIdPayload(event));
  }

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  try {
    const picks = await getUserPicksForWeek(userId, weekId);
    return json(200, { picks });
  } catch (err) {
    console.error("picks-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
