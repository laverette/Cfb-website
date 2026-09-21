/**
 * Persist CFBD / Odds API call counts by product feature for the admin chart.
 * Never throws into callers — usage logging must not break product requests.
 */
const { getSupabase, hasSupabase } = require("../db");

const FEATURE_LABELS = {
  "live-scores": "Live scores",
  "grade-picks": "Pick grading",
  "prop-lab": "Prop Lab",
  "prop-odds": "Prop odds",
  "weekly-picks": "Weekly picks",
  "team-page": "Team page",
  "teams-directory": "Teams directory",
  "admin-slate": "Admin slate fetch",
  "admin-cfbd-proxy": "Admin CFBD proxy",
  corso: "Coach Corso",
  "power-rankings": "Power rankings",
  "schedule-predict": "Schedule predict",
  "recruit-map": "Recruit map",
  "team-roster": "Team roster",
  "player-profile": "Player profile",
  heisman: "Heisman",
  "cfbd-proxy": "CFBD proxy (other)",
};

function sanitizeToken(value, max = 48) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[./-]+|[./-]+$/g, "");
  if (!raw) return "";
  return raw.slice(0, max);
}

function featureLabel(feature) {
  const key = sanitizeToken(feature);
  if (FEATURE_LABELS[key]) return FEATURE_LABELS[key];
  return key
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Infer a feature slug from an optional query param or Referer page. */
function featureFromRequest(event, fallback = "cfbd-proxy") {
  const qs = event?.queryStringParameters || {};
  const fromQs = sanitizeToken(qs.feature || qs.usageFeature || "");
  if (fromQs) return fromQs;

  const headers = event?.headers || {};
  const referer = String(headers.referer || headers.Referer || headers.referrer || "").toLowerCase();
  if (/admin\.html/.test(referer)) return "admin-cfbd-proxy";
  if (/weeklypicks\.html/.test(referer)) return "weekly-picks";
  if (/prop-bet\.html|prop-lab/.test(referer)) return "prop-lab";
  if (/team\.html/.test(referer)) return "team-page";
  if (/teams\.html/.test(referer)) return "teams-directory";
  if (/heisman/.test(referer)) return "heisman";
  if (/bama\.html|schedule/.test(referer)) return "schedule-predict";
  if (/recruit/.test(referer)) return "recruit-map";
  if (/player/.test(referer)) return "player-profile";
  return sanitizeToken(fallback) || "cfbd-proxy";
}

async function bumpApiUsage({
  feature,
  source = "cfbd",
  calls = 0,
  cacheHits = 0,
  day = null,
} = {}) {
  const feat = sanitizeToken(feature);
  if (!feat) return false;
  const callN = Math.max(0, Number(calls) || 0);
  const hitN = Math.max(0, Number(cacheHits) || 0);
  if (callN === 0 && hitN === 0) return false;
  if (!hasSupabase()) return false;

  try {
    const supabase = getSupabase();
    const payload = {
      p_feature: feat,
      p_source: sanitizeToken(source, 24) || "cfbd",
      p_calls: callN,
      p_cache_hits: hitN,
    };
    if (day) payload.p_day = day;
    const { error } = await supabase.rpc("bump_api_usage", payload);
    if (error) {
      console.warn("api-usage bump:", error.message || error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("api-usage bump:", err?.message || err);
    return false;
  }
}

/** Fire-and-forget wrapper — still returns the promise for optional await. */
function recordApiUsage(opts) {
  return bumpApiUsage(opts).catch(() => false);
}

function utcDayString(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(ymd, delta) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Aggregate usage for the admin chart.
 * @param {{ days?: number }} opts
 */
async function loadApiUsageSummary({ days = 14 } = {}) {
  const windowDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const end = utcDayString();
  const start = addUtcDays(end, -(windowDays - 1));

  if (!hasSupabase()) {
    return { days: windowDays, start, end, features: [], sources: [], totalCalls: 0, totalCacheHits: 0 };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("api_usage_daily")
    .select("day, feature, source, calls, cache_hits")
    .gte("day", start)
    .lte("day", end)
    .order("day", { ascending: true });

  if (error) throw error;

  const byFeature = new Map();
  const bySource = new Map();
  let totalCalls = 0;
  let totalCacheHits = 0;

  for (const row of data || []) {
    const calls = Number(row.calls) || 0;
    const hits = Number(row.cache_hits) || 0;
    totalCalls += calls;
    totalCacheHits += hits;

    const feat = String(row.feature || "unknown");
    if (!byFeature.has(feat)) {
      byFeature.set(feat, { feature: feat, label: featureLabel(feat), calls: 0, cacheHits: 0 });
    }
    const f = byFeature.get(feat);
    f.calls += calls;
    f.cacheHits += hits;

    const src = String(row.source || "cfbd");
    if (!bySource.has(src)) {
      bySource.set(src, { source: src, calls: 0, cacheHits: 0 });
    }
    const s = bySource.get(src);
    s.calls += calls;
    s.cacheHits += hits;
  }

  const features = [...byFeature.values()].sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label));
  const sources = [...bySource.values()].sort((a, b) => b.calls - a.calls);

  return {
    days: windowDays,
    start,
    end,
    features,
    sources,
    totalCalls,
    totalCacheHits,
  };
}

module.exports = {
  FEATURE_LABELS,
  featureLabel,
  featureFromRequest,
  sanitizeToken,
  bumpApiUsage,
  recordApiUsage,
  loadApiUsageSummary,
};
