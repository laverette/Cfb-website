/**
 * Product analytics for the 2026 free beta.
 * Never throws into product flows — callers should still wrap if needed.
 * Does NOT call CFBD or ESPN.
 */
const { getSupabase, hasSupabase } = require("../db");

const ALLOWED_EVENTS = new Set([
  "session_started",
  "user_signed_up",
  "user_logged_in",
  "prop_lab_opened",
  "player_searched",
  "prop_evaluated",
  "prop_added_to_card",
  "prop_removed_from_card",
  "entry_analyzed",
  "find_best_3_used",
  "find_best_4_used",
  "card_saved",
  "card_shared",
  "shared_card_opened",
  "shared_card_copied_to_builder",
  "weekly_picks_opened",
  "weekly_pick_selected",
  "weekly_picks_submitted",
  "weekly_results_viewed",
  "predict_matchup_clicked",
  "matchup_prediction_completed",
  "matchup_prediction_failed",
  "feature_error",
  "feedback_submitted",
  "viewer_signed_up",
  "viewer_used_prop_lab",
  "viewer_shared_card",
]);

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "authToken",
  "authorization",
  "apiKey",
  "api_key",
  "service_role",
  "email",
  "ip",
  "ipAddress",
  "stack",
  "stackTrace",
]);

function sanitizeEventName(name) {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return raw && ALLOWED_EVENTS.has(raw) ? raw : null;
}

function sanitizeAnonId(raw) {
  const s = String(raw || "").trim().slice(0, 64);
  if (s.length < 8) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
  return s;
}

function sanitizeUserId(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function sanitizeProperties(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  const keys = Object.keys(input).slice(0, 24);
  for (const key of keys) {
    if (SENSITIVE_KEYS.has(key) || /password|token|secret|email|stack/i.test(key)) {
      continue;
    }
    const val = input[key];
    if (val == null) continue;
    if (typeof val === "string") {
      out[key] = val.slice(0, 200);
    } else if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = val;
    } else if (typeof val === "boolean") {
      out[key] = val;
    } else if (Array.isArray(val)) {
      out[key] = val.slice(0, 12).map((v) => {
        if (typeof v === "string") return v.slice(0, 80);
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "boolean") return v;
        return String(v).slice(0, 80);
      });
    }
    // Skip nested objects / blobs intentionally.
  }
  return out;
}

/**
 * Insert one product event. Fire-and-forget safe.
 * @returns {Promise<boolean>}
 */
