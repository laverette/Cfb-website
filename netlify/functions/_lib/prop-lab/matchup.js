const { clamp, percentileRank, mean, zScore, toNum } = require("./math");
const { lookupTeamMap } = require("./parse");

function collect(map, pathFn) {
  const vals = [];
  if (!map) return vals;
  for (const v of map.values()) {
    const n = pathFn(v);
    if (Number.isFinite(n)) vals.push(n);
  }
  return vals;
}

function statNum(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const n = toNum(obj[k]);
    if (n != null) return n;
  }
  return null;
}

function defenseSnapshot(bundle, oppKey) {
  const stats = lookupTeamMap(bundle.leagueTeamStats, oppKey) || bundle.oppDefense || {};
  const adv = lookupTeamMap(bundle.leagueAdvanced, oppKey) || bundle.oppAdv;
  const ppa = bundle.oppPpa;
  const defPpa = ppa?.defense || ppa;
  return {
    passYds: statNum(stats, ["passyardsallowed", "netpassingyardsallowed", "passingyardsallowed"]),
    rushYds: statNum(stats, ["rushingyardsallowed"]),
    ypa: statNum(stats, ["yardsperpassallowed", "passingyardsperattemptallowed"]),
    ypc: statNum(stats, ["yardsperrushallowed", "rushingyardsaverageallowed"]),
    passTd: statNum(stats, ["passingtdsallowed", "passingtouchdownsallowed"]),
    rushTd: statNum(stats, ["rushingtdsallowed", "rushingtouchdownsallowed"]),
    sacks: statNum(stats, ["sacks"]),
    ppaPass: toNum(defPpa?.passingPPA ?? defPpa?.passing?.ppa ?? adv?.defense?.passingPlays?.ppa),
    ppaRush: toNum(defPpa?.rushingPPA ?? adv?.defense?.rushingPlays?.ppa),
    successPass: toNum(adv?.defense?.passingPlays?.successRate),
    successRush: toNum(adv?.defense?.rushingPlays?.successRate),
    explosivenessPass: toNum(adv?.defense?.passingPlays?.explosiveness),
    explosivenessRush: toNum(adv?.defense?.rushingPlays?.explosiveness),
    havoc: toNum(adv?.defense?.havoc?.total),
    stuffRate: toNum(adv?.defense?.stuffRate),
    ranking: bundle.oppRating?.ranking ?? null,
    rawPower: bundle.oppRating?.rawPower ?? null,
    defenseRating: bundle.oppRating?.defenseRating ?? null,
  };
}

function leaguePools(bundle) {
  const statsMap = bundle.leagueTeamStats;
  const advMap = bundle.leagueAdvanced;
  return {
    passYds: collect(statsMap, (t) => statNum(t, ["passyardsallowed", "netpassingyardsallowed"])),
    rushYds: collect(statsMap, (t) => statNum(t, ["rushingyardsallowed"])),
    ppaPass: collect(advMap, (t) => toNum(t.defense?.passingPlays?.ppa)),
    ppaRush: collect(advMap, (t) => toNum(t.defense?.rushingPlays?.ppa)),
    explosivenessPass: collect(advMap, (t) => toNum(t.defense?.passingPlays?.explosiveness)),
    explosivenessRush: collect(advMap, (t) => toNum(t.defense?.rushingPlays?.explosiveness)),
    stuffRate: collect(advMap, (t) => toNum(t.defense?.stuffRate)),
    havoc: collect(advMap, (t) => toNum(t.defense?.havoc?.total)),
  };
}

function factor(value, pool, { invert = false, cap = 0.12 } = {}) {
  if (!Number.isFinite(value) || !pool?.length) return { z: 0, pct: null, adj: 0, used: false };
  const z = zScore(value, pool);
  const pct = percentileRank(value, pool);
  const signed = invert ? -z : z;
  // Higher allowed yards → easier matchup for offense (positive adj)
  const adj = clamp(signed * 0.045, -cap, cap);
  return { z, pct, adj, used: true, value, mean: mean(pool) };
}

/**
 * Prop-specific matchup. Caps prevent a single noisy defensive stat from dominating.
 */
