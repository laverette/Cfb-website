/**
 * POST /api/admin/games/save-week-games
 * Upserts games by (week_id, cfbd_game_id).
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

  try {
    const supabase = getSupabase();
    const { data: weekCheck, error: weekErr } = await supabase
      .from("weeks")
      .select("id")
      .eq("id", weekId)
      .maybeSingle();
    dbError(weekErr);
    if (!weekCheck) {
      return json(404, { error: "Week not found" });
    }

    const rows = [];
    for (const g of games) {
      const cfbdId = parseInt(g.cfbd_game_id ?? g.cfbdGameId, 10);
      const gameNumber = parseInt(g.game_number ?? g.gameNumber, 10);
      const homeEspn = parseInt(g.home_team_espn_id ?? g.homeTeamEspnId, 10);
      const awayEspn = parseInt(g.away_team_espn_id ?? g.awayTeamEspnId, 10);
      if (!Number.isFinite(gameNumber) || gameNumber < 1) {
        return json(400, { error: "Each game must have a valid game_number" });
      }
      if (!Number.isFinite(homeEspn) || !Number.isFinite(awayEspn)) {
        return json(400, { error: "Each game must have home_team_espn_id and away_team_espn_id" });
      }

      rows.push({
        week_id: weekId,
        cfbd_game_id: cfbdId,
        game_number: gameNumber,
        home_team_espn_id: homeEspn,
        away_team_espn_id: awayEspn,
        home_team_name: String(g.home_team_name ?? g.homeTeamName ?? ""),
        away_team_name: String(g.away_team_name ?? g.awayTeamName ?? ""),
        home_team_logo_url: g.home_team_logo_url ?? g.homeTeamLogoUrl ?? null,
        away_team_logo_url: g.away_team_logo_url ?? g.awayTeamLogoUrl ?? null,
        game_date: g.game_date ?? g.gameDate ?? null,
        venue: g.venue ?? null,
        betting_line:
          g.betting_line !== undefined && g.betting_line !== null
            ? g.betting_line
            : g.bettingLine !== undefined && g.bettingLine !== null
              ? g.bettingLine
              : null,
        is_completed: Boolean(g.is_completed ?? g.isCompleted ?? false),
      });
    }

    const { error: upsertErr } = await supabase
      .from("games")
      .upsert(rows, { onConflict: "week_id,cfbd_game_id" });
    dbError(upsertErr);

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
    console.error("admin-save-week-games:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, {
      error: "Internal server error",
      detail: err.message || String(err),
      code: err.code || null,
      hint: err.hint || null,
    });
  }
};
