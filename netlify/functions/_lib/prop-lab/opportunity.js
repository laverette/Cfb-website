const { mean, toNum, clamp } = require("./math");
const { extractStatValue } = require("./parse");
const { fantasyScoreFromStats } = require("./definitions");

function num(v, fallback = null) {
  const n = toNum(v);
  return n == null ? fallback : n;
}

function teamVolume(bundle) {
  const off = bundle.teamOffense || {};
  const adv = bundle.teamAdv?.offense || {};
  const games = Math.max(1, Number(off.games) || bundle.gameLogs?.length || 1);
  const passAtt = num(off.passattempts ?? off["passingattempts"] ?? off.attempts);
  const rushAtt = num(off.rushingattempts ?? off["rushattempts"]);
  const completions = num(off.completions ?? off.passcompletions);
  const plays = num(adv.plays) || (passAtt != null && rushAtt != null ? passAtt + rushAtt : null);
  return {
    games,
    passAttPerGame: passAtt != null ? passAtt / games : null,
    rushAttPerGame: rushAtt != null ? rushAtt / games : null,
    completionsPerGame: completions != null ? completions / games : null,
    playsPerGame: plays != null ? plays / games : null,
    passRate:
      plays && passAtt != null ? passAtt / Math.max(plays, 1) : passAtt != null && rushAtt != null
        ? passAtt / Math.max(passAtt + rushAtt, 1)
        : null,
  };
}

function playerAverages(logs, statId) {
  const values = (logs || [])
    .map((g) => (statId ? extractStatValue(g.stats || {}, statId) : g.value))
    .filter((n) => Number.isFinite(n));
  return {
    games: values.length,
    avg: mean(values),
    values,
  };
}

function share(playerPerGame, teamPerGame) {
  if (!Number.isFinite(playerPerGame) || !Number.isFinite(teamPerGame) || teamPerGame <= 0) {
    return null;
  }
  return clamp(playerPerGame / teamPerGame, 0, 1);
}

/** Euler–Mascheroni — used for H_n ≈ ln(n) + γ + 1/(2n). */
const EULER_GAMMA = 0.5772156649015329;

/** Blend weights for max-stat clear probability (model vs empirical). */
const MAX_CLEAR_MODEL_W = 0.55;
const MAX_CLEAR_EMP_W = 0.45;
/** Pseudo-counts for Beta shrink of empirical clear rate toward 0.5. */
const MAX_CLEAR_EMP_PSEUDO = 4;

/**
 * Harmonic number H_n (supports fractional n via digamma approximation).
 * For exponential touch lengths, E[max of n] = θ · H_n.
 */
function harmonicNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x < 1) return x;
  if (x > 40 || x !== Math.floor(x)) {
    return Math.log(x) + EULER_GAMMA + 1 / (2 * x);
  }
  let h = 0;
  for (let i = 1; i <= x; i++) h += 1 / i;
  return h;
}

/**
 * Fit per-touch exponential scale θ from per-game long / H_volume.
 * Falls back to yards-per-touch when the long sample is thin.
 */
function fitLongestTheta({ logs, volumeKey, longKey, ypx } = {}) {
  const thetas = [];
  for (const g of logs || []) {
    const vol = Number(g.stats?.[volumeKey]);
    const lng = Number(g.stats?.[longKey]);
    if (!(vol > 0) || !(lng > 0)) continue;
    const h = harmonicNumber(vol);
    if (h > 0) thetas.push(lng / h);
  }
  if (thetas.length >= 2) {
    return { theta: mean(thetas), games: thetas.length, source: "logs" };
  }
  if (thetas.length === 1) {
    const t = thetas[0];
    if (Number.isFinite(ypx) && ypx > 0) {
      return { theta: 0.6 * t + 0.4 * ypx, games: 1, source: "logs+ypx" };
    }
    return { theta: t, games: 1, source: "logs" };
  }
  if (Number.isFinite(ypx) && ypx > 0) {
    return { theta: ypx, games: 0, source: "ypx" };
  }
  return { theta: null, games: 0, source: null };
}

/**
 * Expected max under exponential touch lengths: θ · H_n'.
 * Falls back to avg-long / H_hist · H_proj, then ypx · H_proj.
 */
