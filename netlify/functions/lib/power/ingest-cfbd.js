/**
 * CFBD → normalized power-model inputs.
 * Keeps math decoupled from the HTTP API shape.
 */

const CFBD_BASE = "https://api.collegefootballdata.com";

async function cfbdGet(path, query, apiKey, signal) {
  const url = new URL(CFBD_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CFBD ${path} failed (${resp.status}): ${text.slice(0, 180)}`);
  }
  return resp.json();
}

function mapTeam(t) {
  return {
    id: t.id,
    name: t.school || t.displayName || t.mascot || String(t.id),
    abbreviation: t.abbreviation || null,
    conference: t.conference || null,
    classification: t.classification || "fbs",
    logoUrl: Array.isArray(t.logos) && t.logos[0] ? t.logos[0] : null,
  };
}

function mapGame(g) {
  return {
    gameId: g.id,
    season: g.season,
    week: g.week,
    date: g.startDate || null,
    homeId: g.homeId,
    awayId: g.awayId,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    neutralSite: Boolean(g.neutralSite),
    homeScore: g.homePoints,
    awayScore: g.awayPoints,
    completed: Boolean(g.completed),
    conferenceGame: Boolean(g.conferenceGame),
    homeClassification: g.homeClassification || null,
    awayClassification: g.awayClassification || null,
  };
}

/**
 * Ingest season data through asOfWeek for rating calculation.
 */
async function ingestSeasonFromCfbd({
  apiKey,
  season,
  asOfWeek,
  seasonType = "regular",
  signal,
}) {
  if (!apiKey) throw new Error("CFBD_API_KEY required for ingest");

  const [teamsRaw, gamesRaw, ppaRaw, talentRaw, returningRaw] = await Promise.all([
    cfbdGet("/teams/fbs", { year: season }, apiKey, signal),
    cfbdGet(
      "/games",
      { year: season, seasonType, division: "fbs" },
      apiKey,
      signal
    ),
    cfbdGet("/ppa/teams", { year: season }, apiKey, signal).catch(() => []),
    cfbdGet("/talent", { year: season }, apiKey, signal).catch(() => []),
    cfbdGet("/player/returning", { year: season }, apiKey, signal).catch(() => []),
  ]);

  const teams = (Array.isArray(teamsRaw) ? teamsRaw : []).map(mapTeam);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));

  // Attach talent / returning
  for (const row of Array.isArray(talentRaw) ? talentRaw : []) {
    const name = String(row.school || row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    // talent is often 0–1000-ish composite; map roughly to 0–100
    const talent = Number(row.talent);
    if (Number.isFinite(talent)) {
      t.talentScore = Math.max(0, Math.min(100, (talent / 1000) * 100));
    }
  }
  for (const row of Array.isArray(returningRaw) ? returningRaw : []) {
    const name = String(row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    const pct = Number(row.percentPpa ?? row.passingPpa);
    if (Number.isFinite(row.percentPpa)) t.returningProduction = Number(row.percentPpa);
    else if (Number.isFinite(pct)) t.returningProduction = clamp01(pct);
  }

  // PPA by team for season — used as soft team-level EPA if game-level missing
  const ppaByTeam = new Map();
  for (const row of Array.isArray(ppaRaw) ? ppaRaw : []) {
    const name = String(row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    const overall = row.offense?.overall ?? row.offense?.ppa;
    const def = row.defense?.overall ?? row.defense?.ppa;
    ppaByTeam.set(t.id, {
      offEpa: Number.isFinite(Number(overall)) ? Number(overall) : null,
      defEpa: Number.isFinite(Number(def)) ? Number(def) : null,
    });
  }

  let games = (Array.isArray(gamesRaw) ? gamesRaw : []).map(mapGame);
  if (Number.isFinite(asOfWeek) && asOfWeek > 0) {
    games = games.filter((g) => Number(g.week) <= asOfWeek);
  }

  // Enrich classifications on games; include FCS opponents as synthetic teams when needed
  for (const g of games) {
    if (!teamById.has(g.homeId) && g.homeTeam) {
      const syn = {
        id: g.homeId,
        name: g.homeTeam,
        classification: g.homeClassification || "fcs",
        conference: null,
      };
      teams.push(syn);
      teamById.set(syn.id, syn);
    }
    if (!teamById.has(g.awayId) && g.awayTeam) {
      const syn = {
        id: g.awayId,
        name: g.awayTeam,
        classification: g.awayClassification || "fcs",
        conference: null,
      };
      teams.push(syn);
      teamById.set(syn.id, syn);
    }

    const homePpa = ppaByTeam.get(g.homeId);
    const awayPpa = ppaByTeam.get(g.awayId);
    // Season PPA is a proxy when per-game EPA unavailable — applied lightly as team prior stats on games
    if (homePpa) {
      g.homeOffEpa = homePpa.offEpa;
      g.homeDefEpaAllowed = homePpa.defEpa;
    }
    if (awayPpa) {
      g.awayOffEpa = awayPpa.offEpa;
      g.awayDefEpaAllowed = awayPpa.defEpa;
    }
  }

  return { teams, games, season, asOfWeek };
}

function clamp01(n) {
  if (n > 1 && n <= 100) return n / 100;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  ingestSeasonFromCfbd,
  mapTeam,
  mapGame,
  cfbdGet,
};
