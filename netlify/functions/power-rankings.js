/**
 * GET /api/power/rankings?season=&week=
 * Returns latest (or requested) weekly power rankings snapshot.
 * If no snapshot exists and CFBD_API_KEY is set, computes live (does not persist unless ?persist=1 & admin).
 */
const { json } = require("./_http");
const { calculateRatings, ingestSeasonFromCfbd } = require("./lib/power");
const store = require("./lib/power/store");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const season = q.season != null && q.season !== "" ? Number(q.season) : null;
  const week = q.week != null && q.week !== "" ? Number(q.week) : null;
  const live = String(q.live || "") === "1" || String(q.live || "").toLowerCase() === "true";

  try {
    if (!live && store.hasSupabase()) {
      try {
        const snap = await store.loadLatestRatings({ season, week });
        if (snap.teams && snap.teams.length) {
          return json(200, {
            source: "snapshot",
            season: snap.season,
            week: snap.week,
            teams: snap.teams,
            note: "Raw power is points above average FBS (neutral). Power Score is display-only.",
          });
        }
      } catch (err) {
        // Tables may not exist yet — fall through to live compute
        console.warn("power-rankings snapshot:", err.message);
      }
    }

    const apiKey = readCfbdKey();
    if (!apiKey) {
      return json(503, {
        error: "No rankings available",
        details:
          "Run SQL migration sql/power_ratings_schema.sql, compute a snapshot via POST /api/power/run, or set CFBD_API_KEY for live compute.",
      });
    }

    const year = Number.isFinite(season) ? season : new Date().getFullYear();
    const asOf = Number.isFinite(week) ? week : 15;
    const ingested = await ingestSeasonFromCfbd({
      apiKey,
      season: year,
      asOfWeek: asOf,
    });
    let personnel = new Map();
    if (store.hasSupabase()) {
      try {
        personnel = await store.loadActivePersonnelAdjustments();
      } catch {
        /* optional */
      }
    }
    const result = calculateRatings({
      teams: ingested.teams.filter((t) => String(t.classification || "fbs").toLowerCase() !== "fcs"),
      games: ingested.games,
      season: year,
      asOfWeek: asOf,
      personnelAdjustments: personnel,
    });

    return json(200, {
      source: "live",
      season: result.season,
      week: result.week,
      solver: result.solver,
      paramsUsed: result.paramsUsed,
      teams: result.teams,
      note: "Live CFBD compute. Persist with admin POST /api/power/run for weekly snapshots.",
    });
  } catch (err) {
    console.error("power-rankings:", err);
    return json(500, {
      error: "Failed to load power rankings",
      details: err && err.message ? String(err.message).slice(0, 240) : "unknown",
    });
  }
};
