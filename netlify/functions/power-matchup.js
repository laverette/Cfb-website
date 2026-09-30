/**
 * POST /api/power/matchup
 *
 * Preferred body (Weekly Picks):
 *   { espnEventId, teamAId?, teamBId?, venue?, marketBettingLine?, personnelA?, personnelB? }
 *
 * Legacy body (predictor.html):
 *   { teamAId, teamBId, venue, ... } — uses Supabase snapshot only (no live CFBD).
 *
 * HARD RULE: this handler never calls CFBD.
 */
const { json, parseJsonBody } = require("./_http");
const { predictMatchup } = require("./_lib/power/predict");
const { predictMatchupFromEspn } = require("./_lib/power/predict-espn");
const store = require("./_lib/power/store");

async function loadSnapshotContext(season, week) {
  if (!store.hasSupabase()) {
    return { source: "snapshot", season, week, teams: [] };
  }
  try {
    const snap = await store.loadLatestRatings({ season, week });
    if (snap.teams && snap.teams.length) {
      return { source: "snapshot", ...snap };
    }
  } catch (err) {
    console.warn("power-matchup snapshot:", err.message);
  }
  return { source: "snapshot", season, week, teams: [] };
}

function snapshotMap(ctx) {
  const map = new Map();
  for (const t of ctx.teams || []) {
    map.set(String(t.teamId), t);
  }
  return map;
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

  const espnEventId =
    body.espnEventId ?? body.espn_event_id ?? body.eventId ?? body.cfbdGameId ?? body.cfbd_game_id ?? null;

  const venueRaw = String(body.venue || "neutral").toLowerCase();
  const venue =
    venueRaw === "a_home" || venueRaw === "home_a" || venueRaw === "team_a"
      ? "a_home"
      : venueRaw === "b_home" || venueRaw === "home_b" || venueRaw === "team_b"
        ? "b_home"
        : "neutral";

  const personnelA = body.personnelA ?? body.personnel_a ?? 0;
  const personnelB = body.personnelB ?? body.personnel_b ?? 0;
  const marketBettingLine =
    body.marketBettingLine ?? body.bettingLine ?? body.betting_line ?? body.spread ?? null;

  try {
    // ESPN-first path when an event id is present (Weekly Picks).
    if (espnEventId != null && String(espnEventId).trim() !== "") {
      const season = body.season != null ? Number(body.season) : null;
      const week = body.week != null ? Number(body.week) : null;
      const ctx = await loadSnapshotContext(season, week);
      const result = await predictMatchupFromEspn({
        espnEventId: String(espnEventId).trim(),
        espnPackage: body.espnPackage || body.espn_package || body.summary || null,
        marketBettingLine,
        personnelA,
        personnelB,
        snapshotById: snapshotMap(ctx),
      });
      return json(200, {
        source: result.source,
        season: result.season,
        week: result.week,
        eventId: result.eventId,
        requests: result.counters,
        prediction: result.prediction,
      });
    }

    // Legacy team-id path — snapshot only (never live CFBD).
    const teamAId = body.teamAId ?? body.team_a_id;
    const teamBId = body.teamBId ?? body.team_b_id;
    if (teamAId == null || teamBId == null) {
      return json(400, { error: "espnEventId or teamAId/teamBId are required" });
    }
    if (String(teamAId) === String(teamBId)) {
      return json(400, { error: "Select two different teams" });
    }

    const season = body.season != null ? Number(body.season) : null;
    const week = body.week != null ? Number(body.week) : null;
    const ctx = await loadSnapshotContext(season, week);
    const byId = new Map(ctx.teams.map((t) => [String(t.teamId), t]));
    const teamA = byId.get(String(teamAId));
    const teamB = byId.get(String(teamBId));
    if (!teamA || !teamB) {
      return json(404, {
        error: "Team not found in current ratings snapshot",
        details:
          "No ESPN event id was provided and no Supabase power snapshot covers these teams. Open Predict matchup from Weekly Picks (with an ESPN event id).",
      });
    }

    const prediction = predictMatchup({
      teamA,
      teamB,
      venue,
      personnelA,
      personnelB,
    });

    return json(200, {
      source: ctx.source,
      season: ctx.season,
      week: ctx.week,
      requests: { espnRequests: 0, cfbdRequests: 0, cacheHits: 0 },
      prediction,
    });
  } catch (err) {
    console.error("power-matchup:", err);
    const status = err.status || 500;
    return json(status, {
      error:
        status === 403 || err.needsClientEspn
          ? "ESPN blocked server fetch — retrying from your browser…"
          : status === 503
            ? "Not enough matchup data available right now."
            : "Failed to predict matchup",
      details: err && err.message ? String(err.message).slice(0, 280) : "unknown",
      needsClientEspn: Boolean(err.needsClientEspn || status === 403),
      requests: err.counters || { espnRequests: 0, cfbdRequests: 0 },
    });
  }
};
