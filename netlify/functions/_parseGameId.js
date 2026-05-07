/**
 * Numeric DB primary key for Games.id from query or path (Netlify rewrites use ?gameId=:splat).
 */
function parseGameId(event) {
  const q = event.queryStringParameters || {};
  const mv = event.multiValueQueryStringParameters || {};
  const fromQuery =
    q.gameId ??
    q.game_id ??
    (Array.isArray(mv.gameId) ? mv.gameId[0] : null) ??
    (Array.isArray(mv.game_id) ? mv.game_id[0] : null);

  if (fromQuery != null && String(fromQuery).trim() !== "") {
    const s = String(fromQuery).trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const rawQuery = event.rawQuery || "";
  if (rawQuery) {
    try {
      const params = new URLSearchParams(rawQuery);
      const g = params.get("gameId") || params.get("game_id");
      if (g != null && g.trim() !== "" && /^\d+$/.test(g.trim())) {
        const n = parseInt(g.trim(), 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* ignore */
    }
  }

  const path = event.path || "";
  const tail = path.match(/\/(\d+)(?:\/|\?|$)/);
  if (tail && tail[1]) {
    const n = parseInt(tail[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function invalidGameIdPayload(event) {
  return {
    error: "Invalid gameId",
    received: {
      gameId: event.queryStringParameters?.gameId ?? null,
      path: event.path ?? null,
      query: event.queryStringParameters ?? null,
      rawQuery: event.rawQuery ?? null,
    },
  };
}

module.exports = { parseGameId, invalidGameIdPayload };
