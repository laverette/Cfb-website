/**
 * Centralized CFB Power Model parameters (V1).
 * Values are PLACEHOLDERS intended for historical calibration via backtesting.
 * Do not treat defaults as statistically proven.
 */

const MODEL_PARAMS = Object.freeze({
  /** Home-field advantage in points (home team). Calibrate historically. */
  homeFieldAdvantage: 2.5,

  /**
   * Extra matchup spread from talent gap (0–100 talent → points via powerScoreScale).
   * Raw power already embeds some talent via the prior; this is a residual early-season boost
   * so large talent gaps still move the displayed spread. 0 = power-only spreads.
   */
  matchupTalentWeight: 0.35,

  /** Recency: weight = exp(-recencyLambda * weeksAgo). Higher = faster decay. */
  recencyLambda: 0.1,

  /**
   * Treat the preseason prior as this many "virtual games" when blending with observed play.
   * Week 1 with 5 → only ~17% of the rating comes from the single game (rest stays prior).
   * Stops cupcake blowouts from vaulting G5 teams into the top 10 overnight.
   */
  priorPseudoGames: 5,

  /**
   * Opponent-adjusted OFF/DEF solve: prior unit ratings count as this many game-weights.
   * Keeps one-game EPA spikes from producing Off +25 unit ratings.
   */
  oaPriorStrength: 4,

  /** Legacy exponential prior fade (backup). Primary early-season control is priorPseudoGames. */
  priorDecay: 0.12,

  /** Blend of efficiency vs result/margin power within the *observed* share. */
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
  talentInfluence: 0.35,

  /** FCS handling */
  fcsPositiveWeight: 0.22,
  fcsNegativeWeight: 0.85,
  fcsBlowoutCap: 14,

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
  priorPrevSeasonWeight: 0.4,
  priorTalentWeight: 0.38,
  priorRecruitingWeight: 0.14,
  priorReturningWeight: 0.08,
});

const PARAM_DOCS = Object.freeze({
  homeFieldAdvantage: "Points added to home team in matchup projection. Needs historical calibration.",
  matchupTalentWeight:
    "Fraction of (talentA−talentB) in raw-power points added on top of the power line. Early-season lever.",
  priorPseudoGames:
    "Virtual games assigned to the preseason prior. Higher = slower to trust early results.",
  oaPriorStrength:
    "Virtual game-weights for prior OFF/DEF inside the opponent-adjusted solve.",
  recencyLambda: "Exponential decay rate for game age in weeks.",
  priorDecay: "Legacy exponential prior fade; sample shrink via priorPseudoGames is primary.",
  efficiencyWeight: "Weight on opponent-adjusted efficiency power in the observed blend.",
  resultWeight: "Weight on soft-margin game-result power in the observed blend.",
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
