/**
 * Stable game identity + dedupe so CFBD and ESPN rows of the same contest
 * never both enter the player's sample.
 */

const { normalizeTeam, aliasTeam } = require("../names");

function normalizePlayerName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gameKey({ season, week, team, opponent, gameDate, gameId }) {
  if (gameId != null && String(gameId).trim() !== "") {
    // Source-specific ids are not comparable across providers — only use when
    // both rows share the same source prefix later. Prefer semantic key.
  }
  const s = Number(season) || 0;
  const w = Number(week);
  const t = aliasTeam(team) || normalizeTeam(team);
  const o = aliasTeam(opponent) || normalizeTeam(opponent);
  const day = gameDate ? String(gameDate).slice(0, 10) : "";
  if (Number.isFinite(w) && t && o) return `${s}|w${w}|${t}|${o}`;
  if (day && t && o) return `${s}|d${day}|${t}|${o}`;
  if (gameId != null) return `${s}|id${gameId}`;
  return `${s}|${t}|${o}|${w || ""}|${day}`;
}

/**
 * Prefer CFBD rows when the same semantic game appears from both sources.
 */
function dedupeGameLogs(logs) {
  const byKey = new Map();
  for (const g of logs || []) {
    const key = gameKey({
      season: g.season,
      week: g.week,
      team: g.team,
      opponent: g.opponent,
      gameDate: g.startDate || g.gameDate,
      gameId: g.gameId,
    });
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, g);
      continue;
    }
    const prevSrc = String(prev.source || prev.originalSource || "");
    const nextSrc = String(g.source || g.originalSource || "");
    if (prevSrc === "cfbd" && nextSrc !== "cfbd") continue;
    if (nextSrc === "cfbd" && prevSrc !== "cfbd") {
      byKey.set(key, g);
      continue;
    }
    // Prefer the row with more non-null stats.
    const score = (row) =>
      Object.values(row.stats || {}).filter((v) => v != null && Number.isFinite(Number(v))).length;
    if (score(g) > score(prev)) byKey.set(key, g);
  }
  return [...byKey.values()].sort((a, b) => (a.week || 0) - (b.week || 0));
}

function emptyStats() {
  return {
    pass_yds: null,
    pass_td: null,
    pass_att: null,
    pass_comp: null,
    pass_int: null,
    pass_long: null,
    rush_yds: null,
    rush_td: null,
    rush_att: null,
    rush_long: null,
    rec_yds: null,
    rec_td: null,
    rec: null,
    rec_long: null,
    fg_made: null,
    fg_att: null,
    xp_made: null,
    kicking_pts: null,
  };
}

function parseStatNumber(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s || s === "-" || s === "--" || s.toLowerCase() === "null") return null;
  // Keep "0" as zero — explicit recording.
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseCompAtt(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (!m) return null;
  return { comp: Number(m[1]), att: Number(m[2]) };
}

module.exports = {
  normalizePlayerName,
  gameKey,
  dedupeGameLogs,
  emptyStats,
  parseStatNumber,
  parseCompAtt,
};
