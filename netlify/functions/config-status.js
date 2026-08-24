/**
 * GET /api/health/config
 * Reports which server env vars the functions can see. Never returns secret values.
 */
const { getSupabaseConfig } = require("./db");
const { json } = require("./_http");

function jwtPresent() {
  const s = process.env.JWT_SECRET;
  return Boolean(s && String(s).trim());
}

function readMistralKey() {
  const raw = process.env.MISTRAL_API_KEY && String(process.env.MISTRAL_API_KEY).trim();
  return raw || "";
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const { url, key } = getSupabaseConfig();
  let host = null;
  try {
    if (url) host = new URL(url).host;
  } catch {
    host = "invalid-url";
  }

  const mistralKey = readMistralKey();

  return json(200, {
    jwtSecret: jwtPresent(),
    supabaseUrl: Boolean(url),
    supabaseServiceRoleKey: Boolean(key),
    supabaseUrlHost: host,
    mistralApiKey: Boolean(mistralKey),
    mistralKeyLength: mistralKey ? mistralKey.length : 0,
  });
};
