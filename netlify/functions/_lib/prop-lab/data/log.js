/**
 * Dev-oriented logger for the player-data orchestrator.
 * Quiet in production unless PROP_LAB_DATA_DEBUG=1.
 */

function isDebugEnabled() {
  const flag = String(process.env.PROP_LAB_DATA_DEBUG || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "production" || process.env.CONTEXT === "production") return false;
  return true;
}

function dataLog(scope, message, detail) {
  if (!isDebugEnabled()) return;
  const prefix = `[${scope}]`;
  if (detail !== undefined) {
    console.log(prefix, message, detail);
  } else {
    console.log(prefix, message);
  }
}

module.exports = { dataLog, isDebugEnabled };
