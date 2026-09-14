const { PROP_MODEL_VERSION } = require("./version");
const { getPropDef } = require("./definitions");
const {
  mean,
  median,
  stddev,
  minMax,
  lastN,
  hitRate,
  clamp,
  toNum,
} = require("./math");
const { extractStatValue, extractOverviewTotal } = require("./parse");
const {
  blendExpectation,
  gamePredictiveWeight,
  adjustedGameValue,
  currentSeasonWeight,
} = require("./shrinkage");
const { estimateOpportunity, roleTrend } = require("./opportunity");
const { matchupAdjustment, opponentQualityForGame } = require("./matchup");
const { gameEnvironment } = require("./environment");
const {
  simulateOutcomes,
  summarizeSims,
  probabilityAtLine,
} = require("./simulate");
const { confidenceGrade, reliabilityFromConfidence, collectFlags } = require("./confidence");
const { propScore } = require("./score");

function valuesFromLogs(logs, statId) {
  return (logs || [])
    .map((g) => {
      const raw = Number.isFinite(g.value) ? g.value : extractStatValue(g.stats || {}, statId);
      return { ...g, value: raw };
    })
    .filter((g) => Number.isFinite(g.value));
}

function weightedCurrent(logs, leagueMean) {
  const n = logs.length;
  const items = logs.map((g, i) => {
    const q = g.oppQuality ?? 0.5;
    const adj = adjustedGameValue(g.value, leagueMean, 0.55 + 0.5 * q);
    const w = gamePredictiveWeight({ ...g, oppQuality: q }, i, n);
    return { value: adj, weight: w, raw: g.value, week: g.week, opponent: g.opponent, isFcs: g.isFcs };
  });
  let num = 0;
  let den = 0;
  for (const it of items) {
    num += it.value * it.weight;
    den += it.weight;
  }
  return { avg: den ? num / den : null, items };
}

function seasonAvgFromOverview(bundle, def) {
  const total = extractOverviewTotal(bundle.currentOverview, def.id);
  const games = toNum(bundle.currentOverview?.games) || bundle.gameLogs?.length || 0;
  if (total == null || !games) return null;
  return total / games;
}

function priorAvgFromOverview(bundle, def) {
  const total = extractOverviewTotal(bundle.priorOverview, def.id);
  const games = toNum(bundle.priorOverview?.games) || bundle.priorLogs?.length || 0;
  if (total == null || !games) return null;
  return total / games;
}

function rolePrior(bundle, def, oppEst) {
  if (oppEst?.rawOppProj) return oppEst.rawOppProj * 0.85;
  if (def.family === "receiving") return 45;
  if (def.family === "rushing") return 55;
  if (def.family === "passing") return 210;
  if (def.id === "total_td") return 0.7;
  return 20;
}

function buildGameLogRows(logs, line, side) {
  return (logs || []).map((g) => {
    const more = g.value > line;
    return {
      week: g.week,
      opp: g.opponent,
      result:
        g.points != null && g.oppPoints != null
          ? `${g.points}-${g.oppPoints}`
          : null,
      value: g.value,
      raw: g.value,
      adjusted: g.adjusted ?? null,
      oppQuality: g.oppQuality ?? null,
      isFcs: Boolean(g.isFcs),
      over: more,
      hit: side === "less" ? g.value < line : more,
      homeAway: g.homeAway,
    };
  });
}

function whyAndCaution({ def, bundle, projection, line, side, pHit, flags, role, matchup, env, blend }) {
  const why = [];
  const caution = [];
  const edge = projection - line;
  const likesMore = (side === "less" && edge < 0) || (side !== "less" && edge > 0);

  if (role.role === "Rising") why.push(role.detail);
  if (matchup.adjPct > 0.03) why.push("Favorable defensive matchup for this stat");
  if (matchup.adjPct < -0.03) caution.push("Tough defensive matchup for this stat");
  if (likesMore && edge > 0) why.push(`Model sits ${edge.toFixed(1)} above the PrizePicks line`);
  if (!likesMore) caution.push("Projection is close to or on the wrong side of the line");
  if (env.blowoutRisk === "High") caution.push(`Blowout risk ${env.blowoutRisk.toLowerCase()} — game script can scramble volume`);
  env.notes.slice(0, 2).forEach((n) => {
    if (/may shrink|compressed|haircut/i.test(n)) caution.push(n);
    else why.push(n);
  });

  const games = bundle.gameLogs?.length || 0;
  if (games < 3) caution.push(`Only ${games || 0} game${games === 1 ? "" : "s"} in the current sample`);
  if (flags.includes("Transfer")) caution.push("Player changed teams — prior-year stats are a weaker prior");
  if (flags.includes("New Starter")) caution.push("Limited established role");
  if (flags.includes("FCS-Heavy Sample")) caution.push("Sample includes a large share of FCS games");
  if (flags.includes("High Variance")) caution.push("Week-to-week results swing hard");
  if (flags.includes("Missing Data")) caution.push("Some CFBD fields were unavailable");
  if (blend.priorWeight > 0.45 && Number.isFinite(blend.priorAvg)) {
    caution.push("Line is being judged against a prior-stabilized baseline, not raw early-season pace");
  }
  if (pHit < 0.55) caution.push("Edge is modest after uncertainty shrinkage");

  if (!why.length) why.push("Limited positive signal after shrinkage and matchup caps");
  if (!caution.length) caution.push("No single red flag — still treat this as a model estimate, not a lock");

  return { why: why.slice(0, 4), caution: caution.slice(0, 4) };
}

