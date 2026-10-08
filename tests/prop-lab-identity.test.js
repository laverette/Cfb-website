/**
 * Prop Lab prop-identity / probability isolation / EV consistency regression tests.
 * Covers the class of bugs where one player's prop was evaluated or displayed as
 * another player's, and where distinct lines shared a capped probability.
 *
 * Run: node --test tests/prop-lab-identity.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const {
  propIdentityKey,
  legIdentity,
  isSameLeg,
  stampClientId,
  identityWarnings,
  identicalProbabilityWarnings,
  probabilityCacheKey,
  namesCompatible,
} = require(path.join(root, "prop-identity"));
const { evaluateFromBundle, relineEvaluation } = require(path.join(root, "evaluate"));
const { analyzeEntry } = require(path.join(root, "entry"));
const { probabilityAtLine } = require(path.join(root, "simulate"));
const {
  applyCalibrator,
  CATASTROPHE_CAP,
  HARD_CAP,
  effectiveProbabilityCap,
  IDENTITY,
} = require(path.join(root, "calibration"));
const { lineSanity } = require(path.join(root, "sanity"));
const { entryValue, parsePayout } = require(path.join(root, "value"));
const { isSameLeg: formatIsSameLeg, legIdentity: formatLegIdentity } = require(path.join(root, "format"));

function log(week, opponent, stats, extra = {}) {
  return {
    week,
    opponent,
    stats,
    isFcs: Boolean(extra.isFcs),
    points: extra.points ?? 30,
    oppPoints: extra.oppPoints ?? 24,
    homeAway: extra.homeAway || "home",
  };
}

function qbBundle({ id, name, team, meanYds = 250, meanComp = 20 } = {}) {
  const yds = [meanYds - 20, meanYds + 10, meanYds - 5, meanYds + 15];
  const comps = [meanComp - 2, meanComp + 1, meanComp, meanComp + 2];
  return {
    player: { id, name, team, position: "QB" },
    opponent: { name: "Wake Forest", homeAway: "home", week: 3, isFcs: false },
    gameLogs: yds.map((y, i) =>
      log(i + 1, `Opp ${i + 1}`, {
        pass_yds: y,
        pass_att: 32,
        pass_comp: comps[i],
        pass_td: 2,
        pass_int: 0,
      })
    ),
    priorLogs: Array.from({ length: 10 }, (_, i) =>
      log(i + 1, "Prior", {
        pass_yds: meanYds - 10 + (i % 3) * 8,
        pass_att: 30,
        pass_comp: meanComp,
        pass_td: 2,
        pass_int: 0.5,
      })
    ),
    currentOverview: { games: yds.length, team, name, position: "QB" },
    priorOverview: { games: 10, team, name, position: "QB" },
    usage: {
      games: yds.length,
      passAtt: 32,
      passYds: meanYds,
      passComp: meanComp,
      passTd: 2,
      rec: 0,
      recYds: 0,
      rushAtt: 4,
      rushYds: 12,
    },
    usageL3: {
      games: 3,
      passAtt: 32,
      passYds: meanYds,
      passComp: meanComp,
      passTd: 2,
      rec: 0,
      recYds: 0,
      rushAtt: 4,
      rushYds: 12,
    },
    teamOffense: { games: 4, passattempts: 130, completions: 85, rushingattempts: 120 },
    teamAdv: { offense: { plays: 260 } },
    oppDefense: {},
    leagueTeamStats: new Map([
      ["wake forest", { passyardsallowed: 230, rushingyardsallowed: 150 }],
      [String(team).toLowerCase(), { passyardsallowed: 210, rushingyardsallowed: 145 }],
    ]),
    leagueAdvanced: new Map(),
    flags: [],
    playerTeamRating: { name: team, rawPower: 8, offenseRating: 6 },
    oppRating: { name: "Wake Forest", rawPower: 2, defenseRating: 1, ranking: 55 },
  };
}

describe("prop identity keys", () => {
  it("never collides two players with the same stat/line/side", () => {
    const a = propIdentityKey({
      playerId: "stafford-1",
      playerName: "Matthew Stafford",
      team: "Los Angeles",
      statId: "pass_yds",
      line: 0.5,
      side: "more",
    });
    const b = propIdentityKey({
      playerId: "maiava-1",
      playerName: "Jayden Maiava",
      team: "USC",
      statId: "pass_yds",
      line: 0.5,
      side: "more",
    });
    assert.notEqual(a, b);
  });

  it("distinguishes two lines for the same player/stat", () => {
    const a = propIdentityKey({
      playerId: "maiava-1",
      statId: "pass_yds",
      line: 0.5,
      side: "more",
    });
    const b = propIdentityKey({
      playerId: "maiava-1",
      statId: "pass_yds",
      line: 199.5,
      side: "more",
    });
    assert.notEqual(a, b);
  });

  it("distinguishes identical lines for different players", () => {
    const a = legIdentity({ playerId: "a", statId: "pass_yds", line: 199.5, side: "more" });
    const b = legIdentity({ playerId: "b", statId: "pass_yds", line: 199.5, side: "more" });
    assert.notEqual(a, b);
    assert.equal(isSameLeg({ playerId: "a", statId: "pass_yds", line: 199.5, side: "more" }, { playerId: "a", statId: "pass_yds", line: 199.5, side: "more" }), true);
  });

  it("format.js re-exports the hardened identity helpers", () => {
    const a = { player: { id: "x" }, stat: { id: "pass_yds" }, line: 17.5, side: "more" };
    const b = { playerId: "x", statId: "pass_yds", line: 17.5, side: "more" };
    assert.equal(formatIsSameLeg(a, b), true);
    assert.ok(formatLegIdentity(a).includes("id:x"));
  });

  it("probability cache keys include player, stat, line, direction, and matchup", () => {
    const base = {
      playerId: "maiava-1",
      playerName: "Jayden Maiava",
      team: "USC",
      opponent: "Michigan",
      statId: "pass_yds",
      line: 199.5,
      side: "more",
      projection: 240,
      sd: 55,
      dist: "normal",
      modelVersion: "2.1.0",
    };
    const k1 = probabilityCacheKey(base);
    const k2 = probabilityCacheKey({ ...base, playerId: "stafford-1", playerName: "Matthew Stafford" });
    const k3 = probabilityCacheKey({ ...base, line: 0.5 });
    const k4 = probabilityCacheKey({ ...base, side: "less" });
    assert.notEqual(k1, k2);
    assert.notEqual(k1, k3);
    assert.notEqual(k1, k4);
  });
});

describe("Stafford + Maiava style entry identities", () => {
  it("keeps distinct players and distinct probabilities for PASS YDS 0.5 vs 199.5", () => {
    const stafford = evaluateFromBundle(
      qbBundle({ id: "qb-stafford", name: "Matthew Stafford", team: "Georgia", meanYds: 265 }),
      { statId: "pass_yds", line: 0.5, side: "more" }
    );
    const maiava = evaluateFromBundle(
      qbBundle({ id: "qb-maiava", name: "Jayden Maiava", team: "USC", meanYds: 255 }),
      { statId: "pass_yds", line: 199.5, side: "more" }
    );

    assert.equal(stafford.player.id, "qb-stafford");
    assert.equal(maiava.player.id, "qb-maiava");
    assert.notEqual(stafford.player.name, maiava.player.name);
    assert.equal(stafford.line, 0.5);
    assert.equal(maiava.line, 199.5);
    assert.ok(stafford.promotional, "0.5 QB pass yards should be flagged promotional");
    assert.ok(stafford.pHit > maiava.pHit + 0.005, `promo 0.5 (${stafford.pHit}) should beat 199.5 (${maiava.pHit})`);
    assert.notEqual(stafford.propIdentity, maiava.propIdentity);
  });

  it("keeps Stafford PASS YDS 0.5 and Maiava COMP 17.5 as independent legs", () => {
    const stafford = evaluateFromBundle(
      qbBundle({ id: "qb-stafford", name: "Matthew Stafford", team: "Georgia", meanYds: 265, meanComp: 22 }),
      { statId: "pass_yds", line: 0.5, side: "more" }
    );
    const maiava = evaluateFromBundle(
      qbBundle({ id: "qb-maiava", name: "Jayden Maiava", team: "USC", meanYds: 255, meanComp: 20 }),
      { statId: "pass_comp", line: 17.5, side: "more" }
    );
    assert.equal(stafford.stat.id, "pass_yds");
    assert.equal(maiava.stat.id, "pass_comp");
    assert.notEqual(stafford.player.id, maiava.player.id);
    assert.notEqual(Number(stafford.pHit.toFixed(4)), Number(maiava.pHit.toFixed(4)));
  });

  it("one player with two different pass-yard lines gets two probabilities", () => {
    const bundle = qbBundle({ id: "qb-maiava", name: "Jayden Maiava", team: "USC", meanYds: 255 });
    const low = evaluateFromBundle(bundle, { statId: "pass_yds", line: 0.5, side: "more" });
    const high = evaluateFromBundle(bundle, { statId: "pass_yds", line: 199.5, side: "more" });
    assert.ok(low.pHit > high.pHit + 0.005, `0.5=${low.pHit} should exceed 199.5=${high.pHit}`);
    const warnings = identicalProbabilityWarnings([
      { ...low, clientId: "a" },
      { ...high, clientId: "b" },
    ]);
    assert.equal(warnings.length, 0);
  });

  it("warns when the same player/stat returns identical pHit for far-apart lines", () => {
    const warnings = identicalProbabilityWarnings([
      {
        clientId: "a",
        player: { id: "qb1", name: "Test QB" },
        stat: { id: "pass_yds" },
        line: 0.5,
        side: "more",
        pHit: 0.97,
      },
      {
        clientId: "b",
        player: { id: "qb1", name: "Test QB" },
        stat: { id: "pass_yds" },
        line: 199.5,
        side: "more",
        pHit: 0.97,
      },
    ]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, "IDENTICAL_LINE_PROBABILITY");
  });
});

describe("promotional / discounted lines", () => {
  it("marks QB pass yards 0.5 as promotional without changing the player", () => {
    const s = lineSanity({
      statId: "pass_yds",
      line: 0.5,
      projection: 240,
      position: "QB",
    });
    assert.equal(s.unusual, true);
    assert.equal(s.promotional, true);
  });

  it("does not treat a normal 199.5 pass yards line as promotional", () => {
    const s = lineSanity({
      statId: "pass_yds",
      line: 199.5,
      projection: 240,
      position: "QB",
    });
    assert.equal(s.promotional, false);
  });
});

describe("catastrophe soft-cap differentiates extreme lines", () => {
  it("allows far-|z| probabilities above the soft catastrophe floor", () => {
    const near = applyCalibrator(IDENTITY, 0.999, { z: 0.5 });
    const far = applyCalibrator(IDENTITY, 0.999, { z: 8 });
    assert.ok(Math.abs(near - CATASTROPHE_CAP) < 1e-9, `near got ${near}`);
    assert.ok(far > CATASTROPHE_CAP + 0.005, `far should exceed soft cap, got ${far}`);
    assert.ok(far < HARD_CAP + 1e-9);
    assert.ok(effectiveProbabilityCap(CATASTROPHE_CAP, 8) > CATASTROPHE_CAP);
  });

  it("raw probabilityAtLine keeps 0.5 above 199.5 for a high projection", () => {
    const dist = { mean: 250, sd: 45, dist: "normal", reliability: 0.7, games: 4 };
    const p05 = probabilityAtLine(dist, 0.5, "more");
    const p199 = probabilityAtLine(dist, 199.5, "more");
    assert.ok(p05.pHit > p199.pHit + 0.005, `0.5=${p05.pHit} vs 199.5=${p199.pHit}`);
  });
});

describe("clientId stamping and identity warnings", () => {
  it("stampClientId preserves session identity across reline", () => {
    const base = evaluateFromBundle(
      qbBundle({ id: "qb-maiava", name: "Jayden Maiava", team: "USC" }),
      { statId: "pass_yds", line: 199.5, side: "more" }
    );
    const stamped = stampClientId(base, "leg_session_1");
    const next = stampClientId(relineEvaluation(stamped, 0.5, "more"), "leg_session_1");
    assert.equal(next.clientId, "leg_session_1");
    assert.equal(next.player.id, "qb-maiava");
    assert.equal(next.line, 0.5);
  });

  it("flags player id mismatches without rewriting them away", () => {
    const evaluation = evaluateFromBundle(
      qbBundle({ id: "qb-maiava", name: "Jayden Maiava", team: "USC" }),
      { statId: "pass_yds", line: 199.5, side: "more" }
    );
    const warnings = identityWarnings(
      { playerId: "qb-stafford", name: "Matthew Stafford", statId: "pass_yds", line: 0.5, side: "more" },
      evaluation
    );
    assert.ok(warnings.some((w) => w.code === "PLAYER_ID_MISMATCH"));
    assert.ok(warnings.some((w) => w.code === "PLAYER_NAME_MISMATCH"));
  });

  it("namesCompatible accepts partial typed search matches", () => {
    assert.equal(namesCompatible("Matthew Stafford", "Matthew Stafford"), true);
    assert.equal(namesCompatible("Stafford", "Matthew Stafford"), true);
    assert.equal(namesCompatible("Jayden Maiava", "Matthew Stafford"), false);
  });
});

describe("EV reconciles with pUse and multiplier", () => {
  it("uses EV = pUse * M - 1 for a Power Play payout", () => {
    const legs = [
      {
        clientId: "a",
        player: { id: "1", name: "A", team: "X" },
        opponent: { name: "Y" },
        stat: { id: "pass_yds", short: "PASS YDS" },
        line: 0.5,
        side: "more",
        pHit: 0.9,
        propScore: 80,
        confidence: "B",
        form: { games: 4 },
        flags: ["Unusual Line"],
      },
      {
        clientId: "b",
        player: { id: "2", name: "B", team: "Z" },
        opponent: { name: "W" },
        stat: { id: "pass_yds", short: "PASS YDS" },
        line: 199.5,
        side: "more",
        pHit: 0.62,
        propScore: 70,
        confidence: "B",
        form: { games: 4 },
        flags: [],
      },
    ];
    const analysis = analyzeEntry(legs, { payout: "3x" });
    const value = analysis.value;
    assert.ok(value);
    const m = value.payout.multiplier;
    assert.equal(m, 3);
    assert.ok(Math.abs(value.ev - (value.pUse * m - 1)) < 1e-6);
    assert.equal(value.breakeven, Number((1 / m).toFixed(4)));
    assert.ok(Array.isArray(value.legHitProbabilities));
    assert.equal(value.legHitProbabilities.length, 2);
    assert.notEqual(value.legHitProbabilities[0].playerId, value.legHitProbabilities[1].playerId);
    assert.ok(value.pIndependent != null);
    assert.ok(value.pCorrelated != null);
    assert.equal(value.evFormula, "pUse * payoutMultiplier - 1");
  });

  it("parsePayout maps 2-leg Power to 3x", () => {
    const p = parsePayout("", 2);
    assert.equal(p.multiplier, 3);
    assert.equal(p.source, "prizepicks_power");
  });
});

describe("cached probability calculations must not reuse by stat alone", () => {
  const cache = new Map();
  function cachedPHit(args) {
    const key = probabilityCacheKey(args);
    if (cache.has(key)) return cache.get(key);
    const p = probabilityAtLine(
      {
        mean: args.projection,
        sd: args.sd,
        dist: args.dist || "normal",
        reliability: 0.7,
        games: 4,
      },
      args.line,
      args.side
    ).pHit;
    cache.set(key, p);
    return p;
  }

  it("does not reuse Maiava 199.5 for Stafford 0.5", () => {
    cache.clear();
    const maiava = cachedPHit({
      playerId: "maiava",
      playerName: "Jayden Maiava",
      team: "USC",
      opponent: "Michigan",
      statId: "pass_yds",
      line: 199.5,
      side: "more",
      projection: 255,
      sd: 50,
      dist: "normal",
      modelVersion: "2.1.0",
    });
    const stafford = cachedPHit({
      playerId: "stafford",
      playerName: "Matthew Stafford",
      team: "Georgia",
      opponent: "Alabama",
      statId: "pass_yds",
      line: 0.5,
      side: "more",
      projection: 260,
      sd: 50,
      dist: "normal",
      modelVersion: "2.1.0",
    });
    assert.equal(cache.size, 2);
    assert.notEqual(maiava, stafford);
    assert.ok(stafford > maiava);
  });
});
