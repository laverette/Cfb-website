/**
 * CFB Power Rating calculator (V1).
 *
 * Raw power ≈ expected point differential vs average FBS on a neutral field.
 * Public power_score is display-only (0–100) and NEVER used for spreads.
 */

const { getModelParams } = require("./config");
const { softMargin, softMarginToPoints } = require("./margin");
const {
  mean,
  powerScoreFromRaw,
  round,
  clamp,
} = require("./normalize");
const { solveOpponentAdjusted } = require("./opponentAdjust");

function teamKey(id) {
  return id;
}

function isFcsTeam(team, teamsById) {
  const t = teamsById.get(team);
  if (!t) return false;
  const c = String(t.classification || t.division || "").toLowerCase();
  return c === "fcs" || c.includes("fcs");
}

function weeksAgo(gameWeek, asOfWeek) {
  if (!Number.isFinite(gameWeek) || !Number.isFinite(asOfWeek)) return 0;
  return Math.max(0, asOfWeek - gameWeek);
}

function gameRecencyWeight(gameWeek, asOfWeek, lambda) {
  return Math.exp(-(lambda || 0) * weeksAgo(gameWeek, asOfWeek));
}

function fcsWeightMultiplier(game, teamsById, params, marginFromFbsPerspective) {
  const homeFcs = isFcsTeam(game.homeId, teamsById);
  const awayFcs = isFcsTeam(game.awayId, teamsById);
  if (!homeFcs && !awayFcs) return 1;
  // Positive info (FBS dominating FCS) down-weighted; bad FBS performances hurt more.
  if (marginFromFbsPerspective >= 0) return params.fcsPositiveWeight;
  return params.fcsNegativeWeight;
}

/**
 * Build per-game offensive/defensive performance signals in point-ish units.
 * Prefer EPA when present; fall back to score/margin components.
 */
function gamePerfSignals(game, league) {
  const homeEpa = game.homeOffEpa;
  const awayEpa = game.awayOffEpa;
  const hasEpa = Number.isFinite(homeEpa) && Number.isFinite(awayEpa);

  let homeOffPerf;
  let awayOffPerf;
  if (hasEpa) {
    // Scale EPA/play toward points: configurable via league.epaToPoints
    const k = league.epaToPoints || 18;
    homeOffPerf = (homeEpa - (league.avgOffEpa || 0)) * k;
    awayOffPerf = (awayEpa - (league.avgOffEpa || 0)) * k;

    const hs = Number.isFinite(game.homeSuccessRate)
      ? (game.homeSuccessRate - (league.avgSuccess || 0)) * 25
      : 0;
    const as_ = Number.isFinite(game.awaySuccessRate)
      ? (game.awaySuccessRate - (league.avgSuccess || 0)) * 25
      : 0;
    const he = Number.isFinite(game.homeExplosiveness)
      ? (game.homeExplosiveness - (league.avgExpl || 0)) * 12
      : 0;
    const ae = Number.isFinite(game.awayExplosiveness)
      ? (game.awayExplosiveness - (league.avgExpl || 0)) * 12
      : 0;

    const ow = league.offenseEpaWeight ?? 0.7;
    const sw = league.offenseSuccessWeight ?? 0.2;
    const ew = league.offenseExplosivenessWeight ?? 0.1;
    homeOffPerf = ow * homeOffPerf + sw * hs + ew * he;
    awayOffPerf = ow * awayOffPerf + sw * as_ + ew * ae;
  } else {
    // Score-based fallback: offense ≈ points scored vs league avg PPG proxy
    const avgPts = league.avgPoints || 28;
    homeOffPerf = (Number(game.homeScore) || 0) - avgPts;
    awayOffPerf = (Number(game.awayScore) || 0) - avgPts;
  }

  // Defense performance: positive = good (held opponent below expectation)
  const homeDefPerf = -awayOffPerf;
  const awayDefPerf = -homeOffPerf;

  // If defensive EPA allowed exists, blend
  if (Number.isFinite(game.homeDefEpaAllowed) && Number.isFinite(game.awayDefEpaAllowed)) {
    const k = league.epaToPoints || 18;
    const homeDefFromEpa = -((game.homeDefEpaAllowed - (league.avgOffEpa || 0)) * k);
    const awayDefFromEpa = -((game.awayDefEpaAllowed - (league.avgOffEpa || 0)) * k);
    const dw = 0.55;
    return {
      homeOffPerf,
      awayOffPerf,
      homeDefPerf: dw * homeDefFromEpa + (1 - dw) * homeDefPerf,
      awayDefPerf: dw * awayDefFromEpa + (1 - dw) * awayDefPerf,
    };
  }

  return { homeOffPerf, awayOffPerf, homeDefPerf, awayDefPerf };
}

