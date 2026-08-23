/**
 * Shared Supabase client for Netlify Functions (one client per warm isolate).
 * Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify / local .env.
 * Service role is server-only and bypasses RLS.
 * MYSQL_URL remains a fallback for picks until Netlify has Supabase keys.
 */
const { createClient } = require("@supabase/supabase-js");
const mysql = require("mysql2/promise");

const GLOBAL_CLIENT_KEY = "__cfb_supabase_client__";
const GLOBAL_MYSQL_KEY = "__cfb_mysql2_pool__";

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function hasSupabase() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

function getMysqlUrl() {
  return (
    process.env.MYSQL_URL ||
    process.env.JAWSDB_URL ||
    process.env.CLEARDB_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

function getMysqlPool() {
  const url = getMysqlUrl();
  if (!url || !/^mysql/i.test(url)) {
    const err = new Error("Database URL not configured");
    err.code = "NO_DATABASE_URL";
    throw err;
  }
  if (!globalThis[GLOBAL_MYSQL_KEY]) {
    globalThis[GLOBAL_MYSQL_KEY] = mysql.createPool(url, {
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 2,
      queueLimit: 0,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return globalThis[GLOBAL_MYSQL_KEY];
}

function getSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error("Supabase is not configured");
    err.code = "NO_DATABASE_URL";
    throw err;
  }
  if (!globalThis[GLOBAL_CLIENT_KEY]) {
    globalThis[GLOBAL_CLIENT_KEY] = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalThis[GLOBAL_CLIENT_KEY];
}

function dbError(error) {
  if (!error) return;
  const err = new Error(error.message || "Database error");
  err.code = error.code || "DB_ERROR";
  err.details = error.details;
  err.hint = error.hint;
  throw err;
}

async function selectAllPages(makeQuery, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    dbError(error);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/** Kept so older catch blocks still compile; Supabase HTTP is not connection-capped like JawsDB. */
function isMysqlConnectionLimitError() {
  return false;
}

function mapWeekRow(w) {
  if (!w) return null;
  return {
    id: w.id,
    week_number: w.week_number,
    season_year: w.season_year,
    start_date: w.start_date,
    end_date: w.end_date,
    is_completed: Boolean(w.is_completed),
  };
}

function mapGameRow(r) {
  return {
    id: r.id,
    week_id: r.week_id,
    cfbd_game_id: r.cfbd_game_id != null ? r.cfbd_game_id : null,
    game_number: r.game_number,
    home_team_espn_id: r.home_team_espn_id,
    away_team_espn_id: r.away_team_espn_id,
    home_team_name: r.home_team_name,
    away_team_name: r.away_team_name,
    home_team_logo_url: r.home_team_logo_url,
    away_team_logo_url: r.away_team_logo_url,
    game_date: r.game_date,
    venue: r.venue != null ? r.venue : null,
    betting_line: r.betting_line,
    is_completed: Boolean(r.is_completed),
  };
}

async function loadCurrentWeekFromMysql() {
  const pool = getMysqlPool();
  const [settingRows] = await pool.query(
    "SELECT `value` FROM Settings WHERE `key` = ? LIMIT 1",
    ["current_week_id"]
  );
  let weekId = null;
  if (settingRows.length && settingRows[0].value != null && String(settingRows[0].value).trim() !== "") {
    weekId = parseInt(String(settingRows[0].value).trim(), 10);
  }
  if (Number.isFinite(weekId) && weekId >= 1) {
    const [weekRows] = await pool.query(
      `SELECT id, week_number, season_year, start_date, end_date, is_completed
       FROM Weeks WHERE id = ? LIMIT 1`,
      [weekId]
    );
    if (weekRows.length) return mapWeekRow(weekRows[0]);
  }
  const [latest] = await pool.query(
    `SELECT id, week_number, season_year, start_date, end_date, is_completed
     FROM Weeks
     ORDER BY season_year DESC, week_number DESC
     LIMIT 1`
  );
  return latest.length ? mapWeekRow(latest[0]) : null;
}

async function loadCurrentWeek() {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data: setting, error: settingErr } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", "current_week_id")
      .maybeSingle();
    dbError(settingErr);

    let weekId = null;
    if (setting && setting.setting_value != null && String(setting.setting_value).trim() !== "") {
      weekId = parseInt(String(setting.setting_value).trim(), 10);
    }

    let w = null;
    if (Number.isFinite(weekId) && weekId >= 1) {
      const found = await supabase
        .from("weeks")
        .select("id, week_number, season_year, start_date, end_date, is_completed")
        .eq("id", weekId)
        .maybeSingle();
      dbError(found.error);
      w = found.data;
    }

    if (!w) {
      const latest = await supabase
        .from("weeks")
        .select("id, week_number, season_year, start_date, end_date, is_completed")
        .order("season_year", { ascending: false })
        .order("week_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      dbError(latest.error);
      w = latest.data;
    }

    if (w) return mapWeekRow(w);
  }

  const mysqlUrl = getMysqlUrl();
  if (mysqlUrl && /^mysql/i.test(mysqlUrl)) {
    return loadCurrentWeekFromMysql();
  }
  return null;
}

async function loadGamesByWeek(weekId) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data: gameRows, error } = await supabase
      .from("games")
      .select(
        "id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id, home_team_name, away_team_name, home_team_logo_url, away_team_logo_url, game_date, venue, betting_line, is_completed"
      )
      .eq("week_id", weekId)
      .order("game_number", { ascending: true });
    dbError(error);
    return (gameRows || []).map(mapGameRow);
  }

  const pool = getMysqlPool();
  const [gameRows] = await pool.query(
    `SELECT id, week_id, cfbd_game_id, game_number, home_team_espn_id, away_team_espn_id,
            home_team_name, away_team_name, home_team_logo_url, away_team_logo_url,
            game_date, venue, betting_line, is_completed
     FROM Games
     WHERE week_id = ?
     ORDER BY game_number`,
    [weekId]
  );
  return (gameRows || []).map(mapGameRow);
}

module.exports = {
  getSupabase,
  getPool: getSupabase,
  getMysqlPool,
  getMysqlUrl,
  hasSupabase,
  dbError,
  selectAllPages,
  getSupabaseConfig,
  isMysqlConnectionLimitError,
  loadCurrentWeek,
  loadGamesByWeek,
};
