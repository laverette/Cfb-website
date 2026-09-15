const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatKickoffCompact,
  formatVenueLine,
  dockShouldShow,
  corsoBottomOffset,
  recordWithPending,
  nameListCompact,
  isPrimaryAward,
  captureIgnoresSelector,
} = require("../Frontend/scripts/weeklypicks-mobile.js");

test("formatKickoffCompact uses ET and a short date", () => {
  const out = formatKickoffCompact("2026-09-12T23:30:00.000Z");
  assert.match(out, /Sat 9\/12/);
  assert.match(out, /ET$/);
  assert.doesNotMatch(out, /2026/);
});

test("formatVenueLine truncates gracefully with both parts", () => {
  const line = formatVenueLine("2026-09-12T23:30:00.000Z", "DKR–Texas Memorial");
  assert.match(line, /DKR/);
  assert.match(line, /·/);
});

test("dockShouldShow hides after submit unless editing", () => {
  assert.equal(
    dockShouldShow({ picksView: true, submitted: false, editing: false, total: 12, submitHidden: false }),
    true
  );
  assert.equal(
    dockShouldShow({ picksView: true, submitted: true, editing: false, total: 12, submitHidden: true }),
    false
  );
  assert.equal(
    dockShouldShow({ picksView: true, submitted: true, editing: true, total: 12, submitHidden: false }),
    true
  );
  assert.equal(
    dockShouldShow({ picksView: false, submitted: false, editing: false, total: 12, submitHidden: false }),
    false
  );
});

test("corsoBottomOffset sits above the sticky bar and safe area", () => {
  assert.equal(corsoBottomOffset(56, 34), 102);
  assert.equal(corsoBottomOffset(0, 0), 12);
});

test("recordWithPending prefers record then pending count", () => {
  assert.equal(recordWithPending({ correctPicks: 9, incorrectPicks: 3, pendingPicks: 0 }), "9–3");
  assert.equal(recordWithPending({ correctPicks: 6, incorrectPicks: 2, pendingPicks: 4 }), "6–2 · 4 pending");
  assert.equal(recordWithPending({ correctPicks: 0, incorrectPicks: 0, pendingPicks: 12 }), "12 pending");
});

test("nameListCompact and primary awards", () => {
  assert.equal(nameListCompact(["Allie", "Gracie", "Kate"]), "Allie, Gracie & Kate");
  assert.equal(nameListCompact(["A", "B", "C", "D"]), "A, B, C +1");
  assert.equal(isPrimaryAward("Top Dog"), true);
  assert.equal(isPrimaryAward("Upset King"), true);
  assert.equal(isPrimaryAward("Longest Heater"), false);
});

test("share export ignore list excludes floating UI", () => {
  const sel = captureIgnoresSelector();
  assert.match(sel, /corso-widget/);
  assert.match(sel, /picks-mobile-dock/);
  assert.match(sel, /hub-switch-dock/);
  assert.doesNotMatch(sel, /picks-share-card/);
});
