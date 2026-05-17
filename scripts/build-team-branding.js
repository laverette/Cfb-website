#!/usr/bin/env node
/**
 * Build Frontend/data/team-branding.json from teams.html fallback (ESPN logos)
 * plus known FBS primary/secondary colors.
 * Run: node scripts/build-team-branding.js
 */
const fs = require("fs");
const path = require("path");

const CLIENT_ROOT = path.resolve(__dirname, "..");
const TEAMS_HTML = path.join(CLIENT_ROOT, "Frontend", "teams.html");
const OUT_PATH = path.join(CLIENT_ROOT, "Frontend", "data", "team-branding.json");

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

/** [school, primary, secondary, accent?] — FBS programs from teams.html */
const TEAM_COLORS = [
  ["Akron", "#041E42", "#A89968"],
  ["Alabama", "#9E1B32", "#FFFFFF", "#828A8F"],
  ["App State", "#222222", "#FFCC00"],
  ["Arizona State", "#8C1D40", "#FFC627"],
  ["Arizona", "#AB0520", "#0C234B"],
  ["Arkansas", "#9D2235", "#FFFFFF"],
  ["Arkansas State", "#CC092F", "#000000"],
  ["Army", "#000000", "#D4BF91"],
  ["Auburn", "#0C2340", "#E87722"],
  ["Ball State", "#BA0C2F", "#FFFFFF"],
  ["Baylor", "#154734", "#FFB81C"],
  ["Boise State", "#0033A0", "#FA4616"],
  ["Boston College", "#98002E", "#BC9B6A"],
  ["Bowling Green", "#4E3629", "#FE5000"],
  ["Buffalo", "#005BBB", "#FFFFFF"],
  ["BYU", "#002E5D", "#FFFFFF"],
  ["California", "#003262", "#FDB515"],
  ["Central Michigan", "#6A0032", "#FFC627"],
  ["Charlotte", "#046A38", "#B9975B"],
  ["Cincinnati", "#E00122", "#000000"],
  ["Clemson", "#F56600", "#522D80"],
  ["Coastal Carolina", "#007A53", "#000000"],
  ["Colorado", "#CFB87C", "#000000"],
  ["Colorado State", "#1E4D2B", "#C8C372"],
  ["Delaware", "#00539F", "#FFD200"],
  ["Duke", "#003087", "#FFFFFF"],
  ["East Carolina", "#592A8A", "#FDC82F"],
  ["Eastern Michigan", "#006633", "#FFFFFF"],
  ["Florida", "#0021A5", "#FA4616"],
  ["Florida Atlantic", "#003366", "#CC0000"],
  ["Florida International", "#081E3F", "#B6862C"],
  ["Florida State", "#782F40", "#CEB888"],
  ["Fresno State", "#DB0032", "#002E6D"],
  ["Georgia", "#BA0C2F", "#000000"],
  ["Georgia Southern", "#041E42", "#FFFFFF"],
  ["Georgia State", "#0039A6", "#FFFFFF"],
  ["Georgia Tech", "#B3A369", "#003057"],
  ["Hawai'i", "#024731", "#FFFFFF"],
  ["Houston", "#C8102E", "#FFFFFF"],
  ["Illinois", "#E84A27", "#13294B"],
  ["Indiana", "#990000", "#FFFFFF"],
  ["Iowa", "#000000", "#FFCD00"],
  ["Iowa State", "#C8102E", "#F1BE48"],
  ["Jacksonville State", "#CC0000", "#FFFFFF"],
  ["James Madison", "#450084", "#CBB677"],
  ["Kansas", "#0051BA", "#E8000D"],
  ["Kansas State", "#512888", "#FFFFFF"],
  ["Kent State", "#002664", "#EAAB00"],
  ["Kentucky", "#0033A0", "#FFFFFF"],
  ["Kennesaw State", "#FDBB30", "#000000"],
  ["Liberty", "#002D62", "#C41230"],
  ["Louisiana", "#CE181E", "#FFFFFF"],
  ["Louisiana Tech", "#003087", "#E41B38"],
  ["Louisville", "#AD0000", "#000000"],
  ["LSU", "#461D7C", "#FDD023"],
  ["Marshall", "#00B140", "#FFFFFF"],
  ["Maryland", "#E03A3E", "#FFD520"],
  ["Massachusetts", "#881C1C", "#FFFFFF"],
  ["Memphis", "#003087", "#898D8D"],
  ["Miami (OH)", "#B61E2E", "#FFFFFF"],
  ["Miami", "#F47321", "#005030"],
  ["Michigan State", "#18453B", "#FFFFFF"],
  ["Michigan", "#00274C", "#FFCB05"],
  ["Middle Tennessee", "#0066CC", "#FFFFFF"],
  ["Minnesota", "#7A0019", "#FFCC33"],
  ["Mississippi State", "#660000", "#FFFFFF"],
  ["Missouri State", "#5E0009", "#FFFFFF"],
  ["Missouri", "#F1B82D", "#000000"],
  ["NC State", "#CC0000", "#FFFFFF"],
  ["Navy", "#00205B", "#C5B783"],
  ["Nebraska", "#E41C38", "#FFFFFF"],
  ["Nevada", "#003366", "#807F84"],
  ["New Mexico", "#BA0C2F", "#A7A8AA"],
  ["New Mexico State", "#861F41", "#FFFFFF"],
  ["North Carolina", "#7BAFD4", "#FFFFFF"],
  ["North Texas", "#00853E", "#FFFFFF"],
  ["Northern Illinois", "#CC0000", "#000000"],
  ["Northwestern", "#4E2A84", "#FFFFFF"],
  ["Notre Dame", "#0C2340", "#C99700"],
  ["Ohio", "#154734", "#FFFFFF"],
  ["Ohio State", "#BB0000", "#666666"],
  ["Oklahoma", "#841617", "#FFFFFF"],
  ["Oklahoma State", "#FF7300", "#000000"],
  ["Old Dominion", "#003057", "#A1D0F5"],
  ["Ole Miss", "#CE1126", "#14213D"],
  ["Oregon", "#154733", "#FEE123"],
  ["Oregon State", "#DC4405", "#000000"],
  ["Penn State", "#041E42", "#FFFFFF"],
  ["Pittsburgh", "#003594", "#FFB81C"],
  ["Purdue", "#CEB888", "#000000"],
  ["Rice", "#00205B", "#C1C6C8"],
  ["Rutgers", "#CC0033", "#5F6A72"],
  ["Sam Houston", "#F78F1E", "#FFFFFF"],
  ["San Diego State", "#A6192E", "#000000"],
  ["San José State", "#0055A2", "#E5A823"],
  ["SMU", "#0033A0", "#C8102E"],
  ["South Alabama", "#00205B", "#BF0D3E"],
  ["South Carolina", "#73000A", "#000000"],
  ["South Florida", "#006747", "#CFC493"],
  ["Southern Miss", "#FFC72C", "#000000"],
  ["Stanford", "#8C1515", "#FFFFFF"],
  ["Syracuse", "#D44500", "#0E2841"],
  ["TCU", "#4D1979", "#FFFFFF"],
  ["Temple", "#9D2235", "#FFFFFF"],
  ["Tennessee", "#FF8200", "#FFFFFF"],
  ["Texas A&M", "#500000", "#FFFFFF"],
  ["Texas", "#BF5701", "#FFFFFF"],
  ["Texas State", "#501214", "#8D734A"],
  ["Texas Tech", "#CC0000", "#000000"],
  ["Toledo", "#15397F", "#FFDA00"],
  ["Troy", "#8B2332", "#FFFFFF"],
  ["Tulane", "#006747", "#FFFFFF"],
  ["Tulsa", "#002D72", "#C8B568"],
  ["UAB", "#006341", "#CC8A00"],
  ["UCF", "#000000", "#FFC904"],
  ["UCLA", "#2774AE", "#FFD100"],
  ["UConn", "#000E2F", "#FFFFFF"],
  ["UL Monroe", "#840029", "#FDB515"],
  ["UNLV", "#CF0A2C", "#C0C0C0"],
  ["USC", "#990000", "#FFC72C"],
  ["Utah State", "#00263A", "#FFFFFF"],
  ["Utah", "#CC0000", "#FFFFFF"],
  ["UTEP", "#FF8200", "#041E42"],
  ["UTSA", "#0C2340", "#F15A22"],
  ["Vanderbilt", "#866D4B", "#000000"],
  ["Virginia", "#232D4B", "#F84C1E"],
  ["Virginia Tech", "#630031", "#CF4420"],
  ["Wake Forest", "#9E7E38", "#000000"],
  ["Washington", "#4B2E83", "#B7A57A"],
  ["Washington State", "#981E32", "#5E6A71"],
  ["West Virginia", "#002855", "#EAAA00"],
  ["Western Kentucky", "#B01E24", "#FFFFFF"],
  ["Western Michigan", "#6C4023", "#B5A167"],
  ["Wisconsin", "#C5050C", "#FFFFFF"],
  ["Wyoming", "#492F24", "#FFC425"],
];

