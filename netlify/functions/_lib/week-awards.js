/**
 * Compute weekly pick awards from graded picks + betting lines.
 *
 * Soft spread: a dominant board (e.g. 12-0) should still win the majority of
 * awards, but not every specialty. Excess wins are handed to the next-best
 * eligible player for that category.
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

function displayOf(p) {
  return p?.displayName || p?.username || "Player";
}

function uidOf(p) {
  return p?.userId != null ? Number(p.userId) : null;
}

/** Lower = strip first when someone is over the majority cap. Perfect never strips. */
const AWARD_STRIP_PRIORITY = {
  upset_king: 10,
  chalkiest: 20,
  clutch: 30,
  on_fire: 40,
  top_dog: 50,
  ice_cold: 60,
  perfect: 1000,
};

function majorityCap(positiveAwardCount) {
  if (positiveAwardCount <= 1) return positiveAwardCount;
  // Keep a true majority (e.g. 5 → 3, 6 → 4, 4 → 3).
  return Math.floor(positiveAwardCount / 2) + 1;
}

function buildAward(id, title, icon, winners, headline) {
  return { id, title, icon, winners, headline };
}

/**
 * Soft-spread: if any user wins more than `cap` positive awards, reassign their
 * lowest-priority awards to the next-best candidate for that category.
 */
