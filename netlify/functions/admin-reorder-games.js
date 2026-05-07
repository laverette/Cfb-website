/**
 * PUT /api/admin/games/reorder
 * Body: { week_id, game_order: [{ game_id, game_number }, ...] }
 * TODO: Add admin authentication before production use.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");

exports.handler = async (event) => {
  if (event.httpMethod !== "PUT") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || !Array.isArray(body.game_order)) {
    return json(400, { error: "Invalid body: expected { week_id, game_order: [...] }" });
  }

  const weekId = parseInt(body.week_id ?? body.weekId, 10);
  if (!Number.isFinite(weekId) || weekId < 1) {
    return json(400, { error: "Invalid week_id" });
  }

  let conn;
  try {
    const pool = getPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const item of body.game_order) {
      const gameId = parseInt(item.game_id ?? item.gameId, 10);
      const gameNumber = parseInt(item.game_number ?? item.gameNumber, 10);
      if (!Number.isFinite(gameId) || !Number.isFinite(gameNumber) || gameNumber < 1) {
        throw new Error("INVALID_ORDER");
      }
      const [r] = await conn.query(
        "UPDATE Games SET game_number = ? WHERE id = ? AND week_id = ?",
        [gameNumber, gameId, weekId]
      );
      if (r.affectedRows === 0) {
        throw new Error("GAME_NOT_FOUND");
      }
    }

    await conn.commit();

    const [saved] = await pool.query(
      `SELECT id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id,
              home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
              game_date, venue, betting_line, is_completed
       FROM Games WHERE week_id = ? ORDER BY game_number ASC`,
      [weekId]
    );

    const games = saved.map((r) => ({
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
    }));

    return json(200, { games });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        /* ignore */
      }
    }
    console.error("admin-reorder-games:", err);
    if (err.message === "INVALID_ORDER") {
      return json(400, { error: "Invalid game_order entry" });
    }
    if (err.message === "GAME_NOT_FOUND") {
      return json(404, { error: "Game not found for this week" });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_BAD_FIELD_ERROR") {
      return json(500, {
        error: "Database migration required",
        hint: "Run Client/sql/alter_games_cfbd_venue.sql if cfbd_game_id/venue columns are missing.",
      });
    }
    return json(500, { error: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};
