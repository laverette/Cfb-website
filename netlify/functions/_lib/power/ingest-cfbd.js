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
  const values = [];
  for (const row of Array.isArray(talentRaw) ? talentRaw : []) {
    const name = String(row.school || row.team || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;
    const talent = Number(row.talent);
    if (!Number.isFinite(talent)) continue;
    t._talentRaw = talent;
    values.push(talent);
  }
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  for (const t of teams) {
    if (!Number.isFinite(t._talentRaw)) continue;
    // Percentile-ish 0–100 across FBS for this composite
    t.talentScore = Math.max(0, Math.min(100, ((t._talentRaw - min) / span) * 100));
    delete t._talentRaw;
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

/**
 * Map SP+ into overall prior + unit ratings (offense / defense / ST).
 * CFBD SP+ unit ratings: higher is better for both offense and defense.
 */
function attachPrevSp(teams, spRaw) {
  const teamByName = new Map(teams.map((t) => [String(t.name).toLowerCase(), t]));
  const overall = [];
  const offs = [];
  const defs = [];
  const sts = [];

  for (const row of Array.isArray(spRaw) ? spRaw : []) {
    const name = String(row.team || row.school || "").toLowerCase();
    const t = teamByName.get(name);
    if (!t) continue;

    const rating = Number(row.rating);
    const off = Number(row.offense?.rating);
    const def = Number(row.defense?.rating);
    const st = Number(row.specialTeams?.rating ?? row.special_teams?.rating);

    if (Number.isFinite(rating)) {
      t._spOverall = rating;
      overall.push(rating);
    }
    if (Number.isFinite(off)) {
      t._spOff = off;
      offs.push(off);
    }
    if (Number.isFinite(def)) {
      t._spDef = def;
      defs.push(def);
    }
    if (Number.isFinite(st)) {
      t._spSt = st;
      sts.push(st);
    }
  }

  const oMean = overall.length ? overall.reduce((a, b) => a + b, 0) / overall.length : 0;
  const offMean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
  const defMean = defs.length ? defs.reduce((a, b) => a + b, 0) / defs.length : 0;
  const stMean = sts.length ? sts.reduce((a, b) => a + b, 0) / sts.length : 0;

  for (const t of teams) {
    if (Number.isFinite(t._spOverall)) {
      t.prevSeasonPower = t._spOverall - oMean;
      delete t._spOverall;
    }
    if (Number.isFinite(t._spOff)) {
      t.preseasonOffense = t._spOff - offMean;
      delete t._spOff;
    }
    if (Number.isFinite(t._spDef)) {
      // Positive = good defense (points above average contribution)
      t.preseasonDefense = t._spDef - defMean;
      delete t._spDef;
    }
    if (Number.isFinite(t._spSt)) {
      t.preseasonSpecialTeams = t._spSt - stMean;
      t.specialTeamsRating = t.preseasonSpecialTeams;
      delete t._spSt;
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

  // Priors — try current year then previous year for talent/returning (preseason gaps)
  const [talentRaw, talentPrev, returningRaw, returningPrev, spRaw] = await Promise.all([
    cfbdGetOptional("/talent", { year: season }, apiKey, signal),
    cfbdGetOptional("/talent", { year: prevSeason }, apiKey, signal),
    cfbdGetOptional("/player/returning", { year: season }, apiKey, signal),
    cfbdGetOptional("/player/returning", { year: prevSeason }, apiKey, signal),
    cfbdGetOptional("/ratings/sp", { year: prevSeason }, apiKey, signal),
  ]);
  attachTalent(teams, Array.isArray(talentRaw) && talentRaw.length ? talentRaw : talentPrev);
  attachReturning(
    teams,
    Array.isArray(returningRaw) && returningRaw.length ? returningRaw : returningPrev
  );
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
