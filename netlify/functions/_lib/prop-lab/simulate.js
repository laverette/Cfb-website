const { clamp, normalCdf, poissonCdf, mulberry32, sampleNormal, sampleLogNormal } = require("./math");

function logNormalParams(mean, sd) {
  const m = Math.max(mean, 0.5);
  const v = Math.max(sd, 0.5) ** 2;
  const sigma = Math.sqrt(Math.log(1 + v / (m * m)));
  const mu = Math.log(m) - 0.5 * sigma * sigma;
  return { mu, sigma };
}

function simulateOutcomes({ mean, sd, dist, floor, ceil, n = 10000, seed = 20260 }) {
  const rng = mulberry32(seed);
  const out = new Array(n);
  if (dist === "poisson") {
    const lambda = Math.max(0.01, mean);
    for (let i = 0; i < n; i += 1) {
      // Knuth
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= rng();
      } while (p > L && k < 20);
      out[i] = clamp(k - 1, floor, ceil);
    }
    return out;
  }
  if (dist === "lognormal") {
    const { mu, sigma } = logNormalParams(mean, sd);
    for (let i = 0; i < n; i += 1) {
      out[i] = clamp(sampleLogNormal(rng, mu, sigma), floor, ceil);
    }
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    out[i] = clamp(sampleNormal(rng, mean, sd), floor, ceil);
  }
  return out;
}

function summarizeSims(sims) {
  const xs = sims.slice().sort((a, b) => a - b);
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const q = (p) => xs[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  return {
    mean,
    median: q(0.5),
    p20: q(0.2),
    p80: q(0.8),
  };
}

function rawProbability({ mean, sd, dist, line, side }) {
  if (!Number.isFinite(mean) || !Number.isFinite(line)) return 0.5;
  let pMore;
  if (dist === "poisson") {
    const lambda = Math.max(0.01, mean);
    const kFloor = Math.floor(line);
    pMore = 1 - poissonCdf(kFloor, lambda);
  } else if (dist === "lognormal") {
    const { mu, sigma } = logNormalParams(mean, Math.max(sd || 1, 0.4));
    const z = (Math.log(Math.max(line, 0.01)) - mu) / sigma;
    pMore = 1 - normalCdf(z, 0, 1);
  } else {
    pMore = 1 - normalCdf(line, mean, Math.max(sd || 1, 0.35));
  }
  pMore = clamp(pMore, 0.02, 0.98);
  if (side === "less") return { pMore, pHit: 1 - pMore, pLess: 1 - pMore };
  return { pMore, pLess: 1 - pMore, pHit: pMore };
}

/**
 * Poor data quality must push probability toward a coin flip, not toward certainty.
 */
function shrinkProbability(pRaw, reliability, games) {
  const rel = clamp(reliability, 0.15, 1);
  let p = 0.5 + (pRaw - 0.5) * rel;
  const cap = games < 3 ? 0.68 : games < 5 ? 0.74 : games < 8 ? 0.8 : 0.86;
  if (p > cap) p = cap;
  if (p < 1 - cap) p = 1 - cap;
  return p;
}

function probabilityAtLine(distParams, line, side = "more") {
  const raw = rawProbability({
    mean: distParams.mean,
    sd: distParams.sd,
    dist: distParams.dist,
    line,
    side,
  });
  const pHitRaw = side === "less" ? raw.pLess : raw.pMore;
  const pHit = shrinkProbability(pHitRaw, distParams.reliability, distParams.games);
  const pMore = side === "less" ? 1 - pHit : pHit;
  return {
    pMore,
    pLess: 1 - pMore,
    pHit,
    pRaw: pHitRaw,
  };
}

module.exports = {
  simulateOutcomes,
  summarizeSims,
  rawProbability,
  shrinkProbability,
  probabilityAtLine,
  logNormalParams,
};
