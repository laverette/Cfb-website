/**
 * Development provider override for Prop Lab player data.
 *
 * PROP_LAB_DATA_SOURCE / DATA_SOURCE:
 *   auto (default) — cache → CFBD → ESPN → stale cache
 *   cfbd            — CFBD only (no ESPN fallback)
 *   espn            — ESPN only (skip CFBD for orchestrated paths)
 */

const VALID = new Set(["auto", "cfbd", "espn"]);

function readProviderMode() {
  const raw = String(
    process.env.PROP_LAB_DATA_SOURCE || process.env.DATA_SOURCE || "auto"
  )
    .trim()
    .toLowerCase();
  if (VALID.has(raw)) return raw;
  return "auto";
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

module.exports = {
  readProviderMode,
  allowsCfbd,
  allowsEspn,
  forcesEspn,
  forcesCfbd,
};
