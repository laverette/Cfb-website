/**
 * Prop Lab unit tests (no live CFBD).
 * Run: npm test
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const { evaluateFromBundle, relineEvaluation } = require(path.join(root, "evaluate"));
const { currentSeasonWeight, blendExpectation } = require(path.join(root, "shrinkage"));
const { shrinkProbability, probabilityAtLine } = require(path.join(root, "simulate"));
const { classifyPair, analyzeCorrelations } = require(path.join(root, "correlation"));
const { bestN, analyzeEntry } = require(path.join(root, "entry"));
const { matchupAdjustment } = require(path.join(root, "matchup"));
const { getPropDef, catalogPublic } = require(path.join(root, "definitions"));
const { extractStatValue } = require(path.join(root, "parse"));

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
      ["alabama", { passyardsallowed: 160, rushingyardsallowed: 110 }],
      ["fcs cupcake", { passyardsallowed: 320, rushingyardsallowed: 250 }],
    ]),
    leagueAdvanced: new Map(),
    flags: ["Small Sample"],
    market: { spread: -14, total: 54, source: "cfbd_lines" },
    playerTeamRating: { name: "Miami", rawPower: 12, offenseRating: 8 },
    oppRating: { name: "Wake Forest", rawPower: 2, defenseRating: 1, ranking: 55 },
  };
}

describe("prop definitions", () => {
  it("exposes the required PrizePicks categories", () => {
    const ids = catalogPublic().map((s) => s.id);
    for (const id of [
      "pass_yds",
      "pass_att",
      "pass_comp",
      "pass_td",
      "pass_int",
      "rush_yds",
      "rush_att",
      "rush_td",
      "rec_yds",
      "rec",
      "rec_td",
      "rush_rec_yds",
      "pass_rush_yds",
      "total_td",
      "fg_made",
      "kicking_pts",
    ]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  });

  it("extracts combo stats from a game box", () => {
    const stats = { rush_yds: 40, rec_yds: 62, pass_yds: 250, pass_td: 2, rush_td: 1, rec_td: 1 };
    assert.equal(extractStatValue(stats, "rush_rec_yds"), 102);
    assert.equal(extractStatValue(stats, "pass_rush_yds"), 290);
    assert.equal(extractStatValue(stats, "total_td"), 4);
  });

  it("extracts field goals and kicking points from CFBD boxes", () => {
    const { extractGameStats, extractOverviewTotal, parseMadeAttempted } = require(path.join(root, "parse"));
    assert.deepEqual(parseMadeAttempted("2-3"), { made: 2, att: 3 });
    assert.deepEqual(parseMadeAttempted("1/1"), { made: 1, att: 1 });
    const espnBox = [
      {
        name: "kicking",
        types: [
          { name: "FG", athletes: [{ id: "k1", name: "Will Hart", stat: "2-3" }] },
          { name: "XP", athletes: [{ id: "k1", name: "Will Hart", stat: "4-4" }] },
          { name: "PTS", athletes: [{ id: "k1", name: "Will Hart", stat: "10" }] },
        ],
      },
    ];
    const espn = extractGameStats(espnBox, "k1", "Will Hart");
    assert.equal(espn.fg_made, 2);
    assert.equal(espn.fg_att, 3);
    assert.equal(espn.xp_made, 4);
    assert.equal(espn.kicking_pts, 10);
    const numericBox = [
      {
        name: "kicking",
        types: [
          { name: "FGM", athletes: [{ id: "k1", name: "Will Hart", stat: "1" }] },
          { name: "FGA", athletes: [{ id: "k1", name: "Will Hart", stat: "2" }] },
          { name: "XPM", athletes: [{ id: "k1", name: "Will Hart", stat: "3" }] },
        ],
      },
    ];
    const numeric = extractGameStats(numericBox, "k1", "Will Hart");
    assert.equal(numeric.fg_made, 1);
    assert.equal(numeric.kicking_pts, 6);
    const overview = {
      boxScoreStats: {
        categories: [
          {
            name: "kicking",
            stats: [
              { stat: "FGM", value: 12 },
              { stat: "XPM", value: 28 },
              { stat: "PTS", value: 64 },
            ],
          },
        ],
      },
    };
    assert.equal(extractOverviewTotal(overview, "fg_made"), 12);
    assert.equal(extractOverviewTotal(overview, "kicking_pts"), 64);
    assert.equal(extractStatValue({ fg_made: 2, kicking_pts: 9 }, "fg_made"), 2);
    assert.equal(extractStatValue({ fg_made: 2, kicking_pts: 9 }, "kicking_pts"), 9);
  });

  it("reads completions and attempts from C/ATT box strings", () => {
    const { extractGameStats, extractOverviewTotal } = require(path.join(root, "parse"));
    const box = [
      {
        name: "passing",
        types: [
          { name: "C/ATT", athletes: [{ id: "qb1", name: "Tait Reynolds", stat: "21/32" }] },
          { name: "YDS", athletes: [{ id: "qb1", name: "Tait Reynolds", stat: "248" }] },
          { name: "TD", athletes: [{ id: "qb1", name: "Tait Reynolds", stat: "2" }] },
        ],
      },
    ];
    const stats = extractGameStats(box, "qb1", "Tait Reynolds");
    assert.equal(stats.pass_comp, 21);
    assert.equal(stats.pass_att, 32);
    assert.equal(stats.pass_yds, 248);
    const overview = {
      boxScoreStats: {
        categories: [
          {
            name: "passing",
            stats: [
              { stat: "C/ATT", value: "45-70" },
              { stat: "YDS", value: 520 },
            ],
          },
        ],
      },
    };
    assert.equal(extractOverviewTotal(overview, "pass_comp"), 45);
    assert.equal(extractOverviewTotal(overview, "pass_att"), 70);
  });

  it("filters catalog stats by player position", () => {
    const { statsForPosition, canonicalPosition } = require(path.join(root, "definitions"));
    assert.equal(canonicalPosition(" wr "), "WR");
    assert.equal(canonicalPosition("HB"), "RB");
    const wr = statsForPosition("WR").map((s) => s.id);
    assert.ok(wr.includes("rec_yds"));
    assert.ok(wr.includes("rec"));
    assert.ok(!wr.includes("pass_yds"));
    const qb = statsForPosition("QB").map((s) => s.id);
    assert.ok(qb.includes("pass_comp"));
    assert.ok(!qb.includes("rec_yds"));
    const rb = statsForPosition("RB").map((s) => s.id);
    assert.ok(rb.includes("rush_yds"));
    assert.ok(rb.includes("rec"));
    assert.ok(!rb.includes("pass_att"));
    const unknown = statsForPosition("").map((s) => s.id);
    assert.ok(unknown.includes("pass_yds"));
    assert.ok(unknown.includes("rec_yds"));
    assert.equal(canonicalPosition("PK"), "K");
    const kicker = statsForPosition("K").map((s) => s.id);
    assert.ok(kicker.includes("fg_made"));
    assert.ok(kicker.includes("kicking_pts"));
    assert.ok(!kicker.includes("pass_yds"));
    assert.ok(!qb.includes("fg_made"));
    assert.ok(!wr.includes("kicking_pts"));
  });
});

describe("early-season shrinkage", () => {
  it("does not treat 2 games like a full season", () => {
    assert.ok(currentSeasonWeight(2) < 0.35);
    assert.ok(currentSeasonWeight(8) > 0.85);
    assert.ok(currentSeasonWeight(2) < currentSeasonWeight(6));
  });

  it("blends a 165-yard two-game pace toward a 76 prior", () => {
    const blend = blendExpectation({
      current: 165,
      prior: 75.7,
      games: 2,
      hasPrior: true,
    });
    assert.ok(blend.value < 120, `blend ${blend.value} still too close to raw 165`);
    assert.ok(blend.value > 70);
  });
});

describe("distributions / probability", () => {
  it("does not overwrite a far-from-line probability toward 50%", () => {
    const far = shrinkProbability(0.97, 0.38, 2, 2.6);
    assert.ok(far.p >= 0.96, `far-line p ${far.p} was pulled too hard`);
    const near = shrinkProbability(0.62, 0.38, 2, 0.15);
    assert.ok(near.p < 0.62);
    assert.ok(near.p > 0.5);
  });

  it("does not apply a 65/68% ceiling on a trivially low completions line", () => {
    const p = probabilityAtLine(
      { mean: 21.8, sd: 8.1, dist: "normal", reliability: 0.38, games: 2 },
      0.5,
      "more"
    );
    assert.ok(p.pMore >= 0.85, `completions 21.8 vs 0.5 should be near-certain, got ${p.pMore}`);
  });

  it("recalculates P(More) at a new line without changing the projection", () => {
    const dist = { mean: 108, sd: 42, dist: "normal", reliability: 0.38, games: 2 };
    const a = probabilityAtLine(dist, 80.5, "more");
    const b = probabilityAtLine(dist, 109.5, "more");
    assert.ok(a.pMore > b.pMore);
    assert.ok(a.pMore - b.pMore >= 0.08, `line sensitivity too flat: ${a.pMore} vs ${b.pMore}`);
  });
});

describe("Toney regression — no fake 97% More", () => {
  it("produces a defensible receiving-yards projection vs Wake Forest", () => {
    const result = evaluateFromBundle(toneyBundle(), {
      statId: "rec_yds",
      line: 98.5,
      side: "more",
      seed: 1,
    });
    assert.ok(result.projection < 140, `projection ${result.projection} still overconfident vs two 165s`);
    assert.ok(result.projection > 70);
    assert.ok(result.pMore < 0.75, `pMore ${result.pMore} must not look like a lock`);
    assert.ok(result.pMore > 0.4);
    if (result.projection >= 108) {
      assert.ok(result.pMore >= 0.54, `110-style projection vs 98.5 should not collapse to 50% (got ${result.pMore})`);
    }
    const at88 = relineEvaluation(result, 88.5, "more");
    assert.equal(at88.projection, result.projection);
    assert.equal(at88.confidence, result.confidence);
    assert.ok(
      at88.pMore - result.pMore >= 0.05,
      `88.5 vs 98.5 too flat: ${result.pMore} → ${at88.pMore}`
    );
    assert.ok(result.propScore >= 45, `favorable rec-yards prop should not cluster in the 30s (score ${result.propScore})`);
    assert.notEqual(result.confidence, "A");
    assert.ok(["B+", "B", "B-", "C+", "C", "D"].includes(result.confidence));
    assert.ok(result.propScore < 84, "two-game sample should not be Elite");
    assert.ok((result.flags || []).includes("Small Sample"));
    assert.ok((result.caution || []).some((c) => /two|sample|prior/i.test(c)));
    assert.equal(result.modelVersion, "2.1.0");
  });

  it("line shopping does not refetch and moves probability in the right direction", () => {
    const base = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 98.5, side: "more" });
    const lower = relineEvaluation(base, 80.5, "more");
    const higher = relineEvaluation(base, 109.5, "more");
    assert.equal(lower.projection, base.projection);
    assert.ok(lower.pMore > base.pMore);
    assert.ok(higher.pMore < base.pMore);
  });
});

describe("freshman / no prior", () => {
  it("assigns high uncertainty when history is missing", () => {
    const bundle = toneyBundle();
    bundle.priorLogs = [];
    bundle.priorOverview = null;
    bundle.flags = ["Small Sample", "Limited History", "New Starter"];
    bundle.player.year = "FR";
    const result = evaluateFromBundle(bundle, { statId: "rec_yds", line: 64.5, side: "more" });
    assert.ok(["C+", "C", "D", "B-"].includes(result.confidence));
    assert.ok((result.flags || []).includes("Limited History"));
    assert.ok((result.confidenceReasons || []).length > 0);
    assert.notEqual(result.confidence, "A");
  });
});

describe("matchup caps", () => {
  it("caps opponent adjustment instead of applying a huge multiplier", () => {
    const bundle = toneyBundle();
    bundle.leagueTeamStats = new Map([
      ["wake forest", { passyardsallowed: 480 }],
      ["a", { passyardsallowed: 180 }],
      ["b", { passyardsallowed: 190 }],
      ["c", { passyardsallowed: 200 }],
    ]);
    const adj = matchupAdjustment(bundle, getPropDef("rec_yds"));
    assert.ok(Math.abs(adj.adjPct) <= 0.14);
  });
});

describe("correlation + best-N", () => {
  it("flags QB pass yards + WR rec yards on the same offense", () => {
    const pair = classifyPair(
      {
        player: { id: "1", name: "QB", team: "Miami" },
        stat: { id: "pass_yds", short: "PASS YDS" },
        side: "more",
        opponent: { name: "Wake Forest" },
      },
      {
        player: { id: "2", name: "WR", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        opponent: { name: "Wake Forest" },
      }
    );
    assert.equal(pair.sign, "positive");
    assert.ok(pair.corr > 0.2);
  });

  it("prefers cutting a weak correlated leg, not only the lowest isolated score", () => {
    const legs = [
      { clientId: "a", player: { id: "1", name: "A", team: "Miami" }, stat: { id: "rec_yds" }, side: "more", propScore: 84, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "b", player: { id: "2", name: "B", team: "Miami" }, stat: { id: "pass_yds" }, side: "more", propScore: 81, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "c", player: { id: "3", name: "C", team: "Clemson" }, stat: { id: "rush_yds" }, side: "more", propScore: 77, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "d", player: { id: "4", name: "D", team: "Ohio State" }, stat: { id: "rec" }, side: "more", propScore: 74, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "e", player: { id: "5", name: "E", team: "Miami" }, stat: { id: "rec" }, side: "more", propScore: 72, confidence: "C+", form: { games: 2 }, flags: ["Small Sample"] },
      { clientId: "f", player: { id: "6", name: "F", team: "Duke" }, stat: { id: "rush_att" }, side: "more", propScore: 55, confidence: "C", form: { games: 2 }, flags: ["High Variance"] },
    ];
    const out = bestN(legs, 4);
    assert.equal(out.keep.length, 4);
    assert.ok(out.cut.some((l) => l.player.name === "F"));
    const best3 = bestN(legs, 3);
    assert.equal(best3.keep.length, 3);
    assert.equal(best3.n, 3);
    assert.ok(best3.cut.length === 3);
    assert.ok(best3.cut.some((l) => l.player.name === "F"));
    assert.ok(!best3.keep.some((l) => l.player.name === "F"));
    const entry = analyzeEntry(legs);
    assert.ok(entry.grade);
    assert.equal(entry.weakest.player.name, "F");
    assert.ok(analyzeCorrelations(legs).length >= 1);
  });
});

describe("joint all-hit probability", () => {
  it("multiplies independent legs and reports American odds", () => {
    const analysis = analyzeEntry([
      {
        clientId: "a",
        pHit: 0.5,
        player: { id: "1", name: "A", team: "Miami" },
        stat: { id: "rush_yds", short: "RUSH YDS" },
        side: "more",
        line: 70,
        propScore: 70,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "b",
        pHit: 0.5,
        player: { id: "2", name: "B", team: "Clemson" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        line: 60,
        propScore: 70,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
    ]);
    assert.equal(analysis.together.n, 2);
    assert.equal(analysis.together.corrUsed, false);
    assert.ok(Math.abs(analysis.together.p - 0.25) < 0.005);
    assert.equal(analysis.together.american, 300);
    assert.equal(analysis.together.americanLabel, "+300");
  });

  it("raises all-hit when same-player legs are positively correlated", () => {
    const analysis = analyzeEntry([
      {
        clientId: "t-rec",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec", short: "REC" },
        side: "more",
        line: 5.5,
        propScore: 75,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "t-yds",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        line: 60,
        propScore: 74,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
    ]);
    assert.ok(analysis.together.corrUsed);
    assert.ok(analysis.together.p > analysis.together.independent + 0.03);
    assert.ok(analysis.together.p <= 0.6);
  });

  it("lowers all-hit when sides oppose a positive relationship", () => {
    const sameSide = analyzeEntry([
      {
        clientId: "a",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec", short: "REC" },
        side: "more",
        line: 5.5,
        propScore: 75,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "b",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        line: 60,
        propScore: 74,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
    ]);
    const mixed = analyzeEntry([
      {
        clientId: "a",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec", short: "REC" },
        side: "more",
        line: 5.5,
        propScore: 75,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "b",
        pHit: 0.6,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "less",
        line: 60,
        propScore: 74,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
    ]);
    assert.ok(mixed.together.p < mixed.together.independent);
    assert.ok(mixed.together.p < sameSide.together.p);
  });

  it("uses a copula for three correlated legs and stays inside Frechet bounds", () => {
    const analysis = analyzeEntry([
      {
        clientId: "t-rec",
        pHit: 0.55,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec", short: "REC" },
        side: "more",
        line: 5.5,
        propScore: 75,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "t-yds",
        pHit: 0.55,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        line: 60,
        propScore: 74,
        confidence: "B",
        form: { games: 8 },
        flags: [],
      },
      {
        clientId: "t-td",
        pHit: 0.55,
        player: { id: "toney", name: "Toney", team: "Miami" },
        stat: { id: "rec_td", short: "REC TD" },
        side: "more",
        line: 0.5,
        propScore: 70,
        confidence: "C",
        form: { games: 8 },
        flags: [],
      },
    ]);
    assert.equal(analysis.together.method, "gaussian_copula");
    assert.ok(analysis.together.p > analysis.together.independent);
    assert.ok(analysis.together.p <= 0.55);
    assert.ok(analysis.together.p >= 0);
    const best = bestN(
      [
        {
          clientId: "t-rec",
          pHit: 0.55,
          player: { id: "toney", name: "Toney", team: "Miami" },
          stat: { id: "rec", short: "REC" },
          side: "more",
          line: 5.5,
          propScore: 75,
          confidence: "B",
          form: { games: 8 },
          flags: [],
        },
        {
          clientId: "rb",
          pHit: 0.55,
          player: { id: "rb1", name: "RB", team: "Clemson" },
          stat: { id: "rush_yds", short: "RUSH YDS" },
          side: "more",
          line: 70,
          propScore: 68,
          confidence: "B",
          form: { games: 8 },
          flags: [],
        },
      ],
      2
    );
    assert.ok(best.together);
    assert.equal(best.together.n, 2);
  });
});

describe("entry value vs payout odds", () => {
  const { parsePayout, conservativePHit } = require(path.join(root, "value"));

  function qbLeg(id, team, pHit, extra = {}) {
    return {
      clientId: id,
      pHit,
      player: { id, name: id, team },
      stat: { id: "pass_yds", short: "PASS YDS" },
      side: "more",
      line: 220,
      propScore: 75,
      confidence: extra.confidence || "B",
      form: { games: 8 },
      flags: extra.flags || [],
    };
  }

  it("parses 10x, +900, and PrizePicks defaults", () => {
    assert.equal(parsePayout("10x", 4).decimal, 10);
    assert.equal(parsePayout("+900", 4).decimal, 10);
    assert.equal(parsePayout("", 4).multiplier, 10);
    assert.equal(parsePayout("", 3).multiplier, 5);
    assert.match(parsePayout("", 4).label, /PrizePicks/);
  });

  it("calls Play when all-hit is well above the payout breakeven", () => {
    const analysis = analyzeEntry(
      [
        qbLeg("a", "Miami", 0.72),
        qbLeg("b", "Clemson", 0.7),
        qbLeg("c", "Duke", 0.68),
        qbLeg("d", "NC State", 0.7),
      ],
      { payout: "10x" }
    );
    assert.equal(analysis.value.payout.decimal, 10);
    assert.ok(analysis.value.pUse > analysis.value.breakeven);
    assert.equal(analysis.value.verdict, "play");
  });

  it("calls Pass when modeled all-hit cannot cover 10x", () => {
    const analysis = analyzeEntry(
      [
        qbLeg("a", "Miami", 0.52),
        qbLeg("b", "Clemson", 0.51),
        qbLeg("c", "Duke", 0.5),
        qbLeg("d", "NC State", 0.51),
      ],
      { payout: "10x" }
    );
    assert.equal(analysis.value.verdict, "pass");
    assert.ok(analysis.value.ev < 0);
  });

  // Overconfidence is now handled by calibration rather than by a confidence
  // haircut, and the served probability is capped at 97% for catastrophe risk.
  // What value.js still owes is not taking an unusual line at face value.
  it("does not treat a 100% D-confidence goblin as a lock", () => {
    const raw = conservativePHit({ pHit: 1, confidence: "D", flags: ["Unusual Line"] });
    assert.ok(raw < 0.9, `unusual-line goblin not discounted: ${raw}`);
    assert.ok(raw > conservativePHit({ pHit: 0.8, confidence: "D", flags: ["Unusual Line"] }));
    const analysis = analyzeEntry(
      [
        qbLeg("a", "Clemson", 1, { confidence: "D", flags: ["Unusual Line"] }),
        qbLeg("b", "Miami", 0.55),
      ],
      { payout: "3x" }
    );
    assert.ok(analysis.value.pUse < 0.55);
  });
});

describe("rushing / passing / TD props", () => {
  it("evaluates a veteran rushing-yards prop", () => {
    const bundle = toneyBundle();
    bundle.player = { id: "rb1", name: "Veteran RB", team: "Miami", position: "RB" };
    bundle.gameLogs = Array.from({ length: 10 }, (_, i) =>
      log(i + 1, "Opp", { rush_yds: 80 + i, rush_att: 16, rush_td: 1, rec_yds: 10, rec: 1 })
    );
    bundle.priorLogs = Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Opp", { rush_yds: 78, rush_att: 15, rush_td: 1 })
    );
    bundle.usage = { games: 10, rec: 1, recYds: 10, rushAtt: 16, rushYds: 85, passAtt: 0, rushTd: 1 };
    bundle.usageL3 = { games: 3, rec: 1, recYds: 10, rushAtt: 17, rushYds: 90, passAtt: 0 };
    bundle.flags = [];
    const result = evaluateFromBundle(bundle, { statId: "rush_yds", line: 74.5, side: "more" });
    assert.ok(result.projection > 60);
    assert.ok(result.form.games >= 8);
    assert.ok(result.confidence !== "D");
  });

  it("evaluates a passing-yards prop and a TD prop without crashing", () => {
    const bundle = toneyBundle();
    bundle.player = { id: "qb1", name: "QB", team: "Miami", position: "QB" };
    bundle.gameLogs = Array.from({ length: 6 }, (_, i) =>
      log(i + 1, "Opp", { pass_yds: 240 + i * 5, pass_att: 32, pass_comp: 20, pass_td: 2, pass_int: 0, rush_yds: 20 })
    );
    bundle.priorLogs = Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Opp", { pass_yds: 230, pass_att: 31, pass_comp: 19, pass_td: 1.8, pass_int: 0.6 })
    );
    bundle.usage = { games: 6, passAtt: 32, passYds: 250, rec: 0, recYds: 0, rushAtt: 5, rushYds: 20, passTd: 2 };
    bundle.usageL3 = bundle.usage;
    bundle.flags = [];
    const pass = evaluateFromBundle(bundle, { statId: "pass_yds", line: 249.5, side: "more" });
    const td = evaluateFromBundle(bundle, { statId: "pass_td", line: 1.5, side: "more" });
    assert.ok(Number.isFinite(pass.projection));
    assert.ok(Number.isFinite(td.pMore));
    assert.equal(td.stat.id, "pass_td");
  });

  it("does not project 55 completions from the passing-yards prior", () => {
    const bundle = toneyBundle();
    bundle.player = { id: "qb1", name: "Tait Reynolds", team: "Clemson", position: "QB" };
    bundle.gameLogs = [
      log(1, "North Carolina", { pass_yds: 248, pass_td: 2 }),
      log(2, "Georgia Tech", { pass_yds: 261, pass_td: 1 }),
    ];
    bundle.priorLogs = [];
    bundle.priorOverview = { games: 0 };
    bundle.currentOverview = { games: 2, team: "Clemson", name: "Tait Reynolds", position: "QB" };
    bundle.usage = { games: 2, passAtt: 0, passYds: 254, rec: 0, recYds: 0, rushAtt: 4, rushYds: 12, passTd: 1.5 };
    bundle.usageL3 = bundle.usage;
    bundle.flags = ["Small Sample", "Missing Prior"];
    const result = evaluateFromBundle(bundle, { statId: "pass_comp", line: 13.5, side: "more" });
    assert.ok(result.projection < 32, `completions projection ${result.projection} used a yards-scale prior`);
    assert.ok(result.projection > 10);
    assert.ok(result.projection < 40);
  });

  it("evaluates field-goal and kicking-point props", () => {
    const bundle = toneyBundle();
    bundle.player = { id: "k1", name: "Will Hart", team: "Miami", position: "K" };
    bundle.gameLogs = [
      log(1, "Notre Dame", { fg_made: 2, fg_att: 3, xp_made: 3, kicking_pts: 9 }),
      log(2, "South Florida", { fg_made: 1, fg_att: 1, xp_made: 4, kicking_pts: 7 }),
      log(3, "Florida State", { fg_made: 2, fg_att: 2, xp_made: 2, kicking_pts: 8 }),
    ];
    bundle.priorLogs = Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Prior", { fg_made: 1.5, fg_att: 2, xp_made: 3, kicking_pts: 7.5 })
    );
    bundle.usage = { games: 3, fgMade: 1.67, fgAtt: 2, xpMade: 3, kickingPts: 8, rec: 0, recYds: 0, rushAtt: 0, rushYds: 0, passAtt: 0 };
    bundle.usageL3 = bundle.usage;
    bundle.flags = [];
    const fg = evaluateFromBundle(bundle, { statId: "fg_made", line: 1.5, side: "more" });
    const pts = evaluateFromBundle(bundle, { statId: "kicking_pts", line: 7.5, side: "more" });
    assert.equal(fg.stat.id, "fg_made");
    assert.equal(pts.stat.id, "kicking_pts");
    assert.ok(fg.projection > 0.5 && fg.projection < 4);
    assert.ok(pts.projection > 4 && pts.projection < 14);
    assert.ok(Number.isFinite(fg.pMore));
    assert.ok(Number.isFinite(pts.pMore));
  });
});
