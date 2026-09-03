/**
 * Enrich team rosters with ESPN headshots + depth order (when ESPN publishes CFB depth charts).
 * Falls back to CFBD player usage as a playing-time sort proxy.
 */

const ESPN_SITE =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const ESPN_TEAMS_URL = `${ESPN_SITE}/teams?limit=500`;
const CFBD_BASE = "https://api.collegefootballdata.com";

const FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const ESPN_ID_FALLBACK = new Map([
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
]);

let espnTeamIndex = null;

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jerseyKey(j) {
  if (j == null || j === "") return "";
  const n = Number(String(j).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? String(n) : String(j).trim();
}

async function fetchJson(url) {
  const resp = await fetch(url, { headers: FETCH_HEADERS });
  const text = await resp.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} for ${url}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function loadEspnTeamIndex() {
  if (espnTeamIndex) return espnTeamIndex;
  try {
    const data = await fetchJson(ESPN_TEAMS_URL);
    const teams = (data?.sports?.[0]?.leagues?.[0]?.teams || [])
      .map((row) => row.team)
      .filter(Boolean);
    espnTeamIndex = new Map();
    for (const team of teams) {
      const id = String(team.id);
      const keys = [team.location, team.shortDisplayName, team.displayName, team.name]
        .filter(Boolean)
        .map((k) => normalizeName(k));
      for (const key of keys) {
        if (key && !espnTeamIndex.has(key)) espnTeamIndex.set(key, id);
      }
    }
    return espnTeamIndex;
  } catch (err) {
    console.warn("team-roster-meta loadEspnTeamIndex:", err.message);
    espnTeamIndex = new Map();
    return espnTeamIndex;
  }
}

function espnIdFromLogoUrl(logoUrl) {
  const m = String(logoUrl || "").match(/\/ncaa\/(?:500|500-dark)\/(\d+)\.(?:png|svg)/i);
  return m ? m[1] : null;
}

async function resolveEspnTeamId({ team, espnTeamId, logoUrl }) {
  if (espnTeamId && /^\d+$/.test(String(espnTeamId))) return String(espnTeamId);
  const fromLogo = espnIdFromLogoUrl(logoUrl);
  if (fromLogo) return fromLogo;

  const key = normalizeName(team);
  if (!key) return null;
  if (ESPN_ID_FALLBACK.has(key)) return ESPN_ID_FALLBACK.get(key);

  const index = await loadEspnTeamIndex();
  if (index.has(key)) return index.get(key);
  for (const [name, id] of index.entries()) {
    if (name.startsWith(`${key} `) || key.startsWith(`${name} `)) return id;
  }
  return null;
}

function flattenEspnRoster(rosterJson) {
  const groups = Array.isArray(rosterJson?.athletes) ? rosterJson.athletes : [];
  const out = [];
  for (const group of groups) {
    for (const p of Array.isArray(group?.items) ? group.items : []) {
      const id = p?.id != null ? String(p.id) : null;
      if (!id) continue;
      const headshot =
        p.headshot?.href ||
        `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png`;
      out.push({
        espnId: id,
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        displayName:
          p.displayName ||
          p.fullName ||
          `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        jersey: p.jersey != null ? String(p.jersey) : "",
        position: p.position?.abbreviation || p.position?.displayName || "",
        headshot,
        depthRank: null,
      });
    }
  }
  return out;
}

/**
 * NFL-style: depthchart[].positions[key].athletes[]
 * Older/alt: items[].positions[].athletes[]
 */
function applyDepthRanks(players, depthJson) {
  const byEspnId = new Map(players.map((p) => [p.espnId, p]));
  let matched = 0;

  const charts = [];
  if (Array.isArray(depthJson?.depthchart)) charts.push(...depthJson.depthchart);
  if (Array.isArray(depthJson?.items)) charts.push(...depthJson.items);

  for (const chart of charts) {
    const positions = chart?.positions;
    const list = Array.isArray(positions)
      ? positions
      : positions && typeof positions === "object"
        ? Object.values(positions)
        : [];

    for (const pos of list) {
      const athletes = Array.isArray(pos?.athletes) ? pos.athletes : [];
      athletes.forEach((a, idx) => {
        const id = String(a?.id || a?.athlete?.id || "");
        if (!id) return;
        const player = byEspnId.get(id);
        if (!player) return;
        const rank =
          Number(a.rank) ||
          Number(a?.athlete?.rank) ||
          idx + 1;
        if (player.depthRank == null || rank < player.depthRank) {
          player.depthRank = rank;
          matched += 1;
        }
      });
    }
  }

  return matched > 0;
}

async function fetchCfbdUsage(team, year, apiKey) {
  if (!apiKey || !team || !year) return [];
  const url = new URL(`${CFBD_BASE}/player/usage`);
  url.searchParams.set("year", String(year));
  url.searchParams.set("team", team);
  const resp = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  });
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

function usageByName(usageRows) {
  const map = new Map();
  for (const row of usageRows) {
    const name = normalizeName(row.name);
    if (!name) continue;
    const overall = Number(row.usage?.overall ?? row.overall);
    if (!Number.isFinite(overall)) continue;
    const prev = map.get(name);
    if (prev == null || overall > prev) map.set(name, overall);
  }
  return map;
}

/**
 * @returns {{
 *   espnTeamId: string|null,
 *   players: Array<object>,
 *   depthAvailable: boolean,
 *   sortMode: 'depth'|'usage'|'jersey',
 *   usageYear: number|null
 * }}
 */
async function getTeamRosterMeta({ team, year, espnTeamId, logoUrl, apiKey }) {
  const seasonYear = Number(year) || new Date().getUTCFullYear();
  const id = await resolveEspnTeamId({ team, espnTeamId, logoUrl });
  if (!id) {
    return {
      espnTeamId: null,
      players: [],
      depthAvailable: false,
      sortMode: "jersey",
      usageYear: null,
    };
  }

  const [rosterJson, depthJson] = await Promise.all([
    fetchJson(`${ESPN_SITE}/teams/${id}/roster`),
    fetchJson(`${ESPN_SITE}/teams/${id}/depthcharts`).catch(() => null),
  ]);

  const players = flattenEspnRoster(rosterJson);
  const depthAvailable = applyDepthRanks(players, depthJson);

  let sortMode = depthAvailable ? "depth" : "jersey";
  let usageYear = null;

  if (!depthAvailable && apiKey && team) {
    const yearsToTry = [seasonYear, seasonYear - 1].filter((y) => y >= 2013);
    for (const y of yearsToTry) {
      try {
        const rows = await fetchCfbdUsage(team, y, apiKey);
        const byName = usageByName(rows);
        if (!byName.size) continue;
        let hits = 0;
        for (const p of players) {
          const overall =
            byName.get(normalizeName(p.displayName)) ??
            byName.get(normalizeName(`${p.firstName} ${p.lastName}`));
          if (overall != null) {
            p.usageOverall = overall;
            hits += 1;
          }
        }
        if (hits > 0) {
          sortMode = "usage";
          usageYear = y;
          break;
        }
      } catch (err) {
        console.warn("team-roster-meta usage:", err.message);
      }
    }
  }

  return {
    espnTeamId: id,
    players,
    depthAvailable,
    sortMode,
    usageYear,
  };
}

function matchMetaToCfbdPlayer(cfbdPlayer, metaPlayers) {
  const jersey = jerseyKey(cfbdPlayer.jersey);
  const full = normalizeName(
    `${cfbdPlayer.firstName || ""} ${cfbdPlayer.lastName || ""}`.trim() ||
      cfbdPlayer.name
  );
  const last = normalizeName(cfbdPlayer.lastName);

  const candidates = metaPlayers.filter((m) => {
    if (jersey && jerseyKey(m.jersey) === jersey) return true;
    const mFull = normalizeName(m.displayName);
    if (full && mFull === full) return true;
    if (last && normalizeName(m.lastName) === last && jersey && jerseyKey(m.jersey) === jersey)
      return true;
    return false;
  });

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const exactName = candidates.find((m) => normalizeName(m.displayName) === full);
  if (exactName) return exactName;

  const jerseyAndLast = candidates.find(
    (m) =>
      jersey &&
      jerseyKey(m.jersey) === jersey &&
      last &&
      normalizeName(m.lastName) === last
  );
  return jerseyAndLast || candidates[0];
}

module.exports = {
  getTeamRosterMeta,
  matchMetaToCfbdPlayer,
  normalizeName,
  jerseyKey,
  espnIdFromLogoUrl,
};
