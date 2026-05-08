/**
 * Server-side geocoding via Nominatim (OSM). Respect rate limits; cache in DB.
 * No API key. Set NOMINATIM_USER_AGENT in Netlify env (recommended).
 */
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

/**
 * @returns {{ lat: number, lon: number } | null}
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

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || !data.length) return null;
  const hit = data[0];
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

module.exports = { geocodeCityState, sleep };
