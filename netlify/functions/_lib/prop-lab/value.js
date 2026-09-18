const { clamp } = require("./math");
const { jointAllHit, formatTogetherPct, formatAmerican, toAmerican } = require("./joint");
const { loadCalibratorMeta } = require("./calibration");
const { comparePlayModes } = require("./play-modes");

const POWER_MULTIPLIER = {
  2: 3,
  3: 5,
  4: 10,
  5: 20,
  6: 40,
};

/** Entry risk label → how much of the card is "at risk" (0–100). */
const RISK_PERCENT = {
  Low: 18,
  Moderate: 42,
  High: 68,
  "Very High": 88,
};

const UNUSUAL_LINE_SHRINK = 0.75;

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

function confRank(letter) {
  return { A: 8, "A-": 7, "B+": 6, B: 5, "B-": 4, "C+": 3, C: 2, D: 1 }[letter] || 3;
}

/**
 * Per-leg haircut before the joint. Unusual / thin / volatile legs are not
 * taken at face value. Confidence letter is only a soft safety signal here —
 * the frozen backtest showed grade alone does not predict hit rate.
 */
function conservativePHit(leg) {
  const p = Number(leg?.pHit);
  if (!Number.isFinite(p)) return 0.5;
  let out = clamp(p, 0.01, 0.99);
  const flags = leg.flags || [];

  if (flags.includes("Unusual Line")) {
    out = 0.5 + (out - 0.5) * UNUSUAL_LINE_SHRINK;
  }

  // Mild edge shrink only — never multiply the whole probability by a harsh
  // trust factor (that turned a 61% single into an 18% "pass rate").
  let edgeKeep = 1;
  if (flags.includes("High Variance")) edgeKeep *= 0.88;
  if (flags.includes("Small Sample")) edgeKeep *= 0.94;
  if (flags.includes("FCS-Heavy Sample")) edgeKeep *= 0.92;
  if (/td/i.test(leg.stat?.id || "")) edgeKeep *= 0.93;

  const score = Number(leg.propScore);
  if (Number.isFinite(score) && score < 50) {
    edgeKeep *= clamp(0.88 + (score / 50) * 0.12, 0.88, 1);
  }

  const conf = confRank(leg.confidence);
  if (conf <= 1) edgeKeep *= 0.94; // D only
  else if (conf >= 6) edgeKeep = Math.min(1, edgeKeep * 1.02);

  out = 0.5 + (out - 0.5) * edgeKeep;
  return clamp(out, 0.01, 0.99);
}

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

function riskPercent(risk) {
  return RISK_PERCENT[risk] ?? RISK_PERCENT.Moderate;
}

/**
 * How safe the card looks overall (0–100). Higher = more trustworthy inputs.
 * Used for labeling and a mild edge shrink — not to rewrite the pass rate.
 */
function safetyPercent({
  risk,
  entryStrength,
  riskDrivers,
  avgConf,
  weakestScore,
} = {}) {
  let s = 52;
  const riskBump = { Low: 24, Moderate: 4, High: -18, "Very High": -30 };
  s += riskBump[risk] ?? 0;
  s += clamp(((Number(entryStrength) || 50) - 55) * 0.55, -18, 22);
  s -= Math.min(18, (riskDrivers?.length || 0) * 4);
  s += clamp(((Number(avgConf) || 3) - 3) * 4.5, -12, 14);
  s += clamp(((Number(weakestScore) || 50) - 55) * 0.4, -14, 12);
  return clamp(Math.round(s), 8, 94);
}

/**
 * Realistic pass / all-hit rate.
 *
 * Risk % and safety label the card and mildly shrink the *edge* away from 50%.
 * They must not multiply the whole probability (a 61% single at High risk was
 * being crushed to ~18% and flipping clear +EV plays into Pass).
 */
function realisticPassRate(
  pModel,
  {
    risk,
    entryStrength,
    riskDrivers,
    avgConf,
    weakestScore,
    modelDiscount,
    nLegs = 1,
  } = {}
) {
  const p = clamp(Number(pModel), 0.001, 0.999);
  if (!Number.isFinite(Number(pModel))) return null;

  const riskPct = riskPercent(risk) / 100;
  const safetyPct =
    safetyPercent({
      risk,
      entryStrength,
      riskDrivers,
      avgConf,
      weakestScore,
    }) / 100;
  const discount = Number.isFinite(modelDiscount) ? modelDiscount : modelRiskDiscount();
  const legs = Math.max(1, Number(nLegs) || 1);

  // Narrow band: keep ~86–99% of the edge. Singles stay near the model.
  const edgeKeep = clamp(0.96 - riskPct * 0.1 + safetyPct * 0.06, 0.86, 0.995);
  let out = 0.5 + (p - 0.5) * edgeKeep;

  // Synthetic-calibrator discount: gentle on singles, full on multi-leg cards.
  const disc =
    legs <= 1 ? Math.max(discount, 0.97) : legs === 2 ? Math.max(discount, 0.93) : discount;
  out *= disc;

  return {
    p: clamp(out, 0.001, 0.97),
    pModel: p,
    trust: Number(edgeKeep.toFixed(4)),
    riskPercent: Math.round(riskPct * 100),
    safetyPercent: Math.round(safetyPct * 100),
    modelDiscount: disc,
  };
}

