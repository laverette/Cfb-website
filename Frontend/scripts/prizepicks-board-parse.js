/**
 * Browser-side PrizePicks partner JSON:API → slim board props.
 * Keeps the normalize POST under Netlify body limits (chunked stash).
 * Mirrors netlify/functions/_lib/prop-lab/data/prizepicks-mirror.js logic.
 */
(function (global) {
  "use strict";

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

  function normalizeStatKey(stat) {
    return String(stat || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function mapPrizePicksStat(stat) {
    return STAT_ALIASES[normalizeStatKey(stat)] || null;
  }

  function cleanTeamName(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const stripped = s.replace(MASCOT_SUFFIX, "").trim();
    return stripped || s;
  }

  function oddsRank(oddsType) {
    const o = String(oddsType || "standard").toLowerCase();
    if (o === "standard") return 0;
    if (o === "demon") return 1;
    if (o === "goblin") return 2;
    return 9;
  }

  /**
   * Keep every distinct line; prefer standard > demon > goblin for duplicates.
   * Group per player+stat+line so demon-only players are not dropped.
   */
  function selectBoardProps(rows) {
    const byPlayerStatLine = new Map();
    for (const row of rows) {
      const sid = row.statId || normalizeStatKey(row.stat);
      const key = `${String(row.playerName || "")
        .toLowerCase()}|${String(row.team || row.teamCode || "")
        .toLowerCase()}|${sid}|${Number(row.line)}`;
      if (!byPlayerStatLine.has(key)) byPlayerStatLine.set(key, []);
      byPlayerStatLine.get(key).push(row);
    }
    const out = [];
    for (const group of byPlayerStatLine.values()) {
      const sorted = group.slice().sort((a, b) => {
        const od = oddsRank(a.oddsType) - oddsRank(b.oddsType);
        if (od) return od;
        return (a.rank ?? 9999) - (b.rank ?? 9999);
      });
      if (sorted[0]) out.push(sorted[0]);
    }
    return out;
  }

  function uniqueEvalTargets(props) {
    const seenLine = new Set();
    const out = [];
    const sorted = (props || []).slice().sort((a, b) => {
      const od = oddsRank(a.oddsType) - oddsRank(b.oddsType);
      if (od) return od;
      return (a.rank ?? 9999) - (b.rank ?? 9999);
    });
    for (const p of sorted) {
      const lineKey = `${p.playerName}|${p.team}|${p.statId}|${p.line}`.toLowerCase();
      if (seenLine.has(lineKey)) continue;
      seenLine.add(lineKey);
      out.push(p);
    }
    return out;
  }

  function opponentFromGame(game, playerTeamCode) {
    if (!game?.attributes) return { name: null, code: null };
    const meta = game.attributes.metadata?.game_info?.teams || {};
    const away = meta.away?.abbreviation || null;
    const home = meta.home?.abbreviation || null;
    const code = String(playerTeamCode || "").toUpperCase();
    if (code && away && home) {
      if (code === String(away).toUpperCase()) return { name: home, code: home };
      if (code === String(home).toUpperCase()) return { name: away, code: away };
    }
    return { name: null, code: null };
  }

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
        teamCode,
        opponent,
        opponentCode,
        stat: statName,
        statId,
        line,
        startTimeIso: attrs.start_time || gameInc?.attributes?.start_time || null,
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
   * @param {object} payload partner-api JSON:API body
   * @param {{ source?: string, sourceUrl?: string }} [opts]
   */
  function boardFromPartnerPayload(payload, opts) {
    const source = opts?.source || "browser-partner";
    const sourceUrl =
      opts?.sourceUrl ||
      "https://partner-api.prizepicks.com/projections?league_id=15&per_page=250";
    const parsed = parsePartnerPayload(payload);
    const selected = uniqueEvalTargets(selectBoardProps(parsed.rows));
    const fetchedAt = new Date().toISOString();
    return {
      scrapedAt: fetchedAt,
      scrapedDate: fetchedAt.slice(0, 10),
      scrapeHash: `${fetchedAt}|${source}|${selected.length}`,
      totalProps: parsed.total,
      supportedCount: selected.length,
      skipped: parsed.skipped,
      props: selected,
      sourceUrl,
      source,
    };
  }

  global.PrizePicksBoard = {
    boardFromPartnerPayload,
    uniqueEvalTargets,
    selectBoardProps,
    mapPrizePicksStat,
  };
})(typeof window !== "undefined" ? window : globalThis);
