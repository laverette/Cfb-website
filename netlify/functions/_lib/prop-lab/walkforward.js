/**
 * Walk-forward backtest against an independent data-generating process.
 * The DGP is NOT Model 2.0 — so calibration is a real test, not circular.
 *
 * Splits are by week (never by shuffled games) to block leakage:
 *   TRAIN  weeks 2–6
 *   VAL    weeks 7–9
 *   TEST   weeks 10–14
 *
 * For a projection at week W, only games with week < W are visible.
 */
const { mulberry32, clamp } = require("./math");
const { evaluateFromBundle } = require("./evaluate");
const { extractStatValue } = require("./parse");
const { BACKTEST_STAT_IDS, reportFromRows } = require("./metrics");
const { PROP_MODEL_VERSION } = require("./version");
const { usageFromLogs } = require("./bundle");

const ABLATIONS = {
  full: null,
  no_matchup: { noMatchup: true },
  no_recency: { noRecency: true },
  no_prior_shrinkage: { noPriorShrinkage: true },
  no_gamescript: { noGameScript: true },
  no_calibration: { noCalibration: true },
  raw_season_average: { rawSeasonAverage: true },
};

const SPLITS = {
  train: { weeks: [2, 3, 4, 5, 6], label: "TRAIN weeks 2–6" },
  val: { weeks: [7, 8, 9], label: "VAL weeks 7–9" },
  test: { weeks: [10, 11, 12, 13, 14], label: "TEST weeks 10–14" },
};

function splitName(week) {
  if (SPLITS.train.weeks.includes(week)) return "train";
  if (SPLITS.val.weeks.includes(week)) return "val";
  if (SPLITS.test.weeks.includes(week)) return "test";
  return null;
}

function poisson(rng, lambda) {
  const L = Math.exp(-Math.max(0.01, lambda));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L && k < 25);
  return k - 1;
}

function gauss(rng, mu, sd) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function halfLine(x) {
  if (!Number.isFinite(x)) return 0.5;
  const f = Math.floor(Math.max(0, x));
  return f + 0.5;
}

const OPPONENTS = [
  { name: "Wake Forest", passAllow: 240, rushAllow: 155, quality: 0.42 },
  { name: "Alabama", passAllow: 165, rushAllow: 110, quality: 0.88 },
  { name: "FCS East", passAllow: 310, rushAllow: 220, quality: 0.12, fcs: true },
  { name: "Clemson", passAllow: 185, rushAllow: 125, quality: 0.78 },
  { name: "Duke", passAllow: 230, rushAllow: 160, quality: 0.45 },
  { name: "Ohio State", passAllow: 170, rushAllow: 115, quality: 0.86 },
  { name: "South Florida", passAllow: 255, rushAllow: 175, quality: 0.32 },
  { name: "Florida State", passAllow: 200, rushAllow: 140, quality: 0.62 },
  { name: "Virginia", passAllow: 245, rushAllow: 168, quality: 0.38 },
  { name: "Louisville", passAllow: 210, rushAllow: 148, quality: 0.55 },
  { name: "NC State", passAllow: 225, rushAllow: 152, quality: 0.48 },
  { name: "Georgia Tech", passAllow: 235, rushAllow: 145, quality: 0.5 },
  { name: "Boston College", passAllow: 250, rushAllow: 170, quality: 0.35 },
  { name: "Syracuse", passAllow: 248, rushAllow: 162, quality: 0.4 },
];

function leagueStats() {
  const map = new Map();
  for (const o of OPPONENTS) {
    map.set(o.name.toLowerCase(), {
      passyardsallowed: o.passAllow,
      rushingyardsallowed: o.rushAllow,
    });
  }
  map.set("miami", { passyardsallowed: 205, rushingyardsallowed: 138 });
  return map;
}

