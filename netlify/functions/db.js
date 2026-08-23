/**
 * Shared Supabase client for Netlify Functions (one client per warm isolate).
 * Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify / local .env.
 * Service role is server-only and bypasses RLS.
 */
const { createClient } = require("@supabase/supabase-js");

const GLOBAL_CLIENT_KEY = "__cfb_supabase_client__";

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function getSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error("Supabase is not configured");
    err.code = "NO_DATABASE_URL";
    throw err;
  }
  if (!globalThis[GLOBAL_CLIENT_KEY]) {
    globalThis[GLOBAL_CLIENT_KEY] = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalThis[GLOBAL_CLIENT_KEY];
}

function dbError(error) {
  if (!error) return;
  const err = new Error(error.message || "Database error");
  err.code = error.code || "DB_ERROR";
  err.details = error.details;
  err.hint = error.hint;
  throw err;
}

async function selectAllPages(makeQuery, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    dbError(error);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/** Kept so older catch blocks still compile; Supabase HTTP is not connection-capped like JawsDB. */
function isMysqlConnectionLimitError() {
  return false;
}

module.exports = {
  getSupabase,
  getPool: getSupabase,
  dbError,
  selectAllPages,
  getSupabaseConfig,
  isMysqlConnectionLimitError,
};
