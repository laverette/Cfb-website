/**
 * POST /api/auth/avatar
 * Auth required. Body JSON: { imageBase64, mimeType }
 * Uploads to Supabase Storage (avatars bucket) and updates users.avatar_url.
 */
const { getSupabase, findUserById, updateUserAvatar } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");

const BUCKET = "avatars";
const MAX_BYTES = 1024 * 1024; // 1 MB
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

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

function stripDataUrl(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) return { mime: m[1].toLowerCase(), base64: m[2] };
  return { mime: null, base64: s.replace(/\s+/g, "") };
}

function decodeBase64(base64) {
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

async function clearUserAvatarFolder(supabase, userId) {
  const folder = String(userId);
  const { data: existing, error } = await supabase.storage.from(BUCKET).list(folder);
  if (error || !Array.isArray(existing) || !existing.length) return;
  const paths = existing
    .map((f) => f && f.name)
    .filter(Boolean)
    .map((name) => `${folder}/${name}`);
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
}

exports.handler = async (event) => {
  const method = event.httpMethod || "POST";
  if (method === "OPTIONS") {
    return json(204, {});
  }
  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return json(401, { error: "Authentication required" });
  }

  try {
    const body = parseJsonBody(event);
    if (!body || typeof body !== "object") {
      return json(400, { message: "Invalid JSON body" });
    }

    const rawImage = body.imageBase64 ?? body.image ?? body.data ?? "";
    if (!rawImage || String(rawImage).trim() === "") {
      return json(400, { message: "imageBase64 is required" });
    }

    const parsed = stripDataUrl(rawImage);
    const mime = String(body.mimeType || body.contentType || parsed.mime || "")
      .trim()
      .toLowerCase();
    const ext = ALLOWED.get(mime);
    if (!ext) {
      return json(400, {
        message: "Use a JPEG, PNG, or WebP image",
      });
    }

    const buffer = decodeBase64(parsed.base64);
    if (!buffer || !buffer.length) {
      return json(400, { message: "Could not decode image data" });
    }
    if (buffer.length > MAX_BYTES) {
      return json(400, { message: "Image must be 1 MB or smaller" });
    }

    const userRow = await findUserById(userId);
    if (!userRow) {
      return json(404, { message: "User not found" });
    }

    const supabase = getSupabase();
    await clearUserAvatarFolder(supabase, userId);

    const objectPath = `${userId}/avatar.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buffer, {
        contentType: mime === "image/jpg" ? "image/jpeg" : mime,
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadErr) {
      console.error("avatar upload:", uploadErr);
      return json(500, {
        error: "Upload failed",
        details: String(uploadErr.message || uploadErr).slice(0, 200),
      });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;
    const updated = await updateUserAvatar(userId, publicUrl);

    return json(200, {
      user: mapUser(updated),
      avatarUrl: publicUrl,
      message: "Avatar updated",
    });
  } catch (err) {
    console.error("auth-avatar-upload:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
