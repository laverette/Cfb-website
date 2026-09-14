const { PROP_MODEL_VERSION } = require("./version");
const { loadPlayerBundle } = require("./bundle");
const { evaluateFromBundle } = require("./evaluate");
const { createClient } = require("./cfbd-client");
const { getSupabase, hasSupabase } = require("../../db");

/**
 * Backtest a single player/game using only information available before that week.
 */
async function backtestOne({
  playerId,
  team,
  name,
  statId,
  line,
  side = "more",
  season,
  week,
  opponent,
  actual,
  apiKey,
  powerTeams,
  signal,
  cfbd,
}) {
  const client = cfbd || createClient(apiKey, { signal });
  const bundle = await loadPlayerBundle({
    playerId,
    team,
    name,
    opponent,
    season,
    week,
    apiKey,
    cfbd: client,
    powerTeams,
    signal,
    asOfWeek: week,
  });
  const evaluation = evaluateFromBundle(bundle, { statId, line, side });
  const hit =
    actual == null || !Number.isFinite(Number(actual))
      ? null
      : side === "less"
        ? Number(actual) < Number(line)
        : Number(actual) > Number(line);
  const error =
    actual == null || !Number.isFinite(Number(actual)) ? null : Number(actual) - evaluation.projection;
  return {
    modelVersion: PROP_MODEL_VERSION,
    season,
    week,
    playerId,
    statId,
    line: Number(line),
    projection: evaluation.projection,
    pHit: evaluation.pHit,
    actual: actual == null ? null : Number(actual),
    error,
    hit,
    confidence: evaluation.confidence,
    asOfWeek: week,
  };
}

function calibrationBuckets(rows) {
  const bands = [
    [0.5, 0.54],
    [0.55, 0.59],
    [0.6, 0.64],
    [0.65, 0.69],
    [0.7, 1],
  ];
  return bands.map(([lo, hi]) => {
    const slice = rows.filter((r) => r.pHit >= lo && r.pHit <= hi && r.hit != null);
    const hits = slice.filter((r) => r.hit).length;
    return {
      band: `${Math.round(lo * 100)}–${hi >= 1 ? "70+" : Math.round(hi * 100)}%`,
      n: slice.length,
      predicted: slice.length ? slice.reduce((s, r) => s + r.pHit, 0) / slice.length : null,
      actual: slice.length ? hits / slice.length : null,
    };
  });
}

function metricsByStat(rows) {
  const by = {};
  for (const r of rows) {
    const k = r.statId || "all";
    if (!by[k]) by[k] = [];
    by[k].push(r);
  }
  const summarize = (list) => {
    const errs = list.map((r) => r.error).filter((n) => Number.isFinite(n));
    const mae = errs.length ? errs.reduce((s, n) => s + Math.abs(n), 0) / errs.length : null;
    const rmse = errs.length
      ? Math.sqrt(errs.reduce((s, n) => s + n * n, 0) / errs.length)
      : null;
    const graded = list.filter((r) => r.hit != null);
    return {
      n: list.length,
      mae,
      rmse,
      hitRate: graded.length ? graded.filter((r) => r.hit).length / graded.length : null,
    };
  };
  const out = { all: summarize(rows) };
  for (const [k, list] of Object.entries(by)) out[k] = summarize(list);
  return out;
}

async function persistBacktests(rows) {
  if (!hasSupabase() || !rows.length) return;
  try {
    const supabase = getSupabase();
    await supabase.from("prop_lab_backtests").insert(
      rows.map((r) => ({
        season_year: r.season,
        week_number: r.week,
        player_id: String(r.playerId),
        stat_id: r.statId,
        model_version: r.modelVersion,
        projection: r.projection,
        line: r.line,
        actual: r.actual,
        p_hit: r.pHit,
        hit: r.hit,
        error: r.error,
      }))
    );
  } catch {
    /* migration may not be applied */
  }
}

module.exports = { backtestOne, calibrationBuckets, metricsByStat, persistBacktests };
