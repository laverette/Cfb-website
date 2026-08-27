/**
 * CFP bracket persistence, public views, and leaderboard grading.
 */

const {
  getSupabase,
  dbError,
  selectAllPages,
  listPublicUsers,
  findUserByUsername,
  findUserById,
} = require("../db");

const GAME_ORDER = [
  "frL1",
  "frL2",
  "frR1",
  "frR2",
  "qfL1",
  "qfL2",
  "qfR1",
  "qfR2",
  "sfL",
  "sfR",
  "champ",
];

function normalizeSeason(season) {
  const y = Number(season);
  return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
}

function championFromState(slots, picks) {
  const winSlot = picks && picks.champ;
  if (!winSlot || !slots || !slots[winSlot]) return null;
  return slots[winSlot].name || null;
}

function isBracketComplete(teams, picks) {
  if (!teams || !picks) return false;
  for (let i = 1; i <= 12; i += 1) {
    if (!teams[i] && !teams[String(i)]) return false;
  }
  return GAME_ORDER.every((g) => Boolean(picks[g]));
}

function gradeBracket(picks, slots, officialResults) {
  if (!officialResults || typeof officialResults !== "object") {
    return { correctPicks: 0, gradedPicks: 0 };
  }
  let correct = 0;
  let graded = 0;
  for (const gameId of GAME_ORDER) {
    const official = officialResults[gameId];
    if (!official || !official.winnerName) continue;
    graded += 1;
    const winSlot = picks && picks[gameId];
    const predicted = winSlot && slots && slots[winSlot] ? slots[winSlot].name : null;
    if (
      predicted &&
      String(predicted).trim().toLowerCase() ===
        String(official.winnerName).trim().toLowerCase()
    ) {
      correct += 1;
    }
  }
  return { correctPicks: correct, gradedPicks: graded };
}

function mapBracketRow(row, user = null) {
  if (!row) return null;
  return {
    id: row.id,
    userId: Number(row.user_id),
    username: user ? user.username : null,
    displayName: user
      ? user.displayName || user.display_name || user.username
      : null,
    season: Number(row.season_year),
    teams: row.teams || {},
    slots: row.slots || {},
    picks: row.picks || {},
    championName: row.champion_name || null,
    isComplete: Boolean(row.is_complete),
    correctPicks: Number(row.correct_picks) || 0,
    gradedPicks: Number(row.graded_picks) || 0,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

async function loadOfficialResults(seasonYear) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cfp_official_results")
    .select("*")
    .eq("season_year", seasonYear)
    .maybeSingle();
  dbError(error);
  return data || null;
}

async function getBracketForUser(userId, season) {
  const seasonYear = normalizeSeason(season);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cfp_brackets")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", seasonYear)
    .maybeSingle();
  dbError(error);
  if (!data) {
    return {
      season: seasonYear,
      bracket: null,
      officialResults: (await loadOfficialResults(seasonYear))?.results || null,
    };
  }
  const user = await findUserById(userId);
  return {
    season: seasonYear,
    bracket: mapBracketRow(data, user),
    officialResults: (await loadOfficialResults(seasonYear))?.results || null,
  };
}

async function getBracketByUsername(username, season) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const bundle = await getBracketForUser(user.id, season);
  if (bundle.bracket) {
    bundle.bracket.username = user.username;
    bundle.bracket.displayName =
      user.display_name != null ? user.display_name : user.username;
  }
  return bundle;
}

async function saveBracket({ userId, season, teams, slots, picks }) {
  const seasonYear = normalizeSeason(season);
  const teamsObj = teams && typeof teams === "object" ? teams : {};
  const slotsObj = slots && typeof slots === "object" ? slots : {};
  const picksObj = picks && typeof picks === "object" ? picks : {};

  // Require all 12 seeds
  for (let i = 1; i <= 12; i += 1) {
    const name = teamsObj[i] || teamsObj[String(i)];
    if (!name || !String(name).trim()) {
      const err = new Error("Pick all 12 seeds before saving");
      err.code = "INCOMPLETE_SEEDS";
      throw err;
    }
  }

  const championName = championFromState(slotsObj, picksObj);
  const complete = isBracketComplete(teamsObj, picksObj);
  const official = await loadOfficialResults(seasonYear);
  const grades = gradeBracket(picksObj, slotsObj, official?.results || null);

  const row = {
    user_id: userId,
    season_year: seasonYear,
    teams: teamsObj,
    slots: slotsObj,
    picks: picksObj,
    champion_name: championName,
    is_complete: complete,
    correct_picks: grades.correctPicks,
    graded_picks: grades.gradedPicks,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cfp_brackets")
    .upsert(row, { onConflict: "user_id,season_year" })
    .select("*")
    .maybeSingle();
  dbError(error);

  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      activity_type: "cfp_bracket_saved",
      activity_data: { season_year: seasonYear, complete },
    });
  } catch {
    /* optional */
  }

  const user = await findUserById(userId);
  return mapBracketRow(data, user);
}