function evaluateFromBundle(bundle, { statId, line, side = "more", marketOdds = null, seed = 20260 } = {}) {
  const def = getPropDef(statId);
  if (!def) {
    const err = new Error("Unknown stat");
    err.code = "BAD_STAT";
    throw err;
  }
  const lineNum = toNum(line);
  if (lineNum == null) {
    const err = new Error("Line must be a number");
    err.code = "BAD_LINE";
    throw err;
  }
  const leanSide = String(side || "more").toLowerCase() === "less" ? "less" : "more";

  const currentLogs = valuesFromLogs(bundle.gameLogs, def.id).map((g) => ({
    ...g,
    oppQuality: opponentQualityForGame(g, bundle),
  }));
  const priorLogs = valuesFromLogs(bundle.priorLogs, def.id);
  const currentValues = currentLogs.map((g) => g.value);
  const priorValues = priorLogs.map((g) => g.value);

  const leagueMean =
    mean(currentValues) ??
    seasonAvgFromOverview(bundle, def) ??
    mean(priorValues);

  const weighted = weightedCurrent(currentLogs, leagueMean);
  currentLogs.forEach((g, i) => {
    g.adjusted = weighted.items[i]?.value ?? g.value;
  });

  const oppEst = estimateOpportunity(bundle, def);
  const role = roleTrend(bundle, def);
  const matchup = matchupAdjustment(bundle, def);
  const env = gameEnvironment(bundle, def, marketOdds);

  const currentAvg =
    weighted.avg ??
    mean(currentValues) ??
    seasonAvgFromOverview(bundle, def);
  const priorAvg = mean(priorValues) ?? priorAvgFromOverview(bundle, def);
  const hasPrior = Number.isFinite(priorAvg);
  const rp = hasPrior ? null : rolePrior(bundle, def, oppEst);

  const blend = blendExpectation({
    current: currentAvg,
    prior: priorAvg,
    rolePrior: rp,
    games: currentValues.length,
    hasPrior,
  });
  blend.priorAvg = priorAvg;
  blend.currentAvg = currentAvg;

  let baseline = blend.value;
  if (!Number.isFinite(baseline) && Number.isFinite(oppEst.rawOppProj)) baseline = oppEst.rawOppProj;
  if (!Number.isFinite(baseline)) {
    const err = new Error(`No ${def.label} sample available`);
    err.code = "NO_STAT_VALUE";
    throw err;
  }

  const usageDelta =
    role.role === "Rising" ? Math.abs(role.deltaPct) * 0.12 * baseline : role.role === "Falling" ? -Math.abs(role.deltaPct) * 0.1 * baseline : 0;

  const oppW = Number.isFinite(oppEst.rawOppProj)
    ? currentSeasonWeight(currentValues.length, { hasPrior }) * 0.35
    : 0;
  const oppBlend =
    Number.isFinite(oppEst.rawOppProj) && Number.isFinite(baseline)
      ? baseline * (1 - oppW) + oppEst.rawOppProj * oppW
      : baseline;

  const afterUsage = oppBlend + usageDelta;
  const matchupDelta = afterUsage * matchup.adjPct;
  const envDelta = afterUsage * env.adjPct;
  const projectionRaw = afterUsage + matchupDelta + envDelta;
  const projection = clamp(projectionRaw, def.floor, def.ceil);

  const sampleSd = stddev(currentValues);
  const priorSd = stddev(priorValues);
  let sd = sampleSd;
  if (!Number.isFinite(sd) || currentValues.length < 4) {
    const mix = [];
    if (Number.isFinite(sampleSd)) mix.push(sampleSd);
    if (Number.isFinite(priorSd)) mix.push(priorSd);
    mix.push(def.priorSd);
    sd = mean(mix);
  }
  const smallN = currentValues.length < 4;
  if (smallN) sd = Math.max(sd, def.priorSd * 1.15);
  if (currentValues.length <= 2) sd = Math.max(sd, def.priorSd * 1.35);
  sd = Math.max(sd, def.priorSd * 0.55);

  const cv = projection > 0 && sd ? sd / projection : 1;
  const extraFlags = [];
  if (cv > 0.55 || (sampleSd && sampleSd > def.priorSd * 1.4)) extraFlags.push("High Variance");
  if (role.role !== "Stable") extraFlags.push("Role Change");
  const flags = collectFlags(bundle, extraFlags);

  const completeness =
    (currentLogs.length ? 0.35 : 0) +
    (priorLogs.length ? 0.2 : 0) +
    (oppEst.rawOppProj ? 0.15 : 0) +
    (matchup.allFactors?.length ? 0.2 : 0) +
    (env.available ? 0.1 : 0.05);

  const conf = confidenceGrade({
    games: currentValues.length,
    priorGames: priorValues.length,
    flags,
    completeness,
    roleStable: role.role === "Stable",
    varianceHigh: flags.includes("High Variance"),
    matchupOk: !matchup.missing,
    transfer: flags.includes("Transfer"),
  });
  const reliability = reliabilityFromConfidence(conf.letter, currentValues.length);

  const sims = simulateOutcomes({
    mean: projection,
    sd,
    dist: def.dist,
    floor: def.floor,
    ceil: def.ceil,
    n: 8000,
    seed,
  });
  const distSummary = summarizeSims(sims);
  const distParams = {
    type: def.dist,
    dist: def.dist,
    mean: projection,
    sd,
    reliability,
    games: currentValues.length,
    floor: def.floor,
    ceil: def.ceil,
  };
  const probs = probabilityAtLine(distParams, lineNum, leanSide);

  const l3 = lastN(currentValues, 3);
  const l5 = lastN(currentValues, 5);
  const mm = minMax(currentValues);
  const hitAll = hitRate(currentValues, lineNum, leanSide !== "less");
  const hitL5 = hitRate(l5, lineNum, leanSide !== "less");
  const hitPrior = hitRate(priorValues, lineNum, leanSide !== "less");

  const consistency = hitAll == null ? 0.45 : 1 - Math.min(0.5, Math.abs(0.5 - hitAll));
  const edge = leanSide === "less" ? lineNum - projection : projection - lineNum;
  const edgeRel = Math.abs(lineNum) > 0.2 ? Math.abs(edge) / Math.abs(lineNum) : Math.abs(edge);
  const scored = propScore({
    pHit: probs.pHit,
    edgeAbs: Math.abs(edge),
    edgeRel,
    confidenceLetter: conf.letter,
    consistency,
    roleStable: role.role === "Stable",
    sampleGames: currentValues.length,
  });

  const narrative = whyAndCaution({
    def,
    bundle,
    projection,
    line: lineNum,
    side: leanSide,
    pHit: probs.pHit,
    flags,
    role,
    matchup,
    env,
    blend: { ...blend, priorAvg },
  });

  const gameLog = buildGameLogRows(currentLogs, lineNum, leanSide);
  const priorLog = buildGameLogRows(priorLogs, lineNum, leanSide);

  const breakdown = [
    { label: "Baseline (shrunk)", value: baseline },
    { label: "Opportunity blend", value: oppBlend - baseline },
    { label: "Recent usage", value: usageDelta },
    { label: "Matchup", value: matchupDelta },
    { label: "Game environment", value: envDelta },
  ].map((row) => ({
    ...row,
    value: Number.isFinite(row.value) ? Number(row.value.toFixed(2)) : 0,
  }));

  return {
    modelVersion: PROP_MODEL_VERSION,
    player: bundle.player,
    opponent: bundle.opponent,
    stat: { id: def.id, label: def.label, short: def.short, category: def.category },
    line: lineNum,
    side: leanSide,
    projection,
    median: distSummary.median,
    range: { p20: distSummary.p20, p80: distSummary.p80 },
    pMore: probs.pMore,
    pLess: probs.pLess,
    pHit: probs.pHit,
    pRaw: probs.pRaw,
    confidence: conf.letter,
    confidenceScore: conf.score,
    propScore: scored.score,
    propScoreLabel: scored.label,
    lean: probs.pHit >= 0.52 ? leanSide : "tossup",
    edge,
    flags,
    form: {
      season: mean(currentValues) ?? seasonAvgFromOverview(bundle, def),
      median: median(currentValues),
      l3: mean(l3),
      l5: mean(l5),
      prior: priorAvg,
      sd: sampleSd,
      high: mm.max,
      low: mm.min,
      hitRate: hitAll,
      hitRateL5: hitL5,
      hitRatePrior: hitPrior,
      games: currentValues.length,
      priorGames: priorValues.length,
    },
    usage: {
      recShare: oppEst.recShare,
      carryShare: oppEst.carryShare,
      attShare: oppEst.attShare,
      recPerGame: bundle.usage?.rec ?? null,
      rushAttPerGame: bundle.usage?.rushAtt ?? null,
      passAttPerGame: bundle.usage?.passAtt ?? null,
      ypr: oppEst.ypr,
      ypc: oppEst.ypc,
      ypa: oppEst.ypa,
      inferred: oppEst.inferred,
      role: role.role,
      roleDetail: role.detail,
      teamVolume: oppEst.teamVolume,
    },
    matchup: {
      adjPct: matchup.adjPct,
      adjYards: matchupDelta,
      factors: matchup.factors,
      note: matchup.note,
      opponent: bundle.opponent,
      percentilePass: matchup.factors?.find((f) => /pass yards/i.test(f.label))?.pct ?? null,
    },
    environment: env,
    breakdown,
    why: narrative.why,
    caution: narrative.caution,
    gameLog,
    priorLog,
    distribution: distParams,
    market: bundle.market || marketOdds || null,
    error: null,
    debug: {
      gamesIncluded: weighted.items,
      currentYearWeight: currentSeasonWeight(currentValues.length, { hasPrior }),
      priorYearWeight: 1 - currentSeasonWeight(currentValues.length, { hasPrior }),
      opportunity: oppEst,
      efficiency: oppEst.efficiency,
      rawProjection: projectionRaw,
      opponentAdjustment: matchup.adjPct,
      gameScriptAdjustment: env.adjPct,
      finalProjection: projection,
      sd,
      dist: def.dist,
      pMore: probs.pMore,
      pRaw: probs.pRaw,
      reliability,
      confidenceInputs: conf.inputs,
      flags,
      apiUsage: bundle.apiUsage || null,
    },
    disclaimer:
      "Educational model only — not betting advice. Probability is not confidence. Early-season samples are shrunk toward priors.",
  };
}

