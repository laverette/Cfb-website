/**
 * Shared MySQL pool for Netlify Functions (single pool per warm isolate).
 * Set MYSQL_URL (or JawsDB / common fallbacks) in Netlify environment variables.
 * Uses globalThis so reused lambdas do not create multiple pools.
 */
const mysql = require("mysql2/promise");

const GLOBAL_POOL_KEY = "__cfb_mysql2_pool__";

function getMysqlUrl() {
  return (
    process.env.MYSQL_URL ||
    process.env.JAWSDB_URL ||
    process.env.CLEARDB_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

/**
 * JawsDB often caps max_user_connections at 10; keep pool small so parallel
 * invocations (map + admin + auth) do not exhaust the account.
 */
function getPool() {
  const url = getMysqlUrl();
  if (!url) {
    const err = new Error("Database URL not configured");
    err.code = "NO_DATABASE_URL";
    throw err;
  }
  if (!globalThis[GLOBAL_POOL_KEY]) {
    globalThis[GLOBAL_POOL_KEY] = mysql.createPool(url, {
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 2,
      queueLimit: 0,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return globalThis[GLOBAL_POOL_KEY];
}

/** True when the server refused a new connection for this MySQL user. */
function isMysqlConnectionLimitError(err) {
  if (!err || typeof err !== "object") return false;
  const msg = String(err.message || err.sqlMessage || "");
  if (/max_user_connections|max_connections|too many connections/i.test(msg)) {
    return true;
  }
  const n = err.errno != null ? Number(err.errno) : NaN;
  if (n === 1040 || n === 1203 || n === 1226) return true;
  if (err.code === "ER_CON_COUNT_ERROR" || err.code === "ER_USER_LIMIT_REACHED") return true;
  return false;
}

module.exports = { getPool, getMysqlUrl, isMysqlConnectionLimitError };
