/**
 * Hard CFBD usage guard + telemetry + soft daily cap.
 *
 * Rules:
 * - background / scheduled context → CFBD blocked unless ALLOW_BACKGROUND_CFBD=true
 * - Production defaults to BLOCKED when env is absent
 * - Soft daily cap (CFBD_DAILY_SOFT_LIMIT) skips optional interactive CFBD
 * - LOG_CFBD_CALLS=true prints every allowed request
 */
const {
  getExecutionContext,
  getExecutionCaller,
  isBackgroundContext,
} = require("./execution-context");
const { recordApiUsage } = require("./api-usage");

class CfbdBackgroundUsageError extends Error {
  constructor(message, meta = {}) {
    super(message || "CFBD usage blocked for background execution");
    this.name = "CfbdBackgroundUsageError";
    this.code = "CFBD_BACKGROUND_BLOCKED";
    this.context = meta.context || "background";
    this.caller = meta.caller || null;
    this.endpoint = meta.endpoint || null;
  }
}

class CfbdDailyLimitError extends Error {
  constructor(message, meta = {}) {
    super(message || "CFBD daily soft limit reached");
    this.name = "CfbdDailyLimitError";
    this.code = "CFBD_DAILY_LIMIT";
    this.count = meta.count || 0;
    this.limit = meta.limit || 0;
  }
}

const counters = globalThis.__cfb_cfbd_counters || {
  day: null,
  allowed: 0,
  blocked: 0,
  byCaller: Object.create(null),
  byEndpoint: Object.create(null),
  recent: [],
};
globalThis.__cfb_cfbd_counters = counters;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function rollDay() {
  const day = utcDay();
  if (counters.day !== day) {
    counters.day = day;
    counters.allowed = 0;
    counters.blocked = 0;
    counters.byCaller = Object.create(null);
    counters.byEndpoint = Object.create(null);
    counters.recent = [];
  }
}

