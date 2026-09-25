/**
 * ESPN team + athlete resolution with cached source-id mappings.
 */

const { aliasTeam, normalizeTeam } = require("../../names");
const { normalizePlayerName } = require("../game-key");
const { dataLog } = require("../log");
const { SITE, cachedEspnGet } = require("./http");
const { schoolFromEspnTeam } = require("./parse");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TEAM_FALLBACK = new Map([
  ["alabama", "333"],
  ["auburn", "2"],
  ["georgia", "61"],
  ["lsu", "99"],
  ["tennessee", "2633"],
  ["texas a&m", "245"],
  ["ole miss", "145"],
  ["mississippi state", "344"],
  ["florida", "57"],
  ["florida state", "52"],
  ["clemson", "228"],
  ["ohio state", "194"],
  ["michigan", "130"],
  ["texas", "251"],
  ["oklahoma", "201"],
  ["usc", "30"],
  ["oregon", "2483"],
  ["notre dame", "87"],
  ["penn state", "213"],
  ["miami", "2390"],
  ["miami fl", "2390"],
]);

let teamIndexPromise = null;

async function loadTeamIndex() {
  if (teamIndexPromise) return teamIndexPromise;
  teamIndexPromise = (async () => {
    const { value } = await cachedEspnGet(
      "espn:teams-index",
      DAY,
      `${SITE}/teams?limit=500`
    );
    const map = new Map();
    const teams = (value?.sports?.[0]?.leagues?.[0]?.teams || [])
      .map((row) => row.team)
      .filter(Boolean);
    for (const team of teams) {
      const id = String(team.id);
      const keys = [
        team.location,
        team.shortDisplayName,
        team.displayName,
        team.name,
        schoolFromEspnTeam(team),
      ]
        .filter(Boolean)
        .map((k) => aliasTeam(k) || normalizeTeam(k));
      for (const key of keys) {
        if (key && !map.has(key)) map.set(key, id);
      }
    }
    return map;
  })().catch((err) => {
    teamIndexPromise = null;
    throw err;
  });
  return teamIndexPromise;
}

async function resolveEspnTeamId(team) {
  const key = aliasTeam(team) || normalizeTeam(team);
  if (!key) return null;
  if (TEAM_FALLBACK.has(key)) return TEAM_FALLBACK.get(key);
  try {
    const index = await loadTeamIndex();
    if (index.has(key)) return index.get(key);
    for (const [name, id] of index.entries()) {
      if (name.startsWith(`${key} `) || key.startsWith(`${name} `)) return id;
      if (name.includes(key) || key.includes(name)) return id;
    }
  } catch (err) {
    dataLog("ESPN", `Team index failed: ${err.message}`);
  }
  return null;
}

