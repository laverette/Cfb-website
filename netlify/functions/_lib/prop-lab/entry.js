const { clamp, mean } = require("./math");
const { analyzeCorrelations } = require("./correlation");
const { legCaption, compactLegCaption } = require("./format");
const { jointAllHit } = require("./joint");
const {
  entryValue,
  conservativePHit,
  realisticPassRate,
  decorateTogetherPassRate,
  modelRiskDiscount,
} = require("./value");

function letterFromAvg(score) {
  if (score >= 82) return "A-";
  if (score >= 76) return "B+";
  if (score >= 70) return "B";
  if (score >= 64) return "B-";
  if (score >= 56) return "C+";
  if (score >= 48) return "C";
  return "D";
}

function confRank(letter) {
  return { A: 8, "A-": 7, "B+": 6, B: 5, "B-": 4, "C+": 3, C: 2, D: 1 }[letter] || 3;
}

function isHighCorr(p) {
  return p.strength === "high";
}

function playerKey(l) {
  return String(l.player?.id || l.player?.name || "");
}

function gameKey(l) {
  return [l.player?.team, l.opponent?.name].filter(Boolean).sort().join(" vs ");
}

function summarizeRisk(legs, pairs) {
  const drivers = [];
  const byPlayer = new Map();
  for (const l of legs) {
    const k = playerKey(l);
    byPlayer.set(k, (byPlayer.get(k) || 0) + 1);
  }
  const maxSamePlayer = Math.max(0, ...byPlayer.values());
  const samePlayerGroups = [...byPlayer.values()].filter((n) => n >= 2).length;
  if (maxSamePlayer >= 3) drivers.push(`${maxSamePlayer} legs from same player`);
  else if (maxSamePlayer === 2) drivers.push("2 legs from same player");

  const highCorr = pairs.filter(isHighCorr).length;
  const modCorr = pairs.filter((p) => p.strength === "moderate").length;
  if (highCorr) drivers.push(`${highCorr} high-correlation pair${highCorr === 1 ? "" : "s"}`);
  if (modCorr >= 2) drivers.push(`${modCorr} moderate-correlation pairs`);

  const games = new Set(legs.map(gameKey).filter(Boolean));
  if (games.size === 1 && legs.length >= 3) drivers.push("All legs share the same game");

  const small = legs.filter((l) => (l.form?.games || 0) < 3 || (l.flags || []).includes("Small Sample")).length;
  if (small === legs.length && legs.length) drivers.push("all legs have limited 2026 sample");
  else if (small >= 2) drivers.push(`${small} small-sample legs`);

  const fcs = legs.filter((l) => (l.flags || []).includes("FCS-Heavy Sample")).length;
  if (fcs) drivers.push(`${fcs} FCS-heavy sample${fcs === 1 ? "" : "s"}`);

  const td = legs.filter((l) => /td/i.test(l.stat?.id || "")).length;
  if (td >= 2) drivers.push(`${td} touchdown props`);

  const hv = legs.filter((l) => (l.flags || []).includes("High Variance")).length;
  if (hv) drivers.push(`${hv} high-variance prop${hv === 1 ? "" : "s"}`);

  const avgScore = mean(legs.map((l) => l.propScore)) || 50;
  const avgConf = mean(legs.map((l) => confRank(l.confidence))) || 3;
  const weak = Math.min(...legs.map((l) => l.propScore || 0));

  let risk = "Moderate";
  if (avgConf <= 2 && (highCorr >= 1 || maxSamePlayer >= 3 || small === legs.length)) risk = "High";
  if (legs.length >= 5 && (weak < 58 || highCorr >= 2 || maxSamePlayer >= 3)) risk = "High";
  if (legs.length >= 6 && weak < 55 && highCorr >= 1) risk = "Very High";
  if (maxSamePlayer >= 3 && highCorr >= 1) risk = "High";
  if (avgScore >= 74 && weak >= 64 && highCorr === 0 && maxSamePlayer <= 1 && avgConf >= 4) risk = "Low";
  if (games.size === 1 && legs.length >= 3 && risk === "Low") risk = "Moderate";

  return { risk, drivers: drivers.slice(0, 5), maxSamePlayer, highCorr, avgConf };
}

