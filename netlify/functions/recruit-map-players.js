/**
 * LEGACY: DB-backed recruit list — public map uses static JSON (/data/recruits/).
 * GET /api/recruit-map/players
 */
const { getSupabase, selectAllPages } = require("./db");
const { json } = require("./_http");

function numOrNull(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function safeNum(v) {
  if (v == null) return null;
  if (typeof v === "bigint") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeDbDetail(err) {
  if (!err || typeof err !== "object") return String(err);
  const msg = err.message || String(err);
  const code = err.code || err.errno;
  const combined = [code, msg].filter(Boolean).join(" | ");
  return combined
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[db]")
    .replace(/:\/\/[^\s]+@[^\s]+/g, "://[redacted]")
    .slice(0, 500);
}

function mapRowToPlayer(r) {
  const lat = r.latitude != null ? safeNum(r.latitude) : null;
  const lon = r.longitude != null ? safeNum(r.longitude) : null;
  return {
    id: safeNum(r.id),
    cfbd_player_id: r.cfbd_player_id != null ? safeNum(r.cfbd_player_id) : null,
    cfbd_recruit_id: r.cfbd_recruit_id != null ? String(r.cfbd_recruit_id) : null,
    athlete_id: r.athlete_id != null ? String(r.athlete_id) : null,
    recruit_type: r.recruit_type != null ? String(r.recruit_type) : null,
    player_name: r.player_name != null ? String(r.player_name) : "",
    team: r.team != null ? String(r.team) : "",
    committed_to: r.committed_to != null ? String(r.committed_to) : null,
    school: r.school != null ? String(r.school) : null,
    team_school: r.team_school != null ? String(r.team_school) : null,
    conference: r.conference != null ? String(r.conference) : null,
    season_year: safeNum(r.season_year),
    position: r.position != null ? String(r.position) : null,
    hometown_city: r.hometown_city != null ? String(r.hometown_city) : null,
    hometown_state: r.hometown_state != null ? String(r.hometown_state) : null,
    hometown_country: r.hometown_country != null ? String(r.hometown_country) : null,
    hometown_full: r.hometown_full != null ? String(r.hometown_full) : null,
    latitude: lat,
    longitude: lon,
    stars: r.stars != null ? safeNum(r.stars) : null,
    rating: (() => {
      if (r.rating == null) return null;
      const x = Number(r.rating);
      return Number.isFinite(x) ? x : null;
    })(),
    ranking: r.ranking != null ? safeNum(r.ranking) : null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const team = q.team != null ? String(q.team).trim() : "";
  const conference = q.conference != null ? String(q.conference).trim() : "";
  const year = numOrNull(q.year);
  const search = q.search != null ? String(q.search).trim() : "";
  const state = q.state != null ? String(q.state).trim() : "";
  const position = q.position != null ? String(q.position).trim() : "";
  const classification =
    q.classification != null ? String(q.classification).trim() : "";
  const stars = numOrNull(q.stars);
  const includeMissingCoords =
    String(q.includeMissingCoords || "").toLowerCase() === "true" ||
    String(q.includeMissingCoords || "") === "1";

  try {
    const supabase = getSupabase();
    const rows = await selectAllPages(() => {
      let query = supabase
        .from("player_hometowns")
        .select(
          "id, cfbd_player_id, cfbd_recruit_id, athlete_id, recruit_type, player_name, team, committed_to, school, team_school, conference, season_year, position, hometown_city, hometown_state, hometown_country, hometown_full, latitude, longitude, stars, rating, ranking"
        )
        .order("player_name", { ascending: true });

      if (!includeMissingCoords) {
        query = query.not("latitude", "is", null).not("longitude", "is", null);
      }
      if (year != null) query = query.eq("season_year", year);
      if (conference) query = query.eq("conference", conference);
      if (state) query = query.eq("hometown_state", state);
      if (position) query = query.eq("position", position);
      if (classification) query = query.eq("recruit_type", classification);
      if (stars != null) query = query.eq("stars", stars);
      if (search) {
        const safe = search.replace(/[%_,.()]/g, "").trim();
        if (safe) query = query.ilike("player_name", `%${safe}%`);
      }
      return query;
    });

    const filtered = team
      ? rows.filter((r) => r.team === team || r.committed_to === team || r.school === team)
      : rows;
    const players = filtered.slice(0, 5000).map(mapRowToPlayer);
    return json(200, { count: players.length, players });
  } catch (err) {
    console.error("[recruit-map-players] query error", err && err.stack ? err.stack : err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, {
      error: "Recruit map players query failed",
      details: sanitizeDbDetail(err),
    });
  }
};
