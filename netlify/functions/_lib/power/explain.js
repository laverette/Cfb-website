/**
 * Deterministic matchup explanation engine (no LLM).
 */

const { round } = require("./normalize");

function advantageLabel(diff, params) {
  const abs = Math.abs(diff);
  if (abs < (params.advantageSlight ?? 1.25)) return "even";
  if (abs < (params.advantageClear ?? 3.5)) return "slight advantage";
  if (abs < (params.advantageMajor ?? 7)) return "clear advantage";
  return "major advantage";
}

function sideName(diff, teamA, teamB) {
  if (Math.abs(diff) < 1e-9) return null;
  return diff > 0 ? teamA.name : teamB.name;
}

function buildExplanation(prediction, params) {
  const a = prediction.teamA;
  const b = prediction.teamB;
  const c = prediction.comparisons;
  const parts = [];

  const powerEdge = sideName(c.power, a, b);
  if (powerEdge) {
    parts.push(
      `${powerEdge} has the stronger overall power rating by ${round(Math.abs(c.power), 1)} points (${advantageLabel(c.power, params)}).`
    );
  } else {
    parts.push(`${a.name} and ${b.name} are essentially even in overall power.`);
  }

  const talentPtsEdge = c.talentPoints;
  if (Number.isFinite(talentPtsEdge) && Math.abs(talentPtsEdge) >= 1.5) {
    const talentSide = sideName(talentPtsEdge, a, b);
    if (talentSide) {
      parts.push(
        `${talentSide} holds a talent edge of about ${round(Math.abs(talentPtsEdge), 1)} points on the power scale.`
      );
    }
  }

  if (Number.isFinite(prediction.talentAdjustment) && Math.abs(prediction.talentAdjustment) >= 0.4) {
    parts.push(
      `Talent adds ${round(prediction.talentAdjustment, 1)} to the projected margin (power line ${prediction.powerSpreadLabel}).`
    );
  }

  const defEdge = sideName(c.defense, a, b);
  const offEdge = sideName(c.offense, a, b);
  if (Math.abs(c.defense) >= Math.abs(c.offense) && defEdge) {
    parts.push(
      `${defEdge}'s defensive rating creates the larger unit edge (${round(Math.abs(c.defense), 1)}).`
    );
  } else if (offEdge) {
    parts.push(
      `${offEdge} holds the offensive edge (${round(Math.abs(c.offense), 1)}).`
    );
  }

  if (prediction.venue === "a_home") {
    parts.push(
      `Playing at ${a.name} adds approximately ${round(params.homeFieldAdvantage, 1)} points of home-field advantage.`
    );
  } else if (prediction.venue === "b_home") {
    parts.push(
      `Playing at ${b.name} adds approximately ${round(params.homeFieldAdvantage, 1)} points of home-field advantage.`
    );
  } else {
    parts.push("Neutral site — no home-field adjustment.");
  }

  parts.push(
    `Model projects ${prediction.predictedWinner.name} (${prediction.projectedSpreadLabel}, ${
      prediction.predictedWinner.teamId === a.teamId
        ? prediction.winProbabilityA
        : prediction.winProbabilityB
    }% win probability).`
  );

  return parts.join(" ");
}

module.exports = {
  buildExplanation,
  advantageLabel,
};
