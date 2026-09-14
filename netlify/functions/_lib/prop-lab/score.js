const { clamp } = require("./math");

function labelForScore(score) {
  if (score >= 84) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 66) return "Lean";
  if (score >= 56) return "Slight Lean";
  return "Pass";
}

function confidenceModifier(letter) {
  return (
    {
      A: 1,
      "A-": 0.98,
      "B+": 0.96,
      B: 0.94,
      "B-": 0.92,
      "C+": 0.9,
      C: 0.87,
      D: 0.84,
    }[letter] || 0.9
  );
}

/**
 * Ranking score, not P(hit) and not confidence.
 * Primary signal is modeled P(chosen side). Confidence only trims it.
 * Matchup is already inside the projection / probability — not added again.
 */
function propScore({ pHit, confidenceLetter, roleStable }) {
  const p = clamp(pHit ?? 0.5, 0.005, 0.995);
  const rawStrength = 50 + 100 * (p - 0.5);
  const confMod = confidenceModifier(confidenceLetter);
  const stabilityMod = roleStable === false ? 0.95 : 1;
  const final = clamp(Math.round(rawStrength * confMod * stabilityMod), 20, 96);
  return {
    score: final,
    label: labelForScore(final),
    components: {
      probability: Number(p.toFixed(4)),
      rawStrength: Number(rawStrength.toFixed(2)),
      confidenceModifier: confMod,
      stabilityModifier: stabilityMod,
      matchupComponent: 0,
      edgeComponent: 0,
      sampleComponent: 1,
      final,
    },
  };
}

module.exports = { propScore, labelForScore, confidenceModifier };
