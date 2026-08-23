/**
 * LEGACY: player_hometowns sync — not used by public recruitmap.html (static JSON).
 * POST /api/admin/recruit-map/sync
 * Body JSON: {
 *   year, classification?, team?, state?, position?, delayMs?,
 *   rowOffset? (default 0), rowLimit? (default 250, max 500)
 * }
 * Fetches full CFBD GET /recruiting/players, then upserts only recruits.slice(rowOffset, rowOffset + rowLimit).
 */
const { getSupabase, dbError } = require("./db");
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

    const supabase = getSupabase();
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

      const { data: existing, error: existingErr } = await supabase
        .from("player_hometowns")
        .select("latitude, longitude")
        .eq("cfbd_recruit_id", upsertValues[0])
        .maybeSingle();
      dbError(existingErr);

      const nextLat =
        lat != null ? lat : existing && existing.latitude != null ? existing.latitude : null;
      const nextLon =
        lon != null ? lon : existing && existing.longitude != null ? existing.longitude : null;

      const { error: upsertErr } = await supabase.from("player_hometowns").upsert(
        {
          cfbd_player_id: null,
          cfbd_recruit_id: upsertValues[0],
          athlete_id: upsertValues[1],
          recruit_type: upsertValues[2],
          player_name: upsertValues[3],
          committed_to: upsertValues[4],
          school: upsertValues[5],
          team: upsertValues[6],
          team_school: null,
          conference: null,
          season_year: upsertValues[7],
          position: upsertValues[8],
          hometown_city: upsertValues[9],
          hometown_state: upsertValues[10],
          hometown_country: upsertValues[11],
          hometown_full: upsertValues[12],
          latitude: nextLat,
          longitude: nextLon,
          stars: upsertValues[15],
          rating: upsertValues[16],
          ranking: upsertValues[17],
          source: "cfbd_recruiting_players",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "cfbd_recruit_id" }
      );
      dbError(upsertErr);
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
    if (
      err.message &&
      String(err.message).includes("PlayerHometowns insert mismatch")
    ) {
      return json(500, {
        error: "Recruit sync insert mapping error: columns and values do not match.",
        details: err.message,
      });
    }
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: err.message || "Internal server error" });
  }
};
