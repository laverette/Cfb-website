/**
 * Shared MySQL pool for Netlify Functions.
 * Set MYSQL_URL in Netlify environment variables (JawsDB / MySQL connection string).
 * Fallbacks support common host-provided names only; do not commit credentials.
 */
const mysql = require("mysql2/promise");

let pool;

function getMysqlUrl() {
  return (
    process.env.MYSQL_URL ||
    process.env.JAWSDB_URL ||
    process.env.CLEARDB_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

function getPool() {
  const url = getMysqlUrl();
  if (!url) {
    const err = new Error("Database URL not configured");
    err.code = "NO_DATABASE_URL";
    throw err;
  }
  if (!pool) {
    pool = mysql.createPool(url, {
      waitForConnections: true,
      connectionLimit: 5,
      maxIdle: 5,
      idleTimeout: 60000,
      enableKeepAlive: true,
    });
  }
  return pool;
}

module.exports = { getPool, getMysqlUrl };
