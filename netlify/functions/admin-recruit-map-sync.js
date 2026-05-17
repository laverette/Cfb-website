/**
 * LEGACY: JawsDB PlayerHometowns sync — not used by public recruitmap.html (static JSON).
 * POST /api/admin/recruit-map/sync
 * Body JSON: {
 *   year, classification?, team?, state?, position?, delayMs?,
 *   rowOffset? (default 0), rowLimit? (default 250, max 500)
 * }
 * Fetches full CFBD GET /recruiting/players, then upserts only recruits.slice(rowOffset, rowOffset + rowLimit).
 */
const { getPool, isMysqlConnectionLimitError } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");

const CFBD_BASE = "https://api.collegefootballdata.com";
const DEFAULT_RETRY_AFTER = 120;

const CLASSIFICATIONS = new Set(["HighSchool", "JUCO", "PrepSchool"]);

/** INSERT lists this many columns; VALUES must have the same number of expressions. */
const PLAYER_HOMETOWNS_UPSERT_COLUMN_COUNT = 23;
/** Number of `?` placeholders in the upsert (must equal bound array length). */
const PLAYER_HOMETOWNS_UPSERT_BIND_COUNT = 18;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
      "CFBD temporarily rate limited requests. Wait a few minutes and try again.",
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

function normalizeRecruitsPayload(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.players)) return body.players;
    if (Array.isArray(body.data)) return body.data;
  }
  return [];
}

