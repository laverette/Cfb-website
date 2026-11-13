/**
 * Weekly picks lock at 1:00 PM America/Chicago on the slate Saturday.
 * Run: node --test tests/picks-lock.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { weekLockFromGames } = require(path.join(__dirname, "../netlify/functions/db"));

function game(iso) {
  return { game_date: iso };
}

describe("weekly picks Saturday 1 PM Central lock", () => {
  it("stays open at 12:59 PM CST and locks at 1:00 PM CST", () => {
    const games = [game("2026-11-14T17:00:00Z")]; // 11:00 AM CST
    const open = weekLockFromGames(games, new Date("2026-11-14T18:59:00Z"));
    const closed = weekLockFromGames(games, new Date("2026-11-14T19:00:00Z"));
    assert.equal(open.picksLocked, false);
    assert.equal(closed.picksLocked, true);
    assert.equal(open.locksAt, "2026-11-14T19:00:00.000Z");
    assert.equal(closed.locksAt, open.locksAt);
  });

  it("uses 1:00 PM CDT in the summer", () => {
    const games = [game("2026-09-12T16:00:00Z")]; // 11:00 AM CDT
    const open = weekLockFromGames(games, new Date("2026-09-12T17:59:00Z"));
    const closed = weekLockFromGames(games, new Date("2026-09-12T18:00:00Z"));
    assert.equal(open.picksLocked, false);
    assert.equal(closed.picksLocked, true);
    assert.equal(closed.locksAt, "2026-09-12T18:00:00.000Z");
  });

  it("keeps Thursday kickoffs open until Saturday at 1 PM Central", () => {
    const games = [
      game("2026-11-13T01:00:00Z"), // Thursday 7:00 PM CST
      game("2026-11-14T17:00:00Z"), // Saturday 11:00 AM CST
    ];
    const thursdayNight = weekLockFromGames(games, new Date("2026-11-13T03:00:00Z"));
    const afterDeadline = weekLockFromGames(games, new Date("2026-11-14T19:00:00Z"));
    assert.equal(thursdayNight.picksLocked, false);
    assert.equal(thursdayNight.locksAt, "2026-11-14T19:00:00.000Z");
    assert.equal(afterDeadline.picksLocked, true);
  });

  it("locks a Sunday-only slate on the Saturday before it", () => {
    const games = [game("2026-11-15T18:00:00Z")]; // Sunday noon CST
    const lock = weekLockFromGames(games, new Date("2026-11-15T18:30:00Z"));
    assert.equal(lock.locksAt, "2026-11-14T19:00:00.000Z");
    assert.equal(lock.picksLocked, true);
  });

  it("stays open when the slate has no kickoff times", () => {
    const lock = weekLockFromGames([{ game_date: null }], new Date("2026-11-14T20:00:00Z"));
    assert.equal(lock.picksLocked, false);
    assert.equal(lock.locksAt, null);
  });
});
