/**
 * GET /api/auth/profile — requires Bearer JWT
 */
const { getPool } = require("./db");
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
    const pool = getPool();
    const [users] = await pool.query(
      `SELECT id, username, email, display_name, avatar_url, bio, role, created_at
       FROM Users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return json(404, { message: "User not found" });
    }

    const [profiles] = await pool.query(
      `SELECT id, user_id, favorite_team_espn_id, favorite_conference, location,
              total_picks, correct_picks, accuracy, current_streak, best_streak, ranking, last_pick_date
       FROM UserProfiles WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    const user = mapUser(users[0]);
    const profile = profiles.length ? mapProfile(profiles[0]) : null;
    return json(200, { user, profile });
  } catch (err) {
    console.error("auth-profile:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
