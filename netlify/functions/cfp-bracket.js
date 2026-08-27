/**
 * GET /api/cfp/bracket?season=2026
 * Auth: own bracket. Query username= for public view.
 */
const { json } = require("./_http");
const { optionalAuth } = require("./_auth");
const {
  getBracketForUser,
  getBracketByUsername,
  normalizeSeason,
} = require("./_lib/cfp-brackets");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const season = normalizeSeason(q.season ?? q.year);
  const username = q.username != null ? String(q.username).trim() : "";

  try {
    if (username) {
      const bundle = await getBracketByUsername(username, season);
      if (!bundle) return json(404, { error: "User not found" });
      if (!bundle.bracket) {
        return json(404, { error: "No bracket saved for this user", season });
      }
      return json(200, { ...bundle, view: "public" });
    }

    const auth = optionalAuth(event);
    const userId =
      auth.payload && auth.payload.userId != null
        ? parseInt(String(auth.payload.userId), 10)
        : null;
    if (!Number.isFinite(userId)) {
      return json(401, { error: "Log in to load your bracket, or pass ?username=" });
    }

    const bundle = await getBracketForUser(userId, season);
    return json(200, { ...bundle, view: "mine" });
  } catch (err) {
    console.error("cfp-bracket:", err);
    return json(500, {
      error: "Failed to load bracket",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
