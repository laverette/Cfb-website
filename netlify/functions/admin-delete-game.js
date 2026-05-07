/**
 * DELETE /api/admin/games/:gameId
 * TODO: Add admin authentication before production use.
 */
const { getPool } = require("./db");
const { json } = require("./_http");

exports.handler = async (event) => {
  if (event.httpMethod !== "DELETE") {
    return json(405, { error: "Method not allowed" });
  }

  const rawId = event.queryStringParameters?.gameId;
  const idStr = rawId != null ? String(rawId).trim() : "";
  if (!idStr || !/^\d+$/.test(idStr)) {
    return json(400, { error: "Invalid gameId" });
  }
  const gameId = parseInt(idStr, 10);

  try {
    const pool = getPool();
    const [r] = await pool.query("DELETE FROM Games WHERE id = ?", [gameId]);
    if (r.affectedRows === 0) {
      return json(404, { error: "Game not found" });
    }
    return json(200, { ok: true, deletedId: gameId });
  } catch (err) {
    console.error("admin-delete-game:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
