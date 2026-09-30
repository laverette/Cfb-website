/**
 * ESPN matchup predictor unit tests.
 * Run: node --test tests/power-espn-matchup.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "power");

const {
  normalizeEspnMatchupPackage,
  hasEnoughMetrics,
  parseLastFive,
} = require(path.join(root, "espn-normalize"));
const {
  buildEspnRatingPair,
  offenseRatingFromMetrics,
  defenseRatingFromMetrics,
} = require(path.join(root, "espn-ratings"));
const { predictMatchup } = require(path.join(root, "predict"));
const { attachScoreAndMarket } = require(path.join(root, "predict-espn"));

function samplePackage({ neutral = false, includeTargetInLastFive = false } = {}) {
  return {
    header: {
      id: "401856707",
      season: { year: 2026 },
      week: { number: 5 },
      competitions: [
        {
          date: "2026-09-27T23:30Z",
          neutralSite: neutral,
          status: { type: { name: "STATUS_SCHEDULED", completed: false } },
          competitors: [
            {
              homeAway: "home",
              team: { id: "344", displayName: "Mississippi State Bulldogs", abbreviation: "MSST" },
            },
            {
              homeAway: "away",
              team: { id: "333", displayName: "Alabama Crimson Tide", abbreviation: "ALA" },
            },
          ],
        },
      ],
    },
    boxscore: {
      teams: [
        {
          team: { id: "333", displayName: "Alabama Crimson Tide" },
          statistics: [
            { name: "totalPointsPerGame", displayValue: "48.0" },
            { name: "yardsPerGame", displayValue: "471.5" },
            { name: "passingYardsPerGame", displayValue: "283.3" },
            { name: "rushingYardsPerGame", displayValue: "188.3" },
            { name: "totalPointsPerGameAllowed", displayValue: "20.3" },
            { name: "yardsPerGameAllowed", displayValue: "315.3" },
          ],
        },
        {
          team: { id: "344", displayName: "Mississippi State Bulldogs" },
          statistics: [
            { name: "totalPointsPerGame", displayValue: "43.0" },
            { name: "yardsPerGame", displayValue: "533.3" },
            { name: "passingYardsPerGame", displayValue: "315.5" },
            { name: "rushingYardsPerGame", displayValue: "217.8" },
            { name: "totalPointsPerGameAllowed", displayValue: "21.0" },
            { name: "yardsPerGameAllowed", displayValue: "353.8" },
          ],
        },
      ],
    },
    lastFiveGames: [
      {
        team: { id: "333", displayName: "Alabama" },
        events: [
          {
            id: "401856696",
            week: 4,
            gameDate: "2026-09-20T23:00Z",
            homeTeamId: "333",
            awayTeamId: "2579",
            homeTeamScore: "28",
            awayTeamScore: "14",
            gameResult: "W",
            opponent: { displayName: "South Carolina" },
          },
          ...(includeTargetInLastFive
            ? [
                {
                  id: "401856707",
                  week: 5,
                  gameDate: "2026-09-27T23:30Z",
                  homeTeamId: "344",
                  awayTeamId: "333",
                  homeTeamScore: "10",
                  awayTeamScore: "35",
                  gameResult: "W",
                  opponent: { displayName: "Mississippi State" },
                },
              ]
            : []),
        ],
      },
      {
        team: { id: "344", displayName: "Mississippi State" },
        events: [
          {
            id: "401899001",
            week: 4,
            gameDate: "2026-09-19T19:00Z",
            homeTeamId: "344",
            awayTeamId: "99",
            homeTeamScore: "31",
            awayTeamScore: "17",
            gameResult: "W",
            opponent: { displayName: "Dummy" },
          },
        ],
      },
    ],
    pickcenter: [
      {
        details: "ALA -6",
        overUnder: 59.5,
        spread: 6,
        awayTeamOdds: { favorite: true, team: { id: "333" } },
        homeTeamOdds: { favorite: false, team: { id: "344" } },
        pointSpread: {
          away: { close: { line: "-6" } },
          home: { close: { line: "+6" } },
        },
      },
    ],
    predictor: {
      header: "Matchup Predictor",
      homeTeam: { id: "344", gameProjection: "25.9" },
      awayTeam: { id: "333", gameProjection: "74.2" },
    },
  };
}

describe("ESPN matchup normalize", () => {
  it("parses away/home from homeAway (not array order)", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), { eventId: "401856707" });
    assert.equal(input.awayTeam.espnId, "333");
    assert.equal(input.homeTeam.espnId, "344");
    assert.equal(input.awayTeam.name.includes("Alabama"), true);
    assert.equal(input.homeTeam.name.includes("Mississippi State"), true);
    assert.equal(input.venue, "b_home");
    assert.equal(input.neutralSite, false);
  });

  it("handles neutral sites", () => {
    const input = normalizeEspnMatchupPackage(samplePackage({ neutral: true }), {
      eventId: "401856707",
    });
    assert.equal(input.neutralSite, true);
    assert.equal(input.venue, "neutral");
  });

  it("assigns market spread to the favorite correctly", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), {
      eventId: "401856707",
      marketBettingLine: 6, // home-oriented: away favored by 6
    });
    assert.equal(input.marketSpreadAway, -6);
    assert.match(input.marketSpreadLabel, /ALA/);
  });

  it("uses ESPN pickcenter favorite when no weekly line", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), { eventId: "401856707" });
    assert.equal(input.marketSpreadAway, -6);
  });

  it("maps missing metrics as null, not 0", () => {
    const pkg = samplePackage();
    pkg.boxscore.teams[0].statistics = [{ name: "totalPointsPerGame", displayValue: "48.0" }];
    const input = normalizeEspnMatchupPackage(pkg, { eventId: "401856707" });
    assert.equal(input.awayTeam.metrics.pointsPerGame, 48);
    assert.equal(input.awayTeam.metrics.yardsPerGame, null);
    assert.equal(input.awayTeam.metrics.pointsAllowedPerGame, null);
  });

  it("excludes the target event from recent form", () => {
    const form = parseLastFive(samplePackage({ includeTargetInLastFive: true }).lastFiveGames, "333", {
      beforeMs: Date.parse("2026-09-27T23:30Z"),
      excludeEventId: "401856707",
    });
    assert.equal(form.games.some((g) => g.eventId === "401856707"), false);
    assert.ok(form.games.length >= 1);
  });

  it("hasEnoughMetrics requires both sides", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), { eventId: "401856707" });
    assert.equal(hasEnoughMetrics(input), true);
    input.homeTeam.metrics = { pointsPerGame: null, yardsPerGame: null };
    assert.equal(hasEnoughMetrics(input), false);
  });
});

describe("ESPN ratings + predict", () => {
  it("builds rating rows and predicts without treating null as zero offense", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), {
      eventId: "401856707",
      marketBettingLine: 6,
    });
    const { teamA, teamB, venue } = buildEspnRatingPair(input);
    assert.equal(venue, "b_home");
    assert.ok(Number.isFinite(teamA.rawPower));
    assert.ok(Number.isFinite(teamB.rawPower));
    assert.ok(offenseRatingFromMetrics(input.awayTeam.metrics) != null);
    assert.ok(defenseRatingFromMetrics(input.homeTeam.metrics) != null);

    const prediction = predictMatchup({ teamA, teamB, venue });
    attachScoreAndMarket(prediction, input);
    assert.ok(prediction.predictedWinner?.name);
    assert.ok(prediction.projectedScore?.away > 0);
    assert.ok(prediction.projectedScore?.home > 0);
    assert.ok(Number.isFinite(prediction.winProbabilityA));
    assert.ok(Number.isFinite(prediction.projectedMargin));
    assert.equal(prediction.marketSpreadAway, -6);
    assert.ok(Number.isFinite(prediction.spreadEdge));
  });

  it("applies home-field to Mississippi State (b_home)", () => {
    const input = normalizeEspnMatchupPackage(samplePackage(), { eventId: "401856707" });
    const { teamA, teamB, venue } = buildEspnRatingPair(input);
    const withHome = predictMatchup({ teamA, teamB, venue: "b_home" });
    const neutral = predictMatchup({ teamA, teamB, venue: "neutral" });
    assert.equal(venue, "b_home");
    assert.ok(withHome.venueAdjustment < 0); // favors team B (home)
    assert.equal(neutral.venueAdjustment, 0);
    assert.ok(withHome.projectedMargin < neutral.projectedMargin);
  });
});

describe("power-matchup CFBD guard", () => {
  it("ESPN predict path never requires ingestSeasonFromCfbd", () => {
    // Structural guard: power-matchup.js must not import ingestSeasonFromCfbd.
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "power-matchup.js"),
      "utf8"
    );
    assert.equal(src.includes("ingestSeasonFromCfbd"), false);
    assert.equal(src.includes("collegefootballdata"), false);
    assert.equal(src.includes("CFBD_API_KEY"), false);
    assert.match(src, /predictMatchupFromEspn/);
  });
});