function archetypes() {
  return [
    { kind: "wr_vet", n: 10, pos: "WR", stats: ["rec_yds", "rec", "rec_td"], talent: { rec_yds: 76, rec: 5.4, rec_td: 0.5 }, prior: true, rising: false, transfer: false },
    { kind: "wr_frosh", n: 6, pos: "WR", stats: ["rec_yds", "rec", "rec_td"], talent: { rec_yds: 48, rec: 3.6, rec_td: 0.3 }, prior: false, rising: false, transfer: false, freshman: true },
    { kind: "wr_rising", n: 5, pos: "WR", stats: ["rec_yds", "rec", "rec_td"], talent: { rec_yds: 62, rec: 4.4, rec_td: 0.4 }, prior: true, rising: true, transfer: false },
    { kind: "wr_transfer", n: 4, pos: "WR", stats: ["rec_yds", "rec", "rec_td"], talent: { rec_yds: 70, rec: 5.0, rec_td: 0.45 }, prior: true, rising: false, transfer: true },
    { kind: "rb_vet", n: 8, pos: "RB", stats: ["rush_yds", "rush_att", "rush_td"], talent: { rush_yds: 84, rush_att: 16.5, rush_td: 0.75 }, prior: true, rising: false },
    { kind: "rb_change", n: 4, pos: "RB", stats: ["rush_yds", "rush_att", "rush_td"], talent: { rush_yds: 62, rush_att: 12, rush_td: 0.45 }, prior: true, rising: true },
    { kind: "qb_vet", n: 8, pos: "QB", stats: ["pass_yds", "pass_att", "pass_comp", "pass_td", "pass_int"], talent: { pass_yds: 248, pass_att: 33, pass_comp: 20.5, pass_td: 1.85, pass_int: 0.7 }, prior: true, rising: false },
    { kind: "qb_frosh", n: 4, pos: "QB", stats: ["pass_yds", "pass_att", "pass_comp", "pass_td", "pass_int"], talent: { pass_yds: 210, pass_att: 31, pass_comp: 18, pass_td: 1.4, pass_int: 0.95 }, prior: false, rising: false, freshman: true },
  ];
}

function expectedMeans(player, week, opp, spread) {
  const roleBoost = player.rising && week >= 6 ? 1.18 : player.rising && week >= 4 ? 1.08 : 1;
  const matchupPass = 1 + (0.5 - opp.quality) * 0.22;
  const matchupRush = 1 + (0.5 - opp.quality) * 0.18;
  const fav = spread < 0;
  const abs = Math.abs(spread);
  let passScript = 1;
  let rushScript = 1;
  if (fav && abs >= 17) {
    passScript -= clamp((abs - 17) * 0.012, 0, 0.12);
    rushScript += clamp((abs - 17) * 0.01, 0, 0.1);
  }
  if (!fav && abs >= 14) {
    passScript += clamp((abs - 10) * 0.01, 0, 0.1);
    rushScript -= clamp((abs - 10) * 0.008, 0, 0.08);
  }
  const fcsHaircut = opp.fcs ? 1.18 : 1;
  const t = player.talent;
  const exp = {};
  if (t.rec != null) {
    exp.rec = t.rec * roleBoost * matchupPass * passScript * fcsHaircut;
    exp.rec_yds = t.rec_yds * roleBoost * matchupPass * passScript * fcsHaircut;
    exp.rec_td = t.rec_td * roleBoost * matchupPass;
  }
  if (t.rush_att != null) {
    exp.rush_att = t.rush_att * roleBoost * rushScript;
    exp.rush_yds = t.rush_yds * roleBoost * matchupRush * rushScript * fcsHaircut;
    exp.rush_td = t.rush_td * roleBoost * (fav && abs >= 14 ? 1.1 : 1);
  }
  if (t.pass_att != null) {
    exp.pass_att = t.pass_att * passScript;
    exp.pass_comp = t.pass_comp * passScript * (1 + (0.5 - opp.quality) * 0.04);
    exp.pass_yds = t.pass_yds * matchupPass * passScript * fcsHaircut;
    exp.pass_td = t.pass_td * matchupPass;
    exp.pass_int = t.pass_int * (0.85 + opp.quality * 0.4);
  }
  return { exp, passScript, rushScript, matchupPass, matchupRush };
}