function relineEvaluation(evaluation, line, side) {
  const lineNum = toNum(line);
  if (lineNum == null) throw Object.assign(new Error("Line must be a number"), { code: "BAD_LINE" });
  const leanSide = String(side || evaluation.side || "more").toLowerCase() === "less" ? "less" : "more";
  const dist = evaluation.distribution;
  const probs = probabilityAtLine(dist, lineNum, leanSide);
  const edge = leanSide === "less" ? lineNum - evaluation.projection : evaluation.projection - lineNum;
  const edgeRel = Math.abs(lineNum) > 0.2 ? Math.abs(edge) / Math.abs(lineNum) : Math.abs(edge);
  const scored = propScore({
    pHit: probs.pHit,
    edgeAbs: Math.abs(edge),
    edgeRel,
    confidenceLetter: evaluation.confidence,
    consistency: evaluation.form?.hitRate == null ? 0.45 : 1 - Math.min(0.5, Math.abs(0.5 - evaluation.form.hitRate)),
    roleStable: evaluation.usage?.role === "Stable",
    sampleGames: evaluation.form?.games,
  });
  const values = (evaluation.gameLog || []).map((g) => g.value);
  return {
    ...evaluation,
    line: lineNum,
    side: leanSide,
    pMore: probs.pMore,
    pLess: probs.pLess,
    pHit: probs.pHit,
    pRaw: probs.pRaw,
    edge,
    propScore: scored.score,
    propScoreLabel: scored.label,
    lean: probs.pHit >= 0.52 ? leanSide : "tossup",
    form: {
      ...evaluation.form,
      hitRate: hitRate(values, lineNum, leanSide !== "less"),
      hitRateL5: hitRate(values.slice(-5), lineNum, leanSide !== "less"),
    },
  };
}

module.exports = { evaluateFromBundle, relineEvaluation, valuesFromLogs };
