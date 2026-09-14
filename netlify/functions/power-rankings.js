/**
 * GET /api/power/rankings?season=&week=
 * GET /api/power/rankings?catalog=1
 * Public board uses admin-saved snapshots only (POST /api/power/run).
 * Weeks ahead of the site's current picks week are hidden so an accidental
 * future run is not the default board.
 */
const { json } = require("./_http");
const { calculateRatings, ingestSeasonFromCfbd } = require("./_lib/power");
const store = require("./_lib/power/store");
const { loadCurrentWeek } = require("./db");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

function weeksBySeasonMap(snapshots) {
  const map = {};
  for (const row of snapshots) {
    const key = String(row.season);
    if (!map[key]) map[key] = [];
    if (!map[key].includes(row.week)) map[key].push(row.week);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => a - b);
  }
  return map;
}

async function publicSnapshotCatalog() {
  const snapshots = await store.listRatingSnapshots();
  let currentPicks = null;
  try {
    const w = await loadCurrentWeek();
    if (w) {
      currentPicks = {
        season: Number(w.season_year),
        week: Number(w.week_number),
      };
    }
  } catch (err) {
    console.warn("power-rankings current week:", err.message);
  }

  const visible = snapshots.filter((row) => {
    if (!currentPicks || !Number.isFinite(currentPicks.week)) return true;
    if (row.season !== currentPicks.season) return true;
    return row.week <= currentPicks.week;
  });

  const seasons = [...new Set(visible.map((r) => r.season))].sort((a, b) => b - a);
  const weeksBySeason = weeksBySeasonMap(visible);
  const defaultSeason =
    currentPicks && seasons.includes(currentPicks.season)
      ? currentPicks.season
      : seasons[0] ?? null;
  const seasonWeeks = defaultSeason != null ? weeksBySeason[String(defaultSeason)] || [] : [];
  const defaultWeek = seasonWeeks.length ? seasonWeeks[seasonWeeks.length - 1] : null;

  return {
    snapshots: visible,
    seasons,
    weeksBySeason,
    defaultSeason,
    defaultWeek,
    currentPicksWeek: currentPicks,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const catalog = String(q.catalog || "") === "1" || String(q.catalog || "").toLowerCase() === "true";
  const season = q.season != null && q.season !== "" ? Number(q.season) : null;
  const week = q.week != null && q.week !== "" ? Number(q.week) : null;
  const live = String(q.live || "") === "1" || String(q.live || "").toLowerCase() === "true";

  try {
    if (catalog) {
      if (!store.hasSupabase()) {
        return json(200, {
          seasons: [],
          weeksBySeason: {},
          defaultSeason: null,
          defaultWeek: null,
          currentPicksWeek: null,
        });
      }
      const cat = await publicSnapshotCatalog();
      return json(200, {
        seasons: cat.seasons,
        weeksBySeason: cat.weeksBySeason,
        defaultSeason: cat.defaultSeason,
        defaultWeek: cat.defaultWeek,
        currentPicksWeek: cat.currentPicksWeek,
      });
    }

    if (!live && store.hasSupabase()) {
      try {
        const cat = await publicSnapshotCatalog();
        let targetSeason = Number.isFinite(season) ? season : cat.defaultSeason;
        let targetWeek = Number.isFinite(week) ? week : cat.defaultWeek;
        const allowed = new Set(
          (cat.snapshots || []).map((r) => `${r.season}:${r.week}`)
        );
        if (targetSeason == null || targetWeek == null || !allowed.has(`${targetSeason}:${targetWeek}`)) {
          return json(404, {
            error: "No rankings snapshot for that week",
            details: "An admin needs to compute & save rankings for this week from the Admin panel.",
            seasons: cat.seasons,
            weeksBySeason: cat.weeksBySeason,
            defaultSeason: cat.defaultSeason,
            defaultWeek: cat.defaultWeek,
          });
        }
        const snap = await store.loadLatestRatings({ season: targetSeason, week: targetWeek });
        if (snap.teams && snap.teams.length) {
          return json(200, {
            source: "snapshot",
            season: snap.season,
            week: snap.week,
            teams: snap.teams,
            seasons: cat.seasons,
            weeksBySeason: cat.weeksBySeason,
            note: "Raw power is points above average FBS (neutral). Power Score is display-only.",
          });
        }
        return json(404, {
          error: "No rankings snapshot for that week",
          details: "An admin needs to compute & save rankings for this week from the Admin panel.",
          seasons: cat.seasons,
          weeksBySeason: cat.weeksBySeason,
        });
      } catch (err) {
        console.warn("power-rankings snapshot:", err.message);
        return json(503, {
          error: "No rankings available",
          details:
            "Run SQL migration sql/power_ratings_schema.sql and compute a snapshot via Admin → Power Rankings.",
        });
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
