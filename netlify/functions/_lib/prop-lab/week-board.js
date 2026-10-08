/**
 * Weekly Best Bets scorer — PrizePicks mirror → evaluate → rank → persist.
 */
const { getSupabase, hasSupabase } = require("../../db");
const { PROP_MODEL_VERSION } = require("./version");
const { loadPlayerBundle } = require("./bundle");
const { evaluateFromBundle } = require("./evaluate");
const { bestN } = require("./entry");
const { getLeagueMatchupSnapshot } = require("./data/league-snapshot");
const {
  fetchPrizePicksNcaaf,
  uniqueEvalTargets,
} = require("./data/prizepicks-mirror");
const { dataLog } = require("./data/log");
const { cfbdUsageSnapshot } = require("../cfbd-guard");
const { cached, readMemory } = require("./cache");

const TABLE = "prop_lab_week_picks";
const BATCH_DEFAULT = 12;
const TOP_SINGLES = 40;
const PLAYER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

async function evaluateProp(opts) {
  const bundle = await loadPlayerBundle(opts);
  return evaluateFromBundle(bundle, {
    statId: opts.statId,
    line: opts.line,
    side: opts.side || "more",
    marketOdds: opts.marketOdds || null,
  });
}

function batchSize() {
  const n = Number(process.env.PROP_LAB_WEEK_BOARD_BATCH);
  return Number.isFinite(n) && n > 0 ? Math.min(40, Math.floor(n)) : BATCH_DEFAULT;
}

function playerResolveKey(name, team, season) {
  return `pp-player:v1:${season}:${String(name || "").toLowerCase()}|${String(team || "").toLowerCase()}`;
}

async function resolvePlayer({ name, team, season, apiKey, signal }) {
  const key = playerResolveKey(name, team, season);
  const hit = readMemory(key);
  if (hit) return hit;

  const cachedHit = await cached(
    key,
    PLAYER_CACHE_TTL,
    async () => {
      // Lazy require avoids prop-eval.js ↔ week-board circular load.
      const { searchPlayers } = require("../prop-eval");
      const hits = await searchPlayers({
        q: name,
        team: team || undefined,
        year: season,
        apiKey,
        signal,
        mode: "espn",
      });
      const first = Array.isArray(hits) && hits[0] ? hits[0] : null;
      if (!first?.id) return null;
      const rawId = String(first.id);
      return {
        id: rawId.startsWith("espn:") || first.source === "cfbd" ? rawId : `espn:${rawId}`,
        name: first.name || name,
        team: first.team || team,
        position: first.position || null,
        source: first.source || "espn",
      };
    },
    { persist: true }
  );
  return cachedHit.value;
}

function slimLeg(evaluation, prop, side) {
  if (!evaluation || evaluation.error) {
    return {
      projectionId: prop.projectionId,
      playerName: prop.playerName,
      team: prop.team,
      opponent: prop.opponent,
      statId: prop.statId,
      statLabel: prop.stat,
      line: prop.line,
      side,
      error: evaluation?.error || "eval failed",
    };
  }
  return {
    projectionId: prop.projectionId,
    playerId: evaluation.player?.id || null,
    playerName: evaluation.player?.name || prop.playerName,
    team: evaluation.player?.team || prop.team,
    position: evaluation.player?.position || null,
    opponent: evaluation.opponent || { name: prop.opponent },
    statId: evaluation.stat?.id || prop.statId,
    statLabel: evaluation.stat?.label || prop.stat,
    line: evaluation.line ?? prop.line,
    side: evaluation.side || side,
    projection: evaluation.projection ?? null,
    pHit: evaluation.pHit ?? null,
    pMore: evaluation.pMore ?? null,
    pLess: evaluation.pLess ?? null,
    propScore: evaluation.propScore ?? null,
    propScoreLabel: evaluation.propScoreLabel || null,
    confidence: evaluation.confidence || null,
    form: evaluation.form
      ? { games: evaluation.form.games, season: evaluation.form.season, l3: evaluation.form.l3 }
      : null,
    matchup: evaluation.matchup
      ? {
          headline: evaluation.matchup.headline,
          adjPct: evaluation.matchup.adjPct,
          note: evaluation.matchup.note,
        }
      : null,
    edge: Number.isFinite(evaluation.pHit) ? evaluation.pHit - 0.5 : null,
  };
}

function pickBetterSide(moreLeg, lessLeg) {
  const score = (l) => {
    if (!l || l.error) return -Infinity;
    const confPenalty = l.confidence === "D" ? -8 : l.confidence === "C" ? -3 : 0;
    const sample = l.form?.games ?? 0;
    const samplePenalty = sample < 3 ? -12 : 0;
    return (l.propScore || 0) + (l.pHit || 0) * 20 + confPenalty + samplePenalty;
  };
  return score(moreLeg) >= score(lessLeg) ? moreLeg : lessLeg;
}