function analyzeEntry(legs, opts = {}) {
  const ok = (legs || []).filter((l) => l && !l.error);
  if (!ok.length) {
    return {
      grade: null,
      avgScore: null,
      weakest: null,
      strongest: null,
      strongestLabel: null,
      weakestLabel: null,
      risk: null,
      riskDrivers: [],
      correlations: [],
      together: null,
      value: null,
      note: "No evaluated legs yet.",
    };
  }
  const ranked = ok.slice().sort((a, b) => (b.propScore || 0) - (a.propScore || 0));
  const pairs = analyzeCorrelations(ok);
  const avgScore = mean(ok.map((l) => l.propScore));
  const weakest = ranked[ranked.length - 1];
  const strongest = ranked[0];
  const weakGap = (avgScore || 50) - (weakest.propScore || 0);
  const riskInfo = summarizeRisk(ok, pairs);
  const confPenalty = Math.max(0, 4 - riskInfo.avgConf) * 2.5;
  const corrPenalty = riskInfo.highCorr * 4 + pairs.filter((p) => p.strength === "moderate").length * 1.5;
  const concPenalty = Math.max(0, riskInfo.maxSamePlayer - 1) * 3;
  const gradeScore = clamp((avgScore || 50) - weakGap * 0.35 - corrPenalty - concPenalty - confPenalty, 22, 92);
  const strength = clamp(
    Math.round((avgScore || 50) - corrPenalty * 0.7 - concPenalty * 0.8 - confPenalty * 0.4 - weakGap * 0.2),
    20,
    92
  );

  const togetherModel = jointAllHit(ok, pairs);
  const conservative = ok.map((l) => ({ ...l, pHit: conservativePHit(l) }));
  const togetherConservative = jointAllHit(conservative, pairs) || togetherModel;
  const pass = realisticPassRate(togetherConservative?.p ?? togetherModel?.p, {
    risk: riskInfo.risk,
    entryStrength: strength,
    riskDrivers: riskInfo.drivers,
    avgConf: riskInfo.avgConf,
    weakestScore: weakest?.propScore,
    modelDiscount: modelRiskDiscount(),
  });
  const together = decorateTogetherPassRate(togetherModel, pass);
  return {
    grade: letterFromAvg(gradeScore),
    gradeInputs: {
      avgScore: Math.round(avgScore),
      weakestPenalty: Number((weakGap * 0.35).toFixed(1)),
      correlationPenalty: Number(corrPenalty.toFixed(1)),
      concentrationPenalty: concPenalty,
      confidencePenalty: Number(confPenalty.toFixed(1)),
    },
    avgScore: Math.round(avgScore),
    weakest,
    strongest,
    strongestLabel: compactLegCaption(strongest),
    weakestLabel: compactLegCaption(weakest),
    strongestCaption: legCaption(strongest),
    weakestCaption: legCaption(weakest),
    risk: riskInfo.risk,
    riskPercent: pass?.riskPercent ?? null,
    safetyPercent: pass?.safetyPercent ?? null,
    riskDrivers: riskInfo.drivers,
    correlations: pairs,
    entryStrength: strength,
    together,
    value: entryValue({
      legs: ok,
      pairs,
      together,
      risk: riskInfo.risk,
      payout: opts.payout ?? opts.odds,
      entryStrength: strength,
      riskDrivers: riskInfo.drivers,
      avgConf: riskInfo.avgConf,
      weakestScore: weakest?.propScore,
    }),
    note: "Entry Strength is a relative quality score. Pass rate is the realistic chance every listed leg cashes after risk and bet safety — not the raw model product.",
    strengthTooltip:
      "A relative score based on leg quality, model confidence, correlation, and concentration. It is not the probability that every leg hits.",
  };
}

