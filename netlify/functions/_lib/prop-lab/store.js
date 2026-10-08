const crypto = require("crypto");
const { getSupabase, hasSupabase } = require("../../db");
const { PROP_MODEL_VERSION } = require("./version");

/** Postgres undefined_table. Means the schema was never applied. */
const UNDEFINED_TABLE = "42P01";

/**
 * Turn a raw Postgres failure into something a user can act on. A missing
 * table otherwise surfaces as 'relation "public.prop_lab_entries" does not
 * exist', which reads like the app lost the user's data rather than like a
 * one-time setup step that was skipped.
 */
function saveError(error, what) {
  if (error?.code === UNDEFINED_TABLE) {
    const err = new Error(
      "Prop Lab tables are missing from the database. Apply sql/prop_lab_schema.sql in the Supabase SQL editor, then try saving again."
    );
    err.code = "SCHEMA_MISSING";
    return err;
  }
  const err = new Error(error?.message || `Failed to save ${what}`);
  err.code = "SAVE_FAILED";
  return err;
}

/**
 * Slim, display-ready leg snapshot shared by Save and Share.
 * Omits CFBD dumps / modelDebug / secrets — enough to render without re-eval.
 */
function snapshotLeg(leg) {
  if (!leg || typeof leg !== "object") return null;
  const player = leg.player || {};
  const opponent =
    typeof leg.opponent === "string"
      ? { name: leg.opponent }
      : leg.opponent && typeof leg.opponent === "object"
        ? {
            name: leg.opponent.name || null,
            week: leg.opponent.week ?? null,
            homeAway: leg.opponent.homeAway || null,
            startDate: leg.opponent.startDate || null,
            isFcs: Boolean(leg.opponent.isFcs),
            espnId: leg.opponent.espnId || null,
            source: leg.opponent.source || null,
          }
        : null;
  const matchup = leg.matchup
    ? {
        headline: leg.matchup.headline || null,
        note: leg.matchup.note || null,
        adjPct: leg.matchup.adjPct ?? null,
        adjPctDisplay: leg.matchup.adjPctDisplay ?? null,
        factors: Array.isArray(leg.matchup.factors)
          ? leg.matchup.factors.slice(0, 4).map((f) => ({
              label: f.label,
              quality: f.quality || null,
              adj: f.adj ?? null,
              defensePct: f.defensePct ?? null,
            }))
          : [],
        missing: Boolean(leg.matchup.missing),
      }
    : null;
  const form = leg.form
    ? {
        season: leg.form.season ?? null,
        l3: leg.form.l3 ?? null,
        prior: leg.form.prior ?? null,
        games: leg.form.games ?? null,
        hitRate: leg.form.hitRate ?? null,
        hitRateL5: leg.form.hitRateL5 ?? null,
      }
    : null;
  const usage = leg.usage
    ? {
        role: leg.usage.role || null,
        roleDetail: leg.usage.roleDetail || null,
        inferred: Boolean(leg.usage.inferred),
        recShare: leg.usage.recShare ?? null,
        carryShare: leg.usage.carryShare ?? null,
        attShare: leg.usage.attShare ?? null,
      }
    : null;

  return {
    playerId: player.id ?? leg.playerId ?? null,
    playerName: player.name ?? leg.playerName ?? null,
    team: player.team ?? leg.team ?? null,
    position: player.position ?? leg.position ?? null,
    opponent,
    statId: leg.stat?.id ?? leg.statId ?? null,
    statLabel: leg.stat?.label ?? leg.statLabel ?? null,
    statShort: leg.stat?.short ?? null,
    line: leg.line,
    side: leg.side || "more",
    projection: leg.projection ?? null,
    median: leg.median ?? null,
    range: leg.range || null,
    pMore: leg.pMore ?? null,
    pLess: leg.pLess ?? null,
    pHit: leg.pHit ?? null,
    confidence: leg.confidence ?? null,
    confidenceScore: leg.confidenceScore ?? null,
    propScore: leg.propScore ?? null,
    propScoreLabel: leg.propScoreLabel ?? null,
    flags: Array.isArray(leg.flags) ? leg.flags.slice(0, 12) : [],
    why: Array.isArray(leg.why) ? leg.why.slice(0, 3) : [],
    caution: Array.isArray(leg.caution) ? leg.caution.slice(0, 3) : [],
    hitCountLabel: leg.hitCountLabel || null,
    scheduleWarning: leg.scheduleWarning || null,
    matchup,
    form,
    usage,
    environment: leg.environment
      ? {
          blowoutRisk: leg.environment.blowoutRisk || null,
          notes: Array.isArray(leg.environment.notes)
            ? leg.environment.notes.slice(0, 3)
            : [],
          homeAway: leg.environment.homeAway || null,
        }
      : null,
    distribution: leg.distribution
      ? { sd: leg.distribution.sd ?? null, dist: leg.distribution.dist || null }
      : null,
    modelVersion: leg.modelVersion || PROP_MODEL_VERSION,
    frozen: true,
    evaluatedAt: new Date().toISOString(),
  };
}

function slimAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  return {
    note: analysis.note || null,
    risk: analysis.risk || null,
    riskPercent: analysis.riskPercent ?? null,
    safetyPercent: analysis.safetyPercent ?? null,
    grade: analysis.grade || null,
    entryStrength: analysis.entryStrength ?? null,
    together: analysis.together
      ? {
          n: analysis.together.n,
          p: analysis.together.p,
          label: analysis.together.label,
          pctLabel: analysis.together.pctLabel,
          americanLabel: analysis.together.americanLabel,
          method: analysis.together.method,
        }
      : null,
    value: analysis.value
      ? {
          verdict: analysis.value.verdict,
          verdictLabel: analysis.value.verdictLabel,
          summary: analysis.value.summary,
          modelLabel: analysis.value.modelLabel,
          neededLabel: analysis.value.neededLabel,
          evLabel: analysis.value.evLabel,
          edge: analysis.value.edge,
          pUse: analysis.value.pUse,
          payout: analysis.value.payout
            ? {
                label: analysis.value.payout.label,
                americanLabel: analysis.value.payout.americanLabel,
                multiplier: analysis.value.payout.multiplier,
                source: analysis.value.payout.source,
              }
            : null,
          reasons: Array.isArray(analysis.value.reasons)
            ? analysis.value.reasons.slice(0, 6)
            : [],
        }
      : null,
    riskDrivers: Array.isArray(analysis.riskDrivers)
      ? analysis.riskDrivers.slice(0, 8)
      : [],
    correlations: Array.isArray(analysis.correlations)
      ? analysis.correlations.slice(0, 8).map((c) => ({
          label: c.label,
          explanation: c.explanation,
          sign: c.sign,
          corr: c.corr,
        }))
      : [],
    strongestCaption: analysis.strongestCaption || null,
    weakestCaption: analysis.weakestCaption || null,
    strongestLabel: analysis.strongestLabel || null,
    weakestLabel: analysis.weakestLabel || null,
  };
}

/**
 * Canonical card payload for both private save snapshots and public shares.
 */
function serializePropCard({
  legs,
  analysis,
  title,
  seasonYear,
  weekNumber,
  payoutOdds = null,
  modelVersion = PROP_MODEL_VERSION,
} = {}) {
  const snapLegs = (legs || []).map((leg) => snapshotLeg(leg)).filter(Boolean);
  return {
    v: 2,
    title: title || `Week ${weekNumber || "?"} card`,
    seasonYear: seasonYear ?? null,
    weekNumber: weekNumber ?? null,
    modelVersion: modelVersion || PROP_MODEL_VERSION,
    payoutOdds: payoutOdds || null,
    sharedAt: new Date().toISOString(),
    analysis: slimAnalysis(analysis),
    legs: snapLegs,
  };
}

