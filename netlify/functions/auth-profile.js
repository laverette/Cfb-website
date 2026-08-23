/**
 * GET /api/auth/profile — requires Bearer JWT
 */
const { getSupabase, dbError } = require("./db");
const { json } = require("./_http");
const { requireAuth } = require("./_auth");

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name != null ? row.display_name : row.username,
    role:
      row.role != null && String(row.role).trim() !== ""
        ? String(row.role)
        : "user",
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

function mapProfile(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    favoriteTeamEspnId: r.favorite_team_espn_id ?? null,
    favoriteConference: r.favorite_conference ?? null,
    location: r.location ?? null,
    totalPicks: r.total_picks,
    correctPicks: r.correct_picks,
    accuracy: r.accuracy != null ? Number(r.accuracy) : null,
    currentStreak: r.current_streak,
    bestStreak: r.best_streak,
    ranking: r.ranking ?? null,
    lastPickDate:
      r.last_pick_date instanceof Date
        ? r.last_pick_date.toISOString()
        : r.last_pick_date ?? null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  try {
    const supabase = getSupabase();
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id, username, email, display_name, avatar_url, bio, role, created_at")
      .eq("id", userId)
      .maybeSingle();
    dbError(userErr);
    if (!userRow) {
      return json(404, { message: "User not found" });
    }

    const { data: profileRow, error: profileErr } = await supabase
      .from("user_profiles")
      .select(
        "id, user_id, favorite_team_espn_id, favorite_conference, location, total_picks, correct_picks, accuracy, current_streak, best_streak, ranking, last_pick_date"
      )
      .eq("user_id", userId)
      .maybeSingle();
    dbError(profileErr);

    return json(200, {
      user: mapUser(userRow),
      profile: profileRow ? mapProfile(profileRow) : null,
    });
  } catch (err) {
    console.error("auth-profile:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