function passesFloor(leg) {
  if (!leg || leg.error) return false;
  if (leg.confidence === "D") return false;
  if ((leg.form?.games ?? 0) < 3) return false;
  if ((leg.pHit ?? 0) < 0.54) return false;
  if ((leg.propScore ?? 0) < 55) return false;
  return true;
}

function rankSingles(legs) {
  return legs
    .filter(passesFloor)
    .slice()
    .sort((a, b) => {
      const ds = (b.propScore || 0) - (a.propScore || 0);
      if (ds) return ds;
      return (b.pHit || 0) - (a.pHit || 0);
    })
    .slice(0, TOP_SINGLES);
}

function buildCombos(ranked) {
  const asEntryLegs = ranked.slice(0, 24).map((l) => ({
    ...l,
    player: { id: l.playerId, name: l.playerName, team: l.team, position: l.position },
    opponent: l.opponent,
    stat: { id: l.statId, label: l.statLabel },
    selected: true,
  }));
  const pack = (n) => {
    const result = bestN(asEntryLegs, n, "balanced");
    return {
      n: result.n,
      mode: result.mode,
      reason: result.reason,
      keep: (result.keep || []).map((l) => ({
        playerId: l.playerId || l.player?.id,
        playerName: l.playerName || l.player?.name,
        team: l.team || l.player?.team,
        opponent: l.opponent,
        statId: l.statId || l.stat?.id,
        statLabel: l.statLabel || l.stat?.label,
        line: l.line,
        side: l.side,
        propScore: l.propScore,
        pHit: l.pHit,
        confidence: l.confidence,
      })),
    };
  };
  return {
    best2: pack(2),
    best3: pack(3),
    best4: pack(4),
  };
}

async function loadWeekRow(season, week, scrapeHash) {
  if (!hasSupabase()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("season_year", season)
    .eq("week_number", week)
    .eq("scrape_hash", scrapeHash)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01") {
      const err = new Error(
        "prop_lab_week_picks table missing — apply sql/prop_lab_week_picks.sql"
      );
      err.code = "SCHEMA_MISSING";
      throw err;
    }
    throw error;
  }
  return data || null;
}

async function upsertWeekRow(row) {
  if (!hasSupabase()) {
    const err = new Error("Supabase not configured");
    err.code = "NO_SUPABASE";
    throw err;
  }
  const supabase = getSupabase();
  const payload = {
    ...row,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: "season_year,week_number,scrape_hash" })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "42P01") {
      const err = new Error(
        "prop_lab_week_picks table missing — apply sql/prop_lab_week_picks.sql"
      );
      err.code = "SCHEMA_MISSING";
      throw err;
    }
    throw error;
  }
  return data;
}

async function getLatestWeekPicks({ season, week } = {}) {
  if (!hasSupabase()) return null;
  const supabase = getSupabase();
  let q = supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (season != null) q = q.eq("season_year", Number(season));
  if (week != null) q = q.eq("week_number", Number(week));
  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01") return null;
    throw error;
  }
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * Score the next batch of unscored PrizePicks props for the week.
 */