function simulateGame(rng, player, week, opp) {
  const spread = gauss(rng, player.favoriteSpread, 6);
  const { exp } = expectedMeans(player, week, opp, spread);
  const stats = {};
  if (exp.rec != null) {
    stats.rec = poisson(rng, exp.rec);
    const ypr = exp.rec_yds / Math.max(exp.rec, 0.5);
    stats.rec_yds = Math.max(0, Math.round(stats.rec * ypr + gauss(rng, 0, 18)));
    stats.rec_td = poisson(rng, exp.rec_td);
  }
  if (exp.rush_att != null) {
    stats.rush_att = Math.max(0, Math.round(gauss(rng, exp.rush_att, 3.2)));
    const ypc = exp.rush_yds / Math.max(exp.rush_att, 1);
    stats.rush_yds = Math.max(0, Math.round(stats.rush_att * ypc + gauss(rng, 0, 22)));
    stats.rush_td = poisson(rng, exp.rush_td);
  }
  if (exp.pass_att != null) {
    stats.pass_att = Math.max(8, Math.round(gauss(rng, exp.pass_att, 5)));
    const compPct = exp.pass_comp / Math.max(exp.pass_att, 1);
    stats.pass_comp = clamp(Math.round(stats.pass_att * compPct + gauss(rng, 0, 1.4)), 0, stats.pass_att);
    const ypa = exp.pass_yds / Math.max(exp.pass_att, 1);
    stats.pass_yds = Math.max(0, Math.round(stats.pass_att * ypa + gauss(rng, 0, 38)));
    stats.pass_td = poisson(rng, exp.pass_td);
    stats.pass_int = poisson(rng, exp.pass_int);
  }

  return {
    week,
    opponent: opp.name,
    isFcs: Boolean(opp.fcs),
    homeAway: rng() > 0.5 ? "home" : "away",
    points: Math.round(clamp(28 + gauss(rng, 0, 10), 3, 62)),
    oppPoints: Math.round(clamp(24 + gauss(rng, 0, 10), 0, 58)),
    stats,
    expected: exp,
    spread,
  };
}

function priorSeason(rng, player) {
  if (!player.prior) return [];
  const logs = [];
  for (let w = 1; w <= 12; w += 1) {
    const opp = OPPONENTS[Math.floor(rng() * (OPPONENTS.length - 1))];
    const g = simulateGame(rng, { ...player, rising: false, talent: scaleTalent(player.talent, 0.92) }, w, opp);
    logs.push(g);
  }
  return logs;
}

function scaleTalent(talent, f) {
  const out = {};
  for (const [k, v] of Object.entries(talent)) out[k] = v * f;
  return out;
}

function buildPlayers(rng) {
  const players = [];
  let id = 1;
  for (const arch of archetypes()) {
    for (let i = 0; i < arch.n; i += 1) {
      players.push({
        id: `p${id++}`,
        name: `${arch.kind.replace(/_/g, " ")} ${i + 1}`,
        team: "Miami",
        position: arch.pos,
        kind: arch.kind,
        stats: arch.stats,
        talent: { ...arch.talent },
        prior: arch.prior,
        rising: arch.rising,
        transfer: arch.transfer,
        freshman: arch.freshman,
        favoriteSpread: gauss(rng, -6, 10),
      });
    }
  }
  return players;
}

function asOfBundle(player, seasonLogs, priorLogs, week, game, league) {
  const past = seasonLogs.filter((g) => g.week < week);
  const flags = [];
  if (past.length < 3) flags.push("Small Sample");
  if (!priorLogs.length) flags.push("Limited History");
  if (player.freshman) flags.push("New Starter");
  if (player.transfer) flags.push("Transfer");
  if (past.filter((g) => g.isFcs).length / Math.max(past.length, 1) >= 0.4) flags.push("FCS-Heavy Sample");
  return {
    player: {
      id: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      year: player.freshman ? "FR" : "JR",
    },
    opponent: {
      name: game.opponent,
      week,
      homeAway: game.homeAway,
      isFcs: game.isFcs,
    },
    gameLogs: past,
    priorLogs,
    currentOverview: { games: past.length, team: player.team, name: player.name, position: player.position },
    priorOverview: priorLogs.length ? { games: priorLogs.length, team: player.transfer ? "Old School" : player.team } : null,
    usage: usageFromLogs(past),
    usageL3: usageFromLogs(past.slice(-3)),
    teamOffense: {
      games: Math.max(past.length, 1),
      passattempts: 32 * Math.max(past.length, 1),
      completions: 20 * Math.max(past.length, 1),
      rushingattempts: 34 * Math.max(past.length, 1),
    },
    teamAdv: { offense: { plays: 66 * Math.max(past.length, 1) } },
    leagueTeamStats: league,
    leagueAdvanced: new Map(),
    flags,
    market: { spread: game.spread, total: 54, source: "synthetic" },
    playerTeamRating: { name: "Miami", rawPower: 8, offenseRating: 6 },
    oppRating: { name: game.opponent, rawPower: (0.5 - (OPPONENTS.find((o) => o.name === game.opponent)?.quality || 0.5)) * 12, defenseRating: 0, ranking: 50 },
  };
}

