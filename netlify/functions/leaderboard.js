/**
 * GET /api/leaderboard?scope=all|season|year&year=2026
 */
const { json } = require("./_http");
const { getLeaderboard } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const scopeRaw = String(q.scope || "all").toLowerCase();
  const scope =
    scopeRaw === "season" || scopeRaw === "year" || scopeRaw === "all"
      ? scopeRaw
      : "all";
  const year =
    q.year != null && String(q.year).trim() !== ""
      ? Number(q.year)
      : null;

  try {
    const board = await getLeaderboard({
      scope,
      year: Number.isFinite(year) ? year : null,
    });
    return json(200, board);
  } catch (err) {
    console.error("leaderboard:", err);
    return json(500, {
      error: "Failed to load leaderboard",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
