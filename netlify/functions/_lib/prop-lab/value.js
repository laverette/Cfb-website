const { clamp } = require("./math");
const { confidenceModifier } = require("./score");
const { jointAllHit, formatTogetherPct, formatAmerican } = require("./joint");

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

function conservativePHit(leg) {
  let p = clamp(Number(leg?.pHit), 0.01, 0.99);
  if (!Number.isFinite(p)) return 0.5;
  const cap =
    {
      A: 0.94,
      "A-": 0.93,
      "B+": 0.92,
      B: 0.9,
      "B-": 0.88,
      "C+": 0.86,
      C: 0.84,
      D: 0.8,
    }[leg.confidence] || 0.88;
  p = Math.min(p, cap);
  if ((leg.flags || []).includes("Unusual Line")) p = Math.min(p, 0.76);
  p = 0.5 + (p - 0.5) * confidenceModifier(leg.confidence);
  return clamp(p, 0.01, 0.99);
}

function entryValue({ legs, pairs, together, risk, payout }) {
  const ok = (legs || []).filter((l) => l && !l.error && Number.isFinite(Number(l.pHit)));
  if (!ok.length) return null;
  const price = parsePayout(payout, ok.length);
  const conservative = ok.map((l) => ({ ...l, pHit: conservativePHit(l) }));
  const conservativeTogether = jointAllHit(conservative, pairs) || together;
  const pRaw = together?.p ?? null;
  const pUse = conservativeTogether?.p ?? pRaw;
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
      `After confidence / unusual-line haircut: ${formatTogetherPct(pUse)} all-hit.`
    );
  }
  const evCents = Math.round(ev * 100);
  reasons.push(
    ev >= 0
      ? `Expected value about ${evCents >= 0 ? "+" : ""}${evCents}¢ per $1 staked.`
      : `Expected value about ${evCents}¢ per $1 staked — the payout does not cover the modeled miss rate.`
  );
  if (highRisk) reasons.push("Risk is elevated, so the bar to Play is higher.");
  if (ok.some((l) => (l.flags || []).includes("Unusual Line") || (l.pHit || 0) >= 0.95)) {
    reasons.push("At least one near-lock or unusual line was not taken at face value.");
  }

  return {
    verdict,
    verdictLabel,
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
      "Compares the modeled chance every listed leg hits with the payout you entered (or PrizePicks Power defaults). Low model confidence and unusual lines are haircut before the call. Educational lean only — not betting advice.",
  };
}

module.exports = {
  parsePayout,
  defaultPayout,
  americanToDecimal,
  decimalToAmerican,
  conservativePHit,
  entryValue,
  POWER_MULTIPLIER,
};
