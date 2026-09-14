const RELATIONSHIPS = [
  {
    id: "same_player_rec_yds_rec",
    a: ["rec_yds"],
    b: ["rec"],
    samePlayer: true,
    corr: 0.72,
    sign: "positive",
    label: "Same player receptions and receiving yards move together",
  },
  {
    id: "same_player_rush_pair",
    a: ["rush_yds"],
    b: ["rush_att"],
    samePlayer: true,
    corr: 0.7,
    sign: "positive",
    label: "Same player rushing yards and attempts are tightly linked",
  },
  {
    id: "same_player_pass_pair",
    a: ["pass_yds"],
    b: ["pass_att", "pass_comp"],
    samePlayer: true,
    corr: 0.68,
    sign: "positive",
    label: "Same-player passing volume stats are highly related",
  },
  {
    id: "qb_wr_yards",
    a: ["pass_yds", "pass_comp"],
    b: ["rec_yds", "rec"],
    sameOffense: true,
    corr: 0.42,
    sign: "positive",
    label: "QB passing volume and WR receiving volume often rise together",
  },
  {
    id: "qb_wr_td",
    a: ["pass_td"],
    b: ["rec_td"],
    sameOffense: true,
    corr: 0.4,
    sign: "positive",
    label: "QB pass TDs and WR receiving TDs are positively related",
  },
  {
    id: "rb_qb_script",
    a: ["rush_att", "rush_yds"],
    b: ["pass_att", "pass_yds"],
    sameOffense: true,
    corr: -0.28,
    sign: "negative",
    label: "RB rushing volume and QB passing volume can compete for script",
  },
  {
    id: "same_player_combo",
    a: ["rec_yds", "rush_yds"],
    b: ["rush_rec_yds"],
    samePlayer: true,
    corr: 0.8,
    sign: "positive",
    label: "Combo yardage props share outcomes with the component stats",
  },
];

function sameTeam(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function classifyPair(legA, legB) {
  const samePlayer = String(legA.player?.id) === String(legB.player?.id);
  const sameOffense = sameTeam(legA.player?.team, legB.player?.team);
  const oppA = legA.opponent?.name;
  const oppB = legB.opponent?.name;
  const sameGame =
    sameOffense ||
    (oppA && sameTeam(oppA, legB.player?.team)) ||
    (oppB && sameTeam(oppB, legA.player?.team));
  const opposing = sameGame && !sameOffense;

  let bucket = "unrelated";
  if (samePlayer) bucket = "same_player";
  else if (sameOffense) bucket = "same_offense";
  else if (opposing) bucket = "opposing_teams";
  else if (sameGame) bucket = "same_game";

  const sa = String(legA.stat?.id || "");
  const sb = String(legB.stat?.id || "");
  let rel = null;
  for (const r of RELATIONSHIPS) {
    const hit =
      (r.a.includes(sa) && r.b.includes(sb)) || (r.a.includes(sb) && r.b.includes(sa));
    if (!hit) continue;
    if (r.samePlayer && !samePlayer) continue;
    if (r.sameOffense && !sameOffense) continue;
    rel = r;
    break;
  }

  let corr = 0;
  let label = null;
  let sign = null;
  if (rel) {
    corr = rel.corr;
    label = rel.label;
    sign = rel.sign;
  } else if (samePlayer) {
    corr = 0.35;
    label = "Same player — outcomes share game environment";
    sign = "positive";
  } else if (sameOffense && /pass|rec/.test(sa) && /pass|rec/.test(sb)) {
    corr = 0.22;
    label = "Same offense passing/receiving environment";
    sign = "positive";
  } else if (sameGame) {
    corr = 0.12;
    label = "Same game script can nudge both legs";
    sign = "positive";
  }

  if (legA.side === "less" || legB.side === "less") {
    if (legA.side !== legB.side && corr > 0) {
      corr = -corr;
      sign = "negative";
    }
  }

  return {
    a: legA.clientId || legA.player?.id,
    b: legB.clientId || legB.player?.id,
    names: [legA.player?.name, legB.player?.name],
    stats: [legA.stat?.short || sa, legB.stat?.short || sb],
    bucket,
    corr,
    sign,
    label,
    strength: Math.abs(corr) >= 0.55 ? "high" : Math.abs(corr) >= 0.28 ? "moderate" : "weak",
  };
}

function analyzeCorrelations(legs) {
  const pairs = [];
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const p = classifyPair(legs[i], legs[j]);
      if (Math.abs(p.corr) >= 0.12) pairs.push(p);
    }
  }
  pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
  return pairs;
}

function historicalCorrFromLogs(logA, logB, keyA, keyB) {
  const byWeek = new Map();
  for (const g of logA || []) {
    if (g.week == null || !Number.isFinite(g.stats?.[keyA] ?? g.value)) continue;
    byWeek.set(g.week, { a: g.stats?.[keyA] ?? g.value });
  }
  const xs = [];
  const ys = [];
  for (const g of logB || []) {
    const row = byWeek.get(g.week);
    const b = g.stats?.[keyB] ?? g.value;
    if (!row || !Number.isFinite(b)) continue;
    xs.push(row.a);
    ys.push(b);
  }
  if (xs.length < 5) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx < 1e-6 || dy < 1e-6) return null;
  return num / Math.sqrt(dx * dy);
}

module.exports = {
  classifyPair,
  analyzeCorrelations,
  historicalCorrFromLogs,
  RELATIONSHIPS,
  pairKey,
};
