const { clamp } = require("./math");

const GRADES = ["D", "C", "C+", "B-", "B", "B+", "A-", "A"];

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
  let score =
    18 +
    inputs.sample * 28 +
    inputs.prior * 12 +
    inputs.completeness * 18 +
    inputs.role * 8 +
    inputs.variance * 8 +
    inputs.matchup * 8;

  const flagSet = new Set(flags || []);
  if (flagSet.has("Small Sample")) score -= 12;
  if (flagSet.has("Limited History")) score -= 8;
  if (flagSet.has("Missing Data")) score -= 14;
  if (flagSet.has("Transfer")) score -= 8;
  if (flagSet.has("New Starter")) score -= 10;
  if (flagSet.has("FCS-Heavy Sample")) score -= 6;
  if (flagSet.has("High Variance")) score -= 7;
  if (flagSet.has("Role Change")) score -= 4;

  score = clamp(score, 18, 94);
  const letter = letterFromScore(score);
  return { letter, score, inputs, grades: GRADES };
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
};
