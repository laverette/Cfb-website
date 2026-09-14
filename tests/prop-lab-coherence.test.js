/**
 * Probability / score / confidence coherence tests.
 * Run: npm test
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const { evaluateFromBundle, relineEvaluation } = require(path.join(root, "evaluate"));
const { probabilityAtLine, probabilityCurve, rawProbability } = require(path.join(root, "simulate"));
const { propScore } = require(path.join(root, "score"));
const { lineSanity } = require(path.join(root, "sanity"));
const { poissonCdf } = require(path.join(root, "math"));

function log(week, opponent, stats, extra = {}) {
  return {
    week,
    opponent,
    stats,
    isFcs: Boolean(extra.isFcs),
    points: extra.points ?? 30,
    oppPoints: extra.oppPoints ?? 24,
    homeAway: extra.homeAway || "away",
  };
}

function toneyBundle() {
  return {
    player: { id: "toney", name: "Malachi Toney", team: "Miami", position: "WR" },
    opponent: { name: "Wake Forest", homeAway: "away", week: 3, isFcs: false },
    gameLogs: [
      log(1, "Notre Dame", { rec_yds: 165, rec: 8, rec_td: 1, rush_yds: 0, rush_att: 0 }),
      log(2, "South Florida", { rec_yds: 165, rec: 7, rec_td: 2, rush_yds: 12, rush_att: 1 }),
    ],
    priorLogs: Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Prior Opp", { rec_yds: 70 + (i % 3) * 8, rec: 5, rec_td: 0 })
    ),
    currentOverview: { games: 2, team: "Miami", name: "Malachi Toney", position: "WR" },
    priorOverview: { games: 12, team: "Miami" },
    usage: { games: 2, rec: 7.5, recYds: 165, rushAtt: 0.5, rushYds: 6, passAtt: 0, passYds: 0, recTd: 1.5, rushTd: 0, passTd: 0 },
    usageL3: { games: 2, rec: 7.5, recYds: 165, rushAtt: 0.5, rushYds: 6, passAtt: 0 },
    teamOffense: { games: 2, passattempts: 70, completions: 44, rushingattempts: 60 },
    teamAdv: { offense: { plays: 140 } },
    oppDefense: {},
    leagueTeamStats: new Map([
      ["wake forest", { passyardsallowed: 230, rushingyardsallowed: 150 }],
      ["miami", { passyardsallowed: 200, rushingyardsallowed: 140 }],
    ]),
    leagueAdvanced: new Map(),
    flags: ["Small Sample"],
    market: { spread: -14, total: 54, source: "cfbd_lines" },
    playerTeamRating: { name: "Miami", rawPower: 12, offenseRating: 8 },
    oppRating: { name: "Wake Forest", rawPower: 2, defenseRating: 1, ranking: 55 },
  };
}

function mensahBundle() {
  return {
    player: { id: "mensah", name: "Darian Mensah", team: "Duke", position: "QB" },
    opponent: { name: "Wake Forest", homeAway: "home", week: 3, isFcs: false },
    gameLogs: [
      log(1, "Clemson", { pass_yds: 260, pass_att: 34, pass_comp: 22, pass_td: 3, pass_int: 0, rush_yds: 8 }),
      log(2, "NC State", { pass_yds: 248, pass_att: 31, pass_comp: 21, pass_td: 2, pass_int: 1, rush_yds: 12 }),
    ],
    priorLogs: Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Prior", { pass_yds: 230, pass_att: 32, pass_comp: 20, pass_td: 2, pass_int: 0.7 })
    ),
    currentOverview: { games: 2, team: "Duke", name: "Darian Mensah", position: "QB" },
    priorOverview: { games: 12, team: "Duke" },
    usage: { games: 2, passAtt: 32.5, passYds: 254, rec: 0, recYds: 0, rushAtt: 4, rushYds: 10, passTd: 2.5 },
    usageL3: { games: 2, passAtt: 32.5, passYds: 254, rec: 0, recYds: 0, rushAtt: 4, rushYds: 10, passTd: 2.5 },
    teamOffense: { games: 2, passattempts: 65, completions: 43, rushingattempts: 55 },
    teamAdv: { offense: { plays: 130 } },
    oppDefense: {},
    leagueTeamStats: new Map([
      ["wake forest", { passyardsallowed: 230, rushingyardsallowed: 150 }],
      ["duke", { passyardsallowed: 210, rushingyardsallowed: 145 }],
    ]),
    leagueAdvanced: new Map(),
    flags: ["Small Sample"],
    market: { spread: -7, total: 52, source: "cfbd_lines" },
    playerTeamRating: { name: "Duke", rawPower: 6, offenseRating: 4 },
    oppRating: { name: "Wake Forest", rawPower: 2, defenseRating: 1, ranking: 55 },
  };
}

const CURVE_LINES = [60.5, 70.5, 80.5, 90.5, 100.5, 110.5, 120.5, 130.5, 140.5];

function assertMonotoneMore(dist, lines = CURVE_LINES) {
  const curve = probabilityCurve(dist, lines, "more");
  for (let i = 1; i < curve.length; i += 1) {
    assert.ok(
      curve[i].pMore <= curve[i - 1].pMore + 1e-9,
      `P(over ${curve[i].line})=${curve[i].pMore} rose vs P(over ${curve[i - 1].line})=${curve[i - 1].pMore}`
    );
  }
  return curve;
}

describe("screenshot regressions", () => {
  it("Toney 110 rec yds is not ~50% at 98.5 or 52% at 88.5", () => {
    const dist = { mean: 110, sd: 42, dist: "normal", reliability: 0.38, games: 2 };
    const a = probabilityAtLine(dist, 98.5, "more");
    const b = probabilityAtLine(dist, 88.5, "more");
    assert.ok(a.pMore >= 0.56, `98.5 → ${a.pMore}`);
    assert.ok(b.pMore >= 0.64, `88.5 → ${b.pMore}`);
    assert.ok(b.pMore - a.pMore >= 0.07, `gap ${b.pMore - a.pMore}`);
    const scored = propScore({ pHit: a.pMore, confidenceLetter: "D", roleStable: true });
    assert.ok(scored.score >= 50, `score ${scored.score} still crushed by D confidence`);
    assert.notEqual(scored.label, undefined);
  });

  it("Mensah completions 21.8 vs 0.5 is not capped at 65%", () => {
    const p = probabilityAtLine(
      { mean: 21.8, sd: 8.1, dist: "normal", reliability: 0.38, games: 2 },
      0.5,
      "more"
    );
    assert.ok(p.pMore >= 0.85, `got ${p.pMore}`);
    const scored = propScore({ pHit: p.pMore, confidenceLetter: "D", roleStable: true });
    assert.ok(scored.score >= 70, `obvious completion prop scored ${scored.score}`);
  });

  it("Toney rec TD 1.1 vs 0.5 uses the Poisson model, not a 55% coin flip", () => {
    const lambda = 1.1;
    const expected = 1 - poissonCdf(0, lambda);
    const p = probabilityAtLine({ mean: lambda, sd: 0.9, dist: "poisson", reliability: 0.38, games: 2 }, 0.5, "more");
    assert.ok(Math.abs(p.pRaw - expected) < 0.01);
    assert.ok(p.pMore >= 0.62, `P(over 0.5 | λ=1.1) collapsed to ${p.pMore}; Poisson says ${expected}`);
  });

  it("Mensah passing TDs 2.7 vs 2.5 is a true toss-up under Poisson", () => {
    const lambda = 2.7;
    const expected = 1 - poissonCdf(2, lambda);
    const p = probabilityAtLine({ mean: lambda, dist: "poisson", reliability: 0.38, games: 2 }, 2.5, "more");
    assert.ok(Math.abs(p.pRaw - expected) < 0.01);
    assert.ok(p.pMore > 0.42 && p.pMore < 0.58, `2.7 vs 2.5 should be near 50%, got ${p.pMore}`);
  });

  it("evaluateFromBundle keeps Toney rec-yards line-sensitive and Mensah 0.5 completions high", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 98.5, side: "more" });
    const recLower = relineEvaluation(rec, 88.5, "more");
    assert.equal(recLower.projection, rec.projection);
    assert.equal(recLower.confidence, rec.confidence);
    assert.ok(recLower.pMore - rec.pMore >= 0.05, `Toney reline gap ${rec.pMore} → ${recLower.pMore}`);
    assert.ok(rec.pMore < 0.75, "keep the 151/97 guard");
    assert.ok(rec.modelDebug.sd > 0);
    assert.ok(Array.isArray(rec.confidenceReasons));
    assert.ok(rec.propScoreComponents.confidenceModifier >= 0.8);

    const recTd = evaluateFromBundle(toneyBundle(), { statId: "rec_td", line: 0.5, side: "more" });
    const tdExpected = 1 - poissonCdf(0, recTd.projection);
    assert.ok(Math.abs(recTd.pRaw - tdExpected) < 0.04, `TD pRaw ${recTd.pRaw} vs Poisson ${tdExpected} at λ=${recTd.projection}`);

    const comp = evaluateFromBundle(mensahBundle(), { statId: "pass_comp", line: 0.5, side: "more" });
    assert.ok(comp.pMore >= 0.85, `Mensah completions vs 0.5 → ${comp.pMore}`);
    assert.ok(comp.lineSanity?.unusual, "0.5 completions should warn Unusual Line");
    assert.ok(comp.propScore >= 70, `score ${comp.propScore}`);
    assert.notEqual(comp.confidence, "A");
    const td = evaluateFromBundle(mensahBundle(), { statId: "pass_td", line: 2.5, side: "more" });
    assert.ok(Number.isFinite(td.pMore));
  });
});

describe("probability curves", () => {
  const families = [
    {
      name: "receiving yards",
      dist: { mean: 110, sd: 38, dist: "normal", reliability: 0.4, games: 2 },
      lines: [60.5, 70.5, 80.5, 90.5, 100.5, 110.5, 120.5, 130.5, 140.5],
    },
    {
      name: "passing yards",
      dist: { mean: 250, sd: 72, dist: "normal", reliability: 0.6, games: 6 },
      lines: [160.5, 190.5, 220.5, 250.5, 280.5, 310.5, 340.5],
    },
    {
      name: "rushing yards",
      dist: { mean: 95, sd: 42, dist: "normal", reliability: 0.7, games: 8 },
      lines: [40.5, 55.5, 70.5, 85.5, 95.5, 110.5, 125.5, 140.5],
    },
    {
      name: "completions",
      dist: { mean: 22, sd: 6, dist: "normal", reliability: 0.4, games: 2 },
      lines: [8.5, 12.5, 16.5, 20.5, 22.5, 26.5, 30.5, 34.5],
    },
    {
      name: "attempts",
      dist: { mean: 33, sd: 8, dist: "normal", reliability: 0.5, games: 4 },
      lines: [18.5, 24.5, 28.5, 32.5, 36.5, 40.5, 46.5],
    },
    {
      name: "receptions",
      dist: { mean: 6.5, sd: 2.4, dist: "normal", reliability: 0.45, games: 3 },
      lines: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5],
    },
  ];

  for (const fam of families) {
    it(`${fam.name} curve is smooth, monotonic, and ~50% at the mean`, () => {
      const curve = assertMonotoneMore(fam.dist, fam.lines);
      const atMean = probabilityAtLine(fam.dist, fam.dist.mean, "more");
      assert.ok(Math.abs(atMean.pMore - 0.5) < 0.04, `${fam.name} at mean → ${atMean.pMore}`);
      const low = curve[0].pMore;
      const high = curve[curve.length - 1].pMore;
      assert.ok(low - high >= 0.35, `${fam.name} span too flat: ${low} → ${high}\n${JSON.stringify(curve)}`);
      if (process.env.PROP_LAB_LOG_CURVES) {
        console.log(
          fam.name,
          curve.map((c) => `${c.line}:${(c.pMore * 100).toFixed(1)}%`).join(" ")
        );
      }
    });
  }

  it("passing / rushing / receiving TDs stay discrete and consistent with λ", () => {
    for (const lambda of [0.6, 1.1, 2.7]) {
      const dist = { mean: lambda, dist: "poisson", reliability: 0.38, games: 2 };
      const p05 = probabilityAtLine(dist, 0.5, "more");
      const p15 = probabilityAtLine(dist, 1.5, "more");
      const p25 = probabilityAtLine(dist, 2.5, "more");
      assert.ok(p05.pMore >= p15.pMore - 1e-9);
      assert.ok(p15.pMore >= p25.pMore - 1e-9);
      const poisson05 = 1 - poissonCdf(0, lambda);
      assert.ok(Math.abs(p05.pRaw - poisson05) < 0.001);
      assert.ok(p05.pMore > 0 && p05.pMore < 1);
    }
  });

  it("Less lines are the reverse of More", () => {
    const dist = { mean: 110, sd: 38, dist: "normal", reliability: 0.4, games: 2 };
    let prev = 0;
    for (const line of CURVE_LINES) {
      const p = probabilityAtLine(dist, line, "less");
      assert.ok(p.pLess >= prev - 1e-9);
      assert.ok(Math.abs(p.pLess + p.pMore - 1) < 1e-9);
      prev = p.pLess;
    }
  });
});

describe("model coherence invariants", () => {
  it("probability stays in (0, 1) and extreme low lines can be high even with D confidence", () => {
    const dist = { mean: 110, sd: 42, dist: "normal", reliability: 0.38, games: 2 };
    for (const line of [0.5, 20.5, 60.5, 110.5, 180.5]) {
      const p = probabilityAtLine(dist, line, "more");
      assert.ok(p.pMore > 0 && p.pMore < 1);
    }
    const extreme = probabilityAtLine(dist, 20.5, "more");
    assert.ok(extreme.pMore >= 0.85);
    const scored = propScore({ pHit: extreme.pMore, confidenceLetter: "D", roleStable: false });
    assert.ok(scored.score >= 70);
  });

  it("confidence and projection do not change when only the line changes", () => {
    const base = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 98.5, side: "more" });
    const next = relineEvaluation(base, 70.5, "more");
    assert.equal(next.projection, base.projection);
    assert.equal(next.median, base.median);
    assert.equal(next.confidence, base.confidence);
    assert.equal(next.distribution.sd, base.distribution.sd);
    assert.equal(next.modelVersion, base.modelVersion);
    assert.ok(next.pMore > base.pMore);
  });

  it("reline is a local calculation (no bundle / CFBD fields required)", () => {
    const slim = {
      projection: 110,
      median: 110,
      confidence: "D",
      confidenceReasons: ["Only 2 current-season games"],
      modelVersion: "2.1.0",
      stat: { id: "rec_yds" },
      player: { position: "WR" },
      usage: { role: "Stable" },
      form: { hitRate: 0.5, games: 2 },
      flags: ["Small Sample"],
      gameLog: [{ value: 165 }, { value: 165 }],
      distribution: { mean: 110, sd: 42, dist: "normal", reliability: 0.38, games: 2 },
      modelDebug: { sd: 42, dist: "normal" },
    };
    const next = relineEvaluation(slim, 88.5, "more");
    assert.equal(next.projection, 110);
    assert.equal(next.confidence, "D");
    assert.ok(next.pMore > 0.6);
  });

  it("a line near the modeled median is approximately 50%", () => {
    const dist = { mean: 110, sd: 38, dist: "normal", reliability: 1, games: 10 };
    const p = probabilityAtLine(dist, 110.5, "more");
    assert.ok(Math.abs(p.pMore - 0.5) < 0.03);
  });

  it("raw P and final P are explained in modelDebug", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 98.5, side: "more" });
    const raw = rawProbability({
      mean: rec.projection,
      sd: rec.distribution.sd,
      dist: rec.distribution.dist,
      line: 98.5,
      side: "more",
    });
    assert.ok(Math.abs(rec.modelDebug.rawPMore - raw.pMore) < 0.02);
    assert.equal(rec.modelDebug.calibrationAdjustment, 0);
    assert.ok(rec.modelDebug.uncertaintyAdjustment < 0.12);
    if (rec.projection >= rec.line + 8) {
      assert.ok(rec.pMore >= 0.55, `proj ${rec.projection} vs 98.5 → ${rec.pMore} with no defensible 50% overwrite`);
    }
  });
});

describe("unusual line warnings", () => {
  it("warns on QB completions 0.5 without blocking", () => {
    const s = lineSanity({ statId: "pass_comp", line: 0.5, projection: 21.8, position: "QB" });
    assert.equal(s.unusual, true);
    assert.ok(/confirm/i.test(s.message));
  });

  it("does not flag a normal receiving-TD 0.5 line", () => {
    const s = lineSanity({ statId: "rec_td", line: 0.5, projection: 1.1, position: "WR" });
    assert.equal(s.unusual, false);
  });
});

describe("Prop Score ranking", () => {
  it("ranks by probability and only modestly trims D confidence", () => {
    const a = propScore({ pHit: 0.72, confidenceLetter: "A", roleStable: true });
    const d = propScore({ pHit: 0.72, confidenceLetter: "D", roleStable: true });
    assert.ok(a.score > d.score);
    assert.ok(d.score >= 60, `D trim too harsh: ${d.score}`);
    assert.ok(d.components.confidenceModifier >= 0.8);
    assert.equal(d.components.matchupComponent, 0);
  });

  it("uses Strong/Lean/Pass labels instead of A–F", () => {
    assert.equal(propScore({ pHit: 0.5, confidenceLetter: "B" }).label, "Pass");
    assert.ok(["Lean", "Slight Lean", "Strong", "Elite"].includes(propScore({ pHit: 0.72, confidenceLetter: "B" }).label));
  });
});
