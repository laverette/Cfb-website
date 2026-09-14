const { PROP_MODEL_VERSION } = require("./version");
const { PROP_DEFINITIONS, catalogPublic, getPropDef } = require("./definitions");
const { createClient, createUsage } = require("./cfbd-client");
const { loadPlayerBundle } = require("./bundle");
const { evaluateFromBundle, relineEvaluation } = require("./evaluate");
const { analyzeEntry, bestN, compareLegs } = require("./entry");
const { probabilityAtLine } = require("./simulate");
const { currentSeasonWeight } = require("./shrinkage");
const { searchPlayers } = require("../prop-eval");

async function evaluateProp({
  playerId,
  team,
  name,
  statId,
  line,
  side = "more",
  opponent,
  season,
  week,
  apiKey,
  powerTeams,
  signal,
  cfbd,
  marketOdds = null,
  includeDebug = false,
}) {
  const bundle = await loadPlayerBundle({
    playerId,
    team,
    name,
    opponent,
    season,
    week,
    apiKey,
    cfbd,
    powerTeams,
    signal,
  });
  const result = evaluateFromBundle(bundle, { statId, line, side, marketOdds });
  if (!includeDebug) {
    const { debug, ...rest } = result;
    return { ...rest, apiUsage: bundle.apiUsage };
  }
  return { ...result, apiUsage: bundle.apiUsage };
}

async function evaluateEntry({
  legs,
  season,
  week,
  apiKey,
  powerTeams,
  signal,
  includeDebug = false,
  marketOddsByTeam = null,
  mode = "balanced",
}) {
  const cfbd = createClient(apiKey, { signal });
  const evaluated = [];
  for (const leg of legs || []) {
    try {
      const marketOdds =
        (marketOddsByTeam && leg.team && marketOddsByTeam[String(leg.team).toLowerCase()]) ||
        null;
      const result = await evaluateProp({
        playerId: leg.playerId || leg.id,
        team: leg.team,
        name: leg.name,
        statId: leg.statId || leg.stat,
        line: leg.line,
        side: leg.side || "more",
        opponent: leg.opponent,
        season,
        week,
        apiKey,
        powerTeams,
        signal,
        cfbd,
        marketOdds: leg.marketOdds || marketOdds,
        includeDebug,
      });
      evaluated.push({
        ...result,
        clientId: leg.clientId || `${result.player.id}:${result.stat.id}:${result.line}`,
        error: null,
      });
    } catch (err) {
      evaluated.push({
        clientId: leg.clientId || `fail:${leg.playerId}:${leg.statId}`,
        player: { id: String(leg.playerId || ""), name: leg.name || "Player", team: leg.team || null },
        stat: { id: leg.statId, label: getPropDef(leg.statId)?.label || leg.statId },
        line: Number(leg.line),
        side: leg.side || "more",
        error: err.message || "Evaluation failed",
        code: err.code || null,
        flags: ["Missing Data"],
        propScore: 0,
      });
    }
  }
  evaluated.sort((a, b) => (b.propScore || 0) - (a.propScore || 0));
  const analysis = analyzeEntry(evaluated);
  return {
    modelVersion: PROP_MODEL_VERSION,
    legs: evaluated,
    analysis,
    best3: bestN(evaluated, Math.min(3, evaluated.filter((l) => !l.error).length), mode),
    best4: bestN(evaluated, Math.min(4, evaluated.filter((l) => !l.error).length), mode),
    apiUsage: cfbd.usage,
  };
}

module.exports = {
  PROP_MODEL_VERSION,
  PROP_DEFINITIONS,
  catalogPublic,
  getPropDef,
  createClient,
  createUsage,
  loadPlayerBundle,
  evaluateFromBundle,
  evaluateProp,
  evaluateEntry,
  relineEvaluation,
  analyzeEntry,
  bestN,
  compareLegs,
  probabilityAtLine,
  currentSeasonWeight,
  searchPlayers,
};