function softLimit() {
  const raw = process.env.CFBD_DAILY_SOFT_LIMIT;
  if (raw == null || String(raw).trim() === "") return 500;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

function allowBackgroundCfbd() {
  if (
    String(process.env.ALLOW_BACKGROUND_CFBD || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    return true;
  }
  // Narrow exception: daily league matchup snapshot (~3 CFBD calls, 12h cache).
  const caller = getExecutionCaller() || "";
  if (
    caller === "prop-lab-league-snapshot" ||
    caller === "prop-lab-week-board"
  ) {
    const v = String(process.env.PROP_LAB_CFBD_MATCHUP || "")
      .trim()
      .toLowerCase();
    return v !== "0" && v !== "false" && v !== "no" && v !== "off";
  }
  return false;
}

function logCfbdCallsEnabled() {
  return (
    String(process.env.LOG_CFBD_CALLS || "").trim() === "true" ||
    process.env.NODE_ENV === "development" ||
    process.env.CONTEXT === "dev"
  );
}

function pushRecent(entry) {
  counters.recent.push(entry);
  if (counters.recent.length > 40) counters.recent.shift();
}

/**
 * @param {{ caller?: string, endpoint?: string, feature?: string, optional?: boolean }} [meta]
 * @returns {{ allowed: true, context: string, caller: string|null } | never}
 */
function assertCfbdAllowed(meta = {}) {
  rollDay();
  const context = getExecutionContext();
  const caller = meta.caller || getExecutionCaller() || "unknown";
  const endpoint = meta.endpoint || null;

  if (context === "background" && !allowBackgroundCfbd()) {
    counters.blocked += 1;
    const entry = {
      at: Date.now(),
      blocked: true,
      context,
      caller,
      endpoint,
    };
    pushRecent(entry);
    console.warn(
      `[CFBD BLOCKED] context=${context} caller=${caller} endpoint=${endpoint || "?"}`
    );
    const err = new CfbdBackgroundUsageError(
      `Background process attempted forbidden CFBD request (${caller} → ${endpoint || "unknown"})`,
      { context, caller, endpoint }
    );
    // Dev: always throw. Prod: throw so callers cannot silently proceed to CFBD.
    throw err;
  }

  const limit = softLimit();
  if (counters.allowed >= limit) {
    counters.blocked += 1;
    console.warn(
      `[CFBD LIMIT] day=${counters.day} count=${counters.allowed} limit=${limit} caller=${caller}`
    );
    throw new CfbdDailyLimitError(
      `CFBD daily soft limit reached (${counters.allowed}/${limit})`,
      { count: counters.allowed, limit }
    );
  }

  return { allowed: true, context, caller, endpoint };
}

/**
 * Record an actual upstream CFBD HTTP call (after assert passed / cache miss).
 */
function recordCfbdCall(meta = {}) {
  rollDay();
  const context = getExecutionContext();
  const caller = meta.caller || getExecutionCaller() || "unknown";
  const endpoint = meta.endpoint || "?";
  counters.allowed += 1;
  counters.byCaller[caller] = (counters.byCaller[caller] || 0) + 1;
  counters.byEndpoint[endpoint] = (counters.byEndpoint[endpoint] || 0) + 1;
  const n = counters.allowed;
  pushRecent({
    at: Date.now(),
    blocked: false,
    context,
    caller,
    endpoint,
    n,
    cache: meta.cache || "MISS",
  });

  if (logCfbdCallsEnabled() || String(process.env.LOG_CFBD_CALLS || "") === "true") {
    console.log(
      `[CFBD REQUEST #${n}] context=${context} caller=${caller} endpoint=${endpoint} cache=${meta.cache || "MISS"}`
    );
  }

  if (meta.feature) {
    recordApiUsage({
      feature: meta.feature,
      source: "cfbd",
      calls: 1,
    });
  }
}

function cfbdUsageSnapshot() {
  rollDay();
  return {
    day: counters.day,
    allowed: counters.allowed,
    blocked: counters.blocked,
    limit: softLimit(),
    byCaller: { ...counters.byCaller },
    byEndpoint: { ...counters.byEndpoint },
    recent: counters.recent.slice(-20),
    backgroundAllowedByEnv: allowBackgroundCfbd(),
    context: getExecutionContext(),
  };
}

function _resetCfbdCounters() {
  counters.day = utcDay();
  counters.allowed = 0;
  counters.blocked = 0;
  counters.byCaller = Object.create(null);
  counters.byEndpoint = Object.create(null);
  counters.recent = [];
}

/**
 * Provider policy — background lists never include CFBD.
 */
const PROVIDER_POLICY = {
  interactive: {
    playerStats: ["cache", "cfbd", "espn"],
    teamStats: ["cache", "cfbd", "espn"],
    schedule: ["cache", "espn", "cfbd"],
    scores: ["espn", "cache"],
    grading: ["espn", "cache"],
  },
  background: {
    playerStats: ["cache", "espn"],
    teamStats: ["cache", "espn"],
    schedule: ["cache", "espn"],
    scores: ["espn", "cache"],
    grading: ["espn", "cache"],
  },
};

function providersFor(capability, context = getExecutionContext()) {
  const ctx = context === "background" ? "background" : "interactive";
  const list = PROVIDER_POLICY[ctx]?.[capability] || ["cache", "espn"];
  return list.slice();
}

function policyAllowsCfbd(capability, context = getExecutionContext()) {
  return providersFor(capability, context).includes("cfbd");
}

module.exports = {
  CfbdBackgroundUsageError,
  CfbdDailyLimitError,
  assertCfbdAllowed,
  recordCfbdCall,
  cfbdUsageSnapshot,
  softLimit,
  allowBackgroundCfbd,
  PROVIDER_POLICY,
  providersFor,
  policyAllowsCfbd,
  _resetCfbdCounters,
  isBackgroundContext,
};
