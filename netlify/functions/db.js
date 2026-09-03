/**
 * Shared Supabase client for Netlify Functions (one client per warm isolate).
 * The project URL is public and has a default. Set SUPABASE_SERVICE_ROLE_KEY
 * in Netlify / local .env. Service role is server-only and bypasses RLS.
 */
const { createClient } = require("@supabase/supabase-js");

const GLOBAL_CLIENT_KEY = "__cfb_supabase_client__";
const DEFAULT_SUPABASE_URL = "https://nkxitcvsqnmcsvvkndyx.supabase.co";

const USER_COLS =
  "id, username, email, password_hash, display_name, avatar_url, bio, role, created_at";

function stripWrappingQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function normalizeSupabaseUrl(raw) {
  let url = stripWrappingQuotes(raw);
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1$/i, "");
  return url;
}

function normalizeSupabaseKey(raw) {
  return stripWrappingQuotes(raw).replace(/^Bearer\s+/i, "").trim();
}

function getSupabaseConfig() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL) || DEFAULT_SUPABASE_URL;
  const key = normalizeSupabaseKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
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

async function findUserSettings(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_settings")
    .select("id, user_id, email_notifications, theme, notifications_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function updateUserSettings(userId, patch = {}) {
  const supabase = getSupabase();
  const updates = {};
  if (patch.emailNotifications !== undefined) {
    updates.email_notifications = Boolean(patch.emailNotifications);
  }
  if (patch.notificationsEnabled !== undefined) {
    updates.notifications_enabled = Boolean(patch.notificationsEnabled);
  }
  if (patch.theme !== undefined && String(patch.theme).trim()) {
    updates.theme = String(patch.theme).trim();
  }
  if (!Object.keys(updates).length) {
    return findUserSettings(userId);
  }

  const { data, error } = await supabase
    .from("user_settings")
    .update(updates)
    .eq("user_id", userId)
    .select("id, user_id, email_notifications, theme, notifications_enabled")
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function registerUser({
  username,
  email,
  passwordHash,
  displayName,
  emailNotifications = false,
  avatarUrl = null,
}) {
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

  const insertRow = {
    username,
    email,
    password_hash: passwordHash,
    display_name: displayName,
    role: "user",
  };
  if (avatarUrl) insertRow.avatar_url = String(avatarUrl);

  const { data: created, error: insErr } = await supabase
    .from("users")
    .insert(insertRow)
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
    email_notifications: Boolean(emailNotifications),
    theme: "dark",
    notifications_enabled: true,
  });
  return created;
}

