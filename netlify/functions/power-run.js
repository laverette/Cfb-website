/**
 * POST /api/power/run
 * Admin: ingest CFBD through week, calculate ratings, persist weekly snapshot.
 * Body: { season, week, seasonType? }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { ingestSeasonFromCfbd, calculateRatings } = require("./lib/power");
const store = require("./lib/power/store");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  if (!store.hasSupabase()) {
    return json(503, { error: "Supabase is not configured" });
  }

  const apiKey = readCfbdKey();
  if (!apiKey) {
    return json(503, { error: "CFBD_API_KEY is not configured" });
  }

  const body = parseJsonBody(event) || {};
  const season = Number(body.season) || new Date().getFullYear();
  const week = Number(body.week);
  if (!Number.isFinite(week) || week < 0) {
    return json(400, { error: "week is required (0+). Use 0 for preseason-only prior snapshot." });
  }

  try {
    const ingested = await ingestSeasonFromCfbd({
      apiKey,
      season,
      asOfWeek: week,
      seasonType: body.seasonType || "regular",
    });

    await store.upsertTeams(ingested.teams);

    let previousRankings = new Map();
    if (week > 0) {
      try {
        const prev = await store.loadLatestRatings({ season, week: week - 1 });
        for (const t of prev.teams || []) {
          previousRankings.set(t.teamId, t.ranking);
        }
      } catch {
        previousRankings = new Map();
      }
    }

    let personnel = new Map();
    try {
      personnel = await store.loadActivePersonnelAdjustments();
    } catch {
      personnel = new Map();
    }

    const fbsTeams = ingested.teams.filter(
      (t) => String(t.classification || "fbs").toLowerCase() === "fbs"
    );

    const result = calculateRatings({
      teams: fbsTeams,
      games: ingested.games,
      season,
      asOfWeek: week,
      personnelAdjustments: personnel,
      previousRankings,
    });

    await store.saveRatingSnapshot(result);

    return json(200, {
      ok: true,
      season: result.season,
      week: result.week,
      teamCount: result.teams.length,
      solver: result.solver,
      top5: result.teams.slice(0, 5).map((t) => ({
        ranking: t.ranking,
        name: t.name,
        rawPower: t.rawPower,
        powerScore: t.powerScore,
      })),
    });
  } catch (err) {
    console.error("power-run:", err);
    return json(500, {
      error: "Failed to run power ratings",
      details: err && err.message ? String(err.message).slice(0, 300) : "unknown",
    });
  }
};
