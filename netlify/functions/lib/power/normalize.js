/**
 * Normalization helpers for power model metrics.
 */

function mean(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (arr.length < 2) return 1;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v) || 1;
}

/** Relative to population mean (points/efficiency units), not z-score unless scale=stdev. */
function relativeToMean(value, populationMean) {
  if (!Number.isFinite(value)) return 0;
  return value - (Number.isFinite(populationMean) ? populationMean : 0);
}

function zScore(value, populationMean, populationStd) {
  if (!Number.isFinite(value)) return 0;
  const s = populationStd > 1e-9 ? populationStd : 1;
  return (value - populationMean) / s;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function centerToZero(map) {
  const vals = [...map.values()].filter((v) => Number.isFinite(v));
  if (!vals.length) return map;
  const m = mean(vals);
  const out = new Map();
  for (const [k, v] of map.entries()) {
    out.set(k, (Number(v) || 0) - m);
  }
  return out;
}

function powerScoreFromRaw(rawPower, scale, lo = 0, hi = 100) {
  return clamp(50 + (Number(rawPower) || 0) * scale, lo, hi);
}

function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round((Number(n) || 0) * p) / p;
}

module.exports = {
  mean,
  stdev,
  relativeToMean,
  zScore,
  clamp,
  centerToZero,
  powerScoreFromRaw,
  round,
};