function payloadContentHash(payload) {
  const canonical = {
    v: payload?.v,
    title: payload?.title,
    seasonYear: payload?.seasonYear,
    weekNumber: payload?.weekNumber,
    modelVersion: payload?.modelVersion,
    payoutOdds: payload?.payoutOdds || null,
    analysis: payload?.analysis || null,
    legs: (payload?.legs || []).map((l) => ({
      playerId: l.playerId,
      statId: l.statId,
      line: l.line,
      side: l.side,
      projection: l.projection,
      pHit: l.pHit,
      propScore: l.propScore,
      confidence: l.confidence,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function saveEntry({ userId, title, seasonYear, weekNumber, legs, analysis }) {
  if (!hasSupabase()) {
    const err = new Error("Database not configured");
    err.code = "NO_DB";
    throw err;
  }
  const supabase = getSupabase();
  const card = serializePropCard({
    legs,
    analysis,
    title,
    seasonYear,
    weekNumber,
  });
  const { data: entry, error } = await supabase
    .from("prop_lab_entries")
    .insert({
      user_id: userId,
      title: card.title,
      season_year: seasonYear,
      week_number: weekNumber,
      model_version: PROP_MODEL_VERSION,
      entry_snapshot: {
        analysis: card.analysis,
        legsPreview: card.legs.map((l) => ({
          playerName: l.playerName,
          team: l.team,
          statLabel: l.statLabel,
          statId: l.statId,
          line: l.line,
          side: l.side,
          pHit: l.pHit,
          projection: l.projection,
        })),
        savedAt: new Date().toISOString(),
        modelVersion: PROP_MODEL_VERSION,
      },
    })
    .select("id, title, season_year, week_number, model_version, created_at, entry_snapshot")
    .single();
  if (error) throw saveError(error, "entry");
  const rows = (legs || []).map((leg, i) => {
    const snap = snapshotLeg(leg);
    return {
      entry_id: entry.id,
      sort_order: i,
      player_id: String(snap?.playerId || ""),
      player_name: snap?.playerName || "",
      team: snap?.team || null,
      opponent: snap?.opponent?.name || null,
      stat_id: snap?.statId,
      line: snap?.line,
      side: snap?.side,
      projection_snapshot: snap,
    };
  });
  if (rows.length) {
    const { error: legErr } = await supabase.from("prop_lab_legs").insert(rows);
    if (legErr) throw saveError(legErr, "legs");
  }
  return entry;
}

async function listEntries(userId, { seasonYear, weekNumber } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  let query = supabase
    .from("prop_lab_entries")
    .select("id, title, season_year, week_number, model_version, created_at, entry_snapshot")
    .eq("user_id", userId);
  const season = Number(seasonYear);
  const week = Number(weekNumber);
  if (Number.isFinite(season) && season > 0) query = query.eq("season_year", season);
  if (Number.isFinite(week) && week > 0) query = query.eq("week_number", week);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(40);
  if (error) return [];
  return data || [];
}

async function getEntry(userId, id) {
  if (!hasSupabase()) return null;
  const supabase = getSupabase();
  const { data: entry, error } = await supabase
    .from("prop_lab_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error || !entry) return null;
  const { data: legs } = await supabase
    .from("prop_lab_legs")
    .select("*")
    .eq("entry_id", id)
    .order("sort_order", { ascending: true });
  return { ...entry, legs: legs || [] };
}

async function deleteEntry(userId, id) {
  if (!hasSupabase()) return false;
  const supabase = getSupabase();
  const { error } = await supabase.from("prop_lab_entries").delete().eq("user_id", userId).eq("id", id);
  return !error;
}

function newShareId() {
  // 16 hex chars — short enough for a URL, hard to guess.
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Persist a shareable card snapshot and return a short id. Query-string
 * base64 payloads blow past browser/CDN URL limits once a card has a few
 * legs, so shares live in the database instead.
 */
async function createShare({ payload, userId = null, ttlDays = 90 } = {}) {
  if (!hasSupabase()) {
    const err = new Error("Database not configured");
    err.code = "NO_DB";
    throw err;
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.legs) || !payload.legs.length) {
    const err = new Error("Share payload needs at least one leg");
    err.code = "INVALID_SHARE";
    throw err;
  }

  // Normalize through serializer when payload looks like live evaluations.
  const normalized =
    payload.v >= 2 || payload.legs[0]?.playerName != null
      ? {
          ...payload,
          v: payload.v || 2,
          modelVersion: payload.modelVersion || PROP_MODEL_VERSION,
          sharedAt: payload.sharedAt || new Date().toISOString(),
          legs: payload.legs.map((l) =>
            l.playerName != null || l.projection != null ? { ...l, frozen: true } : snapshotLeg(l)
          ),
        }
      : serializePropCard({
          legs: payload.legs,
          analysis: payload.analysis,
          title: payload.title,
          seasonYear: payload.seasonYear,
          weekNumber: payload.weekNumber,
          payoutOdds: payload.payoutOdds,
          modelVersion: payload.modelVersion,
        });

  const supabase = getSupabase();
  const contentHash = payloadContentHash(normalized);
  const expiresAt =
    ttlDays > 0 ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString() : null;

  // Prefer reusing an identical unexpired snapshot (same hash).
  try {
    let query = supabase
      .from("prop_lab_shares")
      .select("id, created_at, expires_at")
      .eq("content_hash", contentHash)
      .order("created_at", { ascending: false })
      .limit(1);
    if (userId) query = query.eq("created_by", userId);
    const { data: existingRows, error: existingErr } = await query;
    if (!existingErr) {
      const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
      if (
        existing?.id &&
        (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())
      ) {
        return { ...existing, reused: true };
      }
    }
  } catch {
    /* content_hash column may be missing on older deploys — continue to insert */
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const id = newShareId();
    const row = {
      id,
      payload: normalized,
      created_by: userId || null,
      expires_at: expiresAt,
      content_hash: contentHash,
      model_version: normalized.modelVersion || PROP_MODEL_VERSION,
    };
    const { data, error } = await supabase
      .from("prop_lab_shares")
      .insert(row)
      .select("id, created_at, expires_at")
      .single();
    if (!error && data) return { ...data, reused: false };
    // Older schema without content_hash / model_version — retry without extras
    if (error && /content_hash|model_version/i.test(error.message || "")) {
      const { data: data2, error: err2 } = await supabase
        .from("prop_lab_shares")
        .insert({
          id,
          payload: normalized,
          created_by: userId || null,
          expires_at: expiresAt,
        })
        .select("id, created_at, expires_at")
        .single();
      if (!err2 && data2) return { ...data2, reused: false };
      if (err2?.code === UNDEFINED_TABLE) throw saveError(err2, "share");
      if (err2?.code !== "23505") throw saveError(err2, "share");
      continue;
    }
    if (error?.code === UNDEFINED_TABLE) throw saveError(error, "share");
    if (error?.code !== "23505") throw saveError(error, "share");
  }
  const err = new Error("Could not allocate a share id");
  err.code = "SAVE_FAILED";
  throw err;
}

async function getShare(id) {
  if (!hasSupabase()) return null;
  const shareId = String(id || "").trim().toLowerCase();
  if (!/^[a-f0-9]{12,32}$/.test(shareId)) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("prop_lab_shares")
    .select("id, payload, created_at, expires_at, model_version")
    .eq("id", shareId)
    .maybeSingle();
  if (error) {
    if (error.code === UNDEFINED_TABLE) return null;
    // Older select without model_version
    if (/model_version/i.test(error.message || "")) {
      const retry = await supabase
        .from("prop_lab_shares")
        .select("id, payload, created_at, expires_at")
        .eq("id", shareId)
        .maybeSingle();
      if (retry.error || !retry.data) return null;
      if (retry.data.expires_at && new Date(retry.data.expires_at).getTime() < Date.now()) {
        return null;
      }
      return retry.data;
    }
    return null;
  }
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

module.exports = {
  saveEntry,
  listEntries,
  getEntry,
  deleteEntry,
  snapshotLeg,
  slimAnalysis,
  serializePropCard,
  createShare,
  getShare,
  payloadContentHash,
};
