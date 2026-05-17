#!/usr/bin/env node
/**
 * Export PlayerHometowns rows to static JSON for the public Recruit Map.
 *
 * Update workflow:
 * 1. Use admin Recruit Map sync (and geocode) to populate PlayerHometowns in JawsDB.
 * 2. Run: node scripts/export-recruit-map-data.js --year=2025 --classification=HighSchool
 *    (from Client/, or: npm run export:recruits -- --year=2025 --classification=HighSchool)
 * 3. Commit Frontend/data/recruits/*.json and manifest.json, then deploy.
 *
 * Public recruitmap.html reads these files only — no MySQL on page load.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const CLIENT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(CLIENT_ROOT, "Frontend", "data", "recruits");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

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
  const out = { year: null, classification: "HighSchool" };
  for (const arg of argv) {
    const ym = arg.match(/^--year=(\d+)$/);
    if (ym) out.year = parseInt(ym[1], 10);
    const cm = arg.match(/^--classification=(.+)$/);
    if (cm) out.classification = cm[1].trim();
  }
  return out;
}

function getMysqlUrl() {
  return (
    process.env.MYSQL_URL ||
    process.env.JAWSDB_URL ||
    process.env.CLEARDB_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

function safeNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildHometown(row) {
  if (row.hometown_full && String(row.hometown_full).trim()) {
    return String(row.hometown_full).trim();
  }
  const parts = [];
  if (row.hometown_city) parts.push(String(row.hometown_city).trim());
  if (row.hometown_state) parts.push(String(row.hometown_state).trim());
  if (parts.length) return parts.join(", ");
  if (row.hometown_country) return String(row.hometown_country).trim();
  return null;
}

function rowToRecruit(row, defaultClassification) {
  let lat = safeNum(row.latitude);
  let lon = safeNum(row.longitude);
  const city = row.hometown_city != null ? String(row.hometown_city).trim() : null;
  const st = row.hometown_state != null ? String(row.hometown_state).trim() : null;
  const country = row.hometown_country != null ? String(row.hometown_country).trim() : null;

  return {
    id: String(row.cfbd_recruit_id || row.id),
    athleteId: row.athlete_id != null ? String(row.athlete_id) : null,
    recruitType: row.recruit_type != null ? String(row.recruit_type) : defaultClassification,
    year: safeNum(row.season_year),
    ranking: row.ranking != null ? safeNum(row.ranking) : null,
    name: row.player_name != null ? String(row.player_name) : "",
    school: row.school != null ? String(row.school) : null,
    committedTo: row.committed_to != null ? String(row.committed_to) : null,
    team:
      (row.team && String(row.team).trim()) ||
      (row.committed_to && String(row.committed_to).trim()) ||
      (row.school && String(row.school).trim()) ||
      null,
    conference: row.conference != null ? String(row.conference) : null,
    position: row.position != null ? String(row.position) : null,
    height: null,
    weight: null,
    stars: row.stars != null ? safeNum(row.stars) : null,
    rating: row.rating != null ? safeNum(row.rating) : null,
    city: city || null,
    stateProvince: st || null,
    country: country || null,
    hometown: buildHometown(row),
    latitude: lat,
    longitude: lon,
  };
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

  const { year, classification } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    console.error("Usage: node scripts/export-recruit-map-data.js --year=2025 [--classification=HighSchool]");
    process.exit(1);
  }

  const url = getMysqlUrl();
  if (!url) {
    console.error("MYSQL_URL (or JAWSDB_URL) is not set. Add it to Client/.env for local export.");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: 1,
  });

  let rows;
  try {
    const [r] = await pool.query(
      `SELECT cfbd_recruit_id, athlete_id, recruit_type, season_year, ranking,
              player_name, school, committed_to, team, conference, \`position\`,
              hometown_city, hometown_state, hometown_country, hometown_full,
              latitude, longitude, stars, rating
       FROM PlayerHometowns
       WHERE season_year = ? AND recruit_type = ?
       ORDER BY player_name ASC`,
      [year, classification]
    );
    rows = r;
  } finally {
    await pool.end();
  }

  const recruits = (rows || []).map((row) => rowToRecruit(row, classification));
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
    lastUpdated: today,
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const withCoords = recruits.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
  ).length;

  console.error(`Wrote ${recruits.length} recruits to ${path.relative(CLIENT_ROOT, outPath)}`);
  console.error(`  ${withCoords} with coordinates (map markers)`);
  console.error(`Updated ${path.relative(CLIENT_ROOT, MANIFEST_PATH)}`);
}

main().catch((err) => {
  console.error("export-recruit-map-data failed:", err.message || err);
  process.exit(1);
});
