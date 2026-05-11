/**
 * POST /api/admin/recruit-map/sync
 * Body JSON: { year, team?, offset?, limit?, delayMs? }
 * Pulls CFBD /teams + /roster per FBS team batch; upserts PlayerHometowns.
 * Batched for Netlify time limits — call repeatedly with nextOffset until done.
 * Rate limits: configurable delay between roster calls; 429 returns CFBD_RATE_LIMITED (no blind retry).
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

const CFBD_BASE = "https://api.collegefootballdata.com";
const DEFAULT_RETRY_AFTER = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry-After may be seconds (integer) or an HTTP-date; prefer integer seconds. */
function parseRetryAfterSeconds(headerVal) {
  if (headerVal == null || headerVal === "") return DEFAULT_RETRY_AFTER;
  const s = String(headerVal).trim();
  const asInt = parseInt(s, 10);
  if (Number.isFinite(asInt) && asInt > 0) return Math.min(asInt, 86400);
  return DEFAULT_RETRY_AFTER;
}

function cfbdRateLimitedPayload(retryAfterSeconds) {
  return {
    error: "CFBD_RATE_LIMITED",
    message:
      "CFBD temporarily rate limited requests. Wait a few minutes and resume from this offset.",
    retryAfterSeconds,
  };
}

async function cfbdFetch(path, apiKey) {
  const url = path.startsWith("http") ? path : `${CFBD_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (res.status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(
      res.headers.get("retry-after") || res.headers.get("Retry-After")
    );
    const err = new Error("CFBD_RATE_LIMITED");
    err.code = "CFBD_RATE_LIMITED";
    err.status = 429;
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }

  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`CFBD ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

function pickCfbdPlayerId(p) {
  const candidates = [
    p.id,
    p.player_id,
    p.playerId,
    p.athlete_id,
    p.athleteId,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      return Math.floor(c);
    }
    const s = String(c).trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n > 0 && n <= 2147483647) return n;
    }
  }
  return null;
}

function pickLatLon(p) {
  const latRaw =
    p.home_latitude ??
    p.homeLatitude ??
    p.latitude ??
    p.lat ??
    p.birth_latitude ??
    p.birthLatitude;
  const lonRaw =
    p.home_longitude ??
    p.homeLongitude ??
    p.longitude ??
    p.lon ??
    p.lng ??
    p.birth_longitude ??
    p.birthLongitude;
  let lat = latRaw != null ? Number(latRaw) : NaN;
  let lon = lonRaw != null ? Number(lonRaw) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat: null, lon: null };
  }
  return { lat, lon };
}

function pickHometownStrings(p) {
  let city = str(p.home_city ?? p.homeCity ?? p.birth_city ?? p.birthCity);
  let state = str(p.home_state ?? p.homeState ?? p.birth_state ?? p.birthState);
  const country = str(
    p.home_country ?? p.homeCountry ?? p.birth_country ?? p.birthCountry
  );
  const oneLine = str(
    p.hometown ?? p.homeTown ?? p.home_town ?? p.birth_place ?? p.birthPlace
  );
  if (!city && !state && oneLine) {
    return { city: "", state: "", country, hometownLine: oneLine };
  }
  return { city, state, country, hometownLine: "" };
}