function matchupAdjustment(bundle, def) {
  const opp = bundle.opponent?.name;
  const snap = defenseSnapshot(bundle, opp);
  const pools = leaguePools(bundle);
  const factors = [];
  let missing = 0;

  if (def.family === "passing" || def.family === "qb" || def.id === "rec_yds" || def.id === "rec" || def.id === "rec_td") {
    factors.push({
      label: "Pass yards allowed",
      ...factor(snap.passYds, pools.passYds, { cap: 0.1 }),
    });
    factors.push({
      label: "Pass PPA/EPA allowed",
      ...factor(snap.ppaPass, pools.ppaPass, { cap: 0.08 }),
    });
    factors.push({
      label: "Explosive passes allowed",
      ...factor(snap.explosivenessPass, pools.explosivenessPass, { cap: 0.07 }),
    });
  }
  if (def.family === "rushing" || def.id === "rush_rec_yds" || def.id === "pass_rush_yds") {
    factors.push({
      label: "Rush yards allowed",
      ...factor(snap.rushYds, pools.rushYds, { cap: 0.1 }),
    });
    factors.push({
      label: "Rush PPA allowed",
      ...factor(snap.ppaRush, pools.ppaRush, { cap: 0.08 }),
    });
    factors.push({
      label: "Stuff rate",
      ...factor(snap.stuffRate, pools.stuffRate, { invert: true, cap: 0.06 }),
    });
  }

  if (def.family === "receiving") {
    // One WR does not inherit the full team pass-defense adjustment.
    for (const f of factors) f.adj *= 0.55;
  }

  const used = factors.filter((f) => f.used);
  if (!used.length) {
    missing += 1;
    if (Number.isFinite(snap.defenseRating) && Number.isFinite(bundle.playerTeamRating?.offenseRating)) {
      const gap = bundle.playerTeamRating.offenseRating - snap.defenseRating;
      const adj = clamp(gap / 80, -0.08, 0.08);
      used.push({
        label: "Team offense vs defense rating",
        adj,
        pct: null,
        used: true,
        fallback: true,
      });
    } else if (Number.isFinite(bundle.playerTeamRating?.rawPower) && Number.isFinite(snap.rawPower)) {
      const gap = bundle.playerTeamRating.rawPower - snap.rawPower;
      const adj = clamp(gap / 90, -0.07, 0.07);
      used.push({
        label: "Power ranking gap (capped)",
        adj,
        pct: null,
        used: true,
        fallback: true,
      });
    }
  }

  const rawSum = used.reduce((s, f) => s + f.adj, 0);
  const adjPct = clamp(rawSum, -0.14, 0.14);
  const top = used
    .slice()
    .sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj))
    .slice(0, 3);

  return {
    adjPct,
    yardsDelta: null,
    factors: top,
    allFactors: used,
    snapshot: snap,
    missing: used.length === 0,
    note:
      used.length === 0
        ? "Matchup data incomplete — adjustment withheld rather than guessed."
        : `Opponent adjustment capped at ${(adjPct * 100).toFixed(1)}%.`,
  };
}

function opponentQualityForGame(game, bundle) {
  if (game.isFcs) return 0.15;
  const name = game.opponent;
  const rating = bundle.oppRating && name === bundle.opponent?.name ? bundle.oppRating : null;
  const stats = lookupTeamMap(bundle.leagueTeamStats, name);
  const passAllow = stats ? statNum(stats, ["passyardsallowed", "netpassingyardsallowed"]) : null;
  const pool = [];
  if (bundle.leagueTeamStats) {
    for (const v of bundle.leagueTeamStats.values()) {
      const n = statNum(v, ["passyardsallowed", "netpassingyardsallowed"]);
      if (n != null) pool.push(n);
    }
  }
  if (passAllow != null && pool.length) {
    const pct = percentileRank(passAllow, pool);
    return clamp(1 - pct, 0, 1);
  }
  if (rating?.ranking) {
    return clamp(1 - (Number(rating.ranking) - 1) / 130, 0, 1);
  }
  return 0.5;
}

module.exports = {
  matchupAdjustment,
  defenseSnapshot,
  opponentQualityForGame,
};
