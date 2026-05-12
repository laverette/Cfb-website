/**
 * GET /api/recruit-map/stats?year=2025
 * Aggregate counts for PlayerHometowns (no row payloads).
 */
const { getPool, isMysqlConnectionLimitError } = require("./db");
const { json } = require("./_http");

function numOrNull(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function safeNum(v) {
  if (v == null) return 0;
  if (typeof v === "bigint") {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const year = numOrNull(q.year);
  if (year == null || year < 2009 || year > 2100) {
    return json(400, { error: "year query parameter is required (e.g. 2025)" });
  }

  let pool;
  try {
    pool = getPool();
    const [rows] = await pool.query(
      `SELECT
         COUNT(*) AS total_rows,
         SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS rows_with_coordinates,
         SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS rows_missing_coordinates
       FROM PlayerHometowns
       WHERE season_year = ?`,
      [year]
    );
    const r = rows && rows[0] ? rows[0] : {};
    const totalRows = safeNum(r.total_rows);
    const rowsWithCoordinates = safeNum(r.rows_with_coordinates);
    const rowsMissingCoordinates = safeNum(r.rows_missing_coordinates);
    return json(200, {
      year,
      totalRows,
      rowsWithCoordinates,
      rowsMissingCoordinates,
    });
  } catch (err) {
    console.error("recruit-map-stats:", err);
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
      return json(503, { error: "PlayerHometowns table missing" });
    }
    return json(500, { error: err.message || "Internal server error" });
  }
};
