/**
 * weekId from query (?weekId=) or path (/games/week/123).
 * Supports Netlify rewrites (?weekId=:splat) and direct function invokes.
 */
function parseWeekId(event) {
  const q = event.queryStringParameters || {};
  const mv = event.multiValueQueryStringParameters || {};
  const fromQuery =
    q.weekId ??
    q.week_id ??
    (Array.isArray(mv.weekId) ? mv.weekId[0] : null) ??
    (Array.isArray(mv.week_id) ? mv.week_id[0] : null);

  if (fromQuery != null && String(fromQuery).trim() !== "") {
    const s = String(fromQuery).trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const path = event.path || "";
  const pathMatch = path.match(/\/games\/week\/(\d+)(?:\/|$|\?)/);
  if (pathMatch && pathMatch[1]) {
    const n = parseInt(pathMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const rawQuery = event.rawQuery || "";
  if (rawQuery) {
    try {
      const params = new URLSearchParams(rawQuery);
      const w = params.get("weekId") || params.get("week_id");
      if (w != null && w.trim() !== "" && /^\d+$/.test(w.trim())) {
        const n = parseInt(w.trim(), 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function invalidWeekIdPayload(event) {
  return {
    error: "Invalid weekId",
    received: {
      weekId: event.queryStringParameters?.weekId ?? null,
      path: event.path ?? null,
      query: event.queryStringParameters ?? null,
      rawQuery: event.rawQuery ?? null,
    },
  };
}

module.exports = { parseWeekId, invalidWeekIdPayload };
