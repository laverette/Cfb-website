/**
 * ESPN → Prop Lab normalized parsers.
 * Identify statistics by name/label/key — never by fixed array indexes alone.
 */

const { toNum } = require("../../math");
const { sameTeam, aliasTeam, normalizeTeam } = require("../../names");
const {
  emptyStats,
  parseStatNumber,
  parseCompAtt,
  normalizePlayerName,
} = require("../game-key");

const ESPN_NAME_TO_STAT = {
  completions: "pass_comp",
  passingattempts: "pass_att",
  passingyards: "pass_yds",
  passingtouchdowns: "pass_td",
  interceptions: "pass_int",
  longpassing: "pass_long",
  rushingattempts: "rush_att",
  rushingyards: "rush_yds",
  rushingtouchdowns: "rush_td",
  longrushing: "rush_long",
  receptions: "rec",
  receivingyards: "rec_yds",
  receivingtouchdowns: "rec_td",
  longreception: "rec_long",
  receivingtargets: "targets",
  targets: "targets",
  fieldgoalsmade: "fg_made",
  fieldgoalsattempted: "fg_att",
  extrapointsmade: "xp_made",
  kickingpoints: "kicking_pts",
  totalpoints: "kicking_pts",
};

const ESPN_LABEL_TO_STAT = {
  // Contextual — only used within a known category.
};

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function schoolFromEspnTeam(team) {
  if (!team) return null;
  return (
    team.location ||
    team.shortDisplayName ||
    stripTrailingMascot(team.displayName || team.name) ||
    team.displayName ||
    team.name ||
    null
  );
}

function stripTrailingMascot(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  if (parts.length < 3) return raw;
  // "Georgia State Panthers" → "Georgia State"; "Penn State Nittany Lions" → "Penn State"
  if (parts.length >= 4) return parts.slice(0, 2).join(" ");
  return parts.slice(0, -1).join(" ");
}

function mapNamedStats(names, values) {
  const stats = emptyStats();
  const n = Math.min(names.length, values.length);
  for (let i = 0; i < n; i += 1) {
    const key = normKey(names[i]);
    const mapped = ESPN_NAME_TO_STAT[key];
    if (!mapped) continue;
    if (mapped === "targets") continue; // not in Prop Lab game log shape; reserved
    const val = parseStatNumber(values[i]);
    if (val != null) stats[mapped] = val;
  }
  // Completions/attempts sometimes arrive as a single "C/ATT" style field.
  for (let i = 0; i < n; i += 1) {
    const key = normKey(names[i]);
    if (key === "completionspassingattempts" || key.includes("completions") && key.includes("attempt")) {
      const pair = parseCompAtt(values[i]);
      if (pair) {
        if (stats.pass_comp == null) stats.pass_comp = pair.comp;
        if (stats.pass_att == null) stats.pass_att = pair.att;
      }
    }
  }
  return stats;
}

function mapCategoryStats(category, values) {
  const stats = emptyStats();
  const keys = category.keys || [];
  const labels = category.labels || [];
  const names = category.names || [];
  const catName = normKey(category.name || category.displayName || "");

  const resolveIndex = (i) => {
    const candidates = [keys[i], names[i], labels[i]].map(normKey).filter(Boolean);
    for (const c of candidates) {
      if (ESPN_NAME_TO_STAT[c]) return ESPN_NAME_TO_STAT[c];
    }
    // Label shortcuts within category context.
    const label = normKey(labels[i]);
    if (catName.includes("pass")) {
      if (label === "yds" || label === "yards") return "pass_yds";
      if (label === "td" || label === "tds") return "pass_td";
      if (label === "int" || label === "ints") return "pass_int";
      if (label === "att" || label === "attempts") return "pass_att";
      if (label === "cmp" || label === "comp" || label === "completions") return "pass_comp";
      if (label === "lng" || label === "long") return "pass_long";
      if (label === "catt" || label === "cmpatt") return "c/att";
    }
    if (catName.includes("rush")) {
      if (label === "yds" || label === "yards") return "rush_yds";
      if (label === "td" || label === "tds") return "rush_td";
      if (label === "car" || label === "att" || label === "attempts") return "rush_att";
      if (label === "lng" || label === "long") return "rush_long";
    }
    if (catName.includes("receiv")) {
      if (label === "yds" || label === "yards") return "rec_yds";
      if (label === "td" || label === "tds") return "rec_td";
      if (label === "rec" || label === "receptions") return "rec";
      if (label === "lng" || label === "long") return "rec_long";
      if (label === "tgts" || label === "targets") return "targets";
    }
    if (catName.includes("kick")) {
      if (label === "fgm") return "fg_made";
      if (label === "fga") return "fg_att";
      if (label === "xpm" || label === "pat") return "xp_made";
      if (label === "pts" || label === "points") return "kicking_pts";
      if (label === "fg") return "fg_pair";
      if (label === "xp") return "xp_pair";
    }
    return ESPN_LABEL_TO_STAT[label] || null;
  };

  for (let i = 0; i < values.length; i += 1) {
    const mapped = resolveIndex(i);
    if (!mapped || mapped === "targets") continue;
    if (mapped === "c/att" || mapped === "fg_pair" || mapped === "xp_pair") {
      const pair = parseCompAtt(values[i]);
      if (!pair) continue;
      if (mapped === "c/att") {
        if (stats.pass_comp == null) stats.pass_comp = pair.comp;
        if (stats.pass_att == null) stats.pass_att = pair.att;
      } else if (mapped === "fg_pair") {
        if (stats.fg_made == null) stats.fg_made = pair.comp;
        if (stats.fg_att == null) stats.fg_att = pair.att;
      } else if (mapped === "xp_pair") {
        if (stats.xp_made == null) stats.xp_made = pair.comp;
      }
      continue;
    }
    const val = parseStatNumber(values[i]);
    if (val != null && stats[mapped] == null) stats[mapped] = val;
  }
  return stats;
}

