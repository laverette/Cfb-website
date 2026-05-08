/**
 * POST /api/admin/recruit-map/sync
 * Body JSON: { year (required), team?: "ALA" (abbrev), offset?: 0, limit?: 12 }
 * Pulls CFBD /teams + /roster per FBS team batch; upserts PlayerHometowns.
 * Batched for Netlify time limits — call repeatedly with nextOffset until done.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

const CFBD_BASE = "https://api.collegefootballdata.com";

async function cfbdFetch(path, apiKey) {
  const url = path.startsWith("http") ? path : `${CFBD_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`CFBD ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function playerName(p) {
  const a = (p.first_name || "").trim();
  const b = (p.last_name || "").trim();
  const n = `${a} ${b}`.trim();
  return n || `Player ${p.id}`;
}

function buildHometownFull(city, state, country) {
  const parts = [];
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (
    country &&
    String(country).toUpperCase() !== "USA" &&
    String(country).toUpperCase() !== "US"
  ) {
    parts.push(country);
  }
  return parts.length ? parts.join(", ") : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, { error: "CFBD API not configured" });
  }

  const body = parseJsonBody(event) || {};
  const year = parseInt(body.year ?? body.season_year ?? "", 10);
  if (!Number.isFinite(year) || year < 2009 || year > 2100) {
    return json(400, { error: "year is required (season year, e.g. 2024)" });
  }

  const singleTeam = body.team != null ? String(body.team).trim() : "";
  const offset = Math.max(0, parseInt(body.offset ?? 0, 10) || 0);
  const limit = Math.min(25, Math.max(1, parseInt(body.limit ?? 12, 10) || 12));

  let conn;
  try {
    const pool = getPool();
    conn = await pool.getConnection();

    const allTeamsRaw = await cfbdFetch(`/teams?year=${year}`, apiKey);
    const allTeams = Array.isArray(allTeamsRaw) ? allTeamsRaw : [];

    let teamRows;
    let totalFbs = 0;

    if (singleTeam) {
      teamRows = allTeams.filter(
        (t) =>
          (t.abbreviation || "").toUpperCase() === singleTeam.toUpperCase() ||
          (t.school || "").toLowerCase() === singleTeam.toLowerCase()
      );
      if (!teamRows.length) {
        return json(400, { error: "team not found for year", team: singleTeam });
      }
      totalFbs = teamRows.length;
    } else {
      const fbs = allTeams.filter(
        (t) => (t.classification || "").toLowerCase() === "fbs"
      );
      fbs.sort((a, b) =>
        String(a.abbreviation || "").localeCompare(String(b.abbreviation || ""))
      );
      totalFbs = fbs.length;
      teamRows = fbs.slice(offset, offset + limit);
    }

    let upserted = 0;
    const errors = [];

    for (const t of teamRows) {
      const abbr = t.abbreviation;
      if (!abbr) continue;
      try {
        await new Promise((r) => setTimeout(r, 120));
        const roster = await cfbdFetch(
          `/roster?team=${encodeURIComponent(abbr)}&year=${year}`,
          apiKey
        );
        const players = Array.isArray(roster) ? roster : [];

        for (const p of players) {
          const pid = p.id;
          if (pid == null || !Number.isFinite(Number(pid))) continue;

          const city = p.home_city != null ? String(p.home_city).trim() : "";
          const state = p.home_state != null ? String(p.home_state).trim() : "";
          const country =
            p.home_country != null ? String(p.home_country).trim() : "";
          let lat =
            p.home_latitude != null ? Number(p.home_latitude) : null;
          let lon =
            p.home_longitude != null ? Number(p.home_longitude) : null;

          if (
            !city &&
            !state &&
            (!Number.isFinite(lat) || !Number.isFinite(lon))
          ) {
            continue;
          }

          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            lat = null;
            lon = null;
          }

          const full = buildHometownFull(city, state, country);
          const pos = p.position != null ? String(p.position).trim() : null;
          const teamAbbr = (p.team || abbr || "").trim() || abbr;

          await conn.query(
            `INSERT INTO PlayerHometowns (
              cfbd_player_id, player_name, team, team_school, conference, season_year, position,
              hometown_city, hometown_state, hometown_full, latitude, longitude, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cfbd_roster', NOW(3))
            ON DUPLICATE KEY UPDATE
              player_name = VALUES(player_name),
              team_school = VALUES(team_school),
              conference = VALUES(conference),
              position = VALUES(position),
              hometown_city = VALUES(hometown_city),
              hometown_state = VALUES(hometown_state),
              hometown_full = VALUES(hometown_full),
              latitude = COALESCE(VALUES(latitude), latitude),
              longitude = COALESCE(VALUES(longitude), longitude),
              updated_at = NOW(3)`,
            [
              Number(pid),
              playerName(p),
              teamAbbr,
              t.school || null,
              t.conference || null,
              year,
              pos,
              city || null,
              state || null,
              full,
              lat,
              lon,
            ]
          );
          upserted += 1;
        }
      } catch (e) {
        console.error("recruit-map-sync team", abbr, e);
        errors.push({ team: abbr, message: e.message || String(e) });
      }
    }

    const nextOffset = singleTeam ? null : offset + teamRows.length;
    const done = singleTeam ? true : nextOffset >= totalFbs;

    return json(200, {
      year,
      teamsProcessed: teamRows.length,
      rowsTouched: upserted,
      nextOffset: done ? null : nextOffset,
      done,
      totalFbsTeams: totalFbs,
      errors: errors.length ? errors : undefined,
      source: "cfbd_roster",
    });
  } catch (err) {
    console.error("admin-recruit-map-sync:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "PlayerHometowns table missing",
        hint: "Run Client/sql/player_hometowns.sql",
      });
    }
    return json(500, { error: err.message || "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};
