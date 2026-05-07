/**
 * POST /api/auth/register
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

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    if (e.code === "NO_DATABASE_URL") {
      return json(500, { message: "Server misconfiguration" });
    }
    throw e;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existingU] = await conn.query(
      "SELECT id FROM Users WHERE username = ? LIMIT 1",
      [username]
    );
    if (existingU.length) {
      await conn.rollback();
      return json(400, { message: "Username already exists" });
    }

    const [existingE] = await conn.query(
      "SELECT id FROM Users WHERE email = ? LIMIT 1",
      [email]
    );
    if (existingE.length) {
      await conn.rollback();
      return json(400, { message: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [ins] = await conn.query(
      `INSERT INTO Users (username, email, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', NOW(3), NOW(3))`,
      [username, email, passwordHash, displayName]
    );

    const userId = ins.insertId;
    if (!userId) {
      await conn.rollback();
      return json(500, { message: "Failed to create user" });
    }

    await conn.query(
      `INSERT INTO UserProfiles (user_id, total_picks, correct_picks, accuracy)
       VALUES (?, 0, 0, 0.00)`,
      [userId]
    );

    await conn.query(
      `INSERT INTO UserSettings (user_id, email_notifications, theme, notifications_enabled)
       VALUES (?, TRUE, 'dark', TRUE)`,
      [userId]
    );

    const [created] = await conn.query(
      `SELECT id, username, email, display_name, avatar_url, bio, role, created_at
       FROM Users WHERE id = ? LIMIT 1`,
      [userId]
    );

    await conn.commit();

    if (!created.length) {
      return json(500, { message: "Failed to load new user" });
    }

    const row = created[0];
    const token = signUserToken(row);
    return json(200, { token, user: rowToUser(row) });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
    }
    console.error("auth-register:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return json(400, { message: "Username or email already exists" });
    }
    if (err.code === "NO_JWT_SECRET") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};