function decorateTogetherPassRate(together, pass) {
  if (!together || !pass || !Number.isFinite(pass.p)) return together;
  const american = toAmerican(pass.p);
  const pctLabel = formatTogetherPct(pass.p);
  const americanLabel = formatAmerican(american);
  return {
    ...together,
    pModel: pass.pModel,
    pPass: Number(pass.p.toFixed(4)),
    // Keep mathematical joint on `.p` / `.american` for correlation math & tests.
    americanModel: together.american,
    americanLabelModel: together.americanLabel,
    pctLabelModel: together.pctLabel,
    pctLabel,
    americanPass: american,
    americanLabelPass: americanLabel,
    // Display fields (UI reads these) reflect the realistic pass rate.
    label: americanLabel ? `${pctLabel} (${americanLabel})` : pctLabel,
    riskPercent: pass.riskPercent,
    safetyPercent: pass.safetyPercent,
    trust: pass.trust,
    tooltip:
      `Pass rate stays near the calibrated all-hit chance. Risk (${pass.riskPercent}%) and safety (${pass.safetyPercent}%) only nudge the edge. ` +
      `Model joint: ${formatTogetherPct(pass.pModel)}. Educational estimate only — not a sportsbook price.`,
  };
}

function entryValue({
  legs,
  pairs,
  together,
  risk,
  payout,
  entryStrength,
  riskDrivers,
  avgConf,
  weakestScore,
}) {
  const ok = (legs || []).filter((l) => l && !l.error && Number.isFinite(Number(l.pHit)));
  if (!ok.length) return null;
  const price = parsePayout(payout, ok.length);
  const conservative = ok.map((l) => ({ ...l, pHit: conservativePHit(l) }));
  const conservativeTogether = jointAllHit(conservative, pairs) || together;
  const pRaw = together?.pModel ?? together?.p ?? null;
  const discount = modelRiskDiscount();
  const pass = realisticPassRate(conservativeTogether?.p ?? pRaw, {
    risk,
    entryStrength,
    riskDrivers,
    avgConf,
    weakestScore,
    modelDiscount: discount,
    nLegs: ok.length,
  });
  const pUse = pass?.p ?? null;
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
  if (pass && Math.abs(pUse - (pRaw || 0)) > 0.015) {
    reasons.push(
      `Pass rate ${formatTogetherPct(pUse)} after a mild risk/safety edge shrink` +
        (pass.modelDiscount < 1 ? " and model-risk discount." : ".")
    );
  }
  const evCents = Math.round(ev * 100);
  reasons.push(
    ev >= 0
      ? `Expected value about ${evCents >= 0 ? "+" : ""}${evCents}¢ per $1 staked.`
      : `Expected value about ${evCents}¢ per $1 staked — the payout does not cover the modeled miss rate.`
  );
  if (highRisk) reasons.push("Risk is elevated, so the bar to Play is higher.");
  if (pass?.safetyPercent <= 35) {
    reasons.push("Bet safety is low — treat the lean cautiously.");
  } else if (pass?.safetyPercent >= 70 && risk === "Low") {
    reasons.push("Clean, low-risk card — pass rate stays close to the model.");
  }
  if (ok.some((l) => (l.flags || []).includes("Unusual Line"))) {
    reasons.push("At least one unusual line was not taken at face value.");
  }

  const playModes = comparePlayModes({
    probs: conservative.map((l) => l.pHit),
    pAll: pUse,
    risk,
  });
  if (playModes?.available && playModes.recommendLabel) {
    reasons.push(`Play type: prefer ${playModes.recommendLabel}. ${playModes.reason || ""}`.trim());
  }

  return {
    verdict,
    verdictLabel,
    modelRiskDiscount: pass?.modelDiscount ?? discount,
    calibration: loadCalibratorMeta(),
    pRaw: pRaw == null ? null : Number(Number(pRaw).toFixed(4)),
    pUse: Number(pUse.toFixed(4)),
    riskPercent: pass?.riskPercent ?? riskPercent(risk),
    safetyPercent: pass?.safetyPercent ?? null,
    trust: pass?.trust ?? null,
    breakeven: Number(breakeven.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    ev: Number(ev.toFixed(4)),
    evLabel: `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(0)}¢ / $1`,
    payout: price,
    neededLabel: formatTogetherPct(breakeven),
    modelLabel: formatTogetherPct(pUse),
    summary: `${verdictLabel} · ${formatTogetherPct(pUse)} pass vs ${formatTogetherPct(breakeven)} needed`,
    playModes,
    reasons,
    tooltip:
      "Compares the calibrated pass rate with the payout you entered (or PrizePicks Power defaults). Also scores Power vs Flex (protected). Educational lean only — not betting advice.",
  };
}

module.exports = {
  parsePayout,
  defaultPayout,
  americanToDecimal,
  decimalToAmerican,
  conservativePHit,
  modelRiskDiscount,
  riskPercent,
  safetyPercent,
  realisticPassRate,
  decorateTogetherPassRate,
  entryValue,
  POWER_MULTIPLIER,
  UNUSUAL_LINE_SHRINK,
  RISK_PERCENT,
  comparePlayModes,
};
