/**
 * GET /api/admin/weeks
 */
const { getSupabase, dbError } = require("./db");
const { json } = require("./_http");
const { requireAdmin } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  try {
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from("weeks")
      .select("id, week_number, season_year, start_date, end_date, is_completed")
      .order("season_year", { ascending: false })
      .order("week_number", { ascending: false });
    dbError(error);

    const weeks = (rows || []).map((w) => ({
      id: w.id,
      week_number: w.week_number,
      season_year: w.season_year,
      start_date: w.start_date,
      end_date: w.end_date,
      is_completed: Boolean(w.is_completed),
    }));

    return json(200, { weeks });
  } catch (err) {
    console.error("admin-weeks:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
