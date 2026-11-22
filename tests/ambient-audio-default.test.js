const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("new accounts and settings API default site music to off", () => {
  const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
  const settings = fs.readFileSync(
    path.join(__dirname, "../netlify/functions/auth-settings.js"),
    "utf8"
  );
  assert.match(db, /ambient_audio_enabled:\s*false/);
  assert.doesNotMatch(db, /ambient_audio_enabled:\s*true/);
  assert.match(settings, /ambientAudioEnabled:\s*false/);
  assert.match(settings, /ambientAudioEnabled:\s*Boolean\(row\.ambient_audio_enabled\)/);
});

test("band player UI is removed; profile opt-in drives hidden audio", () => {
  const authUi = fs.readFileSync(path.join(__dirname, "../Frontend/scripts/auth-ui.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../Frontend/styles/site-theme.css"), "utf8");
  const profile = fs.readFileSync(path.join(__dirname, "../Frontend/user-profile.html"), "utf8");

  assert.match(authUi, /site-audio-engine/);
  assert.match(authUi, /localStorage\.getItem\(AMBIENT_OPT_OUT_KEY\) !== "0"/);
  assert.match(authUi, /siteMusicOptInCutoverV1/);
  assert.match(authUi, /maybeCutoverMusicOptIn/);
  assert.doesNotMatch(authUi, /band-player-bar/);
  assert.doesNotMatch(authUi, /band-player-mute/);
  assert.match(css, /\.site-audio-engine/);
  assert.match(profile, /Yes, play site music/);
  assert.doesNotMatch(profile, /id="ambientAudioToggle" checked/);
});
