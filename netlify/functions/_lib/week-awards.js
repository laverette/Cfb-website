/**
 * Compute weekly pick awards from graded picks + betting lines.
 */
const {
  getSupabase,
  dbError,
  selectAllPages,
  loadCurrentWeek,
  listPublicUsers,
  emptyPickBucket,
  addPickToBucket,
  finalizeBucket,
} = require("../db");

function favoriteEspnId(game) {
  const line = Number(game.betting_line);
  if (!Number.isFinite(line) || line === 0) return null;
  const home = Number(game.home_team_espn_id);
  const away = Number(game.away_team_espn_id);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  // Negative line => home favorite; positive => away favorite (matches UI spreadsForMatchup).
  return line < 0 ? home : away;
}

function playerSnippet(row) {
  if (!row) return null;
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    value: row.value,
    detail: row.detail || null,
  };
}

function pickBest(candidates, compare) {
  if (!candidates.length) return null;
  return [...candidates].sort(compare)[0];
}

async function getWeekAwards(weekIdInput = null) {
  const supabase = getSupabase();
  let weekId =
    weekIdInput != null && Number.isFinite(Number(weekIdInput))
      ? Number(weekIdInput)
      : null;

  let weekRow = null;
  if (weekId) {
    const { data, error } = await supabase
      .from("weeks")
      .select("id, week_number, season_year")
      .eq("id", weekId)
      .maybeSingle();
    dbError(error);
    weekRow = data;
  } else {
    const current = await loadCurrentWeek();
    if (current?.id) {
      weekId = Number(current.id);
      weekRow = {
        id: weekId,
        week_number: current.week_number,
        season_year: current.season_year,
      };
    }
  }

  if (!weekId || !weekRow) {
    return { weekId: null, weekLabel: null, awards: [], message: "No active week" };
  }

  const picks = await selectAllPages(() =>
    supabase
      .from("user_picks")
      .select(
        "user_id, is_correct, is_tie, picked_team_espn_id, submitted_at, games ( game_number, betting_line, home_team_espn_id, away_team_espn_id, is_completed )"
      )
      .eq("week_id", weekId)
  );

  if (!picks.length) {
    return {
      weekId,
      weekLabel: `Week ${weekRow.week_number} (${weekRow.season_year})`,
      awards: [],
      message: "No picks submitted yet",
    };
  }

  const users = await listPublicUsers();
  const userById = new Map(users.map((u) => [Number(u.id), u]));

  const byUser = new Map();
  let maxGameNumber = 0;

  for (const pick of picks) {
    const uid = Number(pick.user_id);
    const u = userById.get(uid) || {};
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        userId: uid,
        username: u.username,
        displayName: u.displayName || u.username,
        avatarUrl: u.avatarUrl ?? null,
        chalkCorrect: 0,
        upsetCorrect: 0,
        clutchCorrect: 0,
        clutchGraded: 0,
        ...emptyPickBucket(),
      });
    }
    const bucket = byUser.get(uid);
    const g = pick.games || {};
    const gameNumber = Number(g.game_number) || 0;
    if (gameNumber > maxGameNumber) maxGameNumber = gameNumber;

    addPickToBucket(
      bucket,
      pick.is_correct,
      {
        weekNumber: Number(weekRow.week_number) || 0,
        seasonYear: Number(weekRow.season_year) || 0,
        gameNumber,
        submittedAt: pick.submitted_at ? new Date(pick.submitted_at).getTime() : 0,
      },
      Boolean(pick.is_tie)
    );

    if (pick.is_correct === true && !pick.is_tie) {
      const fav = favoriteEspnId(g);
      const picked = Number(pick.picked_team_espn_id);
      if (fav != null && Number.isFinite(picked)) {
        if (picked === fav) bucket.chalkCorrect += 1;
        else bucket.upsetCorrect += 1;
      }
    }
  }

  // Clutch = last 3 game numbers
  const clutchGames = new Set();
  for (let n = maxGameNumber; n >= 1 && clutchGames.size < 3; n -= 1) {
    clutchGames.add(n);
  }
  for (const pick of picks) {
    const g = pick.games || {};
    const gameNumber = Number(g.game_number) || 0;
    if (!clutchGames.has(gameNumber)) continue;
    if (pick.is_tie) continue;
    if (pick.is_correct !== true && pick.is_correct !== false) continue;
    const bucket = byUser.get(Number(pick.user_id));
    if (!bucket) continue;
    bucket.clutchGraded += 1;
    if (pick.is_correct === true) bucket.clutchCorrect += 1;
  }

  const players = [...byUser.values()].map((row) => finalizeBucket(row));
  const gradedPlayers = players.filter((p) => p.gradedPicks > 0);
  if (!gradedPlayers.length) {
    return {
      weekId,
      weekLabel: `Week ${weekRow.week_number} (${weekRow.season_year})`,
      awards: [],
      message: "Games still pending — awards unlock as results finalize",
    };
  }

  const awards = [];

  const perfect = gradedPlayers.filter(
    (p) => p.incorrectPicks === 0 && p.correctPicks > 0
  );
  if (perfect.length) {
    const best = pickBest(
      perfect,
      (a, b) =>
        b.correctPicks - a.correctPicks ||
        String(a.username || "").localeCompare(String(b.username || ""))
    );
    awards.push({
      id: "perfect",
      title: "Perfect Week",
      icon: "✨",
      winners: perfect.map((p) =>
        playerSnippet({
          ...p,
          value: `${p.correctPicks}-${p.incorrectPicks}-${p.tiedPicks}`,
          detail: "No losses",
        })
      ),
      headline: perfect.length === 1
        ? `${best.displayName || best.username} is perfect`
        : `${perfect.length} perfect boards`,
    });
  }

  const topDog = pickBest(
    gradedPlayers,
    (a, b) =>
      b.correctPicks - a.correctPicks ||
      b.accuracy - a.accuracy ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (topDog) {
    awards.push({
      id: "top_dog",
      title: "Top Dog",
      icon: "🏆",
      winners: [
        playerSnippet({
          ...topDog,
          value: `${topDog.correctPicks}-${topDog.incorrectPicks}-${topDog.tiedPicks}`,
          detail: `${Number(topDog.accuracy || 0).toFixed(1)}%`,
        }),
      ],
      headline: `${topDog.displayName || topDog.username} leads the board`,
    });
  }

  const chalkiest = pickBest(
    gradedPlayers.filter((p) => p.chalkCorrect > 0),
    (a, b) =>
      b.chalkCorrect - a.chalkCorrect ||
      b.correctPicks - a.correctPicks ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (chalkiest) {
    awards.push({
      id: "chalkiest",
      title: "Chalkiest",
      icon: "📋",
      winners: [
        playerSnippet({
          ...chalkiest,
          value: String(chalkiest.chalkCorrect),
          detail: "correct favorites",
        }),
      ],
      headline: `${chalkiest.displayName || chalkiest.username} rode the chalk`,
    });
  }

  const upsetKing = pickBest(
    gradedPlayers.filter((p) => p.upsetCorrect > 0),
    (a, b) =>
      b.upsetCorrect - a.upsetCorrect ||
      b.correctPicks - a.correctPicks ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (upsetKing) {
    awards.push({
      id: "upset_king",
      title: "Upset King",
      icon: "⚡",
      winners: [
        playerSnippet({
          ...upsetKing,
          value: String(upsetKing.upsetCorrect),
          detail: "correct underdogs",
        }),
      ],
      headline: `${upsetKing.displayName || upsetKing.username} nailed the dogs`,
    });
  }

  const onFire = pickBest(
    gradedPlayers.filter((p) => p.currentStreak >= 3),
    (a, b) =>
      b.currentStreak - a.currentStreak ||
      b.accuracy - a.accuracy ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (onFire) {
    awards.push({
      id: "on_fire",
      title: "On Fire",
      icon: "🔥",
      winners: [
        playerSnippet({
          ...onFire,
          value: String(onFire.currentStreak),
          detail: "pick streak",
        }),
      ],
      headline: `${onFire.displayName || onFire.username} is heating up`,
    });
  }

  const iceCold = pickBest(
    gradedPlayers.filter((p) => p.currentStreak <= -3),
    (a, b) =>
      a.currentStreak - b.currentStreak ||
      a.accuracy - b.accuracy ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (iceCold) {
    awards.push({
      id: "ice_cold",
      title: "Ice Cold",
      icon: "❄️",
      winners: [
        playerSnippet({
          ...iceCold,
          value: String(Math.abs(iceCold.currentStreak)),
          detail: "wrong in a row",
        }),
      ],
      headline: `${iceCold.displayName || iceCold.username} needs a thaw`,
    });
  }

  const clutch = pickBest(
    gradedPlayers.filter((p) => p.clutchGraded > 0),
    (a, b) =>
      b.clutchCorrect - a.clutchCorrect ||
      b.clutchGraded - a.clutchGraded ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (clutch && clutch.clutchCorrect > 0) {
    awards.push({
      id: "clutch",
      title: "Clutch",
      icon: "🎯",
      winners: [
        playerSnippet({
          ...clutch,
          value: `${clutch.clutchCorrect}/${clutch.clutchGraded}`,
          detail: "late games",
        }),
      ],
      headline: `${clutch.displayName || clutch.username} owned the nightcap`,
    });
  }

  return {
    weekId,
    weekLabel: `Week ${weekRow.week_number} (${weekRow.season_year})`,
    awards,
  };
}

module.exports = { getWeekAwards, favoriteEspnId };