function longestStatProjection({
  base,
  histVolume,
  projVolume,
  ypx,
  floorFactor = 1.6,
  logs,
  volumeKey,
  longKey,
} = {}) {
  const proj = Number.isFinite(projVolume) && projVolume > 0 ? projVolume : histVolume;
  if (!Number.isFinite(proj) || proj <= 0) return null;

  if (volumeKey && longKey) {
    const fitted = fitLongestTheta({ logs, volumeKey, longKey, ypx });
    if (Number.isFinite(fitted.theta) && fitted.theta > 0) {
      return fitted.theta * harmonicNumber(proj);
    }
  }

  if (Number.isFinite(base) && base > 0 && Number.isFinite(histVolume) && histVolume > 0) {
    const theta = base / Math.max(harmonicNumber(histVolume), 0.5);
    return theta * harmonicNumber(proj);
  }

  if (Number.isFinite(ypx) && ypx > 0) {
    return ypx * Math.max(harmonicNumber(proj), floorFactor);
  }
  return null;
}

function longestRushProjection({ usage, opportunity, rushAtt, ypc, logs }) {
  return longestStatProjection({
    base: usage?.rushLong,
    histVolume: rushAtt,
    projVolume: opportunity,
    ypx: ypc,
    floorFactor: 1.6,
    logs,
    volumeKey: "rush_att",
    longKey: "rush_long",
  });
}

function longestPassProjection({ usage, opportunity, passComp, ypa, logs }) {
  const hist = Number.isFinite(usage?.passComp) && usage.passComp > 0 ? usage.passComp : usage?.passAtt;
  return longestStatProjection({
    base: usage?.passLong,
    histVolume: Number.isFinite(passComp) && passComp > 0 ? passComp : hist,
    projVolume: opportunity,
    ypx: ypa,
    floorFactor: 2.4,
    logs,
    volumeKey: Number.isFinite(passComp) && passComp > 0 ? "pass_comp" : "pass_att",
    longKey: "pass_long",
  });
}

function longestRecProjection({ usage, opportunity, recAvg, ypr, logs }) {
  return longestStatProjection({
    base: usage?.recLong,
    histVolume: recAvg,
    projVolume: opportunity,
    ypx: ypr,
    floorFactor: 2.1,
    logs,
    volumeKey: "rec",
    longKey: "rec_long",
  });
}

/** Map longest prop id → box-score volume / long keys + efficiency field. */
function longestVolumeKeys(statId) {
  switch (String(statId || "")) {
    case "rec_long":
      return { volumeKey: "rec", longKey: "rec_long", ypxField: "ypr" };
    case "rush_long":
      return { volumeKey: "rush_att", longKey: "rush_long", ypxField: "ypc" };
    case "pass_long":
      return { volumeKey: "pass_comp", longKey: "pass_long", ypxField: "ypa", volumeKeyAlt: "pass_att" };
    default:
      return null;
  }
}

function empiricLongClears(logs, volumeKey, longKey, line, volumeKeyAlt) {
  let clears = 0;
  let games = 0;
  for (const g of logs || []) {
    let vol = Number(g.stats?.[volumeKey]);
    if (!(vol > 0) && volumeKeyAlt) vol = Number(g.stats?.[volumeKeyAlt]);
    const lng = Number(g.stats?.[longKey] ?? g.value);
    if (!(vol > 0) || !Number.isFinite(lng)) continue;
    games += 1;
    if (lng > line) clears += 1;
  }
  return { clears, games };
}

/**
 * Volume-aware P(max > line) for longest props, blended with empirical clears.
 * Touch lengths ~ Exp(θ) ⇒ P(max > L) = 1 − (1 − e^{−L/θ})^n'.
 */
