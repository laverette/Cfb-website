/**
 * POST /api/admin/create-week
 * Body: { season_year, week_number } or { seasonYear, weekNumber }
 * Optional: start_date, end_date
 */
const { getSupabase, dbError } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const body = parseJsonBody(event);
  if (!body) {
    return json(400, { error: "Invalid JSON body" });
  }

  const seasonYear = parseInt(body.seasonYear ?? body.season_year, 10);
  const weekNumber = parseInt(body.weekNumber ?? body.week_number, 10);
  if (!Number.isFinite(seasonYear) || !Number.isFinite(weekNumber)) {
    return json(400, { error: "season_year and week_number are required" });
  }

  const startDate = body.startDate ?? body.start_date ?? null;
  const endDate = body.endDate ?? body.end_date ?? null;

  try {
    const supabase = getSupabase();
    const { data: existing, error: findErr } = await supabase
      .from("weeks")
      .select("id, week_number, season_year, start_date, end_date, is_completed")
      .eq("season_year", seasonYear)
      .eq("week_number", weekNumber)
      .maybeSingle();
    dbError(findErr);

    if (existing) {
      return json(200, {
        message: "Week already exists",
        week: {
          id: existing.id,
          week_number: existing.week_number,
          season_year: existing.season_year,
          start_date: existing.start_date,
          end_date: existing.end_date,
          is_completed: Boolean(existing.is_completed),
        },
      });
    }

    const { data: created, error: insErr } = await supabase
      .from("weeks")
      .insert({
        week_number: weekNumber,
        season_year: seasonYear,
        start_date: startDate || null,
        end_date: endDate || null,
        is_completed: false,
      })
      .select("id")
      .single();
    dbError(insErr);

    return json(201, {
      message: "Week created",
      week: {
        id: created.id,
        week_number: weekNumber,
        season_year: seasonYear,
        start_date: startDate,
        end_date: endDate,
        is_completed: false,
      },
    });
  } catch (err) {
    console.error("admin-create-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
