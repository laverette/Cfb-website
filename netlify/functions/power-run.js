/**
 * POST /api/power/run
 * Admin: ingest CFBD through week, calculate ratings, persist weekly snapshot.
 * Body: { season, week, seasonType? }
 * week 0 = preseason priors only (fast path).
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { ingestSeasonFromCfbd, calculateRatings } = require("./_lib/power");
const store = require("./_lib/power/store");

/** Netlify: allow longer CFBD ingest on paid plans; free tier still caps ~10s. */
exports.config = {
  maxDuration: 26,
};

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
    return json(503, {
      error: "Supabase is not configured",
      details: "Set SUPABASE_SERVICE_ROLE_KEY for Netlify Functions.",
    });
  }

  const apiKey = readCfbdKey();
  if (!apiKey) {
    return json(503, {
      error: "CFBD_API_KEY is not configured",
      details: "Add CFBD_API_KEY to Netlify env (Functions scope), then redeploy.",
    });
  }

  const body = parseJsonBody(event) || {};
  const season = Number(body.season) || new Date().getFullYear();
  const week = Number(body.week);
  if (!Number.isFinite(week) || week < 0) {
    return json(400, {
      error: "week is required (0+). Use 0 for preseason-only prior snapshot.",
    });
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
      mode: ingested.mode || (week <= 0 ? "preseason" : "inseason"),
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
    const msg = err && err.message ? String(err.message) : "unknown";
    const looksTimeout = /abort|timeout|TIMEDOUT|deadline/i.test(msg);
    return json(looksTimeout ? 504 : 500, {
      error: looksTimeout
        ? "Power ratings timed out"
        : "Failed to run power ratings",
      details: msg.slice(0, 400),
    });
  }
};
