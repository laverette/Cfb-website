/**
 * LEGACY: Admin CFBD debug — not used by public recruitmap.html (static JSON).
 * GET /api/admin/recruit-map/debug-recruits?year=2025&classification=HighSchool&team=&state=&position=
 * Admin-only: summarizes CFBD /recruiting/players without persisting. No API key in response.
 */
const { json } = require("./_http");
const { requireAdmin } = require("./_auth");

const CFBD_BASE = "https://api.collegefootballdata.com";
const CLASSIFICATIONS = new Set(["HighSchool", "JUCO", "PrepSchool"]);

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

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
    const err = new Error(`CFBD ${res.status}`);
    err.status = res.status;
    err.body = t.slice(0, 300);
    throw err;
  }
  return res.json();
}

function normalizeRecruitsPayload(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.players)) return body.players;
    if (Array.isArray(body.data)) return body.data;
  }
  return [];
}

function buildPath(year, classification, team, state, position) {
  const q = new URLSearchParams();
  if (Number.isFinite(year)) q.set("year", String(year));
  if (classification) q.set("classification", classification);
  if (team) q.set("team", team);
  if (state) q.set("state", state);
  if (position) q.set("position", position);
  return `/recruiting/players?${q.toString()}`;
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) {
    return json(500, { error: "CFBD API not configured" });
  }

  const qs = event.queryStringParameters || {};
  const year = parseInt(qs.year ?? "", 10);
  if (!Number.isFinite(year) || year < 2009 || year > 2100) {
    return json(400, { error: "year query parameter required (e.g. 2025)" });
  }

  let classification = str(qs.classification) || "HighSchool";
  if (!CLASSIFICATIONS.has(classification)) classification = "HighSchool";
  const team = qs.team != null ? str(qs.team) : "";
  const state = qs.state != null ? str(qs.state) : "";
  const position = qs.position != null ? str(qs.position) : "";

  const requestPath = buildPath(year, classification, team, state, position);

  try {
    const raw = await cfbdFetch(requestPath, apiKey);
    const recruits = normalizeRecruitsPayload(raw);
    const sample = recruits[0] || null;
    const sampleKeys = sample && typeof sample === "object" ? Object.keys(sample) : [];

    let withHometownInfo = 0;
    let withCityState = 0;
    let withCommittedTo = 0;
    let withStars = 0;

    for (const r of recruits) {
      const hi = r.hometownInfo || r.hometown_info || {};
      const lat = hi.latitude != null ? Number(hi.latitude) : NaN;
      const lon = hi.longitude != null ? Number(hi.longitude) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lon)) withHometownInfo += 1;
      const city = str(r.city);
      const st = str(r.stateProvince ?? r.state_province ?? r.state);
      if (city || st) withCityState += 1;
      if (str(r.committedTo ?? r.committed_to)) withCommittedTo += 1;
      const stv = r.stars;
      if (stv != null && String(stv).trim() !== "") withStars += 1;
    }

    return json(200, {
      requestPath,
      count: recruits.length,
      sampleKeys,
      samplePlayer: sample,
      withHometownInfo,
      withCityState,
      withCommittedTo,
      withStars,
    });
  } catch (err) {
    console.error("admin-recruit-map-debug-recruits:", err);
    return json(500, {
      error: "debug_recruits_failed",
      details: err.message || String(err),
      cfbdStatus: err.status,
      cfbdBodySnippet: err.body,
    });
  }
};