function longestClearProbability({
  logs,
  priorLogs,
  line,
  projVolume,
  volumeKey,
  longKey,
  volumeKeyAlt,
  ypx,
} = {}) {
  const L = Number(line);
  const n = Number(projVolume);
  if (!Number.isFinite(L)) {
    return {
      pMore: 0.5,
      pLess: 0.5,
      modelP: null,
      empP: 0.5,
      theta: null,
      projVolume: n,
      expectedMax: null,
      empGames: 0,
      empClears: 0,
      source: null,
    };
  }

  let fitted = fitLongestTheta({ logs, volumeKey, longKey, ypx });
  if (!Number.isFinite(fitted.theta) && volumeKeyAlt) {
    fitted = fitLongestTheta({ logs, volumeKey: volumeKeyAlt, longKey, ypx });
  }
  if (!Number.isFinite(fitted.theta)) {
    fitted = fitLongestTheta({ logs: priorLogs, volumeKey, longKey, ypx });
  }
  if (!Number.isFinite(fitted.theta) && volumeKeyAlt) {
    fitted = fitLongestTheta({
      logs: priorLogs,
      volumeKey: volumeKeyAlt,
      longKey,
      ypx,
    });
  }

  let modelP = null;
  if (Number.isFinite(fitted.theta) && fitted.theta > 0 && Number.isFinite(n) && n > 0) {
    const pTouchLe = 1 - Math.exp(-Math.max(L, 0) / fitted.theta);
    modelP = clamp(1 - Math.pow(clamp(pTouchLe, 0, 1), n), 0.02, 0.98);
  }

  const cur = empiricLongClears(logs, volumeKey, longKey, L, volumeKeyAlt);
  const pri = empiricLongClears(priorLogs, volumeKey, longKey, L, volumeKeyAlt);
  const clears = cur.clears + 0.35 * pri.clears;
  const games = cur.games + 0.35 * pri.games;
  const empP = clamp(
    (clears + MAX_CLEAR_EMP_PSEUDO * 0.5) / (games + MAX_CLEAR_EMP_PSEUDO),
    0.05,
    0.95
  );

  const pMore = clamp(
    Number.isFinite(modelP)
      ? MAX_CLEAR_MODEL_W * modelP + MAX_CLEAR_EMP_W * empP
      : empP,
    0.05,
    0.95
  );
  const expectedMax =
    Number.isFinite(fitted.theta) && fitted.theta > 0 && Number.isFinite(n) && n > 0
      ? fitted.theta * harmonicNumber(n)
      : null;

  return {
    pMore,
    pLess: 1 - pMore,
    modelP,
    empP,
    theta: fitted.theta,
    projVolume: Number.isFinite(n) ? n : null,
    expectedMax,
    empGames: cur.games,
    empClears: cur.clears,
    source: fitted.source,
  };
}

/**
 * Opportunity × efficiency. Inferred shares are labeled as estimates.
 */
