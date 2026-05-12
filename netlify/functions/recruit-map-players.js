/**
 * GET /api/recruit-map/players
 * Query: team, conference, year, search, state, position, classification (recruit_type), stars,
 *   includeMissingCoords (optional: true to include rows without lat/lng — map still skips them client-side)
 * Default: only rows with latitude and longitude (200 + empty array if none).
 */
const { getPool, isMysqlConnectionLimitError } = require("./db");
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
  const lat = r.latitude != null ? safeNum(r.latitude) : null;
  const lon = r.longitude != null ? safeNum(r.longitude) : null;
  return {
    id: safeNum(r.id),
    cfbd_player_id: r.cfbd_player_id != null ? safeNum(r.cfbd_player_id) : null,
    cfbd_recruit_id: r.cfbd_recruit_id != null ? String(r.cfbd_recruit_id) : null,
    athlete_id: r.athlete_id != null ? String(r.athlete_id) : null,
    recruit_type: r.recruit_type != null ? String(r.recruit_type) : null,
    player_name: r.player_name != null ? String(r.player_name) : "",
    team: r.team != null ? String(r.team) : "",
    committed_to: r.committed_to != null ? String(r.committed_to) : null,
    school: r.school != null ? String(r.school) : null,
    team_school: r.team_school != null ? String(r.team_school) : null,
    conference: r.conference != null ? String(r.conference) : null,
    season_year: safeNum(r.season_year),
    position: r.position != null ? String(r.position) : null,
    hometown_city: r.hometown_city != null ? String(r.hometown_city) : null,
    hometown_state: r.hometown_state != null ? String(r.hometown_state) : null,
    hometown_country: r.hometown_country != null ? String(r.hometown_country) : null,
    hometown_full: r.hometown_full != null ? String(r.hometown_full) : null,
    latitude: lat,
    longitude: lon,
    stars: r.stars != null ? safeNum(r.stars) : null,
    rating: (() => {
      if (r.rating == null) return null;
      const x = Number(r.rating);
      return Number.isFinite(x) ? x : null;
    })(),
    ranking: r.ranking != null ? safeNum(r.ranking) : null,
  };
}

function buildPlayersSql(ctx) {
  const {
    includeExtendedCols,
    includeMissingCoords,
    team,
    conference,
    year,
    state,
    position,
    classification,
    stars,
    search,
  } = ctx;

  const selectList = includeExtendedCols
    ? `id, cfbd_player_id, cfbd_recruit_id, athlete_id, recruit_type,
           player_name, team, committed_to, school, team_school, conference, season_year,
           \`position\`, hometown_city, hometown_state, hometown_country, hometown_full,
           latitude, longitude, stars, rating, ranking`
    : `id, cfbd_player_id, cfbd_recruit_id, athlete_id, recruit_type,
           player_name, team, committed_to, school, season_year,
           \`position\`, hometown_city, hometown_state, hometown_country, hometown_full,
           latitude, longitude, stars, rating, ranking`;

  let sql = `SELECT ${selectList}
    FROM PlayerHometowns
    WHERE 1=1`;
  const params = [];

  if (!includeMissingCoords) {
    sql += " AND latitude IS NOT NULL AND longitude IS NOT NULL";
  }
  if (year != null) {
    sql += " AND season_year = ?";
    params.push(year);
  }
  if (team) {
    sql += " AND (team = ? OR committed_to = ? OR school = ?)";
    params.push(team, team, team);
  }
  if (conference && includeExtendedCols) {
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
  if (classification) {
    sql += " AND recruit_type = ?";
    params.push(classification);
  }
  if (stars != null) {
    sql += " AND stars = ?";
    params.push(stars);
  }
  if (search) {
    const safe = search.replace(/[%_\\]/g, "").trim();
    if (safe) {
      sql += " AND player_name LIKE ?";
      params.push("%" + safe + "%");
    }
  }

  sql += " ORDER BY player_name ASC LIMIT 5000";
  return { sql, params };
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
  const classification =
    q.classification != null ? String(q.classification).trim() : "";
  const stars = numOrNull(q.stars);
  const includeMissingCoords =
    String(q.includeMissingCoords || "").toLowerCase() === "true" ||
    String(q.includeMissingCoords || "") === "1";

  const branch = includeMissingCoords ? "all_coords_optional" : "geocoded_recruits_with_filters";
  console.error("[recruit-map-players] query params", {
    team: team || null,
    conference: conference || null,
    year: year != null ? year : null,
    search: search ? "[set]" : null,
    state: state || null,
    position: position || null,
    classification: classification || null,
    stars: stars != null ? stars : null,
    includeMissingCoords,
    branch,
  });

  const ctxBase = {
    includeMissingCoords,
    team,
    conference,
    year,
    state,
    position,
    classification,
    stars,
    search,
  };

  try {
    const pool = getPool();
    let rows;
    let lastColErr = null;
    for (const includeExtendedCols of [true, false]) {
      const { sql, params } = buildPlayersSql({ ...ctxBase, includeExtendedCols });
      try {
        const [r] = await pool.query(sql, params);
        rows = r;
        if (conference && !includeExtendedCols) {
          console.error(
            "[recruit-map-players] conference filter skipped (no conference/team_school columns in schema)"
          );
        }
        break;
      } catch (e) {
        if (
          includeExtendedCols &&
          (e.code === "ER_BAD_FIELD_ERROR" || e.code === "ER_NO_SUCH_COLUMN")
        ) {
          lastColErr = e;
          console.error("[recruit-map-players] retrying without extended columns", e.message);
          continue;
        }
        throw e;
      }
    }
    if (rows === undefined) {
      throw lastColErr || new Error("recruit-map-players: query failed");
    }
    const players = (rows || []).map(mapRowToPlayer);
    const body = { count: players.length, players };
    return json(200, body);
  } catch (err) {
    console.error("[recruit-map-players] query error", err && err.stack ? err.stack : err);
    console.error("[recruit-map-players] sql branch", branch);
    console.error("[recruit-map-players] message", err && err.message);
    if (isMysqlConnectionLimitError(err)) {
      return json(503, {
        error: "DB_CONNECTION_LIMIT",
        message:
          "Database connection limit reached. Wait a few minutes and try again.",
      });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "Recruit map is unavailable right now.",
        details: "PlayerHometowns table not found",
      });
    }
    if (err.code === "ER_BAD_FIELD_ERROR" || err.code === "ER_NO_SUCH_COLUMN") {
      return json(503, {
        error: "Recruit map is unavailable right now.",
        details:
          "Database columns missing. Run Client/sql/player_hometowns_recruiting_migration.sql",
      });
    }
    return json(500, {
      error: "Recruit map players query failed",
      details: sanitizeDbDetail(err),
    });
  }
};
