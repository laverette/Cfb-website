/**
 * POST /api/auth/register
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

  let supabase;
  try {
    supabase = getSupabase();
  } catch (e) {
    if (e.code === "NO_DATABASE_URL") {
      return json(500, { message: "Server misconfiguration" });
    }
    throw e;
  }

  let createdUserId = null;
  try {
    const { data: existingU, error: uErr } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    dbError(uErr);
    if (existingU) {
      return json(400, { message: "Username already exists" });
    }

    const { data: existingE, error: eErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    dbError(eErr);
    if (existingE) {
      return json(400, { message: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: created, error: insErr } = await supabase
      .from("users")
      .insert({
        username,
        email,
        password_hash: passwordHash,
        display_name: displayName,
        role: "user",
      })
      .select("id, username, email, display_name, avatar_url, bio, role, created_at")
      .single();
    dbError(insErr);

    if (!created || !created.id) {
      return json(500, { message: "Failed to create user" });
    }
    createdUserId = created.id;

    const { error: profileErr } = await supabase.from("user_profiles").insert({
      user_id: createdUserId,
      total_picks: 0,
      correct_picks: 0,
      accuracy: 0,
    });
    dbError(profileErr);

    const { error: settingsErr } = await supabase.from("user_settings").insert({
      user_id: createdUserId,
      email_notifications: true,
      theme: "dark",
      notifications_enabled: true,
    });
    dbError(settingsErr);

    const token = signUserToken(created);
    return json(200, { token, user: rowToUser(created) });
  } catch (err) {
    if (createdUserId) {
      try {
        await supabase.from("users").delete().eq("id", createdUserId);
      } catch {
        /* ignore */
      }
    }
    console.error("auth-register:", err);
    if (err.code === "23505") {
      return json(400, { message: "Username or email already exists" });
    }
    if (err.code === "NO_JWT_SECRET") {
      return json(500, { message: "Server misconfiguration" });
    }
    return json(500, { message: "Internal server error" });
  }
};