function estimateOpportunity(bundle, def) {
  const vol = teamVolume(bundle);
  const logs = bundle.gameLogs || [];
  const usage = bundle.usage || {};
  const inferred = [];

  const recAvg = usage.rec;
  const recYds = usage.recYds;
  const rushAtt = usage.rushAtt;
  const rushYds = usage.rushYds;
  const passAtt = usage.passAtt;
  const passYds = usage.passYds;

  const recShare = share(recAvg, vol.completionsPerGame);
  const carryShare = share(rushAtt, vol.rushAttPerGame);
  const attShare = share(passAtt, vol.passAttPerGame);

  if (recShare != null) inferred.push("receiving share estimated from receptions / team completions");
  if (carryShare != null) inferred.push("carry share estimated from rushes / team rush attempts");

  const ypr = recAvg > 0 && recYds != null ? recYds / recAvg : null;
  const ypc = rushAtt > 0 && rushYds != null ? rushYds / rushAtt : null;
  const ypa = passAtt > 0 && passYds != null ? passYds / passAtt : null;
  const compPct =
    passAtt > 0 && usage.passAtt
      ? (logs.reduce((s, g) => s + (g.stats?.pass_comp || 0), 0) / logs.length) / passAtt
      : null;

  let opportunity = null;
  let efficiency = null;
  let rawOppProj = null;

  if (def.family === "receiving") {
    opportunity = recAvg;
    efficiency = def.id === "rec" ? 1 : ypr;
    if (vol.completionsPerGame && recShare != null) {
      opportunity = vol.completionsPerGame * recShare;
    }
    rawOppProj =
      def.id === "rec"
        ? opportunity
        : def.id === "rec_td"
          ? (opportunity || 0) * (usage.recTd && recAvg ? usage.recTd / recAvg : 0.08)
          : def.id === "rec_long"
            ? longestRecProjection({ usage, opportunity, recAvg, ypr, logs })
            : opportunity != null && efficiency != null
              ? opportunity * efficiency
              : null;
    if (def.id === "rec_long") efficiency = ypr;
  } else if (def.family === "rushing") {
    opportunity = rushAtt;
    efficiency = def.id === "rush_att" ? 1 : ypc;
    if (vol.rushAttPerGame && carryShare != null) {
      opportunity = vol.rushAttPerGame * carryShare;
    }
    rawOppProj =
      def.id === "rush_att"
        ? opportunity
        : def.id === "rush_td"
          ? (opportunity || 0) * (usage.rushTd && rushAtt ? usage.rushTd / rushAtt : 0.05)
          : def.id === "rush_long"
            ? longestRushProjection({ usage, opportunity, rushAtt, ypc, logs })
            : opportunity != null && efficiency != null
              ? opportunity * efficiency
              : null;
    if (def.id === "rush_long") efficiency = ypc;
  } else if (def.family === "passing" || def.family === "qb") {
    opportunity = passAtt;
    if (vol.passAttPerGame && attShare != null) opportunity = vol.passAttPerGame * Math.min(attShare, 1.05);
    if (def.id === "pass_yds" || def.id === "pass_rush_yds") efficiency = ypa;
    if (def.id === "pass_comp") efficiency = compPct;
    if (def.id === "pass_att") efficiency = 1;
    const passComp =
      Number.isFinite(usage.passComp) && usage.passComp > 0
        ? usage.passComp
        : opportunity != null && Number.isFinite(compPct)
          ? opportunity * compPct
          : null;
    const longOpp =
      def.id === "pass_long"
        ? Number.isFinite(passComp) && passComp > 0
          ? passComp
          : opportunity != null && Number.isFinite(compPct)
            ? opportunity * Math.max(compPct, 0.55)
            : opportunity
        : opportunity;
    rawOppProj =
      def.id === "pass_att"
        ? opportunity
        : def.id === "pass_td"
          ? (opportunity || 0) * (usage.passTd && passAtt ? usage.passTd / passAtt : 0.045)
          : def.id === "pass_int"
            ? (opportunity || 0) *
              (passAtt > 0 && Number.isFinite(usage.passInt) ? usage.passInt / passAtt : 0.02)
            : def.id === "pass_long"
              ? longestPassProjection({
                  usage,
                  opportunity: longOpp,
                  passComp,
                  ypa,
                  logs,
                })
              : opportunity != null && efficiency != null
                ? opportunity * efficiency
                : null;
    if (def.id === "pass_long") {
      opportunity = longOpp;
      efficiency = ypa;
    }
  } else if (def.id === "rush_rec_yds") {
    const rushPart =
      rushAtt != null && ypc != null ? (carryShare && vol.rushAttPerGame ? vol.rushAttPerGame * carryShare : rushAtt) * ypc : rushYds;
    const recPart =
      recAvg != null && ypr != null
        ? (recShare && vol.completionsPerGame ? vol.completionsPerGame * recShare : recAvg) * ypr
        : recYds;
    rawOppProj = (rushPart || 0) + (recPart || 0);
    opportunity = (rushAtt || 0) + (recAvg || 0);
    efficiency = opportunity ? rawOppProj / opportunity : null;
  } else if (def.id === "total_td") {
    rawOppProj = (usage.passTd || 0) + (usage.rushTd || 0) + (usage.recTd || 0);
    opportunity = rawOppProj;
    efficiency = 1;
  } else if (def.id === "fantasy_score") {
    const passYdsProj =
      passAtt != null && ypa != null
        ? (attShare && vol.passAttPerGame ? vol.passAttPerGame * Math.min(attShare, 1.05) : passAtt) * ypa
        : passYds;
    const rushYdsProj =
      rushAtt != null && ypc != null
        ? (carryShare && vol.rushAttPerGame ? vol.rushAttPerGame * carryShare : rushAtt) * ypc
        : rushYds;
    const recYdsProj =
      recAvg != null && ypr != null
        ? (recShare && vol.completionsPerGame ? vol.completionsPerGame * recShare : recAvg) * ypr
        : recYds;
    const recProj =
      recShare && vol.completionsPerGame ? vol.completionsPerGame * recShare : recAvg;
    const passTdRate = passAtt > 0 && usage.passTd ? usage.passTd / passAtt : 0.045;
    const rushTdRate = rushAtt > 0 && usage.rushTd ? usage.rushTd / rushAtt : 0.05;
    const recTdRate = recAvg > 0 && usage.recTd ? usage.recTd / recAvg : 0.08;
    const passOpp =
      attShare && vol.passAttPerGame ? vol.passAttPerGame * Math.min(attShare, 1.05) : passAtt;
    const rushOpp =
      carryShare && vol.rushAttPerGame ? vol.rushAttPerGame * carryShare : rushAtt;
    rawOppProj = fantasyScoreFromStats({
      pass_yds: passYdsProj,
      pass_td: passOpp != null ? passOpp * passTdRate : usage.passTd,
      pass_int: usage.passInt,
      rush_yds: rushYdsProj,
      rush_td: rushOpp != null ? rushOpp * rushTdRate : usage.rushTd,
      rec: recProj,
      rec_yds: recYdsProj,
      rec_td: recProj != null ? recProj * recTdRate : usage.recTd,
    });
    opportunity = (passOpp || 0) + (rushOpp || 0) + (recProj || 0);
    efficiency = opportunity && rawOppProj != null ? rawOppProj / opportunity : null;
  } else if (def.family === "kicking") {
    const fgMade = usage.fgMade;
    const fgAtt = usage.fgAtt;
    const kickingPts = usage.kickingPts;
    const xpMade = usage.xpMade;
    if (def.id === "fg_made") {
      opportunity = Number.isFinite(fgAtt) && fgAtt > 0 ? fgAtt : fgMade;
      efficiency =
        Number.isFinite(fgAtt) && fgAtt > 0 && Number.isFinite(fgMade) ? fgMade / fgAtt : 1;
      rawOppProj =
        Number.isFinite(fgMade)
          ? fgMade
          : opportunity != null && efficiency != null
            ? opportunity * efficiency
            : null;
    } else if (def.id === "xp_made") {
      opportunity = xpMade;
      efficiency = 1;
      rawOppProj = xpMade;
    } else {
      opportunity = kickingPts;
      efficiency = 1;
      rawOppProj = kickingPts;
    }
  }

  return {
    teamVolume: vol,
    recShare,
    carryShare,
    attShare,
    ypr,
    ypc,
    ypa,
    opportunity,
    efficiency,
    rawOppProj: Number.isFinite(rawOppProj) && rawOppProj > 0 ? rawOppProj : null,
    inferred: inferred.length > 0,
    inferredNotes: inferred,
  };
}