function playerName(p, cfbdId) {
  const a = str(p.first_name ?? p.firstName);
  const b = str(p.last_name ?? p.lastName);
  const n = `${a} ${b}`.trim();
  if (n) return n;
  if (cfbdId != null) return `Player ${cfbdId}`;
  return "";
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

function rosterFieldSample(p) {
  if (!p || typeof p !== "object") return [];
  return Object.keys(p).filter((k) =>
    /home|birth|town|city|state|country|lat|lon|lng|hometown|place/i.test(k)
  );
}

function normalizeRosterArray(roster) {
  if (Array.isArray(roster)) return roster;
  if (roster && typeof roster === "object") {
    if (Array.isArray(roster.players)) return roster.players;
    if (Array.isArray(roster.roster)) return roster.roster;
    if (Array.isArray(roster.data)) return roster.data;
  }
  return [];
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
  const limit = Math.min(25, Math.max(1, parseInt(body.limit ?? 5, 10) || 5));
  const delayMsRaw = parseInt(body.delayMs ?? 1200, 10) || 1200;
  const delayMs = Math.min(1500, Math.max(750, delayMsRaw));

  let batchStats = {
    teamsProcessedThisBatch: 0,
    rowsTouched: 0,
    /** Skipped: no hometown text and no coordinates */
    skippedNoHometown: 0,
    /** Inserted this batch with hometown text but null coordinates (geocode later) */
    skippedNoCoordinates: 0,
    rosterPlayersSeen: 0,
    teamsWithZeroRoster: 0,
    skippedNoPlayerId: 0,
    skippedNoTeam: 0,
    skippedNoName: 0,
    sampleSkippedReason: null,
  };

  function noteSkip(reason) {
    if (!batchStats.sampleSkippedReason) batchStats.sampleSkippedReason = reason;
  }

  let conn;
  try {
    const pool = getPool();
    conn = await pool.getConnection();

    let allTeams;
    try {
      const allTeamsRaw = await cfbdFetch(`/teams?year=${year}`, apiKey);
      allTeams = Array.isArray(allTeamsRaw) ? allTeamsRaw : [];
    } catch (e) {
      if (e.code === "CFBD_RATE_LIMITED") {
        return json(429, {
          ...cfbdRateLimitedPayload(e.retryAfterSeconds),
          year,
          currentOffset: offset,
          teamsProcessedThisBatch: 0,
          rowsTouched: 0,
          nextOffset: offset,
          nextOffsetToResume: offset,
          done: false,
          totalFbsTeams: null,
          ...batchStats,
        });
      }
      throw e;
    }

    await sleep(delayMs);

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
    let teamsCompletedInBatch = 0;

    for (let i = 0; i < teamRows.length; i++) {
      const t = teamRows[i];
      const abbr = t.abbreviation;
      if (!abbr) {
        teamsCompletedInBatch += 1;
        continue;
      }
      if (i > 0) await sleep(delayMs);
      try {
        const roster = await cfbdFetch(
          `/roster?team=${encodeURIComponent(abbr)}&year=${year}`,
          apiKey
        );
        const players = normalizeRosterArray(roster);
        if (!Array.isArray(roster) && roster && typeof roster === "object") {
          console.error("[recruit-map-sync] roster payload was not a top-level array; keys:", Object.keys(roster));
        }
        const schoolName = t.school || abbr;

        let rosterLen = players.length;
        let hometownFieldCount = 0;
        let coordCount = 0;
        let insertedThisTeam = 0;
        let skippedThisTeam = 0;
        let sampleKeysLogged = false;

        if (rosterLen === 0) {
          batchStats.teamsWithZeroRoster += 1;
        }

        for (const p of players) {
          batchStats.rosterPlayersSeen += 1;

          const cfbdId = pickCfbdPlayerId(p);
          if (cfbdId == null) {
            batchStats.skippedNoPlayerId += 1;
            skippedThisTeam += 1;
            noteSkip("no_numeric_player_id");
            if (!sampleKeysLogged && players.length) {
              sampleKeysLogged = true;
              console.error(
                "[recruit-map-sync] sample player keys (no id)",
                rosterFieldSample(p),
                "id_raw",
                p && (p.id ?? p.playerId ?? p.athleteId)
              );
            }
            continue;
          }

          const { city, state, country, hometownLine } = pickHometownStrings(p);
          const { lat: latRaw, lon: lonRaw } = pickLatLon(p);
          const hasCoords =
            latRaw != null &&
            lonRaw != null &&
            Number.isFinite(latRaw) &&
            Number.isFinite(lonRaw);
          if (city || state || hometownLine) hometownFieldCount += 1;
          if (hasCoords) coordCount += 1;

          const fullFromParts = buildHometownFull(city, state, country);
          const full =
            fullFromParts ||
            (hometownLine ? hometownLine : null);

          const hasHometownText = !!(city || state || full);
          if (!hasHometownText && !hasCoords) {
            batchStats.skippedNoHometown += 1;
            skippedThisTeam += 1;
            noteSkip("no_hometown_text_and_no_coordinates");
            continue;
          }

          const pos = str(p.position ?? p.pos);
          const teamAbbr = str(p.team ?? p.team_id ?? p.teamId) || abbr;
          if (!teamAbbr) {
            batchStats.skippedNoTeam += 1;
            skippedThisTeam += 1;
            noteSkip("no_team_abbreviation");
            continue;
          }

          const name = playerName(p, cfbdId);
          if (!name) {
            batchStats.skippedNoName += 1;
            skippedThisTeam += 1;
            noteSkip("no_player_name");
            continue;
          }

          let lat = hasCoords ? latRaw : null;
          let lon = hasCoords ? lonRaw : null;

          await conn.query(
            `INSERT INTO PlayerHometowns (
              cfbd_player_id, player_name, team, team_school, conference, season_year, \`position\`,
              hometown_city, hometown_state, hometown_full, latitude, longitude, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cfbd_roster', NOW(3))
            ON DUPLICATE KEY UPDATE
              player_name = VALUES(player_name),
              team_school = VALUES(team_school),
              conference = VALUES(conference),
              \`position\` = VALUES(\`position\`),
              hometown_city = VALUES(hometown_city),
              hometown_state = VALUES(hometown_state),
              hometown_full = VALUES(hometown_full),
              latitude = COALESCE(VALUES(latitude), latitude),
              longitude = COALESCE(VALUES(longitude), longitude),
              updated_at = NOW(3)`,
            [
              cfbdId,
              name,
              teamAbbr,
              t.school || null,
              t.conference || null,
              year,
              pos || null,
              city || null,
              state || null,
              full,
              lat,
              lon,
            ]
          );
          upserted += 1;
          insertedThisTeam += 1;
          if (hasHometownText && !hasCoords) {
            batchStats.skippedNoCoordinates += 1;
          }
        }

        console.error("[recruit-map-sync] roster summary", {
          team: abbr,
          school: schoolName,
          rosterHttpOk: true,
          rosterLength: rosterLen,
          countWithHometownOrLine: hometownFieldCount,
          countWithCoordinates: coordCount,
          rowsUpserted: insertedThisTeam,
          rowsSkipped: skippedThisTeam,
        });

        teamsCompletedInBatch += 1;
      } catch (e) {
        if (e.code === "CFBD_RATE_LIMITED") {
          const nextOffsetToResume = offset + teamsCompletedInBatch;
          return json(429, {
            ...cfbdRateLimitedPayload(e.retryAfterSeconds),
            year,
            currentOffset: offset,
            teamsProcessedThisBatch: teamsCompletedInBatch,
            rowsTouched: upserted,
            nextOffset: nextOffsetToResume,
            nextOffsetToResume,
            done: false,
            totalFbsTeams: totalFbs,
            rosterPlayersSeen: batchStats.rosterPlayersSeen,
            skippedNoHometown: batchStats.skippedNoHometown,
            skippedNoCoordinates: batchStats.skippedNoCoordinates,
            teamsWithZeroRoster: batchStats.teamsWithZeroRoster,
            skippedNoPlayerId: batchStats.skippedNoPlayerId,
            skippedNoTeam: batchStats.skippedNoTeam,
            skippedNoName: batchStats.skippedNoName,
            sampleSkippedReason: batchStats.sampleSkippedReason,
          });
        }
        console.error("recruit-map-sync team", abbr, e);
        errors.push({ team: abbr, message: e.message || String(e) });
        teamsCompletedInBatch += 1;
      }
    }

    const nextOffset = singleTeam ? null : offset + teamRows.length;
    const done = singleTeam ? true : nextOffset >= totalFbs;

    batchStats.rowsTouched = upserted;
    batchStats.teamsProcessedThisBatch = teamRows.length;

    return json(200, {
      year,
      currentOffset: offset,
      teamsProcessedThisBatch: teamRows.length,
      rowsTouched: upserted,
      nextOffset: done ? null : nextOffset,
      nextOffsetToResume: done ? null : nextOffset,
      done,
      totalFbsTeams: totalFbs,
      errors: errors.length ? errors : undefined,
      source: "cfbd_roster",
      rosterPlayersSeen: batchStats.rosterPlayersSeen,
      skippedNoHometown: batchStats.skippedNoHometown,
      skippedNoCoordinates: batchStats.skippedNoCoordinates,
      teamsWithZeroRoster: batchStats.teamsWithZeroRoster,
      skippedNoPlayerId: batchStats.skippedNoPlayerId,
      skippedNoTeam: batchStats.skippedNoTeam,
      skippedNoName: batchStats.skippedNoName,
      sampleSkippedReason: batchStats.sampleSkippedReason,
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
