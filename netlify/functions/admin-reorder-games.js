/**
 * PUT /api/admin/games/reorder
 * Body: { week_id, game_order: [{ game_id, game_number }, ...] }
 */
const { getSupabase, dbError } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

function mapGameRow(r) {
  return {
    id: r.id,
    week_id: r.week_id,
    cfbd_game_id: r.cfbd_game_id,
    game_number: r.game_number,
    home_team_espn_id: r.home_team_espn_id,
    away_team_espn_id: r.away_team_espn_id,
    home_team_name: r.home_team_name,
    away_team_name: r.away_team_name,
    home_team_logo_url: r.home_team_logo_url,
    away_team_logo_url: r.away_team_logo_url,
    game_date: r.game_date,
    venue: r.venue,
    betting_line: r.betting_line,
    is_completed: Boolean(r.is_completed),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "PUT") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const body = parseJsonBody(event);
  if (!body || !Array.isArray(body.game_order)) {
    return json(400, { error: "Invalid body: expected { week_id, game_order: [...] }" });
  }

  const weekId = parseInt(body.week_id ?? body.weekId, 10);
  if (!Number.isFinite(weekId) || weekId < 1) {
    return json(400, { error: "Invalid week_id" });
  }

  try {
    const supabase = getSupabase();

    for (const item of body.game_order) {
      const gameId = parseInt(item.game_id ?? item.gameId, 10);
      const gameNumber = parseInt(item.game_number ?? item.gameNumber, 10);
      if (!Number.isFinite(gameId) || !Number.isFinite(gameNumber) || gameNumber < 1) {
        return json(400, { error: "Invalid game_order entry" });
      }
      const { data, error } = await supabase
        .from("games")
        .update({ game_number: gameNumber })
        .eq("id", gameId)
        .eq("week_id", weekId)
        .select("id")
        .maybeSingle();
      dbError(error);
      if (!data) {
        return json(404, { error: "Game not found for this week" });
      }
    }

    const { data: saved, error: savedErr } = await supabase
      .from("games")
      .select(
        "id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id, home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, game_date, venue, betting_line, is_completed"
      )
      .eq("week_id", weekId)
      .order("game_number", { ascending: true });
    dbError(savedErr);

    return json(200, { games: (saved || []).map(mapGameRow) });
  } catch (err) {
    console.error("admin-reorder-games:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