function flattenRoster(rosterJson) {
  const groups = Array.isArray(rosterJson?.athletes) ? rosterJson.athletes : [];
  const out = [];
  for (const group of groups) {
    for (const p of Array.isArray(group?.items) ? group.items : []) {
      const id = p?.id != null ? String(p.id) : null;
      if (!id) continue;
      out.push({
        espnId: id,
        name:
          p.displayName ||
          p.fullName ||
          `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        jersey: p.jersey != null ? String(p.jersey) : "",
        position: p.position?.abbreviation || p.position?.displayName || "",
        team: schoolFromEspnTeam(rosterJson?.team) || null,
      });
    }
  }
  return out;
}

function scoreAthleteMatch(athlete, { name, position, jersey }) {
  const needle = normalizePlayerName(name);
  const cand = normalizePlayerName(athlete.name);
  if (!needle || !cand) return 0;
  let score = 0;
  if (cand === needle) score += 100;
  else {
    const pa = needle.split(" ");
    const pb = cand.split(" ");
    if (pa.length >= 2 && pb.length >= 2) {
      if (pa[pa.length - 1] === pb[pb.length - 1] && pa[0] === pb[0]) score += 90;
      else if (pa[pa.length - 1] === pb[pb.length - 1] && pa[0][0] === pb[0][0]) score += 55;
    }
    if (!score && (cand.includes(needle) || needle.includes(cand))) score += 40;
  }
  if (!score) return 0;

  if (jersey != null && jersey !== "" && athlete.jersey) {
    if (String(athlete.jersey) === String(jersey)) score += 25;
    else score -= 15;
  }
  if (position && athlete.position) {
    if (String(athlete.position).toUpperCase() === String(position).toUpperCase()) score += 15;
    else score -= 5;
  }
  return score;
}

/**
 * Resolve an ESPN athlete id. Ambiguous matches return { ambiguous: true }.
 */
async function resolveEspnAthlete({
  name,
  team,
  season,
  position,
  jersey,
  cfbdPlayerId,
  signal,
} = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  const mapKey = cfbdPlayerId
    ? `espn:athlete-map:cfbd:${cfbdPlayerId}:${seasonYear}`
    : `espn:athlete-map:name:${normalizePlayerName(name)}:${aliasTeam(team) || normalizeTeam(team)}:${seasonYear}`;

  const prior = await readMappedAthlete(mapKey);
  if (prior?.espnPlayerId) {
    dataLog("ESPN", `Cache hit athlete map → ${prior.espnPlayerId}`);
    return {
      espnPlayerId: String(prior.espnPlayerId),
      confidence: "cached",
      ambiguous: false,
      playerName: prior.playerName || name,
      team: prior.team || team,
      position: prior.position || position || null,
      jersey: prior.jersey || jersey || null,
    };
  }

  const teamId = await resolveEspnTeamId(team);
  if (!teamId) {
    return { espnPlayerId: null, ambiguous: false, reason: "team_unresolved" };
  }

  const rosterKey = `espn:roster:${teamId}:${seasonYear}`;
  const { value: rosterJson } = await cachedEspnGet(
    rosterKey,
    12 * HOUR,
    `${SITE}/teams/${teamId}/roster`,
    { signal }
  );
  const athletes = flattenRoster(rosterJson);
  const scored = athletes
    .map((a) => ({ a, score: scoreAthleteMatch(a, { name, position, jersey }) }))
    .filter((x) => x.score >= 55)
    .sort((x, y) => y.score - x.score);

  if (!scored.length) {
    return { espnPlayerId: null, ambiguous: false, reason: "no_match" };
  }

  const best = scored[0];
  const second = scored[1];
  if (second && best.score - second.score < 20 && best.score < 115) {
    dataLog("ESPN", `Ambiguous match for ${name}`, {
      best: best.a.name,
      bestScore: best.score,
      second: second.a.name,
      secondScore: second.score,
    });
    return {
      espnPlayerId: null,
      ambiguous: true,
      reason: "ambiguous",
      candidates: scored.slice(0, 3).map((x) => ({
        espnId: x.a.espnId,
        name: x.a.name,
        score: x.score,
        position: x.a.position,
        jersey: x.a.jersey,
      })),
    };
  }

  const resolved = {
    espnPlayerId: best.a.espnId,
    playerName: best.a.name,
    team: team || best.a.team,
    position: best.a.position || position || null,
    jersey: best.a.jersey || jersey || null,
    cfbdPlayerId: cfbdPlayerId != null ? String(cfbdPlayerId) : null,
    season: seasonYear,
    confidence: best.score >= 100 ? "high" : "medium",
    ambiguous: false,
  };

  await writeMappedAthlete(mapKey, resolved);
  dataLog("ESPN", `Resolved ${name} → ESPN athlete ${resolved.espnPlayerId}`);
  return resolved;
}

async function readMappedAthlete(cacheKey) {
  try {
    const { getSupabase, hasSupabase } = require("../../../../db");
    if (!hasSupabase()) {
      const { readMemory } = require("../../cache");
      return readMemory(cacheKey);
    }
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("prop_lab_cfbd_cache")
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    return data.payload;
  } catch {
    return null;
  }
}

async function writeMappedAthlete(cacheKey, payload) {
  const { writeMemory } = require("../../cache");
  writeMemory(cacheKey, payload, 30 * DAY);
  try {
    const { getSupabase, hasSupabase } = require("../../../../db");
    if (!hasSupabase()) return;
    const supabase = getSupabase();
    await supabase.from("prop_lab_cfbd_cache").upsert(
      {
        cache_key: cacheKey,
        payload,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch {
    // optional persistence
  }
}

module.exports = {
  resolveEspnTeamId,
  resolveEspnAthlete,
  flattenRoster,
  scoreAthleteMatch,
  normalizePlayerName,
  loadTeamIndex,
};
