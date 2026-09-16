#!/usr/bin/env node
/**
 * Grade pending Prop Lab predictions against real CFBD box scores.
 *
 *   node scripts/grade-prop-lab-week.js --season 2026 --week 3
 *   node scripts/grade-prop-lab-week.js --season 2026 --week 1-5
 *   node scripts/grade-prop-lab-week.js --season 2026 --week 3 --dry-run
 *   node scripts/grade-prop-lab-week.js --report
 *
 * Predictions are written by the normal evaluate path before kickoff. This
 * script only fills in what actually happened, so it can be run on a cron
 * every Sunday without any risk of inventing after-the-fact lines.
 */
const { gradeWeek, realCalibrationReport, gradedRows, splitByWeek } = require("../netlify/functions/_lib/prop-lab/grading");
const { hasSupabase } = require("../netlify/functions/db");
const { PROP_MODEL_VERSION } = require("../netlify/functions/_lib/prop-lab/version");

function parseArgs(argv) {
  const out = { dryRun: false, report: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--report") out.report = true;
    else if (a === "--season") out.season = Number(argv[++i]);
    else if (a === "--week") out.week = argv[++i];
    else if (a === "--source") out.source = argv[++i];
  }
  return out;
}

function weekList(spec) {
  if (spec == null) return [];
  const s = String(spec);
  if (s.includes("-")) {
    const [lo, hi] = s.split("-").map(Number);
    const out = [];
    for (let w = lo; w <= hi; w += 1) out.push(w);
    return out;
  }
  return s.split(",").map(Number).filter(Number.isFinite);
}

async function printReport(source) {
  const { n, report } = await realCalibrationReport({ source: source || "live" });
  if (!n) {
    console.log("No graded real-world rows yet. Serve some projections, then grade the week.");
    return;
  }
  const o = report.overall;
  console.log(`\nReal graded rows: ${n}`);
  console.log(
    `  MAE=${o.mae}  Brier=${o.brier}  ECE=${o.calibrationError}  ` +
      `hitRate=${(o.hitRate * 100).toFixed(1)}%  predicted=${(o.predictedProbability * 100).toFixed(1)}%`
  );
  console.log("\n  Calibration:");
  for (const b of report.calibration) {
    if (!b.n) continue;
    console.log(
      `    ${b.band.padEnd(8)} n=${String(b.n).padStart(4)} ` +
        `pred=${(b.predicted * 100).toFixed(1)}%  act=${(b.actual * 100).toFixed(1)}%  ` +
        `gap=${(b.gap * 100).toFixed(1)}`
    );
  }

  const rows = await gradedRows({ source: source || "live" });
  const splits = splitByWeek(rows);
  console.log(
    `\n  Weeks covered: ${splits.weeks.join(", ")} ` +
      `(train ${splits.train.length} / val ${splits.val.length} / test ${splits.test.length})`
  );
  const READY = 400;
  console.log(
    rows.length >= READY
      ? `\n  ${rows.length} rows is enough to refit on real data: node scripts/fit-prop-lab-calibrator.js --real`
      : `\n  ${rows.length}/${READY} rows toward a real-data refit.`
  );
}

async function main() {
  const args = parseArgs(process.argv);

  if (!hasSupabase()) {
    console.error("Supabase is not configured. Set SUPABASE_SERVICE_ROLE_KEY to use the grading ledger.");
    process.exit(1);
  }

  if (args.report) {
    await printReport(args.source);
    return;
  }

  const apiKey = (process.env.CFBD_API_KEY || "").trim();
  if (!apiKey) {
    console.error("CFBD_API_KEY is required to grade against real box scores.");
    process.exit(1);
  }

  const season = args.season || new Date().getFullYear();
  const weeks = weekList(args.week);
  if (!weeks.length) {
    console.error("Pass --week 3 or --week 1-5");
    process.exit(1);
  }

  console.log(`Grading ${PROP_MODEL_VERSION} predictions for ${season} weeks ${weeks.join(", ")}`);
  let totalGraded = 0;
  for (const week of weeks) {
    const res = await gradeWeek({ season, week, apiKey, dryRun: args.dryRun });
    totalGraded += res.graded;
    console.log(
      `  week ${String(week).padStart(2)}: pending=${res.pending} graded=${res.graded} ungraded=${res.ungraded}` +
        (args.dryRun ? "  (dry run, nothing written)" : "")
    );
  }
  console.log(`\nGraded ${totalGraded} prediction${totalGraded === 1 ? "" : "s"}.`);
  if (totalGraded) await printReport(args.source);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
