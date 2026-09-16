/**
 * Monotone probability calibration for Prop Lab.
 *
 * Model 2.0's raw probabilities are well centered but far too wide: the frozen
 * TEST scorecard has the 70%+ band predicting 74.0% and hitting 44.1%. This
 * module maps raw model probability to a calibrated one.
 *
 * Two properties matter and are enforced everywhere below:
 *
 *   symmetry   f(1 - p) = 1 - f(p), so P(more) and P(less) always sum to 1.
 *   monotone   f is non-decreasing, so calibration never reorders two legs.
 *
 * Symmetry also doubles the fitting data. A 28% prediction that missed is the
 * same evidence as a 72% prediction that hit, which is how the sparse high
 * band (n=34 on TEST) gets enough support to fit against.
 */
const { clamp } = require("./math");

const EPS = 1e-6;

function logit(p) {
  const x = clamp(p, EPS, 1 - EPS);
  return Math.log(x / (1 - x));
}

function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Normalize a graded row to "more" orientation so every fit sees one convention.
 */
function toMoreOrientation(row) {
  const side = row.side === "less" ? "less" : "more";
  const pHit = Number(row.pHit);
  const hit = row.hit;
  if (!Number.isFinite(pHit) || hit == null) return null;
  const p = side === "less" ? 1 - pHit : pHit;
  const y = side === "less" ? !hit : Boolean(hit);
  const z = Number(row.z);
  return {
    p: clamp(p, EPS, 1 - EPS),
    y: y ? 1 : 0,
    weight: Number(row.weight) || 1,
    z: Number.isFinite(z) ? Math.abs(z) : null,
    dist: row.dist || null,
  };
}

/**
 * Mirror each observation so the fit cannot learn an asymmetric map.
 * |z| is orientation-independent, so it carries across the mirror unchanged.
 */