function buildRecruitingPath(year, classification, team, state, position) {
  const q = new URLSearchParams();
  if (Number.isFinite(year)) q.set("year", String(year));
  if (classification) q.set("classification", classification);
  if (team) q.set("team", team);
  if (state) q.set("state", state);
  if (position) q.set("position", position);
  return `/recruiting/players?${q.toString()}`;
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
    return json(400, { error: "year is required (recruit class year, e.g. 2025)" });
  }

  let classification = str(body.classification) || "HighSchool";
  if (!CLASSIFICATIONS.has(classification)) classification = "HighSchool";

  const team = body.team != null ? str(body.team) : "";
  const state = body.state != null ? str(body.state) : "";
  const position = body.position != null ? str(body.position) : "";
  const delayMs = Math.min(3000, Math.max(0, parseInt(body.delayMs ?? 400, 10) || 400));

  let rowOffset = parseInt(body.rowOffset ?? 0, 10);
  if (!Number.isFinite(rowOffset) || rowOffset < 0) rowOffset = 0;
  let rowLimit = parseInt(body.rowLimit ?? 250, 10);
  if (!Number.isFinite(rowLimit) || rowLimit < 1) rowLimit = 250;
  rowLimit = Math.min(500, rowLimit);

  const requestPath = buildRecruitingPath(year, classification, team, state, position);

  const stats = {
    recruitsSeen: 0,
    rowsTouched: 0,
    skippedNoRecruitId: 0,
    skippedNoName: 0,
    skippedNoHometownAndNoCoords: 0,
    insertedWithHometownOnly: 0,
    withHometownInfoCoords: 0,
    withCityState: 0,
    withCommittedTo: 0,
    withStars: 0,
    sampleSkippedReason: null,
  };

  function noteSkip(reason) {
    if (!stats.sampleSkippedReason) stats.sampleSkippedReason = reason;
  }

  try {
    let recruits;
    try {
      const raw = await cfbdFetch(requestPath, apiKey);
      recruits = normalizeRecruitsPayload(raw);
    } catch (e) {
      if (e.code === "CFBD_RATE_LIMITED") {
        return json(429, {
          ...cfbdRateLimitedPayload(e.retryAfterSeconds),
          year,
          classification,
          requestPath,
          rowOffset,
          rowLimit,
          processedThisBatch: 0,
          nextRowOffset: null,
          done: false,
          ...stats,
        });
      }
      throw e;
    }

    const recruitsTotal = recruits.length;
    stats.recruitsSeen = recruitsTotal;
    console.error("[recruit-map-sync] recruiting/players", {
      requestPath,
      recruitsSeen: recruitsTotal,
      rowOffset,
      rowLimit,
    });

    if (!recruitsTotal) {
      return json(200, {
        year,
        classification,
        requestPath,
        rowOffset,
        rowLimit,
        processedThisBatch: 0,
        rowsTouched: 0,
        nextRowOffset: null,
        done: true,
        message: "CFBD returned zero recruits for this query.",
        insertedWithNullCoordinates: 0,
        ...stats,
      });
    }

    if (rowOffset >= recruitsTotal) {
      return json(200, {
        year,
        classification,
        team: team || undefined,
        state: state || undefined,
        position: position || undefined,
        requestPath,
        recruitsSeen: recruitsTotal,
        rowOffset,
        rowLimit,
        processedThisBatch: 0,
        rowsTouched: 0,
        nextRowOffset: null,
        done: true,
        insertedWithNullCoordinates: 0,
        ...stats,
      });
    }

    const batch = recruits.slice(rowOffset, rowOffset + rowLimit);
    const processedThisBatch = batch.length;
    const nextRowOffset = rowOffset + processedThisBatch;
    const done = nextRowOffset >= recruitsTotal;

    if (delayMs > 0) await sleep(delayMs);

    const pool = getPool();
    let loggedFirstUpsert = false;

    for (const r of batch) {
      const ridRaw = r.id ?? r.recruitId;
      const aid = str(r.athleteId ?? r.athlete_id);
      let cfbdRecruitId = ridRaw != null && ridRaw !== "" ? str(ridRaw) : "";
      if (!cfbdRecruitId && aid) cfbdRecruitId = `ath:${aid}`;
      if (!cfbdRecruitId) {
        stats.skippedNoRecruitId += 1;
        noteSkip("no_recruit_id");
        continue;
      }

      const name = str(r.name);
      if (!name) {
        stats.skippedNoName += 1;
        noteSkip("no_name");
        continue;
      }

      const recruitYear = parseInt(r.year, 10);
      const seasonYear = Number.isFinite(recruitYear) ? recruitYear : year;

      const committedTo = str(r.committedTo ?? r.committed_to) || null;
      const school = str(r.school) || null;
      const displayTeam = committedTo || school || null;

      const pos = str(r.position) || null;
      const recruitType = str(r.recruitType ?? r.recruit_type) || classification;

      const city = str(r.city);
      const st = str(r.stateProvince ?? r.state_province ?? r.state);
      const country = str(r.country);
      const hi = r.hometownInfo || r.hometown_info || {};
      let lat = hi.latitude != null ? Number(hi.latitude) : NaN;
      let lon = hi.longitude != null ? Number(hi.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = null;
        lon = null;
      } else {
        stats.withHometownInfoCoords += 1;
      }

      if (city || st) stats.withCityState += 1;
      if (committedTo) stats.withCommittedTo += 1;

      let hometownFull = buildHometownFull(city, st, country);
      if (!hometownFull && (city || st)) {
        hometownFull = [city, st].filter(Boolean).join(", ");
      }
      if (!hometownFull && country) hometownFull = country;

      const hasText = !!(city || st || hometownFull || country);
      const hasCoords = lat != null && lon != null;
      if (!hasText && !hasCoords) {
        stats.skippedNoHometownAndNoCoords += 1;
        noteSkip("no_hometown_and_no_coordinates");
        continue;
      }
      if (hasText && !hasCoords) stats.insertedWithHometownOnly += 1;

      const starsRaw = r.stars;
      let stars = starsRaw != null ? parseInt(String(starsRaw), 10) : null;
      if (!Number.isFinite(stars) || stars < 0) stars = null;
      else if (stars > 5) stars = 5;
      if (stars != null) stats.withStars += 1;

      let rating = r.rating != null ? Number(r.rating) : null;
      if (!Number.isFinite(rating)) rating = null;

      let ranking = r.ranking != null ? parseInt(String(r.ranking), 10) : null;
      if (!Number.isFinite(ranking)) ranking = null;

      const upsertValues = [
        cfbdRecruitId.slice(0, 64),
        aid || null,
        recruitType || null,
        name.slice(0, 255),
        committedTo,
        school,
        displayTeam,
        seasonYear,
        pos,
        city || null,
        st || null,
        country || null,
        hometownFull,
        lat,
        lon,
        stars,
        rating,
        ranking,
      ];

      if (upsertValues.length !== PLAYER_HOMETOWNS_UPSERT_BIND_COUNT) {
        throw new Error(
          `PlayerHometowns insert mismatch: expected ${PLAYER_HOMETOWNS_UPSERT_BIND_COUNT} bound values, got ${upsertValues.length}`
        );
      }

      if (!loggedFirstUpsert) {
        loggedFirstUpsert = true;
        const cityState = [city || null, st || null].filter(Boolean).join("/") || null;
        console.error("[recruit-map-sync] first upsert sample", {
          insertColumnCount: PLAYER_HOMETOWNS_UPSERT_COLUMN_COUNT,
          bindCount: upsertValues.length,
          recruitId: cfbdRecruitId.slice(0, 64),
          playerName: name.slice(0, 120),
          committedTo: committedTo || null,
          cityState,
          stars,
          hometownInfoHasLatLng: lat != null && lon != null,
        });
      }

      await pool.query(
        `INSERT INTO PlayerHometowns (
          cfbd_player_id, cfbd_recruit_id, athlete_id, recruit_type,
          player_name, committed_to, school, team, team_school, conference, season_year, \`position\`,
          hometown_city, hometown_state, hometown_country, hometown_full,
          latitude, longitude, stars, rating, ranking, source, updated_at
        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cfbd_recruiting_players', NOW(3))
        ON DUPLICATE KEY UPDATE
          athlete_id = VALUES(athlete_id),
          recruit_type = VALUES(recruit_type),
          player_name = VALUES(player_name),
          committed_to = VALUES(committed_to),
          school = VALUES(school),
          team = VALUES(team),
          team_school = VALUES(team_school),
          conference = VALUES(conference),
          season_year = VALUES(season_year),
          \`position\` = VALUES(\`position\`),
          hometown_city = VALUES(hometown_city),
          hometown_state = VALUES(hometown_state),
          hometown_country = VALUES(hometown_country),
          hometown_full = VALUES(hometown_full),
          latitude = COALESCE(VALUES(latitude), latitude),
          longitude = COALESCE(VALUES(longitude), longitude),
          stars = VALUES(stars),
          rating = VALUES(rating),
          ranking = VALUES(ranking),
          source = VALUES(source),
          updated_at = NOW(3)`,
        upsertValues
      );
      stats.rowsTouched += 1;
    }

    return json(200, {
      year,
      classification,
      team: team || undefined,
      state: state || undefined,
      position: position || undefined,
      requestPath,
      recruitsSeen: recruitsTotal,
      rowOffset,
      rowLimit,
      processedThisBatch,
      rowsTouched: stats.rowsTouched,
      nextRowOffset: done ? null : nextRowOffset,
      done,
      insertedWithNullCoordinates: stats.insertedWithHometownOnly,
      ...stats,
    });
  } catch (err) {
    console.error("admin-recruit-map-sync:", err);
    if (isMysqlConnectionLimitError(err)) {
      return json(503, {
        error: "DB_CONNECTION_LIMIT",
        message:
          "Database connection limit reached. Wait a few minutes and try again.",
      });
    }
    if (
      err.message &&
      String(err.message).includes("PlayerHometowns insert mismatch")
    ) {
      return json(500, {
        error: "Recruit sync insert mapping error: columns and values do not match.",
        details: err.message,
      });
    }
    if (err.errno === 1136 || err.code === "ER_WRONG_VALUE_COUNT_ON_ROW") {
      return json(500, {
        error: "Recruit sync insert mapping error: columns and values do not match.",
        details: err.message || "SQL column/value count mismatch",
      });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_BAD_FIELD_ERROR" || err.code === "ER_NO_SUCH_COLUMN") {
      return json(503, {
        error: "Database schema out of date",
        details:
          "Run Client/sql/player_hometowns_recruiting_migration.sql (or recreate from Client/sql/player_hometowns.sql).",
      });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "PlayerHometowns table missing",
        hint: "Run Client/sql/player_hometowns.sql",
      });
    }
    return json(500, { error: err.message || "Internal server error" });
  }
};
