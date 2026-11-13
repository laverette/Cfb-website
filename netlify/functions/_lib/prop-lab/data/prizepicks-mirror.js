/**
 * PrizePicks NCAAF line ingest.
 *
 * Primary: partner-api.prizepicks.com (full board — Fantasy Score, Rec/Rush TDs, FG, etc.)
 * Fallback: GitHub mirror (thin subset; excludes most markets).
 * https://github.com/enkday/prizepicks-data-mirror
 */
const { getPropDef } = require("../definitions");
const { dataLog } = require("./log");

const DEFAULT_MIRROR_URL =
  "https://raw.githubusercontent.com/enkday/prizepicks-data-mirror/main/data/prizepicks-ncaaf.json";
const DEFAULT_PARTNER_URL =
  "https://partner-api.prizepicks.com/projections?league_id=15&per_page=250";
/** PrizePicks CFB / NCAAF league id on partner-api */
const NCAAF_LEAGUE_ID = 15;

/** PrizePicks board labels → Prop Lab stat ids */
const STAT_ALIASES = {
  "pass yards": "pass_yds",
  "passing yards": "pass_yds",
  "pass yds": "pass_yds",
  "pass attempts": "pass_att",
  "passing attempts": "pass_att",
  completions: "pass_comp",
  "pass completions": "pass_comp",
  "passing completions": "pass_comp",
  "passing tds": "pass_td",
  "pass tds": "pass_td",
  "pass td": "pass_td",
  "passing touchdowns": "pass_td",
  interceptions: "pass_int",
  ints: "pass_int",
  int: "pass_int",
  "pass int": "pass_int",
  "pass ints": "pass_int",
  "passing interceptions": "pass_int",
  "interceptions thrown": "pass_int",
  "longest completion": "pass_long",
  "longest pass": "pass_long",
  "rush yards": "rush_yds",
  "rushing yards": "rush_yds",
  "rush yds": "rush_yds",
  "rush attempts": "rush_att",
  "rushing attempts": "rush_att",
  carries: "rush_att",
  "rush tds": "rush_td",
  "rushing tds": "rush_td",
  "rush td": "rush_td",
  "rushing touchdowns": "rush_td",
  "longest rush": "rush_long",
  "rec yards": "rec_yds",
  "rec yds": "rec_yds",
  "receiving yards": "rec_yds",
  "receiving yds": "rec_yds",
  receptions: "rec",
  "rec tds": "rec_td",
  "rec td": "rec_td",
  "receiving tds": "rec_td",
  "receiving td": "rec_td",
  "receiving touchdowns": "rec_td",
  "longest reception": "rec_long",
  "rush+rec yards": "rush_rec_yds",
  "rush+rec yds": "rush_rec_yds",
  "rush + rec yards": "rush_rec_yds",
  "rush + rec yds": "rush_rec_yds",
  "rush + receiving yards": "rush_rec_yds",
  "rush+receiving yards": "rush_rec_yds",
  "rush+receiving yds": "rush_rec_yds",
  "pass+rush yards": "pass_rush_yds",
  "pass+rush yds": "pass_rush_yds",
  "pass + rush yards": "pass_rush_yds",
  "pass + rush yds": "pass_rush_yds",
  "total touchdowns": "total_td",
  "total tds": "total_td",
  "anytime tds": "total_td",
  "anytime td": "total_td",
  "player touchdowns": "total_td",
  "player tds": "total_td",
  "fantasy score": "fantasy_score",
  "fantasy pts": "fantasy_score",
  "fantasy points": "fantasy_score",
  "field goals": "fg_made",
  "fg made": "fg_made",
  "kicking points": "kicking_pts",
  "kicker points": "kicking_pts",
  "pats made": "xp_made",
  "pat made": "xp_made",
  "xp made": "xp_made",
  "extra points": "xp_made",
  "extra points made": "xp_made",
};

