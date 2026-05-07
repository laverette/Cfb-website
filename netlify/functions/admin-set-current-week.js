/**
 * POST /api/admin/set-current-week
 * Body: { seasonYear, weekNumber } or { season_year, week_number }
 * Optional: startDate/end_date — creates the week row if missing, then sets Settings.current_week_id.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

async function ensureSettingsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS Settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(100) UNIQUE NOT NULL,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_key (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

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
    const pool = getPool();
    await ensureSettingsTable(pool);

    let [rows] = await pool.query(
      "SELECT id FROM Weeks WHERE season_year = ? AND week_number = ? LIMIT 1",
      [seasonYear, weekNumber]
    );

    let weekId;
    if (rows.length) {
      weekId = rows[0].id;
    } else {
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
      weekId = ins.insertId;
    }

    await pool.query(
      `INSERT INTO Settings (\`key\`, value) VALUES ('current_week_id', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [String(weekId)]
    );

    return json(200, { message: "Current week set", weekId });
  } catch (err) {
    console.error("admin-set-current-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
