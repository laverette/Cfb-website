const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  isSaturdayNineAmCentral,
} = require(path.join(__dirname, "../netlify/functions/_lib/pick-reminders"));

describe("pick reminder Saturday 9 AM Central gate", () => {
  it("fires during the 9 AM Central hour on Saturday (CDT)", () => {
    // 2026-09-19 is Saturday; 14:30 UTC = 9:30 AM CDT
    assert.equal(isSaturdayNineAmCentral(new Date("2026-09-19T14:30:00Z")), true);
    assert.equal(isSaturdayNineAmCentral(new Date("2026-09-19T13:30:00Z")), false);
  });

  it("fires during the 9 AM Central hour on Saturday (CST)", () => {
    // 2026-01-10 is Saturday; 15:30 UTC = 9:30 AM CST
    assert.equal(isSaturdayNineAmCentral(new Date("2026-01-10T15:30:00Z")), true);
    assert.equal(isSaturdayNineAmCentral(new Date("2026-01-10T14:30:00Z")), false);
  });

  it("ignores Fridays", () => {
    assert.equal(isSaturdayNineAmCentral(new Date("2026-09-18T14:30:00Z")), false);
  });
});
