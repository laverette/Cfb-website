/**
 * POST /api/auth/login
 * Body: { usernameOrEmail } or { username } or { email }, plus { password }
 */
const bcrypt = require("bcryptjs");
const { getSupabase, dbError } = require("./db");
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

async function logLogin(supabase, userId) {
  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      activity_type: "login",
      activity_data: { login_time: new Date().toISOString() },
    });
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
    const supabase = getSupabase();
    const userCols =
      "id, username, email, password_hash, display_name, avatar_url, bio, role, created_at";
    const { data: byUsername, error: userErr } = await supabase
      .from("users")
      .select(userCols)
      .eq("username", usernameOrEmail)
      .maybeSingle();
    dbError(userErr);

    let row = byUsername;
    if (!row) {
      const { data: byEmail, error: emailErr } = await supabase
        .from("users")
        .select(userCols)
        .eq("email", usernameOrEmail)
        .maybeSingle();
      dbError(emailErr);
      row = byEmail;
    }

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

    await logLogin(supabase, row.id);

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
