/**
 * Server-side geocoding via Nominatim (OSM). Respect rate limits; cache in DB.
 * No API key. Set NOMINATIM_USER_AGENT in Netlify env (recommended).
 */
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function parseRetryAfterSeconds(headerVal) {
  if (headerVal == null || headerVal === "") return 120;
  const s = String(headerVal).trim();
  const asInt = parseInt(s, 10);
  if (Number.isFinite(asInt) && asInt > 0) return Math.min(asInt, 86400);
  return 120;
}

/**
 * @returns {{ lat: number, lon: number } | null}
 * @throws {Error} code GEOCODER_RATE_LIMITED on HTTP 429
 */
async function geocodeCityState(city, state, country, delayBeforeMs) {
  if (delayBeforeMs > 0) await sleep(delayBeforeMs);
  const c = (city || "").trim();
  const s = (state || "").trim();
  const co = (country || "USA").trim() || "USA";
  if (!c && !s) return null;

  const q = [c, s, co].filter(Boolean).join(", ");
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(q);

  const ua =
    process.env.NOMINATIM_USER_AGENT ||
    "CFB-RecruitMap/1.0 (cached geocoding; college football fan site)";

  const res = await fetch(url, {
    headers: {
      "User-Agent": ua,
      "Accept-Language": "en",
    },
  });

  if (res.status === 429) {
    const err = new Error("GEOCODER_RATE_LIMITED");
    err.code = "GEOCODER_RATE_LIMITED";
    err.retryAfterSeconds = parseRetryAfterSeconds(
      res.headers.get("retry-after") || res.headers.get("Retry-After")
    );
    throw err;
  }

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || !data.length) return null;
  const hit = data[0];
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

module.exports = { geocodeCityState, sleep, parseRetryAfterSeconds };