async function updateUserAvatar(userId, avatarUrl) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .update({
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id, username, email, display_name, avatar_url, bio, role, created_at")
    .single();
  dbError(error);
  return data || null;
}

async function listUsersForPickReminders(weekId) {
  const supabase = getSupabase();
  const { data: settingsRows, error: settingsErr } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("email_notifications", true);
  dbError(settingsErr);
  const userIds = (settingsRows || []).map((r) => r.user_id).filter(Boolean);
  if (!userIds.length) return [];

  const { data: pickRows, error: picksErr } = await supabase
    .from("user_picks")
    .select("user_id")
    .eq("week_id", weekId)
    .in("user_id", userIds);
  dbError(picksErr);
  const submitted = new Set((pickRows || []).map((r) => r.user_id));

  const { data: logRows, error: logErr } = await supabase
    .from("pick_reminder_log")
    .select("user_id")
    .eq("week_id", weekId)
    .in("user_id", userIds);
  dbError(logErr);
  const reminded = new Set((logRows || []).map((r) => r.user_id));

  const needIds = userIds.filter((id) => !submitted.has(id) && !reminded.has(id));
  if (!needIds.length) return [];

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, email, username, display_name")
    .in("id", needIds);
  dbError(usersErr);
  return users || [];
}

async function recordPickReminderSent(userId, weekId) {
  const supabase = getSupabase();
  const { error } = await supabase.from("pick_reminder_log").insert({
    user_id: userId,
    week_id: weekId,
  });
  if (error && error.code !== "23505") dbError(error);
}

function getEffectiveWeekLockTime(games, now = new Date()) {
  const lock = weekLockFromGames(games, now);
  return lock.wouldLockAt || lock.locksAt || null;
}

async function getWeekEffectiveLockTime(weekId) {
  const games = await loadGamesByWeek(weekId);
  return getEffectiveWeekLockTime(games);
}

async function getUserWeekSubmission(userId, weekId, options = {}) {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("user_picks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("week_id", weekId);
  dbError(error);
  const pickCount = count || 0;
  let lastSubmitted = null;
  if (pickCount > 0) {
    const { data, error: latestErr } = await supabase
      .from("user_picks")
      .select("submitted_at")
      .eq("user_id", userId)
      .eq("week_id", weekId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dbError(latestErr);
    lastSubmitted = data && data.submitted_at ? data.submitted_at : null;
  }
  const lock = options.lock || (await getWeekPickLock(weekId));
  return {
    hasSubmitted: pickCount > 0,
    pickCount,
    lastSubmitted,
    picksLocked: lock.picksLocked,
    locksAt: lock.locksAt,
    canEdit: !lock.picksLocked,
  };
}

async function getUserPicksForWeek(userId, weekId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_picks")
    .select(
      "id, game_id, week_id, picked_team_espn_id, picked_team_name, is_correct, submitted_at, games ( game_number, home_team_name, away_team_name, home_team_espn_id, away_team_espn_id )"
    )
    .eq("user_id", userId)
    .eq("week_id", weekId);
  dbError(error);
  return (data || [])
    .map((row) => {
      const g = row.games || {};
      return {
        id: row.id,
        gameId: row.game_id,
        weekId: row.week_id,
        gameNumber: g.game_number,
        pickedTeamEspnId: row.picked_team_espn_id,
        pickedTeamName: row.picked_team_name,
        isCorrect: row.is_correct,
        submittedAt: row.submitted_at,
        homeTeamName: g.home_team_name,
        awayTeamName: g.away_team_name,
        homeTeamEspnId: g.home_team_espn_id,
        awayTeamEspnId: g.away_team_espn_id,
      };
    })
    .sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
}

function alreadySubmittedError() {
  const err = new Error("You have already submitted picks for this week.");
  err.code = "ALREADY_SUBMITTED";
  return err;
}

function picksLockedError(locksAt) {
  const err = new Error(
    locksAt
      ? `Picks are locked. The first game started ${locksAt}.`
      : "Picks are locked for this week."
  );
  err.code = "PICKS_LOCKED";
  err.locksAt = locksAt || null;
  return err;
}

/** TEMP: turn first-kickoff lock off so weekly picks stay editable. Set false to restore. */
const WEEKLY_PICKS_TIME_LOCK_DISABLED = true;

function weekLockFromGames(games, now = new Date()) {
  const dates = (games || [])
    .map((g) => g.game_date)
    .filter((d) => d != null && String(d).trim() !== "")
    .map((d) => new Date(d))
    .filter((d) => Number.isFinite(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const locksAt = dates.length ? dates[0].toISOString() : null;
  if (WEEKLY_PICKS_TIME_LOCK_DISABLED) {
    return {
      picksLocked: false,
      locksAt: null,
      lockDisabled: true,
      wouldLockAt: locksAt,
    };
  }
  return {
    picksLocked: Boolean(locksAt && now.getTime() >= new Date(locksAt).getTime()),
    locksAt,
  };
}

async function getWeekPickLock(weekId) {
  const games = await loadGamesByWeek(weekId);
  return weekLockFromGames(games);
}

async function submitUserPicks({ userId, weekId, picks }) {
  const games = await loadGamesByWeek(weekId);
  if (!games.length) {
    const err = new Error("No games found for this week");
    err.code = "NO_GAMES";
    throw err;
  }

  const lock = weekLockFromGames(games);
  if (lock.picksLocked) {
    throw picksLockedError(lock.locksAt);
  }

  const existing = await getUserWeekSubmission(userId, weekId, { lock });

  const byId = new Map(games.map((g) => [Number(g.id), g]));
  const byNumber = new Map(games.map((g) => [Number(g.game_number), g]));
  const usedGameIds = new Set();
  const rows = [];

  for (const pick of picks || []) {
    const gameId = Number(pick.gameId ?? pick.game_id);
    const gameNumber = Number(pick.gameNumber ?? pick.game_number);
    const pickedEspnId = Number(pick.pickedTeamEspnId ?? pick.picked_team_espn_id);
    const game =
      (Number.isFinite(gameId) && byId.get(gameId)) ||
      (Number.isFinite(gameNumber) && byNumber.get(gameNumber)) ||
      null;
    if (!game || usedGameIds.has(Number(game.id))) continue;

    const homeId = Number(game.home_team_espn_id);
    const awayId = Number(game.away_team_espn_id);
    let pickedTeamName = null;
    if (pickedEspnId === homeId) pickedTeamName = game.home_team_name;
    else if (pickedEspnId === awayId) pickedTeamName = game.away_team_name;
    else continue;

    usedGameIds.add(Number(game.id));
    rows.push({
      user_id: userId,
      game_id: game.id,
      week_id: weekId,
      picked_team_espn_id: pickedEspnId,
      picked_team_name: pickedTeamName,
      submitted_at: new Date().toISOString(),
    });
  }

  if (rows.length !== games.length) {
    const err = new Error("Submit a pick for every game this week");
    err.code = "INCOMPLETE_PICKS";
    throw err;
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("user_picks").upsert(rows, {
    onConflict: "user_id,game_id",
  });
  dbError(error);

  await supabase.from("weekly_user_stats").upsert(
    {
      user_id: userId,
      week_id: weekId,
      total_picks: rows.length,
      correct_picks: 0,
      incorrect_picks: 0,
      accuracy: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,week_id" }
  );

  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      activity_type: existing.hasSubmitted ? "picks_updated" : "picks_submitted",
      activity_data: { week_id: weekId, pick_count: rows.length },
    });
  } catch {
    /* optional */
  }

  return { saved: rows.length, updated: Boolean(existing.hasSubmitted), locksAt: lock.locksAt };
}

function emptyPickBucket() {
  return {
    totalPicks: 0,
    gradedPicks: 0,
    correctPicks: 0,
    incorrectPicks: 0,
    pendingPicks: 0,
    accuracy: 0,
    currentStreak: 0,
    bestStreak: 0,
    worstStreak: 0,
    recentForm: [],
    _gradedChrono: [],
  };
}

function finalizeBucket(bucket) {
  const graded = Number(bucket.gradedPicks) || 0;
  const correct = Number(bucket.correctPicks) || 0;
  bucket.accuracy = graded > 0 ? Math.round((correct / graded) * 10000) / 100 : 0;

  const chrono = Array.isArray(bucket._gradedChrono) ? bucket._gradedChrono : [];
  chrono.sort((a, b) => {
    if (a.seasonYear !== b.seasonYear) return (a.seasonYear || 0) - (b.seasonYear || 0);
    if (a.weekNumber !== b.weekNumber) return (a.weekNumber || 0) - (b.weekNumber || 0);
    if (a.gameNumber !== b.gameNumber) return (a.gameNumber || 0) - (b.gameNumber || 0);
    return (a.submittedAt || 0) - (b.submittedAt || 0);
  });

  let best = 0;
  let worst = 0;
  let run = 0;
  for (const pick of chrono) {
    if (pick.correct) {
      run = run > 0 ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = run < 0 ? run - 1 : -1;
      if (run < worst) worst = run;
    }
  }

  let current = 0;
  if (chrono.length) {
    const last = chrono[chrono.length - 1].correct;
    current = last ? 1 : -1;
    for (let i = chrono.length - 2; i >= 0; i -= 1) {
      if (chrono[i].correct !== last) break;
      current += last ? 1 : -1;
    }
  }

  bucket.currentStreak = current;
  bucket.bestStreak = best;
  bucket.worstStreak = Math.abs(worst);
  bucket.recentForm = chrono.slice(-5).map((p) => (p.correct ? "W" : "L"));
  delete bucket._gradedChrono;
  return bucket;
}

function addPickToBucket(bucket, isCorrect, meta = null) {
  bucket.totalPicks += 1;
  if (isCorrect === true) {
    bucket.gradedPicks += 1;
    bucket.correctPicks += 1;
    if (meta) {
      bucket._gradedChrono.push({ ...meta, correct: true });
    }
  } else if (isCorrect === false) {
    bucket.gradedPicks += 1;
    bucket.incorrectPicks += 1;
    if (meta) {
      bucket._gradedChrono.push({ ...meta, correct: false });
    }
  } else {
    bucket.pendingPicks += 1;
  }
}

function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (b.correctPicks !== a.correctPicks) return b.correctPicks - a.correctPicks;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (b.gradedPicks !== a.gradedPicks) return b.gradedPicks - a.gradedPicks;
    if (b.totalPicks !== a.totalPicks) return b.totalPicks - a.totalPicks;
    const an = String(a.displayName || a.username || "").toLowerCase();
    const bn = String(b.displayName || b.username || "").toLowerCase();
    return an.localeCompare(bn);
  });
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

async function listPublicUsers() {
  const supabase = getSupabase();
  const rows = await selectAllPages(() =>
    supabase
      .from("users")
      .select("id, username, display_name, avatar_url, bio, created_at")
      .order("id", { ascending: true })
  );
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name != null ? u.display_name : u.username,
    avatarUrl: u.avatar_url ?? null,
    bio: u.bio ?? null,
    createdAt: u.created_at,
  }));
}

