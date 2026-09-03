/**
 * GET /api/auth/profile — requires Bearer JWT
 * PATCH /api/auth/profile — update avatar (avatarId 1–12)
 */
const { findUserById, findProfileByUserId, updateUserAvatar } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const { parseAvatarId, avatarPathForId, AVATAR_COUNT } = require("./_lib/avatars");

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
  const method = event.httpMethod || "GET";
  if (method !== "GET" && method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  try {
    if (method === "GET") {
      const userRow = await findUserById(userId);
      if (!userRow) {
        return json(404, { message: "User not found" });
      }
      const profileRow = await findProfileByUserId(userId);
      return json(200, {
        user: mapUser(userRow),
        profile: profileRow ? mapProfile(profileRow) : null,
      });
    }

    const body = parseJsonBody(event);
    if (!body || typeof body !== "object") {
      return json(400, { message: "Invalid JSON body" });
    }

    const avatarRaw = body.avatarId ?? body.avatar_id ?? body.avatarUrl ?? body.avatar_url;
    const avatarId = parseAvatarId(avatarRaw);
    if (!avatarId) {
      return json(400, {
        message: `Please choose an avatar (1–${AVATAR_COUNT})`,
      });
    }

    const avatarUrl = avatarPathForId(avatarId);
    const updated = await updateUserAvatar(userId, avatarUrl);
    if (!updated) {
      return json(404, { message: "User not found" });
    }
    return json(200, { user: mapUser(updated) });
  } catch (err) {
    console.error("auth-profile:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
