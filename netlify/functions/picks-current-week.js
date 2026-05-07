const { getPool } = require("./db");

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
    const pool = getPool();
    const [settingRows] = await pool.query(
      "SELECT `value` FROM Settings WHERE `key` = ? LIMIT 1",
      ["current_week_id"]
    );

    if (
      !settingRows.length ||
      settingRows[0].value == null ||
      String(settingRows[0].value).trim() === ""
    ) {
      return json(404, { error: "No active week set" });
    }

    const weekId = parseInt(String(settingRows[0].value).trim(), 10);
    if (!Number.isFinite(weekId) || weekId < 1) {
      return json(404, { error: "No active week set" });
    }

    const [weekRows] = await pool.query(
      `SELECT id, week_number, season_year, start_date, end_date, is_completed
       FROM Weeks WHERE id = ? LIMIT 1`,
      [weekId]
    );

    if (!weekRows.length) {
      return json(404, { error: "No active week set" });
    }

    const w = weekRows[0];
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
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(404, { error: "No active week set" });
    }
    return json(500, { error: "Internal server error" });
  }
};
