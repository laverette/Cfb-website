/**
 * Team schedule predictions — CFBD ingest, grading, leaderboard.
 * Any FBS team; leaderboard is scoped per team + season.
 */

const CFBD_BASE = "https://api.collegefootballdata.com";
const DEFAULT_TEAM = "Alabama";

const {
  getSupabase,
  dbError,
  selectAllPages,
  listPublicUsers,
  emptyPickBucket,
  finalizeBucket,
} = require("../db");

function normalizeSeason(season) {
  const y = Number(season);
  return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
}

function normalizeTeam(name) {
  const t = String(name || "").trim();
  return t || DEFAULT_TEAM;
}

function sameTeam(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
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

function mapScheduleGame(g, school) {
  const homeIsTeam = sameTeam(g.homeTeam, school);
  const awayIsTeam = sameTeam(g.awayTeam, school);
  if (!homeIsTeam && !awayIsTeam) return null;

  const opponent = homeIsTeam ? g.awayTeam : g.homeTeam;
  const completed = Boolean(g.completed);
  const homeScore = Number.isFinite(Number(g.homePoints)) ? Number(g.homePoints) : null;
  const awayScore = Number.isFinite(Number(g.awayPoints)) ? Number(g.awayPoints) : null;

  let teamScore = null;
  let opponentScore = null;
  let teamWin = null;
  if (completed && homeScore != null && awayScore != null) {
    teamScore = homeIsTeam ? homeScore : awayScore;
    opponentScore = homeIsTeam ? awayScore : homeScore;
    teamWin = teamScore > opponentScore;
  }

  const startDate = g.startDate || null;

  return {
    cfbdGameId: Number(g.id),
    season: Number(g.season),
    week: Number(g.week),
    team: school,
    opponent,
    isHome: homeIsTeam,
    neutralSite: Boolean(g.neutralSite),
    startDate,
    completed,
    locked: isGameLocked(startDate, completed),
    teamScore,
    opponentScore,
    teamWin,
    // Back-compat aliases for existing UI/profile code
    alabamaScore: teamScore,
    alabamaWin: teamWin,
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

async function fetchTeamSchedule(season, team, apiKey) {
  if (!apiKey) throw new Error("CFBD_API_KEY required");
  const school = normalizeTeam(team);
  const raw = await cfbdGet(
    "/games",
    { year: normalizeSeason(season), team: school, seasonType: "regular" },
    apiKey
  );
  return (Array.isArray(raw) ? raw : [])
    .map((g) => mapScheduleGame(g, school))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      const ta = a.startDate ? new Date(a.startDate).getTime() : 0;
      const tb = b.startDate ? new Date(b.startDate).getTime() : 0;
      return ta - tb;
    });
}

function fetchAlabamaSchedule(season, apiKey) {
  return fetchTeamSchedule(season, DEFAULT_TEAM, apiKey);
}

function mapPredictionRow(row) {
  if (!row) return null;
  const predictedTeamWin = Boolean(row.predicted_alabama_win);
  const predictedTeamScore =
    row.predicted_alabama_score != null ? Number(row.predicted_alabama_score) : null;
  return {
    cfbdGameId: Number(row.cfbd_game_id),
    team: row.team_school || DEFAULT_TEAM,
    week: row.week != null ? Number(row.week) : null,
    opponent: row.opponent_name,
    isHome: Boolean(row.is_home),
    predictedTeamWin,
    predictedTeamScore,
    predictedOpponentScore:
      row.predicted_opponent_score != null ? Number(row.predicted_opponent_score) : null,
    predictedAlabamaWin: predictedTeamWin,
    predictedAlabamaScore: predictedTeamScore,
    isWinnerCorrect: row.is_winner_correct,
    scoreError: row.score_error != null ? Number(row.score_error) : null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

async function loadUserPredictions(userId, seasonYear, team) {
  const school = normalizeTeam(team);
  const supabase = getSupabase();
  let query = supabase
    .from("bama_schedule_predictions")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear);

  let { data, error } = await query.eq("team_school", school);
  if (error && /team_school/i.test(String(error.message || ""))) {
    if (!sameTeam(school, DEFAULT_TEAM)) {
      const err = new Error("Run sql/bama_schedule_team_school.sql in Supabase to enable other teams.");
      err.code = "SCHEMA_NEEDS_TEAM";
      throw err;
    }
    const fallback = await supabase
      .from("bama_schedule_predictions")
      .select("*")
      .eq("user_id", userId)
      .eq("season_year", seasonYear);
    dbError(fallback.error);
    data = fallback.data;
    error = null;
  }
  dbError(error);
  const byGame = new Map();
  for (const row of data || []) {
    byGame.set(Number(row.cfbd_game_id), mapPredictionRow(row));
  }
  return byGame;
}

function gradePrediction(pred, game) {
  if (!game.completed || game.teamWin == null) {
    return { isWinnerCorrect: null, scoreError: null };
  }
  const isWinnerCorrect = Boolean(pred.predictedTeamWin) === Boolean(game.teamWin);
  let scoreError = null;
  const a = pred.predictedTeamScore;
  const o = pred.predictedOpponentScore;
  if (
    Number.isFinite(a) &&
    Number.isFinite(o) &&
    game.teamScore != null &&
    game.opponentScore != null
  ) {
    scoreError = Math.abs(a - game.teamScore) + Math.abs(o - game.opponentScore);
  }
  return { isWinnerCorrect, scoreError };
}

async function syncGrades(seasonYear, games, team) {
  const school = normalizeTeam(team);
  const supabase = getSupabase();
  const completedIds = games.filter((g) => g.completed).map((g) => g.cfbdGameId);
  if (!completedIds.length) return 0;

  let rows;
  try {
    rows = await selectAllPages(() =>
      supabase
        .from("bama_schedule_predictions")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("team_school", school)
        .in("cfbd_game_id", completedIds)
    );
  } catch (err) {
    if (!/team_school/i.test(String(err.message || "")) || !sameTeam(school, DEFAULT_TEAM)) {
      throw err;
    }
    rows = await selectAllPages(() =>
      supabase
        .from("bama_schedule_predictions")
        .select("*")
        .eq("season_year", seasonYear)
        .in("cfbd_game_id", completedIds)
    );
  }

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

async function getScheduleBundle({ season, team, userId = null, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const school = normalizeTeam(team);
  const games = await fetchTeamSchedule(seasonYear, school, apiKey);
  await syncGrades(seasonYear, games, school);

  let predictions = new Map();
  if (userId) {
    predictions = await loadUserPredictions(userId, seasonYear, school);
  }

  const enriched = games.map((g) => {
    const pred = predictions.get(g.cfbdGameId) || null;
    return { ...g, prediction: pred, grades: pred ? gradePrediction(pred, g) : null };
  });

  return {
    season: seasonYear,
    team: school,
    games: enriched,
    submittedCount: [...predictions.keys()].length,
    totalGames: games.length,
    lockedCount: games.filter((g) => g.locked).length,
  };
}

function parseScorePair(body) {
  const a = Number(
    body.predictedTeamScore ??
      body.predicted_team_score ??
      body.predictedAlabamaScore ??
      body.predicted_alabama_score
  );
  const o = Number(body.predictedOpponentScore ?? body.predicted_opponent_score);
  if (!Number.isFinite(a) || !Number.isFinite(o) || a < 0 || o < 0) return null;
  return { team: Math.round(a), opponent: Math.round(o) };
}

function parsePredictedWin(pick) {
  const winRaw =
    pick.predictedTeamWin ??
    pick.predicted_team_win ??
    pick.predictedAlabamaWin ??
    pick.predicted_alabama_win;
  if (typeof winRaw === "boolean") return winRaw;
  if (winRaw === "win" || winRaw === "W") return true;
  if (winRaw === "loss" || winRaw === "L") return false;
  return null;
}

async function submitPredictions({ userId, season, team, picks, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const school = normalizeTeam(team);
  const games = await fetchTeamSchedule(seasonYear, school, apiKey);
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

    const predictedTeamWin = parsePredictedWin(pick);
    if (predictedTeamWin == null) continue;

    const scores = parseScorePair(pick);
    if (!scores) {
      const err = new Error("Each pick needs valid predicted scores");
      err.code = "INVALID_SCORES";
      throw err;
    }

    rows.push({
      user_id: userId,
      season_year: seasonYear,
      team_school: school,
      cfbd_game_id: cfbdGameId,
      week: game.week,
      opponent_name: game.opponent,
      is_home: game.isHome,
      predicted_alabama_win: predictedTeamWin,
      predicted_alabama_score: scores.team,
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
    onConflict: "user_id,team_school,cfbd_game_id,season_year",
  });
  if (error && /team_school|there is no unique/i.test(String(error.message || ""))) {
    if (!sameTeam(school, DEFAULT_TEAM)) {
      const err = new Error("Run sql/bama_schedule_team_school.sql in Supabase to enable other teams.");
      err.code = "SCHEMA_NEEDS_TEAM";
      throw err;
    }
    const stripped = rows.map(({ team_school, ...rest }) => rest);
    const retry = await supabase.from("bama_schedule_predictions").upsert(stripped, {
      onConflict: "user_id,cfbd_game_id,season_year",
    });
    dbError(retry.error);
  } else {
    dbError(error);
  }

  await syncGrades(seasonYear, games, school);

  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      activity_type: "schedule_predictions_submitted",
      activity_data: { season_year: seasonYear, team: school, pick_count: rows.length },
    });
  } catch {
    /* optional */
  }

  return {
    saved: rows.length,
    skippedLocked: lockedGames.length,
    season: seasonYear,
    team: school,
  };
}

async function loadAllPredictions(seasonYear, team) {
  const school = normalizeTeam(team);
  const supabase = getSupabase();
  try {
    return await selectAllPages(() =>
      supabase
        .from("bama_schedule_predictions")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("team_school", school)
    );
  } catch (err) {
    if (/team_school/i.test(String(err.message || "")) && sameTeam(school, DEFAULT_TEAM)) {
      return selectAllPages(() =>
        supabase
          .from("bama_schedule_predictions")
          .select("*")
          .eq("season_year", seasonYear)
      );
    }
    throw err;
  }
}

function buildUserLeaderboardEntry(user, preds, gamesById, seasonYear) {
  const bucket = emptyPickBucket();
  let totalScoreError = 0;
  let scoredGames = 0;

  for (const row of preds) {
    const game = gamesById.get(Number(row.cfbd_game_id));
    const pred = mapPredictionRow(row);
    const grades = game
      ? gradePrediction(pred, game)
      : {
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

function rankScheduleRows(rows) {
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

async function getLeaderboard({ season, team, cfbdGameId = null, apiKey }) {
  const seasonYear = normalizeSeason(season);
  const school = normalizeTeam(team);
  const games = await fetchTeamSchedule(seasonYear, school, apiKey);
  await syncGrades(seasonYear, games, school);
  const gamesById = new Map(games.map((g) => [g.cfbdGameId, g]));

  const users = await listPublicUsers();
  const allPreds = await loadAllPredictions(seasonYear, school);

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
        const grades = game
          ? gradePrediction(pred, game)
          : {
              isWinnerCorrect: row.is_winner_correct,
              scoreError: row.score_error,
            };
        return {
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          predictedTeamWin: pred.predictedTeamWin,
          predictedTeamScore: pred.predictedTeamScore,
          predictedAlabamaWin: pred.predictedTeamWin,
          predictedAlabamaScore: pred.predictedTeamScore,
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
      team: school,
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

  const entries = rankScheduleRows(
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
    team: school,
    scope: "season",
    totalGames: games.length,
    entries,
    highlights: { hottest },
    viewerHint:
      "Season board for this team: correct winners first, then accuracy, then average score error.",
  };
}

async function buildSlate(user, rows, gamesById, seasonYear, school) {
  const entry = buildUserLeaderboardEntry(user, rows, gamesById, seasonYear);
  const predictions = rows.map((row) => {
    const game = gamesById.get(Number(row.cfbd_game_id));
    const pred = mapPredictionRow(row);
    return {
      ...pred,
      game: game
        ? {
            opponent: game.opponent,
            week: game.week,
            completed: game.completed,
            teamScore: game.teamScore,
            opponentScore: game.opponentScore,
            teamWin: game.teamWin,
            alabamaScore: game.teamScore,
            alabamaWin: game.teamWin,
          }
        : null,
      grades: game ? gradePrediction(pred, game) : null,
    };
  });
  predictions.sort((a, b) => (a.week || 0) - (b.week || 0));
  return { team: school, season: seasonYear, stats: entry, predictions };
}

async function getUserScheduleStats(userId, season, apiKey, team = null) {
  const seasonYear = normalizeSeason(season);
  const supabase = getSupabase();
  let query = supabase
    .from("bama_schedule_predictions")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear);
  if (team) query = query.eq("team_school", normalizeTeam(team));
  const { data, error } = await query;
  dbError(error);

  const users = await listPublicUsers();
  const user = users.find((u) => Number(u.id) === Number(userId));
  if (!user) return null;

  const byTeam = new Map();
  for (const row of data || []) {
    const school = row.team_school || DEFAULT_TEAM;
    if (!byTeam.has(school)) byTeam.set(school, []);
    byTeam.get(school).push(row);
  }

  const slates = [];
  for (const [school, rows] of byTeam.entries()) {
    const games = await fetchTeamSchedule(seasonYear, school, apiKey);
    await syncGrades(seasonYear, games, school);
    const gamesById = new Map(games.map((g) => [g.cfbdGameId, g]));
    slates.push(await buildSlate(user, rows, gamesById, seasonYear, school));
  }
  slates.sort((a, b) => a.team.localeCompare(b.team));

  const primary = slates[0] || {
    team: team ? normalizeTeam(team) : DEFAULT_TEAM,
    season: seasonYear,
    stats: buildUserLeaderboardEntry(user, [], new Map(), seasonYear),
    predictions: [],
  };

  return {
    season: seasonYear,
    team: primary.team,
    stats: primary.stats,
    predictions: primary.predictions,
    slates,
  };
}

function getUserBamaStats(userId, season, apiKey) {
  return getUserScheduleStats(userId, season, apiKey, null);
}

module.exports = {
  DEFAULT_TEAM,
  ALABAMA_SCHOOL: DEFAULT_TEAM,
  normalizeSeason,
  normalizeTeam,
  fetchTeamSchedule,
  fetchAlabamaSchedule,
  getScheduleBundle,
  submitPredictions,
  getLeaderboard,
  getUserScheduleStats,
  getUserBamaStats,
  gradePrediction,
  isGameLocked,
};
