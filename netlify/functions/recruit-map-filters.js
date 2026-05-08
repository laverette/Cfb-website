/**
 * GET /api/recruit-map/filters
 * Distinct filter values from PlayerHometowns.
 */
const { getPool } = require("./db");
const { json } = require("./_http");

async function distinctColumn(pool, column) {
  const [rows] = await pool.query(
    `SELECT DISTINCT ${column} AS v FROM PlayerHometowns WHERE ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY v ASC`
  );
  return rows.map((r) => r.v).filter(Boolean);
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const pool = getPool();
    const [teams, conferences, years, states, positions] = await Promise.all([
      distinctColumn(pool, "team"),
      distinctColumn(pool, "conference"),
      (async () => {
        const [y] = await pool.query(
          `SELECT DISTINCT season_year AS v FROM PlayerHometowns ORDER BY v DESC`
        );
        return y.map((r) => r.v).filter((v) => v != null);
      })(),
      distinctColumn(pool, "hometown_state"),
      distinctColumn(pool, "position"),
    ]);

    return json(200, {
      teams,
      conferences,
      years,
      states,
      positions,
    });
  } catch (err) {
    console.error("recruit-map-filters:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(200, {
        teams: [],
        conferences: [],
        years: [],
        states: [],
        positions: [],
        hint: "Run Client/sql/player_hometowns.sql then admin sync.",
      });
    }
    return json(500, { error: "Internal server error" });
  }
};
