/**
 * POST /api/admin/games/save-week-games
 * Upserts games by (week_id, cfbd_game_id). Requires migration idx_games_week_cfbd.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const body = parseJsonBody(event);
  if (!body || !Array.isArray(body.games)) {
    return json(400, { error: "Invalid body: expected { week_id, games: [...] }" });
  }

  const weekId = parseInt(body.week_id ?? body.weekId, 10);
  if (!Number.isFinite(weekId) || weekId < 1) {
    return json(400, { error: "Invalid week_id" });
  }

  const games = body.games;
  for (const g of games) {
    const cfbd = g.cfbd_game_id ?? g.cfbdGameId;
    if (cfbd == null || !Number.isFinite(Number(cfbd))) {
      return json(400, { error: "Each game must include cfbd_game_id" });
    }
  }

  let conn;
  try {
    const pool = getPool();
    const [weekCheck] = await pool.query("SELECT id FROM Weeks WHERE id = ? LIMIT 1", [weekId]);
    if (!weekCheck.length) {
      return json(404, { error: "Week not found" });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const sql = `
      INSERT INTO Games (
        week_id, cfbd_game_id, game_number,
        home_team_espn_id, away_team_espn_id,
        home_team_name, away_team_name,
        home_team_logo_url, away_team_logo_url,
        game_date, venue, betting_line, is_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        game_number = VALUES(game_number),
        home_team_espn_id = VALUES(home_team_espn_id),
        away_team_espn_id = VALUES(away_team_espn_id),
        home_team_name = VALUES(home_team_name),
        away_team_name = VALUES(away_team_name),
        home_team_logo_url = VALUES(home_team_logo_url),
        away_team_logo_url = VALUES(away_team_logo_url),
        game_date = VALUES(game_date),
        venue = VALUES(venue),
        betting_line = VALUES(betting_line),
        is_completed = VALUES(is_completed)
    `;

    for (const g of games) {
      const cfbdId = parseInt(g.cfbd_game_id ?? g.cfbdGameId, 10);
      const gameNumber = parseInt(g.game_number ?? g.gameNumber, 10);
      const homeEspn = parseInt(g.home_team_espn_id ?? g.homeTeamEspnId, 10);
      const awayEspn = parseInt(g.away_team_espn_id ?? g.awayTeamEspnId, 10);
      if (!Number.isFinite(gameNumber) || gameNumber < 1) {
        throw new Error("INVALID_GAME_NUMBER");
      }
      if (!Number.isFinite(homeEspn) || !Number.isFinite(awayEspn)) {
        throw new Error("INVALID_TEAM_IDS");
      }

      const homeName = String(g.home_team_name ?? g.homeTeamName ?? "");
      const awayName = String(g.away_team_name ?? g.awayTeamName ?? "");
      const homeLogo = g.home_team_logo_url ?? g.homeTeamLogoUrl ?? null;
      const awayLogo = g.away_team_logo_url ?? g.awayTeamLogoUrl ?? null;
      const gameDate = g.game_date ?? g.gameDate ?? null;
      const venue = g.venue ?? null;
      const bettingLine =
        g.betting_line !== undefined && g.betting_line !== null
          ? g.betting_line
          : g.bettingLine !== undefined && g.bettingLine !== null
            ? g.bettingLine
            : null;
      const isCompleted = Boolean(g.is_completed ?? g.isCompleted ?? false);

      await conn.query(sql, [
        weekId,
        cfbdId,
        gameNumber,
        homeEspn,
        awayEspn,
        homeName,
        awayName,
        homeLogo,
        awayLogo,
        gameDate ? new Date(gameDate) : null,
        venue,
        bettingLine,
        isCompleted,
      ]);
    }

    await conn.commit();

    const [saved] = await pool.query(
      `SELECT id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id,
              home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
              game_date, venue, betting_line, is_completed
       FROM Games WHERE week_id = ? ORDER BY game_number ASC`,
      [weekId]
    );

    const out = saved.map((r) => ({
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

    return json(200, { games: out });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        /* ignore */
      }
    }
    console.error("admin-save-week-games:", err);
    if (err.message === "INVALID_GAME_NUMBER") {
      return json(400, { error: "Each game must have a valid game_number" });
    }
    if (err.message === "INVALID_TEAM_IDS") {
      return json(400, { error: "Each game must have home_team_espn_id and away_team_espn_id" });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_BAD_FIELD_ERROR" || err.code === "ER_DUP_ENTRY") {
      return json(500, {
        error: "Database migration or constraint issue",
        hint: "Run Client/sql/alter_games_cfbd_venue.sql and ensure unique (week_id, cfbd_game_id).",
      });
    }
    return json(500, { error: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};
