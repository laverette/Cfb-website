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

const GRADE_THROTTLE_MS = 60_000;
let lastGradeRunAt = 0;

const {
  isEspnEventId,
  toInt: espnToInt,
  normalizeEspnEvent,
  fetchEspnResultsForGames,
  fetchEspnSummaryResult,
} = require("./espn-game-results");

function toInt(v) {
  return espnToInt(v);
}

function resolveWinner(game, homePoints, awayPoints) {
  if (homePoints == null || awayPoints == null) return null;
  if (homePoints === awayPoints) {
    return {
      isTie: true,
      winningEspnId: null,
      winningName: null,
      homePoints,
      awayPoints,
    };
  }
  if (homePoints > awayPoints) {
    return {
      isTie: false,
      winningEspnId: Number(game.home_team_espn_id),
      winningName: game.home_team_name,
      homePoints,
      awayPoints,
    };
  }
  return {
    isTie: false,
    winningEspnId: Number(game.away_team_espn_id),
    winningName: game.away_team_name,
    homePoints,
    awayPoints,
  };
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Fuzzy school-name match (same idea as weekly picks UI). */
function teamsMatchName(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const strip = (s) =>
    s
      .replace(/\b(university|univ|state|st|tech|college|of|the)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const xs = strip(x);
  const ys = strip(y);
  if (xs && ys && (xs === ys || xs.startsWith(ys) || ys.startsWith(xs))) return true;
  return false;
}

/**
 * Match a slate game to a live score row.
 * Returns { swapped } when live home/away is flipped vs our slate (neutral sites, etc).
 */
function matchLiveScoreToGame(game, live) {
  if (!game || !live) return null;
  const storedId = game.cfbd_game_id != null ? Number(game.cfbd_game_id) : null;
  const liveId = live.id != null ? Number(live.id) : toInt(live.espnEventId);

  // Primary: ESPN event id stored in cfbd_game_id matches ESPN live event.id
  if (
    Number.isFinite(storedId) &&
    Number.isFinite(liveId) &&
    storedId === liveId
  ) {
    if (live.source === "espn") return { swapped: false };
    // Legacy CFBD id equality (never treat ESPN event ids as CFBD ids)
    if (!isEspnEventId(storedId) && live.source !== "espn") {
      return { swapped: false };
    }
  }

  const homeId = Number(game.home_team_espn_id);
  const awayId = Number(game.away_team_espn_id);
  const liveHome = toInt(live.homeEspnId ?? live.home_espn_id);
  const liveAway = toInt(live.awayEspnId ?? live.away_espn_id);
  if (
    Number.isFinite(homeId) &&
    Number.isFinite(awayId) &&
    Number.isFinite(liveHome) &&
    Number.isFinite(liveAway)
  ) {
    if (homeId === liveHome && awayId === liveAway) return { swapped: false };
    if (homeId === liveAway && awayId === liveHome) return { swapped: true };
  }

  const gHome = game.home_team_name;
  const gAway = game.away_team_name;
  const lHome = live.homeTeam ?? live.home_team;
  const lAway = live.awayTeam ?? live.away_team;
  if (teamsMatchName(gHome, lHome) && teamsMatchName(gAway, lAway)) {
    return { swapped: false };
  }
  if (teamsMatchName(gHome, lAway) && teamsMatchName(gAway, lHome)) {
    return { swapped: true };
  }
  return null;
}

function extractFinalFromLive(live) {
  if (!live) return null;
  if (live.canceled || live.postponed) return null;
  const statusRaw = String(live.statusRaw || live.status_raw || "");
  const statusState = String(live.statusState || live.status_state || "").toLowerCase();
  const completed = Boolean(
    live.completed ||
      /final/i.test(statusRaw) ||
      statusState === "post" ||
      /status_final|final\/ot|final\/2ot/i.test(statusRaw)
  );
  if (!completed) return null;
  const homePoints = toInt(live.homePoints ?? live.home_points);
  const awayPoints = toInt(live.awayPoints ?? live.away_points);
  if (homePoints == null || awayPoints == null) return null;
  return { homePoints, awayPoints, completed: true };
}

function extractCanceledFromLive(live) {
  if (!live) return false;
  if (live.canceled) return true;
  const statusRaw = String(live.statusRaw || live.status_raw || "");
  return /cancel/i.test(statusRaw);
}

/** Orient live scores to our slate's home/away; prefer finals over stubs. */
function findLiveForGame(game, liveScores) {
  if (!game || !liveScores) return null;

  // Fast path: ESPN event id index (attached by fetchLiveScoresForWeek)
  const eid = toInt(game.cfbd_game_id);
  if (eid != null && liveScores._byEventId instanceof Map) {
    const direct = liveScores._byEventId.get(String(eid));
    if (direct) {
      const match = matchLiveScoreToGame(game, direct);
      if (match) return { live: direct, swapped: Boolean(match.swapped) };
    }
  }

  if (!Array.isArray(liveScores)) return null;
  let best = null;
  let bestSwapped = false;
  for (const ls of liveScores) {
    const match = matchLiveScoreToGame(game, ls);
    if (!match) continue;
    const cand = preferLiveScore(best, ls);
    if (cand === ls) {
      best = ls;
      bestSwapped = Boolean(match.swapped);
    } else if (cand === best && best === ls) {
      bestSwapped = Boolean(match.swapped);
    }
  }
  if (!best) return null;
  return { live: best, swapped: bestSwapped };
}

function finalFromMatched(match) {
  if (!match?.live) return null;
  const final = extractFinalFromLive(match.live);
  if (!final) return null;
  if (match.swapped) {
    return {
      homePoints: final.awayPoints,
      awayPoints: final.homePoints,
      completed: true,
    };
  }
  return final;
}

function liveScoreKey(g) {
  // Unordered name key so ESPN + CFBD rows for the same game compete in preferLiveScore
  // (team id systems differ — CFBD ids are stored in our espn_id columns).
  const a = normName(g?.awayTeam ?? g?.away_team);
  const h = normName(g?.homeTeam ?? g?.home_team);
  if (a && h) {
    return a < h ? `n:${a}|${h}` : `n:${h}|${a}`;
  }
  const ae = toInt(g?.awayEspnId ?? g?.away_espn_id);
  const he = toInt(g?.homeEspnId ?? g?.home_espn_id);
  if (ae && he) {
    return ae < he ? `e:${ae}:${he}` : `e:${he}:${ae}`;
  }
  if (g?.id) return `c:${g.id}`;
  return `n:${a}@${h}`;
}

function preferLiveScore(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (g) => {
    const period = Number(g.period);
    const hasPoints = g.awayPoints != null || g.homePoints != null;
    const inPlay =
      g.completed ||
      g.statusState === "in" ||
      (Number.isFinite(period) && period > 0);
    return (g.completed ? 16 : 0) + (inPlay && hasPoints ? 8 : 0) + (hasPoints ? 4 : 0);
  };
  return score(b) > score(a) ? b : a;
}

async function fetchLiveScoresForWeek(week, games = []) {
  if (!week) return [];
  const season = Number(week.season_year);
  const weekNum = Number(week.week_number);
  const byKey = new Map();
  const byEventId = new Map();

  const push = (g) => {
    if (!g) return;
    const key = liveScoreKey(g);
    byKey.set(key, preferLiveScore(byKey.get(key), g));
    const eid = toInt(g.id ?? g.espnEventId);
    if (eid != null) {
      const prev = byEventId.get(String(eid));
      byEventId.set(String(eid), preferLiveScore(prev, g));
    }
  };

  // ESPN-first (fresh scoreboard by game dates + summary fallback for misses).
  try {
    console.log(
      `[Weekly Picks] Starting result sync for week ${weekNum} ${season} (${(games || []).length} games)`
    );
    const espnMap = await fetchEspnResultsForGames(games, {
      week: weekNum,
      seasonYear: season,
    });
    let finals = 0;
    for (const row of espnMap.values()) {
      push(row);
      if (row.completed) finals += 1;
    }
    console.log(
      `[Weekly Picks] ESPN events indexed: ${espnMap.size}; finals in index: ${finals}`
    );
  } catch (err) {
    console.warn("[Weekly Picks] ESPN result fetch failed:", err.message || err);
  }

  // CFBD intentionally removed from automatic grading.
  // Background/cron must stay ESPN-only. Legacy CFBD-id games still grade via
  // ESPN event/name/team-id matching and per-event summary fallback.

  // Attach event-id index on the array for syncWeekGrades direct lookup.
  const list = Array.from(byKey.values());
  list._byEventId = byEventId;
  return list;
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

async function applyGameCanceled(game) {
  // Void: mark completed with no winner; leave is_correct null (not incorrect).
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
      home_team_score: null,
      away_team_score: null,
      winning_team_espn_id: null,
      winning_team_name: null,
      game_finalized_at: now,
    },
    { onConflict: "game_id" }
  );
  dbError(resultErr);

  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select("id, user_id, is_correct, is_tie")
      .eq("game_id", game.id)
  );
  let graded = 0;
  const affectedUsers = new Set();
  for (const pick of picks) {
    if (pick.is_correct == null && !pick.is_tie) continue;
    const { error } = await supabase
      .from("user_picks")
      .update({ is_correct: null, is_tie: false })
      .eq("id", pick.id);
    dbError(error);
    graded += 1;
    affectedUsers.add(Number(pick.user_id));
  }
  return { graded, affectedUsers, weekId: game.week_id, canceled: true };
}

