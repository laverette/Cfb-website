/**
 * POST /api/admin/create-week
 * Body: { season_year, week_number } or { seasonYear, weekNumber }
 * Optional: start_date, end_date
 * TODO: Add admin authentication before production use.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

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
    const pool = getPool();

    const [existing] = await pool.query(
      "SELECT id, week_number, season_year, start_date, end_date, is_completed FROM Weeks WHERE season_year = ? AND week_number = ? LIMIT 1",
      [seasonYear, weekNumber]
    );

    if (existing.length) {
      const w = existing[0];
      return json(200, {
        message: "Week already exists",
        week: {
          id: w.id,
          week_number: w.week_number,
          season_year: w.season_year,
          start_date: w.start_date,
          end_date: w.end_date,
          is_completed: Boolean(w.is_completed),
        },
      });
    }

    const [ins] = await pool.query(
      `INSERT INTO Weeks (week_number, season_year, start_date, end_date, is_completed)
       VALUES (?, ?, ?, ?, FALSE)`,
      [
        weekNumber,
        seasonYear,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
      ]
    );

    const id = ins.insertId;
    return json(201, {
      message: "Week created",
      week: {
        id,
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
