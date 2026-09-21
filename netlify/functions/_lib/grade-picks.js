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
  const cfbdId = game.cfbd_game_id != null ? Number(game.cfbd_game_id) : null;
  const liveId = live.id != null ? Number(live.id) : null;
  // CFBD game ids only — never treat ESPN event ids as CFBD ids.
  if (
    Number.isFinite(cfbdId) &&
    Number.isFinite(liveId) &&
    cfbdId === liveId &&
    live.source !== "espn"
  ) {
    return { swapped: false };
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

/** Orient live scores to our slate's home/away; prefer finals over stubs. */
function findLiveForGame(game, liveScores) {
  if (!Array.isArray(liveScores) || !game) return null;
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
    source: "espn",
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

function ymdEtFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}${m}${day}` : null;
}

async function fetchLiveScoresForWeek(week, games = []) {
  if (!week) return [];
  const season = Number(week.season_year);
  const weekNum = Number(week.week_number);
  const byKey = new Map();

  const push = (g) => {
    if (!g) return;
    const key = liveScoreKey(g);
    byKey.set(key, preferLiveScore(byKey.get(key), g));
  };

  const dates = new Set();
  const addYmd = (ymd) => {
    if (ymd && /^\d{8}$/.test(ymd)) dates.add(ymd);
  };
  const addAdjacentEtDays = (ymd) => {
    if (!ymd || !/^\d{8}$/.test(ymd)) return;
    addYmd(ymd);
    // Late / delayed games can land on ESPN's next calendar day board.
    try {
      const y = Number(ymd.slice(0, 4));
      const m = Number(ymd.slice(4, 6));
      const d = Number(ymd.slice(6, 8));
      const base = new Date(Date.UTC(y, m - 1, d, 16, 0, 0)); // noon-ish ET
      const next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
      const prev = new Date(base.getTime() - 24 * 60 * 60 * 1000);
      addYmd(ymdEtFromIso(next.toISOString()));
      addYmd(ymdEtFromIso(prev.toISOString()));
    } catch {
      /* ignore */
    }
  };
  (games || []).forEach((g) => {
    addAdjacentEtDays(ymdEtFromIso(g.game_date || g.gameDate));
  });
  const dateList = [...dates].slice(0, 7);
  const espnUrls = [
    `${ESPN_SB}?groups=80&limit=300`,
    ...dateList.map((date) => `${ESPN_SB}?dates=${encodeURIComponent(date)}&groups=80&limit=300`),
  ];

  await Promise.all(
    espnUrls.map(async (url) => {
      try {
        const data = await fetchJson(url);
        (Array.isArray(data?.events) ? data.events : []).forEach((evt) => {
          push(normalizeEspnEvent(evt));
        });
      } catch (err) {
        console.warn("grade-picks espn:", err.message || err, url);
      }
    })
  );

  const key = readCfbdKey();
  if (key && Number.isFinite(season) && Number.isFinite(weekNum)) {
    const headers = { Authorization: `Bearer ${key}` };
    const weekCandidates = [
      ...new Set(
        [weekNum - 1, weekNum, weekNum + 1].filter((w) => Number.isFinite(w) && w >= 0)
      ),
    ];
    for (const w of weekCandidates) {
      try {
        const cfbdGames = await fetchJson(
          `${CFBD_BASE}/games?year=${season}&week=${w}&seasonType=regular`,
          headers
        );
        (Array.isArray(cfbdGames) ? cfbdGames : []).forEach((g) => {
          push({
            id: g.id != null ? Number(g.id) : null,
            source: "cfbd",
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

    // Direct CFBD id lookups when we still lack a *final* (not just any live stub).
    const scoresNow = () => Array.from(byKey.values());
    const missingFinal = (games || []).filter((g) => {
      if (g.is_completed) return false;
      const cfbdId = toInt(g.cfbd_game_id);
      if (!cfbdId) return false;
      return finalFromMatched(findLiveForGame(g, scoresNow())) == null;
    });
    await Promise.all(
      missingFinal.slice(0, 24).map(async (g) => {
        const cfbdId = toInt(g.cfbd_game_id);
        try {
          const rows = await fetchJson(
            `${CFBD_BASE}/games?id=${encodeURIComponent(cfbdId)}`,
            headers
          );
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (!row) return;
          push({
            id: row.id != null ? Number(row.id) : cfbdId,
            source: "cfbd",
            awayTeam: row.awayTeam || row.away_team,
            homeTeam: row.homeTeam || row.home_team,
            awayEspnId: toInt(row.awayId ?? row.away_id),
            homeEspnId: toInt(row.homeId ?? row.home_id),
            awayPoints: toInt(row.awayPoints ?? row.away_points),
            homePoints: toInt(row.homePoints ?? row.home_points),
            completed: Boolean(row.completed),
            statusRaw: row.completed ? "final" : row.status || "",
          });
        } catch (err) {
          console.warn("grade-picks cfbd id:", cfbdId, err.message || err);
        }
      })
    );
  }

  return Array.from(byKey.values());
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

  let scores = Array.isArray(liveScores) ? [...liveScores] : null;
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
      const push = (g) => {
        if (!g) return;
        const key = liveScoreKey(g);
        byKey.set(key, preferLiveScore(byKey.get(key), g));
      };
      scores.forEach(push);
      (extra || []).forEach(push);
      scores = Array.from(byKey.values());
    }
  }

  let picksUpdated = 0;
  const affectedUsers = new Set();

  for (const game of games) {
    let homePoints = null;
    let awayPoints = null;

    const matched = findLiveForGame(game, scores);
    const final = finalFromMatched(matched);
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
  try {
    const current = await loadCurrentWeek();
    if (!current?.id) return;

    // Always attempt grading for the open slate. Incoming live payloads from
    // /api/live-scores can lack finals when ESPN is blocked from Netlify or
    // CFBD is empty — syncWeekGrades fills those via date-scoped ESPN + CFBD.
    // Skipping when hasFinal is false left finished weeks stuck on "pending".
    const hasFinal = (Array.isArray(liveGames) ? liveGames : []).some(
      (g) => extractFinalFromLive(g) != null
    );
    await syncWeekGrades(Number(current.id), hasFinal ? liveGames : null);
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
