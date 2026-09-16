/**
 * Real-outcome grading loop.
 *
 * The frozen backtest scores the model against a synthetic data generator,
 * which is fine for catching structural bugs but cannot tell you whether the
 * model works on actual college football. This module closes that gap:
 *
 *   1. recordPredictions  writes a projection before kickoff (actual = null).
 *   2. gradeWeek          fills in the real result once the box score exists.
 *   3. gradedRows         feeds those rows back to the calibrator fit.
 *
 * Step 1 has to happen before the game. Grading a line you chose after seeing
 * the result is not evidence, so nothing here invents historical lines.
 */
const { createClient } = require("./cfbd-client");
const { parsePlayerGameLogs, extractStatValue } = require("./parse");
const { PROP_MODEL_VERSION } = require("./version");
const { reportFromRows } = require("./metrics");
const { getSupabase, hasSupabase } = require("../../db");

const TABLE = "prop_lab_backtests";

function toRow(p) {
  return {
    model_version: p.modelVersion || PROP_MODEL_VERSION,
    season_year: Number(p.season),
    week_number: Number(p.week),
    player_id: String(p.playerId),
    player_name: p.playerName || null,
    team: p.team || null,
    opponent: p.opponent || null,
    stat_id: p.statId,
    projection: numOrNull(p.projection),
    line: numOrNull(p.line),
    side: p.side === "less" ? "less" : "more",
    p_hit: numOrNull(p.pHit),
    p_hit_uncalibrated: numOrNull(p.pUncalibrated),
    calibrator_method: p.calibratorMethod || null,
    confidence: p.confidence || null,
    prop_score: numOrNull(p.propScore),
    sample_games: p.sampleGames == null ? null : Number(p.sampleGames),
    spread: numOrNull(p.spread),
    source: p.source || "live",
  };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fromRow(r) {
  return {
    id: r.id,
    modelVersion: r.model_version,
    season: r.season_year,
    week: r.week_number,
    playerId: r.player_id,
    playerName: r.player_name,
    team: r.team,
    opponent: r.opponent,
    statId: r.stat_id,
    projection: r.projection == null ? null : Number(r.projection),
    line: r.line == null ? null : Number(r.line),
    side: r.side || "more",
    actual: r.actual == null ? null : Number(r.actual),
    pHit: r.p_hit == null ? null : Number(r.p_hit),
    pUncalibrated: r.p_hit_uncalibrated == null ? null : Number(r.p_hit_uncalibrated),
    confidence: r.confidence,
    propScore: r.prop_score == null ? null : Number(r.prop_score),
    sampleGames: r.sample_games,
    spread: r.spread == null ? null : Number(r.spread),
    hit: r.hit,
    error: r.error == null ? null : Number(r.error),
    source: r.source,
  };
}

/**
 * Persist projections as pending predictions. Safe to re-run: the unique index
 * on (model, season, week, player, stat, line, side) turns repeats into updates.
 */
async function recordPredictions(predictions) {
  const list = (predictions || []).filter((p) => p && p.playerId && p.statId && p.line != null);
  if (!hasSupabase() || !list.length) return { recorded: 0, skipped: list.length };
  const supabase = getSupabase();
  const { error, count } = await supabase
    .from(TABLE)
    .upsert(list.map(toRow), {
      onConflict: "model_version,season_year,week_number,player_id,stat_id,line,side",
      count: "exact",
    });
  if (error) {
    const err = new Error(`Failed to record predictions: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  return { recorded: count ?? list.length, skipped: 0 };
}

async function loadPending({ season, week, limit = 5000 } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select("*").is("hit", null).limit(limit);
  if (season != null) query = query.eq("season_year", Number(season));
  if (week != null) query = query.eq("week_number", Number(week));
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load pending predictions: ${error.message}`);
  return (data || []).map(fromRow);
}

/**
 * One box-score fetch per team-week, cached by the CFBD client.
 */
async function teamWeekBox({ cfbd, season, week, team }) {
  const box = await cfbd.getOptional("/games/players", {
    year: season,
    week,
    team,
    seasonType: "regular",
  });
  return Array.isArray(box) ? box : [];
}

/**
 * Actual value of one stat for one player in a fetched team-week box.
 */
function actualFor(box, { playerId, playerName, team, statId }) {
  const logs = parsePlayerGameLogs(box, {
    playerId,
    playerName,
    team,
    scheduleById: new Map(),
  });
  if (!logs.length) return null;
  return extractStatValue(logs[0].stats, statId);
}

function gradeOne(prediction, actual) {
  if (actual == null || !Number.isFinite(Number(actual))) return null;
  const a = Number(actual);
  const line = Number(prediction.line);
  const hit = prediction.side === "less" ? a < line : a > line;
  const error =
    prediction.projection == null ? null : Number((a - Number(prediction.projection)).toFixed(4));
  return { actual: a, hit, error };
}

/**
 * Grade every pending prediction for a season/week against real box scores.
 */
async function gradeWeek({ season, week, apiKey, cfbd, dryRun = false } = {}) {
  const pending = await loadPending({ season, week });
  if (!pending.length) {
    return { season, week, pending: 0, graded: 0, ungraded: 0, rows: [] };
  }

  const client = cfbd || createClient(apiKey);
  const teams = [...new Set(pending.map((p) => p.team).filter(Boolean))];
  const boxByTeam = new Map();
  for (const team of teams) {
    try {
      boxByTeam.set(team, await teamWeekBox({ cfbd: client, season, week, team }));
    } catch {
      boxByTeam.set(team, []);
    }
  }

  const graded = [];
  const ungraded = [];
  for (const p of pending) {
    const box = boxByTeam.get(p.team) || [];
    const actual = box.length
      ? actualFor(box, {
          playerId: p.playerId,
          playerName: p.playerName,
          team: p.team,
          statId: p.statId,
        })
      : null;
    const result = gradeOne(p, actual);
    if (!result) {
      ungraded.push(p);
      continue;
    }
    graded.push({ ...p, ...result });
  }

  if (!dryRun && graded.length && hasSupabase()) {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    for (const g of graded) {
      const { error } = await supabase
        .from(TABLE)
        .update({ actual: g.actual, hit: g.hit, error: g.error, graded_at: now })
        .eq("id", g.id);
      if (error) throw new Error(`Failed to grade row ${g.id}: ${error.message}`);
    }
  }

  return {
    season,
    week,
    pending: pending.length,
    graded: graded.length,
    ungraded: ungraded.length,
    rows: graded,
  };
}

/**
 * Every graded real-world row, shaped for the calibrator fit and metrics.
 */
async function gradedRows({ modelVersion = PROP_MODEL_VERSION, source = "live", limit = 20000 } = {}) {
  if (!hasSupabase()) return [];
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select("*").not("hit", "is", null).limit(limit);
  if (modelVersion) query = query.eq("model_version", modelVersion);
  if (source) query = query.eq("source", source);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load graded rows: ${error.message}`);
  return (data || []).map(fromRow);
}

/**
 * Split graded real rows by week so a refit keeps the same train/val/test
 * discipline as the synthetic harness: earliest weeks train, latest weeks test.
 */
function splitByWeek(rows, { trainFrac = 0.5, valFrac = 0.25 } = {}) {
  const weeks = [...new Set(rows.map((r) => Number(r.week)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  const trainCut = weeks[Math.floor(weeks.length * trainFrac) - 1] ?? weeks[0];
  const valCut = weeks[Math.floor(weeks.length * (trainFrac + valFrac)) - 1] ?? trainCut;
  const out = { train: [], val: [], test: [], weeks };
  for (const r of rows) {
    const w = Number(r.week);
    if (w <= trainCut) out.train.push(r);
    else if (w <= valCut) out.val.push(r);
    else out.test.push(r);
  }
  return out;
}

async function realCalibrationReport(opts = {}) {
  const rows = await gradedRows(opts);
  if (!rows.length) return { n: 0, report: null };
  return { n: rows.length, report: reportFromRows(rows) };
}

module.exports = {
  recordPredictions,
  loadPending,
  gradeWeek,
  gradeOne,
  gradedRows,
  splitByWeek,
  realCalibrationReport,
  teamWeekBox,
  actualFor,
  toRow,
  fromRow,
};
