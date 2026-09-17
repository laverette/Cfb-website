/**
 * Prop Lab 2.1 polish invariants.
 * Run: npm test
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const { ordinal, dropdownPlacement, hitCountLabel, compactLegCaption, legCaption, isSameLeg } = require(path.join(root, "format"));
const { suggestWhatIfLines, isPlausibleWhatIf } = require(path.join(root, "whatif-lines"));
const { classifyPair, analyzeCorrelations } = require(path.join(root, "correlation"));
const { analyzeEntry, bestN } = require(path.join(root, "entry"));
const { evaluateFromBundle, relineEvaluation } = require(path.join(root, "evaluate"));
const { probabilityAtLine, probabilityCurve } = require(path.join(root, "simulate"));
const { PROP_MODEL_VERSION } = require(path.join(root, "version"));
const { lineSanity } = require(path.join(root, "sanity"));

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
      log(1, "Florida A&M", { rec_yds: 165, rec: 8, rec_td: 1 }, { isFcs: true }),
      log(2, "South Florida", { rec_yds: 165, rec: 7, rec_td: 2 }),
    ],
    priorLogs: Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Prior Opp", { rec_yds: 70 + (i % 3) * 8, rec: 5, rec_td: 0 })
    ),
    currentOverview: { games: 2, team: "Miami", name: "Malachi Toney", position: "WR" },
    priorOverview: { games: 12, team: "Miami" },
    usage: { games: 2, rec: 7.5, recYds: 165, rushAtt: 0.5, rushYds: 6, passAtt: 0, passYds: 0, recTd: 1.5 },
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

function qbBundle() {
  return {
    player: { id: "qb1", name: "Starter QB", team: "Duke", position: "QB" },
    opponent: { name: "Wake Forest", homeAway: "home", week: 3, isFcs: false },
    gameLogs: [
      log(1, "Clemson", { pass_yds: 260, pass_att: 34, pass_comp: 22, pass_td: 3, pass_int: 0 }),
      log(2, "NC State", { pass_yds: 248, pass_att: 31, pass_comp: 21, pass_td: 2, pass_int: 1 }),
    ],
    priorLogs: Array.from({ length: 12 }, (_, i) =>
      log(i + 1, "Prior", { pass_yds: 230, pass_att: 32, pass_comp: 20, pass_td: 2, pass_int: 0.7 })
    ),
    currentOverview: { games: 2, team: "Duke", name: "Starter QB", position: "QB" },
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
    playerTeamRating: { name: "Duke", rawPower: 4, offenseRating: 3 },
    oppRating: { name: "Wake Forest", rawPower: 2, defenseRating: 1, ranking: 55 },
  };
}

describe("model version", () => {
  it("is 2.1.0", () => {
    assert.equal(PROP_MODEL_VERSION, "2.1.0");
  });
});

describe("ordinal formatter", () => {
  it("handles 1st 2nd 3rd 4th and teens", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(2), "2nd");
    assert.equal(ordinal(3), "3rd");
    assert.equal(ordinal(4), "4th");
    assert.equal(ordinal(11), "11th");
    assert.equal(ordinal(12), "12th");
    assert.equal(ordinal(13), "13th");
    assert.equal(ordinal(21), "21st");
    assert.equal(ordinal(22), "22nd");
    assert.equal(ordinal(23), "23rd");
  });
});

describe("dropdown placement", () => {
  it("opens upward when there is not enough space below", () => {
    const up = dropdownPlacement({
      inputTop: 700,
      inputBottom: 740,
      inputLeft: 40,
      inputWidth: 280,
      viewportH: 800,
      viewportW: 1280,
    });
    assert.equal(up.openUp, true);
    assert.ok(up.bottom > 0);
    assert.equal(up.top, null);
  });

  it("opens downward when space below is ample", () => {
    const down = dropdownPlacement({
      inputTop: 80,
      inputBottom: 120,
      inputLeft: 40,
      inputWidth: 280,
      viewportH: 900,
      viewportW: 1280,
    });
    assert.equal(down.openUp, false);
    assert.ok(down.top > 120);
  });
});

describe("what-if line menus", () => {
  it("never auto-generates receiving TD 11.5", () => {
    const lines = suggestWhatIfLines("rec_td", 0.5);
    assert.ok(lines.includes(0.5));
    assert.ok(lines.includes(1.5));
    assert.ok(lines.includes(2.5));
    assert.ok(!lines.includes(11.5));
    assert.equal(isPlausibleWhatIf("rec_td", 11.5), false);
    assert.equal(isPlausibleWhatIf("rec_td", 0.5), true);
  });

  it("yards step ±10 / ±20", () => {
    const lines = suggestWhatIfLines("rec_yds", 60.5);
    assert.ok(lines.includes(40.5));
    assert.ok(lines.includes(50.5));
    assert.ok(lines.includes(70.5));
    assert.ok(lines.includes(80.5));
  });

  it("completions step ±2 / ±4", () => {
    const lines = suggestWhatIfLines("pass_comp", 21.5);
    assert.ok(lines.includes(17.5));
    assert.ok(lines.includes(19.5));
    assert.ok(lines.includes(23.5));
    assert.ok(lines.includes(25.5));
  });

  it("field goals, kicking points, and PATs use count steps", () => {
    const fg = suggestWhatIfLines("fg_made", 1.5);
    assert.ok(fg.includes(0.5));
    assert.ok(fg.includes(2.5));
    const pts = suggestWhatIfLines("kicking_pts", 8.5);
    assert.ok(pts.includes(6.5));
    assert.ok(pts.includes(10.5));
    const xp = suggestWhatIfLines("xp_made", 3.5);
    assert.ok(xp.includes(2.5));
    assert.ok(xp.includes(4.5));
  });

  it("longest pass and reception use yard steps like longest rush", () => {
    const pass = suggestWhatIfLines("pass_long", 24.5);
    assert.ok(pass.includes(19.5));
    assert.ok(pass.includes(29.5));
    const rec = suggestWhatIfLines("rec_long", 19.5);
    assert.ok(rec.includes(14.5));
    assert.ok(rec.includes(24.5));
  });
});

describe("hit-rate + FCS labeling", () => {
  it("emphasizes sample count under 5 games", () => {
    assert.match(hitCountLabel(2, 2), /2\/2/);
    assert.match(hitCountLabel(2, 2), /Small sample/);
  });

  it("quantifies FCS-heavy samples on Toney fixture", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 60, side: "more" });
    assert.equal(rec.fcs.games, 1);
    assert.equal(rec.fcs.of, 2);
    assert.ok((rec.flags || []).includes("FCS-Heavy Sample"));
    assert.ok(rec.gameLog.some((g) => g.isFcs));
  });
});

describe("strongest / weakest captions", () => {
  it("names the exact prop, not just the player", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec", line: 0.5, side: "more" });
    rec.clientId = "a";
    const td = evaluateFromBundle(toneyBundle(), { statId: "rec_td", line: 0.5, side: "more" });
    td.clientId = "b";
    const analysis = analyzeEntry([rec, td]);
    assert.match(analysis.strongestCaption, /Receptions|REC/i);
    assert.match(analysis.weakestCaption, /TD/i);
    assert.ok(analysis.strongestCaption.includes("Toney"));
    assert.ok(compactLegCaption(rec).includes("Score"));
    assert.ok(legCaption(td).includes("0.5"));
  });
});

describe("pair-specific correlations", () => {
  it("labels both legs", () => {
    const pair = classifyPair(
      {
        clientId: "a",
        player: { id: "toney", name: "Malachi Toney", team: "Miami" },
        stat: { id: "rec", short: "REC" },
        side: "more",
        line: 0.5,
      },
      {
        clientId: "b",
        player: { id: "toney", name: "Malachi Toney", team: "Miami" },
        stat: { id: "rec_yds", short: "REC YDS" },
        side: "more",
        line: 60,
      }
    );
    assert.match(pair.pairLabel, /Toney/);
    assert.match(pair.pairLabel, /REC/);
    assert.match(pair.category, /POSITIVE/);
    assert.equal(pair.heuristic, true);
  });
});

describe("duplicate-leg identity", () => {
  it("detects identical player/stat/line/side", () => {
    const a = { playerId: "toney", statId: "rec_yds", line: 60, side: "more" };
    const b = { player: { id: "toney" }, stat: { id: "rec_yds" }, line: 60, side: "more" };
    assert.equal(isSameLeg(a, b), true);
    assert.equal(isSameLeg(a, { ...b, line: 70 }), false);
  });
});

describe("Best-N correlation penalty", () => {
  it("will drop a highly correlated same-player leg for a healthier independent one", () => {
    const legs = [
      { clientId: "t-rec", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec", short: "REC" }, side: "more", line: 0.5, propScore: 81, confidence: "D", form: { games: 2 }, flags: ["Small Sample"] },
      { clientId: "t-yds", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec_yds", short: "REC YDS" }, side: "more", line: 60, propScore: 78, confidence: "D", form: { games: 2 }, flags: ["Small Sample"] },
      { clientId: "t-td", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec_td", short: "REC TD" }, side: "more", line: 0.5, propScore: 74, confidence: "D", form: { games: 2 }, flags: ["Small Sample", "High Variance"] },
      { clientId: "rb", player: { id: "rb1", name: "Other RB", team: "Clemson" }, stat: { id: "rush_yds", short: "RUSH YDS" }, side: "more", line: 72.5, propScore: 68, confidence: "B", form: { games: 8 }, flags: [] },
    ];
    const out = bestN(legs, 3, "balanced");
    assert.equal(out.keep.length, 3);
    assert.ok(out.keep.some((l) => l.clientId === "rb"), "independent RB should survive correlation-aware pick");
    assert.ok(out.why.length);
    assert.ok(out.cut.every((l) => l.cutReason && l.cutReason.length > 8));
  });
});

describe("entry analysis risk is not avg score only", () => {
  it("flags concentration on three same-player legs", () => {
    const legs = [
      { clientId: "a", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec" }, side: "more", propScore: 81, confidence: "D", form: { games: 2 }, flags: ["Small Sample"] },
      { clientId: "b", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec_yds" }, side: "more", propScore: 68, confidence: "D", form: { games: 2 }, flags: ["Small Sample"] },
      { clientId: "c", player: { id: "toney", name: "Toney", team: "Miami" }, stat: { id: "rec_td" }, side: "more", propScore: 56, confidence: "D", form: { games: 2 }, flags: ["Small Sample"] },
    ];
    const even = [
      { clientId: "x", player: { id: "1", name: "A", team: "Miami" }, stat: { id: "rec_yds" }, side: "more", propScore: 68, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "y", player: { id: "2", name: "B", team: "Clemson" }, stat: { id: "rush_yds" }, side: "more", propScore: 68, confidence: "B", form: { games: 8 }, flags: [] },
      { clientId: "z", player: { id: "3", name: "C", team: "Ohio State" }, stat: { id: "pass_yds" }, side: "more", propScore: 68, confidence: "B", form: { games: 8 }, flags: [] },
    ];
    const concentrated = analyzeEntry(legs);
    const balanced = analyzeEntry(even);
    assert.ok(concentrated.riskDrivers.some((d) => /same player/i.test(d)));
    assert.notEqual(concentrated.grade, balanced.grade);
    assert.match(String(concentrated.weakestCaption || concentrated.weakestLabel || ""), /td|rec_td/i);
  });
});

describe("distribution quality", () => {
  it("keeps P20 <= median <= P80 and a monotonic More curve", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 60, side: "more" });
    assert.ok(rec.range.p20 <= rec.median);
    assert.ok(rec.median <= rec.range.p80);
    assert.equal(typeof rec.modelDebug.sd, "number");
    assert.ok(rec.modelDebug.sdPack.final > 0);
    const curve = probabilityCurve(rec.distribution, [40.5, 50.5, 60.5, 70.5, 80.5], "more");
    for (let i = 1; i < curve.length; i += 1) {
      assert.ok(curve[i].pMore <= curve[i - 1].pMore + 1e-9);
    }
  });

  it("tiny QB completion line can legitimately exceed 90%", () => {
    const qb = evaluateFromBundle(qbBundle(), { statId: "pass_comp", line: 0.5, side: "more" });
    assert.ok(qb.pMore > 0.9);
    const sanity = lineSanity({ statId: "pass_comp", line: 0.5, projection: qb.projection, position: "QB" });
    assert.equal(sanity.unusual, true);
  });
});

describe("Toney coherence (not sacred exacts)", () => {
  it("receptions 0.5 More is high-probability with D confidence", () => {
    const rec = evaluateFromBundle(toneyBundle(), { statId: "rec", line: 0.5, side: "more" });
    assert.ok(rec.pMore > 0.9);
    assert.ok(["C", "D"].includes(rec.confidence));
    assert.ok(rec.propScore >= 70);
    assert.ok(rec.highProbLowConf || rec.pMore >= 0.8);
    assert.ok(rec.projection > 5);
  });

  it("receiving yards 60 More is clearly over, 98.5 is not 97%", () => {
    const easy = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 60, side: "more" });
    const hard = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 98.5, side: "more" });
    assert.ok(easy.pMore > 0.62);
    assert.ok(hard.pMore < 0.75, `98.5 More was ${hard.pMore}`);
    assert.ok(hard.projection < 151, `projection ${hard.projection} should not ignore prior`);
    assert.ok(easy.propScore > 50);
    assert.notEqual(easy.propScoreLabel, "Pass");
  });

  it("changing only the line does not change projection or confidence and needs no CFBD", () => {
    const base = evaluateFromBundle(toneyBundle(), { statId: "rec_yds", line: 60, side: "more" });
    const next = relineEvaluation(base, 80.5, "more");
    assert.equal(next.projection, base.projection);
    assert.equal(next.confidence, base.confidence);
    assert.ok(next.pMore < base.pMore);
    assert.equal(next.modelDebug.cacheSummary.cfbdRequests, 0);
  });
});

describe("one failed leg does not poison entry analysis", () => {
  it("analyzeEntry ignores error legs", () => {
    const ok = evaluateFromBundle(toneyBundle(), { statId: "rec", line: 0.5, side: "more" });
    ok.clientId = "ok";
    const analysis = analyzeEntry([ok, { error: "CFBD unavailable", clientId: "bad", player: { name: "X" } }]);
    assert.ok(analysis.grade);
    assert.equal(analysis.strongestCaption.includes("Toney"), true);
  });
});