function roleTrend(bundle, def) {
  const season = bundle.usage;
  const l3 = bundle.usageL3;
  if (!season || !l3 || season.games < 2 || l3.games < 2) {
    return { role: "Stable", deltaPct: 0, detail: "Not enough games to read a role shift." };
  }
  let seasonU = null;
  let recentU = null;
  if (def.family === "receiving") {
    seasonU = season.rec;
    recentU = l3.rec;
  } else if (def.family === "rushing") {
    seasonU = season.rushAtt;
    recentU = l3.rushAtt;
  } else if (def.family === "kicking") {
    seasonU =
      def.id === "fg_made" ? season.fgMade : def.id === "xp_made" ? season.xpMade : season.kickingPts;
    recentU = def.id === "fg_made" ? l3.fgMade : def.id === "xp_made" ? l3.xpMade : l3.kickingPts;
  } else if (def.family === "fantasy" || def.id === "fantasy_score") {
    seasonU = (season.passAtt || 0) + (season.rushAtt || 0) + (season.rec || 0);
    recentU = (l3.passAtt || 0) + (l3.rushAtt || 0) + (l3.rec || 0);
  } else {
    seasonU = season.passAtt;
    recentU = l3.passAtt;
  }
  if (!Number.isFinite(seasonU) || seasonU <= 0 || !Number.isFinite(recentU)) {
    return { role: "Stable", deltaPct: 0, detail: "Usage not available." };
  }
  const deltaPct = (recentU - seasonU) / seasonU;
  let role = "Stable";
  if (deltaPct >= 0.15) role = "Rising";
  else if (deltaPct <= -0.15) role = "Falling";
  const signed = `${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct * 100)}%`;
  return {
    role,
    deltaPct,
    detail:
      role === "Rising"
        ? `↑ Usage ${signed} over last ${l3.games}`
        : role === "Falling"
          ? `↓ Usage ${signed} over last ${l3.games}`
          : `Usage steady (${signed} last ${l3.games})`,
  };
}

module.exports = {
  teamVolume,
  estimateOpportunity,
  roleTrend,
  playerAverages,
  harmonicNumber,
  fitLongestTheta,
  longestStatProjection,
  longestRushProjection,
  longestPassProjection,
  longestRecProjection,
  longestVolumeKeys,
  longestClearProbability,
};