const MASCOT_SUFFIX =
  /\s+(Flames|Bearkats|Tigers|Bulldogs|Wildcats|Crimson Tide|Volunteers|Gators|Seminoles|Hurricanes|Sooners|Longhorns|Aggies|Cowboys|Sooners|Bears|Cougars|Mustangs|Rebels|Razorbacks|Gamecocks|Tar Heels|Blue Devils|Demon Deacons|Yellow Jackets|Hokies|Cavaliers|Terrapins|Nittany Lions|Buckeyes|Wolverines|Spartans|Fighting Irish|Trojans|Bruins|Ducks|Beavers|Huskies|Cougars|Utes|Buffaloes|Sun Devils|Wildcats|Cardinal|Cardinals|Eagles|Owls|Panthers|Mountaineers|Thundering Herd|Mean Green|Golden Hurricane|Red Raiders|Horned Frogs|Cyclones|Jayhawks|Cornhuskers|Badgers|Hawkeyes|Golden Gophers|Boilermakers|Hoosiers|Illini|Fighting Illini|Scarlet Knights|Orange|Orange|Knights|Wave|Green Wave|Commodores|Midshipmen|Black Knights|Falcons|Rams|Lobos|Aztecs|Wolf Pack|Rainbow Warriors|Warriors|Miners|Roadrunners|Bobcats|Bearkats|Jaguars|Blazers|Hilltoppers|Racers|Governors|Skyhawks|Chattanooga|Dukes|Spiders|Paladins|Catamounts|Seahawks|Pirates|49ers|Niners|Gaels|Broncos|Ragin Cajuns|Cajuns|Salukis|Redbirds|Sycamores|Penguins|Zips|Rockets|Flashes|Chippewas|Bulls|Rams|Colonels|Thundering Herd)\s*$/i;

const PARTNER_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  origin: "https://app.prizepicks.com",
  referer: "https://app.prizepicks.com/",
};

function mirrorUrl() {
  return (
    String(process.env.PRIZEPICKS_MIRROR_URL || "").trim() || DEFAULT_MIRROR_URL
  );
}

function partnerUrl() {
  return (
    String(process.env.PRIZEPICKS_PARTNER_URL || "").trim() || DEFAULT_PARTNER_URL
  );
}

function preferMirrorOnly() {
  const v = String(process.env.PRIZEPICKS_SOURCE || "")
    .trim()
    .toLowerCase();
  return v === "mirror" || v === "github";
}

