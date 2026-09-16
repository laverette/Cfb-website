const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const {
  applyCalibrator,
  applyTemperature,
  fitTemperature,
  fitIsotonic,
  fitTemperatureByDist,
  temperatureFor,
  selectCalibrator,
  scoreCalibrator,
  calibrationWeight,
  zSupportFrom,
  symmetrize,
  pav,
  paramCount,
  loadCalibrator,
  CATASTROPHE_CAP,
  IDENTITY,
} = require(path.join(root, "calibration"));
const { probabilityAtLine } = require(path.join(root, "simulate"));
const { mulberry32 } = require(path.join(root, "math"));

/**
 * Synthetic rows whose true hit rate is a known, deliberately overconfident
 * function of the stated probability, so a correct fit has something to find.
 */
function overconfidentRows({ n = 2000, distortion = 3, seed = 7, dist = "normal", zMax = 1 } = {}) {
  const rng = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const stated = 0.5 + (rng() - 0.5) * 0.9; // spread across [0.05, 0.95]
    // True probability is the stated one pulled toward 0.5 by `distortion`.
    const truth = applyTemperature(stated, distortion);
    rows.push({
      pHit: stated,
      side: "more",
      hit: rng() < truth,
      z: rng() * zMax,
      dist,
      split: i % 2 === 0 ? "train" : "val",
    });
  }
  return rows;
}

describe("calibration: structural guarantees", () => {
  const cal = { method: "temperature", temperature: 2.5, zSupport: 1.3, maxProbability: 0.97 };

  it("is symmetric so P(more) and P(less) always sum to 1", () => {
    for (const p of [0.01, 0.2, 0.37, 0.5, 0.63, 0.8, 0.99]) {
      const a = applyCalibrator(cal, p, { z: 0.2 });
      const b = applyCalibrator(cal, 1 - p, { z: 0.2 });
      assert.ok(Math.abs(a + b - 1) < 1e-9, `${p}: ${a} + ${b}`);
    }
  });

  it("is monotone, so calibration never reorders two legs", () => {
    let prev = 0;
    for (let p = 0.02; p <= 0.98; p += 0.02) {
      const q = applyCalibrator(cal, p, { z: 0.3 });
      assert.ok(q >= prev - 1e-12, `not monotone at ${p}`);
      prev = q;
    }
  });

  it("always moves toward 50%, never away", () => {
    for (const p of [0.55, 0.7, 0.85, 0.95, 0.3, 0.1]) {
      const q = applyCalibrator(cal, p, { z: 0.2 });
      assert.ok(Math.abs(q - 0.5) <= Math.abs(p - 0.5) + 1e-9, `${p} -> ${q}`);
    }
  });

  it("leaves 50% untouched", () => {
    assert.ok(Math.abs(applyCalibrator(cal, 0.5, { z: 0 }) - 0.5) < 1e-9);
  });

  it("caps at the catastrophe rate rather than at certainty", () => {
    const q = applyCalibrator(cal, 0.99999, { z: 50 });
    assert.ok(Math.abs(q - CATASTROPHE_CAP) < 1e-9, `got ${q}`);
    const lo = applyCalibrator(cal, 0.00001, { z: 50 });
    assert.ok(Math.abs(lo - (1 - CATASTROPHE_CAP)) < 1e-9, `got ${lo}`);
  });

  it("identity calibrator is a no-op apart from the cap", () => {
    assert.ok(Math.abs(applyCalibrator(IDENTITY, 0.62, { z: 0.1 }) - 0.62) < 1e-9);
  });
});

describe("calibration: z-gating", () => {
  const cal = { method: "temperature", temperature: 3, zSupport: 1.3, zFade: 1, maxProbability: 0.97 };

  it("applies the full correction inside the supported z range", () => {
    assert.equal(calibrationWeight(0, cal), 1);
    assert.equal(calibrationWeight(1.3, cal), 1);
    const q = applyCalibrator(cal, 0.8, { z: 0.5 });
    assert.ok(Math.abs(q - applyTemperature(0.8, 3)) < 1e-9);
  });

  it("fades the correction outside the supported range", () => {
    assert.ok(calibrationWeight(2.5, cal) < 1);
    assert.ok(calibrationWeight(5, cal) < calibrationWeight(2.5, cal));
    assert.ok(calibrationWeight(20, cal) < 0.001);
  });

  // The failure this prevents: a 0.5-completion line for a 20-completion
  // quarterback is genuinely near-certain, and a correction fit entirely on
  // near-the-line props must not be extrapolated onto it.
  it("keeps a far-from-the-line prop near-certain", () => {
    const goblin = applyCalibrator(cal, 0.995, { z: 12 });
    assert.ok(goblin > 0.9, `goblin line collapsed to ${goblin}`);
    const nearLine = applyCalibrator(cal, 0.995, { z: 0.2 });
    assert.ok(nearLine < goblin, "near-the-line should be corrected harder than far-from-line");
  });

  it("derives the supported range from the data", () => {
    const rows = overconfidentRows({ n: 500, zMax: 2 });
    const zs = zSupportFrom(rows, 0.99);
    assert.ok(zs > 0 && zs <= 2, `got ${zs}`);
  });
});