function buildPreseasonPrior(team, params) {
  const prev = Number(team.prevSeasonPower) || 0;
  const talent = Number.isFinite(team.talentScore)
    ? ((team.talentScore - 50) / params.powerScoreScale) * params.talentInfluence * 4
    : 0;
  const recruiting = Number.isFinite(team.recruitingScore)
    ? ((team.recruitingScore - 50) / params.powerScoreScale) * 2
    : 0;
  const returning = Number.isFinite(team.returningProduction)
    ? (team.returningProduction - 0.55) * 8
    : 0;

  const wPrev = params.priorPrevSeasonWeight;
  const wTal = params.priorTalentWeight;
  const wRec = params.priorRecruitingWeight;
  const wRet = params.priorReturningWeight;
  const wSum = wPrev + wTal + wRec + wRet || 1;
  return (
    (wPrev * prev + wTal * talent + wRec * recruiting + wRet * returning) / wSum
  );
}

function talentRating100(team) {
  const parts = [];
  if (Number.isFinite(team.talentScore)) parts.push(team.talentScore);
  if (Number.isFinite(team.recruitingScore)) parts.push(team.recruitingScore);
  if (Number.isFinite(team.blueChipPct)) parts.push(clamp(team.blueChipPct * 100, 0, 100));
  if (Number.isFinite(team.returningProduction)) {
    parts.push(clamp(team.returningProduction * 100, 0, 100));
  }
  if (!parts.length) return 50;
  return round(mean(parts), 1);
}

/**
 * Calculate ratings for a season through asOfWeek.
 *
 * @param {object} input
 * @param {Array} input.teams [{ id, name, conference, classification, prevSeasonPower, talentScore, ... }]
 * @param {Array} input.games completed games through asOfWeek
 * @param {number} input.asOfWeek
 * @param {number} input.season
 * @param {Map|object} [input.personnelAdjustments] teamId -> points
 * @param {object} [input.paramOverrides]
 */
