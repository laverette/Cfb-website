/**
 * GET /api/users/public?username=foo  OR  /api/users/public?id=123
 * Public profile + pick stats (no email / secrets).
 */
const { json } = require("./_http");
const { getPublicUserProfile } = require("./db");
const { getUserBamaStats, normalizeSeason } = require("./_lib/bama-schedule");
const { getUserCfpSummary } = require("./_lib/cfp-brackets");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const username = q.username != null ? String(q.username).trim() : "";
  const idRaw = q.id != null ? String(q.id).trim() : "";
  const userId = idRaw ? Number(idRaw) : null;

  if (!username && !Number.isFinite(userId)) {
    return json(400, { error: "Provide username or id" });
  }

  try {
    const profile = await getPublicUserProfile({
      username: username || null,
      userId: Number.isFinite(userId) ? userId : null,
    });
    if (!profile) return json(404, { error: "User not found" });

    const season = normalizeSeason(q.bamaSeason ?? q.season ?? new Date().getFullYear());
    const apiKey = process.env.CFBD_API_KEY;
    if (apiKey && profile.user && profile.user.id != null) {
      try {
        profile.bamaSchedule = await getUserBamaStats(profile.user.id, season, apiKey);
      } catch (err) {
        console.warn("user-public-profile bama stats:", err.message || err);
      }
    }

    if (profile.user && profile.user.id != null) {
      try {
        profile.cfpBracket = await getUserCfpSummary(profile.user.id, season);
      } catch (err) {
        console.warn("user-public-profile cfp bracket:", err.message || err);
      }
    }

    return json(200, profile);
  } catch (err) {
    console.error("user-public-profile:", err);
    return json(500, {
      error: "Failed to load profile",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
