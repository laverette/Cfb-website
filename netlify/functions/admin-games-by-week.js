/**
 * GET /api/admin/games/week/:weekId
 * Returns saved Games rows for admin (includes cfbd_game_id, venue after migration).
 */
const { getPool } = require("./db");
const { json } = require("./_http");
const { parseWeekId, invalidWeekIdPayload } = require("./_parseWeekId");
const { requireAdmin } = require("./_auth");

function mapGameRow(r) {
  return {
    id: r.id,
    week_id: r.week_id,
    cfbd_game_id: r.cfbd_game_id != null ? r.cfbd_game_id : null,
    game_number: r.game_number,
    home_team_espn_id: r.home_team_espn_id,
    away_team_espn_id: r.away_team_espn_id,
    home_team_name: r.home_team_name,
    away_team_name: r.away_team_name,
    home_team_logo_url: r.home_team_logo_url,
    away_team_logo_url: r.away_team_logo_url,
    game_date: r.game_date,
    venue: r.venue != null ? r.venue : null,
    betting_line: r.betting_line,
    is_completed: Boolean(r.is_completed),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const weekId = parseWeekId(event);
  if (weekId == null || !Number.isFinite(weekId) || weekId < 1) {
    return json(400, invalidWeekIdPayload(event));
  }

  try {
    const pool = getPool();
    const [gameRows] = await pool.query(
      `SELECT id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id,
              home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
              game_date, venue, betting_line, is_completed
       FROM Games
       WHERE week_id = ?
       ORDER BY game_number ASC`,
      [weekId]
    );

    const games = gameRows.map(mapGameRow);
    return json(200, { games });
  } catch (err) {
    console.error("admin-games-by-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_BAD_FIELD_ERROR") {
      return json(500, {
        error: "Database migration required",
        hint: "Run Client/sql/alter_games_cfbd_venue.sql on your MySQL database.",
      });
    }
    return json(500, { error: "Internal server error" });
  }
};
