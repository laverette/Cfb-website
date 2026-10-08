const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab", "data");
const {
  mapPrizePicksStat,
  cleanTeamName,
  uniqueEvalTargets,
} = require(path.join(root, "prizepicks-mirror.js"));
const { cfbdMatchupEnabled } = require(path.join(root, "provider-mode.js"));

describe("prizepicks mirror mapping", () => {
  it("maps common PrizePicks labels", () => {
    assert.equal(mapPrizePicksStat("Pass Yards"), "pass_yds");
    assert.equal(mapPrizePicksStat("Rush Yards"), "rush_yds");
    assert.equal(mapPrizePicksStat("Receptions"), "rec");
    assert.equal(mapPrizePicksStat("Fantasy Score"), "fantasy_score");
  });

  it("skips unsupported markets", () => {
    assert.equal(mapPrizePicksStat("Anytime TDs"), null);
    assert.equal(mapPrizePicksStat("Goblin Pass Yards"), null);
  });

  it("strips known mascot suffixes", () => {
    assert.equal(cleanTeamName("Liberty Flames"), "Liberty");
    assert.equal(cleanTeamName("Ole Miss"), "Ole Miss");
  });

  it("dedupes eval targets", () => {
    const rows = uniqueEvalTargets([
      { playerName: "A", team: "X", statId: "pass_yds", line: 200.5, rank: 2, projectionId: "1" },
      { playerName: "A", team: "X", statId: "pass_yds", line: 200.5, rank: 9, projectionId: "2" },
      { playerName: "B", team: "Y", statId: "rush_yds", line: 80.5, rank: 1, projectionId: "3" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].projectionId, "3");
  });
});

describe("provider matchup default", () => {
  it("defaults CFBD matchup snapshot on", () => {
    const prev = process.env.PROP_LAB_CFBD_MATCHUP;
    delete process.env.PROP_LAB_CFBD_MATCHUP;
    assert.equal(cfbdMatchupEnabled("espn"), true);
    process.env.PROP_LAB_CFBD_MATCHUP = "0";
    assert.equal(cfbdMatchupEnabled("espn"), false);
    if (prev == null) delete process.env.PROP_LAB_CFBD_MATCHUP;
    else process.env.PROP_LAB_CFBD_MATCHUP = prev;
  });
});
