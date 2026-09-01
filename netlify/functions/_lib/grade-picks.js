/**
 * Grade weekly picks when games finalize.
 * Updates games.is_completed, game_results, user_picks.is_correct,
 * weekly_user_stats, and user_profiles.
 */
const {
  getSupabase,
  dbError,
  selectAllPages,
  loadCurrentWeek,
  loadGamesByWeek,
  emptyPickBucket,
  finalizeBucket,
  addPickToBucket,
} = require("../db");

const CFBD_BASE = "https://api.collegefootballdata.com";
const ESPN_SB =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

const GRADE_THROTTLE_MS = 60_000;
let lastGradeRunAt = 0;

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveWinner(game, homePoints, awayPoints) {
  if (homePoints == null || awayPoints == null) return null;
  if (homePoints === awayPoints) return null;
  if (homePoints > awayPoints) {
    return {
      winningEspnId: Number(game.home_team_espn_id),
      winningName: game.home_team_name,
      homePoints,
      awayPoints,
    };
  }
  return {
    winningEspnId: Number(game.away_team_espn_id),
    winningName: game.away_team_name,
    homePoints,
    awayPoints,
  };
}

function matchLiveScoreToGame(game, live) {
  if (!game || !live) return false;
  const homeId = Number(game.home_team_espn_id);
  const awayId = Number(game.away_team_espn_id);
  const liveHome = toInt(live.homeEspnId ?? live.home_espn_id);
  const liveAway = toInt(live.awayEspnId ?? live.away_espn_id);
  if (
    Number.isFinite(homeId) &&
    Number.isFinite(awayId) &&
    Number.isFinite(liveHome) &&
    Number.isFinite(liveAway) &&
    homeId === liveHome &&
    awayId === liveAway
  ) {
    return true;
  }
  const cfbdId = game.cfbd_game_id != null ? Number(game.cfbd_game_id) : null;
  const liveId = live.id != null ? Number(live.id) : null;
  if (Number.isFinite(cfbdId) && Number.isFinite(liveId) && cfbdId === liveId) {
    return true;
  }
  const gHome = normName(game.home_team_name);
  const gAway = normName(game.away_team_name);
  const lHome = normName(live.homeTeam ?? live.home_team);
  const lAway = normName(live.awayTeam ?? live.away_team);
  return Boolean(gHome && gAway && gHome === lHome && gAway === lAway);
}

function extractFinalFromLive(live) {
  if (!live) return null;
  const completed = Boolean(
    live.completed ||
      /final/i.test(String(live.statusRaw || live.status_raw || "")) ||
      String(live.statusState || live.status_state || "").toLowerCase() === "post"
  );
  if (!completed) return null;
  const homePoints = toInt(live.homePoints ?? live.home_points);
  const awayPoints = toInt(live.awayPoints ?? live.away_points);
  if (homePoints == null || awayPoints == null) return null;
  return { homePoints, awayPoints, completed: true };
}

async function fetchJson(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "CFB-GradePicks/1.0",
      ...headers,
    },
  });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function normalizeEspnEvent(evt) {
  const comp = Array.isArray(evt?.competitions) ? evt.competitions[0] : null;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const statusState = String(evt?.status?.type?.state || "").toLowerCase();
  const statusName = String(evt?.status?.type?.name || "");
  const detail = String(evt?.status?.type?.detail || "");
  const completed =
    statusState === "post" || /final/i.test(statusName) || /final/i.test(detail);
  return {
    id: evt.id != null ? Number(evt.id) : null,
    awayTeam: away.team?.location || away.team?.displayName || null,
    homeTeam: home.team?.location || home.team?.displayName || null,
    awayEspnId: toInt(away.team?.id ?? away.id),
    homeEspnId: toInt(home.team?.id ?? home.id),
    awayPoints: toInt(away.score),
    homePoints: toInt(home.score),
    completed,
    statusState,
    statusRaw: statusName || detail,
  };
}

