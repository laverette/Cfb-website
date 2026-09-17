/**
 * GET/POST /api/prop-eval
 *
 * GET  action=catalog|search|stats|evaluate|board|meta|entries|entry
 * POST action=evaluate|entry|reline|save|delete|backtest
 */
const { json, parseJsonBody } = require("./_http");
const store = require("./_lib/power/store");
const { loadCurrentWeek } = require("./db");
const { requireAuth, requireAdmin } = require("./_auth");
const { buildWeeklyPropBoard } = require("./_lib/prop-board");
const { isOddsApiConfigured } = require("./_lib/odds-api");
const {
  PROP_MODEL_VERSION,
  catalogPublic,
  positionRulesPublic,
  searchPlayers,
  evaluateProp,
  evaluateEntry,
  relineEvaluation,
  compareLegs,
  bestN,
  analyzeEntry,
  createClient,
} = require("./_lib/prop-lab");
const propStore = require("./_lib/prop-lab/store");
const { backtestOne, calibrationBuckets, metricsByStat, persistBacktests } = require("./_lib/prop-lab/backtest");
const { recordPredictions } = require("./_lib/prop-lab/grading");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

/**
 * Log every served projection as a pending prediction so it can be graded once
 * the game is final. This is the only source of real calibration evidence, so
 * it runs on the normal evaluate path — but it must never fail a user request.
 */
async function recordPredictionSafely(result, { season, week }) {
  try {
    const targetWeek = week ?? result?.opponent?.week;
    if (!Number.isFinite(Number(targetWeek))) return;
    await recordPredictions([
      {
        season,
        week: targetWeek,
        playerId: result.player?.id,
        playerName: result.player?.name,
        team: result.player?.team,
        opponent: result.opponent?.name,
        statId: result.stat?.id,
        projection: result.projection,
        line: result.line,
        side: result.side,
        pHit: result.pHit,
        pUncalibrated: result.modelDebug?.pUncalibrated,
        calibratorMethod: result.modelDebug?.calibrationMethod,
        confidence: result.confidence,
        propScore: result.propScore,
        sampleGames: result.form?.games,
        spread: result.market?.spread,
        source: "live",
      },
    ]);
  } catch (err) {
    console.warn("prop-eval prediction ledger:", err.message);
  }
}

