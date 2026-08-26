/**
 * GET /api/bama/leaderboard?season=2026&gameId=12345
 */
const { json } = require("./_http");
const { getLeaderboard } = require("./_lib/bama-schedule");

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
  const gameId =
    q.gameId != null && String(q.gameId).trim() !== ""
      ? Number(q.gameId)
      : q.cfbdGameId != null && String(q.cfbdGameId).trim() !== ""
        ? Number(q.cfbdGameId)
        : null;

  try {
    const board = await getLeaderboard({
      season,
      cfbdGameId: Number.isFinite(gameId) ? gameId : null,
      apiKey,
    });
    return json(200, board);
  } catch (err) {
    console.error("bama-schedule-leaderboard:", err);
    return json(500, {
      error: "Failed to load Bama leaderboard",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
