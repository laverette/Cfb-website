/**
 * The Odds API (https://the-odds-api.com) — NCAAF player props.
 * Set ODDS_API_KEY in Netlify env.
 */
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_ncaaf";

/** Odds API market key → our STAT_DEFS id */
const MARKET_TO_STAT = {
  player_pass_yds: "pass_yds",
  player_pass_tds: "pass_td",
  player_pass_completions: "pass_comp",
  player_pass_attempts: "pass_att",
  player_pass_interceptions: "pass_int",
  player_rush_yds: "rush_yds",
  player_rush_tds: "rush_td",
  player_rush_attempts: "rush_att",
  player_receptions: "rec",
  player_reception_yds: "rec_yds",
  player_reception_tds: "rec_td",
};

const DEFAULT_PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
];

function readOddsApiKey() {
  return (
    (process.env.ODDS_API_KEY && String(process.env.ODDS_API_KEY).trim()) ||
    (process.env.THE_ODDS_API_KEY && String(process.env.THE_ODDS_API_KEY).trim()) ||
    ""
  );
}

function isOddsApiConfigured() {
  return Boolean(readOddsApiKey());
}

async function oddsGet(path, query = {}, signal) {
  const apiKey = readOddsApiKey();
  if (!apiKey) {
    const err = new Error("ODDS_API_KEY is not configured");
    err.code = "ODDS_API_NOT_CONFIGURED";
    throw err;
  }
  const url = new URL(`${ODDS_BASE}${path}`);
  url.searchParams.set("apiKey", apiKey);
  Object.entries(query).forEach(([k, v]) => {
    if (v == null || v === "") return;
    url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });
  const remaining = resp.headers.get("x-requests-remaining");
  const used = resp.headers.get("x-requests-used");
  const text = await resp.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(
      (body && (body.message || body.error_code || body.error)) ||
        `Odds API HTTP ${resp.status}`
    );
    err.code = "ODDS_API_ERROR";
    err.status = resp.status;
    err.details = body;
    throw err;
  }
  return {
    data: body,
    quota: {
      remaining: remaining != null ? Number(remaining) : null,
      used: used != null ? Number(used) : null,
    },
  };
}

async function listNcaafEvents({ signal } = {}) {
  const { data, quota } = await oddsGet(
    `/sports/${SPORT}/events`,
    {},
    signal
  );
  return { events: Array.isArray(data) ? data : [], quota };
}

async function fetchEventPlayerProps(eventId, { markets, regions, signal } = {}) {
  const marketList = Array.isArray(markets) && markets.length ? markets : DEFAULT_PROP_MARKETS;
  const { data, quota } = await oddsGet(
    `/sports/${SPORT}/events/${encodeURIComponent(eventId)}/odds`,
    {
      regions: regions || "us",
      markets: marketList.join(","),
      oddsFormat: "american",
    },
    signal
  );
  return { event: data, quota };
}

function normalizeTeamToken(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(university|univ|college|st|state|the|of|football|fb)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function teamsLikelyMatch(a, b) {
  const na = normalizeTeamToken(a);
  const nb = normalizeTeamToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aw = na.split(" ").filter((w) => w.length > 2);
  const bw = nb.split(" ").filter((w) => w.length > 2);
  if (!aw.length || !bw.length) return false;
  const shared = aw.filter((w) => bw.includes(w));
  return shared.length >= Math.min(2, Math.min(aw.length, bw.length));
}

/**
 * Flatten bookmaker prop markets into one row per player/stat (best book by |price| closeness to -110).
 */
function flattenEventProps(event, { preferredBooks = ["fanduel", "draftkings", "betmgm"] } = {}) {
  if (!event || !Array.isArray(event.bookmakers)) return [];
  const books = [...event.bookmakers].sort((a, b) => {
    const ia = preferredBooks.indexOf(String(a.key || "").toLowerCase());
    const ib = preferredBooks.indexOf(String(b.key || "").toLowerCase());
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  /** @type {Map<string, object>} */
  const byKey = new Map();

  for (const book of books) {
    const bookKey = String(book.key || "");
    const bookTitle = String(book.title || bookKey);
    for (const market of book.markets || []) {
      const marketKey = String(market.key || "");
      const statId = MARKET_TO_STAT[marketKey];
      if (!statId) continue;
      const overs = new Map();
      const unders = new Map();
      for (const o of market.outcomes || []) {
        const playerName = String(o.description || "").trim();
        if (!playerName) continue;
        const point = Number(o.point);
        const price = Number(o.price);
        if (!Number.isFinite(point) || !Number.isFinite(price)) continue;
        const side = String(o.name || "").toLowerCase();
        const mapKey = `${playerName.toLowerCase()}|${statId}|${point}`;
        if (side === "over") overs.set(mapKey, { playerName, point, price });
        else if (side === "under") unders.set(mapKey, { playerName, point, price });
      }
      for (const [mapKey, over] of overs.entries()) {
        if (byKey.has(mapKey)) continue;
        const under = unders.get(mapKey);
        byKey.set(mapKey, {
          eventId: event.id,
          commenceTime: event.commence_time,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          playerName: over.playerName,
          statId,
          marketKey,
          line: over.point,
          bookmaker: bookTitle,
          bookmakerKey: bookKey,
          overPrice: over.price,
          underPrice: under ? under.price : null,
        });
      }
    }
  }

  return [...byKey.values()];
}

module.exports = {
  SPORT,
  MARKET_TO_STAT,
  DEFAULT_PROP_MARKETS,
  readOddsApiKey,
  isOddsApiConfigured,
  listNcaafEvents,
  fetchEventPlayerProps,
  flattenEventProps,
  teamsLikelyMatch,
  normalizeTeamToken,
};
