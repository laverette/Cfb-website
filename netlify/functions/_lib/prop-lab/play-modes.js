const { clamp } = require("./math");
const { formatTogetherPct } = require("./joint");

/**
 * PrizePicks-style Flex multipliers (return including stake).
 * Power multipliers live in value.js POWER_MULTIPLIER.
 *
 * Flex is the "protected" path: you can miss one (or two on 5–6 picks)
 * and still get paid something.
 */
const FLEX_MULTIPLIER = {
  3: { perfect: 2.25, miss1: 1.25 },
  4: { perfect: 5, miss1: 1.5 },
  5: { perfect: 10, miss1: 2, miss2: 0.4 },
  6: { perfect: 25, miss1: 2, miss2: 0.4 },
};

const POWER_MULTIPLIER = {
  2: 3,
  3: 5,
  4: 10,
  5: 20,
  6: 40,
};

function evLabel(ev) {
  if (!Number.isFinite(ev)) return "—";
  const cents = Math.round(ev * 100);
  return `${cents >= 0 ? "+" : ""}${cents}¢ / $1`;
}

/**
 * Poisson-binomial: P(exactly k hits) for independent unequal probs.
 */
function hitCountProbs(ps) {
  let dp = [1];
  for (const raw of ps || []) {
    const p = clamp(Number(raw), 0.01, 0.99);
    const next = Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k += 1) {
      next[k] += dp[k] * (1 - p);
      next[k + 1] += dp[k] * p;
    }
    dp = next;
  }
  return dp;
}

/**
 * Replace independent P(all hit) with the correlated joint when available,
 * then rescale the lower bins so probabilities still sum to 1.
 */
function blendAllHit(hitProbs, pAllJoint) {
  const n = hitProbs.length - 1;
  if (n < 1 || !Number.isFinite(pAllJoint)) return hitProbs.slice();
  const out = hitProbs.slice();
  const indepAll = out[n];
  const target = clamp(pAllJoint, 0.001, 0.999);
  if (Math.abs(target - indepAll) < 1e-6) return out;
  out[n] = target;
  const rest = out.slice(0, n).reduce((s, x) => s + x, 0);
  const need = Math.max(0, 1 - target);
  if (rest > 1e-9) {
    const scale = need / rest;
    for (let k = 0; k < n; k += 1) out[k] *= scale;
  }
  return out;
}

function powerMode(n, pAll) {
  const m = POWER_MULTIPLIER[n];
  if (!m || !Number.isFinite(pAll)) return null;
  const ev = pAll * m - 1;
  return {
    id: "power",
    label: "Power",
    shortLabel: "Power",
    blurb: "All legs must hit. Highest payout, no miss protection.",
    n,
    multiplier: m,
    multiplierLabel: `${m}x`,
    pCash: Number(pAll.toFixed(4)),
    pCashLabel: formatTogetherPct(pAll),
    payouts: [{ hits: n, multiplier: m, p: pAll, label: `${n}/${n} → ${m}x` }],
    ev: Number(ev.toFixed(4)),
    evLabel: evLabel(ev),
  };
}

function flexMode(n, hitProbs) {
  const table = FLEX_MULTIPLIER[n];
  if (!table || !hitProbs || hitProbs.length < n + 1) return null;

  const payouts = [];
  let expectedReturn = 0;
  const add = (hits, mult) => {
    if (!Number.isFinite(mult) || mult <= 0) return;
    const p = hitProbs[hits] || 0;
    expectedReturn += p * mult;
    payouts.push({
      hits,
      multiplier: mult,
      p: Number(p.toFixed(4)),
      label: `${hits}/${n} → ${Number.isInteger(mult) ? mult : mult}x`,
    });
  };

  add(n, table.perfect);
  if (table.miss1 != null) add(n - 1, table.miss1);
  if (table.miss2 != null && n >= 5) add(n - 2, table.miss2);

  const pCash = payouts.reduce((s, row) => s + row.p, 0);
  const ev = expectedReturn - 1;
  return {
    id: "flex",
    label: "Flex (protected)",
    shortLabel: "Flex",
    blurb: "Protected play — miss one (or two on 5–6 picks) and you can still cash a smaller multiplier.",
    n,
    multiplier: table.perfect,
    multiplierLabel: `${table.perfect}x perfect`,
    pCash: Number(pCash.toFixed(4)),
    pCashLabel: formatTogetherPct(pCash),
    payouts,
    ev: Number(ev.toFixed(4)),
    evLabel: evLabel(ev),
  };
}

/**
 * Compare PrizePicks Power vs Flex (protected) for an entry.
 * @param {object} args
 * @param {number[]} args.probs per-leg hit probs (prefer conservative)
 * @param {number|null} args.pAll correlated all-hit probability when known
 * @param {string} [args.risk] entry risk label
 */
function comparePlayModes({ probs, pAll, risk } = {}) {
  const ps = (probs || []).map((p) => clamp(Number(p), 0.01, 0.99)).filter(Number.isFinite);
  const n = ps.length;
  if (n < 2) {
    return {
      available: false,
      reason: "Need at least 2 legs to compare Power vs Flex.",
      recommend: null,
      power: null,
      flex: null,
    };
  }

  const indep = hitCountProbs(ps);
  const blended = blendAllHit(indep, Number.isFinite(pAll) ? pAll : indep[n]);
  const pAllUse = blended[n];
  const power = powerMode(n, pAllUse);
  const flex = flexMode(n, blended);

  if (!power && !flex) {
    return {
      available: false,
      reason: n > 6 ? "Default Flex/Power tables cover 2–6 picks — enter payout odds manually." : "No Power/Flex table for this size.",
      recommend: null,
      power,
      flex,
    };
  }

  if (!flex) {
    return {
      available: true,
      recommend: "power",
      recommendLabel: "Power",
      reason: "Flex (protected) starts at 3 picks. This card is Power-only.",
      power,
      flex: null,
      hitProbs: blended.map((p) => Number(p.toFixed(4))),
    };
  }

  const highRisk = risk === "High" || risk === "Very High";
  const gap = (flex.ev || 0) - (power.ev || 0);
  let recommend = "power";
  let recommendLabel = "Power";
  let reason = "";

  if (gap > 0.02) {
    recommend = "flex";
    recommendLabel = "Flex (protected)";
    reason = `Flex EV (${flex.evLabel}) beats Power (${power.evLabel}) — protection is worth more than the Power multiplier here.`;
  } else if (gap < -0.02) {
    recommend = "power";
    recommendLabel = "Power";
    reason = `Power EV (${power.evLabel}) beats Flex (${flex.evLabel}) — all-hit payout is worth the extra risk.`;
  } else if (highRisk) {
    recommend = "flex";
    recommendLabel = "Flex (protected)";
    reason = `EVs are close, but risk is ${risk} — prefer Flex so one miss does not wipe the card.`;
  } else {
    recommend = "power";
    recommendLabel = "Power";
    reason = `EVs are close (${power.evLabel} Power vs ${flex.evLabel} Flex). Power is fine if you trust the board; Flex if you want a safety net.`;
  }

  return {
    available: true,
    recommend,
    recommendLabel,
    reason,
    power,
    flex,
    hitProbs: blended.map((p) => Number(p.toFixed(4))),
    tooltip:
      "Compares PrizePicks Power (all must hit) vs Flex / protected (can miss and still cash). Uses modeled hit probabilities. Confirm live multipliers in the app — tables can change.",
  };
}

module.exports = {
  FLEX_MULTIPLIER,
  POWER_MULTIPLIER,
  hitCountProbs,
  blendAllHit,
  comparePlayModes,
  powerMode,
  flexMode,
};
