/**
 * Public entry for the CFB Power Rating engine.
 */

const { MODEL_PARAMS, PARAM_DOCS, getModelParams } = require("./config");
const {
  calculateRatings,
  gameRecencyWeight,
  buildPreseasonPrior,
  talentRating100,
} = require("./ratings");
const { predictMatchup, winProbability } = require("./predict");
const { buildExplanation, advantageLabel } = require("./explain");
const { ingestSeasonFromCfbd } = require("./ingest-cfbd");
const { runBacktest } = require("./backtest");
const { softMargin, softMarginToPoints } = require("./margin");
const normalize = require("./normalize");

module.exports = {
  MODEL_PARAMS,
  PARAM_DOCS,
  getModelParams,
  calculateRatings,
  gameRecencyWeight,
  buildPreseasonPrior,
  talentRating100,
  predictMatchup,
  winProbability,
  buildExplanation,
  advantageLabel,
  ingestSeasonFromCfbd,
  runBacktest,
  softMargin,
  softMarginToPoints,
  normalize,
};
