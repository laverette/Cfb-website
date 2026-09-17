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

function snapshotLeg(leg) {
  return {
    playerId: leg.player?.id,
    playerName: leg.player?.name,
    team: leg.player?.team,
    position: leg.player?.position,
    opponent: leg.opponent,
    statId: leg.stat?.id,
    statLabel: leg.stat?.label,
    line: leg.line,
    side: leg.side,
    projection: leg.projection,
    pMore: leg.pMore,
    pLess: leg.pLess,
    pHit: leg.pHit,
    confidence: leg.confidence,
    propScore: leg.propScore,
    propScoreLabel: leg.propScoreLabel,
    flags: leg.flags,
    modelVersion: leg.modelVersion || PROP_MODEL_VERSION,
    evaluatedAt: new Date().toISOString(),
  };
}

async function saveEntry({ userId, title, seasonYear, weekNumber, legs, analysis }) {
  if (!hasSupabase()) {
    const err = new Error("Database not configured");
    err.code = "NO_DB";
    throw err;
  }
  const supabase = getSupabase();
  const snapLegs = (legs || []).map((leg) => snapshotLeg(leg));
  const { data: entry, error } = await supabase
    .from("prop_lab_entries")
    .insert({
      user_id: userId,
      title: title || `Week ${weekNumber || "?"} card`,
      season_year: seasonYear,
      week_number: weekNumber,
      model_version: PROP_MODEL_VERSION,
      entry_snapshot: {
        analysis,
        legsPreview: snapLegs.map((l) => ({
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
  const rows = (legs || []).map((leg, i) => ({
    entry_id: entry.id,
    sort_order: i,
    player_id: String(leg.player?.id || ""),
    player_name: leg.player?.name || "",
    team: leg.player?.team || null,
    opponent: leg.opponent?.name || null,
    stat_id: leg.stat?.id,
    line: leg.line,
    side: leg.side,
    projection_snapshot: snapshotLeg(leg),
  }));
  if (rows.length) {
    const { error: legErr } = await supabase.from("prop_lab_legs").insert(rows);
    if (legErr) throw saveError(legErr, "legs");
  }
  return entry;
}

async function listEntries(userId) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("prop_lab_entries")
    .select("id, title, season_year, week_number, model_version, created_at, entry_snapshot")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
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

module.exports = { saveEntry, listEntries, getEntry, deleteEntry, snapshotLeg };