async function insertProductEvent({
  eventName,
  userId = null,
  anonymousSessionId = null,
  properties = {},
} = {}) {
  const name = sanitizeEventName(eventName);
  if (!name) return false;
  if (!hasSupabase()) return false;

  const uid = sanitizeUserId(userId);
  const anon = sanitizeAnonId(anonymousSessionId);
  if (!uid && !anon) return false;

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("product_events").insert({
      event_name: name,
      user_id: uid,
      anonymous_session_id: anon,
      properties: sanitizeProperties(properties),
    });
    if (error) {
      console.warn("product-analytics insert:", error.message || error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("product-analytics insert:", err?.message || err);
    return false;
  }
}

function recordProductEvent(opts) {
  return insertProductEvent(opts).catch(() => false);
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(date, delta) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function isoWeekBounds(reference = new Date()) {
  // ISO week: Monday 00:00 UTC → next Monday
  const day = reference.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = startOfUtcDay(addUtcDays(reference, mondayOffset));
  const end = addUtcDays(start, 7);
  return { start, end };
}

function actorKey(row) {
  if (row.user_id != null) return `u:${row.user_id}`;
  if (row.anonymous_session_id) return `a:${row.anonymous_session_id}`;
  return null;
}

function parseRange(qs = {}) {
  const preset = String(qs.range || qs.preset || "7d").toLowerCase();
  const now = new Date();
  let start;
  let end = now;
  let label = "Last 7 Days";

  if (preset === "today") {
    start = startOfUtcDay(now);
    label = "Today";
  } else if (preset === "30d" || preset === "last30" || preset === "last_30") {
    start = addUtcDays(startOfUtcDay(now), -29);
    label = "Last 30 Days";
  } else if (preset === "season" || preset === "2026") {
    start = new Date(Date.UTC(2026, 7, 1)); // Aug 1 2026
    label = "2026 Season";
  } else if (preset === "custom" && qs.start && qs.end) {
    start = new Date(String(qs.start));
    end = new Date(String(qs.end));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      start = addUtcDays(startOfUtcDay(now), -6);
      end = now;
      label = "Last 7 Days";
    } else {
      label = "Custom";
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
  } else {
    // 7d default
    start = addUtcDays(startOfUtcDay(now), -6);
    label = "Last 7 Days";
  }

  const weekNum = qs.week != null && qs.week !== "" ? Number(qs.week) : null;
  return {
    start,
    end,
    label,
    preset,
    week: Number.isFinite(weekNum) && weekNum > 0 ? Math.floor(weekNum) : null,
    season: qs.season != null ? Number(qs.season) || 2026 : 2026,
  };
}

async function fetchEventsInRange(start, end, { week = null, limit = 20000 } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  let query = supabase
    .from("product_events")
    .select("id, event_name, user_id, anonymous_session_id, properties, created_at")
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (week != null) {
    rows = rows.filter((r) => {
      const w = r.properties && (r.properties.week ?? r.properties.weekNumber);
      return w == null || Number(w) === Number(week);
    });
  }
  return rows;
}

function countByName(rows, name) {
  return rows.filter((r) => r.event_name === name).length;
}

function uniqueActors(rows, eventNames = null) {
  const set = new Set();
  for (const row of rows) {
    if (eventNames && !eventNames.has(row.event_name)) continue;
    const key = actorKey(row);
    if (key) set.add(key);
  }
  return set;
}

function uniqueActorsForEvent(rows, eventName) {
  return uniqueActors(rows, new Set([eventName]));
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

function buildDailySeries(rows, start, end, eventNames = null) {
  const map = new Map();
  let cursor = startOfUtcDay(start);
  const endDay = startOfUtcDay(end);
  while (cursor <= endDay) {
    map.set(cursor.toISOString().slice(0, 10), 0);
    cursor = addUtcDays(cursor, 1);
  }
  const actorsByDay = new Map();
  for (const row of rows) {
    if (eventNames && !eventNames.has(row.event_name)) continue;
    const d = dayKey(row.created_at);
    if (!map.has(d)) continue;
    if (eventNames === null) {
      // DAU: unique actors per day (any meaningful event)
      if (!actorsByDay.has(d)) actorsByDay.set(d, new Set());
      const key = actorKey(row);
      if (key) actorsByDay.get(d).add(key);
    } else {
      map.set(d, (map.get(d) || 0) + 1);
    }
  }
  if (eventNames === null) {
    for (const [d, set] of actorsByDay) {
      if (map.has(d)) map.set(d, set.size);
    }
  }
  return [...map.entries()].map(([date, value]) => ({ date, value }));
}

function computeRetention(currentActors, priorActors) {
  if (!currentActors.size || !priorActors.size) {
    return { overlap: 0, rate: null, priorActive: priorActors.size };
  }
  let overlap = 0;
  for (const a of currentActors) {
    if (priorActors.has(a)) overlap += 1;
  }
  return {
    overlap,
    rate: Math.round((overlap / priorActors.size) * 1000) / 10,
    priorActive: priorActors.size,
  };
}

async function countRegisteredUsers() {
  if (!hasSupabase()) return 0;
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.warn("product-analytics users count:", error.message || error);
    return 0;
  }
  return count || 0;
}

async function countNewUsersBetween(start, end) {
  if (!hasSupabase()) return 0;
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) {
    console.warn("product-analytics new users:", error.message || error);
    return 0;
  }
  return count || 0;
}

async function loadFeedback({ limit = 40 } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("beta_feedback")
    .select("id, user_id, category, message, page, status, pinned, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("product-analytics feedback:", error.message || error);
    return [];
  }
  return data || [];
}

async function loadNameSuggestions({ limit = 40 } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("site_name_suggestions")
    .select("id, user_id, suggested_name, note, page, status, pinned, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("product-analytics name suggestions:", error.message || error);
    return [];
  }
  return data || [];
}

/**
 * Build admin analytics payload. Reads only product_events + users + api_usage_daily.
 */
async function loadAdminAnalytics(qs = {}) {
  const range = parseRange(qs);
  const todayStart = startOfUtcDay(new Date());
  const todayEnd = new Date();
  const thisWeek = isoWeekBounds(new Date());
  const prevWeek = {
    start: addUtcDays(thisWeek.start, -7),
    end: thisWeek.start,
  };

  const [
    rangeRows,
    todayRows,
    weekRows,
    prevWeekRows,
    week2Rows,
    week3Rows,
    week4Rows,
    registeredUsers,
    newUsersWeek,
    newUsersToday,
    feedback,
    nameSuggestions,
  ] = await Promise.all([
    fetchEventsInRange(range.start, range.end, { week: range.week }),
    fetchEventsInRange(todayStart, todayEnd),
    fetchEventsInRange(thisWeek.start, thisWeek.end),
    fetchEventsInRange(prevWeek.start, prevWeek.end),
    fetchEventsInRange(addUtcDays(thisWeek.start, -14), addUtcDays(thisWeek.start, -7)),
    fetchEventsInRange(addUtcDays(thisWeek.start, -21), addUtcDays(thisWeek.start, -14)),
    fetchEventsInRange(addUtcDays(thisWeek.start, -28), addUtcDays(thisWeek.start, -21)),
    countRegisteredUsers(),
    countNewUsersBetween(thisWeek.start, thisWeek.end),
    countNewUsersBetween(todayStart, todayEnd),
    loadFeedback({ limit: 30 }),
    loadNameSuggestions({ limit: 40 }),
  ]);

  const weekActors = uniqueActors(weekRows);
  const prevActors = uniqueActors(prevWeekRows);
  const todayActors = uniqueActors(todayRows);
  const rangeActors = uniqueActors(rangeRows);

  const returningThisWeek = [...weekActors].filter((a) => prevActors.has(a)).length;
  const newActiveThisWeek = weekActors.size - returningThisWeek;
  const w2w = computeRetention(weekActors, prevActors);

  const retentionLags = [1, 2, 3, 4].map((weeksAgo) => {
    const prior =
      weeksAgo === 1
        ? prevActors
        : weeksAgo === 2
          ? uniqueActors(week2Rows)
          : weeksAgo === 3
            ? uniqueActors(week3Rows)
            : uniqueActors(week4Rows);
    const ret = computeRetention(weekActors, prior);
    return {
      weeksAgo,
      priorActive: ret.priorActive,
      returned: ret.overlap,
      rate: ret.rate,
    };
  });

  const propEvalWeek = countByName(weekRows, "prop_evaluated");
  const propUsersWeek = uniqueActorsForEvent(weekRows, "prop_evaluated").size ||
    uniqueActorsForEvent(weekRows, "prop_lab_opened").size;
  const picksParticipants = uniqueActorsForEvent(weekRows, "weekly_picks_submitted").size;
  const picksSubmissions = countByName(weekRows, "weekly_picks_submitted");
  const picksSelected = countByName(weekRows, "weekly_pick_selected");
  const matchups = countByName(weekRows, "matchup_prediction_completed");
  const matchupUsers = uniqueActorsForEvent(weekRows, "matchup_prediction_completed").size;
  const matchupFails = countByName(weekRows, "matchup_prediction_failed");
  const cardsSaved = countByName(weekRows, "card_saved");
  const cardsShared = countByName(weekRows, "card_shared");
  const sharedOpens = countByName(weekRows, "shared_card_opened");
  const uniqueShareViewers = uniqueActorsForEvent(weekRows, "shared_card_opened").size;
  const best3 = countByName(weekRows, "find_best_3_used");
  const best4 = countByName(weekRows, "find_best_4_used");
  const resultsViews = countByName(weekRows, "weekly_results_viewed");

  const active = weekActors.size || 1;
  const adoption = {
    propLab: Math.round(
      (uniqueActors(
        weekRows,
        new Set(["prop_lab_opened", "prop_evaluated", "player_searched"])
      ).size /
        active) *
        1000
    ) / 10,
    weeklyPicks: Math.round((picksParticipants / active) * 1000) / 10,
    predictMatchup:
      Math.round(
        (uniqueActors(
          weekRows,
          new Set(["predict_matchup_clicked", "matchup_prediction_completed"])
        ).size /
          active) *
          1000
      ) / 10,
    sharedCard: Math.round(
      (uniqueActorsForEvent(weekRows, "card_shared").size / active) * 1000
    ) / 10,
  };

  const errorRows = weekRows.filter((r) => r.event_name === "feature_error");
  const errorBuckets = {};
  for (const row of errorRows) {
    const code = (row.properties && row.properties.errorCode) || "UNKNOWN";
    const feature = (row.properties && row.properties.feature) || "unknown";
    const key = `${feature}:${code}`;
    errorBuckets[key] = (errorBuckets[key] || 0) + 1;
  }

  const shareFunnel = {
    cardShared: cardsShared,
    sharedOpened: sharedOpens,
    uniqueViewers: uniqueShareViewers,
    viewerSignedUp: countByName(weekRows, "viewer_signed_up"),
    viewerUsedPropLab: countByName(weekRows, "viewer_used_prop_lab"),
    viewerSharedCard: countByName(weekRows, "viewer_shared_card"),
  };

  const anonWeek = [...weekActors].filter((a) => a.startsWith("a:")).length;
  const authWeek = [...weekActors].filter((a) => a.startsWith("u:")).length;

  // Sessions heuristic: session_started count / unique actors
  const sessions = countByName(weekRows, "session_started");
  const avgSessions =
    weekActors.size > 0 ? Math.round((sessions / weekActors.size) * 10) / 10 : null;

  let apiHealth = null;
  try {
    const { loadApiUsageSummary } = require("./api-usage");
    apiHealth = await loadApiUsageSummary({ days: 7 });
  } catch (err) {
    console.warn("product-analytics api health:", err?.message || err);
  }

  const chartStart30 = addUtcDays(startOfUtcDay(new Date()), -29);
  const last30 = await fetchEventsInRange(chartStart30, new Date());

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    range: {
      label: range.label,
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      week: range.week,
      season: range.season,
    },
    summary: {
      today: {
        activeUsers: todayActors.size,
        propEvaluations: countByName(todayRows, "prop_evaluated"),
        weeklyPicksUsers: uniqueActorsForEvent(todayRows, "weekly_picks_submitted").size,
        matchupPredictions: countByName(todayRows, "matchup_prediction_completed"),
        cardsShared: countByName(todayRows, "card_shared"),
        newUsers: newUsersToday,
      },
      thisWeek: {
        weeklyActiveUsers: weekActors.size,
        authenticatedActive: authWeek,
        anonymousActive: anonWeek,
        newUsers: newUsersWeek,
        newActiveUsers: newActiveThisWeek,
        returningUsers: returningThisWeek,
        propEvaluations: propEvalWeek,
        weeklyPicksSubmissions: picksSubmissions,
        sharedCardOpens: sharedOpens,
        avgSessionsPerUser: avgSessions,
        registeredUsers,
      },
    },
    retention: {
      weekToWeek: {
        priorWeekActive: w2w.priorActive,
        returned: w2w.overlap,
        rate: w2w.rate,
        currentWeekActive: weekActors.size,
      },
      lags: retentionLags,
    },
    featureUsage: {
      propLab: {
        evaluations: propEvalWeek,
        uniqueUsers: propUsersWeek,
        avgEvaluationsPerUser:
          propUsersWeek > 0 ? Math.round((propEvalWeek / propUsersWeek) * 10) / 10 : null,
        cardsSaved,
        cardsShared,
        sharedOpens,
        findBest3: best3,
        findBest4: best4,
      },
      weeklyPicks: {
        participants: picksParticipants,
        submissions: picksSubmissions,
        resultViews: resultsViews,
        pickSelections: picksSelected,
        avgPicksSubmitted:
          picksParticipants > 0
            ? Math.round((picksSelected / Math.max(picksSubmissions, 1)) * 10) / 10
            : null,
      },
      predictMatchup: {
        predictions: matchups,
        uniqueUsers: matchupUsers,
        failures: matchupFails,
        failureRate:
          matchups + matchupFails > 0
            ? Math.round((matchupFails / (matchups + matchupFails)) * 1000) / 10
            : null,
      },
      sharing: {
        cardsShared,
        uniqueCardsShared: uniqueActorsForEvent(weekRows, "card_shared").size,
        sharedOpens,
        uniqueViewers: uniqueShareViewers,
        anonymousViewers: [...uniqueActorsForEvent(weekRows, "shared_card_opened")].filter((a) =>
          a.startsWith("a:")
        ).length,
      },
    },
    adoption,
    shareFunnel,
    errors: {
      total: errorRows.length,
      buckets: Object.entries(errorBuckets)
        .map(([key, count]) => {
          const [feature, errorCode] = key.split(":");
          return { feature, errorCode, count };
        })
        .sort((a, b) => b.count - a.count),
    },
    charts: {
      dailyActiveUsers: buildDailySeries(last30, chartStart30, new Date(), null),
      propEvaluationsPerDay: buildDailySeries(
        last30,
        chartStart30,
        new Date(),
        new Set(["prop_evaluated"])
      ),
      sharedCardOpensPerDay: buildDailySeries(
        last30,
        chartStart30,
        new Date(),
        new Set(["shared_card_opened"])
      ),
      weeklyPicksByDay: buildDailySeries(
        last30,
        chartStart30,
        new Date(),
        new Set(["weekly_picks_submitted"])
      ),
    },
    rangeTotals: {
      activeUsers: rangeActors.size,
      events: rangeRows.length,
      propEvaluations: countByName(rangeRows, "prop_evaluated"),
      weeklyPicksSubmissions: countByName(rangeRows, "weekly_picks_submitted"),
      matchupPredictions: countByName(rangeRows, "matchup_prediction_completed"),
      cardsShared: countByName(rangeRows, "card_shared"),
      sharedOpens: countByName(rangeRows, "shared_card_opened"),
    },
    apiHealth,
    feedback,
    nameSuggestions,
  };
}

async function insertBetaFeedback({
  userId = null,
  category = "general",
  message,
  page = null,
} = {}) {
  if (!hasSupabase()) return null;
  const cat = ["bug", "feature", "general"].includes(String(category))
    ? String(category)
    : "general";
  const msg = String(message || "").trim().slice(0, 4000);
  if (msg.length < 1) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("beta_feedback")
      .insert({
        user_id: sanitizeUserId(userId),
        category: cat,
        message: msg,
        page: page ? String(page).slice(0, 300) : null,
        status: "new",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("beta_feedback insert:", error.message || error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("beta_feedback insert:", err?.message || err);
    return null;
  }
}

module.exports = {
  ALLOWED_EVENTS,
  sanitizeEventName,
  sanitizeAnonId,
  sanitizeUserId,
  sanitizeProperties,
  insertProductEvent,
  recordProductEvent,
  loadAdminAnalytics,
  insertBetaFeedback,
  isoWeekBounds,
  actorKey,
  uniqueActors,
  computeRetention,
  parseRange,
};