async function fetchLiveScoresForWeek(week) {
  if (!week) return [];
  const season = Number(week.season_year);
  const weekNum = Number(week.week_number);
  const byKey = new Map();

  const push = (g) => {
    if (!g) return;
    const key =
      g.awayEspnId && g.homeEspnId
        ? `e:${g.awayEspnId}:${g.homeEspnId}`
        : g.id
          ? `c:${g.id}`
          : `n:${normName(g.awayTeam)}@${normName(g.homeTeam)}`;
    byKey.set(key, g);
  };

  try {
    const data = await fetchJson(`${ESPN_SB}?groups=80&limit=300`);
    (Array.isArray(data?.events) ? data.events : []).forEach((evt) => {
      push(normalizeEspnEvent(evt));
    });
  } catch (err) {
    console.warn("grade-picks espn:", err.message || err);
  }

  const key = readCfbdKey();
  if (key && Number.isFinite(season) && Number.isFinite(weekNum)) {
    const headers = { Authorization: `Bearer ${key}` };
    try {
      const games = await fetchJson(
        `${CFBD_BASE}/games?year=${season}&week=${weekNum}&seasonType=regular`,
        headers
      );
      (Array.isArray(games) ? games : []).forEach((g) => {
        push({
          id: g.id != null ? Number(g.id) : null,
          awayTeam: g.awayTeam || g.away_team,
          homeTeam: g.homeTeam || g.home_team,
          awayEspnId: toInt(g.awayId ?? g.away_id),
          homeEspnId: toInt(g.homeId ?? g.home_id),
          awayPoints: toInt(g.awayPoints ?? g.away_points),
          homePoints: toInt(g.homePoints ?? g.home_points),
          completed: Boolean(g.completed),
          statusRaw: g.completed ? "final" : g.status || "",
        });
      });
    } catch (err) {
      console.warn("grade-picks cfbd:", err.message || err);
    }
  }

  return Array.from(byKey.values());
}

function findLiveForGame(game, liveScores) {
  if (!Array.isArray(liveScores)) return null;
  return liveScores.find((ls) => matchLiveScoreToGame(game, ls)) || null;
}

async function loadGameResult(gameId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("game_results")
    .select("home_team_score, away_team_score, winning_team_espn_id, winning_team_name")
    .eq("game_id", gameId)
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function applyGameFinal(game, homePoints, awayPoints) {
  const winner = resolveWinner(game, homePoints, awayPoints);
  if (!winner || !Number.isFinite(winner.winningEspnId)) return { graded: 0 };

  const supabase = getSupabase();
  const now = new Date().toISOString();

  if (!game.is_completed) {
    const { error: gameErr } = await supabase
      .from("games")
      .update({ is_completed: true })
      .eq("id", game.id);
    dbError(gameErr);
  }

  const { error: resultErr } = await supabase.from("game_results").upsert(
    {
      game_id: game.id,
      home_team_score: winner.homePoints,
      away_team_score: winner.awayPoints,
      winning_team_espn_id: winner.winningEspnId,
      winning_team_name: winner.winningName,
      game_finalized_at: now,
    },
    { onConflict: "game_id" }
  );
  dbError(resultErr);

  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select("id, user_id, picked_team_espn_id, is_correct")
      .eq("game_id", game.id)
  );

  let graded = 0;
  const affectedUsers = new Set();
  for (const pick of picks) {
    const isCorrect = Number(pick.picked_team_espn_id) === winner.winningEspnId;
    if (pick.is_correct === isCorrect) continue;
    const { error } = await supabase
      .from("user_picks")
      .update({ is_correct: isCorrect })
      .eq("id", pick.id);
    dbError(error);
    graded += 1;
    affectedUsers.add(Number(pick.user_id));
  }

  return { graded, affectedUsers, weekId: game.week_id };
}

async function rebuildWeeklyUserStats(weekId) {
  const supabase = getSupabase();
  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select("user_id, is_correct")
      .eq("week_id", weekId)
  );

  const byUser = new Map();
  for (const pick of picks) {
    const uid = Number(pick.user_id);
    if (!byUser.has(uid)) {
      byUser.set(uid, { total: 0, correct: 0, incorrect: 0, pending: 0 });
    }
    const bucket = byUser.get(uid);
    bucket.total += 1;
    if (pick.is_correct === true) bucket.correct += 1;
    else if (pick.is_correct === false) bucket.incorrect += 1;
    else bucket.pending += 1;
  }

  const now = new Date().toISOString();
  for (const [userId, stats] of byUser.entries()) {
    const graded = stats.correct + stats.incorrect;
    const accuracy = graded > 0 ? Math.round((stats.correct / graded) * 10000) / 100 : 0;
    const { error } = await supabase.from("weekly_user_stats").upsert(
      {
        user_id: userId,
        week_id: weekId,
        total_picks: stats.total,
        correct_picks: stats.correct,
        incorrect_picks: stats.incorrect,
        accuracy,
        updated_at: now,
      },
      { onConflict: "user_id,week_id" }
    );
    dbError(error);
  }
}

