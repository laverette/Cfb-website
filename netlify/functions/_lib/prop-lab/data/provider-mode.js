/**
 * Provider override for Prop Lab player / schedule / matchup data.
 *
 * PROP_LAB_DATA_SOURCE / DATA_SOURCE:
 *   espn (default) — ESPN-first; CFBD only if explicitly re-enabled via opt-in flags
 *   auto           — cache → ESPN → CFBD (quota-friendly)
 *   cfbd           — CFBD only (no ESPN fallback)
 *
 * Optional CFBD enrichment (off by default — these were the biggest quota burns):
 *   PROP_LAB_CFBD_MATCHUP=1  — league /stats/season + advanced + /ppa/teams
 *   PROP_LAB_CFBD_LINES=1    — /lines consensus spread/total
 *   PROP_LAB_CFBD_OVERVIEW=1 — /player/season/overview
 */

const VALID = new Set(["auto", "cfbd", "espn"]);

function readProviderMode() {
  const raw = String(
    process.env.PROP_LAB_DATA_SOURCE || process.env.DATA_SOURCE || "espn"
  )
    .trim()
    .toLowerCase();
  if (VALID.has(raw)) return raw;
  return "espn";
}

function allowsCfbd(mode = readProviderMode()) {
  return mode === "auto" || mode === "cfbd";
}

function allowsEspn(mode = readProviderMode()) {
  return mode === "auto" || mode === "espn";
}

function forcesEspn(mode = readProviderMode()) {
  return mode === "espn";
}

function forcesCfbd(mode = readProviderMode()) {
  return mode === "cfbd";
}

function envFlagOn(name) {
  const v = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** League-wide CFBD matchup pulls (very expensive). */
function cfbdMatchupEnabled(mode = readProviderMode()) {
  if (forcesEspn(mode)) return false;
  if (forcesCfbd(mode)) return true;
  return envFlagOn("PROP_LAB_CFBD_MATCHUP");
}

/** CFBD betting lines. */
function cfbdLinesEnabled(mode = readProviderMode()) {
  if (forcesEspn(mode)) return false;
  if (forcesCfbd(mode)) return true;
  return envFlagOn("PROP_LAB_CFBD_LINES");
}

/** CFBD player season overview. */
function cfbdOverviewEnabled(mode = readProviderMode(), playerId = null) {
  if (forcesEspn(mode)) return false;
  if (String(playerId || "").startsWith("espn:")) return false;
  if (forcesCfbd(mode)) return true;
  return envFlagOn("PROP_LAB_CFBD_OVERVIEW");
}

module.exports = {
  readProviderMode,
  allowsCfbd,
  allowsEspn,
  forcesEspn,
  forcesCfbd,
  cfbdMatchupEnabled,
  cfbdLinesEnabled,
  cfbdOverviewEnabled,
};
