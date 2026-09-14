function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function mean(arr) {
  const xs = (arr || []).filter((n) => Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(arr) {
  const xs = (arr || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function stddev(arr) {
  const xs = (arr || []).filter((n) => Number.isFinite(n));
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function minMax(arr) {
  const xs = (arr || []).filter((n) => Number.isFinite(n));
  if (!xs.length) return { min: null, max: null };
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function percentileRank(value, population) {
  const xs = (population || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length || !Number.isFinite(value)) return null;
  let below = 0;
  for (const x of xs) {
    if (x <= value) below += 1;
  }
  return below / xs.length;
}

function zScore(value, population) {
  const m = mean(population);
  const sd = stddev(population);
  if (m == null || !sd || sd < 1e-9 || !Number.isFinite(value)) return 0;
  return (value - m) / sd;
}

function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x, mu, sd) {
  if (!Number.isFinite(x) || !Number.isFinite(mu) || !Number.isFinite(sd) || sd <= 0) {
    return 0.5;
  }
  return 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2)));
}

function poissonPmf(k, lambda) {
  if (k < 0 || !Number.isFinite(lambda) || lambda < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) p *= lambda / i;
  return p;
}

function poissonCdf(k, lambda) {
  let s = 0;
  const cap = Math.max(k, 0);
  for (let i = 0; i <= cap; i += 1) s += poissonPmf(i, lambda);
  return clamp(s, 0, 1);
}

function poissonQuantile(p, lambda) {
  const target = clamp(p, 0, 1);
  let cdf = 0;
  for (let k = 0; k <= 40; k += 1) {
    cdf += poissonPmf(k, Math.max(lambda, 0));
    if (cdf >= target) return k;
  }
  return 40;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rng) {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleNormal(rng, mu, sd) {
  return mu + sd * boxMuller(rng);
}

function sampleLogNormal(rng, mu, sd) {
  const x = sampleNormal(rng, mu, sd);
  return Math.exp(x);
}

function lastN(arr, n) {
  if (!Array.isArray(arr) || !arr.length) return [];
  return arr.slice(-n);
}

function ordinal(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return "";
  const v = Math.abs(x) % 100;
  if (v >= 11 && v <= 13) return `${x}th`;
  const last = Math.abs(x) % 10;
  if (last === 1) return `${x}st`;
  if (last === 2) return `${x}nd`;
  if (last === 3) return `${x}rd`;
  return `${x}th`;
}

function hitRate(values, line, more) {
  const xs = (values || []).filter((n) => Number.isFinite(n));
  if (!xs.length || !Number.isFinite(line)) return null;
  const hits = xs.filter((v) => (more ? v > line : v < line)).length;
  return hits / xs.length;
}

function weightedMean(items) {
  let num = 0;
  let den = 0;
  for (const it of items || []) {
    if (!Number.isFinite(it.value) || !Number.isFinite(it.weight) || it.weight <= 0) continue;
    num += it.value * it.weight;
    den += it.weight;
  }
  if (den <= 0) return null;
  return num / den;
}

function expDecayWeight(ageFromLatest, lambda = 0.18) {
  return Math.exp(-lambda * ageFromLatest);
}

module.exports = {
  clamp,
  toNum,
  mean,
  median,
  stddev,
  minMax,
  percentileRank,
  zScore,
  erf,
  normalCdf,
  poissonPmf,
  poissonCdf,
  poissonQuantile,
  mulberry32,
  sampleNormal,
  sampleLogNormal,
  lastN,
  ordinal,
  hitRate,
  weightedMean,
  expDecayWeight,
};
