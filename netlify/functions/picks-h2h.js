/**
 * GET /api/picks/h2h?weekId=&opponentUsername=
 * Auth required — compares viewer vs opponent for a week.
 */
const { json } = require("./_http");
const { requireAuth } = require("./_auth");
const {
  findUserById,
  findUserByUsername,
  getUserPicksForWeek,
  loadGamesByWeek,
  loadCurrentWeek,
  emptyPickBucket,
  addPickToBucket,
  finalizeBucket,
} = require("./db");

function mapIdentity(row) {
  if (!row) return null;
  return {
    userId: Number(row.id),
    username: row.username,
    displayName: row.display_name != null ? row.display_name : row.username,
    avatarUrl: row.avatar_url ?? null,
  };
}

function summarizePicks(picks) {
  const bucket = emptyPickBucket();
  for (const p of picks || []) {
    addPickToBucket(bucket, p.isCorrect, null, Boolean(p.isTie));
  }
  return finalizeBucket(bucket);
}

function pickMap(picks) {
  const byGameId = new Map();
  const byNumber = new Map();
  for (const p of picks || []) {
    if (p.gameId != null) byGameId.set(Number(p.gameId), p);
    if (p.gameNumber != null) byNumber.set(Number(p.gameNumber), p);
  }
  return { byGameId, byNumber };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;

  const viewerId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(viewerId) || viewerId < 1) {
    return json(401, { error: "Authentication required" });
  }

  const q = event.queryStringParameters || {};
  const opponentUsername = String(
    q.opponentUsername || q.username || q.opponent || ""
  ).trim();
  if (!opponentUsername) {
    return json(400, { message: "opponentUsername is required" });
  }

  let weekId =
    q.weekId != null && String(q.weekId).trim() !== ""
      ? Number(q.weekId)
      : null;

  try {
    if (!Number.isFinite(weekId) || weekId < 1) {
      const current = await loadCurrentWeek();
      weekId = current?.id != null ? Number(current.id) : null;
    }
    if (!weekId) {
      return json(404, { message: "No active week" });
    }

    const viewerRow = await findUserById(viewerId);
    const opponentRow = await findUserByUsername(opponentUsername);
    if (!viewerRow) return json(404, { message: "Viewer not found" });
    if (!opponentRow) return json(404, { message: "Opponent not found" });
    if (Number(opponentRow.id) === viewerId) {
      return json(400, { message: "Pick someone else to compare against" });
    }

    const [games, viewerPicks, opponentPicks] = await Promise.all([
      loadGamesByWeek(weekId),
      getUserPicksForWeek(viewerId, weekId),
      getUserPicksForWeek(Number(opponentRow.id), weekId),
    ]);

    if (!opponentPicks.length) {
      return json(400, {
        message: "That player has no picks for this week yet",
      });
    }

    const vMap = pickMap(viewerPicks);
    const oMap = pickMap(opponentPicks);

    const gamesOut = (games || []).map((g) => {
      const gameNumber = Number(g.game_number);
      const viewerPick =
        vMap.byGameId.get(Number(g.id)) ||
        vMap.byNumber.get(gameNumber) ||
        null;
      const opponentPick =
        oMap.byGameId.get(Number(g.id)) ||
        oMap.byNumber.get(gameNumber) ||
        null;
      return {
        gameId: Number(g.id),
        gameNumber,
        awayTeamName: g.away_team_name,
        homeTeamName: g.home_team_name,
        awayTeamEspnId: g.away_team_espn_id,
        homeTeamEspnId: g.home_team_espn_id,
        awayTeamLogoUrl: g.away_team_logo_url,
        homeTeamLogoUrl: g.home_team_logo_url,
        isCompleted: Boolean(g.is_completed),
        viewer: viewerPick
          ? {
              pickedTeamName: viewerPick.pickedTeamName,
              pickedTeamEspnId: viewerPick.pickedTeamEspnId,
              isCorrect: viewerPick.isCorrect,
              isTie: Boolean(viewerPick.isTie),
            }
          : null,
        opponent: opponentPick
          ? {
              pickedTeamName: opponentPick.pickedTeamName,
              pickedTeamEspnId: opponentPick.pickedTeamEspnId,
              isCorrect: opponentPick.isCorrect,
              isTie: Boolean(opponentPick.isTie),
            }
          : null,
      };
    });

    return json(200, {
      weekId,
      viewer: mapIdentity(viewerRow),
      opponent: mapIdentity(opponentRow),
      viewerRecord: summarizePicks(viewerPicks),
      opponentRecord: summarizePicks(opponentPicks),
      games: gamesOut,
    });
  } catch (err) {
    console.error("picks-h2h:", err);
    return json(500, {
      error: "Failed to build head-to-head",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
