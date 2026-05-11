/**
 * POST /api/admin/recruit-map/geocode-missing
 * Body: { limit?: 10, delayMs?: 1200 }
 * Geocode rows with city/state but no lat/lng via Nominatim; cache in DB.
 * One invocation processes at most `limit` rows; callers should loop with delays, not huge batches.
 */
const { getPool } = require("./db");
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { geocodeCityState, parseRetryAfterSeconds } = require("./_nominatim");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const body = parseJsonBody(event) || {};
  const limit = Math.min(20, Math.max(1, parseInt(body.limit ?? 10, 10) || 10));
  const delayMs = Math.max(
    1100,
    Math.min(5000, parseInt(body.delayMs ?? 1200, 10) || 1200)
  );

  try {
    const pool = getPool();
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT id, hometown_city, hometown_state, hometown_country, hometown_full
         FROM PlayerHometowns
         WHERE (latitude IS NULL OR longitude IS NULL)
           AND (hometown_city IS NOT NULL AND TRIM(hometown_city) <> ''
                OR hometown_full IS NOT NULL AND TRIM(hometown_full) <> '')
         ORDER BY id ASC
         LIMIT ${limit}`,
        []
      );
      rows = r;
    } catch (e) {
      if (e.code === "ER_BAD_FIELD_ERROR" || e.code === "ER_NO_SUCH_COLUMN") {
        const [r] = await pool.query(
          `SELECT id, hometown_city, hometown_state, hometown_full
           FROM PlayerHometowns
           WHERE (latitude IS NULL OR longitude IS NULL)
             AND (hometown_city IS NOT NULL AND TRIM(hometown_city) <> ''
                  OR hometown_full IS NOT NULL AND TRIM(hometown_full) <> '')
           ORDER BY id ASC
           LIMIT ${limit}`,
          []
        );
        rows = r;
      } else {
        throw e;
      }
    }

    let updated = 0;
    let failed = 0;
    let idx = 0;

    for (const r of rows) {
      const wait = idx === 0 ? 0 : delayMs;
      idx += 1;

      const city = r.hometown_city;
      const state = r.hometown_state;
      const country =
        r.hometown_country != null && String(r.hometown_country).trim() !== ""
          ? String(r.hometown_country).trim()
          : "USA";

      let coords = null;
      try {
        if (city || state) {
          coords = await geocodeCityState(city, state, country, wait);
        }
      } catch (e) {
        if (e.code === "GEOCODER_RATE_LIMITED") {
          return json(429, {
            error: "GEOCODER_RATE_LIMITED",
            message:
              "OpenStreetMap geocoder rate limited this request. Wait a few minutes, then run Geocode Missing Hometowns again.",
            retryAfterSeconds: e.retryAfterSeconds,
            examined: idx,
            geocoded: updated,
            notFound: failed,
            stoppedOnRowId: r.id,
          });
        }
        throw e;
      }

      if (!coords && r.hometown_full) {
        await new Promise((res) => setTimeout(res, wait));
        const ua =
          process.env.NOMINATIM_USER_AGENT ||
          "CFB-RecruitMap/1.0 (cached geocoding)";
        const url =
          "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
          encodeURIComponent(String(r.hometown_full).trim());
        const res = await fetch(url, {
          headers: {
            "User-Agent": ua,
            "Accept-Language": "en",
          },
        });
        if (res.status === 429) {
          return json(429, {
            error: "GEOCODER_RATE_LIMITED",
            message:
              "OpenStreetMap geocoder rate limited this request. Wait a few minutes, then run Geocode Missing Hometowns again.",
            retryAfterSeconds: parseRetryAfterSeconds(
              res.headers.get("retry-after") || res.headers.get("Retry-After")
            ),
            examined: idx,
            geocoded: updated,
            notFound: failed,
            stoppedOnRowId: r.id,
          });
        }
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (Array.isArray(data) && data.length) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              coords = { lat, lon };
            }
          }
        }
      }

      if (coords) {
        await pool.query(
          "UPDATE PlayerHometowns SET latitude = ?, longitude = ?, updated_at = NOW(3) WHERE id = ?",
          [coords.lat, coords.lon, r.id]
        );
        updated += 1;
      } else {
        failed += 1;
      }
    }

    return json(200, {
      examined: rows.length,
      geocoded: updated,
      notFound: failed,
    });
  } catch (err) {
    console.error("admin-recruit-map-geocode-missing:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    if (err.code === "ER_NO_SUCH_TABLE") {
      return json(503, {
        error: "PlayerHometowns table missing",
        hint: "Run Client/sql/player_hometowns.sql",
      });
    }
    return json(500, {
      error: "Geocoding failed",
      message: err.message || "Internal server error",
    });
  }
};
