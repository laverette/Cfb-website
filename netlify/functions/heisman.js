/**
 * GET /api/heisman?season=2026
 * Optional auth: includes myPick
 * Optional ?refresh=1 to bypass odds cache (admin-ish; open for simplicity)
 */
const { json } = require("./_http");
const { optionalAuth } = require("./_auth");
const { getHeismanPage, normalizeSeason } = require("./_lib/heisman");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const season = normalizeSeason(q.season ?? q.year);
  const forceRefresh = q.refresh === "1" || q.refresh === "true";
  const auth = optionalAuth(event);
  const userId =
    auth.payload && auth.payload.userId != null
      ? parseInt(String(auth.payload.userId), 10)
      : null;

  try {
    const page = await getHeismanPage(season, {
      userId: Number.isFinite(userId) ? userId : null,
      forceRefresh,
    });
    const cacheHit = Boolean(page.board?.cache?.hit);
    return json(200, page, {
      "cache-control": cacheHit
        ? "public, max-age=60, s-maxage=180"
        : "public, max-age=30, s-maxage=60",
      "x-heisman-cache": cacheHit
        ? String(page.board.cache.source || "hit")
        : "miss",
    });
  } catch (err) {
    console.error("heisman:", err);
    if (err && err.name === "AbortError") {
      return json(504, { error: "Timed out loading Heisman odds from ESPN" });
    }
    return json(500, {
      error: "Failed to load Heisman board",
      details: err && err.message ? String(err.message).slice(0, 220) : "unknown",
    });
  }
};
