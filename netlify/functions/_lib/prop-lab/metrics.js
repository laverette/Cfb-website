const { mean, median, clamp } = require("./math");

const CALIBRATION_BANDS = [
  [0.5, 0.55, "50–54%"],
  [0.55, 0.6, "55–59%"],
  [0.6, 0.65, "60–64%"],
  [0.65, 0.7, "65–69%"],
  [0.7, 0.8, "70–79%"],
  [0.8, 0.9, "80–89%"],
  [0.9, 1.0001, "90%+"],
];

const BACKTEST_STAT_IDS = [
  "pass_yds",
  "pass_comp",
  "pass_att",
  "pass_td",
  "pass_int",
  "rush_yds",
  "rush_att",
  "rush_td",
  "rec",
  "rec_yds",
  "rec_td",
];

function finite(xs, key) {
  return (xs || []).map((r) => (key ? r[key] : r)).filter((n) => Number.isFinite(n));
}

function mae(rows) {
  const e = finite(rows, "absError");
  return e.length ? mean(e) : null;
}

function medae(rows) {
  const e = finite(rows, "absError");
  return e.length ? median(e) : null;
}

function rmse(rows) {
  const e = finite(rows, "error");
  if (!e.length) return null;
  return Math.sqrt(e.reduce((s, n) => s + n * n, 0) / e.length);
}

function bias(rows) {
  const e = finite(rows, "error");
  return e.length ? mean(e) : null;
}

function brier(rows) {
  const graded = (rows || []).filter((r) => r.hit != null && Number.isFinite(r.pHit));
  if (!graded.length) return null;
  return graded.reduce((s, r) => s + (r.pHit - (r.hit ? 1 : 0)) ** 2, 0) / graded.length;
}

function hitRate(rows) {
  const graded = (rows || []).filter((r) => r.hit != null);
  if (!graded.length) return null;
  return graded.filter((r) => r.hit).length / graded.length;
}

function meanP(rows) {
  const xs = finite(rows, "pHit");
  return xs.length ? mean(xs) : null;
}

function calibrationTable(rows) {
  return CALIBRATION_BANDS.map(([lo, hi, label]) => {
    const slice = (rows || []).filter(
      (r) => r.hit != null && Number.isFinite(r.pHit) && r.pHit >= lo && r.pHit < hi
    );
    const predicted = slice.length ? mean(slice.map((r) => r.pHit)) : null;
    const actual = slice.length ? slice.filter((r) => r.hit).length / slice.length : null;
    return {
      band: label,
      n: slice.length,
      predicted,
      actual,
      gap: predicted != null && actual != null ? predicted - actual : null,
      overconfident: predicted != null && actual != null ? predicted - actual > 0.03 : null,
    };
  });
}

function ece(rows) {
  const table = calibrationTable(rows);
  const n = (rows || []).filter((r) => r.hit != null && Number.isFinite(r.pHit)).length;
  if (!n) return null;
  let s = 0;
  for (const b of table) {
    if (!b.n || b.gap == null) continue;
    s += (b.n / n) * Math.abs(b.gap);
  }
  return s;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows || []) {
    const k = keyFn(r);
    if (k == null || k === "") continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function summarize(rows, extra = {}) {
  const list = rows || [];
  const graded = list.filter((r) => r.hit != null);
  return {
    n: list.length,
    nGraded: graded.length,
    mae: mae(list),
    medae: medae(list),
    rmse: rmse(list),
    bias: bias(list),
    hitRate: hitRate(list),
    predictedProbability: meanP(list),
    brier: brier(list),
    calibrationError: ece(list),
    ...extra,
  };
}

function sliceSummaries(rows, keyFn) {
  const out = {};
  for (const [k, list] of groupBy(rows, keyFn)) {
    out[k] = summarize(list, { key: k });
  }
  return out;
}

function propScoreBand(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 55) return "<55 Pass";
  if (s < 65) return "55–64 Slight Lean";
  if (s < 80) return "65–79 Lean";
  return "80+ Strong";
}

function sampleBucket(games) {
  const n = Number(games) || 0;
  if (n <= 2) return "1–2";
  if (n <= 4) return "3–4";
  if (n <= 7) return "5–7";
  return "8+";
}

function spreadBucket(spread) {
  const s = Number(spread);
  if (!Number.isFinite(s)) return "unknown";
  if (s <= -14) return "Fav 14+";
  if (s <= -7) return "Fav 7–13";
  if (s < 7) return "Toss-up";
  if (s < 14) return "Dog 7–13";
  return "Dog 14+";
}

function roundMetrics(obj, digits = 4) {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => roundMetrics(x, digits));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Number(v.toFixed(digits));
    } else if (v && typeof v === "object") {
      out[k] = roundMetrics(v, digits);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function reportFromRows(rows) {
  const list = (rows || []).map((r) => ({
    ...r,
    absError: Number.isFinite(r.error) ? Math.abs(r.error) : null,
  }));
  return roundMetrics({
    overall: summarize(list),
    byStat: sliceSummaries(list, (r) => r.statId),
    byConfidence: sliceSummaries(list, (r) => r.confidence || "NA"),
    byPropScore: sliceSummaries(list, (r) => propScoreBand(r.propScore)),
    bySample: sliceSummaries(list, (r) => sampleBucket(r.sampleGames)),
    bySpread: sliceSummaries(list, (r) => spreadBucket(r.spread)),
    byRole: sliceSummaries(list, (r) => r.role || "Unknown"),
    calibration: calibrationTable(list),
  });
}

module.exports = {
  CALIBRATION_BANDS,
  BACKTEST_STAT_IDS,
  mae,
  medae,
  rmse,
  bias,
  brier,
  hitRate,
  meanP,
  ece,
  calibrationTable,
  summarize,
  reportFromRows,
  propScoreBand,
  sampleBucket,
  spreadBucket,
  roundMetrics,
  clamp,
};