function mergeStats(into, from) {
  const out = { ...into };
  for (const [k, v] of Object.entries(from || {})) {
    if (v != null && out[k] == null) out[k] = v;
  }
  return out;
}

function validateGameLogs(logs, { season, playerName, team } = {}) {
  if (!Array.isArray(logs) || !logs.length) {
    return { ok: false, reason: "empty" };
  }
  const nameNeedle = normalizePlayerName(playerName);
  for (const g of logs) {
    if (season != null && g.season != null && Number(g.season) !== Number(season)) {
      return { ok: false, reason: "season_mismatch" };
    }
    if (!g.week && !g.gameId && !g.startDate) {
      return { ok: false, reason: "missing_game_id" };
    }
    const stats = g.stats || {};
    for (const [k, v] of Object.entries(stats)) {
      if (v != null && !Number.isFinite(Number(v))) {
        return { ok: false, reason: `non_numeric:${k}` };
      }
    }
    if (team && g.team && !sameTeam(g.team, team) && aliasTeam(g.team) !== aliasTeam(team)) {
      // Soft warning only — some transfers/aliases differ; don't reject whole set.
    }
    if (nameNeedle && g.playerName && normalizePlayerName(g.playerName) !== nameNeedle) {
      // Soft — roster nicknames differ occasionally.
    }
  }
  return { ok: true };
}

/**
 * Parse site.web.api athlete gamelog into Prop Lab game log rows.
 */
function parseAthleteGameLog(payload, { season, playerName, team, athleteId } = {}) {
  if (!payload || typeof payload !== "object") return [];
  const names = Array.isArray(payload.names) ? payload.names : [];
  const events = payload.events && typeof payload.events === "object" ? payload.events : {};
  const logs = [];

  for (const st of payload.seasonTypes || []) {
    const typeLabel = String(st.displayName || st.name || "").toLowerCase();
    // Match CFBD seasonType=regular — skip bowl/playoff/postseason blocks.
    if (typeLabel && /postseason|bowl|playoff|championship/.test(typeLabel)) continue;
    for (const cat of st.categories || []) {
      for (const row of cat.events || []) {
        const eventId = row.eventId != null ? String(row.eventId) : null;
        if (!eventId) continue;
        const meta = events[eventId] || {};
        const stats = mapNamedStats(names, Array.isArray(row.stats) ? row.stats : []);
        const atVs = String(meta.atVs || "").toLowerCase();
        const homeAway = atVs === "vs" ? "home" : atVs === "@" || atVs === "at" ? "away" : null;
        const homeScore = toNum(meta.homeTeamScore);
        const awayScore = toNum(meta.awayTeamScore);
        let points = null;
        let oppPoints = null;
        if (homeAway === "home") {
          points = homeScore;
          oppPoints = awayScore;
        } else if (homeAway === "away") {
          points = awayScore;
          oppPoints = homeScore;
        }
        const opponent =
          schoolFromEspnTeam(meta.opponent) ||
          meta.opponent?.displayName ||
          meta.opponent?.abbreviation ||
          null;

        logs.push({
          gameId: eventId,
          week: toNum(meta.week),
          season: Number(season) || toNum(meta.season?.year) || null,
          team: team || schoolFromEspnTeam(meta.team) || null,
          opponent,
          homeAway,
          points,
          oppPoints,
          completed: Boolean(meta.gameResult) || (homeScore != null && awayScore != null),
          isFcs: false,
          oppClassification: null,
          startDate: meta.gameDate || null,
          playerName: playerName || null,
          sourcePlayerId: athleteId != null ? String(athleteId) : null,
          sourceGameId: eventId,
          source: "espn",
          stats,
        });
      }
    }
  }

  logs.sort((a, b) => (a.week || 0) - (b.week || 0));
  return logs;
}

/**
 * Extract one player's stats from an ESPN game summary boxscore.
 */
