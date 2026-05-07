/**
 * POST /api/auth/login
 * Body: { usernameOrEmail } or { username } or { email }, plus { password }
 */
const bcrypt = require("bcryptjs");
const { getPool } = require("./db");
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

async function logLogin(pool, userId) {
  try {
    await pool.query(
      `INSERT INTO UserActivity (user_id, activity_type, activity_data, created_at)
       VALUES (?, 'login', JSON_OBJECT('login_time', NOW(3)), NOW(3))`,
      [userId]
    );
  } catch {
    /* optional */
  }
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
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, username, email, password_hash, display_name, avatar_url, bio, role, created_at
       FROM Users
       WHERE username = ? OR email = ?
       LIMIT 2`,
      [usernameOrEmail, usernameOrEmail]
    );

    if (!rows.length) {
      return json(401, { message: "Invalid username or password" });
    }

    const row = rows[0];
    const hash = row.password_hash != null ? String(row.password_hash) : "";
    if (!hash) {
      return json(401, { message: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return json(401, { message: "Invalid username or password" });
    }

    await logLogin(pool, row.id);

    const token = signUserToken(row);
    const user = rowToUser(row);
    return json(200, { token, user });
  } catch (err) {
    console.error("auth-login:", err);
    if (err.code === "NO_DATABASE_URL" || err.code === "NO_JWT_SECRET") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  }
};
