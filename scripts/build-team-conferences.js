#!/usr/bin/env node
/**
 * Build Frontend/data/team-conferences.json from teams.html fallback list.
 * Run: node scripts/build-team-conferences.js
 */
const fs = require("fs");
const path = require("path");

const CLIENT_ROOT = path.resolve(__dirname, "..");
const TEAMS_HTML = path.join(CLIENT_ROOT, "Frontend", "teams.html");
const OUT_PATH = path.join(CLIENT_ROOT, "Frontend", "data", "team-conferences.json");

function parseTeamName(teamName) {
  if (teamName.includes("Texas A&M")) return "Texas A&M";
  if (teamName.includes("Miami (OH)")) return "Miami (OH)";
  if (teamName.includes("NC State")) return "NC State";
  if (teamName.includes("App State")) return "App State";
  if (teamName.startsWith("Ole Miss")) return "Ole Miss";
  if (teamName.startsWith("Louisiana Ragin")) return "Louisiana";
  if (teamName.startsWith("Southern Miss")) return "Southern Miss";
  if (teamName.startsWith("UL Monroe")) return "UL Monroe";
  if (teamName.startsWith("Sam Houston")) return "Sam Houston";
  if (teamName.startsWith("San José State") || teamName.startsWith("San Jose State")) {
    return "San José State";
  }
  if (teamName.startsWith("Hawai")) return "Hawai'i";
  const parts = teamName.split(" ");
  if (parts.length <= 1) return teamName;
  return parts.slice(0, -1).join(" ");
}

const html = fs.readFileSync(TEAMS_HTML, "utf8");
const m = html.match(/const fallbackTeams = \[([\s\S]*?)\];/);
if (!m) throw new Error("fallbackTeams not found in teams.html");

const fallbackTeams = eval("[" + m[1] + "]");
const map = {};

for (const t of fallbackTeams) {
  const school = parseTeamName(t.name);
  map[school] = t.conference;
}

const out = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  teams: map,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
console.error(`Wrote ${Object.keys(map).length} teams to ${path.relative(CLIENT_ROOT, OUT_PATH)}`);
