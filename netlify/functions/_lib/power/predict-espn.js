/**
 * ESPN-first matchup prediction orchestration.
 * CFBD is never called from this path.
 */

const { predictMatchup } = require("./predict");
const { loadEspnEventPackage, emptyCounters } = require("./espn-fetch");
const { normalizeEspnMatchupPackage, hasEnoughMetrics } = require("./espn-normalize");
const { buildEspnRatingPair } = require("./espn-ratings");
const { round } = require("./normalize");

const DEBUG =
  process.env.MATCHUP_PREDICT_DEBUG === "1" ||
  process.env.NODE_ENV === "development" ||
  process.env.CONTEXT === "dev";

function logPredict(payload) {
  if (!DEBUG) return;
  console.log("[Matchup Predictor]", JSON.stringify(payload, null, 2));
}

function attachScoreAndMarket(prediction, input) {
  const total =
    Number.isFinite(Number(input.marketTotal)) && Number(input.marketTotal) > 20
      ? Number(input.marketTotal)
      : 52;
  const margin = Number(prediction.projectedMargin) || 0;
  // projectedMargin is A(away) − B(home).
  let awayPts = (total + margin) / 2;
  let homePts = (total - margin) / 2;
  awayPts = Math.max(3, round(awayPts, 1));
  homePts = Math.max(3, round(homePts, 1));

  prediction.projectedScore = {
    away: awayPts,
    home: homePts,
    total: round(awayPts + homePts, 1),
  };
  prediction.marketTotal = Number.isFinite(Number(input.marketTotal))
    ? Number(input.marketTotal)
    : null;

  const marketAway = Number.isFinite(Number(input.marketSpreadAway))
    ? Number(input.marketSpreadAway)
    : null;
  prediction.marketSpreadAway = marketAway;
  prediction.marketSpreadLabel = input.marketSpreadLabel || null;

  if (marketAway != null) {
    // Away-oriented lines: more negative = more on the away team.
    const modelAsAwayLine = -margin;
    const edge = marketAway - modelAsAwayLine;
    prediction.modelSpreadAway = round(modelAsAwayLine, 1);
    prediction.spreadEdge = round(edge, 1);
    // Positive edge ⇒ model is more bullish on away than the market.
    const edgeAbs = Math.abs(edge);
    if (edgeAbs < 0.35) {
      prediction.spreadEdgeLabel = "Model agrees with the market line";
    } else if (edge > 0) {
      prediction.spreadEdgeLabel = `Model leans ${prediction.teamA.name} by ${round(edgeAbs, 1)} vs the market`;
    } else {
      prediction.spreadEdgeLabel = `Model leans ${prediction.teamB.name} by ${round(edgeAbs, 1)} vs the market`;
    }
  } else {
    prediction.modelSpreadAway = round(-margin, 1);
    prediction.spreadEdge = null;
    prediction.spreadEdgeLabel = null;
  }

  prediction.espnPredictor = input.espnPredictor || null;
  prediction.metrics = {
    away: input.awayTeam.metrics,
    home: input.homeTeam.metrics,
  };
  prediction.recentForm = {
    away: summarizeForm(input.awayTeam.recentForm),
    home: summarizeForm(input.homeTeam.recentForm),
  };
  prediction.source = "espn";
  prediction.eventId = input.eventId;
  return prediction;
}

function summarizeForm(form) {
  if (!form) return null;
  return {
    avgMargin: form.avgMargin != null ? round(form.avgMargin, 1) : null,
    wins: form.wins,
    losses: form.losses,
    games: (form.games || []).map((g) => ({
      opponentName: g.opponentName,
      margin: g.margin,
      result: g.result,
      week: g.week,
    })),
  };
}

