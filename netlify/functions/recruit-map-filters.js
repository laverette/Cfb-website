/**
 * GET /api/recruit-map/filters
 * Distinct filter values from PlayerHometowns.
 */
const { getPool, isMysqlConnectionLimitError } = require("./db");
const { json } = require("./_http");

function sqlIdent(column) {
  const c = String(column).replace(/`/g, "");
  return `\`${c}\``;
}

function normalizeFilterScalar(v) {
  if (v == null) return null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  return v;
}

async function distinctColumn(pool, column) {
  const col = sqlIdent(column);
  const [rows] = await pool.query(
    `SELECT DISTINCT ${col} AS v FROM PlayerHometowns WHERE ${col} IS NOT NULL AND TRIM(${col}) <> '' ORDER BY v ASC`
  );
  return rows
    .map((r) => normalizeFilterScalar(r.v))
    .filter((v) => v != null && String(v).trim() !== "");
}

async function safeDistinct(pool, column) {
  try {
    return await distinctColumn(pool, column);
  } catch (err) {
    console.error("[recruit-map-filters] distinct failed", column, err && err.message);
    return [];
  }
}

async function distinctStars(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT stars AS v FROM PlayerHometowns WHERE stars IS NOT NULL ORDER BY stars DESC`
    );
    return rows
      .map((r) => normalizeFilterScalar(r.v))
      .filter((v) => v != null);
  } catch (err) {
    console.error("[recruit-map-filters] distinct stars", err && err.message);
    return [];
  }
}

async function distinctTeamLikeValues(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT v FROM (
         SELECT TRIM(team) AS v FROM PlayerHometowns
           WHERE team IS NOT NULL AND TRIM(team) <> ''
         UNION
         SELECT TRIM(committed_to) AS v FROM PlayerHometowns
           WHERE committed_to IS NOT NULL AND TRIM(committed_to) <> ''
         UNION
         SELECT TRIM(school) AS v FROM PlayerHometowns
           WHERE school IS NOT NULL AND TRIM(school) <> ''
       ) t
       WHERE v IS NOT NULL AND v <> ''
       ORDER BY v ASC`
    );
    return rows.map((r) => (r.v != null ? String(r.v).trim() : "")).filter(Boolean);
  } catch (err) {
    console.error("[recruit-map-filters] team union", err && err.message);
    return safeDistinct(pool, "team");
  }
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const pool = getPool();
    const [
      teams,
      conferences,
      years,
      states,
      positions,
      classifications,
      starLevels,
    ] = await Promise.all([
      distinctTeamLikeValues(pool),
      safeDistinct(pool, "conference"),
      (async () => {
        try {
          const [y] = await pool.query(
            `SELECT DISTINCT season_year AS v FROM PlayerHometowns ORDER BY v DESC`
          );
          return y
            .map((r) => {
              const x = normalizeFilterScalar(r.v);
              if (x == null) return null;
              const n = parseInt(String(x), 10);
              return Number.isFinite(n) ? n : null;
            })
            .filter((v) => v != null);
        } catch (err) {
          console.error("[recruit-map-filters] years", err);
          return [];
        }
      })(),
      safeDistinct(pool, "hometown_state"),
      safeDistinct(pool, "position"),
      safeDistinct(pool, "recruit_type"),
      distinctStars(pool),
    ]);

    return json(200, {
      teams,
      conferences,
      years,
      states,
      positions,
      classifications,
      starLevels,
    });
  } catch (err) {
    console.error("recruit-map-filters:", err);
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
      return json(200, {
        teams: [],
        conferences: [],
        years: [],
        states: [],
        positions: [],
        classifications: [],
        starLevels: [],
        hint: "Database table not found.",
      });
    }
    return json(200, {
      teams: [],
      conferences: [],
      years: [],
      states: [],
      positions: [],
      classifications: [],
      starLevels: [],
    });
  }
};
