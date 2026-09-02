/**
 * GET /api/bama/leaderboard?season=2026&team=Alabama&gameId=12345
 */
const { json } = require("./_http");
const { getLeaderboard, DEFAULT_TEAM } = require("./_lib/bama-schedule");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.CFBD_API_KEY || "";

  const q = event.queryStringParameters || {};
  const season = q.season ?? q.year ?? new Date().getFullYear();
  const team = q.team || q.school || DEFAULT_TEAM;
  const gameId =
    q.gameId != null && String(q.gameId).trim() !== ""
      ? Number(q.gameId)
      : q.cfbdGameId != null && String(q.cfbdGameId).trim() !== ""
        ? Number(q.cfbdGameId)
        : null;

  try {
    const board = await getLeaderboard({
      season,
      team,
      cfbdGameId: Number.isFinite(gameId) ? gameId : null,
      apiKey,
    });
    return json(200, board);
  } catch (err) {
    console.error("bama-schedule-leaderboard:", err);
    return json(500, {
      error: "Failed to load schedule leaderboard",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
