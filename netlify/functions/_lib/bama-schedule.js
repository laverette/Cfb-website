/**
 * Alabama schedule predictions — CFBD ingest, grading, leaderboard.
 */

const CFBD_BASE = "https://api.collegefootballdata.com";
const ALABAMA_SCHOOL = "Alabama";

const {
  getSupabase,
  dbError,
  selectAllPages,
  listPublicUsers,
  emptyPickBucket,
  finalizeBucket,
  addPickToBucket,
} = require("../db");

function normalizeSeason(season) {
  const y = Number(season);
  return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
}

async function cfbdGet(path, query, apiKey, signal) {
  const url = new URL(CFBD_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CFBD ${path} failed (${resp.status}): ${text.slice(0, 180)}`);
  }
  return resp.json();
}

function isAlabamaTeam(name) {
  return String(name || "").trim().toLowerCase() === ALABAMA_SCHOOL.toLowerCase();
}

function mapScheduleGame(g) {
  const homeIsBama = isAlabamaTeam(g.homeTeam);
  const awayIsBama = isAlabamaTeam(g.awayTeam);
  if (!homeIsBama && !awayIsBama) return null;

  const opponent = homeIsBama ? g.awayTeam : g.homeTeam;
  const completed = Boolean(g.completed);
  const homeScore = Number.isFinite(Number(g.homePoints)) ? Number(g.homePoints) : null;
  const awayScore = Number.isFinite(Number(g.awayPoints)) ? Number(g.awayPoints) : null;

  let alabamaScore = null;
  let opponentScore = null;
  let alabamaWin = null;
  if (completed && homeScore != null && awayScore != null) {
    alabamaScore = homeIsBama ? homeScore : awayScore;
    opponentScore = homeIsBama ? awayScore : homeScore;
    alabamaWin = alabamaScore > opponentScore;
  }

  const startDate = g.startDate || null;
  const locked = isGameLocked(startDate, completed);

  return {
    cfbdGameId: Number(g.id),
    season: Number(g.season),
    week: Number(g.week),
    opponent,
    isHome: homeIsBama,
    neutralSite: Boolean(g.neutralSite),
    startDate,
    completed,
    locked,
    alabamaScore,
    opponentScore,
    alabamaWin,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    homeScore,
    awayScore,
    conferenceGame: Boolean(g.conferenceGame),
  };
}

function isGameLocked(startDate, completed) {
  if (completed) return true;
  if (!startDate) return false;
  const kick = new Date(startDate);
  if (!Number.isFinite(kick.getTime())) return false;
  return Date.now() >= kick.getTime();
}

async function fetchAlabamaSchedule(season, apiKey) {
  if (!apiKey) throw new Error("CFBD_API_KEY required");
  const raw = await cfbdGet(
    "/games",
    { year: normalizeSeason(season), team: ALABAMA_SCHOOL, seasonType: "regular" },
    apiKey
  );
  const games = (Array.isArray(raw) ? raw : [])
    .map(mapScheduleGame)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      const ta = a.startDate ? new Date(a.startDate).getTime() : 0;
      const tb = b.startDate ? new Date(b.startDate).getTime() : 0;
      return ta - tb;
    });
  return games;
}

function mapPredictionRow(row) {
  if (!row) return null;
  return {
    cfbdGameId: Number(row.cfbd_game_id),
    week: row.week != null ? Number(row.week) : null,
    opponent: row.opponent_name,
    isHome: Boolean(row.is_home),
    predictedAlabamaWin: Boolean(row.predicted_alabama_win),
    predictedAlabamaScore:
      row.predicted_alabama_score != null ? Number(row.predicted_alabama_score) : null,
    predictedOpponentScore:
      row.predicted_opponent_score != null ? Number(row.predicted_opponent_score) : null,
    isWinnerCorrect: row.is_winner_correct,
    scoreError: row.score_error != null ? Number(row.score_error) : null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

async function loadUserPredictions(userId, seasonYear) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bama_schedule_predictions")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear);
  dbError(error);
  const byGame = new Map();
  for (const row of data || []) {
    byGame.set(Number(row.cfbd_game_id), mapPredictionRow(row));
  }
  return byGame;
}

function gradePrediction(pred, game) {
  if (!game.completed || game.alabamaWin == null) {
    return { isWinnerCorrect: null, scoreError: null };
  }
  const isWinnerCorrect = Boolean(pred.predictedAlabamaWin) === Boolean(game.alabamaWin);
  let scoreError = null;
  const a = pred.predictedAlabamaScore;
  const o = pred.predictedOpponentScore;
  if (
    Number.isFinite(a) &&
    Number.isFinite(o) &&
    game.alabamaScore != null &&
    game.opponentScore != null
  ) {
    scoreError =
      Math.abs(a - game.alabamaScore) + Math.abs(o - game.opponentScore);
  }
  return { isWinnerCorrect, scoreError };
}

async function syncGrades(seasonYear, games) {
  const supabase = getSupabase();
  const completedIds = games.filter((g) => g.completed).map((g) => g.cfbdGameId);
  if (!completedIds.length) return 0;

  const rows = await selectAllPages(() =>
    supabase
      .from("bama_schedule_predictions")
      .select("*")
      .eq("season_year", seasonYear)
      .in("cfbd_game_id", completedIds)
  );

  const gameById = new Map(games.map((g) => [g.cfbdGameId, g]));
  let updated = 0;

  for (const row of rows) {
    const game = gameById.get(Number(row.cfbd_game_id));
    if (!game) continue;
    const pred = mapPredictionRow(row);
    const grades = gradePrediction(pred, game);
    if (
      row.is_winner_correct === grades.isWinnerCorrect &&
      row.score_error === grades.scoreError
    ) {
      continue;
    }
    const { error } = await supabase
      .from("bama_schedule_predictions")
      .update({
        is_winner_correct: grades.isWinnerCorrect,
        score_error: grades.scoreError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    dbError(error);
    updated += 1;
  }
  return updated;
}

async function getScheduleBundle({ season, userId = null, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const games = await fetchAlabamaSchedule(seasonYear, apiKey);
  await syncGrades(seasonYear, games);

  let predictions = new Map();
  if (userId) {
    predictions = await loadUserPredictions(userId, seasonYear);
  }

  const enriched = games.map((g) => {
    const pred = predictions.get(g.cfbdGameId) || null;
    let grades = null;
    if (pred) grades = gradePrediction(pred, g);
    return { ...g, prediction: pred, grades };
  });

  const submittedCount = [...predictions.keys()].length;
  const lockedCount = games.filter((g) => g.locked).length;

  return {
    season: seasonYear,
    team: ALABAMA_SCHOOL,
    games: enriched,
    submittedCount,
    totalGames: games.length,
    lockedCount,
  };
}

function parseScorePair(body) {
  const a = Number(body.predictedAlabamaScore ?? body.predicted_alabama_score);
  const o = Number(body.predictedOpponentScore ?? body.predicted_opponent_score);
  if (!Number.isFinite(a) || !Number.isFinite(o) || a < 0 || o < 0) return null;
  return { alabama: Math.round(a), opponent: Math.round(o) };
}

async function submitPredictions({ userId, season, picks, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const games = await fetchAlabamaSchedule(seasonYear, apiKey);
  const gameById = new Map(games.map((g) => [g.cfbdGameId, g]));

  if (!Array.isArray(picks) || !picks.length) {
    const err = new Error("picks are required");
    err.code = "NO_PICKS";
    throw err;
  }

  const rows = [];
  const lockedGames = [];

  for (const pick of picks) {
    const cfbdGameId = Number(pick.cfbdGameId ?? pick.cfbd_game_id);
    const game = gameById.get(cfbdGameId);
    if (!game) continue;

    if (game.locked) {
      lockedGames.push(cfbdGameId);
      continue;
    }

    const winRaw = pick.predictedAlabamaWin ?? pick.predicted_alabama_win;
    let predictedAlabamaWin;
    if (typeof winRaw === "boolean") predictedAlabamaWin = winRaw;
    else if (winRaw === "win" || winRaw === "W" || winRaw === true) predictedAlabamaWin = true;
    else if (winRaw === "loss" || winRaw === "L" || winRaw === false) predictedAlabamaWin = false;
    else continue;

    const scores = parseScorePair(pick);
    if (!scores) {
      const err = new Error("Each pick needs valid predicted scores");
      err.code = "INVALID_SCORES";
      throw err;
    }

    rows.push({
      user_id: userId,
      season_year: seasonYear,
      cfbd_game_id: cfbdGameId,
      week: game.week,
      opponent_name: game.opponent,
      is_home: game.isHome,
      predicted_alabama_win: predictedAlabamaWin,
      predicted_alabama_score: scores.alabama,
      predicted_opponent_score: scores.opponent,
      updated_at: new Date().toISOString(),
    });
  }

  if (!rows.length) {
    if (lockedGames.length) {
      const err = new Error("All selected games are locked");
      err.code = "GAMES_LOCKED";
      throw err;
    }
    const err = new Error("No valid picks to save");
    err.code = "NO_VALID_PICKS";
    throw err;
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("bama_schedule_predictions").upsert(rows, {
    onConflict: "user_id,cfbd_game_id,season_year",
  });
  dbError(error);

  await syncGrades(seasonYear, games);

  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      activity_type: "bama_schedule_submitted",
      activity_data: { season_year: seasonYear, pick_count: rows.length },
    });
  } catch {
    /* optional */
  }

  return {
    saved: rows.length,
    skippedLocked: lockedGames.length,
    season: seasonYear,
  };
}

async function loadAllPredictions(seasonYear) {
  const supabase = getSupabase();
  return selectAllPages(() =>
    supabase
      .from("bama_schedule_predictions")
      .select("*")
      .eq("season_year", seasonYear)
  );
}

function buildUserLeaderboardEntry(user, preds, gamesById, seasonYear) {
  const bucket = emptyPickBucket();
  let totalScoreError = 0;
  let scoredGames = 0;

  for (const row of preds) {
    const game = gamesById.get(Number(row.cfbd_game_id));
    const pred = mapPredictionRow(row);
    const grades = game ? gradePrediction(pred, game) : {
      isWinnerCorrect: row.is_winner_correct,
      scoreError: row.score_error,
    };

    bucket.totalPicks += 1;
    if (grades.isWinnerCorrect === true) {
      bucket.gradedPicks += 1;
      bucket.correctPicks += 1;
      bucket._gradedChrono.push({
        seasonYear,
        weekNumber: row.week || 0,
        gameNumber: row.cfbd_game_id,
        submittedAt: row.submitted_at ? new Date(row.submitted_at).getTime() : 0,
        correct: true,
      });
    } else if (grades.isWinnerCorrect === false) {
      bucket.gradedPicks += 1;
      bucket.incorrectPicks += 1;
      bucket._gradedChrono.push({
        seasonYear,
        weekNumber: row.week || 0,
        gameNumber: row.cfbd_game_id,
        submittedAt: row.submitted_at ? new Date(row.submitted_at).getTime() : 0,
        correct: false,
      });
    } else {
      bucket.pendingPicks += 1;
    }

    if (grades.scoreError != null && Number.isFinite(grades.scoreError)) {
      totalScoreError += grades.scoreError;
      scoredGames += 1;
    }
  }

  finalizeBucket(bucket);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    ...bucket,
    avgScoreError: scoredGames > 0 ? Math.round((totalScoreError / scoredGames) * 10) / 10 : null,
    predictedGames: preds.length,
  };
}

function rankBamaRows(rows) {
  return [...rows]
    .sort((a, b) => {
      if (b.correctPicks !== a.correctPicks) return b.correctPicks - a.correctPicks;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      const ae = a.avgScoreError != null ? a.avgScoreError : 9999;
      const be = b.avgScoreError != null ? b.avgScoreError : 9999;
      if (ae !== be) return ae - be;
      if (b.predictedGames !== a.predictedGames) return b.predictedGames - a.predictedGames;
      const an = String(a.displayName || a.username || "").toLowerCase();
      const bn = String(b.displayName || b.username || "").toLowerCase();
      return an.localeCompare(bn);
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

async function getLeaderboard({ season, cfbdGameId = null, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const games = await fetchAlabamaSchedule(seasonYear, apiKey);
  await syncGrades(seasonYear, games);
  const gamesById = new Map(games.map((g) => [g.cfbdGameId, g]));

  const users = await listPublicUsers();
  const allPreds = await loadAllPredictions(seasonYear);

  if (cfbdGameId != null && Number.isFinite(Number(cfbdGameId))) {
    const gid = Number(cfbdGameId);
    const game = gamesById.get(gid);
    const preds = allPreds.filter((p) => Number(p.cfbd_game_id) === gid);
    const byUser = new Map(users.map((u) => [Number(u.id), u]));

    const entries = preds
      .map((row) => {
        const u = byUser.get(Number(row.user_id));
        if (!u) return null;
        const pred = mapPredictionRow(row);
        const grades = game ? gradePrediction(pred, game) : {
          isWinnerCorrect: row.is_winner_correct,
          scoreError: row.score_error,
        };
        return {
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          predictedAlabamaWin: pred.predictedAlabamaWin,
          predictedAlabamaScore: pred.predictedAlabamaScore,
          predictedOpponentScore: pred.predictedOpponentScore,
          isWinnerCorrect: grades.isWinnerCorrect,
          scoreError: grades.scoreError,
          submittedAt: pred.submittedAt,
        };
      })
      .filter(Boolean);

    entries.sort((a, b) => {
      const aw = a.isWinnerCorrect === true ? 1 : a.isWinnerCorrect === false ? 0 : -1;
      const bw = b.isWinnerCorrect === true ? 1 : b.isWinnerCorrect === false ? 0 : -1;
      if (bw !== aw) return bw - aw;
      const ae = a.scoreError != null ? a.scoreError : 9999;
      const be = b.scoreError != null ? b.scoreError : 9999;
      if (ae !== be) return ae - be;
      return String(a.displayName || a.username).localeCompare(String(b.displayName || b.username));
    });

    entries.forEach((e, i) => {
      e.rank = i + 1;
    });

    return {
      season: seasonYear,
      scope: "game",
      cfbdGameId: gid,
      game: game || null,
      entries,
      viewerHint:
        "Ranked by correct winner, then closest combined score. Pending until the game finalizes.",
    };
  }

  const predsByUser = new Map();
  for (const row of allPreds) {
    const uid = Number(row.user_id);
    if (!predsByUser.has(uid)) predsByUser.set(uid, []);
    predsByUser.get(uid).push(row);
  }

  const entries = rankBamaRows(
    users
      .map((u) =>
        buildUserLeaderboardEntry(
          u,
          predsByUser.get(Number(u.id)) || [],
          gamesById,
          seasonYear
        )
      )
      .filter((e) => e.totalPicks > 0)
  );

  const withStreaks = entries.filter((e) => e.gradedPicks > 0);
  const hottest = [...withStreaks]
    .filter((e) => e.currentStreak >= 2)
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

  return {
    season: seasonYear,
    scope: "season",
    totalGames: games.length,
    entries,
    highlights: { hottest },
    viewerHint:
      "Season board: correct winners first, then accuracy, then average score margin error.",
  };
}

async function getUserBamaStats(userId, season, apiKey) {
  const seasonYear = normalizeSeason(season);
  const games = await fetchAlabamaSchedule(seasonYear, apiKey);
  await syncGrades(seasonYear, games);
  const gamesById = new Map(games.map((g) => [g.cfbdGameId, g]));

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bama_schedule_predictions")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear);
  dbError(error);

  const users = await listPublicUsers();
  const user = users.find((u) => Number(u.id) === Number(userId));
  if (!user) return null;

  const entry = buildUserLeaderboardEntry(user, data || [], gamesById, seasonYear);
  const predictions = (data || []).map((row) => {
    const game = gamesById.get(Number(row.cfbd_game_id));
    const pred = mapPredictionRow(row);
    return {
      ...pred,
      game: game
        ? {
            opponent: game.opponent,
            week: game.week,
            completed: game.completed,
            alabamaScore: game.alabamaScore,
            opponentScore: game.opponentScore,
            alabamaWin: game.alabamaWin,
          }
        : null,
      grades: game ? gradePrediction(pred, game) : null,
    };
  });

  predictions.sort((a, b) => (a.week || 0) - (b.week || 0));

  return {
    season: seasonYear,
    stats: entry,
    predictions,
  };
}

module.exports = {
  ALABAMA_SCHOOL,
  normalizeSeason,
  fetchAlabamaSchedule,
  getScheduleBundle,
  submitPredictions,
  getLeaderboard,
  getUserBamaStats,
  gradePrediction,
  isGameLocked,
};