async function listSeasonYears() {
  const supabase = getSupabase();
  const rows = await selectAllPages(() =>
    supabase.from("weeks").select("season_year").order("season_year", { ascending: false })
  );
  const years = [...new Set(rows.map((r) => Number(r.season_year)).filter(Number.isFinite))];
  years.sort((a, b) => b - a);
  return years;
}

async function resolveLeaderboardSeasonYear(requestedYear) {
  const years = await listSeasonYears();
  if (requestedYear != null && Number.isFinite(Number(requestedYear))) {
    const y = Number(requestedYear);
    if (years.includes(y) || years.length === 0) return y;
  }
  const current = await loadCurrentWeek();
  if (current && current.season_year != null) return Number(current.season_year);
  return years[0] ?? new Date().getFullYear();
}

/**
 * scope: 'all' | 'season' | 'year' | 'week'
 * year: used for season/year scopes
 * weekId: used for week scope
 */
async function getLeaderboard({ scope = "all", year = null, weekId = null } = {}) {
  const supabase = getSupabase();
  const users = await listPublicUsers();
  const seasons = await listSeasonYears();
  const currentWeek = await loadCurrentWeek();
  const currentSeasonYear =
    currentWeek && currentWeek.season_year != null
      ? Number(currentWeek.season_year)
      : seasons[0] ?? new Date().getFullYear();

  let filterYear = null;
  let filterWeekId = null;
  let scopeLabel = "All Time";
  if (scope === "season") {
    filterYear = currentSeasonYear;
    scopeLabel = `This Season (${filterYear})`;
  } else if (scope === "year") {
    filterYear = await resolveLeaderboardSeasonYear(year);
    scopeLabel = `${filterYear} Season`;
  } else if (scope === "week") {
    const resolvedWeekId =
      weekId != null && Number.isFinite(Number(weekId))
        ? Number(weekId)
        : currentWeek?.id != null
          ? Number(currentWeek.id)
          : null;
    if (resolvedWeekId) {
      filterWeekId = resolvedWeekId;
      const { data: weekRow, error: weekErr } = await supabase
        .from("weeks")
        .select("week_number, season_year")
        .eq("id", resolvedWeekId)
        .maybeSingle();
      dbError(weekErr);
      if (weekRow) {
        scopeLabel = `Week ${weekRow.week_number} (${weekRow.season_year})`;
        filterYear = Number(weekRow.season_year);
      } else {
        scopeLabel = "This Week";
      }
    } else {
      scopeLabel = "This Week";
    }
  }

  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select(
        "user_id, is_correct, week_id, submitted_at, weeks ( season_year, week_number ), games ( game_number )"
      )
  );

  const byUser = new Map();
  for (const u of users) {
    byUser.set(Number(u.id), {
      userId: Number(u.id),
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      ...emptyPickBucket(),
    });
  }

  for (const pick of picks) {
    const uid = Number(pick.user_id);
    if (!byUser.has(uid)) continue;
    const seasonYear = pick.weeks?.season_year != null ? Number(pick.weeks.season_year) : null;
    const pickWeekId = pick.week_id != null ? Number(pick.week_id) : null;
    if (filterYear != null && seasonYear !== filterYear) continue;
    if (filterWeekId != null && pickWeekId !== filterWeekId) continue;
    addPickToBucket(byUser.get(uid), pick.is_correct, {
      seasonYear,
      weekNumber: pick.weeks?.week_number != null ? Number(pick.weeks.week_number) : 0,
      gameNumber: pick.games?.game_number != null ? Number(pick.games.game_number) : 0,
      submittedAt: pick.submitted_at ? new Date(pick.submitted_at).getTime() : 0,
    });
  }

  const entries = rankRows(
    [...byUser.values()].map((row) => finalizeBucket(row))
  );

  const withStreaks = entries.filter((e) => e.gradedPicks > 0);
  const hottest = [...withStreaks]
    .filter((e) => e.currentStreak >= 3)
    .sort((a, b) => b.currentStreak - a.currentStreak || b.accuracy - a.accuracy)
    .slice(0, 5)
    .map((e) => ({
      userId: e.userId,
      username: e.username,
      displayName: e.displayName,
      rank: e.rank,
      currentStreak: e.currentStreak,
      accuracy: e.accuracy,
    }));
  const coldest = [...withStreaks]
    .filter((e) => e.currentStreak <= -3)
    .sort((a, b) => a.currentStreak - b.currentStreak || a.accuracy - b.accuracy)
    .slice(0, 5)
    .map((e) => ({
      userId: e.userId,
      username: e.username,
      displayName: e.displayName,
      rank: e.rank,
      currentStreak: e.currentStreak,
      accuracy: e.accuracy,
    }));

  return {
    scope,
    scopeLabel,
    year: filterYear,
    weekId: filterWeekId,
    currentSeasonYear,
    availableYears: seasons.length ? seasons : [currentSeasonYear],
    entries,
    highlights: { hottest, coldest },
    viewerHint:
      "Ranked by correct picks, then accuracy. 🔥 Hot and ❄️ cold streaks are consecutive graded picks.",
  };
}

