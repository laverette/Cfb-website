const { clamp } = require("./math");
const { jointAllHit, formatTogetherPct, formatAmerican } = require("./joint");
const { loadCalibratorMeta } = require("./calibration");

const POWER_MULTIPLIER = {
  2: 3,
  3: 5,
  4: 10,
  5: 20,
  6: 40,
};

function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}

function decimalToAmerican(decimal) {
  const d = Number(decimal);
  if (!Number.isFinite(d) || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}

function fromMultiplier(m, source) {
  const decimal = Number(m);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  const american = decimalToAmerican(decimal);
  return {
    decimal: Number(decimal.toFixed(4)),
    multiplier: Number(decimal.toFixed(4)),
    american,
    americanLabel: formatAmerican(american),
    source,
    label: Number.isInteger(decimal) ? `${decimal}x` : `${decimal.toFixed(2)}x`,
  };
}

function fromAmerican(american, source) {
  const decimal = americanToDecimal(american);
  if (decimal == null) return null;
  return {
    decimal: Number(decimal.toFixed(4)),
    multiplier: Number(decimal.toFixed(4)),
    american: Math.round(Number(american)),
    americanLabel: formatAmerican(Math.round(Number(american))),
    source,
    label: formatAmerican(Math.round(Number(american))),
  };
}

function defaultPayout(nLegs) {
  const n = Math.max(1, Number(nLegs) || 1);
  if (n <= 1) {
    return {
      ...fromAmerican(-110, "default_single"),
      label: "-110 (default single)",
    };
  }
  const m = POWER_MULTIPLIER[n];
  if (m) {
    return {
      ...fromMultiplier(m, "prizepicks_power"),
      label: `PrizePicks ${n}-pick Power (${m}x)`,
    };
  }
  return {
    ...fromMultiplier(10, "fallback_10x"),
    label: "10x (enter the real payout)",
  };
}

function parsePayout(raw, nLegs) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!s) return defaultPayout(nLegs);
  if (s.endsWith("x")) {
    const parsed = fromMultiplier(Number(s.slice(0, -1)), "entered");
    if (parsed) return parsed;
  }
  if (/^[+-]\d+$/.test(s)) {
    const parsed = fromAmerican(Number(s), "entered");
    if (parsed) return parsed;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n >= 2 && n <= 200 && Math.abs(n - Math.round(n)) < 1e-9) {
    return fromMultiplier(Math.round(n), "entered");
  }
  if (Number.isFinite(n) && n > 1 && n < 200) {
    const american = decimalToAmerican(n);
    return {
      decimal: Number(n.toFixed(4)),
      multiplier: Number(n.toFixed(4)),
      american,
      americanLabel: formatAmerican(american),
      source: "entered",
      label: `${n.toFixed(2)} decimal`,
    };
  }
  return defaultPayout(nLegs);
}

/**
 * Legs arrive already calibrated and capped at the support ceiling, so the old
 * confidence-letter haircut is gone: the frozen backtest shows grade does not
 * predict hit rate (A hit 46.8%, D hit 56.4% on TEST), so keying a probability
 * adjustment off it was adjusting in the right direction for the wrong reason.
 *
 * What survives is an input-quality adjustment. An unusual line means the
 * projection sits somewhere the model rarely operates, which is a statement
 * about the inputs rather than about confidence.
 */
function conservativePHit(leg) {
  const p = Number(leg?.pHit);
  if (!Number.isFinite(p)) return 0.5;
  let out = clamp(p, 0.01, 0.99);
  if ((leg.flags || []).includes("Unusual Line")) {
    out = 0.5 + (out - 0.5) * UNUSUAL_LINE_SHRINK;
  }
  return clamp(out, 0.01, 0.99);
}

const UNUSUAL_LINE_SHRINK = 0.75;

/**
 * The calibrator is currently fit against a synthetic data generator. That
 * corrects the shape of the probability curve but cannot prove the model works
 * on real football, so entry-level expected value carries an explicit discount
 * until the map is refit on graded outcomes (npm run grade:props, then
 * npm run calibrate:props -- --real). At that point this returns 1 and the
 * discount disappears on its own rather than lingering as a magic number.
 */
