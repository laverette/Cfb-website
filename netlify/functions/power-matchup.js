/**
 * POST /api/power/matchup
 * Body: { teamAId, teamBId, venue: 'a_home'|'b_home'|'neutral', personnelA?, personnelB?, season?, week? }
 */
const { json, parseJsonBody } = require("./_http");
const { predictMatchup, ingestSeasonFromCfbd, calculateRatings } = require("./lib/power");
const store = require("./lib/power/store");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

async function loadTeamsContext(season, week) {
  if (store.hasSupabase()) {
    try {
      const snap = await store.loadLatestRatings({ season, week });
      if (snap.teams && snap.teams.length) {
        return { source: "snapshot", ...snap };
      }
    } catch (err) {
      console.warn("power-matchup snapshot:", err.message);
    }
  }

  const apiKey = readCfbdKey();
  if (!apiKey) {
    throw Object.assign(new Error("No ratings available for matchup"), { status: 503 });
  }
  const year = Number.isFinite(season) ? season : new Date().getFullYear();
  const asOf = Number.isFinite(week) ? week : 15;
  const ingested = await ingestSeasonFromCfbd({ apiKey, season: year, asOfWeek: asOf });
  const result = calculateRatings({
    teams: ingested.teams.filter((t) => String(t.classification || "fbs").toLowerCase() !== "fcs"),
    games: ingested.games,
    season: year,
    asOfWeek: asOf,
  });
  return { source: "live", season: result.season, week: result.week, teams: result.teams };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { error: "Invalid JSON body" });
  }

  const teamAId = body.teamAId ?? body.team_a_id;
  const teamBId = body.teamBId ?? body.team_b_id;
  if (teamAId == null || teamBId == null) {
    return json(400, { error: "teamAId and teamBId are required" });
  }
  if (String(teamAId) === String(teamBId)) {
    return json(400, { error: "Select two different teams" });
  }

  const venueRaw = String(body.venue || "neutral").toLowerCase();
  const venue =
    venueRaw === "a_home" || venueRaw === "home_a" || venueRaw === "team_a"
      ? "a_home"
      : venueRaw === "b_home" || venueRaw === "home_b" || venueRaw === "team_b"
        ? "b_home"
        : "neutral";

  try {
    const season = body.season != null ? Number(body.season) : null;
    const week = body.week != null ? Number(body.week) : null;
    const ctx = await loadTeamsContext(season, week);
    const byId = new Map(ctx.teams.map((t) => [String(t.teamId), t]));
    const teamA = byId.get(String(teamAId));
    const teamB = byId.get(String(teamBId));
    if (!teamA || !teamB) {
      return json(404, {
        error: "Team not found in current ratings",
        details: `Missing: ${!teamA ? teamAId : ""} ${!teamB ? teamBId : ""}`.trim(),
      });
    }

    const prediction = predictMatchup({
      teamA,
      teamB,
      venue,
      personnelA: body.personnelA ?? body.personnel_a ?? 0,
      personnelB: body.personnelB ?? body.personnel_b ?? 0,
    });

    return json(200, {
      source: ctx.source,
      season: ctx.season,
      week: ctx.week,
      prediction,
    });
  } catch (err) {
    console.error("power-matchup:", err);
    const status = err.status || 500;
    return json(status, {
      error: status === 503 ? "Matchup predictor offline" : "Failed to predict matchup",
      details: err && err.message ? String(err.message).slice(0, 240) : "unknown",
    });
  }
};
