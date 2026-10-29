const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab", "data");
const {
  mapPrizePicksStat,
  cleanTeamName,
  uniqueEvalTargets,
  selectBoardProps,
} = require(path.join(root, "prizepicks-mirror.js"));
const { cfbdMatchupEnabled } = require(path.join(root, "provider-mode.js"));

describe("prizepicks mirror mapping", () => {
  it("maps common PrizePicks labels", () => {
    assert.equal(mapPrizePicksStat("Pass Yards"), "pass_yds");
    assert.equal(mapPrizePicksStat("Rush Yards"), "rush_yds");
    assert.equal(mapPrizePicksStat("Receptions"), "rec");
    assert.equal(mapPrizePicksStat("Fantasy Score"), "fantasy_score");
    assert.equal(mapPrizePicksStat("FG Made"), "fg_made");
    assert.equal(mapPrizePicksStat("Rec TDs"), "rec_td");
    assert.equal(mapPrizePicksStat("Rush TDs"), "rush_td");
    assert.equal(mapPrizePicksStat("Pass+Rush Yds"), "pass_rush_yds");
    assert.equal(mapPrizePicksStat("Rush+Rec Yds"), "rush_rec_yds");
    assert.equal(mapPrizePicksStat("INT"), "pass_int");
    assert.equal(mapPrizePicksStat("Interceptions"), "pass_int");
    assert.equal(mapPrizePicksStat("PAT Made"), "xp_made");
    assert.equal(mapPrizePicksStat("Anytime TDs"), "total_td");
  });

  it("skips unsupported markets", () => {
    assert.equal(mapPrizePicksStat("Goblin Pass Yards"), null);
  });

  it("strips known mascot suffixes", () => {
    assert.equal(cleanTeamName("Liberty Flames"), "Liberty");
    assert.equal(cleanTeamName("Ole Miss"), "Ole Miss");
  });

  it("dedupes eval targets to one base line per player+stat", () => {
    const rows = uniqueEvalTargets([
      { playerName: "A", team: "X", statId: "pass_yds", line: 200.5, rank: 2, projectionId: "1", oddsType: "standard" },
      { playerName: "A", team: "X", statId: "pass_yds", line: 200.5, rank: 9, projectionId: "2", oddsType: "standard" },
      { playerName: "B", team: "Y", statId: "rush_yds", line: 80.5, rank: 1, projectionId: "3", oddsType: "standard" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].projectionId, "3");
  });

  it("grades only the base/standard line and drops goblin + demon variants", () => {
    const rows = selectBoardProps([
      {
        playerName: "Maiava",
        team: "USC",
        statId: "pass_yds",
        line: 199.5,
        oddsType: "standard",
        projectionId: "std",
      },
      {
        playerName: "Maiava",
        team: "USC",
        statId: "pass_yds",
        line: 0.5,
        oddsType: "goblin",
        projectionId: "gob",
      },
      {
        playerName: "Maiava",
        team: "USC",
        statId: "pass_yds",
        line: 249.5,
        oddsType: "demon",
        projectionId: "dem",
      },
      {
        playerName: "Maiava",
        team: "USC",
        statId: "pass_comp",
        line: 17.5,
        oddsType: "standard",
        projectionId: "comp",
      },
      {
        playerName: "Other",
        team: "X",
        statId: "rec_td",
        line: 0.5,
        oddsType: "demon",
        projectionId: "demon-only",
      },
    ]);
    const ids = rows.map((r) => r.projectionId).sort();
    assert.deepEqual(ids, ["comp", "std"]);
    assert.equal(rows.find((r) => r.projectionId === "std").line, 199.5);
  });

  it("uniqueEvalTargets also drops discounted and demon lines", () => {
    const rows = uniqueEvalTargets([
      { playerName: "A", team: "X", statId: "pass_yds", line: 210.5, oddsType: "standard", projectionId: "1" },
      { playerName: "A", team: "X", statId: "pass_yds", line: 0.5, oddsType: "goblin", projectionId: "2" },
      { playerName: "A", team: "X", statId: "pass_yds", line: 260.5, oddsType: "demon", projectionId: "3" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].projectionId, "1");
    assert.equal(rows[0].line, 210.5);
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
