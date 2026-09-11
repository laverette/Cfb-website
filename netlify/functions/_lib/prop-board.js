/**
 * Weekly NCAAF player-prop board: Odds API lines + CFBD model hit probabilities.
 */
const { loadCurrentWeek, loadGamesByWeek } = require("../db");
const {
  isOddsApiConfigured,
  listNcaafEvents,
  fetchEventPlayerProps,
  flattenEventProps,
  teamsLikelyMatch,
  DEFAULT_PROP_MARKETS,
} = require("./odds-api");
const { searchPlayers, evaluateProp, STAT_DEFS } = require("./prop-eval");
const { buildProbGrade } = require("./prop-prob");

const BOARD_CACHE = globalThis.__cfb_prop_board_cache || { at: 0, payload: null };
globalThis.__cfb_prop_board_cache = BOARD_CACHE;
const CACHE_MS = 12 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function matchEventToGame(event, games) {
  for (const g of games) {
    const home = g.home_team_name || g.homeTeamName;
    const away = g.away_team_name || g.awayTeamName;
    const homeOk =
      teamsLikelyMatch(event.home_team, home) ||
      teamsLikelyMatch(event.away_team, home);
    const awayOk =
      teamsLikelyMatch(event.away_team, away) ||
      teamsLikelyMatch(event.home_team, away);
    if (homeOk && awayOk) return g;
  }
  return null;
}

function opponentForPlayer(playerTeam, event) {
  const team = String(playerTeam || "");
  if (!team) return event.home_team;
  if (teamsLikelyMatch(team, event.home_team)) return event.away_team;
  if (teamsLikelyMatch(team, event.away_team)) return event.home_team;
  return event.away_team;
}

