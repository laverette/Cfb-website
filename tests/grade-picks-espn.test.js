const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  matchLiveScoreToGame,
  extractFinalFromLive,
  extractCanceledFromLive,
  resolveWinner,
  isEspnEventId,
  normalizeEspnEvent,
} = require(path.join(__dirname, "../netlify/functions/_lib/grade-picks"));

const { normalizeEspnEvent: normFromModule } = require(path.join(
  __dirname,
  "../netlify/functions/_lib/espn-game-results"
));

function slateGame(overrides = {}) {
  return {
    id: 1,
    cfbd_game_id: 401856696,
    home_team_espn_id: 333,
    away_team_espn_id: 2579,
    home_team_name: "Alabama",
    away_team_name: "South Carolina",
    ...overrides,
  };
}

describe("isEspnEventId", () => {
  it("detects ESPN event ids vs CFBD ids", () => {
    assert.equal(isEspnEventId(401856696), true);
    assert.equal(isEspnEventId(401858243), true);
    assert.equal(isEspnEventId(12345), false);
    assert.equal(isEspnEventId(null), false);
  });
});

describe("matchLiveScoreToGame — ESPN event id", () => {
  it("matches ESPN-selected games by event id when live.source is espn", () => {
    const game = slateGame();
    const live = {
      id: 401856696,
      source: "espn",
      homeEspnId: 333,
      awayEspnId: 2579,
      homePoints: 49,
      awayPoints: 18,
      completed: true,
      statusRaw: "STATUS_FINAL",
    };
    const m = matchLiveScoreToGame(game, live);
    assert.ok(m);
    assert.equal(m.swapped, false);
  });

  it("does not match ESPN event id against a CFBD live row with same numeric id", () => {
    const game = slateGame({ cfbd_game_id: 401856696 });
    const live = {
      id: 401856696,
      source: "cfbd",
      homeEspnId: 1,
      awayEspnId: 2,
      homeTeam: "Wrong",
      awayTeam: "Also Wrong",
      completed: true,
    };
    // Team ids don't match and names don't match — must be null
    assert.equal(matchLiveScoreToGame(game, live), null);
  });

  it("still matches legacy CFBD games by cfbd id", () => {
    const game = slateGame({
      cfbd_game_id: 12345,
      home_team_espn_id: 10,
      away_team_espn_id: 20,
    });
    const live = {
      id: 12345,
      source: "cfbd",
      homeEspnId: 99,
      awayEspnId: 88,
      homeTeam: "X",
      awayTeam: "Y",
      completed: true,
    };
    const m = matchLiveScoreToGame(game, live);
    assert.ok(m);
  });
});

describe("extractFinalFromLive / canceled / postponed", () => {
  it("scheduled / live remain pending", () => {
    assert.equal(
      extractFinalFromLive({
        completed: false,
        statusState: "pre",
        statusRaw: "STATUS_SCHEDULED",
        homePoints: null,
        awayPoints: null,
      }),
      null
    );
    assert.equal(
      extractFinalFromLive({
        completed: false,
        statusState: "in",
        statusRaw: "Q3",
        homePoints: 21,
        awayPoints: 14,
      }),
      null
    );
  });

  it("final with string scores parses; missing score is not zero", () => {
    const final = extractFinalFromLive({
      completed: true,
      statusRaw: "STATUS_FINAL",
      homePoints: "31",
      awayPoints: "24",
    });
    assert.deepEqual(final, { homePoints: 31, awayPoints: 24, completed: true });
    assert.equal(
      extractFinalFromLive({
        completed: true,
        statusRaw: "STATUS_FINAL",
        homePoints: 31,
        awayPoints: null,
      }),
      null
    );
  });

  it("canceled is not graded as a final", () => {
    const live = {
      canceled: true,
      completed: false,
      statusRaw: "STATUS_CANCELED",
      homePoints: 0,
      awayPoints: 0,
    };
    assert.equal(extractFinalFromLive(live), null);
    assert.equal(extractCanceledFromLive(live), true);
  });

  it("postponed remains pending", () => {
    assert.equal(
      extractFinalFromLive({
        postponed: true,
        completed: false,
        statusRaw: "STATUS_POSTPONED",
        homePoints: null,
        awayPoints: null,
      }),
      null
    );
  });
});

describe("resolveWinner", () => {
  it("home win / away win / tie", () => {
    const game = slateGame();
    const home = resolveWinner(game, 49, 18);
    assert.equal(home.winningEspnId, 333);
    assert.equal(home.winningName, "Alabama");
    const away = resolveWinner(game, 18, 49);
    assert.equal(away.winningEspnId, 2579);
    const tie = resolveWinner(game, 20, 20);
    assert.equal(tie.isTie, true);
    assert.equal(tie.winningEspnId, null);
  });
});

describe("normalizeEspnEvent", () => {
  it("uses homeAway and completed flag; does not invent zero scores", () => {
    const row = normalizeEspnEvent({
      id: "401856696",
      status: { type: { completed: true, state: "post", name: "STATUS_FINAL" } },
      competitions: [
        {
          competitors: [
            {
              homeAway: "away",
              score: "18",
              winner: false,
              team: { id: "2579", location: "South Carolina" },
            },
            {
              homeAway: "home",
              score: "49",
              winner: true,
              team: { id: "333", location: "Alabama" },
            },
          ],
        },
      ],
    });
    assert.equal(row.id, 401856696);
    assert.equal(row.completed, true);
    assert.equal(row.homePoints, 49);
    assert.equal(row.awayPoints, 18);
    assert.equal(row.homeEspnId, 333);
    assert.equal(row.awayEspnId, 2579);
  });

  it("treats canceled status as canceled not final", () => {
    const row = normFromModule({
      id: 1,
      status: { type: { completed: false, state: "post", name: "STATUS_CANCELED" } },
      competitions: [
        {
          status: { type: { completed: false, name: "STATUS_CANCELED" } },
          competitors: [
            { homeAway: "home", team: { id: "1", location: "A" } },
            { homeAway: "away", team: { id: "2", location: "B" } },
          ],
        },
      ],
    });
    assert.equal(row.canceled, true);
    assert.equal(row.completed, false);
  });
});

describe("idempotent pick correctness", () => {
  it("home final grades home picks true and away picks false", () => {
    const game = slateGame();
    const outcome = resolveWinner(game, 49, 18);
    assert.equal(Number(333) === Number(outcome.winningEspnId), true);
    assert.equal(Number(2579) === Number(outcome.winningEspnId), false);
  });
});
