/**
 * GET /api/prop-eval?action=search|stats|catalog|evaluate|board
 *
 * board — weekly Odds API props + model hit probabilities (needs ODDS_API_KEY)
 * evaluate — optional overPrice/underPrice for market-implied comparison
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
const { buildProbGrade, modelHitProbabilities } = require("./_lib/prop-prob");
const { buildWeeklyPropBoard } = require("./_lib/prop-board");
const { isOddsApiConfigured } = require("./_lib/odds-api");

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

function attachProbabilities(result, q = {}) {
  const overPrice = q.overPrice != null && q.overPrice !== "" ? q.overPrice : null;
  const underPrice = q.underPrice != null && q.underPrice !== "" ? q.underPrice : null;
  const modelOnly = modelHitProbabilities(result.expected, result.line, result.stat?.id);
  const grade =
    overPrice != null || underPrice != null
      ? buildProbGrade({
          expected: result.expected,
          line: result.line,
          statId: result.stat?.id,
          lean: result.lean,
          overPrice,
          underPrice,
        })
      : {
          pOver: modelOnly.pOver,
          pUnder: modelOnly.pUnder,
          scale: modelOnly.scale,
          impliedOver: null,
          impliedUnder: null,
          side: result.lean === "tossup" ? (modelOnly.pOver >= 0.5 ? "over" : "under") : result.lean,
          modelProb: null,
          marketProb: null,
          probEdge: null,
          probEdgePct: null,
          stars: 0,
          label: null,
        };
  return { ...result, grade };
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

  const isBoard = action === "board";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isBoard ? 25_000 : 22_000);
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

    if (action === "board") {
      if (!isOddsApiConfigured()) {
        return json(503, {
          error:
            "ODDS_API_KEY is not configured. Add a The Odds API key in Netlify to load weekly prop lines.",
          code: "ODDS_API_NOT_CONFIGURED",
        });
      }
      const season = Number(q.season || q.year) || new Date().getFullYear();
      const powerTeams = await loadPowerTeams(season);
      const board = await buildWeeklyPropBoard({
        season,
        apiKey,
        powerTeams,
        signal,
        force: q.force === "1" || q.refresh === "1",
        maxEvents: Math.min(10, Number(q.maxEvents) || 8),
        maxProps: Math.min(40, Number(q.maxProps) || 28),
      });
      return json(200, board, {
        "cache-control": board.cached
          ? "public, max-age=60, s-maxage=120"
          : "public, max-age=30, s-maxage=60",
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

    return json(200, attachProbabilities(result, q), {
      "cache-control": "public, max-age=30, s-maxage=60",
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return json(504, { error: "Timed out evaluating prop" });
    }
    console.error("prop-eval:", err);
    if (err.code === "ODDS_API_NOT_CONFIGURED") {
      return json(503, { error: err.message, code: err.code });
    }
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
