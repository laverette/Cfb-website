/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  findValidPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserPassword,
  findUserById,
} = require("./db");
const { json, parseJsonBody } = require("./_http");
const { signUserToken, jwtSecretOr500 } = require("./_auth");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const mis = jwtSecretOr500();
  if (mis) return mis;

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  const token = String(body.token ?? "").trim();
  const password = body.password != null ? String(body.password) : "";

  if (!token || token.length < 20) {
    return json(400, { message: "Invalid or missing reset token" });
  }
  if (password.length < 8) {
    return json(400, { message: "Password must be at least 8 characters" });
  }

  try {
    const record = await findValidPasswordResetToken(hashToken(token));
    if (!record) {
      return json(400, {
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await updateUserPassword(record.user_id, passwordHash);
    await markPasswordResetTokenUsed(record.id);

    if (!updated) {
      const row = await findUserById(record.user_id);
      if (!row) {
        return json(404, { message: "User not found" });
      }
    }

    const userRow = updated || (await findUserById(record.user_id));
    const jwt = signUserToken(userRow);
    return json(200, {
      message: "Password updated. You are now signed in.",
      token: jwt,
      user: mapUser(userRow),
    });
  } catch (err) {
    console.error("auth-reset-password:", err);
    return json(500, { message: "Could not reset password. Try again." });
  }
};