async function rebuildUserProfiles(userIds) {
  if (!userIds.length) return;
  const supabase = getSupabase();
  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select("user_id, is_correct, submitted_at")
      .in("user_id", userIds)
  );

  const byUser = new Map();
  for (const uid of userIds) {
    byUser.set(uid, emptyPickBucket());
  }
  for (const pick of picks) {
    const uid = Number(pick.user_id);
    const bucket = byUser.get(uid);
    if (!bucket) continue;
    addPickToBucket(bucket, pick.is_correct, {
      submittedAt: pick.submitted_at ? new Date(pick.submitted_at).getTime() : 0,
    });
  }

  const now = new Date().toISOString();
  for (const [userId, bucket] of byUser.entries()) {
    const stats = finalizeBucket(bucket);
    const { error } = await supabase
      .from("user_profiles")
      .update({
        total_picks: stats.totalPicks,
        correct_picks: stats.correctPicks,
        accuracy: stats.accuracy,
        current_streak: stats.currentStreak,
        best_streak: stats.bestStreak,
        last_pick_date: now,
      })
      .eq("user_id", userId);
    dbError(error);
  }
}

async function maybeMarkWeekCompleted(weekId) {
  const games = await loadGamesByWeek(weekId);
  if (!games.length) return;
  if (!games.every((g) => g.is_completed)) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("weeks")
    .update({ is_completed: true })
    .eq("id", weekId);
  dbError(error);
}

async function syncWeekGrades(weekId, liveScores = null) {
  const games = await loadGamesByWeek(weekId);
  if (!games.length) return { weekId, gamesGraded: 0, picksUpdated: 0 };

  let scores = liveScores;
  if (!scores) {
    const supabase = getSupabase();
    const { data: weekRow, error: weekErr } = await supabase
      .from("weeks")
      .select("id, week_number, season_year")
      .eq("id", weekId)
      .maybeSingle();
    dbError(weekErr);
    scores = await fetchLiveScoresForWeek(weekRow);
  }

  let picksUpdated = 0;
  const affectedUsers = new Set();

  for (const game of games) {
    let homePoints = null;
    let awayPoints = null;

    const live = findLiveForGame(game, scores);
    const final = extractFinalFromLive(live);
    if (final) {
      homePoints = final.homePoints;
      awayPoints = final.awayPoints;
    } else if (game.is_completed) {
      const stored = await loadGameResult(game.id);
      if (stored) {
        homePoints = toInt(stored.home_team_score);
        awayPoints = toInt(stored.away_team_score);
      }
    }
    if (homePoints == null || awayPoints == null) continue;

    const result = await applyGameFinal(game, homePoints, awayPoints);
    picksUpdated += result.graded || 0;
    if (result.affectedUsers) {
      result.affectedUsers.forEach((uid) => affectedUsers.add(uid));
    }
    game.is_completed = true;
  }

  if (picksUpdated > 0 || games.some((g) => g.is_completed)) {
    await rebuildWeeklyUserStats(weekId);
    await rebuildUserProfiles([...affectedUsers]);
    await maybeMarkWeekCompleted(weekId);
  }

  const gamesGraded = games.filter((g) => g.is_completed).length;
  return { weekId, gamesGraded, picksUpdated, affectedUsers: affectedUsers.size };
}

async function listWeeksToGrade() {
  const supabase = getSupabase();
  const current = await loadCurrentWeek();
  const weekIds = new Set();
  if (current?.id) weekIds.add(Number(current.id));

  const { data: openWeeks, error } = await supabase
    .from("weeks")
    .select("id")
    .eq("is_completed", false)
    .order("season_year", { ascending: false })
    .order("week_number", { ascending: false })
    .limit(6);
  dbError(error);
  for (const w of openWeeks || []) {
    if (w?.id) weekIds.add(Number(w.id));
  }

  return [...weekIds];
}

async function runGradePicks({ weekId = null, liveGames = null, force = false } = {}) {
  const now = Date.now();
  if (!force && liveGames == null && now - lastGradeRunAt < GRADE_THROTTLE_MS) {
    return { skipped: true, reason: "throttled" };
  }
  lastGradeRunAt = now;

  const results = [];
  if (weekId != null) {
    results.push(await syncWeekGrades(Number(weekId), liveGames));
  } else {
    const weekIds = await listWeeksToGrade();
    for (const id of weekIds) {
      results.push(await syncWeekGrades(id));
    }
  }

  const picksUpdated = results.reduce((sum, r) => sum + (r.picksUpdated || 0), 0);
  return { ok: true, picksUpdated, weeks: results };
}

async function scheduleGradeFromLiveGames(liveGames) {
  const hasFinal = (Array.isArray(liveGames) ? liveGames : []).some(
    (g) => extractFinalFromLive(g) != null
  );
  if (!hasFinal) return;
  try {
    const current = await loadCurrentWeek();
    if (!current?.id) return;
    await syncWeekGrades(Number(current.id), liveGames);
  } catch (err) {
    console.warn("grade-picks background:", err.message || err);
  }
}

module.exports = {
  runGradePicks,
  syncWeekGrades,
  scheduleGradeFromLiveGames,
  matchLiveScoreToGame,
  extractFinalFromLive,
};
