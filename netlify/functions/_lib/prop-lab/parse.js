const { toNum } = require("./math");
const { sameTeam, playerNameMatch } = require("./names");
const { getPropDef } = require("./definitions");

function pick(obj, ...keys) {
  if (!obj) return null;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

function categoriesFrom(overview) {
  if (!overview) return [];
  const box = pick(overview, "boxScoreStats", "box_score_stats") || {};
  const cats = pick(box, "categories") || [];
  return Array.isArray(cats) ? cats : [];
}

function flattenOverview(overview) {
  const out = {};
  for (const cat of categoriesFrom(overview)) {
    const catName = String(cat.name || cat.category || "").toLowerCase();
    for (const st of cat.stats || []) {
      const type = String(st.stat || st.name || st.abbreviation || "")
        .toUpperCase()
        .replace(/\s+/g, "");
      const rawVal = st.value ?? st.stat;
      const val = toNum(rawVal);
      const pair = val == null ? parseMadeAttempted(rawVal) : null;
      if (!catName || !type) continue;
      if (val != null) out[`${catName}:${type}`] = val;
      else if (pair) {
        out[`${catName}:${type}`] = pair.made;
        out[`${catName}:${type}_ATT`] = pair.att;
      }
    }
  }
  return out;
}

const TYPE_ALIASES = {
  YDS: "yds",
  YARDS: "yds",
  TD: "td",
  TDS: "td",
  ATT: "att",
  ATTEMPTS: "att",
  CAR: "att",
  COMP: "comp",
  COMPLETIONS: "comp",
  CMP: "comp",
  "C/ATT": "c/att",
  "CMP/ATT": "c/att",
  "COMP/ATT": "c/att",
  "C-ATT": "c/att",
  INT: "int",
  INTS: "int",
  REC: "rec",
  RECEPTIONS: "rec",
  AVG: "avg",
  LONG: "long",
  LNG: "long",
  FGM: "fgm",
  FGA: "fga",
  FG: "fg",
  XPM: "xpm",
  XPA: "xpa",
  XP: "xp",
  PAT: "xp",
  PTS: "pts",
  POINTS: "pts",
};

/** ESPN/CFBD kicking often stores FG/XP as "2-3" or "2/3". */
function parseMadeAttempted(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (!m) return null;
  return { made: Number(m[1]), att: Number(m[2]) };
}

function flattenPlayerBox(categories) {
  const out = {};
  for (const cat of categories || []) {
    const catName = String(cat.name || "").toLowerCase();
    for (const type of cat.types || []) {
      const raw = String(type.name || "").toUpperCase().replace(/\s+/g, "");
      const key = TYPE_ALIASES[raw] || raw.toLowerCase();
      const athletes = type.athletes || [];
      out[`__cat:${catName}:${key}`] = athletes;
    }
  }
  return out;
}

function athleteStat(categories, playerId, playerName, category, typeKey) {
  for (const cat of categories || []) {
    if (String(cat.name || "").toLowerCase() !== category) continue;
    for (const type of cat.types || []) {
      const raw = String(type.name || "").toUpperCase().replace(/\s+/g, "");
      const key = TYPE_ALIASES[raw] || raw.toLowerCase();
      if (key !== typeKey) continue;
      for (const ath of type.athletes || []) {
        const idOk = playerId && String(ath.id) === String(playerId);
        const nameOk = playerName && playerNameMatch(ath.name, playerName);
        if (idOk || nameOk) return toNum(ath.stat);
      }
    }
  }
  return null;
}

function athleteRawStat(categories, playerId, playerName, category, typeKey) {
  for (const cat of categories || []) {
    if (String(cat.name || "").toLowerCase() !== category) continue;
    for (const type of cat.types || []) {
      const raw = String(type.name || "").toUpperCase().replace(/\s+/g, "");
      const key = TYPE_ALIASES[raw] || raw.toLowerCase();
      if (key !== typeKey) continue;
      for (const ath of type.athletes || []) {
        const idOk = playerId && String(ath.id) === String(playerId);
        const nameOk = playerName && playerNameMatch(ath.name, playerName);
        if (idOk || nameOk) return ath.stat ?? ath.value ?? null;
      }
    }
  }
  return null;
}

function kickingFromBox(categories, playerId, playerName) {
  const fgm = athleteStat(categories, playerId, playerName, "kicking", "fgm");
  const fga = athleteStat(categories, playerId, playerName, "kicking", "fga");
  const fgPair = parseMadeAttempted(athleteRawStat(categories, playerId, playerName, "kicking", "fg"));
  const xpm = athleteStat(categories, playerId, playerName, "kicking", "xpm");
  const xpPair =
    parseMadeAttempted(athleteRawStat(categories, playerId, playerName, "kicking", "xp")) ||
    parseMadeAttempted(athleteRawStat(categories, playerId, playerName, "kicking", "pat"));
  const pts =
    athleteStat(categories, playerId, playerName, "kicking", "pts") ??
    athleteStat(categories, playerId, playerName, "kicking", "points");

  const fgMade = fgm != null ? fgm : fgPair?.made ?? null;
  const fgAtt = fga != null ? fga : fgPair?.att ?? null;
  const xpMade = xpm != null ? xpm : xpPair?.made ?? null;
  let kickingPts = pts;
  if (kickingPts == null && (fgMade != null || xpMade != null)) {
    kickingPts = (fgMade || 0) * 3 + (xpMade || 0);
  }
  return {
    fg_made: fgMade,
    fg_att: fgAtt,
    xp_made: xpMade,
    kicking_pts: kickingPts,
  };
}

function passingFromBox(categories, playerId, playerName) {
  let comp = athleteStat(categories, playerId, playerName, "passing", "comp");
  let att = athleteStat(categories, playerId, playerName, "passing", "att");
  const pair =
    parseMadeAttempted(athleteRawStat(categories, playerId, playerName, "passing", "c/att")) ||
    parseMadeAttempted(athleteRawStat(categories, playerId, playerName, "passing", "comp"));
  if (comp == null && pair) comp = pair.made;
  if (att == null && pair) att = pair.att;
  return { pass_comp: comp, pass_att: att };
}

function extractGameStats(categories, playerId, playerName) {
  const passing = passingFromBox(categories, playerId, playerName);
  return {
    pass_yds: athleteStat(categories, playerId, playerName, "passing", "yds"),
    pass_td: athleteStat(categories, playerId, playerName, "passing", "td"),
    pass_att: passing.pass_att,
    pass_comp: passing.pass_comp,
    pass_int: athleteStat(categories, playerId, playerName, "passing", "int"),
    rush_yds: athleteStat(categories, playerId, playerName, "rushing", "yds"),
    rush_td: athleteStat(categories, playerId, playerName, "rushing", "td"),
    rush_att: athleteStat(categories, playerId, playerName, "rushing", "att"),
    rush_long: athleteStat(categories, playerId, playerName, "rushing", "long"),
    rec_yds: athleteStat(categories, playerId, playerName, "receiving", "yds"),
    rec_td: athleteStat(categories, playerId, playerName, "receiving", "td"),
    rec: athleteStat(categories, playerId, playerName, "receiving", "rec"),
    ...kickingFromBox(categories, playerId, playerName),
  };
}

function comboValue(stats, id) {
  if (id === "rush_rec_yds") {
    const a = stats.rush_yds;
    const b = stats.rec_yds;
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }
  if (id === "pass_rush_yds") {
    const a = stats.pass_yds;
    const b = stats.rush_yds;
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }
  if (id === "total_td") {
    const a = stats.pass_td;
    const b = stats.rush_td;
    const c = stats.rec_td;
    if (a == null && b == null && c == null) return null;
    return (a || 0) + (b || 0) + (c || 0);
  }
  return stats[id] != null ? stats[id] : null;
}

function extractStatValue(stats, statId) {
  const def = getPropDef(statId);
  if (!def) return null;
  if (def.combo) return comboValue(stats, def.id);
  return stats[def.id] != null ? stats[def.id] : null;
}

function extractOverviewTotal(overview, statId) {
  const flat = flattenOverview(overview);
  const map = {
    pass_yds: ["passing:YDS", "passing:YARDS"],
    pass_att: ["passing:ATT", "passing:ATTEMPTS", "passing:C/ATT_ATT", "passing:CMP/ATT_ATT"],
    pass_comp: ["passing:COMP", "passing:COMPLETIONS", "passing:CMP", "passing:C/ATT", "passing:CMP/ATT"],
    pass_td: ["passing:TD", "passing:TDS"],
    pass_int: ["passing:INT", "passing:INTS"],
    rush_yds: ["rushing:YDS", "rushing:YARDS"],
    rush_att: ["rushing:ATT", "rushing:CAR", "rushing:ATTEMPTS"],
    rush_td: ["rushing:TD", "rushing:TDS"],
    rec_yds: ["receiving:YDS", "receiving:YARDS"],
    rec: ["receiving:REC", "receiving:RECEPTIONS"],
    rec_td: ["receiving:TD", "receiving:TDS"],
    fg_made: ["kicking:FGM", "kicking:FG"],
    kicking_pts: ["kicking:PTS", "kicking:POINTS"],
  };
  if (statId === "kicking_pts") {
    for (const k of map.kicking_pts) {
      if (flat[k] != null) return flat[k];
    }
    const fg = extractOverviewTotal(overview, "fg_made");
    const xp = flat["kicking:XPM"] ?? flat["kicking:XP"] ?? null;
    if (fg == null && xp == null) return null;
    return (fg || 0) * 3 + (xp || 0);
  }
  if (statId === "rush_rec_yds") {
    const a = extractOverviewTotal(overview, "rush_yds");
    const b = extractOverviewTotal(overview, "rec_yds");
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }
  if (statId === "pass_rush_yds") {
    const a = extractOverviewTotal(overview, "pass_yds");
    const b = extractOverviewTotal(overview, "rush_yds");
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }
  if (statId === "total_td") {
    const parts = ["pass_td", "rush_td", "rec_td"].map((id) => extractOverviewTotal(overview, id));
    if (parts.every((x) => x == null)) return null;
    return parts.reduce((s, x) => s + (x || 0), 0);
  }
  const keys = map[statId] || [];
  for (const k of keys) {
    if (flat[k] != null) return flat[k];
  }
  return null;
}

function playerAppeared(categories, playerId, playerName) {
  for (const cat of categories || []) {
    for (const type of cat.types || []) {
      for (const ath of type.athletes || []) {
        if (playerId && String(ath.id) === String(playerId)) return true;
        if (playerName && playerNameMatch(ath.name, playerName)) return true;
      }
    }
  }
  return false;
}

function parsePlayerGameLogs(gamesPlayers, { playerId, playerName, team, scheduleById }) {
  const logs = [];
  if (!Array.isArray(gamesPlayers)) return logs;
  for (const game of gamesPlayers) {
    const gameId = pick(game, "id", "gameId");
    const sched = (scheduleById && gameId != null && scheduleById.get(String(gameId))) || null;
    for (const side of game.teams || []) {
      const school = pick(side, "school", "team", "teamName");
      if (team && school && !sameTeam(school, team)) continue;
      const cats = side.categories || [];
      if (!playerAppeared(cats, playerId, playerName)) continue;
      const stats = extractGameStats(cats, playerId, playerName);
      const oppSide = (game.teams || []).find((t) => t !== side);
      const opponent =
        pick(oppSide, "school", "team") ||
        sched?.opponent ||
        null;
      logs.push({
        gameId,
        week: sched?.week ?? null,
        season: sched?.season ?? null,
        opponent,
        homeAway: pick(side, "homeAway", "home_away") || sched?.homeAway || null,
        points: toNum(pick(side, "points")),
        oppPoints: toNum(pick(oppSide, "points")),
        completed: sched?.completed !== false,
        isFcs: Boolean(sched?.oppIsFcs),
        oppClassification: sched?.oppClassification || null,
        startDate: sched?.startDate || null,
        stats,
      });
    }
  }
  logs.sort((a, b) => (a.week || 0) - (b.week || 0));
  return logs;
}

function parseSchedule(games, team) {
  if (!Array.isArray(games)) return [];
  return games.map((g) => {
    const home = pick(g, "homeTeam", "home_team");
    const away = pick(g, "awayTeam", "away_team");
    const isHome = sameTeam(home, team);
    const opponent = isHome ? away : home;
    const homeClass = String(pick(g, "homeClassification", "home_classification") || "").toLowerCase();
    const awayClass = String(pick(g, "awayClassification", "away_classification") || "").toLowerCase();
    const oppClass = isHome ? awayClass : homeClass;
    return {
      gameId: pick(g, "id"),
      week: toNum(pick(g, "week")),
      season: toNum(pick(g, "season", "year")),
      opponent,
      homeAway: isHome ? "home" : "away",
      completed: Boolean(pick(g, "completed")),
      startDate: pick(g, "startDate", "start_date"),
      homePoints: toNum(pick(g, "homePoints", "home_points")),
      awayPoints: toNum(pick(g, "awayPoints", "away_points")),
      oppClassification: oppClass || null,
      oppIsFcs: oppClass === "fcs" || oppClass === "ii" || oppClass === "iii",
      venue: pick(g, "venue"),
      notes: pick(g, "notes"),
    };
  });
}

function nextUnplayed(schedule, weekHint) {
  const now = Date.now();
  const upcoming = (schedule || [])
    .filter((g) => !g.completed && g.opponent)
    .slice()
    .sort((a, b) => {
      const ta = a.startDate ? Date.parse(a.startDate) : Number.MAX_SAFE_INTEGER;
      const tb = b.startDate ? Date.parse(b.startDate) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  if (weekHint != null) {
    const match = upcoming.find((g) => Number(g.week) === Number(weekHint));
    if (match) return match;
  }
  return (
    upcoming.find((g) => {
      const t = g.startDate ? Date.parse(g.startDate) : NaN;
      return Number.isFinite(t) ? t >= now - 12 * 60 * 60 * 1000 : true;
    }) || upcoming[0] || null
  );
}

function teamStatMap(rows, team) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const t = pick(row, "team", "school");
    if (team && t && !sameTeam(t, team)) continue;
    const cat = String(pick(row, "statName", "stat_name", "category") || "").toLowerCase();
    const val = toNum(pick(row, "statValue", "stat_value", "stat"));
    if (!cat || val == null) continue;
    out[cat] = val;
  }
  return out;
}

function indexTeamSeasonStats(rows) {
  const byTeam = new Map();
  if (!Array.isArray(rows)) return byTeam;
  for (const row of rows) {
    const team = pick(row, "team", "school");
    if (!team) continue;
    const key = String(team).toLowerCase();
    if (!byTeam.has(key)) byTeam.set(key, {});
    const cat = String(pick(row, "statName", "stat_name") || "").toLowerCase();
    const val = toNum(pick(row, "statValue", "stat_value"));
    if (cat && val != null) byTeam.get(key)[cat] = val;
  }
  return byTeam;
}

function pickAdvanced(row) {
  if (!row) return null;
  const off = pick(row, "offense") || {};
  const def = pick(row, "defense") || {};
  return {
    team: pick(row, "team"),
    offense: {
      plays: toNum(pick(off, "plays")),
      ppa: toNum(pick(off, "ppa")),
      successRate: toNum(pick(off, "successRate", "success_rate")),
      explosiveness: toNum(pick(off, "explosiveness")),
      passingPlays: pick(off, "passingPlays", "passing_plays") || {},
      rushingPlays: pick(off, "rushingPlays", "rushing_plays") || {},
      havoc: pick(off, "havoc") || {},
      lineYards: toNum(pick(off, "lineYards", "line_yards")),
      stuffRate: toNum(pick(off, "stuffRate", "stuff_rate")),
      pointsPerOpportunity: toNum(pick(off, "pointsPerOpportunity", "points_per_opportunity")),
      fieldPosition: pick(off, "fieldPosition", "field_position") || {},
    },
    defense: {
      plays: toNum(pick(def, "plays")),
      ppa: toNum(pick(def, "ppa")),
      successRate: toNum(pick(def, "successRate", "success_rate")),
      explosiveness: toNum(pick(def, "explosiveness")),
      passingPlays: pick(def, "passingPlays", "passing_plays") || {},
      rushingPlays: pick(def, "rushingPlays", "rushing_plays") || {},
      havoc: pick(def, "havoc") || {},
      lineYards: toNum(pick(def, "lineYards", "line_yards")),
      stuffRate: toNum(pick(def, "stuffRate", "stuff_rate")),
      pointsPerOpportunity: toNum(pick(def, "pointsPerOpportunity", "points_per_opportunity")),
    },
  };
}

function indexAdvanced(rows) {
  const byTeam = new Map();
  if (!Array.isArray(rows)) return byTeam;
  for (const row of rows) {
    const parsed = pickAdvanced(row);
    if (parsed?.team) byTeam.set(String(parsed.team).toLowerCase(), parsed);
  }
  return byTeam;
}

function lookupTeamMap(map, team) {
  if (!map || !team) return null;
  const direct = map.get(String(team).toLowerCase());
  if (direct) return direct;
  for (const [k, v] of map.entries()) {
    if (sameTeam(k, team)) return v;
  }
  return null;
}

module.exports = {
  pick,
  categoriesFrom,
  flattenOverview,
  flattenPlayerBox,
  extractGameStats,
  extractStatValue,
  extractOverviewTotal,
  parseMadeAttempted,
  parsePlayerGameLogs,
  parseSchedule,
  nextUnplayed,
  teamStatMap,
  indexTeamSeasonStats,
  indexAdvanced,
  lookupTeamMap,
  playerAppeared,
};
