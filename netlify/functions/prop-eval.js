/**
 * GET /api/prop-eval?action=search&q=...
 * GET /api/prop-eval?action=evaluate&playerId=&stat=&line=&team=&opponent=&season=
 * GET /api/prop-eval?action=stats&playerId=&team=&season=  (available props for player)
 */
const { json } = require("./_http");
const store = require("./_lib/power/store");
const {
  searchPlayers,
  evaluateProp,
  STAT_DEFS,
  loadOverviewWithFallback,
  listAvailableStats,
} = require("./_lib/prop-eval");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

async function loadPowerTeams(season) {
  if (!store.hasSupabase()) return [];
  try {
    const snap = await store.loadLatestRatings({
      season: Number.isFinite(season) ? season : null,
      week: null,
    });
    return Array.isArray(snap?.teams) ? snap.teams : [];
  } catch (err) {
    console.warn("prop-eval power teams:", err.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const action = String(q.action || "evaluate").toLowerCase();
  const apiKey = readCfbdKey();
  if (!apiKey) {
    return json(503, { error: "CFBD_API_KEY not configured" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  const signal = controller.signal;

  try {
    if (action === "catalog") {
      return json(200, {
        stats: STAT_DEFS.map((d) => ({
          id: d.id,
          label: d.label,
          category: d.category,
        })),
      });
    }

    if (action === "search") {
      const players = await searchPlayers({
        q: q.q || q.query || q.search || "",
        team: q.team || "",
        year: q.year || q.season,
        apiKey,
        signal,
      });
      return json(
        200,
        { players },
        { "cache-control": "public, max-age=60, s-maxage=120" }
      );
    }

    if (action === "stats") {
      const playerId = String(q.playerId || q.id || "").trim();
      if (!playerId) return json(400, { error: "playerId required" });
      const season = Number(q.season || q.year) || new Date().getFullYear();
      const { overview, seasonYear } = await loadOverviewWithFallback(
        playerId,
        season,
        apiKey,
        signal
      );
      if (!overview) {
        return json(404, { error: "No season stats found" });
      }
      return json(200, {
        playerId,
        seasonYear,
        games: overview.games ?? null,
        team: overview.team || q.team || null,
        stats: listAvailableStats(overview),
      });
    }

    // evaluate (default)
    const playerId = String(q.playerId || q.id || "").trim();
    const stat = String(q.stat || q.statId || "").trim();
    if (!playerId) return json(400, { error: "playerId required" });
    if (!stat) return json(400, { error: "stat required" });
    if (q.line == null || q.line === "") {
      return json(400, { error: "line required" });
    }

    const season = Number(q.season || q.year) || new Date().getFullYear();
    const powerTeams = await loadPowerTeams(season);
    const result = await evaluateProp({
      playerId,
      team: q.team || "",
      name: q.name || "",
      statId: stat,
      line: q.line,
      opponent: q.opponent || "",
      season,
      apiKey,
      powerTeams,
      signal,
    });

    return json(200, result, {
      "cache-control": "public, max-age=30, s-maxage=60",
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return json(504, { error: "Timed out evaluating prop" });
    }
    console.error("prop-eval:", err);
    const status =
      err.code === "BAD_STAT" || err.code === "BAD_LINE"
        ? 400
        : err.code === "NO_STATS" || err.code === "NO_STAT_VALUE"
          ? 404
          : 502;
    return json(status, {
      error: err.message || "Prop evaluation failed",
      code: err.code || null,
    });
  } finally {
    clearTimeout(timeout);
  }
};
