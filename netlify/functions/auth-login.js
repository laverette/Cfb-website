/**
 * POST /api/auth/login
 * Body: { usernameOrEmail } or { username } or { email }, plus { password }
 */
const bcrypt = require("bcryptjs");
const { findUserByUsernameOrEmail, logUserLogin, getSupabaseConfig } = require("./db");
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

  const usernameOrEmail = String(
    body.usernameOrEmail ?? body.username ?? body.email ?? ""
  ).trim();
  const password = body.password != null ? String(body.password) : "";

  if (!usernameOrEmail || !password) {
    return json(400, { message: "Username or email and password are required" });
  }

  try {
    const row = await findUserByUsernameOrEmail(usernameOrEmail);
    if (!row) {
      return json(401, { message: "Invalid username or password" });
    }

    const hash = row.password_hash != null ? String(row.password_hash) : "";
    if (!hash) {
      return json(401, { message: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return json(401, { message: "Invalid username or password" });
    }

    await logUserLogin(row.id);

    const token = signUserToken(row);
    return json(200, { token, user: rowToUser(row) });
  } catch (err) {
    console.error("auth-login:", err);
    if (err.code === "NO_DATABASE_URL" || err.code === "NO_JWT_SECRET") {
      const { url, key } = getSupabaseConfig();
      const missing = [];
      if (!process.env.JWT_SECRET || !String(process.env.JWT_SECRET).trim()) {
        missing.push("JWT_SECRET");
      }
      if (!url) missing.push("SUPABASE_URL");
      if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
      return json(500, { message: "Server misconfiguration", missing });
    }
    return json(500, { message: "Internal server error" });
  }
};
