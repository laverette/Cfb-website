/**
 * GET /api/auth/profile — requires Bearer JWT
 * PATCH /api/auth/profile — update avatar, username, and/or password
 *
 * Body (any combination):
 *   { avatarId }
 *   { username }
 *   { currentPassword, newPassword }  // change password while logged in
 */
const bcrypt = require("bcryptjs");
const {
  findUserById,
  findProfileByUserId,
  updateUserAvatar,
  updateUsername,
  updateUserPassword,
} = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAuth, signUserToken } = require("./_auth");
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

    let userRow = await findUserById(userId);
    if (!userRow) {
      return json(404, { message: "User not found" });
    }

    let changed = false;
    let issuedToken = null;

    const avatarRaw = body.avatarId ?? body.avatar_id ?? body.avatarUrl ?? body.avatar_url;
    if (avatarRaw != null && String(avatarRaw).trim() !== "") {
      const avatarId = parseAvatarId(avatarRaw);
      if (!avatarId) {
        return json(400, {
          message: `Please choose an avatar (1–${AVATAR_COUNT})`,
        });
      }
      userRow = await updateUserAvatar(userId, avatarPathForId(avatarId));
      changed = true;
    }

    if (body.username != null && String(body.username).trim() !== "") {
      const nextUsername = String(body.username).trim();
      if (nextUsername !== userRow.username) {
        try {
          userRow = await updateUsername(userId, nextUsername);
          changed = true;
          issuedToken = signUserToken(userRow);
        } catch (err) {
          if (err.code === "USER_EXISTS") {
            return json(400, { message: "Username already taken" });
          }
          if (err.code === "INVALID_USERNAME") {
            return json(400, {
              message:
                err.message ||
                "Username must be 3–50 characters (letters, numbers, underscores)",
            });
          }
          throw err;
        }
      }
    }

    const currentPassword =
      body.currentPassword != null ? String(body.currentPassword) : "";
    const newPassword = body.newPassword != null ? String(body.newPassword) : "";
    if (currentPassword || newPassword) {
      if (!currentPassword || !newPassword) {
        return json(400, {
          message: "Both currentPassword and newPassword are required",
        });
      }
      if (newPassword.length < 8) {
        return json(400, { message: "New password must be at least 8 characters" });
      }
      const fresh = await findUserById(userId);
      const hash = fresh && fresh.password_hash != null ? String(fresh.password_hash) : "";
      const ok = hash ? await bcrypt.compare(currentPassword, hash) : false;
      if (!ok) {
        return json(401, { message: "Current password is incorrect" });
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      userRow = await updateUserPassword(userId, passwordHash);
      changed = true;
    }

    if (!changed) {
      return json(400, {
        message: "Nothing to update. Send avatarId, username, and/or password fields.",
      });
    }

    const payload = { user: mapUser(userRow) };
    if (issuedToken) payload.token = issuedToken;
    return json(200, payload);
  } catch (err) {
    console.error("auth-profile:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "23505") {
      return json(400, { message: "Username already taken" });
    }
    return json(500, { error: "Internal server error" });
  }
};
