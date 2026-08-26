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

async function cfbdGetOptional(path, query, apiKey, signal) {
  try {
    return await cfbdGet(path, query, apiKey, signal);
  } catch (err) {
    console.warn("cfbd optional miss:", path, err && err.message ? err.message : err);
    return [];
  }
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

function attachTalent(teams, talentRaw) {
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));
  for (const row of Array.isArray(talentRaw) ? talentRaw : []) {
    const name = String(row.school || row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    const talent = Number(row.talent);
    if (Number.isFinite(talent)) {
      // CFBD talent composites are often ~400–1000; map into ~0–100
      t.talentScore = Math.max(0, Math.min(100, (talent / 1000) * 100));
    }
  }
}

function attachReturning(teams, returningRaw) {
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));
  for (const row of Array.isArray(returningRaw) ? returningRaw : []) {
    const name = String(row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    if (Number.isFinite(Number(row.percentPpa))) {
      t.returningProduction = clamp01(Number(row.percentPpa));
    }
  }
}

/** Map last season SP+ (or similar) into prevSeasonPower-ish points. */
function attachPrevSp(teams, spRaw) {
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));
  const ratings = [];
  for (const row of Array.isArray(spRaw) ? spRaw : []) {
    const name = String(row.team || row.school || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    const rating = Number(row.rating ?? row.secondOrderWins ?? row.spOverall);
    if (!Number.isFinite(rating)) continue;
    ratings.push(rating);
    t._spRaw = rating;
  }
  if (!ratings.length) return;
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  // SP+ is already roughly points-above-average-ish; center just in case
  for (const t of teams) {
    if (Number.isFinite(t._spRaw)) {
      t.prevSeasonPower = t._spRaw - mean;
      delete t._spRaw;
    }
  }
}

/**
 * Ingest season data through asOfWeek for rating calculation.
 * Week 0 (preseason): skips games/PPA — teams + talent + returning + prior SP+ only.
 */
async function ingestSeasonFromCfbd({
  apiKey,
  season,
  asOfWeek,
  seasonType = "regular",
  signal,
}) {
  if (!apiKey) throw new Error("CFBD_API_KEY required for ingest");

  const preseasonOnly = !Number.isFinite(asOfWeek) || asOfWeek <= 0;
  const prevSeason = Number(season) - 1;

  // Always need FBS roster
  const teamsRaw = await cfbdGet("/teams/fbs", { year: season }, apiKey, signal);
  const teams = (Array.isArray(teamsRaw) ? teamsRaw : []).map(mapTeam);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Priors — optional endpoints must not fail the whole run
  const [talentRaw, returningRaw, spRaw] = await Promise.all([
    cfbdGetOptional("/talent", { year: season }, apiKey, signal),
    cfbdGetOptional("/player/returning", { year: season }, apiKey, signal),
    cfbdGetOptional("/ratings/sp", { year: prevSeason }, apiKey, signal),
  ]);
  attachTalent(teams, talentRaw);
  attachReturning(teams, returningRaw);
  attachPrevSp(teams, spRaw);

  if (preseasonOnly) {
    return { teams, games: [], season, asOfWeek: 0, mode: "preseason" };
  }

  // In-season: games + optional season PPA (as EPA proxy)
  const [gamesRaw, ppaRaw] = await Promise.all([
    cfbdGet(
      "/games",
      { year: season, seasonType, classification: "fbs" },
      apiKey,
      signal
    ),
    cfbdGetOptional("/ppa/teams", { year: season }, apiKey, signal),
  ]);

  const ppaByTeam = new Map();
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));
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
  games = games.filter((g) => Number(g.week) <= asOfWeek);

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
    if (homePpa) {
      g.homeOffEpa = homePpa.offEpa;
      g.homeDefEpaAllowed = homePpa.defEpa;
    }
    if (awayPpa) {
      g.awayOffEpa = awayPpa.offEpa;
      g.awayDefEpaAllowed = awayPpa.defEpa;
    }
  }

  return { teams, games, season, asOfWeek, mode: "inseason" };
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
