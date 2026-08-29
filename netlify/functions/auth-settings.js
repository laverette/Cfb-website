/**
 * GET/PATCH /api/auth/settings — notification preferences (Bearer JWT)
 */
const { findUserSettings, updateUserSettings } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");

function mapSettings(row) {
  if (!row) {
    return {
      emailNotifications: false,
      notificationsEnabled: true,
      theme: "dark",
    };
  }
  return {
    emailNotifications: Boolean(row.email_notifications),
    notificationsEnabled: Boolean(row.notifications_enabled),
    theme: row.theme || "dark",
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
      const row = await findUserSettings(userId);
      return json(200, { settings: mapSettings(row) });
    }

    const body = parseJsonBody(event);
    if (!body || typeof body !== "object") {
      return json(400, { message: "Invalid JSON body" });
    }

    const patch = {};
    if (body.emailNotifications !== undefined) {
      patch.emailNotifications = Boolean(body.emailNotifications);
    }
    if (body.notificationsEnabled !== undefined) {
      patch.notificationsEnabled = Boolean(body.notificationsEnabled);
    }
    if (body.theme !== undefined) {
      patch.theme = String(body.theme || "").trim();
    }

    if (!Object.keys(patch).length) {
      return json(400, { message: "No settings to update" });
    }

    const updated = await updateUserSettings(userId, patch);
    return json(200, { settings: mapSettings(updated) });
  } catch (err) {
    console.error("auth-settings:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
