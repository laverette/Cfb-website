/**
 * Async execution context: "interactive" (user-triggered) vs "background"
 * (cron / scheduled / unattended jobs).
 *
 * Background code MUST enter via withExecutionContext("background", ...).
 * Default when unset is "interactive" so Prop Lab / user APIs keep working.
 */
const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

const CONTEXTS = new Set(["interactive", "background"]);

function normalizeContext(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "scheduled" || v === "cron" || v === "auto" || v === "system") {
    return "background";
  }
  if (v === "user" || v === "manual" || v === "foreground") {
    return "interactive";
  }
  if (CONTEXTS.has(v)) return v;
  return null;
}

function getExecutionStore() {
  return storage.getStore() || null;
}

function getExecutionContext() {
  return getExecutionStore()?.context || "interactive";
}

function getExecutionCaller() {
  return getExecutionStore()?.caller || null;
}

function isBackgroundContext() {
  return getExecutionContext() === "background";
}

/**
 * Run work under an explicit execution context.
 * @param {"interactive"|"background"|string} context
 * @param {() => (any|Promise<any>)} fn
 * @param {{ caller?: string }} [meta]
 */
function withExecutionContext(context, fn, meta = {}) {
  const normalized = normalizeContext(context) || "interactive";
  const parent = getExecutionStore();
  const store = {
    context: normalized,
    caller: meta.caller || parent?.caller || null,
    startedAt: Date.now(),
  };
  return storage.run(store, fn);
}

/**
 * Nest a caller label without changing context.
 */
function withCaller(caller, fn) {
  const parent = getExecutionStore();
  const store = {
    context: parent?.context || "interactive",
    caller: caller || parent?.caller || null,
    startedAt: parent?.startedAt || Date.now(),
  };
  return storage.run(store, fn);
}

module.exports = {
  withExecutionContext,
  withCaller,
  getExecutionContext,
  getExecutionCaller,
  getExecutionStore,
  isBackgroundContext,
  normalizeContext,
};