function buildWhyCaution(prediction, input) {
  const why = [];
  const caution = [];
  const a = prediction.teamA;
  const b = prediction.teamB;
  const c = prediction.comparisons;

  if (Number.isFinite(c.offense) && Math.abs(c.offense) >= 1) {
    const side = c.offense > 0 ? a.name : b.name;
    why.push(`${side} holds the stronger offensive rating (${round(Math.abs(c.offense), 1)} edge).`);
  }
  if (Number.isFinite(c.defense) && Math.abs(c.defense) >= 1) {
    const side = c.defense > 0 ? a.name : b.name;
    why.push(`${side} holds the stronger defensive rating (${round(Math.abs(c.defense), 1)} edge).`);
  }

  const aForm = input.awayTeam.recentForm?.avgMargin;
  const bForm = input.homeTeam.recentForm?.avgMargin;
  if (Number.isFinite(aForm) && Number.isFinite(bForm) && Math.abs(aForm - bForm) >= 3) {
    const side = aForm > bForm ? a.name : b.name;
    why.push(
      `${side} has the stronger recent scoring margin (L${(input.awayTeam.recentForm.games || []).length || 3}–5).`
    );
  }

  if (input.venue === "b_home" || (!input.neutralSite && input.venue !== "a_home")) {
    caution.push(`Road game for ${a.name}; home-field edge applied to ${b.name}.`);
  }
  if (input.neutralSite) {
    caution.push("Neutral site — no home-field adjustment.");
  }

  const softSample = (side) => {
    const games = side.recentForm?.games || [];
    if (games.length && games.length < 3) {
      caution.push(`${side.name} has a thin recent sample (${games.length} prior games).`);
    }
  };
  softSample(input.awayTeam);
  softSample(input.homeTeam);

  if (prediction.spreadEdgeLabel) why.push(prediction.spreadEdgeLabel);

  return { why, caution };
}

/**
 * Predict a Weekly Picks game using ESPN event data + our power model.
 * @param {object} [args.espnPackage] optional browser-fetched ESPN summary/gamepackageJSON
 *   (Netlify egress is often blocked with HTTP 403; the Weekly Picks page can fetch ESPN
 *   in-browser and POST the package here — same pattern as admin schedule).
 */
async function predictMatchupFromEspn({
  espnEventId,
  espnPackage = null,
  marketBettingLine = null,
  personnelA = 0,
  personnelB = 0,
  snapshotById = new Map(),
} = {}) {
  if (!espnEventId) {
    const err = new Error("espnEventId is required for ESPN matchup prediction");
    err.status = 400;
    throw err;
  }

  const counters = emptyCounters();
  let pkg = null;
  let packageSource = "server";

  if (espnPackage && typeof espnPackage === "object") {
    pkg = espnPackage.gamepackageJSON || espnPackage;
    packageSource = "client";
    counters.cacheHits += 1;
  } else {
    const loaded = await loadEspnEventPackage(espnEventId, counters);
    pkg = loaded.packageJson;
    if (!pkg) {
      const err = new Error(
        loaded.errors.length
          ? `ESPN matchup data unavailable (${loaded.errors.join("; ")})`
          : "ESPN matchup data unavailable"
      );
      err.status = loaded.blocked403 ? 403 : 503;
      err.needsClientEspn = true;
      err.counters = counters;
      throw err;
    }
  }

  const input = normalizeEspnMatchupPackage(pkg, {
    eventId: espnEventId,
    marketBettingLine,
  });
  if (!input || !hasEnoughMetrics(input)) {
    const err = new Error("Not enough matchup data available right now.");
    err.status = 503;
    err.needsClientEspn = packageSource === "server";
    err.counters = counters;
    throw err;
  }

  const { teamA, teamB, venue } = buildEspnRatingPair(input, { snapshotById });
  const prediction = predictMatchup({
    teamA,
    teamB,
    venue,
    personnelA,
    personnelB,
  });
  attachScoreAndMarket(prediction, input);
  const { why, caution } = buildWhyCaution(prediction, input);
  prediction.why = why;
  prediction.caution = caution;

  logPredict({
    eventId: input.eventId,
    away: input.awayTeam.name,
    home: input.homeTeam.name,
    venue: input.venue,
    neutralSite: input.neutralSite,
    packageSource,
    requests: counters,
    CFBD_requests: 0,
    away_offensive_rating: teamA.offenseRating,
    away_defensive_rating: teamA.defenseRating,
    home_offensive_rating: teamB.offenseRating,
    home_defensive_rating: teamB.defenseRating,
    home_field_adjustment: prediction.venueAdjustment,
    projected_score: prediction.projectedScore,
    model_spread: prediction.projectedSpreadLabel,
    market_spread: prediction.marketSpreadLabel,
  });

  return {
    source: packageSource === "client" ? "espn-client" : "espn",
    season: input.season,
    week: input.week,
    eventId: String(espnEventId),
    counters: { ...counters, cfbdRequests: 0 },
    prediction,
  };
}

module.exports = {
  predictMatchupFromEspn,
  attachScoreAndMarket,
  buildWhyCaution,
};
