/**
 * GET /api/recruit-map/players
 * Query: team, conference, year, search, state, position
 * Returns rows with lat/lng for map markers (geocoded subset).
 */
const { getPool } = require("./db");
const { json } = require("./_http");

function numOrNull(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function safeNum(v) {
  if (v == null) return null;
  if (typeof v === "bigint") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeDbDetail(err) {
  if (!err || typeof err !== "object") return String(err);
  const msg = err.message || String(err);
  const code = err.code || err.errno;
  const sqlState = err.sqlState;
  const sqlMessage = err.sqlMessage;
  const combined = [code, sqlState, sqlMessage, msg].filter(Boolean).join(" | ");
  return combined
    .replace(/mysql:\/\/[^\s]+/gi, "[db]")
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[db]")
    .replace(/:\/\/[^\s]+@[^\s]+/g, "://[redacted]")
    .slice(0, 500);
}

function mapRowToPlayer(r) {
  return {
    id: safeNum(r.id),
    cfbd_player_id: safeNum(r.cfbd_player_id),
    player_name: r.player_name != null ? String(r.player_name) : "",
    team: r.team != null ? String(r.team) : "",
    team_school: r.team_school != null ? String(r.team_school) : null,
    conference: r.conference != null ? String(r.conference) : null,
    season_year: safeNum(r.season_year),
    position: r.position != null ? String(r.position) : null,
    hometown_city: r.hometown_city != null ? String(r.hometown_city) : null,
    hometown_state: r.hometown_state != null ? String(r.hometown_state) : null,
    hometown_full: r.hometown_full != null ? String(r.hometown_full) : null,
    latitude: r.latitude != null ? safeNum(r.latitude) : null,
    longitude: r.longitude != null ? safeNum(r.longitude) : null,
  };
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

  const branch = "geocoded_subset_with_filters";
  console.error("[recruit-map-players] query params", {
    team: team || null,
    conference: conference || null,
    year: year != null ? year : null,
    search: search ? "[set]" : null,
    state: state || null,
    position: position || null,
    branch,
  });

  let sql = `
    SELECT id, cfbd_player_id, player_name, team, team_school, conference, season_year,
           \`position\`, hometown_city, hometown_state, hometown_full, latitude, longitude
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
    sql += " AND \`position\` = ?";
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
    const players = (rows || []).map(mapRowToPlayer);
    const body = { count: players.length, players };
    try {
      return json(200, body);
    } catch (serializeErr) {
      console.error("[recruit-map-players] response serialize failed", serializeErr);
      return json(500, {
        error: "Recruit map players query failed",
        details: "Failed to build JSON response",
      });
    }
  } catch (err) {
    console.error("[recruit-map-players] query error", err && err.stack ? err.stack : err);
    console.error("[recruit-map-players] sql branch", branch);
    console.error("[recruit-map-players] message", err && err.message);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "Recruit map is unavailable right now.",
        details: "PlayerHometowns table not found",
      });
    }
    return json(500, {
      error: "Recruit map players query failed",
      details: sanitizeDbDetail(err),
    });
  }
};