function evaluateCase(bundle, statId, line, side, ablation, game, player, week) {
  const evaluation = evaluateFromBundle(bundle, {
    statId,
    line,
    side,
    marketOdds: bundle.market,
    skipSims: true,
    ablation,
  });
  const actual = extractStatValue(game.stats, statId);
  const hit = side === "less" ? actual < line : actual > line;
  return {
    modelVersion: PROP_MODEL_VERSION,
    playerId: player.id,
    playerName: player.name,
    kind: player.kind,
    statId,
    week,
    split: splitName(week),
    line,
    side,
    actual,
    projection: evaluation.projection,
    error: actual - evaluation.projection,
    pHit: evaluation.pHit,
    z: evaluation.modelDebug?.z ?? null,
    dist: evaluation.distribution?.dist ?? null,
    hit,
    confidence: evaluation.confidence,
    propScore: evaluation.propScore,
    sampleGames: evaluation.form?.games ?? 0,
    spread: game.spread,
    role: evaluation.usage?.role || "Stable",
    favorite: game.spread < 0,
  };
}

function runWalkForward({ seed = 20260, ablations = Object.keys(ABLATIONS) } = {}) {
  const rng = mulberry32(seed);
  const league = leagueStats();
  const players = buildPlayers(rng);
  const byAblation = {};

  for (const name of ablations) {
    byAblation[name] = [];
  }

  for (const player of players) {
    const priorLogs = priorSeason(rng, player);
    const seasonLogs = [];
    for (let week = 1; week <= 14; week += 1) {
      const opp = OPPONENTS[(week + Number(player.id.slice(1))) % OPPONENTS.length];
      const game = simulateGame(rng, player, week, opp);
      seasonLogs.push(game);
      if (!splitName(week)) continue;
      const bundle = asOfBundle(player, seasonLogs, priorLogs, week, game, league);
      if (!bundle.gameLogs.length && !bundle.priorLogs.length) continue;

      for (const statId of player.stats) {
        const preGame = game.expected?.[statId];
        if (preGame == null && extractStatValue(game.stats, statId) == null) continue;
        const noisy = (preGame != null ? preGame : extractStatValue(game.stats, statId)) * (0.96 + rng() * 0.08);
        const line = halfLine(noisy);
        const side = rng() < 0.78 ? "more" : "less";
        for (const name of ablations) {
          try {
            const row = evaluateCase(bundle, statId, line, side, ABLATIONS[name], game, player, week);
            row.ablation = name;
            byAblation[name].push(row);
          } catch {
            /* skip empty samples */
          }
        }
      }
    }
  }

  const tagged = (rows, ablation) =>
    rows.map((r) => ({ ...r, ablation }));

  const reports = {};
  for (const [name, rows] of Object.entries(byAblation)) {
    const bySplit = { train: [], val: [], test: [] };
    for (const r of rows) {
      if (bySplit[r.split]) bySplit[r.split].push(r);
    }
    reports[name] = {
      all: reportFromRows(tagged(rows, name)),
      train: reportFromRows(bySplit.train),
      val: reportFromRows(bySplit.val),
      test: reportFromRows(bySplit.test),
      n: rows.length,
    };
  }

  return {
    modelVersion: PROP_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    rows: byAblation,
    protocol: {
      dgp: "independent synthetic CFB seasons; Model 2.0 is not the data generator",
      asOf: "projection at week W uses only games with week < W plus prior season",
      splits: SPLITS,
      seed,
      ablations: Object.keys(ABLATIONS),
      stats: BACKTEST_STAT_IDS,
      note: "Ablation ranking uses VAL only. Official 2.0.0 calibration is TEST. Parameters were not fit on any split.",
    },
    reports,
  };
}

function ablationDelta(reports, split = "val") {
  const full = reports.full?.[split]?.overall;
  if (!full) return [];
  const rows = [];
  for (const [name, rep] of Object.entries(reports)) {
    if (name === "full") continue;
    const o = rep[split]?.overall;
    if (!o) continue;
    rows.push({
      ablation: name,
      n: o.n,
      mae: o.mae,
      maeDeltaVsFull: o.mae != null && full.mae != null ? o.mae - full.mae : null,
      brier: o.brier,
      brierDeltaVsFull: o.brier != null && full.brier != null ? o.brier - full.brier : null,
      ece: o.calibrationError,
      eceDeltaVsFull:
        o.calibrationError != null && full.calibrationError != null
          ? o.calibrationError - full.calibrationError
          : null,
      hitRate: o.hitRate,
      predicted: o.predictedProbability,
    });
  }
  rows.sort((a, b) => (b.maeDeltaVsFull || 0) - (a.maeDeltaVsFull || 0));
  return rows;
}

module.exports = {
  ABLATIONS,
  SPLITS,
  splitName,
  runWalkForward,
  ablationDelta,
  leagueStats,
};
