/**
 * PrizePicks NCAAF line ingest from the public GitHub data mirror.
 * https://github.com/enkday/prizepicks-data-mirror
 */
const { getPropDef } = require("../definitions");
const { dataLog } = require("./log");

const DEFAULT_MIRROR_URL =
  "https://raw.githubusercontent.com/enkday/prizepicks-data-mirror/main/data/prizepicks-ncaaf.json";

/** PrizePicks board labels → Prop Lab stat ids */
const STAT_ALIASES = {
  "pass yards": "pass_yds",
  "passing yards": "pass_yds",
  "pass yds": "pass_yds",
  "pass attempts": "pass_att",
  "passing attempts": "pass_att",
  completions: "pass_comp",
  "pass completions": "pass_comp",
  "passing tds": "pass_td",
  "pass tds": "pass_td",
  "pass td": "pass_td",
  interceptions: "pass_int",
  ints: "pass_int",
  "longest completion": "pass_long",
  "longest pass": "pass_long",
  "rush yards": "rush_yds",
  "rushing yards": "rush_yds",
  "rush yds": "rush_yds",
  "rush attempts": "rush_att",
  "rushing attempts": "rush_att",
  "rush tds": "rush_td",
  "rushing tds": "rush_td",
  "rush td": "rush_td",
  "longest rush": "rush_long",
  "rec yards": "rec_yds",
  "receiving yards": "rec_yds",
  "receiving yds": "rec_yds",
  receptions: "rec",
  "rec tds": "rec_td",
  "receiving tds": "rec_td",
  "receiving td": "rec_td",
  "longest reception": "rec_long",
  "rush+rec yards": "rush_rec_yds",
  "rush + rec yards": "rush_rec_yds",
  "rush + receiving yards": "rush_rec_yds",
  "pass+rush yards": "pass_rush_yds",
  "pass + rush yards": "pass_rush_yds",
  "total touchdowns": "total_td",
  "total tds": "total_td",
  "fantasy score": "fantasy_score",
  "fantasy pts": "fantasy_score",
  "fantasy points": "fantasy_score",
  "field goals": "fg_made",
  "fg made": "fg_made",
  "kicking points": "kicking_pts",
  "kicker points": "kicking_pts",
  "pats made": "xp_made",
  "extra points": "xp_made",
};

const MASCOT_SUFFIX =
  /\s+(Flames|Bearkats|Tigers|Bulldogs|Wildcats|Crimson Tide|Volunteers|Gators|Seminoles|Hurricanes|Sooners|Longhorns|Aggies|Cowboys|Sooners|Bears|Cougars|Mustangs|Rebels|Razorbacks|Gamecocks|Tar Heels|Blue Devils|Demon Deacons|Yellow Jackets|Hokies|Cavaliers|Terrapins|Nittany Lions|Buckeyes|Wolverines|Spartans|Fighting Irish|Trojans|Bruins|Ducks|Beavers|Huskies|Cougars|Utes|Buffaloes|Sun Devils|Wildcats|Cardinal|Cardinals|Eagles|Owls|Panthers|Mountaineers|Thundering Herd|Mean Green|Golden Hurricane|Red Raiders|Horned Frogs|Cyclones|Jayhawks|Cornhuskers|Badgers|Hawkeyes|Golden Gophers|Boilermakers|Hoosiers|Illini|Fighting Illini|Scarlet Knights|Orange|Orange|Knights|Wave|Green Wave|Commodores|Midshipmen|Black Knights|Falcons|Rams|Lobos|Aztecs|Wolf Pack|Rainbow Warriors|Warriors|Miners|Roadrunners|Bobcats|Bearkats|Jaguars|Blazers|Hilltoppers|Racers|Governors|Skyhawks|Chattanooga|Dukes|Spiders|Paladins|Catamounts|Seahawks|Pirates|49ers|Niners|Gaels|Broncos|Ragin Cajuns|Cajuns|Salukis|Redbirds|Sycamores|Penguins|Zips|Rockets|Flashes|Chippewas|Bulls|Rams|Colonels|Thundering Herd)\s*$/i;

function mirrorUrl() {
  return (
    String(process.env.PRIZEPICKS_MIRROR_URL || "").trim() || DEFAULT_MIRROR_URL
  );
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
  const scrapedAt = payload?.scrapedAt || payload?.collectionStatus?.providerFetchedAt || "";
  const count = payload?.totalProps ?? payload?.props?.length ?? 0;
  return `${scrapedAt}|${count}`;
}

/**
 * Fetch + normalize supported NCAAF props from the mirror.
 */
async function fetchPrizePicksNcaaf({ signal, url } = {}) {
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
  const supported = [];
  const skipped = Object.create(null);
  for (const row of rows) {
    const statId = mapPrizePicksStat(row.stat);
    if (!statId) {
      const k = normalizeStatKey(row.stat) || "unknown";
      skipped[k] = (skipped[k] || 0) + 1;
      continue;
    }
    const line = Number(row.line);
    if (!Number.isFinite(line)) {
      skipped["bad_line"] = (skipped["bad_line"] || 0) + 1;
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
      status: row.status || null,
      rank: row.rank ?? null,
    });
  }
  dataLog(
    "PrizePicksMirror",
    `Loaded ${supported.length}/${rows.length} supported props from ${endpoint}`
  );
  return {
    scrapedAt: payload?.scrapedAt || null,
    scrapedDate: payload?.scrapedDate || null,
    scrapeHash: scrapeHash(payload),
    totalProps: rows.length,
    supportedCount: supported.length,
    skipped,
    props: supported,
    sourceUrl: endpoint,
  };
}

/**
 * Deduplicate to one row per player+team+stat+line (keep first / lowest rank).
 */
function uniqueEvalTargets(props) {
  const seen = new Set();
  const out = [];
  const sorted = (props || []).slice().sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  for (const p of sorted) {
    const key = `${p.playerName}|${p.team}|${p.statId}|${p.line}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

module.exports = {
  DEFAULT_MIRROR_URL,
  STAT_ALIASES,
  mapPrizePicksStat,
  cleanTeamName,
  fetchPrizePicksNcaaf,
  uniqueEvalTargets,
  mirrorUrl,
};