async function deleteBracket({ userId, season }) {
  const seasonYear = normalizeSeason(season);
  const supabase = getSupabase();
  const { error } = await supabase
    .from("cfp_brackets")
    .delete()
    .eq("user_id", userId)
    .eq("season_year", seasonYear);
  dbError(error);
  return { deleted: true, season: seasonYear };
}

async function regradeSeason(seasonYear) {
  const official = await loadOfficialResults(seasonYear);
  const results = official?.results || null;
  const supabase = getSupabase();
  const rows = await selectAllPages(() =>
    supabase.from("cfp_brackets").select("*").eq("season_year", seasonYear)
  );
  let updated = 0;
  for (const row of rows) {
    const grades = gradeBracket(row.picks, row.slots, results);
    if (
      row.correct_picks === grades.correctPicks &&
      row.graded_picks === grades.gradedPicks
    ) {
      continue;
    }
    const { error } = await supabase
      .from("cfp_brackets")
      .update({
        correct_picks: grades.correctPicks,
        graded_picks: grades.gradedPicks,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    dbError(error);
    updated += 1;
  }
  return updated;
}

async function saveOfficialResults({ season, results, locked = false }) {
  const seasonYear = normalizeSeason(season);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cfp_official_results")
    .upsert(
      {
        season_year: seasonYear,
        results: results || {},
        locked: Boolean(locked),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season_year" }
    )
    .select("*")
    .maybeSingle();
  dbError(error);
  const regraded = await regradeSeason(seasonYear);
  return { results: data, regraded };
}

async function getLeaderboard(season) {
  const seasonYear = normalizeSeason(season);
  const supabase = getSupabase();
  const users = await listPublicUsers();
  const byId = new Map(users.map((u) => [Number(u.id), u]));
  const rows = await selectAllPages(() =>
    supabase
      .from("cfp_brackets")
      .select("*")
      .eq("season_year", seasonYear)
      .order("correct_picks", { ascending: false })
  );

  const entries = rows
    .map((row) => {
      const u = byId.get(Number(row.user_id));
      if (!u) return null;
      return {
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        championName: row.champion_name,
        isComplete: Boolean(row.is_complete),
        correctPicks: Number(row.correct_picks) || 0,
        gradedPicks: Number(row.graded_picks) || 0,
        accuracy:
          Number(row.graded_picks) > 0
            ? Math.round(
                (Number(row.correct_picks) / Number(row.graded_picks)) * 1000
              ) / 10
            : null,
        updatedAt: row.updated_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.correctPicks !== a.correctPicks) return b.correctPicks - a.correctPicks;
      if ((b.accuracy || 0) !== (a.accuracy || 0)) return (b.accuracy || 0) - (a.accuracy || 0);
      if (Number(b.isComplete) !== Number(a.isComplete)) {
        return Number(b.isComplete) - Number(a.isComplete);
      }
      return String(a.displayName || a.username).localeCompare(
        String(b.displayName || b.username)
      );
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const official = await loadOfficialResults(seasonYear);

  return {
    season: seasonYear,
    entries,
    hasOfficialResults: Boolean(
      official && official.results && Object.keys(official.results).length
    ),
    viewerHint: official?.results
      ? "Ranked by correct playoff picks vs official results."
      : "Brackets are saved. Leaderboard scoring starts once official results are posted.",
  };
}

async function getUserCfpSummary(userId, season) {
  const seasonYear = normalizeSeason(season);
  const bundle = await getBracketForUser(userId, seasonYear);
  if (!bundle.bracket) {
    return { season: seasonYear, bracket: null };
  }
  const b = bundle.bracket;
  return {
    season: seasonYear,
    bracket: {
      championName: b.championName,
      isComplete: b.isComplete,
      correctPicks: b.correctPicks,
      gradedPicks: b.gradedPicks,
      accuracy:
        b.gradedPicks > 0
          ? Math.round((b.correctPicks / b.gradedPicks) * 1000) / 10
          : null,
      updatedAt: b.updatedAt,
      username: b.username,
      displayName: b.displayName,
    },
  };
}

module.exports = {
  GAME_ORDER,
  normalizeSeason,
  getBracketForUser,
  getBracketByUsername,
  saveBracket,
  deleteBracket,
  getLeaderboard,
  saveOfficialResults,
  loadOfficialResults,
  gradeBracket,
  getUserCfpSummary,
};
