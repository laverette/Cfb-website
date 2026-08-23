/**
 * Shared Supabase client for Netlify Functions (one client per warm isolate).
 * Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify / local .env.
 * Service role is server-only and bypasses RLS.
 */
const { createClient } = require("@supabase/supabase-js");

const GLOBAL_CLIENT_KEY = "__cfb_supabase_client__";

const USER_COLS =
  "id, username, email, password_hash, display_name, avatar_url, bio, role, created_at";

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function hasSupabase() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
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
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
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

async function loadCurrentWeek() {
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

  return w ? mapWeekRow(w) : null;
}

async function loadGamesByWeek(weekId) {
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

async function findUserByUsernameOrEmail(usernameOrEmail) {
  const supabase = getSupabase();
  const { data: byUsername, error: userErr } = await supabase
    .from("users")
    .select(USER_COLS)
    .eq("username", usernameOrEmail)
    .maybeSingle();
  dbError(userErr);
  if (byUsername) return byUsername;

  const { data: byEmail, error: emailErr } = await supabase
    .from("users")
    .select(USER_COLS)
    .eq("email", usernameOrEmail)
    .maybeSingle();
  dbError(emailErr);
  return byEmail || null;
}

async function findUserById(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select(USER_COLS)
    .eq("id", userId)
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function findProfileByUserId(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_profiles")
    .select(
      "id, user_id, favorite_team_espn_id, favorite_conference, location, total_picks, correct_picks, accuracy, current_streak, best_streak, ranking, last_pick_date"
    )
    .eq("user_id", userId)
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function logUserLogin(userId) {
  try {
    await getSupabase().from("user_activity").insert({
      user_id: userId,
      activity_type: "login",
      activity_data: { login_time: new Date().toISOString() },
    });
  } catch {
    /* optional */
  }
}

async function registerUser({ username, email, passwordHash, displayName }) {
  const supabase = getSupabase();
  const { data: existingU, error: uErr } = await supabase
    .from("users")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  dbError(uErr);
  if (existingU) {
    const err = new Error("Username already exists");
    err.code = "USER_EXISTS";
    throw err;
  }
  const { data: existingE, error: eErr } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  dbError(eErr);
  if (existingE) {
    const err = new Error("Email already exists");
    err.code = "EMAIL_EXISTS";
    throw err;
  }

  const { data: created, error: insErr } = await supabase
    .from("users")
    .insert({
      username,
      email,
      password_hash: passwordHash,
      display_name: displayName,
      role: "user",
    })
    .select("id, username, email, display_name, avatar_url, bio, role, created_at")
    .single();
  dbError(insErr);

  await supabase.from("user_profiles").insert({
    user_id: created.id,
    total_picks: 0,
    correct_picks: 0,
    accuracy: 0,
  });
  await supabase.from("user_settings").insert({
    user_id: created.id,
    email_notifications: true,
    theme: "dark",
    notifications_enabled: true,
  });
  return created;
}

module.exports = {
  getSupabase,
  getPool: getSupabase,
  hasSupabase,
  dbError,
  selectAllPages,
  getSupabaseConfig,
  loadCurrentWeek,
  loadGamesByWeek,
  findUserByUsernameOrEmail,
  findUserById,
  findProfileByUserId,
  logUserLogin,
  registerUser,
};