describe("calibration: fitting", () => {
  // The loss-minimising T should land on the true distortion. The value the
  // fitter actually returns is deliberately lower — see the tolerance rule
  // below — so correctness of the fit is checked on the unregularized optimum.
  it("recovers a known distortion at the loss minimum", () => {
    for (const trueT of [1, 2, 3]) {
      const rows = overconfidentRows({ n: 4000, distortion: trueT, seed: 11 });
      const fit = fitTemperature(rows, { zSupport: 5 });
      assert.ok(fit, "expected a fit");
      assert.ok(
        Math.abs(fit.fit.bestTemperature - trueT) < 0.35,
        `true T=${trueT}, recovered ${fit.fit.bestTemperature}`
      );
    }
  });

  it("returns T near 1 when the input is already calibrated", () => {
    const rows = overconfidentRows({ n: 4000, distortion: 1, seed: 5 });
    const fit = fitTemperature(rows, { zSupport: 5 });
    assert.ok(fit.temperature < 1.6, `over-corrected calibrated input to T=${fit.temperature}`);
  });

  // Guards against the flat-surface failure: log loss barely moves once past
  // the optimum, so a descent method just runs to whichever bound it was given
  // and reports a number that looks fitted but is an artifact of the search.
  it("prefers the smallest temperature within tolerance of the best loss", () => {
    const rows = overconfidentRows({ n: 3000, distortion: 3, seed: 13 });
    const fit = fitTemperature(rows, { zSupport: 5 });
    assert.ok(fit.temperature <= fit.fit.bestTemperature + 1e-9, "chosen T must not exceed the optimum");
    assert.ok(fit.fit.chosenLoss <= fit.fit.bestLoss * (1 + fit.fit.tolerance) + 1e-9);
  });

  it("does not depend on where the search was bounded", () => {
    const rows = overconfidentRows({ n: 3000, distortion: 3, seed: 17 });
    const narrow = fitTemperature(rows, { zSupport: 5, hi: 8 });
    const wide = fitTemperature(rows, { zSupport: 5, hi: 40 });
    assert.ok(
      Math.abs(narrow.temperature - wide.temperature) < 0.2,
      `bound-sensitive: ${narrow.temperature} vs ${wide.temperature}`
    );
  });

  it("mirrors every observation so the fit cannot go asymmetric", () => {
    const pts = symmetrize([{ pHit: 0.8, side: "more", hit: true, z: 0.4, dist: "normal" }]);
    assert.equal(pts.length, 2);
    assert.ok(Math.abs(pts[0].x + pts[1].x - 1) < 1e-9);
    assert.equal(pts[0].y + pts[1].y, 1);
    assert.equal(pts[1].z, 0.4, "|z| is orientation-independent");
  });

  it("normalizes a Less-side row into More orientation", () => {
    const [first] = symmetrize([{ pHit: 0.7, side: "less", hit: true, z: 0.1 }]);
    assert.ok(Math.abs(first.x - 0.3) < 1e-9, "P(less)=0.7 means P(more)=0.3");
    assert.equal(first.y, 0, "a Less hit is a More miss");
  });

  it("pool adjacent violators produces a non-decreasing fit", () => {
    const blocks = pav([
      { x: 0.1, y: 1, w: 1 },
      { x: 0.2, y: 0, w: 1 },
      { x: 0.3, y: 0, w: 1 },
      { x: 0.4, y: 1, w: 1 },
    ]);
    let prev = -Infinity;
    for (const b of blocks) {
      assert.ok(b.value >= prev - 1e-12);
      prev = b.value;
    }
  });
});

