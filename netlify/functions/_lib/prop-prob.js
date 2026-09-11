/**
 * Convert model projection + sportsbook price into hit probabilities / edge.
 */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** American odds → implied win probability (no vig removal). */
function impliedProbAmerican(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 100 / (a + 100);
  return Math.abs(a) / (Math.abs(a) + 100);
}

/** Remove two-way vig when both sides present. */
function deVigPair(pOverRaw, pUnderRaw) {
  if (pOverRaw == null || pUnderRaw == null) {
    return { pOver: pOverRaw, pUnder: pUnderRaw, vig: null };
  }
  const sum = pOverRaw + pUnderRaw;
  if (!(sum > 0)) return { pOver: pOverRaw, pUnder: pUnderRaw, vig: null };
  return {
    pOver: pOverRaw / sum,
    pUnder: pUnderRaw / sum,
    vig: sum - 1,
  };
}

const STAT_SCALE = {
  pass_yds: 48,
  pass_td: 0.9,
  pass_comp: 3.8,
  pass_att: 4.5,
  pass_int: 0.55,
  rush_yds: 30,
  rush_td: 0.55,
  rush_att: 3.2,
  rec: 1.55,
  rec_yds: 26,
  rec_td: 0.5,
  tackles: 2.4,
  sacks: 0.5,
};

/**
 * Logistic stand-in for P(actual > line) given projected mean.
 * Scale is a rough residual SD by market.
 */
function modelHitProbabilities(expected, line, statId) {
  const mu = Number(expected);
  const L = Number(line);
  if (!Number.isFinite(mu) || !Number.isFinite(L)) {
    return { pOver: null, pUnder: null, scale: null };
  }
  const scale = STAT_SCALE[statId] || Math.max(Math.abs(L) * 0.22, 4);
  const z = (mu - L) / scale;
  const pOver = clamp(1 / (1 + Math.exp(-1.65 * z)), 0.03, 0.97);
  return { pOver, pUnder: 1 - pOver, scale };
}

function buildProbGrade({
  expected,
  line,
  statId,
  lean,
  overPrice,
  underPrice,
}) {
  const model = modelHitProbabilities(expected, line, statId);
  const impliedOverRaw = impliedProbAmerican(overPrice);
  const impliedUnderRaw = impliedProbAmerican(underPrice);
  const fair = deVigPair(impliedOverRaw, impliedUnderRaw);

  const side =
    lean === "over" || lean === "under"
      ? lean
      : model.pOver != null && model.pOver >= 0.5
        ? "over"
        : "under";

  const modelP = side === "over" ? model.pOver : model.pUnder;
  const marketP = side === "over" ? fair.pOver : fair.pUnder;
  const probEdge =
    modelP != null && marketP != null ? modelP - marketP : null;

  let stars = 0;
  if (probEdge != null) {
    const abs = Math.abs(probEdge);
    if (abs >= 0.12) stars = 3;
    else if (abs >= 0.07) stars = 2;
    else if (abs >= 0.035) stars = 1;
  }

  return {
    pOver: model.pOver,
    pUnder: model.pUnder,
    scale: model.scale,
    impliedOver: fair.pOver,
    impliedUnder: fair.pUnder,
    impliedOverRaw,
    impliedUnderRaw,
    vig: fair.vig,
    side,
    modelProb: modelP,
    marketProb: marketP,
    probEdge,
    probEdgePct: probEdge != null ? Math.round(probEdge * 1000) / 10 : null,
    stars,
    label:
      side === "over"
        ? `Over · model ${pct(model.pOver)} vs market ${pct(fair.pOver)}`
        : `Under · model ${pct(model.pUnder)} vs market ${pct(fair.pUnder)}`,
  };
}

function pct(p) {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

module.exports = {
  impliedProbAmerican,
  deVigPair,
  modelHitProbabilities,
  buildProbGrade,
};
