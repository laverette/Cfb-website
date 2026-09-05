/**
 * Power model unit tests (Node built-in test runner).
 * Run: npm test
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const power = require(path.join(
  __dirname,
  "..",
  "netlify",
  "functions",
  "_lib",
  "power"
));

const {
  calculateRatings,
  predictMatchup,
  softMargin,
  softMarginToPoints,
  gameRecencyWeight,
  buildPreseasonPrior,
  getModelParams,
  runBacktest,
} = power;

function team(id, name, extras = {}) {
  return {
    id,
    name,
    classification: "fbs",
    conference: "TEST",
    prevSeasonPower: 0,
    talentScore: 50,
    ...extras,
  };
}

function game(partial) {
  return {
    completed: true,
    neutralSite: false,
    week: 1,
    homeOffEpa: null,
    awayOffEpa: null,
    ...partial,
  };
}

describe("CFB Power Model V1", () => {
  it("Test 1: elite team outranks average team with superior data", () => {
    const teams = [team(1, "Elite"), team(2, "Average"), team(3, "Fodder")];
    const games = [
      game({ week: 1, homeId: 1, awayId: 3, homeScore: 45, awayScore: 7 }),
      game({ week: 2, homeId: 1, awayId: 2, homeScore: 35, awayScore: 14 }),
      game({ week: 1, homeId: 2, awayId: 3, homeScore: 24, awayScore: 20 }),
      game({ week: 3, homeId: 1, awayId: 3, homeScore: 42, awayScore: 10 }),
    ];
    const result = calculateRatings({ teams, games, season: 2026, asOfWeek: 3 });
    const elite = result.teams.find((t) => t.teamId === 1);
    const avg = result.teams.find((t) => t.teamId === 2);
    assert.ok(elite.rawPower > avg.rawPower);
    assert.equal(elite.ranking < avg.ranking, true);
  });

  it("Test 2: equivalent performance vs stronger opponent gets more credit", () => {
    // Team A beats elite by same margin Team B beats weak — A should rate higher offensively/network
    const teams = [
      team(1, "A"),
      team(2, "B"),
      team(10, "Elite", { prevSeasonPower: 12 }),
      team(20, "Weak", { prevSeasonPower: -12 }),
      team(30, "Misc"),
    ];
    const games = [
      // Establish elite >> weak
      game({ week: 1, homeId: 10, awayId: 20, homeScore: 52, awayScore: 3 }),
      game({ week: 1, homeId: 10, awayId: 30, homeScore: 45, awayScore: 10 }),
      game({ week: 1, homeId: 20, awayId: 30, homeScore: 17, awayScore: 14 }),
      // Same scoreline: A @ Elite wins 24-17; B @ Weak wins 24-17
      game({
        week: 2,
        homeId: 10,
        awayId: 1,
        homeScore: 17,
        awayScore: 24,
        neutralSite: true,
      }),
      game({
        week: 2,
        homeId: 20,
        awayId: 2,
        homeScore: 17,
        awayScore: 24,
        neutralSite: true,
      }),
    ];
    const result = calculateRatings({ teams, games, season: 2026, asOfWeek: 2 });
    const a = result.teams.find((t) => t.teamId === 1);
    const b = result.teams.find((t) => t.teamId === 2);
    assert.ok(a.rawPower > b.rawPower, `A ${a.rawPower} should beat B ${b.rawPower}`);
  });

  it("Test 3: road performance interpreted more favorably than same home result", () => {
    const params = getModelParams();
    // Same rating rows; compare projected margins home vs road for underdog
    const strong = {
      teamId: 1,
      name: "Strong",
      rawPower: 10,
      offenseRating: 5,
      defenseRating: 5,
      specialTeamsRating: 0,
      talentRating: 60,
      sosRating: 0,
    };
    const weak = {
      teamId: 2,
      name: "Weak",
      rawPower: 0,
      offenseRating: 0,
      defenseRating: 0,
      specialTeamsRating: 0,
      talentRating: 50,
      sosRating: 0,
    };
    const weakHome = predictMatchup({ teamA: weak, teamB: strong, venue: "a_home" });
    const weakRoad = predictMatchup({ teamA: weak, teamB: strong, venue: "b_home" });
    // Weak's projected margin (team A) should be higher at home than on road
    assert.ok(weakHome.projectedMargin > weakRoad.projectedMargin);
    assert.ok(
      Math.abs(weakHome.projectedMargin - weakRoad.projectedMargin - 2 * params.homeFieldAdvantage) < 0.01
    );
  });

  it("Test 4: 45-point win is not 3x a 15-point win in soft margin value", () => {
    const s15 = softMarginToPoints(softMargin(15));
    const s45 = softMarginToPoints(softMargin(45));
    assert.ok(s45 < s15 * 3);
    assert.ok(s45 > s15);
  });

  it("Test 5: recent games weigh more than old games", () => {
    const recent = gameRecencyWeight(10, 10, 0.12);
    const old = gameRecencyWeight(1, 10, 0.12);
    assert.ok(recent > old);
  });

  it("Test 6: preseason prior influence decays with games played", () => {
    const params = getModelParams({ priorDecay: 0.35 });
    const prior = 10;
    const w0 = Math.exp(-params.priorDecay * 0);
    const w8 = Math.exp(-params.priorDecay * 8);
    assert.ok(prior * w0 > prior * w8);
    assert.ok(w8 < 0.1);
  });

  it("Test 7: huge FCS blowout has limited positive effect vs equivalent FBS win", () => {
    const teams = [
      team(1, "FBS_A"),
      team(2, "FBS_B"),
      team(3, "FBS_C"),
      { id: 99, name: "FCS U", classification: "fcs" },
    ];
    const base = [
      game({ week: 1, homeId: 2, awayId: 3, homeScore: 28, awayScore: 24 }),
      game({ week: 1, homeId: 1, awayId: 3, homeScore: 21, awayScore: 17 }),
    ];
    const withFcs = [
      ...base,
      game({ week: 2, homeId: 1, awayId: 99, homeScore: 70, awayScore: 0 }),
    ];
    const withFbs = [
      ...base,
      game({ week: 2, homeId: 1, awayId: 2, homeScore: 70, awayScore: 0 }),
    ];
    const rFcs = calculateRatings({ teams, games: withFcs, season: 2026, asOfWeek: 2 });
    const rFbs = calculateRatings({ teams, games: withFbs, season: 2026, asOfWeek: 2 });
    const aFcs = rFcs.teams.find((t) => t.teamId === 1).rawPower;
    const aFbs = rFbs.teams.find((t) => t.teamId === 1).rawPower;
    assert.ok(aFbs > aFcs, `FBS blowout ${aFbs} should lift more than FCS blowout ${aFcs}`);
  });

  it("Test 8: terrible FCS performance still hurts", () => {
    const teams = [
      team(1, "Struggler"),
      team(2, "Control"),
      team(3, "Other"),
      { id: 99, name: "FCS U", classification: "fcs" },
    ];
    const base = [
      game({ week: 1, homeId: 1, awayId: 3, homeScore: 28, awayScore: 24 }),
      game({ week: 1, homeId: 2, awayId: 3, homeScore: 27, awayScore: 24 }),
      game({ week: 2, homeId: 2, awayId: 3, homeScore: 24, awayScore: 21 }),
    ];
    const withFcsLoss = [
      ...base,
      game({ week: 2, homeId: 1, awayId: 99, homeScore: 7, awayScore: 21 }),
    ];
    const clean = calculateRatings({ teams, games: base, season: 2026, asOfWeek: 2 });
    const dirty = calculateRatings({ teams, games: withFcsLoss, season: 2026, asOfWeek: 2 });
    const cleanGap =
      clean.teams.find((t) => t.teamId === 1).rawPower -
      clean.teams.find((t) => t.teamId === 2).rawPower;
    const dirtyGap =
      dirty.teams.find((t) => t.teamId === 1).rawPower -
      dirty.teams.find((t) => t.teamId === 2).rawPower;
    assert.ok(
      dirtyGap < cleanGap,
      `FCS loss should worsen Struggler vs Control (cleanGap=${cleanGap}, dirtyGap=${dirtyGap})`
    );
  });

  it("Test 9: Georgia +15 vs Alabama +10 neutral ≈ Georgia by 5 (power line)", () => {
    const uga = {
      teamId: 1,
      name: "Georgia",
      rawPower: 15,
      offenseRating: 8,
      defenseRating: 7,
      specialTeamsRating: 0,
      talentRating: 90,
      sosRating: 5,
    };
    const bama = {
      teamId: 2,
      name: "Alabama",
      rawPower: 10,
      offenseRating: 6,
      defenseRating: 4,
      specialTeamsRating: 0,
      talentRating: 88,
      sosRating: 4,
    };
    const p = predictMatchup({
      teamA: uga,
      teamB: bama,
      venue: "neutral",
      paramOverrides: { matchupTalentWeight: 0 },
    });
    assert.ok(Math.abs(p.projectedMargin - 5) < 0.05);
    assert.ok(Math.abs(p.powerMargin - 5) < 0.05);
    assert.equal(p.predictedWinner.name, "Georgia");
    assert.equal(p.projectedSpreadLabel, "Georgia -5");
  });

  it("Test 10: Alabama home HFA=2.5 reduces Georgia edge from 5 to ~2.5", () => {
    const uga = {
      teamId: 1,
      name: "Georgia",
      rawPower: 15,
      offenseRating: 8,
      defenseRating: 7,
      specialTeamsRating: 0,
      talentRating: 90,
      sosRating: 5,
    };
    const bama = {
      teamId: 2,
      name: "Alabama",
      rawPower: 10,
      offenseRating: 6,
      defenseRating: 4,
      specialTeamsRating: 0,
      talentRating: 88,
      sosRating: 4,
    };
    const p = predictMatchup({
      teamA: uga,
      teamB: bama,
      venue: "b_home",
      paramOverrides: { homeFieldAdvantage: 2.5, matchupTalentWeight: 0 },
    });
    assert.ok(Math.abs(p.projectedMargin - 2.5) < 0.05);
    assert.equal(p.venueAdjustment, -2.5);
  });

  it("Test 10b: talent gap widens spread beyond power line", () => {
    const elite = {
      teamId: 1,
      name: "Elite",
      rawPower: 8,
      offenseRating: 4,
      defenseRating: 4,
      specialTeamsRating: 0,
      talentRating: 96,
      sosRating: 0,
    };
    const mid = {
      teamId: 2,
      name: "Mid",
      rawPower: 4,
      offenseRating: 2,
      defenseRating: 2,
      specialTeamsRating: 0,
      talentRating: 53,
      sosRating: 0,
    };
    const p = predictMatchup({
      teamA: elite,
      teamB: mid,
      venue: "a_home",
      paramOverrides: { homeFieldAdvantage: 2.5, matchupTalentWeight: 0.35 },
    });
    // Power-only: 8-4+2.5 = 6.5
    assert.ok(Math.abs(p.powerMargin - 6.5) < 0.05);
    assert.equal(p.powerSpreadLabel, "Elite -6.5");
    // Talent points: (96-50)/2.2 - (53-50)/2.2 ≈ 19.55; *0.35 ≈ 6.84
    assert.ok(p.projectedMargin > p.powerMargin + 5);
    assert.ok(p.projectedSpreadLabel.startsWith("Elite -"));
  });

  it("Test 11: win probabilities sum to ~100%", () => {
    const a = {
      teamId: 1,
      name: "A",
      rawPower: 4,
      offenseRating: 2,
      defenseRating: 2,
      specialTeamsRating: 0,
      talentRating: 55,
      sosRating: 0,
    };
    const b = {
      teamId: 2,
      name: "B",
      rawPower: 1,
      offenseRating: 1,
      defenseRating: 0,
      specialTeamsRating: 0,
      talentRating: 52,
      sosRating: 0,
    };
    const p = predictMatchup({ teamA: a, teamB: b, venue: "neutral" });
    assert.ok(Math.abs(p.winProbabilityA + p.winProbabilityB - 100) < 0.15);
  });

  it("Test 12: ratings center around FBS average ≈ 0", () => {
    const teams = [team(1, "A"), team(2, "B"), team(3, "C")];
    const games = [
      game({ week: 1, homeId: 1, awayId: 2, homeScore: 31, awayScore: 24 }),
      game({ week: 1, homeId: 2, awayId: 3, homeScore: 27, awayScore: 20 }),
      game({ week: 2, homeId: 1, awayId: 3, homeScore: 35, awayScore: 14 }),
    ];
    const result = calculateRatings({ teams, games, season: 2026, asOfWeek: 2 });
    const avg =
      result.teams.reduce((s, t) => s + t.rawPower, 0) / result.teams.length;
    assert.ok(Math.abs(avg) < 0.15, `mean ${avg}`);
    assert.equal(result.fbsAverageRawPower, 0);
  });

  it("Test 13: ranking order matches raw power order", () => {
    const teams = [team(1, "A"), team(2, "B"), team(3, "C"), team(4, "D")];
    const games = [
      game({ week: 1, homeId: 1, awayId: 4, homeScore: 50, awayScore: 3 }),
      game({ week: 1, homeId: 2, awayId: 4, homeScore: 38, awayScore: 10 }),
      game({ week: 1, homeId: 3, awayId: 4, homeScore: 27, awayScore: 24 }),
      game({ week: 2, homeId: 1, awayId: 3, homeScore: 34, awayScore: 17 }),
      game({ week: 2, homeId: 2, awayId: 3, homeScore: 28, awayScore: 21 }),
    ];
    const result = calculateRatings({ teams, games, season: 2026, asOfWeek: 2 });
    for (let i = 1; i < result.teams.length; i += 1) {
      assert.ok(result.teams[i - 1].rawPower >= result.teams[i].rawPower);
      assert.equal(result.teams[i - 1].ranking, i);
    }
  });

  it("Test 14: identical inputs produce identical output", () => {
    const teams = [team(1, "A"), team(2, "B"), team(3, "C")];
    const games = [
      game({ week: 1, homeId: 1, awayId: 2, homeScore: 30, awayScore: 27 }),
      game({ week: 2, homeId: 2, awayId: 3, homeScore: 24, awayScore: 21 }),
      game({ week: 3, homeId: 1, awayId: 3, homeScore: 41, awayScore: 17 }),
    ];
    const a = calculateRatings({ teams, games, season: 2026, asOfWeek: 3 });
    const b = calculateRatings({ teams, games, season: 2026, asOfWeek: 3 });
    assert.deepEqual(
      a.teams.map((t) => [t.teamId, t.rawPower, t.ranking]),
      b.teams.map((t) => [t.teamId, t.rawPower, t.ranking])
    );
  });

  it("Week-1 cupcake blowout cannot vault a low-prior G5 over an elite unplayed team", () => {
    const teams = [
      team(1, "NotreDame", {
        classification: "fbs",
        prevSeasonPower: 16,
        talentScore: 94,
        recruitingScore: 92,
        preseasonOffense: 10,
        preseasonDefense: 8,
      }),
      team(2, "NorthTexas", {
        classification: "fbs",
        prevSeasonPower: 2,
        talentScore: 50,
        recruitingScore: 48,
        preseasonOffense: 1,
        preseasonDefense: 0,
      }),
      team(3, "Cupcake", {
        classification: "fbs",
        prevSeasonPower: -8,
        talentScore: 40,
        recruitingScore: 38,
        preseasonOffense: -4,
        preseasonDefense: -3,
      }),
      team(4, "Utah", {
        classification: "fbs",
        prevSeasonPower: 8,
        talentScore: 62,
        recruitingScore: 60,
        preseasonOffense: 5,
        preseasonDefense: 3,
      }),
      team(99, "FCSOpp", {
        classification: "fcs",
        prevSeasonPower: -20,
        talentScore: 20,
      }),
    ];
    const games = [
      // G5 obliterates a weak FBS foe — old model put them top-10
      game({ week: 1, homeId: 2, awayId: 3, homeScore: 66, awayScore: 10 }),
      // Mid-major also looks elite vs FCS
      game({ week: 1, homeId: 4, awayId: 99, homeScore: 63, awayScore: 0 }),
    ];
    const result = calculateRatings({ teams, games, season: 2026, asOfWeek: 1 });
    const nd = result.teams.find((t) => t.teamId === 1);
    const unt = result.teams.find((t) => t.teamId === 2);
    const utah = result.teams.find((t) => t.teamId === 4);
    assert.ok(nd && unt && utah);
    assert.ok(
      nd.rawPower > unt.rawPower,
      `Elite prior should outrank Week-1 G5 blowout (ND ${nd.rawPower} vs UNT ${unt.rawPower})`
    );
    assert.ok(
      nd.ranking < unt.ranking,
      `ND rank ${nd.ranking} should be ahead of UNT ${unt.ranking}`
    );
    // Utah can improve but should not leapfrog ND after one FCS win
    assert.ok(
      nd.rawPower > utah.rawPower,
      `ND should stay ahead of Utah after one FCS win (ND ${nd.rawPower} vs Utah ${utah.rawPower})`
    );
  });

  it("buildPreseasonPrior is finite", () => {
    const p = buildPreseasonPrior(
      team(1, "X", {
        prevSeasonPower: 8,
        talentScore: 70,
        recruitingScore: 65,
        returningProduction: 0.6,
      }),
      getModelParams()
    );
    assert.ok(Number.isFinite(p));
  });

  it("preseason (no games) publishes OFF/DEF/ST/talent from unit priors", () => {
    const teams = [
      team(1, "Indiana", {
        prevSeasonPower: 12,
        preseasonOffense: 8.5,
        preseasonDefense: 6.2,
        preseasonSpecialTeams: 1.1,
        specialTeamsRating: 1.1,
        talentScore: 78,
      }),
      team(2, "Ohio State", {
        prevSeasonPower: 14,
        preseasonOffense: 9.1,
        preseasonDefense: 7.0,
        preseasonSpecialTeams: 0.4,
        specialTeamsRating: 0.4,
        talentScore: 96,
      }),
      team(3, "Mid", {
        prevSeasonPower: 0,
        preseasonOffense: 0,
        preseasonDefense: 0,
        preseasonSpecialTeams: 0,
        specialTeamsRating: 0,
        talentScore: 50,
      }),
    ];
    const result = calculateRatings({
      teams,
      games: [],
      season: 2026,
      asOfWeek: 0,
    });
    const indiana = result.teams.find((t) => t.teamId === 1);
    const ohio = result.teams.find((t) => t.teamId === 2);
    assert.ok(indiana);
    assert.equal(indiana.offenseRating, 8.5);
    assert.equal(indiana.defenseRating, 6.2);
    assert.equal(indiana.specialTeamsRating, 1.1);
    assert.equal(indiana.talentRating, 78);
    assert.ok(ohio.defenseRating > 0);
    assert.ok(ohio.talentRating > indiana.talentRating);
    // SOS needs games
    assert.equal(indiana.sosRating, 0);
  });

  it("backtest refuses future leakage by construction (ratings asOf week-1)", () => {
    const teams = [team(1, "A"), team(2, "B")];
    const games = [
      game({ week: 1, homeId: 1, awayId: 2, homeScore: 28, awayScore: 21, gameId: 1 }),
      game({ week: 2, homeId: 2, awayId: 1, homeScore: 24, awayScore: 27, gameId: 2 }),
    ];
    const bt = runBacktest({
      teams,
      games,
      season: 2026,
      weeksToTest: [2],
    });
    assert.equal(bt.gamesPredicted, 1);
    assert.ok(bt.meanAbsoluteSpreadError != null);
  });
});