function parsePlayerFromSummary(summary, { athleteId, playerName, team } = {}) {
  const players = summary?.boxscore?.players;
  if (!Array.isArray(players)) return null;

  let stats = emptyStats();
  let matched = false;
  let teamName = team || null;
  let points = null;
  let oppPoints = null;
  let homeAway = null;
  let opponent = null;

  const header = summary?.header;
  const comp = Array.isArray(header?.competitions) ? header.competitions[0] : null;
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];

  for (const side of players) {
    const sideTeam = schoolFromEspnTeam(side.team);
    for (const category of side.statistics || []) {
      for (const ath of category.athletes || []) {
        const id = ath.athlete?.id != null ? String(ath.athlete.id) : null;
        const name = ath.athlete?.displayName || ath.athlete?.fullName || "";
        const idOk = athleteId && id === String(athleteId);
        const nameOk =
          playerName &&
          normalizePlayerName(name) === normalizePlayerName(playerName);
        if (!idOk && !nameOk) continue;
        matched = true;
        teamName = sideTeam || teamName;
        const piece = mapCategoryStats(category, Array.isArray(ath.stats) ? ath.stats : []);
        stats = mergeStats(stats, piece);
      }
    }
  }

  if (!matched) return null;

  if (competitors.length >= 2) {
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const homeSchool = schoolFromEspnTeam(home?.team);
    const awaySchool = schoolFromEspnTeam(away?.team);
    if (teamName && sameTeam(teamName, homeSchool)) {
      homeAway = "home";
      opponent = awaySchool;
      points = toNum(home?.score);
      oppPoints = toNum(away?.score);
    } else if (teamName && sameTeam(teamName, awaySchool)) {
      homeAway = "away";
      opponent = homeSchool;
      points = toNum(away?.score);
      oppPoints = toNum(home?.score);
    }
  }

  const status = header?.competitions?.[0]?.status || summary?.header?.status;
  const completed =
    Boolean(status?.type?.completed) ||
    String(status?.type?.state || "").toLowerCase() === "post";

  return {
    team: teamName,
    opponent,
    homeAway,
    points,
    oppPoints,
    completed,
    stats,
  };
}

/**
 * Map ESPN team schedule events into CFBD-like schedule rows for parseSchedule.
 */
function mapScheduleEvent(evt, seasonYear, team) {
  const comp = Array.isArray(evt?.competitions) ? evt.competitions[0] : null;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const homeTeam = schoolFromEspnTeam(home.team);
  const awayTeam = schoolFromEspnTeam(away.team);
  const status = evt?.status?.type || comp?.status?.type || {};
  const statusState = String(status.state || "").toLowerCase();
  const homePts = toNum(home.score?.value ?? home.score);
  const awayPts = toNum(away.score?.value ?? away.score);
  const completed =
    Boolean(status.completed) ||
    statusState === "post" ||
    /final/i.test(String(status.name || status.detail || "")) ||
    (homePts != null && awayPts != null);

  return {
    id: evt.id != null ? Number(evt.id) || String(evt.id) : null,
    season: Number(evt.season?.year) || seasonYear,
    week: toNum(evt.week?.number ?? evt.week),
    startDate: evt.date || null,
    completed,
    homeTeam,
    awayTeam,
    homePoints: completed ? homePts : null,
    awayPoints: completed ? awayPts : null,
    homeClassification: null,
    awayClassification: null,
    venue: comp.venue?.fullName || null,
    notes: null,
    _team: team,
  };
}

function enrichLogsWithSchedule(logs, schedule) {
  if (!Array.isArray(logs) || !Array.isArray(schedule)) return logs;
  const byId = new Map();
  for (const g of schedule) {
    if (g.gameId != null) byId.set(String(g.gameId), g);
    if (g.id != null) byId.set(String(g.id), g);
  }
  return logs.map((log) => {
    const sched = log.gameId != null ? byId.get(String(log.gameId)) : null;
    if (!sched) return log;
    return {
      ...log,
      week: log.week ?? sched.week ?? null,
      season: log.season ?? sched.season ?? null,
      opponent: log.opponent || sched.opponent || null,
      homeAway: log.homeAway || sched.homeAway || null,
      points: log.points ?? (sched.homeAway === "home" ? sched.homePoints : sched.awayPoints),
      oppPoints:
        log.oppPoints ?? (sched.homeAway === "home" ? sched.awayPoints : sched.homePoints),
      completed: log.completed || Boolean(sched.completed),
      isFcs: Boolean(sched.oppIsFcs),
      oppClassification: sched.oppClassification || null,
      startDate: log.startDate || sched.startDate || null,
      team: log.team || null,
    };
  });
}

module.exports = {
  schoolFromEspnTeam,
  stripTrailingMascot,
  mapNamedStats,
  mapCategoryStats,
  parseAthleteGameLog,
  parsePlayerFromSummary,
  mapScheduleEvent,
  enrichLogsWithSchedule,
  validateGameLogs,
  emptyStats,
  normalizePlayerName,
  normalizeTeam,
};
