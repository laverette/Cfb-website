/**
 * Provider override for Prop Lab player / schedule / matchup data.
 *
 * PROP_LAB_DATA_SOURCE / DATA_SOURCE:
 *   espn (default) — ESPN-first for player logs/search/schedule
 *   auto           — cache → ESPN → CFBD fallback for player paths
 *   cfbd           — CFBD only (no ESPN fallback)
 *
 * League matchup enrichment (PPA / advanced / season stats) is a *shared*
 * daily CFBD snapshot, independent of player data source:
 *   PROP_LAB_CFBD_MATCHUP — default ON; set 0/false to disable
 *   PROP_LAB_CFBD_LINES=1 — optional CFBD /lines (off by default)
 *   PROP_LAB_CFBD_OVERVIEW=1 — optional /player/season/overview (off)
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

function envFlagOff(name) {
  const v = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Shared league CFBD matchup snapshot. Default ON (budget-safe via cache).
 * Works even when player path is ESPN-only.
 */
function cfbdMatchupEnabled(_mode = readProviderMode()) {
  if (envFlagOff("PROP_LAB_CFBD_MATCHUP")) return false;
  if (process.env.PROP_LAB_CFBD_MATCHUP == null || String(process.env.PROP_LAB_CFBD_MATCHUP).trim() === "") {
    return true;
  }
  return envFlagOn("PROP_LAB_CFBD_MATCHUP");
}

/** CFBD betting lines — off by default. */
function cfbdLinesEnabled(mode = readProviderMode()) {
  if (forcesEspn(mode) && !envFlagOn("PROP_LAB_CFBD_LINES")) return false;
  if (forcesCfbd(mode)) return true;
  return envFlagOn("PROP_LAB_CFBD_LINES");
}

/** CFBD player season overview — off by default. */
function cfbdOverviewEnabled(mode = readProviderMode(), playerId = null) {
  if (String(playerId || "").startsWith("espn:")) return false;
  if (forcesEspn(mode)) return false;
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
