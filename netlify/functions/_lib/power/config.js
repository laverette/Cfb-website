/**
 * Centralized CFB Power Model parameters (V1).
 * Values are PLACEHOLDERS intended for historical calibration via backtesting.
 * Do not treat defaults as statistically proven.
 */

const MODEL_PARAMS = Object.freeze({
  /** Home-field advantage in points (home team). Calibrate historically. */
  homeFieldAdvantage: 2.5,

  /** Recency: weight = exp(-recencyLambda * weeksAgo). Higher = faster decay. */
  recencyLambda: 0.12,

  /** Preseason prior weight decay: priorWeight = exp(-priorDecay * gamesPlayed). */
  priorDecay: 0.35,

  /** Blend of efficiency vs result/margin power (must sum conceptually with care). */
  efficiencyWeight: 0.72,
  resultWeight: 0.28,

  /** Offense metric blend (normalized z/diffs vs FBS avg). EPA primary. */
  offenseEpaWeight: 0.7,
  offenseSuccessWeight: 0.2,
  offenseExplosivenessWeight: 0.1,

  /** Defense metric blend (allowed metrics; lower allowed = better). */
  defenseEpaWeight: 0.7,
  defenseSuccessWeight: 0.2,
  defenseExplosivenessWeight: 0.1,

  /** Special teams contribution to raw power (points). Small by design. */
  specialTeamsWeight: 0.35,

  /** Talent contribution remaining in mid-blend (also in prior). */
  talentInfluence: 0.21,

  /** FCS handling */
  fcsPositiveWeight: 0.28,
  fcsNegativeWeight: 0.85,
  fcsBlowoutCap: 17,

  /** Soft margin transform for result component: sign(m)*log(1+|m|). */
  marginLogBase: Math.E,

  /** Opponent-adjustment solver */
  oaEpsilon: 0.05,
  oaMaxIterations: 40,
  oaLearningRate: 0.35,

  /** Win probability: P = 1/(1+exp(-margin/tau)). Calibrate historically. */
  winProbTau: 8.5,

  /** Public Power Score: score = clamp(50 + raw * scale, 0, 100). */
  powerScoreScale: 2.2,

  /** Advantage label thresholds (raw power points). */
  advantageMajor: 7,
  advantageClear: 3.5,
  advantageSlight: 1.25,

  /** Turnover luck regression toward 50% fumble recoveries. */
  fumbleRecoveryMean: 0.5,
  turnoverComponentWeight: 0.12,

  /** Preseason prior sub-weights (normalized internally). */
  priorPrevSeasonWeight: 0.45,
  priorTalentWeight: 0.3,
  priorRecruitingWeight: 0.15,
  priorReturningWeight: 0.1,
});

const PARAM_DOCS = Object.freeze({
  homeFieldAdvantage: "Points added to home team in matchup projection. Needs historical calibration.",
  recencyLambda: "Exponential decay rate for game age in weeks.",
  priorDecay: "How fast preseason prior fades as games accumulate.",
  efficiencyWeight: "Weight on opponent-adjusted efficiency power in final blend.",
  resultWeight: "Weight on soft-margin game-result power in final blend.",
  winProbTau: "Logistic scale for margin → win probability. Calibrate with Brier/log-loss.",
  powerScoreScale: "Maps raw points-above-average to 0–100 display score around 50.",
  fcsPositiveWeight: "Down-weights positive information from FBS-over-FCS games.",
  fcsNegativeWeight: "Retains more weight when FBS struggles/loses to FCS.",
});

function getModelParams(overrides = {}) {
  return { ...MODEL_PARAMS, ...overrides };
}

module.exports = {
  MODEL_PARAMS,
  PARAM_DOCS,
  getModelParams,
};
