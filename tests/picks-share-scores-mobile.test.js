const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "../Frontend/styles/weeklypicks-mobile.css");
const htmlPath = path.join(__dirname, "../Frontend/weeklypicks.html");

test("mobile share CSS shows scores without relying on :has()", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  assert.match(css, /\.picks-share-teams\.has-scores\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css, /\.picks-share-teams:has\(/);
});

test("share card markup and save flow keep scores + recover from hung save", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /picks-share-teams\$\{showScores \? ' has-scores' : ''\}/);
  assert.match(html, /restoreBtnEarly:\s*true/);
  assert.match(html, /share-timeout/);
  assert.match(html, /openPhotosRetry\(file\)/);
  assert.match(html, /Image capture timed out/);
});
