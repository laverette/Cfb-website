/**
 * POST /api/bama/submit
 * Body: { season, team, picks: [{ cfbdGameId, predictedTeamWin, predictedTeamScore, predictedOpponentScore }] }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const { submitPredictions, DEFAULT_TEAM } = require("./_lib/bama-schedule");

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

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, { error: "CFBD_API_KEY not configured" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  const season = body.season ?? body.seasonYear ?? new Date().getFullYear();
  const team = body.team || body.school || DEFAULT_TEAM;
  const picks = Array.isArray(body.picks) ? body.picks : [];

  try {
    const result = await submitPredictions({ userId, season, team, picks, apiKey });
    return json(200, {
      message: "Predictions saved",
      ...result,
    });
  } catch (err) {
    console.error("bama-schedule-submit:", err);
    if (err.code === "GAMES_LOCKED") {
      return json(400, { message: err.message, code: err.code });
    }
    if (err.code === "INVALID_SCORES" || err.code === "NO_PICKS" || err.code === "NO_VALID_PICKS" || err.code === "SCHEMA_NEEDS_TEAM") {
      return json(400, { message: err.message, code: err.code });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  }
};
