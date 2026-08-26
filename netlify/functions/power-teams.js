/**
 * GET /api/power/teams
 * Team list for matchup dropdowns (from latest snapshot or live CFBD FBS list).
 */
const { json } = require("./_http");
const store = require("./_lib/power/store");
const { ingestSeasonFromCfbd } = require("./_lib/power");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    if (store.hasSupabase()) {
      try {
        const snap = await store.loadLatestRatings({});
        if (snap.teams && snap.teams.length) {
          return json(200, {
            source: "snapshot",
            season: snap.season,
            week: snap.week,
            teams: snap.teams.map((t) => ({
              teamId: t.teamId,
              name: t.name,
              conference: t.conference,
              logoUrl: t.logoUrl,
              ranking: t.ranking,
              rawPower: t.rawPower,
              powerScore: t.powerScore,
            })),
          });
        }
      } catch (err) {
        console.warn("power-teams snapshot:", err.message);
      }
    }

    const apiKey = readCfbdKey();
    if (!apiKey) {
      return json(503, { error: "No team list available" });
    }
    const year = Number(event.queryStringParameters?.season) || new Date().getFullYear();
    const ingested = await ingestSeasonFromCfbd({
      apiKey,
      season: year,
      asOfWeek: 0,
    });
    const teams = ingested.teams
      .filter((t) => String(t.classification || "fbs").toLowerCase() === "fbs")
      .map((t) => ({
        teamId: t.id,
        name: t.name,
        conference: t.conference,
        logoUrl: t.logoUrl,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return json(200, { source: "cfbd", season: year, week: null, teams });
  } catch (err) {
    console.error("power-teams:", err);
    return json(500, {
      error: "Failed to load teams",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
