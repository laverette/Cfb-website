/**
 * Prop Lab opponent resolution regressions.
 * Kewan Lacy / Ole Miss / 2026 Week 4 → Florida (completed final).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  siteGameToResolved,
  eventToResolved,
  idEq,
  REASON,
} = require("../netlify/functions/_lib/prop-lab/data/opponent-resolve");
const { getTeamGameForWeek } = require("../netlify/functions/_lib/prop-lab/parse");

describe("idEq string/number ESPN ids", () => {
  it("matches string vs number", () => {
    assert.equal(idEq("145", 145), true);
    assert.equal(idEq(145, "145"), true);
    assert.equal(idEq("145", "145"), true);
    assert.equal(idEq(145, 57), false);
  });
});

describe("getTeamGameForWeek includes finals", () => {
  const schedule = [
    {
      week: 4,
      opponent: "Florida",
      completed: true,
      homeAway: "away",
      gameId: 401856699,
      startDate: "2026-09-26T19:30Z",
    },
    {
      week: 6,
      opponent: "Vanderbilt",
      completed: false,
      homeAway: "away",
      gameId: 401856718,
      startDate: "2026-10-10T19:30Z",
    },
  ];

  it("returns Florida for week 4 even when completed", () => {
    const hit = getTeamGameForWeek(schedule, 4);
    assert.ok(hit);
    assert.equal(hit.opponent, "Florida");
    assert.equal(hit.completed, true);
  });

  it("does not skip final games for historical weeks", () => {
    const hit = getTeamGameForWeek(schedule, 4);
    assert.notEqual(hit.opponent, "Vanderbilt");
  });
});

describe("siteGameToResolved Ole Miss @ Florida final", () => {
  const game = {
    home_team_espn_id: 57,
    away_team_espn_id: "145",
    home_team_name: "Florida",
    away_team_name: "Ole Miss",
    cfbd_game_id: 401856699,
    game_date: "2026-09-26T19:30Z",
    is_completed: true,
  };

  it("returns Florida when player team is Ole Miss (away) with string espn id", () => {
    const resolved = siteGameToResolved(game, "145", "Ole Miss", 2026, 4);
    assert.ok(resolved);
    assert.equal(resolved.status, "ok");
    assert.equal(resolved.opponent.name, "Florida");
    assert.equal(resolved.opponent.espnId, "57");
    assert.equal(resolved.homeAway, "away");
    assert.equal(resolved.completed, true);
    assert.equal(resolved.espnEventId, "401856699");
  });

  it("returns Ole Miss when player team is Florida (home) with numeric espn id", () => {
    const resolved = siteGameToResolved(game, 57, "Florida", 2026, 4);
    assert.ok(resolved);
    assert.equal(resolved.opponent.name, "Ole Miss");
    assert.equal(resolved.homeAway, "home");
  });
});

describe("eventToResolved final status", () => {
  const evt = {
    id: "401856699",
    date: "2026-09-26T19:30Z",
    week: { number: 4 },
    season: { year: 2026 },
    status: { type: { completed: true, state: "post", name: "STATUS_FINAL" } },
    competitions: [
      {
        competitors: [
          {
            homeAway: "home",
            team: { id: 57, location: "Florida", abbreviation: "FLA" },
          },
          {
            homeAway: "away",
            team: { id: "145", location: "Ole Miss", abbreviation: "MISS" },
          },
        ],
      },
    ],
  };

  it("resolves opponent from a final/completed ESPN event", () => {
    const resolved = eventToResolved(evt, "145", "Ole Miss", 2026);
    assert.ok(resolved);
    assert.equal(resolved.opponent.name, "Florida");
    assert.equal(resolved.completed, true);
    assert.equal(resolved.week, 4);
  });

  it("resolves future scheduled event identically", () => {
    const scheduled = {
      ...evt,
      status: { type: { completed: false, state: "pre", name: "STATUS_SCHEDULED" } },
    };
    const resolved = eventToResolved(scheduled, 145, "Ole Miss", 2026);
    assert.ok(resolved);
    assert.equal(resolved.opponent.name, "Florida");
    assert.equal(resolved.completed, false);
  });
});

describe("resolveOpponent with mocked site slate", () => {
  it("siteGameToResolved path is sufficient for the Kewan/Ole Miss fixture", () => {
    const game = {
      home_team_espn_id: "57",
      away_team_espn_id: 145,
      home_team_name: "Florida",
      away_team_name: "Ole Miss",
      cfbd_game_id: "401856699",
      game_date: "2026-09-26T19:30Z",
      is_completed: true,
    };
    const resolved = siteGameToResolved(game, "145", "Ole Miss", 2026, 4);
    assert.equal(resolved.opponent.name, "Florida");
    assert.equal(resolved.strategy, "site_weekly_picks");
    assert.equal(resolved.completed, true);
  });
});

describe("reason codes", () => {
  it("exposes distinct failure codes", () => {
    assert.equal(REASON.TEAM_NOT_IN_WEEK_SLATE, "TEAM_NOT_IN_WEEK_SLATE");
    assert.equal(REASON.GAME_MATCH_FAILED, "GAME_MATCH_FAILED");
    assert.ok(REASON.ESPN_SCHEDULE_EMPTY);
  });
});