function symmetrize(rows) {
  const out = [];
  for (const raw of rows || []) {
    const r = toMoreOrientation(raw);
    if (!r) continue;
    out.push({ x: r.p, y: r.y, w: r.weight, z: r.z, dist: r.dist });
    out.push({ x: 1 - r.p, y: 1 - r.y, w: r.weight, z: r.z, dist: r.dist });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Where the correction applies                                        *
 * ------------------------------------------------------------------ *
 *
 * Calibration corrects model uncertainty, and model uncertainty is worst when
 * the line sits on top of the projection: a 5% error in the mean flips a
 * near-the-line prop and does nothing to a prop 10 standard deviations out.
 *
 * That distinction matters because the fitting data only covers near-the-line
 * props. In the synthetic harness every line is set at the projection, so 99%
 * of rows fall below |z| = 1.3. Applying a correction fit there to a 0.5-
 * completion line for a 20-completion quarterback is extrapolation, and it
 * produces the absurd result of calling a near-certainty a coin flip.
 *
 * So the correction runs at full strength inside the supported |z| range and
 * fades out beyond it, back toward the model's own probability.
 */

/** Irreducible miss rate: injury, ejection, benching, weather. Not fit — stated. */
const CATASTROPHE_CAP = 0.97;

/** How quickly the correction fades once |z| leaves the supported range. */
const DEFAULT_Z_FADE = 1;

function calibrationWeight(z, cal) {
  const zSupport = Number(cal?.zSupport);
  if (!Number.isFinite(zSupport)) return 1;
  const az = Number.isFinite(z) ? Math.abs(z) : 0;
  if (az <= zSupport) return 1;
  const fade = Number(cal?.zFade) || DEFAULT_Z_FADE;
  return Math.exp(-(((az - zSupport) / fade) ** 2));
}

/** |z| below which the fitting data actually has support. */
function zSupportFrom(rows, quantile = 0.99) {
  const zs = symmetrize(rows)
    .map((p) => p.z)
    .filter((z) => Number.isFinite(z))
    .sort((a, b) => a - b);
  if (!zs.length) return null;
  const idx = Math.min(zs.length - 1, Math.floor(quantile * zs.length));
  return Number(zs[idx].toFixed(3));
}

/* ------------------------------------------------------------------ *
 * Temperature scaling: one parameter, inherently symmetric & monotone *
 * ------------------------------------------------------------------ */

function applyTemperature(p, T) {
  const t = Math.max(0.05, Number(T) || 1);
  return sigmoid(logit(p) / t);
}

function logLoss(points, predict) {
  let s = 0;
  let w = 0;
  for (const pt of points) {
    const q = clamp(predict(pt.x, pt.z, pt.dist), EPS, 1 - EPS);
    s += -pt.w * (pt.y * Math.log(q) + (1 - pt.y) * Math.log(1 - q));
    w += pt.w;
  }
  return w ? s / w : null;
}

/**
 * Relative log-loss tolerance for the one-standard-error rule below.
 */
const TEMPERATURE_TOLERANCE = 0.0025;

/**
 * Fit T by scanning a grid rather than descending, because the log-loss surface
 * in T is very flat once past the optimum: on the yardage family it moves by
 * 0.004 between T=3 and T=20. A descent method wanders to whichever bound it
 * was given and reports a number that looks fitted but is not.
 *
 * So we take the smallest T whose loss is within TEMPERATURE_TOLERANCE of the
 * best one. Less distortion for the same measured fit, and the result stops
 * depending on where the search happened to be bounded.
 */
function fitTemperature(rows, { lo = 0.5, hi = 20, zSupport = null, steps = 240 } = {}) {
  const points = symmetrize(rows);
  if (points.length < 20) return null;

  // Fit through the same z-gate used at serve time, so the fitted value is the
  // one that actually applies where the data lives.
  const loss = (t) =>
    logLoss(points, (x, z, dist) =>
      applyCalibrator(
        { method: "temperature", temperature: t, zSupport, maxProbability: CATASTROPHE_CAP },
        x,
        { z, dist }
      )
    );

  const grid = [];
  for (let i = 0; i <= steps; i += 1) {
    // Log-spaced: resolution where it matters, near T = 1.
    const t = lo * Math.pow(hi / lo, i / steps);
    grid.push({ t, loss: loss(t) });
  }
  const best = grid.reduce((a, b) => (b.loss < a.loss ? b : a));
  const threshold = best.loss * (1 + TEMPERATURE_TOLERANCE);
  const chosen = grid.find((g) => g.loss <= threshold) || best;

  return {
    method: "temperature",
    temperature: Number(chosen.t.toFixed(4)),
    zSupport,
    n: points.length / 2,
    fit: {
      bestTemperature: Number(best.t.toFixed(4)),
      bestLoss: Number(best.loss.toFixed(6)),
      chosenLoss: Number(chosen.loss.toFixed(6)),
      tolerance: TEMPERATURE_TOLERANCE,
    },
  };
}

/**
 * Minimum rows before a family gets its own temperature instead of the pooled one.
 */
const MIN_GROUP_ROWS = 150;

/**
 * Fit one temperature per distribution family.
 *
 * A single pooled temperature is actively harmful here. Yardage props modelled
 * as normal are wildly overconfident near the line, because the projection
 * error is comparable to the modelled spread. Count props modelled as Poisson
 * are only mildly overconfident, because a small-lambda Poisson already has an
 * honest tail. Pooling the two produces a temperature that over-corrects counts
 * and under-corrects yardage: on validation the pooled map left Poisson props
 * WORSE calibrated than no correction at all (ECE 0.082 vs 0.081 uncalibrated),
 * while their own temperature nearly halved it.
 */
function fitTemperatureByDist(rows, opts = {}) {
  const pooled = fitTemperature(rows, opts);
  if (!pooled) return null;

  const groups = new Map();
  for (const r of rows || []) {
    const d = r.dist || "unknown";
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(r);
  }

  const byDist = {};
  const detail = {};
  for (const [dist, list] of groups) {
    if (list.length < MIN_GROUP_ROWS) continue;
    const fit = fitTemperature(list, opts);
    if (!fit) continue;
    byDist[dist] = fit.temperature;
    detail[dist] = { n: list.length, temperature: fit.temperature, fit: fit.fit };
  }

  if (!Object.keys(byDist).length) return pooled;
  return {
    method: "temperature",
    temperature: pooled.temperature,
    byDist,
    zSupport: opts.zSupport ?? null,
    n: pooled.n,
    fit: { pooled: pooled.fit, byDist: detail },
  };
}

function temperatureFor(cal, dist) {
  if (cal?.byDist && dist && cal.byDist[dist] != null) return cal.byDist[dist];
  return cal?.temperature;
}

/* ---------------------------------------------- *
 * Isotonic regression via pool adjacent violators *
 * ---------------------------------------------- */

function pav(points) {
  const sorted = [...points].sort((p, q) => p.x - q.x);
  const blocks = sorted.map((p) => ({ sumWY: p.w * p.y, sumW: p.w, xMin: p.x, xMax: p.x }));
  const stack = [];
  for (const block of blocks) {
    stack.push(block);
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      const prev = stack[stack.length - 2];
      if (prev.sumWY / prev.sumW <= top.sumWY / top.sumW) break;
      stack.pop();
      stack.pop();
      stack.push({
        sumWY: prev.sumWY + top.sumWY,
        sumW: prev.sumW + top.sumW,
        xMin: prev.xMin,
        xMax: top.xMax,
      });
    }
  }
  return stack.map((b) => ({
    xMin: b.xMin,
    xMax: b.xMax,
    value: clamp(b.sumWY / b.sumW, EPS, 1 - EPS),
  }));
}

/**
 * Isotonic fit reduced to interpolation knots. Raw PAV can produce long flat
 * runs that snap legs to identical probabilities, so we keep block midpoints
 * and interpolate between them.
 */
function fitIsotonic(rows, { minPoints = 40 } = {}) {
  const points = symmetrize(rows);
  if (points.length < minPoints) return null;
  const blocks = pav(points);
  if (blocks.length < 2) return null;
  const knots = [{ x: 0, y: 0 }];
  for (const b of blocks) {
    const x = (b.xMin + b.xMax) / 2;
    const last = knots[knots.length - 1];
    if (x <= last.x) continue;
    knots.push({ x, y: Math.max(b.value, last.y) });
  }
  knots.push({ x: 1, y: Math.max(1, knots[knots.length - 1].y) });
  // Enforce f(1-p) = 1-f(p) by averaging the map against its mirror image.
  const symmetric = knots.map((k) => {
    const mirrored = 1 - interpolate(knots, 1 - k.x);
    return { x: k.x, y: clamp((k.y + mirrored) / 2, 0, 1) };
  });
  for (let i = 1; i < symmetric.length; i += 1) {
    if (symmetric[i].y < symmetric[i - 1].y) symmetric[i].y = symmetric[i - 1].y;
  }
  return { method: "isotonic", knots: symmetric, n: points.length / 2 };
}

function interpolate(knots, x) {
  if (!knots || !knots.length) return x;
  if (x <= knots[0].x) return knots[0].y;
  for (let i = 1; i < knots.length; i += 1) {
    if (x <= knots[i].x) {
      const a = knots[i - 1];
      const b = knots[i];
      const span = b.x - a.x;
      if (span <= 0) return b.y;
      return a.y + ((x - a.x) / span) * (b.y - a.y);
    }
  }
  return knots[knots.length - 1].y;
}

/* ----------------------- *
 * Apply / score / select  *
 * ----------------------- */

const IDENTITY = { method: "identity", maxProbability: CATASTROPHE_CAP };

/**
 * Map a raw "more" probability to its calibrated value.
 *
 * `z` is how many standard deviations the line sits from the projection. It
 * controls how much of the correction applies; see calibrationWeight above.
 * Callers that omit it get the full correction, which is the safe default for
 * near-the-line props.
 */
function applyCalibrator(cal, pMore, { z, dist } = {}) {
  const p = clamp(Number(pMore), EPS, 1 - EPS);
  const c = cal || IDENTITY;

  let full = p;
  if (c.method === "temperature") full = applyTemperature(p, temperatureFor(c, dist));
  else if (c.method === "isotonic") full = interpolate(c.knots, p);

  const w = calibrationWeight(z, c);
  const blended = w >= 1 ? full : sigmoid(logit(p) + w * (logit(full) - logit(p)));

  const cap = clamp(c.maxProbability ?? CATASTROPHE_CAP, 0.5 + EPS, 1 - EPS);
  return clamp(blended, 1 - cap, cap);
}

function scoreCalibrator(cal, rows) {
  const points = symmetrize(rows);
  if (!points.length) return null;
  const predict = (x, z, dist) => applyCalibrator(cal, x, { z, dist });
  let brier = 0;
  let w = 0;
  for (const pt of points) {
    const q = predict(pt.x, pt.z, pt.dist);
    brier += pt.w * (q - pt.y) ** 2;
    w += pt.w;
  }
  const bands = [
    [0.5, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.8],
    [0.8, 1.0001],
  ];
  let ece = 0;
  let total = 0;
  const table = [];
  for (const [lo, hi] of bands) {
    const slice = points.filter((pt) => {
      const q = predict(pt.x, pt.z, pt.dist);
      return q >= lo && q < hi;
    });
    if (!slice.length) {
      table.push({ band: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: 0 });
      continue;
    }
    const predicted = slice.reduce((s, pt) => s + predict(pt.x, pt.z, pt.dist), 0) / slice.length;
    const actual = slice.reduce((s, pt) => s + pt.y, 0) / slice.length;
    table.push({
      band: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      n: slice.length,
      predicted: Number(predicted.toFixed(4)),
      actual: Number(actual.toFixed(4)),
      gap: Number((predicted - actual).toFixed(4)),
    });
    ece += slice.length * Math.abs(predicted - actual);
    total += slice.length;
  }
  // Per-family scores, plus a macro average over families.
  //
  // The micro-averaged number is dominated by whichever family has the most
  // rows, which is how a pooled temperature that made Poisson props worse than
  // no correction at all still looked like an improvement overall. Selection
  // uses the macro number so a small family cannot be quietly sacrificed.
  const byDist = {};
  const dists = [...new Set(points.map((pt) => pt.dist).filter(Boolean))];
  for (const d of dists) {
    const slice = points.filter((pt) => pt.dist === d);
    if (slice.length < 40) continue;
    let b = 0;
    for (const pt of slice) b += (predict(pt.x, pt.z, pt.dist) - pt.y) ** 2;
    byDist[d] = {
      n: slice.length / 2,
      logLoss: Number(logLoss(slice, predict).toFixed(5)),
      brier: Number((b / slice.length).toFixed(5)),
    };
  }
  const familyLosses = Object.values(byDist).map((v) => v.logLoss);
  const macroLogLoss = familyLosses.length
    ? Number((familyLosses.reduce((s, v) => s + v, 0) / familyLosses.length).toFixed(5))
    : null;

  return {
    brier: w ? Number((brier / w).toFixed(5)) : null,
    logLoss: Number(logLoss(points, predict).toFixed(5)),
    macroLogLoss,
    ece: total ? Number((ece / total).toFixed(5)) : null,
    n: points.length / 2,
    byDist,
    table,
  };
}

/** Free parameters in a candidate, used to price added complexity. */
function paramCount(cal) {
  if (!cal || cal.method === "identity") return 0;
  if (cal.method === "isotonic") return (cal.knots || []).length;
  if (cal.byDist) return Object.keys(cal.byDist).length;
  return 1;
}

/**
 * Relative improvement in macro log loss required per additional parameter.
 *
 * This prices complexity instead of banning it. Isotonic wants 25+ knots to
 * beat one-parameter temperature by a rounding error, and is correctly
 * rejected. Splitting one temperature into two, one per distribution family,
 * costs a single parameter and fixes a family the pooled fit was actively
 * harming, so it clears the bar.
 */
const PARSIMONY_PER_PARAM = 0.002;

/**
 * Fit candidates on TRAIN, pick the winner on VAL, never look at TEST.
 */
function selectCalibrator(trainRows, valRows, opts = {}) {
  const zSupport = opts.zSupport ?? zSupportFrom(trainRows);
  const candidates = [{ ...IDENTITY }];
  const temp = fitTemperature(trainRows, { zSupport });
  if (temp) candidates.push(temp);
  const byDist = fitTemperatureByDist(trainRows, { zSupport });
  if (byDist?.byDist) candidates.push(byDist);
  const iso = fitIsotonic(trainRows);
  if (iso) candidates.push({ ...iso, zSupport });

  const scored = candidates.map((cal) => {
    const finished = {
      ...cal,
      zSupport: cal.method === "identity" ? null : zSupport,
      zFade: cal.method === "identity" ? null : opts.zFade ?? DEFAULT_Z_FADE,
      maxProbability: opts.catastropheCap ?? CATASTROPHE_CAP,
    };
    return {
      calibrator: finished,
      train: scoreCalibrator(finished, trainRows),
      val: scoreCalibrator(finished, valRows),
    };
  });

  // Rank on macro-averaged validation log loss; it punishes confident misses
  // harder than Brier, which is exactly the failure mode being corrected, and
  // the macro average keeps a large family from masking a small one.
  const metric = (entry) => entry.val?.macroLogLoss ?? entry.val?.logLoss ?? Infinity;
  const ranked = [...scored].sort((a, b) => {
    const d = metric(a) - metric(b);
    if (d !== 0) return d;
    return paramCount(a.calibrator) - paramCount(b.calibrator);
  });

  // Walk up from the simplest candidate, paying for each extra parameter.
  const bySimplicity = [...scored].sort(
    (a, b) => paramCount(a.calibrator) - paramCount(b.calibrator)
  );
  let chosen = bySimplicity[0];
  const ledger = [];
  for (const entry of bySimplicity.slice(1)) {
    const incumbent = metric(chosen);
    const challenger = metric(entry);
    const extraParams = Math.max(1, paramCount(entry.calibrator) - paramCount(chosen.calibrator));
    const required = PARSIMONY_PER_PARAM * extraParams;
    const relative = Number.isFinite(incumbent)
      ? (incumbent - challenger) / Math.abs(incumbent)
      : Infinity;
    const accepted = relative >= required;
    ledger.push({
      candidate: describe(entry.calibrator),
      extraParams,
      required: Number(required.toFixed(5)),
      improvement: Number.isFinite(relative) ? Number(relative.toFixed(5)) : null,
      accepted,
    });
    if (accepted) chosen = entry;
  }

  return {
    best: chosen?.calibrator || { ...IDENTITY },
    candidates: scored,
    ranked,
    parsimony: {
      perParam: PARSIMONY_PER_PARAM,
      selected: describe(chosen?.calibrator),
      bestRaw: describe(ranked[0]?.calibrator),
      ledger,
    },
  };
}

function describe(cal) {
  if (!cal) return "none";
  if (cal.method === "identity") return "identity";
  if (cal.method === "isotonic") return `isotonic(${(cal.knots || []).length} knots)`;
  if (cal.byDist) {
    return `temperature by dist(${Object.entries(cal.byDist)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")})`;
  }
  return `temperature(T=${cal.temperature})`;
}

/* ------------------------------ *
 * Frozen artifact load at serve  *
 * ------------------------------ */

let cached;
let cachedMeta;

function loadArtifact() {
  try {
    // eslint-disable-next-line global-require
    return require("./baselines/calibrator.json");
  } catch {
    return null;
  }
}

function loadCalibrator() {
  if (cached !== undefined) return cached;
  const frozen = loadArtifact();
  cached = frozen && frozen.calibrator ? frozen.calibrator : { ...IDENTITY };
  return cached;
}

/**
 * Provenance of the installed calibrator. `dataSource` is "real" once the map
 * has been refit against graded outcomes, which is what downstream model-risk
 * discounts key off.
 */
function loadCalibratorMeta() {
  if (cachedMeta !== undefined) return cachedMeta;
  const frozen = loadArtifact();
  cachedMeta = {
    dataSource: frozen?.dataSource || "none",
    generatedAt: frozen?.generatedAt || null,
    modelVersion: frozen?.modelVersion || null,
    method: frozen?.calibrator?.method || "identity",
    maxProbability: frozen?.calibrator?.maxProbability ?? 0.995,
  };
  return cachedMeta;
}

function resetCalibratorCache() {
  cached = undefined;
  cachedMeta = undefined;
}

module.exports = {
  logit,
  sigmoid,
  applyTemperature,
  fitTemperature,
  fitTemperatureByDist,
  temperatureFor,
  paramCount,
  describe,
  fitIsotonic,
  interpolate,
  pav,
  symmetrize,
  applyCalibrator,
  scoreCalibrator,
  calibrationWeight,
  zSupportFrom,
  selectCalibrator,
  CATASTROPHE_CAP,
  DEFAULT_Z_FADE,
  loadCalibrator,
  loadCalibratorMeta,
  resetCalibratorCache,
  IDENTITY,
};
