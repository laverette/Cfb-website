/**
 * DELETE /api/admin/games/:gameId (rewritten to ?gameId=:splat)
 */
const { getSupabase, dbError } = require("./db");
const { json } = require("./_http");
const { parseGameId, invalidGameIdPayload } = require("./_parseGameId");
const { requireAdmin } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "DELETE") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const gameId = parseGameId(event);
  if (gameId == null || !Number.isFinite(gameId) || gameId < 1) {
    return json(400, invalidGameIdPayload(event));
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("games")
      .delete()
      .eq("id", gameId)
      .select("id")
      .maybeSingle();
    dbError(error);
    if (!data) {
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
