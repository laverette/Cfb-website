/**
 * GET /api/player?id=5141629&team=Alabama&name=Keelon%20Russell
 * Optional: &refresh=1 to bypass cache
 *
 * Returns bio + locked current-season stats + career years.
 * CFBD is only called on cache miss (memory / Supabase).
 */
const { json } = require("./_http");
const { buildPlayerProfile, SEASON_YEAR } = require("./_lib/player-profile");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const playerId = q.id != null ? String(q.id).trim() : q.playerId != null ? String(q.playerId).trim() : "";
  const team = q.team != null ? String(q.team).trim() : "";
  const name = q.name != null ? String(q.name).trim() : "";
  const forceRefresh = q.refresh === "1" || q.refresh === "true";

  if (!playerId && !name) {
    return json(400, { error: "Provide id (preferred) or name" });
  }
  if (!playerId) {
    return json(400, {
      error: "Player id is required",
      hint: "Open players from a team roster so the CFBD athlete id is in the URL.",
    });
  }

  const apiKey =
    (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
  if (!apiKey) {
    return json(500, { error: "CFBD_API_KEY is not configured" });
  }

  try {
    const profile = await buildPlayerProfile({
      playerId,
      team,
      name,
      apiKey,
      forceRefresh,
    });

    const cacheHit = Boolean(profile.cache && profile.cache.hit);
    return json(
      200,
      profile,
      {
        "cache-control": cacheHit
          ? "public, max-age=60, s-maxage=300"
          : "public, max-age=30, s-maxage=120",
        "x-player-cache": cacheHit
          ? String(profile.cache.source || "hit")
          : "miss",
        "x-player-season": String(SEASON_YEAR),
      }
    );
  } catch (err) {
    console.error("player:", err);
    if (err && err.code === "MISSING_ID") {
      return json(400, { error: err.message });
    }
    if (err && err.name === "AbortError") {
      return json(504, { error: "Timed out loading player from CFBD" });
    }
    return json(500, {
      error: "Failed to load player profile",
      details: err && err.message ? String(err.message).slice(0, 220) : "unknown",
    });
  }
};
