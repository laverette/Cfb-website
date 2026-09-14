const { clamp } = require("./math");

function labelForScore(score) {
  if (score >= 84) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 66) return "Lean";
  if (score >= 56) return "Slight Lean";
  return "Pass";
}

/**
 * Conservative 0–100 ranking score. Not P(hit).
 * Most average props should land in Pass / Slight Lean.
 */
function propScore({ pHit, edgeAbs, edgeRel, confidenceLetter, consistency, roleStable, sampleGames }) {
  const pEdge = Math.abs((pHit ?? 0.5) - 0.5);
  const confMult = {
    A: 1,
    "A-": 0.94,
    "B+": 0.86,
    B: 0.78,
    "B-": 0.7,
    "C+": 0.6,
    C: 0.5,
    D: 0.38,
  }[confidenceLetter] || 0.55;

  const cons = clamp(consistency ?? 0.5, 0.2, 1);
  const role = roleStable ? 1 : 0.9;
  const sample = clamp((Number(sampleGames) || 0) / 8, 0.25, 1);

  let score =
    48 +
    pEdge * 70 * confMult +
    clamp(edgeRel || 0, 0, 0.25) * 40 * confMult +
    (cons - 0.5) * 8 +
    (role - 1) * 6;

  score *= 0.55 + 0.45 * sample;
  if ((pHit ?? 0.5) < 0.52 && (pHit ?? 0.5) > 0.48) score = Math.min(score, 54);
  if (confMult <= 0.5) score = Math.min(score, 62);

  score = clamp(Math.round(score), 22, 93);
  return { score, label: labelForScore(score) };
}

module.exports = { propScore, labelForScore };
