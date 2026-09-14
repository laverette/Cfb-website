function sameTeam(a, b) {
  return normalizeTeam(a) === normalizeTeam(b) && Boolean(normalizeTeam(a));
}

function normalizeTeam(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const TEAM_ALIASES = {
  ecu: "east carolina",
  "e carolina": "east carolina",
  "east carolina": "east carolina",
  "ole miss": "ole miss",
  "miss state": "mississippi state",
  "miami fl": "miami",
  "miami (fl)": "miami",
  "miami florida": "miami",
  "miami ohio": "miami (oh)",
  "miami (oh)": "miami (oh)",
  "uconn": "connecticut",
  "utsa": "utsa",
  "app state": "appalachian state",
  "southern miss": "southern mississippi",
};

function aliasTeam(name) {
  const key = normalizeTeam(name);
  return TEAM_ALIASES[key] || key;
}

function findTeamRating(teams, name) {
  if (!name || !Array.isArray(teams)) return null;
  const needle = aliasTeam(name);
  if (!needle) return null;
  const scored = teams
    .map((t) => {
      const n = normalizeTeam(t.name);
      const ab = normalizeTeam(t.abbreviation);
      let score = 0;
      if (n === needle || ab === needle || aliasTeam(t.name) === needle) score = 100;
      else if (n.startsWith(needle) || needle.startsWith(n)) score = 80;
      else if (n.includes(needle) || needle.includes(n)) score = 60;
      else if (ab && (needle.includes(ab) || ab.includes(needle))) score = 40;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.t || null;
}

function playerNameMatch(a, b) {
  const na = String(a || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  const nb = String(b || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(" ");
  const pb = nb.split(" ");
  if (pa.length >= 2 && pb.length >= 2) {
    return pa[pa.length - 1] === pb[pb.length - 1] && pa[0][0] === pb[0][0];
  }
  return na.includes(nb) || nb.includes(na);
}

module.exports = { sameTeam, normalizeTeam, aliasTeam, findTeamRating, playerNameMatch };
