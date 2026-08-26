/**
 * Supabase persistence for power ratings (optional — engine works without DB).
 */
const { getSupabase, dbError, selectAllPages, hasSupabase } = require("../../db");

async function loadLatestRatings({ season, week } = {}) {
  const supabase = getSupabase();
  let targetSeason = season != null ? Number(season) : null;
  let targetWeek = week != null ? Number(week) : null;

  if (targetSeason == null || targetWeek == null) {
    const { data: latest, error } = await supabase
      .from("power_team_ratings")
      .select("season, week")
      .order("season", { ascending: false })
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    dbError(error);
    if (!latest) return { season: targetSeason, week: targetWeek, teams: [] };
    targetSeason = Number(latest.season);
    targetWeek = Number(latest.week);
  }

  const rows = await selectAllPages(() =>
    supabase
      .from("power_team_ratings")
      .select("*")
      .eq("season", targetSeason)
      .eq("week", targetWeek)
      .order("ranking", { ascending: true })
  );

  const teamIds = rows.map((r) => r.team_id);
  let teamsMeta = [];
  if (teamIds.length) {
    const { data, error } = await supabase
      .from("power_teams")
      .select("team_id, name, abbreviation, conference, classification, logo_url")
      .in("team_id", teamIds);
    dbError(error);
    teamsMeta = data || [];
  }
  const metaById = new Map(teamsMeta.map((t) => [Number(t.team_id), t]));

  const teams = rows.map((r) => {
    const meta = metaById.get(Number(r.team_id)) || {};
    return {
      teamId: Number(r.team_id),
      name: meta.name || String(r.team_id),
      abbreviation: meta.abbreviation || null,
      conference: meta.conference || null,
      classification: meta.classification || "fbs",
      logoUrl: meta.logo_url || null,
      season: Number(r.season),
      week: Number(r.week),
      rawPower: Number(r.raw_power),
      powerScore: Number(r.power_score),
      offenseRating: Number(r.offense_rating) || 0,
      defenseRating: Number(r.defense_rating) || 0,
      specialTeamsRating: Number(r.special_teams_rating) || 0,
      talentRating: Number(r.talent_rating) || 50,
      sosRating: Number(r.sos_rating) || 0,
      ranking: Number(r.ranking),
      previousRanking: r.previous_ranking != null ? Number(r.previous_ranking) : null,
      rankingMovement:
        r.previous_ranking != null
          ? Number(r.previous_ranking) - Number(r.ranking)
          : null,
      wins: Number(r.wins) || 0,
      losses: Number(r.losses) || 0,
      record: `${Number(r.wins) || 0}-${Number(r.losses) || 0}`,
    };
  });

  return { season: targetSeason, week: targetWeek, teams };
}

async function upsertTeams(teams) {
  if (!teams.length) return;
  const supabase = getSupabase();
  const rows = teams.map((t) => ({
    team_id: t.id ?? t.teamId,
    name: t.name,
    abbreviation: t.abbreviation || null,
    conference: t.conference || null,
    classification: t.classification || "fbs",
    logo_url: t.logoUrl || null,
    updated_at: new Date().toISOString(),
  }));
  // chunk
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from("power_teams").upsert(chunk, {
      onConflict: "team_id",
    });
    dbError(error);
  }
}

async function saveRatingSnapshot(result) {
  const supabase = getSupabase();
  const season = result.season;
  const week = result.week;
  const rows = (result.teams || []).map((t) => ({
    team_id: t.teamId,
    season,
    week,
    raw_power: t.rawPower,
    power_score: t.powerScore,
    offense_rating: t.offenseRating,
    defense_rating: t.defenseRating,
    special_teams_rating: t.specialTeamsRating,
    talent_rating: t.talentRating,
    sos_rating: t.sosRating,
    ranking: t.ranking,
    previous_ranking: t.previousRanking,
    wins: t.wins,
    losses: t.losses,
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from("power_team_ratings").upsert(chunk, {
      onConflict: "team_id,season,week",
    });
    dbError(error);
  }

  const { error: runErr } = await supabase.from("power_model_runs").insert({
    season,
    week,
    params: result.paramsUsed || {},
    solver: result.solver || {},
    team_count: rows.length,
  });
  dbError(runErr);
}

async function loadActivePersonnelAdjustments() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("power_personnel_adjustments")
    .select("team_id, impact_value, active")
    .eq("active", true);
  dbError(error);
  const map = new Map();
  for (const row of data || []) {
    const id = Number(row.team_id);
    map.set(id, (map.get(id) || 0) + (Number(row.impact_value) || 0));
  }
  return map;
}

module.exports = {
  hasSupabase,
  loadLatestRatings,
  upsertTeams,
  saveRatingSnapshot,
  loadActivePersonnelAdjustments,
};
