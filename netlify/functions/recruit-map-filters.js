/**
 * LEGACY: DB-backed filters — public map uses static JSON (/data/recruits/).
 * GET /api/recruit-map/filters
 */
const { getSupabase, selectAllPages, isMysqlConnectionLimitError } = require("./db");
const { json } = require("./_http");

function uniqueSorted(values, { numeric = false, desc = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    if (raw == null) continue;
    if (numeric) {
      const n = parseInt(String(raw), 10);
      if (!Number.isFinite(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    } else {
      const s = String(raw).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  out.sort((a, b) => {
    if (numeric) return desc ? b - a : a - b;
    return String(a).localeCompare(String(b));
  });
  return out;
}

async function distinctColumn(column) {
  const rows = await selectAllPages(() =>
    getSupabase().from("player_hometowns").select(column).not(column, "is", null)
  );
  return uniqueSorted(rows.map((r) => r[column]));
}

async function safeDistinct(column) {
  try {
    return await distinctColumn(column);
  } catch (err) {
    console.error("[recruit-map-filters] distinct failed", column, err && err.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const [teams, conferences, years, states, positions, classifications, starLevels] =
      await Promise.all([
        (async () => {
          try {
            const rows = await selectAllPages(() =>
              getSupabase().from("player_hometowns").select("team, committed_to, school")
            );
            return uniqueSorted(
              rows.flatMap((r) => [r.team, r.committed_to, r.school])
            );
          } catch (err) {
            console.error("[recruit-map-filters] team union", err && err.message);
            return safeDistinct("team");
          }
        })(),
        safeDistinct("conference"),
        (async () => {
          try {
            const rows = await selectAllPages(() =>
              getSupabase().from("player_hometowns").select("season_year").not("season_year", "is", null)
            );
            return uniqueSorted(
              rows.map((r) => r.season_year),
              { numeric: true, desc: true }
            );
          } catch (err) {
            console.error("[recruit-map-filters] years", err);
            return [];
          }
        })(),
        safeDistinct("hometown_state"),
        safeDistinct("position"),
        safeDistinct("recruit_type"),
        (async () => {
          try {
            const rows = await selectAllPages(() =>
              getSupabase().from("player_hometowns").select("stars").not("stars", "is", null)
            );
            return uniqueSorted(
              rows.map((r) => r.stars),
              { numeric: true, desc: true }
            );
          } catch (err) {
            console.error("[recruit-map-filters] distinct stars", err && err.message);
            return [];
          }
        })(),
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
        message: "Database connection limit reached. Wait a few minutes and try again.",
      });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
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
