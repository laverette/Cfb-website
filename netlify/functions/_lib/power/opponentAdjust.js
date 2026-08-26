/**
 * Iterative opponent-adjusted offense / defense ratings.
 *
 * offense_adj ≈ performance relative to opponent defense quality
 * defense_adj ≈ (suppression of opponent offense) relative to opponent offense quality
 *
 * Convergence: max |Δrating| < epsilon or maxIterations.
 */

const { mean } = require("./normalize");

function emptyTeamState() {
  return {
    offSum: 0,
    offW: 0,
    defSum: 0,
    defW: 0,
  };
}

/**
 * @param {Array} games normalized completed games with:
 *   homeId, awayId, homeOffPerf, awayOffPerf, homeDefPerf, awayDefPerf,
 *   weight, homeIsFbs, awayIsFbs, neutralSite
 * @param {Map<string|number, number>} priorOff optional starting offense
 * @param {Map<string|number, number>} priorDef optional starting defense
 * @param {object} params model params
 */
function solveOpponentAdjusted({
  games,
  teamIds,
  priorOff = new Map(),
  priorDef = new Map(),
  params,
}) {
  const offense = new Map();
  const defense = new Map();
  for (const id of teamIds) {
    offense.set(id, priorOff.get(id) || 0);
    defense.set(id, priorDef.get(id) || 0);
  }

  const lr = params.oaLearningRate ?? 0.35;
  const eps = params.oaEpsilon ?? 0.05;
  const maxIter = params.oaMaxIterations ?? 40;
  let iterations = 0;
  let maxDelta = Infinity;

  for (iterations = 1; iterations <= maxIter; iterations += 1) {
    const acc = new Map();
    for (const id of teamIds) acc.set(id, emptyTeamState());

    for (const g of games) {
      const w = Number(g.weight) || 0;
      if (w <= 0) continue;
      const homeOff = offense.get(g.homeId) ?? 0;
      const awayOff = offense.get(g.awayId) ?? 0;
      const homeDef = defense.get(g.homeId) ?? 0;
      const awayDef = defense.get(g.awayId) ?? 0;

      // Expected offensive output ≈ own offense - opponent defense (points-ish units)
      // Residual performance credit:
      const homeOffTarget = (Number(g.homeOffPerf) || 0) + awayDef;
      const awayOffTarget = (Number(g.awayOffPerf) || 0) + homeDef;
      // Defense: positive = good. homeDefTarget from how much they held away offense down.
      const homeDefTarget = (Number(g.homeDefPerf) || 0) + awayOff;
      const awayDefTarget = (Number(g.awayDefPerf) || 0) + homeOff;

      const h = acc.get(g.homeId);
      const a = acc.get(g.awayId);
      if (h) {
        h.offSum += w * homeOffTarget;
        h.offW += w;
        h.defSum += w * homeDefTarget;
        h.defW += w;
      }
      if (a) {
        a.offSum += w * awayOffTarget;
        a.offW += w;
        a.defSum += w * awayDefTarget;
        a.defW += w;
      }
    }

    maxDelta = 0;
    for (const id of teamIds) {
      const s = acc.get(id);
      const nextOff =
        s.offW > 0
          ? (1 - lr) * (offense.get(id) || 0) + lr * (s.offSum / s.offW)
          : offense.get(id) || 0;
      const nextDef =
        s.defW > 0
          ? (1 - lr) * (defense.get(id) || 0) + lr * (s.defSum / s.defW)
          : defense.get(id) || 0;
      maxDelta = Math.max(
        maxDelta,
        Math.abs(nextOff - (offense.get(id) || 0)),
        Math.abs(nextDef - (defense.get(id) || 0))
      );
      offense.set(id, nextOff);
      defense.set(id, nextDef);
    }

    // Re-center each iteration so network doesn't drift
    const offMean = mean([...offense.values()]);
    const defMean = mean([...defense.values()]);
    for (const id of teamIds) {
      offense.set(id, (offense.get(id) || 0) - offMean);
      defense.set(id, (defense.get(id) || 0) - defMean);
    }

    if (maxDelta < eps) break;
  }

  return { offense, defense, iterations, maxDelta };
}

module.exports = {
  solveOpponentAdjusted,
};