async function applyGameFinal(game, homePoints, awayPoints) {
  const outcome = resolveWinner(game, homePoints, awayPoints);
  if (!outcome) return { graded: 0 };

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const isTie = Boolean(outcome.isTie);

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
      home_team_score: outcome.homePoints,
      away_team_score: outcome.awayPoints,
      winning_team_espn_id: isTie ? null : outcome.winningEspnId,
      winning_team_name: isTie ? null : outcome.winningName,
      game_finalized_at: now,
    },
    { onConflict: "game_id" }
  );
  dbError(resultErr);

  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select("id, user_id, picked_team_espn_id, is_correct, is_tie")
      .eq("game_id", game.id)
  );

  let graded = 0;
  const affectedUsers = new Set();
  for (const pick of picks) {
    const isCorrect = isTie
      ? null
      : Number(pick.picked_team_espn_id) === Number(outcome.winningEspnId);
    const pickIsTie = isTie;
    if (pick.is_correct === isCorrect && Boolean(pick.is_tie) === pickIsTie) continue;
    const { error } = await supabase
      .from("user_picks")
      .update({ is_correct: isCorrect, is_tie: pickIsTie })
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
      .select("user_id, is_correct, is_tie")
      .eq("week_id", weekId)
  );

  const byUser = new Map();
  for (const pick of picks) {
    const uid = Number(pick.user_id);
    if (!byUser.has(uid)) {
      byUser.set(uid, { total: 0, correct: 0, incorrect: 0, tied: 0, pending: 0 });
    }
    const bucket = byUser.get(uid);
    bucket.total += 1;
    if (pick.is_tie) bucket.tied += 1;
    else if (pick.is_correct === true) bucket.correct += 1;
    else if (pick.is_correct === false) bucket.incorrect += 1;
    else bucket.pending += 1;
  }

  const now = new Date().toISOString();
  for (const [userId, stats] of byUser.entries()) {
    const decided = stats.correct + stats.incorrect;
    const accuracy = decided > 0 ? Math.round((stats.correct / decided) * 10000) / 100 : 0;
    const { error } = await supabase.from("weekly_user_stats").upsert(
      {
        user_id: userId,
        week_id: weekId,
        total_picks: stats.total,
        correct_picks: stats.correct,
        incorrect_picks: stats.incorrect,
        tied_picks: stats.tied,
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
      .select("user_id, is_correct, is_tie, submitted_at")
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
    addPickToBucket(
      bucket,
      pick.is_correct,
      {
        submittedAt: pick.submitted_at ? new Date(pick.submitted_at).getTime() : 0,
      },
      Boolean(pick.is_tie)
    );
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

  const supabase = getSupabase();
  const { data: weekRow, error: weekErr } = await supabase
    .from("weeks")
    .select("id, week_number, season_year")
    .eq("id", weekId)
    .maybeSingle();
  dbError(weekErr);

  const unresolved = games.filter((g) => !g.is_completed);
  console.log(
    `[Weekly Picks] Found ${unresolved.length} unresolved games (week ${weekRow?.week_number})`
  );

  let scores = Array.isArray(liveScores) ? [...liveScores] : null;
  if (liveScores && liveScores._byEventId) {
    scores._byEventId = liveScores._byEventId;
  }
  if (!scores) {
    scores = await fetchLiveScoresForWeek(weekRow, games);
  } else {
    // Live payloads from /api/live-scores are often weekend-heavy. Incomplete
    // slate games (Monday night, delayed finals) may be missing — fill those.
    const incomplete = games.filter((g) => !g.is_completed);
    const missing = incomplete.filter((g) => {
      return finalFromMatched(findLiveForGame(g, scores)) == null;
    });
    if (missing.length) {
      const extra = await fetchLiveScoresForWeek(weekRow, missing);
      const byKey = new Map();
      const byEventId = new Map(scores._byEventId || []);
      const push = (g) => {
        if (!g) return;
        const key = liveScoreKey(g);
        byKey.set(key, preferLiveScore(byKey.get(key), g));
        const eid = toInt(g.id ?? g.espnEventId);
        if (eid != null) {
          byEventId.set(String(eid), preferLiveScore(byEventId.get(String(eid)), g));
        }
      };
      scores.forEach(push);
      (extra || []).forEach(push);
      if (extra?._byEventId instanceof Map) {
        for (const [k, v] of extra._byEventId.entries()) {
          byEventId.set(k, preferLiveScore(byEventId.get(k), v));
        }
      }
      scores = Array.from(byKey.values());
      scores._byEventId = byEventId;
    }
  }

  let picksUpdated = 0;
  let gamesNewlyFinal = 0;
  let stillPending = 0;
  let errors = 0;
  const affectedUsers = new Set();

  for (const game of games) {
    try {
      let homePoints = null;
      let awayPoints = null;

      let matched = findLiveForGame(game, scores);

      // Per-game ESPN summary fallback when scoreboard miss
      if (
        !matched &&
        !game.is_completed &&
        isEspnEventId(game.cfbd_game_id)
      ) {
        const summary = await fetchEspnSummaryResult(game.cfbd_game_id);
        if (summary) {
          matched = { live: summary, swapped: false };
          console.log(
            `[Weekly Picks] Matched ESPN event ${game.cfbd_game_id} via summary`
          );
        }
      }

      if (matched?.live && extractCanceledFromLive(matched.live)) {
        console.log(
          `[Weekly Picks] ${game.away_team_name} @ ${game.home_team_name} = CANCELED (void)`
        );
        const result = await applyGameCanceled(game);
        picksUpdated += result.graded || 0;
        if (result.affectedUsers) {
          result.affectedUsers.forEach((uid) => affectedUsers.add(uid));
        }
        game.is_completed = true;
        gamesNewlyFinal += 1;
        continue;
      }

      if (matched?.live?.postponed) {
        stillPending += 1;
        continue;
      }

      const final = finalFromMatched(matched);
      if (final) {
        homePoints = final.homePoints;
        awayPoints = final.awayPoints;
        console.log(
          `[Weekly Picks] Matched ESPN event ${game.cfbd_game_id}; ${game.away_team_name} @ ${game.home_team_name} = FINAL ${awayPoints}-${homePoints}`
        );
      } else if (game.is_completed) {
        const stored = await loadGameResult(game.id);
        if (stored) {
          homePoints = toInt(stored.home_team_score);
          awayPoints = toInt(stored.away_team_score);
        }
      }
      if (homePoints == null || awayPoints == null) {
        if (!game.is_completed) stillPending += 1;
        continue;
      }

      const wasComplete = game.is_completed;
      const result = await applyGameFinal(game, homePoints, awayPoints);
      picksUpdated += result.graded || 0;
      if (result.affectedUsers) {
        result.affectedUsers.forEach((uid) => affectedUsers.add(uid));
      }
      game.is_completed = true;
      if (!wasComplete) gamesNewlyFinal += 1;
    } catch (err) {
      errors += 1;
      console.error(
        `[Weekly Picks] Error grading game ${game.id} (${game.away_team_name} @ ${game.home_team_name}):`,
        err.message || err
      );
    }
  }

  if (picksUpdated > 0 || games.some((g) => g.is_completed)) {
    await rebuildWeeklyUserStats(weekId);
    await rebuildUserProfiles([...affectedUsers]);
    await maybeMarkWeekCompleted(weekId);
  }

  const gamesGraded = games.filter((g) => g.is_completed).length;
  console.log(
    `[Weekly Picks] Sync complete week=${weekId} final=${gamesNewlyFinal} pending=${stillPending} picks=${picksUpdated} errors=${errors}`
  );
  return {
    weekId,
    gamesGraded,
    gamesNewlyFinal,
    stillPending,
    picksUpdated,
    errors,
    affectedUsers: affectedUsers.size,
  };
}

async function listWeeksToGrade() {
  const supabase = getSupabase();
  const current = await loadCurrentWeek();
  const weekIds = new Set();
  if (current?.id) weekIds.add(Number(current.id));

  // Prefer weeks that still have ungraded games, not just weeks.is_completed=false
  // (a week can stay "open" forever if grading never wrote results).
  const { data: openGames, error: openGamesErr } = await supabase
    .from("games")
    .select("week_id")
    .eq("is_completed", false)
    .order("week_id", { ascending: false })
    .limit(50);
  dbError(openGamesErr);
  for (const row of openGames || []) {
    if (row?.week_id) weekIds.add(Number(row.week_id));
  }

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
  const { withExecutionContext } = require("./execution-context");
  return withExecutionContext(
    "background",
    async () => {
      try {
        const current = await loadCurrentWeek();
        if (!current?.id) return;

        // Always attempt grading for the open slate. Incoming live payloads from
        // /api/live-scores can lack finals when ESPN is blocked from Netlify —
        // syncWeekGrades fills those via date-scoped ESPN scoreboard/summary.
        const hasFinal = (Array.isArray(liveGames) ? liveGames : []).some(
          (g) => extractFinalFromLive(g) != null
        );
        await syncWeekGrades(Number(current.id), hasFinal ? liveGames : null);
      } catch (err) {
        console.warn("grade-picks background:", err.message || err);
      }
    },
    { caller: "live-scores-grade" }
  );
}

module.exports = {
  runGradePicks,
  syncWeekGrades,
  scheduleGradeFromLiveGames,
  matchLiveScoreToGame,
  extractFinalFromLive,
  extractCanceledFromLive,
  resolveWinner,
  isEspnEventId,
  normalizeEspnEvent,
};
