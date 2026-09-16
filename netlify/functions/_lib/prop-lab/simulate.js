const { clamp, normalCdf, poissonCdf, poissonQuantile, mulberry32, sampleNormal, sampleLogNormal } = require("./math");
const { applyCalibrator, loadCalibrator, IDENTITY } = require("./calibration");

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

function analyticDistSummary({ mean, sd, dist, floor = 0, ceil = Infinity }) {
  if (dist === "poisson") {
    const lambda = Math.max(0.01, mean);
    return {
      mean,
      median: poissonQuantile(0.5, lambda),
      p20: poissonQuantile(0.2, lambda),
      p80: poissonQuantile(0.8, lambda),
      sd: Math.sqrt(lambda),
    };
  }
  const width = Math.max(sd || 1, 0.35);
  return {
    mean,
    median: mean,
    p20: clamp(mean - 0.8416 * width, floor, ceil),
    p80: clamp(mean + 0.8416 * width, floor, ceil),
    sd: width,
  };
}

function distZ({ mean, sd, dist, line }) {
  if (dist === "poisson") {
    return (line - mean) / Math.max(Math.sqrt(Math.max(mean, 0.01)), 0.45);
  }
  if (dist === "lognormal") {
    const { mu, sigma } = logNormalParams(mean, Math.max(sd || 1, 0.4));
    return (Math.log(Math.max(line, 0.01)) - mu) / Math.max(sigma, 0.05);
  }
  return (line - mean) / Math.max(sd || 1, 0.35);
}

function rawProbability({ mean, sd, dist, line, side }) {
  if (!Number.isFinite(mean) || !Number.isFinite(line)) {
    return { pMore: 0.5, pLess: 0.5, pHit: 0.5 };
  }
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
  pMore = clamp(pMore, 0.005, 0.995);
  if (side === "less") return { pMore, pHit: 1 - pMore, pLess: 1 - pMore };
  return { pMore, pLess: 1 - pMore, pHit: pMore };
}

/**
 * Uncertainty belongs in the distribution width (SD), not a 50% overwrite.
 * A tiny pull applies only when the line is already near the mean AND data
 * quality is poor — never when the line is far from the modeled center.
 * There is no 65/68/70% sample-size ceiling.
 */
function shrinkProbability(pRaw, reliability, games, zAbs = 0) {
  const p = clamp(pRaw, 0.005, 0.995);
  const far = Math.abs(zAbs);
  if (far >= 1.0) {
    return { p, pull: 0, reason: "Line is far from the mean — no extra 50% pull" };
  }
  const rel = clamp(reliability ?? 1, 0.2, 1);
  const near = clamp(1 - far, 0, 1);
  const pull = clamp(1 - rel, 0, 0.55) * near * 0.22;
  if (pull <= 0.005) {
    return { p, pull: 0, reason: "No uncertainty pull" };
  }
  return {
    p: 0.5 + (p - 0.5) * (1 - pull),
    pull,
    reason: `Mild near-the-line pull ${(pull * 100).toFixed(1)}% (reliability ${rel.toFixed(2)}, |z| ${far.toFixed(2)})`,
  };
}

function probabilityAtLine(distParams, line, side = "more") {
  const raw = rawProbability({
    mean: distParams.mean,
    sd: distParams.sd,
    dist: distParams.dist,
    line,
    side,
  });
  const z = distZ({
    mean: distParams.mean,
    sd: distParams.sd,
    dist: distParams.dist,
    line,
  });
  const pHitRaw = side === "less" ? raw.pLess : raw.pMore;
  const shrunk = shrinkProbability(pHitRaw, distParams.reliability ?? 1, distParams.games, Math.abs(z));
  const pMoreShrunk = side === "less" ? 1 - shrunk.p : shrunk.p;

  // Calibration is the last step: it is fit against the output of everything
  // above, so applying it earlier would measure a different pipeline.
  const calibrator = distParams.calibrate === false ? IDENTITY : loadCalibrator();
  const pMore = applyCalibrator(calibrator, pMoreShrunk, { z, dist: distParams.dist });
  const pHit = side === "less" ? 1 - pMore : pMore;

  return {
    pMore,
    pLess: 1 - pMore,
    pHit,
    pRaw: pHitRaw,
    z,
    pull: shrunk.pull,
    shrinkReason: shrunk.reason,
    pUncalibrated: shrunk.p,
    calibrationAdjustment: pHit - shrunk.p,
    calibrationMethod: calibrator.method,
  };
}

function probabilityCurve(distParams, lines, side = "more") {
  return (lines || []).map((line) => {
    const p = probabilityAtLine(distParams, line, side);
    return {
      line,
      pMore: p.pMore,
      pLess: p.pLess,
      pHit: p.pHit,
      pRaw: p.pRaw,
      z: p.z,
    };
  });
}

module.exports = {
  simulateOutcomes,
  summarizeSims,
  analyticDistSummary,
  rawProbability,
  shrinkProbability,
  probabilityAtLine,
  probabilityCurve,
  logNormalParams,
  distZ,
};
