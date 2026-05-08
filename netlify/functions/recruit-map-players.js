/**
 * GET /api/recruit-map/players
 * Query: team, conference, year, search, state, position
 * Returns rows with lat/lng for map markers.
 */
const { getPool } = require("./db");
const { json } = require("./_http");

function numOrNull(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const team = q.team != null ? String(q.team).trim() : "";
  const conference = q.conference != null ? String(q.conference).trim() : "";
  const year = numOrNull(q.year);
  const search = q.search != null ? String(q.search).trim() : "";
  const state = q.state != null ? String(q.state).trim() : "";
  const position = q.position != null ? String(q.position).trim() : "";

  let sql = `
    SELECT id, cfbd_player_id, player_name, team, team_school, conference, season_year,
           position, hometown_city, hometown_state, hometown_full, latitude, longitude
    FROM PlayerHometowns
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  `;
  const params = [];

  if (year != null) {
    sql += " AND season_year = ?";
    params.push(year);
  }
  if (team) {
    sql += " AND (team = ? OR team_school = ?)";
    params.push(team, team);
  }
  if (conference) {
    sql += " AND conference = ?";
    params.push(conference);
  }
  if (state) {
    sql += " AND hometown_state = ?";
    params.push(state);
  }
  if (position) {
    sql += " AND position = ?";
    params.push(position);
  }
  if (search) {
    const safe = search.replace(/[%_\\]/g, "").trim();
    if (safe) {
      sql += " AND player_name LIKE ?";
      params.push("%" + safe + "%");
    }
  }

  sql += " ORDER BY player_name ASC LIMIT 5000";

  try {
    const pool = getPool();
    const [rows] = await pool.query(sql, params);
    const players = rows.map((r) => ({
      id: r.id,
      cfbd_player_id: r.cfbd_player_id,
      player_name: r.player_name,
      team: r.team,
      team_school: r.team_school,
      conference: r.conference,
      season_year: r.season_year,
      position: r.position,
      hometown_city: r.hometown_city,
      hometown_state: r.hometown_state,
      hometown_full: r.hometown_full,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
    }));
    return json(200, { count: players.length, players });
  } catch (err) {
    console.error("recruit-map-players:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "Recruit map table missing",
        hint: "Run Client/sql/player_hometowns.sql on your MySQL database.",
      });
    }
    return json(500, { error: "Internal server error" });
  }
};