function legKey(l) {
  return l.clientId || `${l.player?.id}:${l.stat?.id}:${l.line}:${l.side}`;
}

function comboScore(subset, allPairs, mode = "balanced") {
  const avg = mean(subset.map((l) => l.propScore)) || 0;
  const ids = new Set(subset.map(legKey));
  let corrPen = 0;
  for (const p of allPairs) {
    if (!ids.has(p.a) || !ids.has(p.b)) continue;
    if (p.strength === "high") corrPen += mode === "upside" ? 3.5 : mode === "risk" ? 9 : 6;
    else if (p.strength === "moderate" && p.sign === "positive") corrPen += mode === "upside" ? 1 : mode === "risk" ? 4 : 2.5;
    else if (p.sign === "negative") corrPen += 1.5;
  }
  const samePlayer = new Map();
  const sameTeam = new Map();
  const sameGame = new Map();
  for (const l of subset) {
    samePlayer.set(playerKey(l), (samePlayer.get(playerKey(l)) || 0) + 1);
    const team = String(l.player?.team || "");
    if (team) sameTeam.set(team, (sameTeam.get(team) || 0) + 1);
    const gk = gameKey(l);
    if (gk) sameGame.set(gk, (sameGame.get(gk) || 0) + 1);
  }
  let playerPen = 0;
  for (const n of samePlayer.values()) {
    if (n > 1) playerPen += (n - 1) * (mode === "risk" ? 7 : 4);
  }
  let teamPen = 0;
  for (const n of sameTeam.values()) {
    if (n > 2) teamPen += (n - 2) * 2;
  }
  let gamePen = 0;
  for (const n of sameGame.values()) {
    if (n > 2) gamePen += (n - 2) * 2.5;
  }
  const weakest = Math.min(...subset.map((l) => l.propScore || 0));
  const avgConf = mean(subset.map((l) => confRank(l.confidence))) || 3;
  const varPen = subset.filter((l) => (l.flags || []).includes("High Variance") || /td/i.test(l.stat?.id || "")).length * (mode === "risk" ? 2.5 : 1);
  const confBoost = mode === "risk" ? (avgConf - 3) * 2 : (avgConf - 3) * 0.8;
  const upside = mode === "upside" ? mean(subset.map((l) => (l.pHit || 0.5) * 20)) : 0;
  return avg - corrPen - playerPen - teamPen - gamePen - varPen + confBoost + upside + Math.min(4, (weakest - 55) * 0.15);
}