async function findUserByUsername(username) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select("id, username, display_name, avatar_url, bio, created_at")
    .eq("username", String(username || "").trim())
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function getPublicUserProfile({ userId = null, username = null } = {}) {
  let user = null;
  if (userId != null && String(userId).trim() !== "") {
    const row = await findUserById(userId);
    if (row) {
      user = {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        created_at: row.created_at,
      };
    }
  } else if (username) {
    user = await findUserByUsername(username);
  }
  if (!user) return null;

  const supabase = getSupabase();
  const profile = await findProfileByUserId(user.id);
  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select(
        "id, game_id, week_id, picked_team_espn_id, picked_team_name, is_correct, submitted_at, weeks ( id, week_number, season_year ), games ( game_number, home_team_name, away_team_name, home_team_espn_id, away_team_espn_id, is_completed )"
      )
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false })
  );

  const allTime = emptyPickBucket();
  const bySeason = new Map();
  const byWeek = new Map();

  for (const pick of picks) {
    const seasonYear = pick.weeks?.season_year != null ? Number(pick.weeks.season_year) : null;
    const weekNumber = pick.weeks?.week_number != null ? Number(pick.weeks.week_number) : null;
    const weekId = pick.week_id != null ? Number(pick.week_id) : null;
    const pickMeta = {
      seasonYear,
      weekNumber: weekNumber || 0,
      gameNumber: pick.games?.game_number != null ? Number(pick.games.game_number) : 0,
      submittedAt: pick.submitted_at ? new Date(pick.submitted_at).getTime() : 0,
    };

    addPickToBucket(allTime, pick.is_correct, pickMeta);

    if (seasonYear != null) {
      if (!bySeason.has(seasonYear)) bySeason.set(seasonYear, emptyPickBucket());
      addPickToBucket(bySeason.get(seasonYear), pick.is_correct, pickMeta);
    }

    if (weekId != null) {
      if (!byWeek.has(weekId)) {
        byWeek.set(weekId, {
          weekId,
          weekNumber,
          seasonYear,
          submittedAt: pick.submitted_at,
          picks: [],
          ...emptyPickBucket(),
        });
      }
      const weekBucket = byWeek.get(weekId);
      addPickToBucket(weekBucket, pick.is_correct, pickMeta);
      if (
        pick.submitted_at &&
        (!weekBucket.submittedAt ||
          new Date(pick.submitted_at) > new Date(weekBucket.submittedAt))
      ) {
        weekBucket.submittedAt = pick.submitted_at;
      }
      weekBucket.picks.push({
        gameNumber: pick.games?.game_number ?? null,
        pickedTeamName: pick.picked_team_name,
        pickedTeamEspnId: pick.picked_team_espn_id,
        homeTeamName: pick.games?.home_team_name ?? null,
        awayTeamName: pick.games?.away_team_name ?? null,
        isCorrect: pick.is_correct,
        isCompleted: Boolean(pick.games?.is_completed),
      });
    }
  }

  finalizeBucket(allTime);
  const seasons = [...bySeason.entries()]
    .map(([seasonYear, bucket]) => ({
      seasonYear,
      ...finalizeBucket(bucket),
    }))
    .sort((a, b) => b.seasonYear - a.seasonYear);

  const weeks = [...byWeek.values()]
    .map((w) => {
      finalizeBucket(w);
      w.picks.sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
      return w;
    })
    .sort((a, b) => {
      if (b.seasonYear !== a.seasonYear) return (b.seasonYear || 0) - (a.seasonYear || 0);
      return (b.weekNumber || 0) - (a.weekNumber || 0);
    });

  const currentWeek = await loadCurrentWeek();
  const currentSeasonYear =
    currentWeek && currentWeek.season_year != null
      ? Number(currentWeek.season_year)
      : seasons[0]?.seasonYear ?? new Date().getFullYear();
  const thisSeason =
    seasons.find((s) => s.seasonYear === currentSeasonYear) || {
      seasonYear: currentSeasonYear,
      ...emptyPickBucket(),
    };

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name != null ? user.display_name : user.username,
      avatarUrl: user.avatar_url ?? null,
      bio: user.bio ?? null,
      memberSince: user.created_at,
    },
    profile: profile
      ? {
          favoriteTeamEspnId: profile.favorite_team_espn_id,
          favoriteConference: profile.favorite_conference,
          location: profile.location,
          currentStreak: profile.current_streak,
          bestStreak: profile.best_streak,
        }
      : null,
    stats: {
      allTime,
      thisSeason,
      bySeason: seasons,
    },
    weeks,
  };
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
  findUserByUsername,
  findProfileByUserId,
  findUserSettings,
  updateUserSettings,
  logUserLogin,
  registerUser,
  updateUserAvatar,
  listUsersForPickReminders,
  recordPickReminderSent,
  getEffectiveWeekLockTime,
  getWeekEffectiveLockTime,
  getUserWeekSubmission,
  getUserPicksForWeek,
  getWeekPickLock,
  submitUserPicks,
  getLeaderboard,
  getPublicUserProfile,
  listSeasonYears,
  emptyPickBucket,
  finalizeBucket,
  addPickToBucket,
  rankRows,
};
