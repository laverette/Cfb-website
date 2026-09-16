const { clamp } = require("./math");

const GRADES = ["D", "C", "C+", "B-", "B", "B+", "A-", "A"];

/**
 * What the letter does and does not mean.
 *
 * It scores the quality of the inputs behind a projection — sample size, prior
 * history, input completeness, role stability. It is NOT a forecast of whether
 * the leg cashes. The frozen TEST scorecard is blunt about this: grade A hit
 * 46.8% and grade D hit 56.4%. Anything that wants "how likely is this to hit"
 * should read the calibrated probability instead.
 */
const CONFIDENCE_MEANING =
  "Model Confidence grades the data behind the projection (sample size, history, input completeness) — not how likely the leg is to hit. Use the calibrated probability for that.";

function letterFromScore(s) {
  const x = clamp(s, 0, 100);
  if (x >= 88) return "A";
  if (x >= 82) return "A-";
  if (x >= 76) return "B+";
  if (x >= 70) return "B";
  if (x >= 64) return "B-";
  if (x >= 56) return "C+";
  if (x >= 48) return "C";
  return "D";
}

function confidenceGrade({
  games,
  priorGames,
  flags,
  completeness,
  roleStable,
  varianceHigh,
  matchupOk,
  transfer,
}) {
  const inputs = {
    sample: clamp((Number(games) || 0) / 8, 0, 1),
    prior: clamp((Number(priorGames) || 0) / 10, 0, 1) * 0.5,
    completeness: clamp(completeness ?? 0.6, 0, 1),
    role: roleStable ? 1 : 0.55,
    variance: varianceHigh ? 0.45 : 1,
    matchup: matchupOk ? 1 : 0.6,
    transfer: transfer ? 0.55 : 1,
  };
  const breakdown = [
    { label: "Base", value: 18 },
    { label: "Sample size", value: Number((inputs.sample * 28).toFixed(2)) },
    { label: "Prior history", value: Number((inputs.prior * 12).toFixed(2)) },
    { label: "Input completeness", value: Number((inputs.completeness * 18).toFixed(2)) },
    { label: "Role stability", value: Number((inputs.role * 8).toFixed(2)) },
    { label: "Variance", value: Number((inputs.variance * 8).toFixed(2)) },
    { label: "Matchup coverage", value: Number((inputs.matchup * 8).toFixed(2)) },
  ];
  let score = breakdown.reduce((s, row) => s + row.value, 0);

  const flagSet = new Set(flags || []);
  const penalties = [
    ["Small Sample", -12],
    ["Limited History", -8],
    ["Missing Data", -14],
    ["Transfer", -8],
    ["New Starter", -10],
    ["FCS-Heavy Sample", -6],
    ["High Variance", -7],
    ["Role Change", -4],
  ];
  for (const [flag, pts] of penalties) {
    if (flagSet.has(flag)) {
      breakdown.push({ label: `Flag ${flag}`, value: pts });
      score += pts;
    }
  }

  score = clamp(score, 18, 94);
  const letter = letterFromScore(score);
  return { letter, score, inputs, grades: GRADES, breakdown, meaning: CONFIDENCE_MEANING };
}

function reliabilityFromConfidence(letter, games) {
  const map = { A: 0.92, "A-": 0.86, "B+": 0.8, B: 0.74, "B-": 0.66, "C+": 0.58, C: 0.5, D: 0.38 };
  const base = map[letter] || 0.55;
  const sampleHaircut = (Number(games) || 0) < 3 ? 0.82 : 1;
  return clamp(base * sampleHaircut, 0.28, 0.92);
}

function confidenceReasons({
  games,
  priorGames,
  flags,
  completeness,
  roleStable,
  varianceHigh,
  matchupOk,
  transfer,
  letter,
  score,
}) {
  const reasons = [];
  const flagSet = new Set(flags || []);
  const g = Number(games) || 0;
  const pg = Number(priorGames) || 0;
  if (g < 3) reasons.push(`Only ${g} current-season game${g === 1 ? "" : "s"}`);
  else if (g < 8) reasons.push(`Incomplete current sample (${g} games; 8+ is full weight)`);
  if (pg < 4) reasons.push(`Thin prior-year history (${pg} games)`);
  if (completeness != null && completeness < 0.55) {
    reasons.push(`Incomplete inputs (completeness ${Math.round(completeness * 100)}%)`);
  }
  if (roleStable === false) reasons.push("Role is not stable");
  if (varianceHigh) reasons.push("High week-to-week variance");
  if (matchupOk === false) reasons.push("Matchup inputs missing");
  if (transfer || flagSet.has("Transfer")) reasons.push("Transfer — prior-year stats discounted");
  const flagHits = [
    ["Small Sample", "−12"],
    ["Limited History", "−8"],
    ["Missing Data", "−14"],
    ["Transfer", "−8"],
    ["New Starter", "−10"],
    ["FCS-Heavy Sample", "−6"],
    ["High Variance", "−7"],
    ["Role Change", "−4"],
  ];
  for (const [flag, pts] of flagHits) {
    if (flagSet.has(flag)) reasons.push(`Flag ${flag} (${pts})`);
  }
  if (!reasons.length) reasons.push("No major confidence deductions");
  if (letter && score != null) reasons.push(`Grade ${letter} from score ${Math.round(score)}`);
  return reasons;
}

function collectFlags(bundle, extras = []) {
  const flags = [...(bundle.flags || [])];
  for (const f of extras) {
    if (f && !flags.includes(f)) flags.push(f);
  }
  return flags;
}

module.exports = {
  confidenceGrade,
  reliabilityFromConfidence,
  confidenceReasons,
  letterFromScore,
  collectFlags,
  CONFIDENCE_MEANING,
};