function combinations(arr, k) {
  const out = [];
  const rec = (start, combo) => {
    if (combo.length === k) {
      out.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  };
  rec(0, []);
  return out;
}

function explainBestN(keep, cut, pairs, mode) {
  const parts = [];
  const keepIds = new Set(keep.map(legKey));
  const droppedHigh = pairs.filter((p) => p.strength === "high" && (!keepIds.has(p.a) || !keepIds.has(p.b)));
  const keptIndependent = keep.filter((l) => {
    return !pairs.some((p) => p.strength === "high" && (p.a === legKey(l) || p.b === legKey(l)) && keepIds.has(p.a) && keepIds.has(p.b));
  });
  if (keptIndependent.length) {
    parts.push(`keeps ${keptIndependent.length} higher-quality independent leg${keptIndependent.length === 1 ? "" : "s"}`);
  }
  if (droppedHigh.length) {
    parts.push(`removes ${droppedHigh.length} highly correlated pair${droppedHigh.length === 1 ? "" : "s"}`);
  }
  const cutSame = cut.find((l) => keep.some((k) => playerKey(k) === playerKey(l)));
  if (cutSame) parts.push(`cuts a same-player prop (${legCaption(cutSame)})`);
  const cutHv = cut.find((l) => (l.flags || []).includes("High Variance") || /td/i.test(l.stat?.id || ""));
  if (cutHv && mode !== "upside") parts.push("lowers overall variance");
  if (!parts.length) parts.push(`Kept the ${keep.length} legs with the best ${mode} mix of score, confidence, and correlation.`);
  return parts;
}

function explainCut(leg, keep, pairs, mode) {
  const key = legKey(leg);
  const keepIds = new Set(keep.map(legKey));
  const pair = pairs.find(
    (p) => p.strength === "high" && ((p.a === key && keepIds.has(p.b)) || (p.b === key && keepIds.has(p.a)))
  );
  if (pair) {
    const otherKey = pair.a === key ? pair.b : pair.a;
    const other = keep.find((k) => legKey(k) === otherKey);
    return `High correlation with ${legCaption(other || { player: { name: "a kept leg" } })}.`;
  }
  const same = keep.find((k) => playerKey(k) === playerKey(leg) && playerKey(leg));
  if (same) return `Same player as ${legCaption(same)} — keeping the stronger prop.`;
  if (mode !== "upside" && ((leg.flags || []).includes("High Variance") || /td/i.test(leg.stat?.id || ""))) {
    return "Cut to lower overall variance versus the kept set.";
  }
  return `Weaker ${mode} mix of score, confidence, and correlation than the kept legs.`;
}

function bestN(legs, n = 4, mode = "balanced") {
  const ok = (legs || []).filter((l) => l && !l.error);
  const k = Math.min(n, ok.length);
  if (!k) return { keep: [], cut: [], reason: "No legs to optimize.", why: [], mode };
  const pairs = analyzeCorrelations(ok);
  let best = null;
  let bestScore = -Infinity;
  for (const combo of combinations(ok, k)) {
    const s = comboScore(combo, pairs, mode);
    if (s > bestScore) {
      bestScore = s;
      best = combo;
    }
  }
  const keepIds = new Set(best.map(legKey));
  const keep = best.slice().sort((a, b) => (b.propScore || 0) - (a.propScore || 0));
  const cut = ok.filter((l) => !keepIds.has(legKey(l))).map((l) => ({
    ...l,
    cutReason: explainCut(l, keep, pairs, mode),
  }));
  const why = explainBestN(keep, cut, pairs, mode);
  const keepPairs = analyzeCorrelations(keep);
  return {
    n: k,
    mode,
    keep,
    cut,
    why,
    together: jointAllHit(keep, keepPairs),
    reason: why.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("; ") + ".",
  };
}

function compareLegs(legs) {
  const rows = (legs || []).filter(Boolean).map((l) => ({
    player: l.player?.name,
    team: l.player?.team,
    prop: l.stat?.short || l.stat?.label,
    line: l.line,
    side: l.side,
    caption: legCaption(l),
    projection: l.projection,
    edge: l.edge,
    pHit: l.pHit,
    hitL5: l.form?.hitRateL5,
    matchup: l.matchup?.headline || l.matchup?.adjPct,
    confidence: l.confidence,
    propScore: l.propScore,
    propScoreLabel: l.propScoreLabel,
    clientId: l.clientId,
  }));
  const bestScore = Math.max(...rows.map((r) => r.propScore || 0), 0);
  const bestP = Math.max(...rows.map((r) => r.pHit || 0), 0);
  const bestEdge = Math.max(...rows.map((r) => r.edge || -999), -999);
  return {
    rows,
    highlight: {
      propScore: rows.filter((r) => r.propScore === bestScore).map((r) => r.clientId),
      pHit: rows.filter((r) => r.pHit === bestP).map((r) => r.clientId),
      edge: rows.filter((r) => r.edge === bestEdge).map((r) => r.clientId),
    },
  };
}

module.exports = { analyzeEntry, bestN, compareLegs, comboScore, summarizeRisk, jointAllHit };
