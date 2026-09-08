/**
 * /api/leagues — create (POST)
 * /api/leagues/mine — list (GET)
 * /api/leagues/join — join (POST)
 * /api/leagues/detail?id= — detail (GET)
 * /api/leagues/leaderboard?id=&scope=&weekId= — leaderboard (GET)
 *
 * Also accepts path splat via ?path=mine|join|detail/3|3/leaderboard
 */
const { json, parseJsonBody } = require("./_http");
const { requireAuth } = require("./_auth");
const {
  createLeague,
  joinLeagueByCode,
  listLeaguesForUser,
  getLeagueDetail,
  getLeagueLeaderboard,
} = require("./_lib/leagues");

function parseAuthUserId(event) {
  const auth = requireAuth(event);
  if (auth.statusCode) return { errorResponse: auth };
  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return { errorResponse: json(401, { error: "Authentication required" }) };
  }
  return { userId };
}

function routeParts(event) {
  const q = event.queryStringParameters || {};
  const pathHint = String(q.path || q.splat || "").trim();
  const urlPath = String(event.path || "");
  const fromUrl = urlPath.split("/api/leagues/")[1] || "";
  const raw = pathHint || fromUrl;
  return raw
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return json(204, {});

  const auth = parseAuthUserId(event);
  if (auth.errorResponse) return auth.errorResponse;
  const { userId } = auth;

  const parts = routeParts(event);
  const q = event.queryStringParameters || {};

  try {
    // POST /api/leagues  or  POST .../join
    if (method === "POST") {
      const body = parseJsonBody(event) || {};
      const isJoin =
        parts[0] === "join" ||
        String(q.action || "").toLowerCase() === "join" ||
        body.code != null ||
        body.inviteCode != null;

      if (isJoin) {
        const league = await joinLeagueByCode({
          userId,
          code: body.code ?? body.inviteCode ?? body.invite_code,
        });
        return json(200, { league, message: "Joined league" });
      }

      const league = await createLeague({
        userId,
        name: body.name,
      });
      return json(200, { league, message: "League created" });
    }

    if (method !== "GET") {
      return json(405, { error: "Method not allowed" });
    }

    // GET /api/leagues/mine or bare /api/leagues
    if (!parts.length || parts[0] === "mine") {
      const leagues = await listLeaguesForUser(userId);
      return json(200, { leagues });
    }

    // GET .../leaderboard?id= or .../:id/leaderboard
    if (parts[0] === "leaderboard" || parts[1] === "leaderboard") {
      const leagueId = Number(
        parts[0] === "leaderboard" ? q.id || q.leagueId : parts[0]
      );
      if (!Number.isFinite(leagueId) || leagueId < 1) {
        return json(400, { error: "league id required" });
      }
      const scopeRaw = String(q.scope || "week").toLowerCase();
      const scope =
        scopeRaw === "season" || scopeRaw === "year" || scopeRaw === "all" || scopeRaw === "week"
          ? scopeRaw
          : "week";
      const weekId =
        q.weekId != null && String(q.weekId).trim() !== ""
          ? Number(q.weekId)
          : null;
      const year =
        q.year != null && String(q.year).trim() !== "" ? Number(q.year) : null;
      const board = await getLeagueLeaderboard(leagueId, userId, {
        scope,
        weekId: Number.isFinite(weekId) ? weekId : null,
        year: Number.isFinite(year) ? year : null,
      });
      return json(200, board);
    }

    // GET .../detail?id= or .../:id
    const leagueId = Number(
      parts[0] === "detail" ? q.id || q.leagueId : parts[0]
    );
    if (!Number.isFinite(leagueId) || leagueId < 1) {
      return json(400, { error: "league id required" });
    }
    const detail = await getLeagueDetail(leagueId, userId);
    return json(200, detail);
  } catch (err) {
    console.error("leagues:", err);
    if (err.code === "INVALID_NAME" || err.code === "INVALID_CODE") {
      return json(400, { message: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return json(404, { message: err.message });
    }
    if (err.code === "FORBIDDEN") {
      return json(403, { message: err.message });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, {
      error: "League request failed",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
