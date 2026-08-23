const { getSupabase, dbError } = require("./db");

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    const { data: setting, error: settingErr } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", "current_week_id")
      .maybeSingle();
    dbError(settingErr);

    if (!setting || setting.setting_value == null || String(setting.setting_value).trim() === "") {
      return json(404, { error: "No active week set" });
    }

    const weekId = parseInt(String(setting.setting_value).trim(), 10);
    if (!Number.isFinite(weekId) || weekId < 1) {
      return json(404, { error: "No active week set" });
    }

    const { data: w, error: weekErr } = await supabase
      .from("weeks")
      .select("id, week_number, season_year, start_date, end_date, is_completed")
      .eq("id", weekId)
      .maybeSingle();
    dbError(weekErr);

    if (!w) {
      return json(404, { error: "No active week set" });
    }

    return json(200, {
      id: w.id,
      week_number: w.week_number,
      season_year: w.season_year,
      start_date: w.start_date,
      end_date: w.end_date,
      is_completed: Boolean(w.is_completed),
    });
  } catch (err) {
    console.error("picks-current-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
