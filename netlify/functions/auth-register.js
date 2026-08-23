/**
 * POST /api/auth/register
 */
const bcrypt = require("bcryptjs");
const { registerUser } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { signUserToken, jwtSecretOr500 } = require("./_auth");

function rowToUser(row) {
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

  const username = String(body.username ?? "").trim();
  const email = String(body.email ?? "").trim();
  const password = body.password != null ? String(body.password) : "";
  const displayNameRaw = body.displayName ?? body.display_name;
  const displayName =
    displayNameRaw != null && String(displayNameRaw).trim() !== ""
      ? String(displayNameRaw).trim()
      : username;

  const errors = [];
  if (username.length < 3) errors.push("Username must be at least 3 characters");
  if (username.length > 50) errors.push("Username must be at most 50 characters");
  if (!email || !email.includes("@")) errors.push("Valid email is required");
  if (password.length < 8) errors.push("Password must be at least 8 characters");

  if (errors.length) {
    return json(400, { message: "Validation failed", errors });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await registerUser({
      username,
      email,
      passwordHash,
      displayName,
    });
    if (!created || !created.id) {
      return json(500, { message: "Failed to create user" });
    }
    const token = signUserToken(created);
    return json(200, { token, user: rowToUser(created) });
  } catch (err) {
    console.error("auth-register:", err);
    if (err.code === "USER_EXISTS") {
      return json(400, { message: "Username already exists" });
    }
    if (err.code === "EMAIL_EXISTS") {
      return json(400, { message: "Email already exists" });
    }
    if (err.code === "23505" || err.code === "ER_DUP_ENTRY") {
      return json(400, { message: "Username or email already exists" });
    }
    if (err.code === "NO_DATABASE_URL" || err.code === "NO_JWT_SECRET") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  }
};
