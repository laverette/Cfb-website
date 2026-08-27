/**
 * GET /api/bama/schedule?season=2026&team=Alabama
 * Returns a team's schedule + optional user predictions when authenticated.
 */
const { json } = require("./_http");
const { optionalAuth } = require("./_auth");
const { getScheduleBundle, DEFAULT_TEAM } = require("./_lib/bama-schedule");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, { error: "CFBD_API_KEY not configured" });
  }

  const q = event.queryStringParameters || {};
  const season = q.season ?? q.year ?? new Date().getFullYear();
  const team = q.team || q.school || DEFAULT_TEAM;

  const auth = optionalAuth(event);
  const userId =
    auth.payload && auth.payload.userId != null
      ? parseInt(String(auth.payload.userId), 10)
      : null;

  try {
    const bundle = await getScheduleBundle({
      season,
      team,
      userId: Number.isFinite(userId) ? userId : null,
      apiKey,
    });
    return json(200, bundle);
  } catch (err) {
    console.error("bama-schedule:", err);
    return json(500, {
      error: "Failed to load team schedule",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
