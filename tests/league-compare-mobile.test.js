const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../Frontend/weeklypicks.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../Frontend/Resources/Styles/weeklypicks.css"), "utf8");
const mobile = fs.readFileSync(
  path.join(__dirname, "../Frontend/styles/weeklypicks-mobile.css"),
  "utf8"
);

test("league rows expose compare action and stagger index", () => {
  assert.match(html, /results-stand-compare/);
  assert.match(html, /Compare boards/);
  assert.match(html, /--stand-i:\$\{index\}/);
  assert.match(html, /openHeadToHeadFromRow/);
  assert.match(html, /is-opening/);
});

test("analysis uses compact spotlight chips", () => {
  assert.match(html, /analysis-spotlights/);
  assert.match(html, /analysis-spotlight-label/);
  assert.match(css, /\.analysis-spotlight/);
});

test("h2h sheet has backdrop, agree\/split, and logos", () => {
  assert.match(html, /id="h2hBackdrop"/);
  assert.match(html, /closeHeadToHead/);
  assert.match(html, /h2h-tally-chip is-agree/);
  assert.match(html, /h2hGameRelation/);
  assert.match(html, /h2hPickLogoHtml/);
  assert.match(html, /h2h-game-chip/);
  assert.match(css, /\.h2h-backdrop/);
  assert.match(mobile, /\.h2h-panel\.is-open/);
  assert.match(mobile, /transform:\s*translateY\(110%\)/);
});

test("accuracy chip keeps dark-on-gold contrast", () => {
  assert.match(css, /\.results-stand-acc[\s\S]*?color:\s*#1a1410/);
});
