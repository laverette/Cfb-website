const { PROP_MODEL_VERSION } = require("./version");
const { PROP_DEFINITIONS, catalogPublic, positionRulesPublic, getPropDef } = require("./definitions");
const { createClient, createUsage } = require("./cfbd-client");
const { loadPlayerBundle } = require("./bundle");
const { evaluateFromBundle, relineEvaluation } = require("./evaluate");
const { analyzeEntry, bestN, compareLegs } = require("./entry");
const { probabilityAtLine } = require("./simulate");
const { currentSeasonWeight } = require("./shrinkage");
const { searchPlayers } = require("../prop-eval");
const { getPlayerGameLog, getTeamScheduleData, readProviderMode } = require("./data/player-stats");
const {
  _resetCfbdCircuit,
  _forceOpenCfbdCircuit,
  cfbdCircuitInfo,
} = require("./data/circuit-breaker");
const {
  stampClientId,
  identityWarnings,
  propIdentityKey,
  legSessionKey,
} = require("./prop-identity");

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
    const requestedPlayerId =
      leg.playerId != null && String(leg.playerId).trim() !== ""
        ? String(leg.playerId).trim()
        : null;
    // Never treat a client session uuid (`leg.id`) as a player id.
    if (!requestedPlayerId) {
      evaluated.push({
        clientId: leg.clientId || leg.id || `fail:missing-player:${leg.statId}`,
        player: { id: "", name: leg.name || "Player", team: leg.team || null },
        stat: { id: leg.statId, label: getPropDef(leg.statId)?.label || leg.statId },
        line: Number(leg.line),
        side: leg.side || "more",
        error: "playerId required — each leg must identify a specific player",
        code: "MISSING_PLAYER_ID",
        flags: ["Missing Data"],
        propScore: 0,
        propIdentity: propIdentityKey(leg),
      });
      continue;
    }
    try {
      const marketOdds =
        (marketOddsByTeam && leg.team && marketOddsByTeam[String(leg.team).toLowerCase()]) ||
        null;
      const result = await evaluateProp({
        playerId: requestedPlayerId,
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
      const clientId =
        leg.clientId ||
        leg.id ||
        `${result.player.id}:${result.stat.id}:${result.line}:${result.side || "more"}`;
      const stamped = stampClientId(
        {
          ...result,
          propIdentity: propIdentityKey({
            playerId: result.player?.id,
            playerName: result.player?.name,
            team: result.player?.team || leg.team,
            opponent: result.opponent,
            league: leg.league,
            statId: result.stat?.id,
            line: result.line,
            side: result.side,
            sourcePropId: leg.sourcePropId,
          }),
          identityWarnings: identityWarnings(
            {
              playerId: requestedPlayerId,
              name: leg.name,
              statId: leg.statId || leg.stat,
              line: leg.line,
              side: leg.side || "more",
            },
            result
          ),
          error: null,
        },
        clientId
      );
      if (stamped.identityWarnings?.length && typeof console !== "undefined" && console.warn) {
        for (const w of stamped.identityWarnings) {
          console.warn("[PropLab]", w.code, w.message);
        }
      }
      evaluated.push(stamped);
    } catch (err) {
      evaluated.push({
        clientId: leg.clientId || leg.id || `fail:${requestedPlayerId}:${leg.statId}`,
        player: { id: requestedPlayerId, name: leg.name || "Player", team: leg.team || null },
        stat: { id: leg.statId, label: getPropDef(leg.statId)?.label || leg.statId },
        line: Number(leg.line),
        side: leg.side || "more",
        error: err.message || "Evaluation failed",
        code: err.code || null,
        flags: ["Missing Data"],
        propScore: 0,
        propIdentity: propIdentityKey({
          playerId: requestedPlayerId,
          playerName: leg.name,
          team: leg.team,
          statId: leg.statId,
          line: leg.line,
          side: leg.side,
          sourcePropId: leg.sourcePropId,
        }),
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
  positionRulesPublic,
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
  getPlayerGameLog,
  getTeamScheduleData,
  readProviderMode,
  cfbdCircuitInfo,
  _resetCfbdCircuit,
  _forceOpenCfbdCircuit,
  propIdentityKey,
  legSessionKey,
};