const colorBySchool = {};
for (const row of TEAM_COLORS) {
  const [school, primary, secondary, accent] = row;
  colorBySchool[school] = { primary, secondary, accent: accent || secondary };
}

const html = fs.readFileSync(TEAMS_HTML, "utf8");
const m = html.match(/const fallbackTeams = \[([\s\S]*?)\];/);
if (!m) throw new Error("fallbackTeams not found in teams.html");

const fallbackTeams = eval("[" + m[1] + "]");
const teams = {};

function resolveSchoolName(fullName) {
  const parsed = parseTeamName(fullName);
  if (colorBySchool[parsed]) return parsed;
  const keys = Object.keys(colorBySchool).sort(function (a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (fullName === k || fullName.startsWith(k + " ")) return k;
  }
  return parsed;
}

for (const t of fallbackTeams) {
  const school = resolveSchoolName(t.name);
  if (!school || t.logoId === "0" || t.logoId === 0) continue;
  const colors = colorBySchool[school] || null;
  teams[school] = {
    displayName: school,
    primary: colors ? colors.primary : null,
    secondary: colors ? colors.secondary : null,
    accent: colors ? colors.accent : null,
    logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.logoId}.png`,
    conference: t.conference || null,
  };
}

const aliases = {
  USC: "USC",
  "Southern California": "USC",
  "Miami (FL)": "Miami",
  "Miami Hurricanes": "Miami",
  "Ohio State Buckeyes": "Ohio State",
  "Alabama Crimson Tide": "Alabama",
  "Georgia Bulldogs": "Georgia",
  "Clemson Tigers": "Clemson",
  "LSU Tigers": "LSU",
  "Ole Miss Rebels": "Ole Miss",
  "Texas A&M Aggies": "Texas A&M",
  "Notre Dame Fighting Irish": "Notre Dame",
  "Florida State Seminoles": "Florida State",
  "Penn State Nittany Lions": "Penn State",
  "Oregon Ducks": "Oregon",
  "Washington Huskies": "Washington",
  "Michigan Wolverines": "Michigan",
};

const out = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  teams,
  aliases,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
console.error(`Wrote ${Object.keys(teams).length} teams to ${path.relative(CLIENT_ROOT, OUT_PATH)}`);
