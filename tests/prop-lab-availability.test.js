/**
 * Availability context: ESPN news phrases and missed-game inference.
 * Run: node --test tests/prop-lab-availability.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab");
const { resolveAvailability, adjustmentFor } = require(path.join(root, "availability"));
const { normalizeArticles } = require(path.join(root, "data", "espn", "news"));
const { evaluateFromBundle } = require(path.join(root, "evaluate"));
const { bestN } = require(path.join(root, "entry"));

const NOW = Date.parse("2026-11-06T12:00:00Z");

function article(partial) {
  return {
    headline: "",
    description: "",
    published: "2026-11-06T03:46:02Z",
    sourceUrl: "https://www.espn.com/college-football/story/_/id/1",
    categories: [],
    ...partial,
  };
}

function bundle(extra = {}) {
  return {
    player: { id: "toney", name: "Malachi Toney", team: "Miami", position: "WR" },
    opponent: { name: "Wake Forest", homeAway: "away", week: 6, isFcs: false },
    gameLogs: [
      { week: 1, opponent: "A", stats: { rec_yds: 80, rec: 6 }, isFcs: false },
      { week: 2, opponent: "B", stats: { rec_yds: 70, rec: 5 }, isFcs: false },
      { week: 3, opponent: "C", stats: { rec_yds: 90, rec: 7 }, isFcs: false },
      { week: 4, opponent: "D", stats: { rec_yds: 60, rec: 4 }, isFcs: false },
    ],
    priorLogs: [],
    usage: { games: 4, rec: 5.5, recYds: 75, rushAtt: 0, passAtt: 0 },
    usageL3: { games: 3, rec: 5.3, recYds: 73, rushAtt: 0, passAtt: 0 },
    teamOffense: { games: 4, passattempts: 30, rushingattempts: 30 },
    teamAdv: {},
    oppDefense: {},
    leagueTeamStats: new Map(),
    leagueAdvanced: new Map(),
    flags: [],
    market: { spread: -3, total: 48 },
    ...extra,
  };
}

describe("news classification", () => {
  it("marks a season-ending report as out and blocks the bet", () => {
    const resolved = resolveAvailability({
      playerName: "Hollywood Smothers",
      now: NOW,
      articles: [
        article({
          headline: "Source: Texas RB Hollywood Smothers done for season with torn MCL",
          description: "Hollywood Smothers will miss the rest of the season for the Longhorns.",
          categories: ["Hollywood Smothers", "Texas Longhorns"],
        }),
      ],
    });
    assert.equal(resolved.status, "out");
    assert.equal(resolved.evidence, "news");
    const adj = adjustmentFor(resolved, { projection: 72, family: "rushing", usage: { rushAtt: 14 } });
    assert.equal(adj.blockBet, true);
    assert.equal(adj.projection, 72);
    assert.deepEqual(adj.flags, ["Unavailable"]);
  });

  it("uses a player tag plus last name when the headline drops the first name", () => {
    const resolved = resolveAvailability({
      playerName: "Hollywood Smothers",
      now: NOW,
      articles: [
        article({
          headline: "Smothers ruled out against Missouri",
          description: "Williams is questionable. Smothers will not play.",
          categories: ["Hollywood Smothers"],
        }),
      ],
    });
    assert.equal(resolved.status, "out");
  });

  it("does not let a teammate's injury sentence decide this player", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      articles: [
        article({
          headline: "Source: Texas RB Hollywood Smothers done for season with torn MCL",
          description: "Hollywood Smothers will miss the rest of the season. Malachi Toney is questionable for Saturday.",
          categories: ["Malachi Toney"],
        }),
      ],
    });
    assert.equal(resolved.status, "questionable");
    const adj = adjustmentFor(resolved, { projection: 100, family: "receiving", usage: { rec: 5 } });
    assert.equal(adj.blockBet, false);
    assert.ok(Math.abs(adj.projection - 92) < 0.01);
    assert.equal(adj.sdScale, 1.15);
  });

  it("lets a newer return clear an older out report", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      articles: [
        article({
          published: "2026-11-01T12:00:00Z",
          headline: "Malachi Toney ruled out against Wake Forest",
          description: "Malachi Toney will not play.",
        }),
        article({
          published: "2026-11-06T12:00:00Z",
          headline: "Malachi Toney cleared to play",
          description: "Malachi Toney is expected to play Saturday.",
        }),
      ],
    });
    assert.equal(resolved.status, "returning");
  });

  it("ignores a years-old injury item", () => {
    const resolved = resolveAvailability({
      playerName: "Kahleil Jackson",
      now: NOW,
      articles: [
        article({
          published: "2020-11-21T18:31:00Z",
          headline: "Kahleil Jackson is inactive for Saturday",
          description: "Kahleil Jackson will not play.",
        }),
      ],
    });
    assert.equal(resolved.status, "none");
  });

  it("keeps a season-ending report from earlier in the season", () => {
    const resolved = resolveAvailability({
      playerName: "Hollywood Smothers",
      now: NOW,
      articles: [
        article({
          published: "2026-09-10T12:00:00Z",
          headline: "Hollywood Smothers done for the season with torn MCL",
          description: "Hollywood Smothers will miss the rest of the season.",
        }),
      ],
    });
    assert.equal(resolved.status, "out");
  });

  it("lifts a reserve only when a report names that player the starter", () => {
    const named = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      articles: [
        article({
          headline: "Malachi Toney named the starter",
          description: "Malachi Toney will start at receiver this week.",
        }),
      ],
    });
    const reserve = adjustmentFor(named, { projection: 40, family: "receiving", usage: { rec: 1.2 } });
    assert.equal(reserve.status, "new_starter");
    assert.ok(Math.abs(reserve.projection - 44.8) < 0.01);
    assert.ok(reserve.flags.includes("New Starter"));

    const alreadyStarting = adjustmentFor(named, {
      projection: 40,
      family: "receiving",
      usage: { rec: 6 },
    });
    assert.equal(alreadyStarting.status, "none");
    assert.equal(alreadyStarting.projection, 40);
    assert.deepEqual(alreadyStarting.flags, []);
  });
});

describe("game-log gaps", () => {
  it("cuts a regular who missed the last completed game", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      week: 6,
      gameLogs: [1, 2, 3, 4].map((week) => ({ week })),
      schedule: [1, 2, 3, 4, 5].map((week) => ({ week, completed: true })),
    });
    assert.equal(resolved.status, "possible_absence");
    assert.equal(resolved.evidence, "game_log");
    const adj = adjustmentFor(resolved, { projection: 100, family: "receiving", usage: { rec: 5 } });
    assert.ok(Math.abs(adj.projection - 88) < 0.01);
  });

  it("cuts harder after two missed games", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      week: 6,
      gameLogs: [1, 2, 3].map((week) => ({ week })),
      schedule: [1, 2, 3, 4, 5].map((week) => ({ week, completed: true })),
    });
    const adj = adjustmentFor(resolved, { projection: 100, family: "receiving", usage: { rec: 5 } });
    assert.equal(resolved.recentMissed, 2);
    assert.ok(Math.abs(adj.projection - 80) < 0.01);
  });

  it("does not invent an absence for a part-time player", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      week: 6,
      gameLogs: [{ week: 2 }],
      schedule: [1, 2, 3, 4, 5].map((week) => ({ week, completed: true })),
    });
    assert.equal(resolved.status, "none");
  });

  it("notes a return after a gap without moving the projection", () => {
    const resolved = resolveAvailability({
      playerName: "Malachi Toney",
      now: NOW,
      week: 6,
      gameLogs: [1, 2, 3, 5].map((week) => ({ week })),
      schedule: [1, 2, 3, 4, 5].map((week) => ({ week, completed: true })),
    });
    assert.equal(resolved.status, "returning");
    assert.equal(resolved.evidence, "game_log");
    const adj = adjustmentFor(resolved, { projection: 70, family: "receiving", usage: { rec: 5 } });
    assert.equal(adj.projection, 70);
    assert.ok(adj.flags.includes("Returning"));
  });
});

describe("evaluation", () => {
  it("passes an out player without turning the under into a win", () => {
    const base = evaluateFromBundle(bundle(), { statId: "rec_yds", line: 60.5, side: "less", skipSims: true });
    const out = evaluateFromBundle(
      bundle({
        availability: resolveAvailability({
          playerName: "Malachi Toney",
          now: NOW,
          articles: [
            article({
              headline: "Malachi Toney ruled out",
              description: "Malachi Toney will not play Saturday.",
            }),
          ],
        }),
      }),
      { statId: "rec_yds", line: 60.5, side: "less", skipSims: true }
    );
    assert.equal(out.doNotBet, true);
    assert.equal(out.propScore, 0);
    assert.equal(out.propScoreLabel, "Pass");
    assert.equal(out.lean, "pass");
    assert.ok(out.flags.includes("Unavailable"));
    assert.equal(out.projection, base.projection);
    assert.ok(out.caution[0].includes("Reported out"));
    assert.equal(out.why.length, 0);
  });

  it("drops a reported-out leg from the recommended set", () => {
    const keep = { player: { id: "a", name: "A" }, propScore: 70, pHit: 0.6, doNotBet: false };
    const out = {
      player: { id: "b", name: "Hollywood Smothers" },
      propScore: 80,
      pHit: 0.7,
      doNotBet: true,
      availability: { note: "Reported out." },
    };
    const result = bestN([keep, out], 1, "balanced");
    assert.equal(result.keep.length, 1);
    assert.equal(result.keep[0].player.id, "a");
    assert.equal(result.cut[0].player.id, "b");
    assert.match(result.cut[0].cutReason, /Reported out/);
  });
});

describe("espn news payload", () => {
  it("keeps the headline, description, and player category", () => {
    const rows = normalizeArticles({
      articles: [
        {
          headline: "Source: Texas RB Hollywood Smothers done for season with torn MCL",
          description: "Hollywood Smothers will miss the rest of the season.",
          published: "2026-11-06T03:46:02Z",
          links: { web: { href: "https://www.espn.com/college-football/story" } },
          categories: [{ description: "Hollywood Smothers" }, { description: "Texas Longhorns" }],
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].categories[0], "Hollywood Smothers");
    assert.equal(rows[0].sourceUrl, "https://www.espn.com/college-football/story");
  });
});
