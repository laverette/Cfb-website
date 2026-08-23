/**
 * LEGACY: JawsDB geocode for PlayerHometowns — not used by public recruitmap.html (static JSON).
 * POST /api/admin/recruit-map/geocode-missing
 * Body: { limit?: 10, delayMs?: 1200 }
 * Geocode rows with city/state but no lat/lng via Nominatim; cache in DB.
 * One invocation processes at most `limit` rows; callers should loop with delays, not huge batches.
 */
const { getSupabase, dbError, isMysqlConnectionLimitError } = require("./db");
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
    const supabase = getSupabase();
    const { data: missingRows, error: missingErr } = await supabase
      .from("player_hometowns")
      .select("id, hometown_city, hometown_state, hometown_country, hometown_full, latitude, longitude")
      .or("latitude.is.null,longitude.is.null")
      .order("id", { ascending: true })
      .limit(Math.max(limit * 4, 40));
    dbError(missingErr);

    const rows = (missingRows || [])
      .filter((r) => {
        const city = r.hometown_city != null && String(r.hometown_city).trim() !== "";
        const full = r.hometown_full != null && String(r.hometown_full).trim() !== "";
        return city || full;
      })
      .slice(0, limit);

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
        const { error: updateErr } = await supabase
          .from("player_hometowns")
          .update({
            latitude: coords.lat,
            longitude: coords.lon,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        dbError(updateErr);
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
    if (isMysqlConnectionLimitError(err)) {
      return json(503, {
        error: "DB_CONNECTION_LIMIT",
        message:
          "Database connection limit reached. Wait a few minutes and try again.",
      });
    }
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
