const { clamp } = require("./math");

/**
 * Current-season weight vs prior/role prior.
 * Two games must never dominate the way a 12-game sample would.
 */
function currentSeasonWeight(games, { hasPrior = true } = {}) {
  const n = Math.max(0, Number(games) || 0);
  if (n <= 0) return 0;
  let w;
  if (n <= 2) w = 0.18 + 0.08 * (n - 1);
  else if (n <= 4) w = 0.42 + 0.1 * (n - 3);
  else if (n <= 7) w = 0.66 + 0.06 * (n - 5);
  else w = 0.88 + Math.min(0.08, (n - 8) * 0.02);
  if (!hasPrior) w = clamp(w + 0.12, 0.28, 0.92);
  return clamp(w, 0.12, 0.96);
}

function recencyWeights(count, lambda = 0.2) {
  const w = [];
  for (let i = 0; i < count; i += 1) {
    const age = count - 1 - i;
    w.push(Math.exp(-lambda * age));
  }
  return w;
}

function opponentQualityMultiplier(game, leagueDefMeans) {
  if (game?.isFcs) return 0.48;
  const q = Number(game?.oppQuality);
  if (Number.isFinite(q)) {
    // 0 = very weak defense faced, 1 = elite
    return 0.55 + 0.5 * clamp(q, 0, 1);
  }
  if (leagueDefMeans && Number.isFinite(game?.oppDefValue) && Number.isFinite(leagueDefMeans.sd)) {
    return 1;
  }
  return 1;
}

function gamePredictiveWeight(game, indexFromEnd, count) {
  const recency = recencyWeights(count, 0.2)[indexFromEnd] ?? 1;
  const quality = opponentQualityMultiplier(game);
  return recency * quality;
}

function blendExpectation({ current, prior, rolePrior, games, hasPrior }) {
  const wCur = currentSeasonWeight(games, { hasPrior });
  const pieces = [];
  if (Number.isFinite(current)) pieces.push({ value: current, weight: wCur });
  if (Number.isFinite(prior) && hasPrior) {
    pieces.push({ value: prior, weight: (1 - wCur) * 0.75 });
  } else if (Number.isFinite(rolePrior)) {
    pieces.push({ value: rolePrior, weight: 1 - wCur });
  }
  if (!pieces.length) return { value: null, currentWeight: wCur, priorWeight: 1 - wCur };
  const den = pieces.reduce((s, p) => s + p.weight, 0);
  const value = pieces.reduce((s, p) => s + p.value * p.weight, 0) / den;
  return { value, currentWeight: wCur, priorWeight: 1 - wCur };
}

function adjustedGameValue(raw, leagueMean, qualityMult) {
  if (!Number.isFinite(raw)) return null;
  if (!Number.isFinite(leagueMean)) return raw;
  const shrink = clamp(qualityMult, 0.4, 1.2);
  return leagueMean + (raw - leagueMean) * shrink;
}

module.exports = {
  currentSeasonWeight,
  recencyWeights,
  opponentQualityMultiplier,
  gamePredictiveWeight,
  blendExpectation,
  adjustedGameValue,
};
