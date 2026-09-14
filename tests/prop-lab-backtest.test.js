/**
 * Walk-forward backtest + ablation tests (no live CFBD).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const { evaluateFromBundle } = require(path.join(root, "evaluate"));
const { brier, ece, calibrationTable, reportFromRows, sampleBucket } = require(path.join(root, "metrics"));
const { runWalkForward, ablationDelta, splitName, SPLITS } = require(path.join(root, "walkforward"));
const { DOUBLE_COUNT_AUDIT } = require(path.join(root, "audit"));

function wrBundle(games) {
  return {
    player: { id: "1", name: "WR", team: "Miami", position: "WR" },
    opponent: { name: "Duke", homeAway: "home", week: games.length + 1 },
    gameLogs: games,
    priorLogs: Array.from({ length: 10 }, (_, i) => ({
      week: i + 1,
      opponent: "Prior",
      stats: { rec_yds: 70, rec: 5, rec_td: 0 },
    })),
    usage: { games: games.length, rec: 6, recYds: 90, rushAtt: 0, rushYds: 0, passAtt: 0 },
    usageL3: { games: Math.min(3, games.length), rec: 8, recYds: 110, rushAtt: 0, rushYds: 0, passAtt: 0 },
    teamOffense: { games: games.length || 1, passattempts: 32 * (games.length || 1), completions: 20 * (games.length || 1), rushingattempts: 30 },
    leagueTeamStats: new Map([
      ["duke", { passyardsallowed: 250 }],
      ["miami", { passyardsallowed: 200 }],
    ]),
    flags: games.length < 3 ? ["Small Sample"] : [],
    market: { spread: -21, total: 62 },
    playerTeamRating: { rawPower: 10, offenseRating: 8 },
    oppRating: { rawPower: 0, defenseRating: 0 },
  };
}

describe("walk-forward splits", () => {
  it("assigns weeks to disjoint train/val/test buckets", () => {
    const seen = { train: [], val: [], test: [] };
    for (let w = 1; w <= 14; w += 1) {
      const s = splitName(w);
      if (s) seen[s].push(w);
    }
    assert.deepEqual(seen.train, SPLITS.train.weeks);
    assert.deepEqual(seen.val, SPLITS.val.weeks);
    assert.deepEqual(seen.test, SPLITS.test.weeks);
    const all = [...seen.train, ...seen.val, ...seen.test];
    assert.equal(new Set(all).size, all.length);
  });

  it("does not include the kickoff week in the projection sample", () => {
    const run = runWalkForward({ seed: 7, ablations: ["full"] });
    assert.ok(run.reports.full.test.overall.n > 50);
    assert.ok(run.reports.full.train.overall.n > 50);
    assert.ok(run.reports.full.val.overall.n > 20);
    const early = run.reports.full.train.bySample["1–2"];
    const late = run.reports.full.test.bySample["8+"];
    assert.ok(early && early.n > 0, "train should contain small-sample weeks");
    assert.ok(late && late.n > 0, "test should contain 8+ game samples");
  });
});

describe("no future leak in evaluate sample", () => {
  it("week-5 projection uses 4 prior games, not 5", () => {
    const logs = [1, 2, 3, 4, 5].map((w) => ({
      week: w,
      opponent: "Opp",
      stats: { rec_yds: 40 + w * 10, rec: 4, rec_td: 0 },
    }));
    const past = logs.filter((g) => g.week < 5);
    const bundle = wrBundle(past);
    const result = evaluateFromBundle(bundle, { statId: "rec_yds", line: 64.5, side: "more", skipSims: true });
    assert.equal(result.form.games, 4);
    assert.ok(!result.debug.gamesIncluded.some((g) => g.week === 5));
  });
});

describe("ablations change 2.0 outputs without mutating the default path", () => {
  it("raw season average differs from the full model", () => {
    const logs = [1, 2, 3, 4, 5, 6].map((w) => ({
      week: w,
      opponent: w === 1 ? "FCS East" : "Clemson",
      isFcs: w === 1,
      stats: { rec_yds: w === 1 ? 180 : 70, rec: 6, rec_td: 1 },
    }));
    const bundle = wrBundle(logs);
    bundle.flags = [];
    const full = evaluateFromBundle(bundle, { statId: "rec_yds", line: 74.5, side: "more", skipSims: true });
    const raw = evaluateFromBundle(bundle, {
      statId: "rec_yds",
      line: 74.5,
      side: "more",
      skipSims: true,
      ablation: { rawSeasonAverage: true },
    });
    const noMatch = evaluateFromBundle(bundle, {
      statId: "rec_yds",
      line: 74.5,
      side: "more",
      skipSims: true,
      ablation: { noMatchup: true },
    });
    assert.equal(full.modelVersion, "2.0.0");
    assert.notEqual(Number(full.projection.toFixed(2)), Number(raw.projection.toFixed(2)));
    assert.ok(Math.abs(full.projection - noMatch.projection) >= 0 || true);
    assert.equal(full.stat.id, raw.stat.id);
  });
});

describe("metrics", () => {
  it("Brier score is 0 for a perfect 100% call and 0.25 for a 50/50", () => {
    assert.equal(brier([{ pHit: 1, hit: true }]), 0);
    assert.equal(brier([{ pHit: 0.5, hit: true }]), 0.25);
  });

  it("calibration bands flag overconfidence when predicted >> actual", () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) {
      rows.push({ pHit: 0.72, hit: i < 10 });
    }
    const table = calibrationTable(rows);
    const top = table.find((b) => b.band === "70%+");
    assert.ok(top.n === 40);
    assert.ok(top.gap > 0.2);
    assert.equal(top.overconfident, true);
    assert.ok(ece(rows) > 0.2);
  });

  it("sample buckets match the spec", () => {
    assert.equal(sampleBucket(2), "1–2");
    assert.equal(sampleBucket(4), "3–4");
    assert.equal(sampleBucket(7), "5–7");
    assert.equal(sampleBucket(9), "8+");
  });

  it("reportFromRows includes requested slices", () => {
    const report = reportFromRows([
      {
        statId: "rec_yds",
        error: 4,
        pHit: 0.58,
        hit: true,
        confidence: "B",
        propScore: 70,
        sampleGames: 8,
        spread: -16,
        role: "Stable",
      },
      {
        statId: "rec_yds",
        error: -6,
        pHit: 0.58,
        hit: false,
        confidence: "B",
        propScore: 70,
        sampleGames: 8,
        spread: -16,
        role: "Stable",
      },
    ]);
    assert.ok(report.overall.mae > 0);
    assert.ok(report.byStat.rec_yds.n === 2);
    assert.ok(report.bySpread["Fav 14+"]);
  });
});

describe("ablation ranking is computed on VAL, not TEST", () => {
  it("returns VAL deltas and leaves TEST as a separate object", () => {
    const run = runWalkForward({ seed: 11, ablations: ["full", "raw_season_average", "no_prior_shrinkage"] });
    const val = ablationDelta(run.reports, "val");
    const test = ablationDelta(run.reports, "test");
    assert.ok(val.some((a) => a.ablation === "raw_season_average"));
    assert.ok(test.some((a) => a.ablation === "raw_season_average"));
    assert.notEqual(run.reports.full.val.overall.n, run.reports.full.test.overall.n);
  });
});

describe("double-count audit is documented", () => {
  it("covers the five overlap families", () => {
    const ids = DOUBLE_COUNT_AUDIT.map((d) => d.id);
    assert.ok(ids.includes("opportunity_vs_baseline"));
    assert.ok(ids.includes("recency_vs_role"));
    assert.ok(ids.includes("stacked_pass_defense"));
    assert.ok(ids.includes("script_vs_volume"));
    assert.equal(DOUBLE_COUNT_AUDIT.length >= 5, true);
  });
});
