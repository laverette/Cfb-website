/**
 * One-time copy of MySQL/JawsDB rows into Supabase.
 * Requires MYSQL_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.
 *
 *   node scripts/migrate-mysql-to-supabase.js
 */
const mysql = require("mysql2/promise");
const { createClient } = require("@supabase/supabase-js");

const TABLES = [
  { mysql: "Users", supabase: "users" },
  { mysql: "UserProfiles", supabase: "user_profiles" },
  { mysql: "UserSettings", supabase: "user_settings" },
  { mysql: "UserActivity", supabase: "user_activity" },
  { mysql: "Weeks", supabase: "weeks" },
  { mysql: "Games", supabase: "games" },
  { mysql: "GameResults", supabase: "game_results" },
  { mysql: "UserPicks", supabase: "user_picks" },
  { mysql: "WeeklyUserStats", supabase: "weekly_user_stats" },
  { mysql: "PlayerHometowns", supabase: "player_hometowns" },
];

function mapSettingsRow(row) {
  return {
    setting_key: row.key,
    setting_value: row.value,
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

async function main() {
  const mysqlUrl = String(process.env.MYSQL_URL || "").trim();
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!mysqlUrl || !supabaseUrl || !supabaseKey) {
    throw new Error("Set MYSQL_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY");
  }

  const conn = await mysql.createConnection(mysqlUrl);
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    for (const table of TABLES) {
      const [rows] = await conn.query(`SELECT * FROM \`${table.mysql}\``);
      if (!rows.length) {
        console.log(`skip ${table.mysql}: 0 rows`);
        continue;
      }
      const payload = rows.map((r) => {
        const copy = { ...r };
        if (copy.activity_data && typeof copy.activity_data === "string") {
          try {
            copy.activity_data = JSON.parse(copy.activity_data);
          } catch {
            copy.activity_data = { raw: copy.activity_data };
          }
        }
        return copy;
      });
      for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const { error } = await supabase.from(table.supabase).upsert(chunk, { onConflict: "id" });
        if (error) throw new Error(`${table.supabase}: ${error.message}`);
      }
      console.log(`copied ${table.mysql} -> ${table.supabase}: ${payload.length}`);
    }

    console.log("After this copy, run Client/sql/supabase_reset_sequences.sql in the Supabase SQL editor.");

    try {
      const [settings] = await conn.query("SELECT `key`, value, updated_at FROM Settings");
      if (settings.length) {
        const { error } = await supabase
          .from("settings")
          .upsert(settings.map(mapSettingsRow), { onConflict: "setting_key" });
        if (error) throw new Error(`settings: ${error.message}`);
        console.log(`copied Settings -> settings: ${settings.length}`);
      }
    } catch (err) {
      console.warn("Settings copy skipped:", err.message);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
