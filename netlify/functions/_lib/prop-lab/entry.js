const { clamp, mean } = require("./math");
const { analyzeCorrelations } = require("./correlation");

function letterFromAvg(score) {
  if (score >= 82) return "A-";
  if (score >= 76) return "B+";
  if (score >= 70) return "B";
  if (score >= 64) return "B-";
  if (score >= 56) return "C+";
  if (score >= 48) return "C";
  return "D";
}

function riskLabel(legs, pairs) {
  const avgScore = mean(legs.map((l) => l.propScore)) || 50;
  const weak = Math.min(...legs.map((l) => l.propScore || 0));
  const highCorr = pairs.filter((p) => p.strength === "high").length;
  const sameGame = new Set(
    legs
      .map((l) => [l.player?.team, l.opponent?.name].filter(Boolean).sort().join(" vs "))
      .filter(Boolean)
  );
  let risk = "Moderate";
  if (legs.length >= 5 && (weak < 58 || highCorr >= 2)) risk = "High";
  if (legs.length >= 6 && weak < 55 && highCorr >= 1) risk = "Very High";
  if (avgScore >= 74 && weak >= 64 && highCorr === 0) risk = "Low";
  if (sameGame.size === 1 && legs.length >= 3) {
    if (risk === "Low") risk = "Moderate";
    else if (risk === "Moderate") risk = "High";
  }
  return risk;
}

function analyzeEntry(legs) {
  const ok = (legs || []).filter((l) => l && !l.error);
  if (!ok.length) {
    return {
      grade: null,
      avgScore: null,
      weakest: null,
      strongest: null,
      risk: null,
      correlations: [],
      note: "No evaluated legs yet.",
    };
  }
  const ranked = ok.slice().sort((a, b) => (b.propScore || 0) - (a.propScore || 0));
  const pairs = analyzeCorrelations(ok);
  const avgScore = mean(ok.map((l) => l.propScore));
  const highCorrPenalty = pairs.filter((p) => p.strength === "high").length * 3;
  const gradeScore = clamp((avgScore || 50) - highCorrPenalty, 22, 92);

  return {
    grade: letterFromAvg(gradeScore),
    avgScore: Math.round(avgScore),
    weakest: ranked[ranked.length - 1],
    strongest: ranked[0],
    risk: riskLabel(ok, pairs),
    correlations: pairs,
    entryStrength: clamp(Math.round(gradeScore), 20, 92),
    note:
      "Entry Strength is not a parlay probability. Legs are correlated; we do not multiply hit rates.",
  };
}

function comboScore(subset, allPairs) {
  const avg = mean(subset.map((l) => l.propScore)) || 0;
  const ids = new Set(subset.map((l) => l.clientId || l.player?.id + l.stat?.id));
  let corrPen = 0;
  for (const p of allPairs) {
    const a = subset.find((l) => (l.clientId || l.player?.id) === p.a || l.player?.name === p.names?.[0]);
    const b = subset.find((l) => (l.clientId || l.player?.id) === p.b || l.player?.name === p.names?.[1]);
    if (!a || !b) continue;
    if (p.strength === "high") corrPen += 6;
    else if (p.strength === "moderate" && p.sign === "positive") corrPen += 2.5;
    else if (p.sign === "negative") corrPen += 1.5;
  }
  const samePlayer = new Map();
  for (const l of subset) {
    const k = String(l.player?.id);
    samePlayer.set(k, (samePlayer.get(k) || 0) + 1);
  }
  let playerPen = 0;
  for (const n of samePlayer.values()) {
    if (n > 1) playerPen += (n - 1) * 4;
  }
  const weakest = Math.min(...subset.map((l) => l.propScore || 0));
  return avg - corrPen - playerPen + Math.min(4, (weakest - 55) * 0.15);
}

function combinations(arr, k) {
  const out = [];
  const n = arr.length;
  const rec = (start, combo) => {
    if (combo.length === k) {
      out.push(combo.slice());
      return;
    }
    for (let i = start; i < n; i += 1) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  };
  rec(0, []);
  return out;
}

function bestN(legs, n = 4) {
  const ok = (legs || []).filter((l) => l && !l.error);
  const k = Math.min(n, ok.length);
  if (!k) return { keep: [], cut: [], reason: "No legs to optimize." };
  const pairs = analyzeCorrelations(ok);
  let best = null;
  let bestScore = -Infinity;
  for (const combo of combinations(ok, k)) {
    const s = comboScore(combo, pairs);
    if (s > bestScore) {
      bestScore = s;
      best = combo;
    }
  }
  const keepIds = new Set(best.map((l) => l.clientId || `${l.player?.id}:${l.stat?.id}:${l.line}`));
  const keep = best.slice().sort((a, b) => (b.propScore || 0) - (a.propScore || 0));
  const cut = ok.filter((l) => !keepIds.has(l.clientId || `${l.player?.id}:${l.stat?.id}:${l.line}`));
  const weakestCut = cut.slice().sort((a, b) => (a.propScore || 0) - (b.propScore || 0))[0];
  const reasonParts = [];
  if (weakestCut) {
    reasonParts.push(
      `${weakestCut.player?.name || "A cut leg"} has a lower Prop Score (${weakestCut.propScore}) with ${weakestCut.confidence} confidence.`
    );
    if ((weakestCut.form?.games || 0) < 3) reasonParts.push("Sample is thin.");
    if ((weakestCut.flags || []).includes("High Variance")) reasonParts.push("Variance is elevated.");
  }
  const droppedCorr = pairs.filter((p) => {
    const inKeep = keep.some((l) => l.player?.name === p.names?.[0]) && keep.some((l) => l.player?.name === p.names?.[1]);
    return !inKeep && p.strength !== "weak";
  });
  if (droppedCorr.length) {
    reasonParts.push("The cut also reduces correlated same-game / same-player exposure.");
  }
  return {
    n: k,
    keep,
    cut,
    reason: reasonParts.join(" ") || `Kept the ${k} legs with the best score/correlation mix.`,
  };
}

function compareLegs(legs) {
  const rows = (legs || []).filter(Boolean).map((l) => ({
    player: l.player?.name,
    team: l.player?.team,
    prop: l.stat?.short || l.stat?.label,
    line: l.line,
    side: l.side,
    projection: l.projection,
    edge: l.edge,
    pHit: l.pHit,
    hitL5: l.form?.hitRateL5,
    matchup: l.matchup?.adjPct,
    confidence: l.confidence,
    propScore: l.propScore,
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

module.exports = { analyzeEntry, bestN, compareLegs };
