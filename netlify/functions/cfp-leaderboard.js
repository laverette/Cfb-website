/**
 * GET /api/cfp/leaderboard?season=2026
 */
const { json } = require("./_http");
const { getLeaderboard, normalizeSeason } = require("./_lib/cfp-brackets");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  try {
    const board = await getLeaderboard(normalizeSeason(q.season ?? q.year));
    return json(200, board);
  } catch (err) {
    console.error("cfp-leaderboard:", err);
    return json(500, {
      error: "Failed to load CFP leaderboard",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
