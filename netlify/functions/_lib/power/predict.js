/**
 * Matchup predictor — primary spread = power line + residual talent edge.
 * Power-only line is always retained for comparison (never uses 0–100 Power Score).
 */

const { getModelParams } = require("./config");
const { round, clamp } = require("./normalize");
const { buildExplanation } = require("./explain");

function winProbability(projectedMargin, tau) {
  const t = tau > 1e-6 ? tau : 8.5;
  const p = 1 / (1 + Math.exp(-projectedMargin / t));
  return clamp(p, 0.001, 0.999);
}

/** Map 0–100 talent score → points-above-average (same scale as raw power). */
function talentToPoints(talentRating, params) {
  const scale = params.powerScoreScale > 1e-6 ? params.powerScoreScale : 2.2;
  return ((Number(talentRating) || 50) - 50) / scale;
}

function spreadLabel(favorite, margin) {
  const mag = Math.abs(margin);
  return `${favorite.name || favorite.teamId} -${round(mag, 1)}`;
}

/**
 * @param {object} args
 * @param {object} args.teamA rating row (needs rawPower, offenseRating, ...)
 * @param {object} args.teamB rating row
 * @param {'a_home'|'b_home'|'neutral'} args.venue
 * @param {number} [args.personnelA]
 * @param {number} [args.personnelB]
 * @param {object} [args.paramOverrides]
 */
function predictMatchup({
  teamA,
  teamB,
  venue = "neutral",
  personnelA = 0,
  personnelB = 0,
  paramOverrides = {},
}) {
  if (!teamA || !teamB) {
    throw new Error("teamA and teamB are required");
  }
  if (String(teamA.teamId) === String(teamB.teamId)) {
    throw new Error("Teams must be different");
  }

  const params = getModelParams(paramOverrides);
  const rawA = Number(teamA.rawPower) || 0;
  const rawB = Number(teamB.rawPower) || 0;
  const persA = Number(personnelA) || 0;
  const persB = Number(personnelB) || 0;

  const talentPtsA = talentToPoints(teamA.talentRating, params);
  const talentPtsB = talentToPoints(teamB.talentRating, params);
  const talentEdge = talentPtsA - talentPtsB;
  const talentWeight = Number(params.matchupTalentWeight);
  const talentAdjustment =
    Number.isFinite(talentWeight) && talentWeight !== 0 ? talentEdge * talentWeight : 0;

  const powerNeutralMargin = rawA - rawB + persA - persB;
  let venueAdjustment = 0;
  if (venue === "a_home") venueAdjustment = params.homeFieldAdvantage;
  else if (venue === "b_home") venueAdjustment = -params.homeFieldAdvantage;

  // Power-only line (what we used to show as the sole spread)
  const powerMargin = powerNeutralMargin + venueAdjustment;
  const powerFavA = powerMargin >= 0;
  const powerFavorite = powerFavA ? teamA : teamB;
  const powerSpreadLabel = spreadLabel(powerFavorite, powerMargin);

  // Primary projected spread: power line + residual talent
  const neutralMargin = powerNeutralMargin + talentAdjustment;
  const projectedMargin = neutralMargin + venueAdjustment;
  const pA = winProbability(projectedMargin, params.winProbTau);
  const pB = 1 - pA;

  const aFavored = projectedMargin >= 0;
  const favorite = aFavored ? teamA : teamB;
  const spreadMagnitude = Math.abs(projectedMargin);
  const projectedSpreadLabel = spreadLabel(favorite, projectedMargin);

  const result = {
    teamA: {
      teamId: teamA.teamId,
      name: teamA.name,
      rawPower: round(rawA, 2),
      powerScore: teamA.powerScore,
      offenseRating: teamA.offenseRating,
      defenseRating: teamA.defenseRating,
      specialTeamsRating: teamA.specialTeamsRating,
      talentRating: teamA.talentRating,
      talentPoints: round(talentPtsA, 2),
      sosRating: teamA.sosRating,
      record: teamA.record,
      winProbability: round(pA * 100, 1),
    },
    teamB: {
      teamId: teamB.teamId,
      name: teamB.name,
      rawPower: round(rawB, 2),
      powerScore: teamB.powerScore,
      offenseRating: teamB.offenseRating,
      defenseRating: teamB.defenseRating,
      specialTeamsRating: teamB.specialTeamsRating,
      talentRating: teamB.talentRating,
      talentPoints: round(talentPtsB, 2),
      sosRating: teamB.sosRating,
      record: teamB.record,
      winProbability: round(pB * 100, 1),
    },
    venue,
    homeFieldAdvantageParam: params.homeFieldAdvantage,
    matchupTalentWeight: round(Number.isFinite(talentWeight) ? talentWeight : 0, 3),
    talentAdjustment: round(talentAdjustment, 2),
    powerNeutralMargin: round(powerNeutralMargin, 2),
    powerMargin: round(powerMargin, 2),
    powerSpreadLabel,
    neutralMargin: round(neutralMargin, 2),
    venueAdjustment: round(venueAdjustment, 2),
    projectedMargin: round(projectedMargin, 2),
    projectedSpread: round(aFavored ? -spreadMagnitude : spreadMagnitude, 1),
    projectedSpreadLabel,
    predictedWinner: {
      teamId: favorite.teamId,
      name: favorite.name,
    },
    winProbabilityA: round(pA * 100, 1),
    winProbabilityB: round(pB * 100, 1),
    comparisons: {
      power: round(rawA - rawB, 2),
      offense: round((Number(teamA.offenseRating) || 0) - (Number(teamB.offenseRating) || 0), 2),
      defense: round((Number(teamA.defenseRating) || 0) - (Number(teamB.defenseRating) || 0), 2),
      specialTeams: round(
        (Number(teamA.specialTeamsRating) || 0) - (Number(teamB.specialTeamsRating) || 0),
        2
      ),
      talent: round((Number(teamA.talentRating) || 0) - (Number(teamB.talentRating) || 0), 1),
      talentPoints: round(talentEdge, 2),
      sos: round((Number(teamA.sosRating) || 0) - (Number(teamB.sosRating) || 0), 2),
    },
    explanation: "",
  };

  result.explanation = buildExplanation(result, params);
  return result;
}

module.exports = {
  predictMatchup,
  winProbability,
  talentToPoints,
};
