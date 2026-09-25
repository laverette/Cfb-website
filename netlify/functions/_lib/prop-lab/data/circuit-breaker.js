/**
 * Temporary CFBD circuit breaker. When rate-limited/quota-exhausted,
 * skip CFBD for a cooldown window and go Cache → ESPN.
 */

const state = globalThis.__cfb_cfbd_circuit || {
  openUntil: 0,
  lastStatus: null,
  lastReason: null,
  trips: 0,
};

globalThis.__cfb_cfbd_circuit = state;

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const MIN_COOLDOWN_MS = 60 * 1000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;

function now() {
  return Date.now();
}

function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const get =
    typeof headers.get === "function"
      ? (k) => headers.get(k)
      : (k) => headers[k] || headers[String(k).toLowerCase()];
  const retryAfter = get("retry-after");
  if (retryAfter == null || retryAfter === "") return null;
  const asNum = Number(retryAfter);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(retryAfter);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - now());
  return null;
}

function isRateLimitError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode);
  if (status === 429) return true;
  const msg = String(err.message || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("exceeded")
  );
}

function isTransientCfbdError(err) {
  if (!err) return false;
  if (isRateLimitError(err)) return true;
  const status = Number(err.status || err.statusCode);
  if ([408, 500, 502, 503, 504].includes(status)) return true;
  if (err.name === "AbortError" || err.code === "ETIMEDOUT" || err.code === "ECONNRESET") {
    return true;
  }
  const msg = String(err.message || "").toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("unavailable")
  );
}

function isProgrammerCfbdError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode);
  if ([400, 401, 403].includes(status)) {
    const msg = String(err.message || "").toLowerCase();
    // 403 can be quota on some gateways — treat quota text as transient.
    if (msg.includes("quota") || msg.includes("rate")) return false;
    return true;
  }
  if (err.code === "BAD_PARAMS" || err.code === "INVALID_SEASON") return true;
  return false;
}

function shouldFallbackToEspn(err) {
  if (!err) return false;
  if (isProgrammerCfbdError(err)) return false;
  if (err.code === "CFBD_CIRCUIT_OPEN") return true;
  if (err.code === "PLAYER_STATS_MISSING") return true;
  return isTransientCfbdError(err);
}

function tripCfbdCircuit(err, headers) {
  const fromHeader = parseRetryAfterMs(headers);
  const cooldown = Math.min(
    MAX_COOLDOWN_MS,
    Math.max(MIN_COOLDOWN_MS, fromHeader != null ? fromHeader : DEFAULT_COOLDOWN_MS)
  );
  state.openUntil = now() + cooldown;
  state.lastStatus = err?.status || err?.statusCode || null;
  state.lastReason = String(err?.message || "rate limit").slice(0, 180);
  state.trips += 1;
  return { openUntil: state.openUntil, cooldownMs: cooldown };
}

function isCfbdCircuitOpen() {
  return state.openUntil > now();
}

function cfbdCircuitInfo() {
  const open = isCfbdCircuitOpen();
  return {
    open,
    openUntil: state.openUntil || 0,
    remainingMs: open ? Math.max(0, state.openUntil - now()) : 0,
    lastStatus: state.lastStatus,
    lastReason: state.lastReason,
    trips: state.trips,
  };
}

function assertCfbdAvailable() {
  if (!isCfbdCircuitOpen()) return;
  const info = cfbdCircuitInfo();
  const err = new Error(
    `CFBD temporarily unavailable (circuit open ${Math.ceil(info.remainingMs / 1000)}s)`
  );
  err.code = "CFBD_CIRCUIT_OPEN";
  err.status = info.lastStatus || 429;
  throw err;
}

/** Test helper — reset breaker state. */
function _resetCfbdCircuit() {
  state.openUntil = 0;
  state.lastStatus = null;
  state.lastReason = null;
  state.trips = 0;
}

/** Test helper — force open for ms. */
function _forceOpenCfbdCircuit(ms = DEFAULT_COOLDOWN_MS) {
  state.openUntil = now() + ms;
  state.lastReason = "forced";
  state.trips += 1;
}

module.exports = {
  isRateLimitError,
  isTransientCfbdError,
  isProgrammerCfbdError,
  shouldFallbackToEspn,
  tripCfbdCircuit,
  isCfbdCircuitOpen,
  cfbdCircuitInfo,
  assertCfbdAvailable,
  parseRetryAfterMs,
  _resetCfbdCircuit,
  _forceOpenCfbdCircuit,
  DEFAULT_COOLDOWN_MS,
};
