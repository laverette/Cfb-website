#!/usr/bin/env node
/**
 * Export CFBD recruiting players to static JSON for the public Recruit Map.
 * No MySQL/JawsDB — uses CFBD API only (local script; key never committed).
 *
 * Workflow:
 * 1. Set CFBD_API_KEY in Client/.env (local only).
 * 2. npm run export:recruits -- --year=2025 --classification=HighSchool
 * 3. Commit Frontend/data/recruits/*.json and manifest.json, then deploy.
 *
 * Public recruitmap.html loads /data/recruits/*.json only.
 */
const fs = require("fs");
const path = require("path");

const CFBD_BASE = "https://api.collegefootballdata.com";
const CLIENT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(CLIENT_ROOT, "Frontend", "data", "recruits");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

const CLASSIFICATIONS = new Set(["HighSchool", "JUCO", "PrepSchool"]);

function loadEnvFile(envPath) {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    /* optional .env */
  }
}

function parseArgs(argv) {
  const out = {
    year: null,
    classification: "HighSchool",
    team: "",
    state: "",
    position: "",
  };
  for (const arg of argv) {
    const ym = arg.match(/^--year=(\d+)$/);
    if (ym) out.year = parseInt(ym[1], 10);
    const cm = arg.match(/^--classification=(.+)$/);
    if (cm) out.classification = cm[1].trim();
    const tm = arg.match(/^--team=(.*)$/);
    if (tm) out.team = tm[1].trim();
    const sm = arg.match(/^--state=(.*)$/);
    if (sm) out.state = sm[1].trim();
    const pm = arg.match(/^--position=(.*)$/);
    if (pm) out.position = pm[1].trim();
  }
  return out;
}

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

function safeNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeInt(v) {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
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

function normalizeRecruitsPayload(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.players)) return body.players;
    if (Array.isArray(body.data)) return body.data;
  }
  return [];
}

function buildHometown(city, state, country) {
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

function cfbdToRecruit(r, defaultClassification, defaultYear) {
  const ridRaw = r.id ?? r.recruitId;
  const aid = str(r.athleteId ?? r.athlete_id);
  let id = ridRaw != null && ridRaw !== "" ? str(ridRaw) : "";
  if (!id && aid) id = `ath:${aid}`;
  if (!id) return null;

  const name = str(r.name);
  if (!name) return null;

  const recruitYear = parseInt(r.year, 10);
  const year = Number.isFinite(recruitYear) ? recruitYear : defaultYear;

  const city = str(r.city);
  const st = str(r.stateProvince ?? r.state_province ?? r.state);
  const country = str(r.country) || null;

  const hi = r.hometownInfo || r.hometown_info || {};
  let lat = hi.latitude != null ? Number(hi.latitude) : NaN;
  let lon = hi.longitude != null ? Number(hi.longitude) : NaN;
  if (!Number.isFinite(lat)) lat = null;
  if (!Number.isFinite(lon)) lon = null;

  let hometown = buildHometown(city, st, country);
  if (!hometown && (city || st)) hometown = [city, st].filter(Boolean).join(", ");
  if (!hometown && country) hometown = country;

  const committedTo = str(r.committedTo ?? r.committed_to) || null;
  const school = str(r.school) || null;
  const displayTeam = committedTo || school || null;

  let stars = r.stars != null ? safeInt(r.stars) : null;
  if (stars != null && stars > 5) stars = 5;
  if (stars != null && stars < 0) stars = null;

  let rating = r.rating != null ? Number(r.rating) : null;
  if (!Number.isFinite(rating)) rating = null;

  let ranking = r.ranking != null ? safeInt(r.ranking) : null;

  let height = r.height != null ? safeInt(r.height) : null;
  let weight = r.weight != null ? safeInt(r.weight) : null;

  return {
    id,
    athleteId: aid || null,
    recruitType: str(r.recruitType ?? r.recruit_type) || defaultClassification,
    year,
    ranking,
    name,
    school,
    committedTo,
    team: displayTeam,
    conference: r.conference != null ? str(r.conference) || null : null,
    position: str(r.position) || null,
    height,
    weight,
    stars,
    rating,
    city: city || null,
    stateProvince: st || null,
    country,
    hometown,
    latitude: lat,
    longitude: lon,
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
    const err = new Error("CFBD rate limited (429). Wait and retry.");
    err.code = "CFBD_RATE_LIMITED";
    throw err;
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`CFBD ${res.status}: ${t.slice(0, 200)}`);
  }

  return res.json();
}

function datasetFileName(year, classification) {
  return `${year}-${classification}.json`;
}

function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.datasets)) return data;
  } catch {
    /* new manifest */
  }
  return { datasets: [] };
}

function upsertManifestEntry(manifest, entry) {
  const key = `${entry.year}:${entry.classification}`;
  const idx = manifest.datasets.findIndex(
    (d) => `${d.year}:${d.classification}` === key
  );
  if (idx >= 0) manifest.datasets[idx] = entry;
  else manifest.datasets.push(entry);
  manifest.datasets.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return String(a.classification).localeCompare(String(b.classification));
  });
}

async function main() {
  loadEnvFile(path.join(CLIENT_ROOT, ".env"));

  const args = parseArgs(process.argv.slice(2));
  const { year, team, state, position } = args;
  let { classification } = args;

  if (!Number.isFinite(year) || year < 2009 || year > 2100) {
    console.error(
      "Usage: node scripts/export-recruit-map-data.js --year=2025 [--classification=HighSchool] [--team=] [--state=] [--position=]"
    );
    process.exit(1);
  }

  if (!CLASSIFICATIONS.has(classification)) {
    console.warn(`Unknown classification "${classification}", using HighSchool`);
    classification = "HighSchool";
  }

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    console.error("CFBD_API_KEY is not set. Add it to Client/.env for local export.");
    process.exit(1);
  }

  const requestPath = buildRecruitingPath(year, classification, team, state, position);
  console.error("Fetching", requestPath);

  const raw = await cfbdFetch(requestPath, apiKey.trim());
  const rows = normalizeRecruitsPayload(raw);

  const recruits = [];
  let skippedNoId = 0;
  let skippedNoName = 0;

  for (const r of rows) {
    const rec = cfbdToRecruit(r, classification, year);
    if (!rec) {
      const name = str(r.name);
      const rid = r.id ?? r.recruitId;
      if (rid == null || rid === "") skippedNoId += 1;
      else if (!name) skippedNoName += 1;
      continue;
    }
    recruits.push(rec);
  }

  recruits.sort((a, b) => a.name.localeCompare(b.name));

  const withCoordinates = recruits.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
  ).length;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const fileName = datasetFileName(year, classification);
  const outPath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(outPath, JSON.stringify(recruits, null, 0), "utf8");

  const manifest = readManifest();
  const today = new Date().toISOString().slice(0, 10);
  upsertManifestEntry(manifest, {
    year,
    classification,
    file: fileName,
    count: recruits.length,
    withCoordinates,
    lastUpdated: today,
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.error(`CFBD returned ${rows.length} raw recruits`);
  if (skippedNoId) console.error(`  skipped (no id): ${skippedNoId}`);
  if (skippedNoName) console.error(`  skipped (no name): ${skippedNoName}`);
  console.error(`Wrote ${recruits.length} recruits to ${path.relative(CLIENT_ROOT, outPath)}`);
  console.error(`  ${withCoordinates} with hometownInfo coordinates`);
  console.error(`Updated ${path.relative(CLIENT_ROOT, MANIFEST_PATH)}`);
}

main().catch((err) => {
  console.error("export-recruit-map-data failed:", err.message || err);
  process.exit(1);
});