function spreadAwards(awards, { candidatesByAward, cap }) {
  const positive = awards.filter((a) => a.id !== "ice_cold");
  const maxKeep = Math.max(1, Number(cap) || majorityCap(positive.length));

  const countWins = () => {
    const map = new Map();
    for (const a of awards) {
      if (a.id === "ice_cold") continue;
      for (const w of a.winners || []) {
        const id = uidOf(w);
        if (id == null) continue;
        map.set(id, (map.get(id) || 0) + 1);
      }
    }
    return map;
  };

  const winnerIds = (award) =>
    new Set((award.winners || []).map(uidOf).filter((id) => id != null));

  // Reassign until nobody exceeds the majority cap (or we run out of alternatives).
  for (let guard = 0; guard < 24; guard += 1) {
    const wins = countWins();
    const over = [...wins.entries()]
      .filter(([, n]) => n > maxKeep)
      .sort((a, b) => b[1] - a[1]);
    if (!over.length) break;

    const [overUserId] = over[0];
    const stripCandidates = awards
      .filter((a) => a.id !== "perfect" && a.id !== "ice_cold")
      .filter((a) => winnerIds(a).has(overUserId))
      .sort(
        (a, b) =>
          (AWARD_STRIP_PRIORITY[a.id] || 0) - (AWARD_STRIP_PRIORITY[b.id] || 0)
      );

    let reassigned = false;
    for (const award of stripCandidates) {
      if ((wins.get(overUserId) || 0) <= maxKeep) break;
      const compare = candidatesByAward[award.id]?.compare;
      const pool = candidatesByAward[award.id]?.pool || [];
      if (!compare || !pool.length) continue;

      const next = pickBest(
        pool.filter((p) => {
          const id = uidOf(p);
          if (id == null || id === overUserId) return false;
          // Prefer people under the cap; allow anyone else if needed.
          return true;
        }),
        (a, b) => {
          const wa = wins.get(uidOf(a)) || 0;
          const wb = wins.get(uidOf(b)) || 0;
          // Prefer players who still have room under the majority cap.
          const roomA = wa < maxKeep ? 0 : 1;
          const roomB = wb < maxKeep ? 0 : 1;
          if (roomA !== roomB) return roomA - roomB;
          return compare(a, b);
        }
      );
      if (!next) continue;

      const built = candidatesByAward[award.id].build(next);
      if (!built) continue;
      award.winners = built.winners;
      award.headline = built.headline;
      wins.set(overUserId, (wins.get(overUserId) || 1) - 1);
      const nid = uidOf(next);
      if (nid != null) wins.set(nid, (wins.get(nid) || 0) + 1);
      reassigned = true;
      break;
    }
    if (!reassigned) break;
  }

  return awards;
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
  const candidatesByAward = {};

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
    awards.push(
      buildAward(
        "perfect",
        "Perfect Week",
        "✨",
        perfect.map((p) =>
          playerSnippet({
            ...p,
            value: `${p.correctPicks}-${p.incorrectPicks}-${p.tiedPicks}`,
            detail: "No losses",
          })
        ),
        perfect.length === 1
          ? `${displayOf(best)} is perfect`
          : `${perfect.length} perfect boards`
      )
    );
  }

  const topDogCompare = (a, b) =>
    b.correctPicks - a.correctPicks ||
    b.accuracy - a.accuracy ||
    String(a.username || "").localeCompare(String(b.username || ""));
  const topDog = pickBest(gradedPlayers, topDogCompare);
  candidatesByAward.top_dog = {
    pool: gradedPlayers,
    compare: topDogCompare,
    build: (p) => ({
      winners: [
        playerSnippet({
          ...p,
          value: `${p.correctPicks}-${p.incorrectPicks}-${p.tiedPicks}`,
          detail: `${Number(p.accuracy || 0).toFixed(1)}%`,
        }),
      ],
      headline: `${displayOf(p)} leads the board`,
    }),
  };
  // Skip Top Dog when Perfect Week already crowns the same lone leader (redundant).
  const topDogRedundant =
    perfect.length === 1 &&
    topDog &&
    uidOf(perfect[0]) === uidOf(topDog);
  if (topDog && !topDogRedundant) {
    awards.push(
      buildAward(
        "top_dog",
        "Top Dog",
        "🏆",
        candidatesByAward.top_dog.build(topDog).winners,
        candidatesByAward.top_dog.build(topDog).headline
      )
    );
  }

  const chalkCompare = (a, b) =>
    b.chalkCorrect - a.chalkCorrect ||
    b.correctPicks - a.correctPicks ||
    String(a.username || "").localeCompare(String(b.username || ""));
  const chalkPool = gradedPlayers.filter((p) => p.chalkCorrect > 0);
  const chalkiest = pickBest(chalkPool, chalkCompare);
  candidatesByAward.chalkiest = {
    pool: chalkPool,
    compare: chalkCompare,
    build: (p) => ({
      winners: [
        playerSnippet({
          ...p,
          value: String(p.chalkCorrect),
          detail: "correct favorites",
        }),
      ],
      headline: `${displayOf(p)} rode the chalk`,
    }),
  };
  if (chalkiest) {
    const built = candidatesByAward.chalkiest.build(chalkiest);
    awards.push(buildAward("chalkiest", "Chalkiest", "📋", built.winners, built.headline));
  }

  const upsetCompare = (a, b) =>
    b.upsetCorrect - a.upsetCorrect ||
    b.correctPicks - a.correctPicks ||
    String(a.username || "").localeCompare(String(b.username || ""));
  const upsetPool = gradedPlayers.filter((p) => p.upsetCorrect > 0);
  const upsetKing = pickBest(upsetPool, upsetCompare);
  candidatesByAward.upset_king = {
    pool: upsetPool,
    compare: upsetCompare,
    build: (p) => ({
      winners: [
        playerSnippet({
          ...p,
          value: String(p.upsetCorrect),
          detail: "correct underdogs",
        }),
      ],
      headline: `${displayOf(p)} nailed the dogs`,
    }),
  };
  if (upsetKing) {
    const built = candidatesByAward.upset_king.build(upsetKing);
    awards.push(buildAward("upset_king", "Upset King", "⚡", built.winners, built.headline));
  }

  const fireCompare = (a, b) =>
    b.currentStreak - a.currentStreak ||
    b.accuracy - a.accuracy ||
    String(a.username || "").localeCompare(String(b.username || ""));
  const firePool = gradedPlayers.filter((p) => p.currentStreak >= 3);
  const onFire = pickBest(firePool, fireCompare);
  candidatesByAward.on_fire = {
    pool: firePool,
    compare: fireCompare,
    build: (p) => ({
      winners: [
        playerSnippet({
          ...p,
          value: String(p.currentStreak),
          detail: "pick streak",
        }),
      ],
      headline: `${displayOf(p)} is heating up`,
    }),
  };
  if (onFire) {
    const built = candidatesByAward.on_fire.build(onFire);
    awards.push(buildAward("on_fire", "On Fire", "🔥", built.winners, built.headline));
  }

  const iceCold = pickBest(
    gradedPlayers.filter((p) => p.currentStreak <= -3),
    (a, b) =>
      a.currentStreak - b.currentStreak ||
      a.accuracy - b.accuracy ||
      String(a.username || "").localeCompare(String(b.username || ""))
  );
  if (iceCold) {
    awards.push(
      buildAward(
        "ice_cold",
        "Ice Cold",
        "❄️",
        [
          playerSnippet({
            ...iceCold,
            value: String(Math.abs(iceCold.currentStreak)),
            detail: "wrong in a row",
          }),
        ],
        `${displayOf(iceCold)} needs a thaw`
      )
    );
  }

  const clutchCompare = (a, b) =>
    b.clutchCorrect - a.clutchCorrect ||
    b.clutchGraded - a.clutchGraded ||
    String(a.username || "").localeCompare(String(b.username || ""));
  const clutchPool = gradedPlayers.filter((p) => p.clutchGraded > 0 && p.clutchCorrect > 0);
  const clutch = pickBest(clutchPool, clutchCompare);
  candidatesByAward.clutch = {
    pool: clutchPool,
    compare: clutchCompare,
    build: (p) => ({
      winners: [
        playerSnippet({
          ...p,
          value: `${p.clutchCorrect}/${p.clutchGraded}`,
          detail: "late games",
        }),
      ],
      headline: `${displayOf(p)} owned the nightcap`,
    }),
  };
  if (clutch) {
    const built = candidatesByAward.clutch.build(clutch);
    awards.push(buildAward("clutch", "Clutch", "🎯", built.winners, built.headline));
  }

  const positiveCount = awards.filter((a) => a.id !== "ice_cold").length;
  spreadAwards(awards, {
    candidatesByAward,
    cap: majorityCap(positiveCount),
  });

  return {
    weekId,
    weekLabel: `Week ${weekRow.week_number} (${weekRow.season_year})`,
    awards,
  };
}

module.exports = { getWeekAwards, favoriteEspnId, majorityCap };