function normalizeStatKey(stat) {
  return String(stat || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapPrizePicksStat(stat) {
  const key = normalizeStatKey(stat);
  const id = STAT_ALIASES[key] || null;
  if (!id) return null;
  return getPropDef(id) ? id : null;
}

/** "Liberty Flames" → "Liberty" when a known mascot suffix is present. */
function cleanTeamName(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const stripped = s.replace(MASCOT_SUFFIX, "").trim();
  return stripped || s;
}

function scrapeHash(payload) {
  const scrapedAt =
    payload?.scrapedAt ||
    payload?.collectionStatus?.providerFetchedAt ||
    payload?.fetchedAt ||
    "";
  const count = payload?.totalProps ?? payload?.props?.length ?? 0;
  return `${scrapedAt}|${count}`;
}

function normalizeOddsType(oddsType) {
  return String(oddsType || "standard")
    .trim()
    .toLowerCase();
}

/** Base PrizePicks offering (not goblin/discounted, not demon/elevated). */
function isBaseOddsType(oddsType) {
  const o = normalizeOddsType(oddsType);
  return o === "standard" || o === "normal" || o === "default" || o === "";
}

function oddsRank(oddsType) {
  const o = normalizeOddsType(oddsType);
  if (isBaseOddsType(o)) return 0;
  if (o === "demon") return 1;
  if (o === "goblin") return 2;
  return 9;
}

function playerStatKey(row) {
  const sid = row.statId || normalizeStatKey(row.stat);
  return `${String(row.playerName || "")
    .toLowerCase()}|${String(row.team || row.teamCode || "")
    .toLowerCase()}|${sid}`;
}

/**
 * Week-board grading: one base (standard) line per player+stat.
 * Drop goblin/discounted and demon/elevated variants entirely — even when no
 * standard line exists for that player+stat.
 */
function selectBoardProps(rows) {
  const byPlayerStat = new Map();
  for (const row of rows || []) {
    if (!isBaseOddsType(row.oddsType)) continue;
    const key = playerStatKey(row);
    if (!byPlayerStat.has(key)) byPlayerStat.set(key, []);
    byPlayerStat.get(key).push(row);
  }
  const out = [];
  for (const group of byPlayerStat.values()) {
    const sorted = group.slice().sort((a, b) => {
      const od = oddsRank(a.oddsType) - oddsRank(b.oddsType);
      if (od) return od;
      return (a.rank ?? 9999) - (b.rank ?? 9999);
    });
    if (sorted[0]) out.push(sorted[0]);
  }
  return out;
}

function normalizeMirrorRows(rows, skipped) {
  const supported = [];
  for (const row of rows) {
    const statId = mapPrizePicksStat(row.stat);
    if (!statId) {
      const k = normalizeStatKey(row.stat) || "unknown";
      skipped[k] = (skipped[k] || 0) + 1;
      continue;
    }
    const line = Number(row.line);
    if (!Number.isFinite(line)) {
      skipped.bad_line = (skipped.bad_line || 0) + 1;
      continue;
    }
    if (String(row.status || "").toLowerCase() === "suspended") continue;
    supported.push({
      projectionId: String(row.projectionId || row.id || ""),
      prizePicksPlayerId: row.playerId != null ? String(row.playerId) : null,
      playerName: String(row.player || "").trim(),
      team: cleanTeamName(row.Team || row.team),
      teamRaw: row.Team || row.team || null,
      teamCode: row.teamCode || null,
      opponent: cleanTeamName(row.Opponent || row.opponent),
      opponentRaw: row.Opponent || row.opponent || null,
      opponentCode: row.opponentCode || null,
      stat: row.stat,
      statId,
      line,
      startTimeIso: row.startTimeIso || null,
      startDateCST: row.startDateCST || null,
      gameId: row.gameId != null ? String(row.gameId) : null,
      oddsType: row.oddsType || "standard",
      allowedWagerTypes: row.allowedWagerTypes || row.allowed_wager_types || null,
      status: row.status || null,
      rank: row.rank ?? null,
    });
  }
  return supported;
}

function opponentFromGame(game, playerTeamCode) {
  if (!game?.attributes) return { name: null, code: null };
  const meta = game.attributes.metadata?.game_info?.teams || {};
  const away = meta.away?.abbreviation || null;
  const home = meta.home?.abbreviation || null;
  const code = String(playerTeamCode || "").toUpperCase();
  if (code && away && home) {
    if (code === String(away).toUpperCase()) {
      return { name: home, code: home };
    }
    if (code === String(home).toUpperCase()) {
      return { name: away, code: away };
    }
  }
  // description on projection is often the opponent abbreviation
  return { name: null, code: null };
}

/**
 * Parse partner-api JSON:API projections into mirror-shaped rows.
 */
function parsePartnerPayload(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const byTypeId = new Map();
  for (const inc of included) {
    if (inc?.type && inc?.id != null) byTypeId.set(`${inc.type}:${inc.id}`, inc);
  }
  const skipped = Object.create(null);
  const rows = [];
  for (const proj of data) {
    const attrs = proj.attributes || {};
    const oddsType = String(attrs.odds_type || "standard").toLowerCase();
    const statRel = proj.relationships?.stat_type?.data;
    const playerRel = proj.relationships?.new_player?.data;
    const gameRel = proj.relationships?.game?.data;
    const statInc = statRel ? byTypeId.get(`stat_type:${statRel.id}`) : null;
    const playerInc = playerRel ? byTypeId.get(`new_player:${playerRel.id}`) : null;
    const gameInc = gameRel ? byTypeId.get(`game:${gameRel.id}`) : null;
    const statName = statInc?.attributes?.name || null;
    const statId = mapPrizePicksStat(statName);
    if (!statId) {
      const k = normalizeStatKey(statName) || "unknown";
      skipped[k] = (skipped[k] || 0) + 1;
      continue;
    }
    const line = Number(attrs.line_score ?? attrs.line);
    if (!Number.isFinite(line)) {
      skipped.bad_line = (skipped.bad_line || 0) + 1;
      continue;
    }
    const status = attrs.status || attrs.odds_type_status || null;
    if (String(status || "").toLowerCase() === "suspended") {
      skipped.suspended = (skipped.suspended || 0) + 1;
      continue;
    }
    if (!String(proj.id || "").trim()) {
      skipped.empty_projection_id = (skipped.empty_projection_id || 0) + 1;
      continue;
    }

    const playerAttrs = playerInc?.attributes || {};
    const playerName = String(playerAttrs.display_name || playerAttrs.name || "").trim();
    const teamCode = playerAttrs.team || null;
    const teamName =
      cleanTeamName(playerAttrs.market) ||
      cleanTeamName(playerAttrs.team_name) ||
      teamCode;
    const oppFromDesc = attrs.description ? String(attrs.description).trim() : null;
    const oppGame = opponentFromGame(gameInc, teamCode);
    const opponentCode = oppGame.code || oppFromDesc || null;
    const opponent =
      cleanTeamName(oppGame.name) ||
      (oppFromDesc && oppFromDesc.length > 3 ? cleanTeamName(oppFromDesc) : oppFromDesc);
    const allowedWagerTypes = attrs.allowed_wager_types || null;

    rows.push({
      projectionId: String(proj.id || ""),
      prizePicksPlayerId: playerRel?.id != null ? String(playerRel.id) : null,
      playerName,
      team: teamName,
      teamRaw: playerAttrs.market || playerAttrs.team_name || null,
      teamCode,
      opponent,
      opponentRaw: opponent,
      opponentCode,
      stat: statName,
      statId,
      line,
      startTimeIso: attrs.start_time || gameInc?.attributes?.start_time || null,
      startDateCST: null,
      gameId: gameRel?.id != null ? String(gameRel.id) : null,
      oddsType,
      allowedWagerTypes,
      status,
      rank: statInc?.attributes?.rank ?? attrs.rank ?? null,
    });
  }
  return { rows, skipped, total: data.length };
}

/**
 * Normalize a partner-api JSON:API payload into the board shape used by week scoring.
 * Used by server fetch and by browser-assisted ingest (Netlify egress often blocked).
 */
function boardFromPartnerPayload(payload, { source = "partner", sourceUrl = null } = {}) {
  const parsed = parsePartnerPayload(payload);
  const selected = selectBoardProps(parsed.rows);
  const fetchedAt = new Date().toISOString();
  const endpoint = sourceUrl || partnerUrl();
  dataLog(
    "PrizePicksMirror",
    `Partner payload ${selected.length} selected / ${parsed.rows.length} mapped / ${parsed.total} raw (${source})`
  );
  return {
    scrapedAt: fetchedAt,
    scrapedDate: fetchedAt.slice(0, 10),
    scrapeHash: `${fetchedAt}|${source}|${selected.length}`,
    totalProps: parsed.total,
    supportedCount: selected.length,
    skipped: parsed.skipped,
    props: selected,
    sourceUrl: endpoint,
    source,
  };
}

function mergePartnerPages(pages) {
  const data = [];
  const includedByKey = new Map();
  for (const payload of pages) {
    for (const row of payload?.data || []) data.push(row);
    for (const inc of payload?.included || []) {
      if (inc?.type && inc?.id != null) includedByKey.set(`${inc.type}:${inc.id}`, inc);
    }
  }
  return { data, included: [...includedByKey.values()] };
}

/**
 * Fetch all partner-api pages (per_page=250). Single-page boards are common;
 * still follow meta.total_pages when the slate grows.
 */
async function fetchPartnerPayload({ signal } = {}) {
  const endpoint = partnerUrl();
  const pages = [];
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;
  while (page <= totalPages && page <= maxPages) {
    const url = new URL(endpoint);
    if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "250");
    url.searchParams.set("page", String(page));
    const resp = await fetch(url.toString(), {
      headers: PARTNER_HEADERS,
      signal,
    });
    if (!resp.ok) {
      const err = new Error(`PrizePicks partner API failed (${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    const payload = await resp.json();
    pages.push(payload);
    const metaPages = Number(payload?.meta?.total_pages);
    totalPages = Number.isFinite(metaPages) && metaPages > 0 ? metaPages : 1;
    page += 1;
  }
  return {
    payload: mergePartnerPages(pages),
    sourceUrl: endpoint,
    pagesFetched: pages.length,
  };
}

async function fetchFromPartner({ signal } = {}) {
  const { payload, sourceUrl, pagesFetched } = await fetchPartnerPayload({ signal });
  dataLog("PrizePicksMirror", `Partner fetch ${pagesFetched} page(s)`);
  return boardFromPartnerPayload(payload, { source: "partner", sourceUrl });
}

async function fetchFromMirror({ signal, url } = {}) {
  const endpoint = url || mirrorUrl();
  const resp = await fetch(endpoint, {
    headers: { accept: "application/json", "user-agent": "cfb-prop-lab/1.0" },
    signal,
  });
  if (!resp.ok) {
    const err = new Error(`PrizePicks mirror failed (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  const payload = await resp.json();
  const rows = Array.isArray(payload?.props) ? payload.props : [];
  const skipped = Object.create(null);
  const supported = selectBoardProps(normalizeMirrorRows(rows, skipped));
  dataLog(
    "PrizePicksMirror",
    `Loaded ${supported.length}/${rows.length} supported props from ${endpoint}`
  );
  return {
    scrapedAt: payload?.scrapedAt || null,
    scrapedDate: payload?.scrapedDate || null,
    scrapeHash: scrapeHash({ ...payload, props: supported, totalProps: supported.length }),
    totalProps: rows.length,
    supportedCount: supported.length,
    skipped,
    props: supported,
    sourceUrl: endpoint,
    source: "mirror",
  };
}

/**
 * Fetch + normalize supported NCAAF props (partner API, mirror fallback).
 * @param {{ signal?: AbortSignal, url?: string, allowMirrorFallback?: boolean }} [opts]
 */
async function fetchPrizePicksNcaaf({
  signal,
  url,
  allowMirrorFallback = true,
} = {}) {
  // Explicit mirror URL override keeps old path for debugging.
  if (url) return fetchFromMirror({ signal, url });
  if (preferMirrorOnly()) return fetchFromMirror({ signal });

  try {
    return await fetchFromPartner({ signal });
  } catch (err) {
    dataLog(
      "PrizePicksMirror",
      `Partner API failed (${err.message}) — ${
        allowMirrorFallback ? "falling back to GitHub mirror" : "no fallback"
      }`
    );
    if (!allowMirrorFallback) throw err;
    return fetchFromMirror({ signal });
  }
}

/**
 * Scoring targets: one base line per player+stat. Goblin/demon rows are dropped.
 */
function uniqueEvalTargets(props) {
  const seen = new Set();
  const out = [];
  const sorted = (props || [])
    .filter((p) => isBaseOddsType(p.oddsType))
    .slice()
    .sort((a, b) => {
      const od = oddsRank(a.oddsType) - oddsRank(b.oddsType);
      if (od) return od;
      return (a.rank ?? 9999) - (b.rank ?? 9999);
    });
  for (const p of sorted) {
    const key = playerStatKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

module.exports = {
  DEFAULT_MIRROR_URL,
  DEFAULT_PARTNER_URL,
  NCAAF_LEAGUE_ID,
  STAT_ALIASES,
  mapPrizePicksStat,
  cleanTeamName,
  fetchPrizePicksNcaaf,
  boardFromPartnerPayload,
  uniqueEvalTargets,
  selectBoardProps,
  isBaseOddsType,
  mirrorUrl,
  partnerUrl,
};