function calculateRatings(input) {
  const params = getModelParams(input.paramOverrides || {});
  const teams = Array.isArray(input.teams) ? input.teams : [];
  const teamsById = new Map(teams.map((t) => [teamKey(t.id), t]));
  const asOfWeek = Number(input.asOfWeek) || 0;
  const season = Number(input.season) || new Date().getFullYear();

  const completed = (Array.isArray(input.games) ? input.games : []).filter(
    (g) => g && g.completed && Number.isFinite(Number(g.homeScore)) && Number.isFinite(Number(g.awayScore))
  ).filter((g) => {
    const w = Number(g.week);
    return !Number.isFinite(asOfWeek) || asOfWeek <= 0 || !Number.isFinite(w) || w <= asOfWeek;
  });

  // Ensure every game participant exists (FCS opponents etc.) for the network solve
  for (const g of completed) {
    if (!teamsById.has(g.homeId)) {
      const syn = {
        id: g.homeId,
        name: g.homeTeam || String(g.homeId),
        classification: g.homeClassification || "fcs",
      };
      teams.push(syn);
      teamsById.set(g.homeId, syn);
    }
    if (!teamsById.has(g.awayId)) {
      const syn = {
        id: g.awayId,
        name: g.awayTeam || String(g.awayId),
        classification: g.awayClassification || "fcs",
      };
      teams.push(syn);
      teamsById.set(g.awayId, syn);
    }
  }

  const teamIds = [...teamsById.keys()];
  const publicTeamIds = new Set(
    [...teamsById.values()]
      .filter((t) => String(t.classification || "fbs").toLowerCase() !== "fcs")
      .map((t) => teamKey(t.id))
  );

  // League averages for EPA etc.
  const offEpas = completed.flatMap((g) => [g.homeOffEpa, g.awayOffEpa]).filter(Number.isFinite);
  const successes = completed
    .flatMap((g) => [g.homeSuccessRate, g.awaySuccessRate])
    .filter(Number.isFinite);
  const expls = completed
    .flatMap((g) => [g.homeExplosiveness, g.awayExplosiveness])
    .filter(Number.isFinite);
  const points = completed.flatMap((g) => [g.homeScore, g.awayScore]).filter(Number.isFinite);

  const league = {
    avgOffEpa: mean(offEpas),
    avgSuccess: mean(successes),
    avgExpl: mean(expls),
    avgPoints: mean(points) || 28,
    epaToPoints: 18,
    offenseEpaWeight: params.offenseEpaWeight,
    offenseSuccessWeight: params.offenseSuccessWeight,
    offenseExplosivenessWeight: params.offenseExplosivenessWeight,
  };

  // Games played counts + priors
  const gamesPlayed = new Map(teamIds.map((id) => [id, 0]));
  const wins = new Map(teamIds.map((id) => [id, 0]));
  const losses = new Map(teamIds.map((id) => [id, 0]));
  const priors = new Map();
  for (const t of teams) {
    priors.set(teamKey(t.id), buildPreseasonPrior(t, params));
  }

  const weightedGames = [];
  for (const g of completed) {
    const margin = (Number(g.homeScore) || 0) - (Number(g.awayScore) || 0);
    const perf = gamePerfSignals(g, league);
    let w = gameRecencyWeight(Number(g.week), asOfWeek, params.recencyLambda);

    const homeFcs = isFcsTeam(g.homeId, teamsById);
    const awayFcs = isFcsTeam(g.awayId, teamsById);
    if (homeFcs || awayFcs) {
      // margin from FBS perspective when one side is FCS
      let fbsMargin = margin;
      if (awayFcs && !homeFcs) fbsMargin = margin;
      else if (homeFcs && !awayFcs) fbsMargin = -margin;
      else fbsMargin = 0;
      // Cap blowout positive signal
      if (fbsMargin > params.fcsBlowoutCap) fbsMargin = params.fcsBlowoutCap;
      w *= fcsWeightMultiplier(g, teamsById, params, fbsMargin);
    }

    if (gamesPlayed.has(g.homeId)) gamesPlayed.set(g.homeId, gamesPlayed.get(g.homeId) + 1);
    if (gamesPlayed.has(g.awayId)) gamesPlayed.set(g.awayId, gamesPlayed.get(g.awayId) + 1);
    if (margin > 0 && wins.has(g.homeId)) wins.set(g.homeId, wins.get(g.homeId) + 1);
    if (margin < 0 && losses.has(g.homeId)) losses.set(g.homeId, losses.get(g.homeId) + 1);
    if (margin < 0 && wins.has(g.awayId)) wins.set(g.awayId, wins.get(g.awayId) + 1);
    if (margin > 0 && losses.has(g.awayId)) losses.set(g.awayId, losses.get(g.awayId) + 1);

    weightedGames.push({
      ...g,
      weight: w,
      homeOffPerf: perf.homeOffPerf,
      awayOffPerf: perf.awayOffPerf,
      homeDefPerf: perf.homeDefPerf,
      awayDefPerf: perf.awayDefPerf,
      margin,
    });
  }

  const { offense, defense, iterations, maxDelta } = solveOpponentAdjusted({
    games: weightedGames,
    teamIds,
    priorOff: priors,
    priorDef: new Map(teamIds.map((id) => [id, 0])),
    params,
  });

  // Result / margin power (soft) with opponent adjustment via expected margin from OA ratings
  const resultAcc = new Map(teamIds.map((id) => [id, { sum: 0, w: 0 }]));
  for (const g of weightedGames) {
    const hfa = g.neutralSite ? 0 : params.homeFieldAdvantage;
    const expected =
      (offense.get(g.homeId) || 0) -
      (defense.get(g.awayId) || 0) -
      ((offense.get(g.awayId) || 0) - (defense.get(g.homeId) || 0)) +
      hfa;
    // Simpler expected from overall: (off_h+def_h) - (off_a+def_a) + hfa
    const homePowerApprox =
      (offense.get(g.homeId) || 0) + (defense.get(g.homeId) || 0);
    const awayPowerApprox =
      (offense.get(g.awayId) || 0) + (defense.get(g.awayId) || 0);
    const expMargin = homePowerApprox - awayPowerApprox + hfa;
    const residual = g.margin - expMargin;
    const soft = softMarginToPoints(softMargin(residual, params));
    const rh = resultAcc.get(g.homeId);
    const ra = resultAcc.get(g.awayId);
    if (rh) {
      rh.sum += g.weight * soft;
      rh.w += g.weight;
    }
    if (ra) {
      ra.sum += g.weight * -soft;
      ra.w += g.weight;
    }
  }

  const resultPower = new Map();
  for (const id of teamIds) {
    const r = resultAcc.get(id);
    resultPower.set(id, r && r.w > 0 ? r.sum / r.w : 0);
  }

  // Special teams (small)
  const special = new Map();
  for (const t of teams) {
    const id = teamKey(t.id);
    const st = Number.isFinite(t.specialTeamsRating) ? t.specialTeamsRating : 0;
    special.set(id, st * params.specialTeamsWeight);
  }

  // Personnel adjustments
  const personnel = new Map();
  const rawPers = input.personnelAdjustments;
  if (rawPers instanceof Map) {
    for (const [k, v] of rawPers.entries()) personnel.set(teamKey(k), Number(v) || 0);
  } else if (rawPers && typeof rawPers === "object") {
    for (const [k, v] of Object.entries(rawPers)) personnel.set(teamKey(k), Number(v) || 0);
  }

  const efficiencyPower = new Map();
  for (const id of teamIds) {
    efficiencyPower.set(
      id,
      (offense.get(id) || 0) + (defense.get(id) || 0)
    );
  }

  const rawPower = new Map();
  for (const id of teamIds) {
    const gp = gamesPlayed.get(id) || 0;
    const priorW = Math.exp(-(params.priorDecay || 0) * gp);
    const prior = (priors.get(id) || 0) * priorW;
    const blended =
      params.efficiencyWeight * (efficiencyPower.get(id) || 0) +
      params.resultWeight * (resultPower.get(id) || 0) +
      (special.get(id) || 0) +
      prior +
      (personnel.get(id) || 0);
    rawPower.set(id, blended);
  }

  // Center so FBS average = 0 (FCS included in solve but not in mean)
  const fbsRawVals = [...publicTeamIds].map((id) => rawPower.get(id) || 0);
  const fbsMean = mean(fbsRawVals);
  const centered = new Map();
  for (const id of teamIds) {
    centered.set(id, (rawPower.get(id) || 0) - fbsMean);
  }

  // SOS = weighted avg opponent raw power
  const sosAcc = new Map(teamIds.map((id) => [id, { sum: 0, w: 0 }]));
  for (const g of weightedGames) {
    const sh = sosAcc.get(g.homeId);
    const sa = sosAcc.get(g.awayId);
    if (sh) {
      sh.sum += g.weight * (centered.get(g.awayId) || 0);
      sh.w += g.weight;
    }
    if (sa) {
      sa.sum += g.weight * (centered.get(g.homeId) || 0);
      sa.w += g.weight;
    }
  }

  const rows = [...publicTeamIds].map((id) => {
    const t = teamsById.get(id);
    const raw = centered.get(id) || 0;
    const sos = sosAcc.get(id);
    const sosVal = sos && sos.w > 0 ? sos.sum / sos.w : 0;
    const off = offense.get(id) || 0;
    const def = defense.get(id) || 0;
    const w = wins.get(id) || 0;
    const l = losses.get(id) || 0;
    return {
      teamId: id,
      name: t.name,
      abbreviation: t.abbreviation || null,
      conference: t.conference || null,
      classification: t.classification || "fbs",
      logoUrl: t.logoUrl || null,
      season,
      week: asOfWeek,
      rawPower: round(raw, 3),
      powerScore: round(powerScoreFromRaw(raw, params.powerScoreScale), 1),
      offenseRating: round(off, 3),
      defenseRating: round(def, 3),
      specialTeamsRating: round(special.get(id) || 0, 3),
      talentRating: talentRating100(t),
      sosRating: round(sosVal, 3),
      wins: w,
      losses: l,
      record: `${w}-${l}`,
      gamesPlayed: gamesPlayed.get(id) || 0,
      priorRemaining: round(
        (priors.get(id) || 0) * Math.exp(-(params.priorDecay || 0) * (gamesPlayed.get(id) || 0)),
        3
      ),
      personnelAdjustment: round(personnel.get(id) || 0, 3),
    };
  });

  rows.sort((a, b) => b.rawPower - a.rawPower || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    r.ranking = i + 1;
  });

  // previous rankings if provided
  const prevRank = input.previousRankings instanceof Map
    ? input.previousRankings
    : new Map(Object.entries(input.previousRankings || {}).map(([k, v]) => [teamKey(k), v]));
  for (const r of rows) {
    const prev = prevRank.get(r.teamId);
    r.previousRanking = prev != null ? Number(prev) : null;
    r.rankingMovement =
      r.previousRanking != null ? r.previousRanking - r.ranking : null;
  }

  return {
    season,
    week: asOfWeek,
    paramsUsed: {
      homeFieldAdvantage: params.homeFieldAdvantage,
      recencyLambda: params.recencyLambda,
      priorDecay: params.priorDecay,
      efficiencyWeight: params.efficiencyWeight,
      resultWeight: params.resultWeight,
      winProbTau: params.winProbTau,
      powerScoreScale: params.powerScoreScale,
    },
    solver: { iterations, maxDelta: round(maxDelta, 4) },
    fbsAverageRawPower: 0,
    teams: rows,
  };
}

module.exports = {
  calculateRatings,
  gameRecencyWeight,
  softMargin,
  softMarginToPoints,
  buildPreseasonPrior,
  talentRating100,
  isFcsTeam,
};
