/**
 * GET /api/picks/check-submission/:weekId
 */
const { getUserWeekSubmission } = require("./db");
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
    const status = await getUserWeekSubmission(userId, weekId);
    return json(200, status);
  } catch (err) {
    console.error("picks-check-submission:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
