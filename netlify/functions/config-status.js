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

function readGeminiKey() {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.Gemini_API_Key,
  ];
  for (const candidate of candidates) {
    const raw = candidate && String(candidate).trim();
    if (raw) return raw;
  }
  return "";
}

function geminiKeySource() {
  if (process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim()) {
    return "GEMINI_API_KEY";
  }
  if (process.env.GOOGLE_API_KEY && String(process.env.GOOGLE_API_KEY).trim()) {
    return "GOOGLE_API_KEY";
  }
  if (process.env.Gemini_API_Key && String(process.env.Gemini_API_Key).trim()) {
    return "Gemini_API_Key";
  }
  return null;
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

  const geminiKey = readGeminiKey();
  const geminiFrom = geminiKeySource();

  return json(200, {
    jwtSecret: jwtPresent(),
    supabaseUrl: Boolean(url),
    supabaseServiceRoleKey: Boolean(key),
    supabaseUrlHost: host,
    geminiApiKey: Boolean(geminiKey),
    // Safe diagnostics only — never the secret itself
    geminiKeySource: geminiFrom,
    geminiKeyLength: geminiKey ? geminiKey.length : 0,
    geminiKeyPrefix: geminiKey ? geminiKey.slice(0, 3) : null,
  });
};
