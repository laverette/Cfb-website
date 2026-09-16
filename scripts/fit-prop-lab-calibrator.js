#!/usr/bin/env node
/**
 * Fit the Prop Lab probability calibrator.
 *
 * Protocol, and it matters:
 *   - Candidates are fit on TRAIN only (weeks 2-6).
 *   - The winner is chosen on VAL (weeks 7-9) by log loss.
 *   - TEST (weeks 10-14) is never read here. Scoring TEST is a separate step
 *     (run-prop-lab-backtest.js) so the selection cannot peek at it.
 *
 * Input rows come from the `no_calibration` ablation, so the fit always sees
 * the uncalibrated model even when a frozen calibrator is already installed.
 *
 *   node scripts/fit-prop-lab-calibrator.js
 */
const fs = require("fs");
const path = require("path");
const { runWalkForward } = require("../netlify/functions/_lib/prop-lab/walkforward");
const {
  selectCalibrator,
  scoreCalibrator,
  resetCalibratorCache,
  describe,
  paramCount,
  IDENTITY,
} = require("../netlify/functions/_lib/prop-lab/calibration");
const { PROP_MODEL_VERSION } = require("../netlify/functions/_lib/prop-lab/version");

function bySplit(rows) {
  const out = { train: [], val: [], test: [] };
  for (const r of rows) {
    if (out[r.split]) out[r.split].push(r);
  }
  return out;
}

function fmtTable(label, score) {
  if (!score) return `${label}: no data`;
  const bands = score.table
    .filter((b) => b.n)
    .map((b) => `${b.band} n=${b.n} pred=${(b.predicted * 100).toFixed(1)} act=${(b.actual * 100).toFixed(1)}`)
    .join("\n    ");
  return `${label}: logLoss=${score.logLoss} brier=${score.brier} ece=${score.ece}\n    ${bands}`;
}

const MIN_REAL_ROWS = 400;

/**
 * Real graded rows beat synthetic ones whenever there are enough of them.
 * Below the threshold the fit would just be memorizing a handful of weeks.
 */
async function loadRealSplits() {
  const { gradedRows, splitByWeek } = require("../netlify/functions/_lib/prop-lab/grading");
  const { hasSupabase } = require("../netlify/functions/db");
  if (!hasSupabase()) return null;
  let rows = [];
  try {
    rows = await gradedRows({ source: "live" });
  } catch (err) {
    console.warn(`  could not read graded rows: ${err.message}`);
    return null;
  }
  if (rows.length < MIN_REAL_ROWS) {
    if (rows.length) {
      console.log(`  ${rows.length}/${MIN_REAL_ROWS} real graded rows — staying on synthetic for now.`);
    }
    return null;
  }
  // Real rows carry the calibrated pHit that was served. Fit against the
  // uncalibrated value so the new map replaces the old one rather than
  // stacking on top of it.
  const usable = rows
    .filter((r) => r.pUncalibrated != null)
    .map((r) => ({ ...r, pHit: r.pUncalibrated }));
  if (usable.length < MIN_REAL_ROWS) {
    console.log(
      `  only ${usable.length} real rows carry an uncalibrated probability — staying on synthetic.`
    );
    return null;
  }
  return { ...splitByWeek(usable), source: "real" };
}

async function main() {
  resetCalibratorCache();
  const started = Date.now();
  const useReal = process.argv.includes("--real");

  let splits = null;
  let source = "synthetic";
  if (useReal) {
    console.log("Looking for real graded rows...");
    const real = await loadRealSplits();
    if (real) {
      splits = real;
      source = "real";
      console.log(`  using ${real.train.length + real.val.length + real.test.length} real graded rows`);
    }
  }

  if (!splits) {
    console.log("Running walk-forward to collect uncalibrated rows...");
    const run = runWalkForward({ seed: 20260, ablations: ["no_calibration"] });
    splits = bySplit(run.rows.no_calibration || []);
  }

  console.log(
    `  rows train=${splits.train.length} val=${splits.val.length} test=${splits.test.length} (test withheld)`
  );

  const selection = selectCalibrator(splits.train, splits.val);
  const best = selection.best;

  console.log("\nCandidates (ranked by macro-averaged VAL log loss):");
  for (const entry of selection.ranked) {
    const c = entry.calibrator;
    console.log(
      `  ${describe(c).padEnd(46)} params=${String(paramCount(c)).padStart(2)}  ` +
        `macroLL=${entry.val?.macroLogLoss}  ece=${entry.val?.ece}`
    );
  }

  console.log("\nComplexity ledger (each step must pay for its parameters):");
  for (const step of selection.parsimony.ledger) {
    console.log(
      `  ${step.candidate.padEnd(46)} +${step.extraParams}p  ` +
        `needs ${(step.required * 100).toFixed(2)}%  got ${step.improvement == null ? "n/a" : (step.improvement * 100).toFixed(2) + "%"}  ` +
        `${step.accepted ? "ACCEPT" : "reject"}`
    );
  }

  console.log(`\nSelected: ${describe(best)}`);
  console.log(
    `Correction applies in full to |z| <= ${best.zSupport ?? "n/a"} and fades beyond it.`
  );
  console.log(`Catastrophe cap: ${(best.maxProbability * 100).toFixed(1)}%`);

  console.log("\nBefore vs after on VAL:");
  console.log("  " + fmtTable("uncalibrated", scoreCalibrator(IDENTITY, splits.val)));
  console.log("  " + fmtTable("calibrated  ", scoreCalibrator(best, splits.val)));

  const payload = {
    modelVersion: PROP_MODEL_VERSION,
    frozen: true,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    dataSource: source,
    protocol: {
      fitOn:
        source === "real"
          ? "earliest graded weeks, uncalibrated probability"
          : "TRAIN weeks 2-6, no_calibration ablation",
      selectedOn: "VAL split by log loss, with a parsimony margin",
      testWithheld: true,
      symmetrized: "each row mirrored so f(1-p) = 1-f(p)",
    },
    calibrator: best,
    selection: selection.candidates.map((entry) => ({
      method: entry.calibrator.method,
      temperature: entry.calibrator.temperature ?? null,
      maxProbability: entry.calibrator.maxProbability,
      train: entry.train,
      val: entry.val,
    })),
  };

  const outDir = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab", "baselines");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "calibrator.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outPath} (source: ${source})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