async function resolvePlayerId(playerName, eventTeams, { apiKey, signal, cache, season }) {
  const key = String(playerName).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const players = await searchPlayers({
    q: playerName,
    team: "",
    year: season || new Date().getFullYear(),
    apiKey,
    signal,
  });
  const needle = String(playerName).toLowerCase().trim();
  const teams = Array.isArray(eventTeams) ? eventTeams : [];
  let best = null;
  let bestScore = -1;
  for (const p of players || []) {
    const n = String(p.name || "").toLowerCase();
    let score = 0;
    if (n === needle) score = 100;
    else if (n.endsWith(needle) || needle.endsWith(n)) score = 85;
    else if (n.includes(needle) || needle.includes(n)) score = 55;
    if (teams.some((t) => teamsLikelyMatch(p.team, t))) score += 30;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  const hit = bestScore >= 55 ? best : null;
  cache.set(key, hit);
  return hit;
}

async function buildWeeklyPropBoard({
  season,
  apiKey,
  powerTeams,
  signal,
  maxEvents = 8,
  maxProps = 28,
  force = false,
} = {}) {
  if (!isOddsApiConfigured()) {
    const err = new Error(
      "ODDS_API_KEY is not configured. Add it in Netlify env to load live prop lines."
    );
    err.code = "ODDS_API_NOT_CONFIGURED";
    throw err;
  }

  if (!force && BOARD_CACHE.payload && Date.now() - BOARD_CACHE.at < CACHE_MS) {
    return { ...BOARD_CACHE.payload, cached: true };
  }

  const week = await loadCurrentWeek();
  const games = week?.id ? await loadGamesByWeek(week.id) : [];
  const warnings = [];

  const { events, quota: eventsQuota } = await listNcaafEvents({ signal });
  let matched = [];
  if (games.length) {
    matched = events
      .map((ev) => ({ ev, game: matchEventToGame(ev, games) }))
      .filter((x) => x.game)
      .slice(0, maxEvents);
  }
  if (!matched.length) {
    // Fall back to soonest Odds API events if slate matching fails
    warnings.push(
      games.length
        ? "Could not match Odds API events to this week’s slate names — showing upcoming NCAAF props instead."
        : "No weekly picks slate found — showing upcoming NCAAF props."
    );
    matched = events
      .slice()
      .sort(
        (a, b) =>
          new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
      )
      .slice(0, maxEvents)
      .map((ev) => ({ ev, game: null }));
  }

  const flatProps = [];
  let lastQuota = eventsQuota;
  for (const { ev } of matched) {
    try {
      const { event, quota } = await fetchEventPlayerProps(ev.id, {
        markets: DEFAULT_PROP_MARKETS,
        signal,
      });
      lastQuota = quota || lastQuota;
      const rows = flattenEventProps(event || ev);
      for (const row of rows) flatProps.push(row);
      await sleep(120);
    } catch (err) {
      warnings.push(
        `Props unavailable for ${ev.away_team} @ ${ev.home_team}: ${err.message || "error"}`
      );
    }
  }

  // Prefer yards/receptions volume markets first
  const priority = { pass_yds: 1, rush_yds: 2, rec_yds: 3, rec: 4, pass_td: 5 };
  flatProps.sort((a, b) => (priority[a.statId] || 9) - (priority[b.statId] || 9));
  const selected = flatProps.slice(0, maxProps);

  const playerCache = new Map();
  const seasonYear = Number(season) || new Date().getFullYear();

  const graded = await mapPool(selected, 3, async (row) => {
    try {
      const player = await resolvePlayerId(row.playerName, [row.homeTeam, row.awayTeam], {
        apiKey,
        signal,
        cache: playerCache,
        season: seasonYear,
      });
      if (!player?.id) {
        return {
          ...row,
          skipped: true,
          skipReason: "Player not found in CFBD",
        };
      }
      const opponent = opponentForPlayer(player.team, {
        home_team: row.homeTeam,
        away_team: row.awayTeam,
      });
      const model = await evaluateProp({
        playerId: player.id,
        team: player.team || "",
        name: player.name || row.playerName,
        statId: row.statId,
        line: row.line,
        opponent,
        season: seasonYear,
        apiKey,
        powerTeams,
        signal,
      });
      const grade = buildProbGrade({
        expected: model.expected,
        line: row.line,
        statId: row.statId,
        lean: model.lean,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
      });
      const def = STAT_DEFS.find((d) => d.id === row.statId);
      return {
        eventId: row.eventId,
        commenceTime: row.commenceTime,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playerName: model.player?.name || row.playerName,
        playerId: player.id,
        playerTeam: model.player?.team || player.team || null,
        position: model.player?.position || player.position || null,
        statId: row.statId,
        statLabel: def?.label || row.statId,
        line: row.line,
        bookmaker: row.bookmaker,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
        expected: model.expected,
        lean: model.lean,
        confidence: model.confidence,
        edgePts: model.edge,
        opponent: model.opponent?.name || opponent,
        grade,
        skipped: false,
      };
    } catch (err) {
      return {
        ...row,
        skipped: true,
        skipReason: err.message || "Evaluate failed",
      };
    }
  });

  const props = graded
    .filter((p) => p && !p.skipped && p.grade)
    .sort((a, b) => {
      const ae = Math.abs(a.grade?.probEdge || 0);
      const be = Math.abs(b.grade?.probEdge || 0);
      return be - ae;
    });

  const skipped = graded.filter((p) => p && p.skipped).length;

  const payload = {
    ok: true,
    cached: false,
    generatedAt: new Date().toISOString(),
    week: week
      ? {
          id: week.id,
          weekNumber: week.week_number,
          seasonYear: week.season_year,
        }
      : null,
    eventCount: matched.length,
    propCount: props.length,
    skipped,
    quota: lastQuota,
    warnings,
    props,
    disclaimer:
      "Educational model only — not betting advice. Hit % is a projection vs the sportsbook line, not a guarantee.",
  };

  BOARD_CACHE.at = Date.now();
  BOARD_CACHE.payload = payload;
  return payload;
}

module.exports = { buildWeeklyPropBoard };