function modelRiskDiscount() {
  const meta = loadCalibratorMeta();
  if (meta.dataSource === "real") return 1;
  return 0.9;
}

function entryValue({ legs, pairs, together, risk, payout }) {
  const ok = (legs || []).filter((l) => l && !l.error && Number.isFinite(Number(l.pHit)));
  if (!ok.length) return null;
  const price = parsePayout(payout, ok.length);
  const conservative = ok.map((l) => ({ ...l, pHit: conservativePHit(l) }));
  const conservativeTogether = jointAllHit(conservative, pairs) || together;
  const pRaw = together?.p ?? null;
  const discount = modelRiskDiscount();
  const pAdjusted = conservativeTogether?.p ?? pRaw;
  const pUse = Number.isFinite(pAdjusted) ? pAdjusted * discount : pAdjusted;
  if (!Number.isFinite(pUse) || !price?.decimal) return null;

  const breakeven = 1 / price.decimal;
  const ev = pUse * price.decimal - 1;
  const edge = pUse - breakeven;
  const highRisk = risk === "High" || risk === "Very High";
  const playEv = highRisk ? 0.16 : 0.1;
  const leanEv = highRisk ? 0.06 : 0.03;

  let verdict = "pass";
  let verdictLabel = "Pass";
  if (ev >= playEv && edge >= 0.025) {
    verdict = "play";
    verdictLabel = "Play";
  } else if (ev >= leanEv && edge >= 0.008) {
    verdict = "lean";
    verdictLabel = "Lean play";
  }

  const reasons = [];
  reasons.push(
    `Model all-hit ${formatTogetherPct(pRaw)} vs ${formatTogetherPct(breakeven)} needed at ${price.label}.`
  );
  if (Math.abs((pUse || 0) - (pRaw || 0)) > 0.015) {
    reasons.push(
      discount < 1
        ? `After unusual-line and model-risk adjustments: ${formatTogetherPct(pUse)} all-hit. The calibrator has not yet been refit on graded outcomes.`
        : `After unusual-line adjustment: ${formatTogetherPct(pUse)} all-hit.`
    );
  }
  const evCents = Math.round(ev * 100);
  reasons.push(
    ev >= 0
      ? `Expected value about ${evCents >= 0 ? "+" : ""}${evCents}¢ per $1 staked.`
      : `Expected value about ${evCents}¢ per $1 staked — the payout does not cover the modeled miss rate.`
  );
  if (highRisk) reasons.push("Risk is elevated, so the bar to Play is higher.");
  if (ok.some((l) => (l.flags || []).includes("Unusual Line"))) {
    reasons.push("At least one unusual line was not taken at face value.");
  }

  return {
    verdict,
    verdictLabel,
    modelRiskDiscount: discount,
    calibration: loadCalibratorMeta(),
    pRaw: pRaw == null ? null : Number(pRaw.toFixed(4)),
    pUse: Number(pUse.toFixed(4)),
    breakeven: Number(breakeven.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    ev: Number(ev.toFixed(4)),
    evLabel: `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(0)}¢ / $1`,
    payout: price,
    neededLabel: formatTogetherPct(breakeven),
    modelLabel: formatTogetherPct(pUse),
    summary: `${verdictLabel} · ${formatTogetherPct(pUse)} vs ${formatTogetherPct(breakeven)} needed`,
    reasons,
    tooltip:
      "Compares the calibrated chance every listed leg hits with the payout you entered (or PrizePicks Power defaults). Probabilities are capped at the range the backtest can support. Educational lean only — not betting advice.",
  };
}

module.exports = {
  parsePayout,
  defaultPayout,
  americanToDecimal,
  decimalToAmerican,
  conservativePHit,
  modelRiskDiscount,
  entryValue,
  POWER_MULTIPLIER,
  UNUSUAL_LINE_SHRINK,
};
