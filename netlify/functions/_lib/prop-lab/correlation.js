const RELATIONSHIPS = [
  {
    id: "same_player_rec_yds_rec",
    a: ["rec_yds"],
    b: ["rec"],
    samePlayer: true,
    corr: 0.72,
    sign: "positive",
    label: "Same player receptions and receiving yards move together",
    explanation: "More receptions generally increase receiving-yard opportunity.",
  },
  {
    id: "same_player_rec_yds_td",
    a: ["rec_yds", "rec"],
    b: ["rec_td"],
    samePlayer: true,
    corr: 0.38,
    sign: "positive",
    label: "Same player receiving yards/receptions and receiving TDs",
    explanation: "Both benefit from higher passing volume and a strong receiving game.",
  },
  {
    id: "same_player_rush_pair",
    a: ["rush_yds"],
    b: ["rush_att"],
    samePlayer: true,
    corr: 0.7,
    sign: "positive",
    label: "Same player rushing yards and attempts are tightly linked",
    explanation: "Rushing yards are mostly a function of carry volume.",
  },
  {
    id: "same_player_rush_long_yards",
    a: ["rush_long"],
    b: ["rush_yds"],
    samePlayer: true,
    corr: 0.62,
    sign: "positive",
    label: "Same player longest rush and rushing yards move together",
    explanation: "A long breakaway run is usually a large share of the day's rushing total.",
  },
  {
    id: "same_player_rush_long_att",
    a: ["rush_long"],
    b: ["rush_att"],
    samePlayer: true,
    corr: 0.4,
    sign: "positive",
    label: "Same player longest rush and carries are related",
    explanation: "More carries mean more chances to break one, though the effect fades as volume grows.",
  },
  {
    id: "same_player_pass_long",
    a: ["pass_long"],
    b: ["pass_yds", "pass_comp"],
    samePlayer: true,
    corr: 0.55,
    sign: "positive",
    label: "Same QB longest completion moves with passing volume",
    explanation: "A chunk play is usually a large share of that day's passing yards.",
  },
  {
    id: "same_player_rec_long",
    a: ["rec_long"],
    b: ["rec_yds", "rec"],
    samePlayer: true,
    corr: 0.58,
    sign: "positive",
    label: "Same player longest reception moves with receiving volume",
    explanation: "A deep catch often drives both the long and the yardage total.",
  },
  {
    id: "same_player_kicking_xp",
    a: ["xp_made"],
    b: ["kicking_pts", "fg_made"],
    samePlayer: true,
    corr: 0.55,
    sign: "positive",
    label: "Same kicker PATs move with scoring volume",
    explanation: "Extra points track touchdowns; kicking points include both FGs and PATs.",
  },
  {
    id: "same_player_pass_pair",
    a: ["pass_yds"],
    b: ["pass_att", "pass_comp"],
    samePlayer: true,
    corr: 0.68,
    sign: "positive",
    label: "Same-player passing volume stats are highly related",
    explanation: "Attempts, completions, and passing yards share the same dropback volume.",
  },
  {
    id: "qb_wr_yards",
    a: ["pass_yds", "pass_comp"],
    b: ["rec_yds", "rec"],
    sameOffense: true,
    corr: 0.42,
    sign: "positive",
    label: "QB passing volume and WR receiving volume often rise together",
    explanation: "Both benefit from higher passing volume.",
  },
  {
    id: "qb_wr_td",
    a: ["pass_td"],
    b: ["rec_td"],
    sameOffense: true,
    corr: 0.4,
    sign: "positive",
    label: "QB pass TDs and WR receiving TDs are positively related",
    explanation: "Receiving TDs are a subset of passing TDs on the same offense.",
  },
  {
    id: "rb_qb_script",
    a: ["rush_att", "rush_yds"],
    b: ["pass_att", "pass_yds"],
    sameOffense: true,
    corr: -0.28,
    sign: "negative",
    label: "RB rushing volume and QB passing volume can compete for script",
    explanation: "These can compete for offensive volume depending on game script.",
  },
  {
    id: "same_player_combo",
    a: ["rec_yds", "rush_yds"],
    b: ["rush_rec_yds"],
    samePlayer: true,
    corr: 0.8,
    sign: "positive",
    label: "Combo yardage props share outcomes with the component stats",
    explanation: "The combo line is the sum of the component yardage outcomes.",
  },
  {
    id: "same_player_kicking",
    a: ["fg_made"],
    b: ["kicking_pts"],
    samePlayer: true,
    corr: 0.75,
    sign: "positive",
    label: "Same kicker field goals and kicking points move together",
    explanation: "Kicking points are mostly field goals plus extra points from the same scoring drives.",
  },
];

const { legCaption, sideLabel } = require("./format");

function pairCategory(sign, strength) {
  const dir = sign === "negative" ? "NEGATIVE" : "POSITIVE";
  const mag = strength === "high" ? "HIGH" : strength === "moderate" ? "MODERATE" : "LOW";
  return `${mag} ${dir}`;
}

function pairStrength(corr) {
  const a = Math.abs(corr);
  if (a >= 0.55) return "high";
  if (a >= 0.28) return "moderate";
  return "low";
}

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

  const hist = historicalCorrFromLogs(legA.gameLog, legB.gameLog);
  let source = "heuristic";
  let heuristic = true;
  let historicalR = null;
  if (hist != null && Number.isFinite(hist) && (legA.gameLog || []).length >= 5 && (legB.gameLog || []).length >= 5) {
    historicalR = Number(hist.toFixed(2));
    corr = hist;
    sign = hist < 0 ? "negative" : "positive";
    source = "historical";
    heuristic = false;
    if ((legA.side === "less") !== (legB.side === "less")) {
      corr = -corr;
      sign = corr < 0 ? "negative" : "positive";
    }
  }
  const strength = pairStrength(corr);
  const explanation =
    rel?.explanation ||
    (samePlayer
      ? "Same player — both outcomes share usage, game script, and injury/DNP risk."
      : "Heuristic relationship based on game environment.");
  const aCap = `${legA.player?.name || "Player"} ${legA.stat?.short || sa} ${sideLabel(legA.side)}`;
  const bCap = `${legB.player?.name || "Player"} ${legB.stat?.short || sb} ${sideLabel(legB.side)}`;
  return {
    a: legA.clientId || `${legA.player?.id}:${sa}:${legA.line}:${legA.side}`,
    b: legB.clientId || `${legB.player?.id}:${sb}:${legB.line}:${legB.side}`,
    names: [legA.player?.name, legB.player?.name],
    stats: [legA.stat?.short || sa, legB.stat?.short || sb],
    aCaption: aCap,
    bCaption: bCap,
    pairLabel: `${aCap} ↔ ${bCap}`,
    bucket,
    corr: Number(corr.toFixed(3)),
    historicalR,
    sign,
    label,
    explanation,
    source,
    heuristic,
    category: pairCategory(sign, strength),
    strength,
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