describe("calibration: model selection", () => {
  const rows = overconfidentRows({ n: 3000, distortion: 3, seed: 21 });
  const train = rows.filter((r) => r.split === "train");
  const val = rows.filter((r) => r.split === "val");

  it("beats the identity map on held-out data", () => {
    const { best } = selectCalibrator(train, val);
    const before = scoreCalibrator(IDENTITY, val);
    const after = scoreCalibrator(best, val);
    assert.ok(after.logLoss < before.logLoss, `${after.logLoss} vs ${before.logLoss}`);
    assert.ok(after.ece < before.ece, `ece ${after.ece} vs ${before.ece}`);
  });

  it("rejects isotonic's extra parameters when they do not pay for themselves", () => {
    const { parsimony } = selectCalibrator(train, val);
    const iso = parsimony.ledger.find((s) => s.candidate.startsWith("isotonic"));
    assert.ok(iso, "isotonic should be a candidate");
    assert.ok(iso.required > 0.02, `27 knots should be expensive, required ${iso.required}`);
  });

  it("prices complexity by parameter count", () => {
    assert.equal(paramCount(IDENTITY), 0);
    assert.equal(paramCount({ method: "temperature", temperature: 2 }), 1);
    assert.equal(paramCount({ method: "temperature", byDist: { normal: 2, poisson: 1 } }), 2);
    assert.equal(paramCount({ method: "isotonic", knots: new Array(9) }), 9);
  });

  // Micro-averaged log loss let a pooled temperature make Poisson props worse
  // than no correction while still looking like an overall improvement.
  it("scores each distribution family separately so a small one cannot be masked", () => {
    const mixed = [
      ...overconfidentRows({ n: 1200, distortion: 4, seed: 31, dist: "normal" }),
      ...overconfidentRows({ n: 400, distortion: 1.2, seed: 32, dist: "poisson" }),
    ];
    const score = scoreCalibrator({ method: "temperature", temperature: 4, zSupport: 5 }, mixed);
    assert.ok(score.byDist.normal, "expected a normal family score");
    assert.ok(score.byDist.poisson, "expected a poisson family score");
    assert.ok(Number.isFinite(score.macroLogLoss));
    assert.notEqual(score.macroLogLoss, score.logLoss);
  });

  it("can fit a separate temperature per family when the data asks for it", () => {
    const mixed = [
      ...overconfidentRows({ n: 1200, distortion: 4, seed: 41, dist: "normal" }),
      ...overconfidentRows({ n: 800, distortion: 1.2, seed: 42, dist: "poisson" }),
    ];
    const fit = fitTemperatureByDist(mixed, { zSupport: 5 });
    assert.ok(fit.byDist, "expected per-family temperatures");
    assert.ok(
      fit.byDist.normal > fit.byDist.poisson,
      `normal ${fit.byDist.normal} should need more correction than poisson ${fit.byDist.poisson}`
    );
    assert.equal(temperatureFor(fit, "poisson"), fit.byDist.poisson);
    assert.equal(temperatureFor(fit, "unseen-family"), fit.temperature, "falls back to pooled");
  });
});

describe("calibration: wired into the served probability", () => {
  const dist = { mean: 110, sd: 38, dist: "normal", reliability: 0.4, games: 2 };

  it("reports the uncalibrated value and the adjustment it applied", () => {
    const p = probabilityAtLine(dist, 95.5, "more");
    assert.ok(Number.isFinite(p.pUncalibrated));
    assert.ok(Math.abs(p.calibrationAdjustment - (p.pHit - p.pUncalibrated)) < 1e-9);
    assert.ok(Math.abs(p.pHit - 0.5) <= Math.abs(p.pUncalibrated - 0.5) + 1e-9);
  });

  it("can be disabled for backtesting so a fit is never circular", () => {
    const on = probabilityAtLine({ ...dist, calibrate: true }, 95.5, "more");
    const off = probabilityAtLine({ ...dist, calibrate: false }, 95.5, "more");
    assert.equal(off.calibrationAdjustment, 0);
    assert.equal(off.calibrationMethod, "identity");
    assert.ok(Math.abs(off.pHit - 0.5) > Math.abs(on.pHit - 0.5) - 1e-9);
  });

  it("keeps More and Less exactly complementary after calibration", () => {
    for (const line of [70.5, 95.5, 110.5, 140.5]) {
      const more = probabilityAtLine(dist, line, "more");
      const less = probabilityAtLine(dist, line, "less");
      assert.ok(Math.abs(more.pMore + less.pLess - 1) < 1e-9, `line ${line}`);
    }
  });

  it("stays monotone in the line after calibration", () => {
    let prev = 1;
    for (const line of [60.5, 80.5, 100.5, 120.5, 140.5]) {
      const p = probabilityAtLine(dist, line, "more").pMore;
      assert.ok(p <= prev + 1e-12, `not monotone at ${line}`);
      prev = p;
    }
  });

  it("ships a frozen calibrator that is actually installed", () => {
    const cal = loadCalibrator();
    assert.notEqual(cal.method, "identity", "run npm run calibrate:props to install one");
    assert.ok(cal.maxProbability <= CATASTROPHE_CAP + 1e-9);
    assert.ok(Number.isFinite(cal.zSupport) && cal.zSupport > 0);
  });
});
