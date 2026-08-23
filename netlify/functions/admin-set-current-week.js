/**
 * POST /api/admin/set-current-week
 * Body: { seasonYear, weekNumber } or { season_year, week_number }
 * Optional: startDate/end_date — creates the week row if missing, then sets settings.current_week_id.
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
      .select("id")
      .eq("season_year", seasonYear)
      .eq("week_number", weekNumber)
      .maybeSingle();
    dbError(findErr);

    let weekId;
    if (existing) {
      weekId = existing.id;
    } else {
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
      weekId = created.id;
    }

    const { error: upsertErr } = await supabase.from("settings").upsert(
      {
        setting_key: "current_week_id",
        setting_value: String(weekId),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "setting_key" }
    );
    dbError(upsertErr);

    return json(200, { message: "Current week set", weekId });
  } catch (err) {
    console.error("admin-set-current-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
