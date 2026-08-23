/**
 * LEGACY: DB stats — public map uses manifest.json (/data/recruits/).
 * GET /api/recruit-map/stats?year=2025
 */
const { getSupabase, dbError } = require("./db");
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
  const year = numOrNull(q.year);
  if (year == null || year < 2009 || year > 2100) {
    return json(400, { error: "year query parameter is required (e.g. 2025)" });
  }

  try {
    const supabase = getSupabase();
    const { count: totalRows, error: totalErr } = await supabase
      .from("player_hometowns")
      .select("id", { count: "exact", head: true })
      .eq("season_year", year);
    dbError(totalErr);

    const { count: rowsWithCoordinates, error: withErr } = await supabase
      .from("player_hometowns")
      .select("id", { count: "exact", head: true })
      .eq("season_year", year)
      .not("latitude", "is", null)
      .not("longitude", "is", null);
    dbError(withErr);

    const total = totalRows || 0;
    const withCoords = rowsWithCoordinates || 0;
    return json(200, {
      year,
      totalRows: total,
      rowsWithCoordinates: withCoords,
      rowsMissingCoordinates: Math.max(0, total - withCoords),
    });
  } catch (err) {
    console.error("recruit-map-stats:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: err.message || "Internal server error" });
  }
};