async function runWeekBoardBatch({
  season,
  week,
  apiKey,
  powerTeams = [],
  signal,
  force = false,
  maxBatch = batchSize(),
} = {}) {
  const seasonYear = Number(season) || new Date().getFullYear();
  const weekNumber = Number(week);
  if (!Number.isFinite(weekNumber)) {
    const err = new Error("week required");
    err.code = "WEEK_REQUIRED";
    throw err;
  }

  const usageBefore = cfbdUsageSnapshot();
  const mirror = await fetchPrizePicksNcaaf({ signal });
  const targets = uniqueEvalTargets(mirror.props);
  const leagueSnap = await getLeagueMatchupSnapshot(seasonYear, {
    apiKey,
    signal,
    force: false,
  });

  let row = await loadWeekRow(seasonYear, weekNumber, mirror.scrapeHash);
  if (force && row) {
    row = null;
  }
  const scores = row?.scores_json && typeof row.scores_json === "object" ? { ...row.scores_json } : {};

  const pending = targets.filter((p) => p.projectionId && !scores[p.projectionId]);
  const batch = pending.slice(0, maxBatch);

  dataLog(
    "WeekBoard",
    `season=${seasonYear} week=${weekNumber} supported=${targets.length} pending=${pending.length} batch=${batch.length} snap=${leagueSnap?.cache}`
  );

  const scored = await mapPool(batch, 4, async (prop) => {
    try {
      const player = await resolvePlayer({
        name: prop.playerName,
        team: prop.team,
        season: seasonYear,
        apiKey,
        signal,
      });
      if (!player?.id) {
        return {
          projectionId: prop.projectionId,
          error: "player_unresolved",
          playerName: prop.playerName,
          team: prop.team,
          statId: prop.statId,
          line: prop.line,
        };
      }
      const base = {
        playerId: player.id,
        team: player.team || prop.team,
        name: player.name || prop.playerName,
        opponent: prop.opponent,
        season: seasonYear,
        week: weekNumber,
        apiKey,
        powerTeams,
        signal,
        includeDebug: false,
      };
      const [moreEval, lessEval] = await Promise.all([
        evaluateProp({ ...base, statId: prop.statId, line: prop.line, side: "more" }),
        evaluateProp({ ...base, statId: prop.statId, line: prop.line, side: "less" }),
      ]);
      const moreLeg = slimLeg(moreEval, prop, "more");
      const lessLeg = slimLeg(lessEval, prop, "less");
      const best = pickBetterSide(moreLeg, lessLeg);
      return {
        ...best,
        bothSides: { more: moreLeg, less: lessLeg },
        scoredAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        projectionId: prop.projectionId,
        playerName: prop.playerName,
        team: prop.team,
        opponent: prop.opponent,
        statId: prop.statId,
        line: prop.line,
        error: err.message || "eval_error",
        scoredAt: new Date().toISOString(),
      };
    }
  });

  for (const s of scored) {
    if (s?.projectionId) scores[s.projectionId] = s;
  }

  const allScored = Object.values(scores);
  const okLegs = allScored.filter((l) => !l.error && l.propScore != null);
  const ranked = rankSingles(okLegs);
  const complete = pending.length <= batch.length;
  const status = complete ? "complete" : "partial";
  const combos = complete || ranked.length >= 8 ? buildCombos(ranked) : row?.combos_json || {};

  const usageAfter = cfbdUsageSnapshot();
  const cfbdCallsDelta = Math.max(0, (usageAfter.allowed || 0) - (usageBefore.allowed || 0));
  const priorCalls = Number(row?.cfbd_calls) || 0;

  const saved = await upsertWeekRow({
    season_year: seasonYear,
    week_number: weekNumber,
    scrape_hash: mirror.scrapeHash,
    model_version: PROP_MODEL_VERSION,
    status,
    generated_at: row?.generated_at || new Date().toISOString(),
    props_total: mirror.totalProps,
    props_supported: targets.length,
    props_scored: Object.keys(scores).length,
    cfbd_calls: priorCalls + cfbdCallsDelta,
    league_snapshot_cache: leagueSnap?.cache || null,
    legs_json: ranked,
    combos_json: combos,
    scores_json: scores,
    meta_json: {
      scrapedAt: mirror.scrapedAt,
      scrapedDate: mirror.scrapedDate,
      sourceUrl: mirror.sourceUrl,
      skipped: mirror.skipped,
      batchSize: batch.length,
      pendingRemaining: Math.max(0, pending.length - batch.length),
      leagueSnapshotFetchedAt: leagueSnap?.fetchedAt || null,
    },
  });

  return {
    ok: true,
    status,
    season: seasonYear,
    week: weekNumber,
    scrapeHash: mirror.scrapeHash,
    propsTotal: mirror.totalProps,
    propsSupported: targets.length,
    propsScored: Object.keys(scores).length,
    pendingRemaining: Math.max(0, pending.length - batch.length),
    batchScored: batch.length,
    cfbdCallsDelta,
    cfbdCallsTotal: priorCalls + cfbdCallsDelta,
    leagueSnapshotCache: leagueSnap?.cache || null,
    topCount: ranked.length,
    continue: !complete,
    row: saved,
  };
}

function publicWeekPicksView(row) {
  if (!row) return null;
  return {
    season: row.season_year,
    week: row.week_number,
    status: row.status,
    scrapeHash: row.scrape_hash,
    modelVersion: row.model_version,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    propsTotal: row.props_total,
    propsSupported: row.props_supported,
    propsScored: row.props_scored,
    cfbdCalls: row.cfbd_calls,
    leagueSnapshotCache: row.league_snapshot_cache,
    legs: row.legs_json || [],
    combos: row.combos_json || {},
    meta: row.meta_json || {},
  };
}

/**
 * Score batches until the board is complete or maxMs elapses.
 * Use from a Netlify background function (up to ~15 min).
 */
async function runWeekBoardToCompletion({
  season,
  week,
  apiKey,
  powerTeams = [],
  signal,
  force = false,
  maxMs = 14 * 60 * 1000,
} = {}) {
  const started = Date.now();
  let result = null;
  let batches = 0;
  let cfbdTotal = 0;
  while (Date.now() - started < maxMs) {
    if (signal?.aborted) break;
    result = await runWeekBoardBatch({
      season,
      week,
      apiKey,
      powerTeams,
      signal,
      force: force && batches === 0,
    });
    batches += 1;
    cfbdTotal += result.cfbdCallsDelta || 0;
    dataLog(
      "WeekBoard",
      `toCompletion batch=${batches} scored=${result.propsScored} pending=${result.pendingRemaining} status=${result.status}`
    );
    if (!result.continue || result.status === "complete") break;
  }
  return {
    ...result,
    batchesThisRun: batches,
    cfbdCallsThisRun: cfbdTotal,
    complete: result?.status === "complete",
    ms: Date.now() - started,
  };
}

module.exports = {
  runWeekBoardBatch,
  runWeekBoardToCompletion,
  getLatestWeekPicks,
  publicWeekPicksView,
  batchSize,
  rankSingles,
  passesFloor,
};