function isDebug(event, q) {
  if (String(q.debug || "") === "1") return true;
  const host = String((event.headers || {}).host || "").toLowerCase();
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

async function loadPowerTeams(season) {
  if (!store.hasSupabase()) return [];
  try {
    const snap = await store.loadLatestRatings({
      season: Number.isFinite(season) ? season : null,
      week: null,
    });
    return Array.isArray(snap?.teams) ? snap.teams : [];
  } catch (err) {
    console.warn("prop-eval power teams:", err.message);
    return [];
  }
}

function parseAuthUser(event) {
  const auth = requireAuth(event);
  if (auth.statusCode) return { errorResponse: auth };
  const userId = parseInt(String(auth.payload.userId), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return { errorResponse: json(401, { error: "Authentication required" }) };
  }
  return { userId };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return json(204, {});
  if (method !== "GET" && method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const body = method === "POST" ? parseJsonBody(event) || {} : {};
  const action = String(body.action || q.action || "evaluate").toLowerCase();
  const apiKey = readCfbdKey();
  const cfbdActions = new Set([
    "search",
    "board",
    "evaluate",
    "evaluate-entry",
    "backtest",
  ]);
  if (action === "entry" && method === "POST") cfbdActions.add("entry");
  if (cfbdActions.has(action) && !apiKey) {
    return json(503, { error: "CFBD_API_KEY not configured" });
  }

  const isBoard = action === "board";
  const isEntry = action === "entry" || action === "evaluate-entry";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isBoard || isEntry ? 25_000 : 22_000);
  const signal = controller.signal;

  try {
    if (action === "catalog") {
      return json(200, {
        modelVersion: PROP_MODEL_VERSION,
        stats: catalogPublic(),
        positionRules: positionRulesPublic(),
      });
    }

    if (action === "meta") {
      let week = null;
      try {
        week = await loadCurrentWeek();
      } catch {
        week = null;
      }
      return json(200, {
        modelVersion: PROP_MODEL_VERSION,
        season: week?.season_year || new Date().getFullYear(),
        week: week
          ? {
              id: week.id,
              weekNumber: week.week_number,
              seasonYear: week.season_year,
              startDate: week.start_date || null,
              endDate: week.end_date || null,
            }
          : null,
        oddsConfigured: isOddsApiConfigured(),
      });
    }

    if (action === "search") {
      const players = await searchPlayers({
        q: body.q || q.q || q.query || q.search || "",
        team: body.team || q.team || "",
        year: body.year || q.year || q.season,
        apiKey,
        signal,
      });
      return json(200, { players }, { "cache-control": "public, max-age=60, s-maxage=120" });
    }

    if (action === "board") {
      if (!isOddsApiConfigured()) {
        return json(503, {
          error:
            "ODDS_API_KEY is not configured. Add a The Odds API key in Netlify to load weekly prop lines.",
          code: "ODDS_API_NOT_CONFIGURED",
        });
      }
      const season = Number(body.season || q.season || q.year) || new Date().getFullYear();
      const powerTeams = await loadPowerTeams(season);
      const board = await buildWeeklyPropBoard({
        season,
        apiKey,
        powerTeams,
        signal,
        force: q.force === "1" || q.refresh === "1" || body.force === true,
        maxEvents: Math.min(10, Number(q.maxEvents || body.maxEvents) || 8),
        maxProps: Math.min(40, Number(q.maxProps || body.maxProps) || 28),
      });
      return json(200, board, {
        "cache-control": board.cached
          ? "public, max-age=60, s-maxage=120"
          : "public, max-age=30, s-maxage=60",
      });
    }

    if (action === "reline") {
      const evaluation = body.evaluation;
      if (!evaluation?.distribution) {
        return json(400, { error: "evaluation.distribution required" });
      }
      const next = relineEvaluation(evaluation, body.line, body.side || evaluation.side);
      return json(200, next);
    }

    if (action === "compare") {
      return json(200, compareLegs(body.legs || []));
    }

    if (action === "analyze") {
      const legs = body.legs || [];
      const mode = body.mode || "balanced";
      return json(200, {
        analysis: analyzeEntry(legs, { payout: body.payout || body.odds }),
        best3: bestN(legs, 3, mode),
        best4: bestN(legs, Number(body.n) || 4, mode),
        compare: compareLegs(legs.filter((l) => l.selected)),
      });
    }

    if (action === "bestn" || action === "best-n") {
      return json(200, bestN(body.legs || [], Number(body.n) || 4, body.mode || "balanced"));
    }

    if (action === "entries") {
      const auth = parseAuthUser(event);
      if (auth.errorResponse) return auth.errorResponse;
      const entries = await propStore.listEntries(auth.userId);
      return json(200, { entries });
    }

    if (action === "entry" && method === "GET") {
      const auth = parseAuthUser(event);
      if (auth.errorResponse) return auth.errorResponse;
      const id = q.id || body.id;
      const row = await propStore.getEntry(auth.userId, id);
      if (!row) return json(404, { error: "Entry not found" });
      return json(200, { entry: row });
    }

    if (action === "save") {
      const auth = parseAuthUser(event);
      if (auth.errorResponse) return auth.errorResponse;
      const saved = await propStore.saveEntry({
        userId: auth.userId,
        title: body.title,
        seasonYear: body.seasonYear || body.season,
        weekNumber: body.weekNumber || body.week,
        legs: body.legs || [],
        analysis: body.analysis || null,
      });
      return json(200, { entry: saved });
    }

    if (action === "delete") {
      const auth = parseAuthUser(event);
      if (auth.errorResponse) return auth.errorResponse;
      const ok = await propStore.deleteEntry(auth.userId, body.id || q.id);
      return json(200, { ok });
    }

    if (action === "backtest-report") {
      const admin = requireAdmin(event);
      if (admin && admin.statusCode) return admin;
      try {
        const report = require("./_lib/prop-lab/baselines/latest.json");
        return json(200, report, { "cache-control": "public, max-age=60" });
      } catch {
        return json(404, {
          error: `Frozen ${PROP_MODEL_VERSION} baseline missing. Run npm run backtest:props.`,
        });
      }
    }

    if (action === "backtest-run") {
      const admin = requireAdmin(event);
      if (admin && admin.statusCode) return admin;
      const { runWalkForward, ablationDelta } = require("./_lib/prop-lab/walkforward");
      const { DOUBLE_COUNT_AUDIT } = require("./_lib/prop-lab/audit");
      const run = runWalkForward({ seed: Number(body.seed || 20260) });
      return json(200, {
        modelVersion: PROP_MODEL_VERSION,
        protocol: run.protocol,
        official: run.reports.full.test,
        validation: {
          overall: run.reports.full.val.overall,
          calibration: run.reports.full.val.calibration,
          ablations: ablationDelta(run.reports, "val"),
        },
        testAblationsConfirm: ablationDelta(run.reports, "test"),
        doubleCountAudit: DOUBLE_COUNT_AUDIT,
        note: `Live walk-forward. Official frozen baseline remains v${PROP_MODEL_VERSION} until you re-run npm run backtest:props.`,
      });
    }

    if (action === "backtest") {
      const admin = requireAdmin(event);
      if (admin && admin.statusCode) return admin;
      const season = Number(body.season || q.season) || new Date().getFullYear();
      const powerTeams = await loadPowerTeams(season);
      const cases = Array.isArray(body.cases) ? body.cases : [];
      if (!cases.length) {
        return json(400, { error: "Provide cases[] with playerId, statId, line, week, actual" });
      }
      const cfbd = createClient(apiKey, { signal });
      const rows = [];
      for (const c of cases.slice(0, 25)) {
        try {
          rows.push(
            await backtestOne({
              ...c,
              season: c.season || season,
              apiKey,
              powerTeams,
              signal,
              cfbd,
            })
          );
        } catch (err) {
          rows.push({ error: err.message, playerId: c.playerId, statId: c.statId, week: c.week });
        }
      }
      const ok = rows.filter((r) => !r.error && r.actual != null);
      await persistBacktests(ok);
      return json(200, {
        modelVersion: PROP_MODEL_VERSION,
        rows,
        metrics: metricsByStat(ok),
        calibration: calibrationBuckets(ok),
      });
    }

    if (action === "entry" || action === "evaluate-entry") {
      const season = Number(body.season || q.season || q.year) || new Date().getFullYear();
      const week = body.week != null ? Number(body.week) : q.week != null ? Number(q.week) : null;
      const powerTeams = await loadPowerTeams(season);
      const result = await evaluateEntry({
        legs: body.legs || [],
        season,
        week,
        apiKey,
        powerTeams,
        signal,
        includeDebug: isDebug(event, q) || body.debug === true,
        marketOddsByTeam: body.marketOddsByTeam || null,
      });
      return json(200, result);
    }

    // single evaluate
    const playerId = String(body.playerId || q.playerId || q.id || "").trim();
    const stat = String(body.stat || body.statId || q.stat || q.statId || "").trim();
    const line = body.line != null ? body.line : q.line;
    if (!playerId) return json(400, { error: "playerId required" });
    if (!stat) return json(400, { error: "stat required" });
    if (line == null || line === "") return json(400, { error: "line required" });

    const season = Number(body.season || q.season || q.year) || new Date().getFullYear();
    const week = body.week != null ? Number(body.week) : q.week != null ? Number(q.week) : null;
    const powerTeams = await loadPowerTeams(season);
    const result = await evaluateProp({
      playerId,
      team: body.team || q.team || "",
      name: body.name || q.name || "",
      statId: stat,
      line,
      side: body.side || q.side || "more",
      opponent: body.opponent || q.opponent || "",
      season,
      week,
      apiKey,
      powerTeams,
      signal,
      marketOdds: body.marketOdds || null,
      includeDebug: isDebug(event, q) || body.debug === true,
    });
    await recordPredictionSafely(result, { season, week });
    return json(200, result, { "cache-control": "public, max-age=20, s-maxage=40" });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return json(504, { error: "Timed out evaluating prop" });
    }
    console.error("prop-eval:", err);
    if (err.code === "ODDS_API_NOT_CONFIGURED") {
      return json(503, { error: err.message, code: err.code });
    }
    const status =
      err.code === "BAD_STAT" || err.code === "BAD_LINE"
        ? 400
        : err.code === "NO_STATS" || err.code === "NO_STAT_VALUE"
          ? 404
          : err.code === "SAVE_FAILED" || err.code === "NO_DB" || err.code === "SCHEMA_MISSING"
            ? 503
            : 502;
    return json(status, {
      error: err.message || "Prop evaluation failed",
      code: err.code || null,
    });
  } finally {
    clearTimeout(timeout);
  }
};
