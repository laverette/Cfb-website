#!/usr/bin/env node
/**
 * Freeze Model 2.0.0 walk-forward backtest summaries.
 * Does not fit parameters. TEST split is the official scorecard.
 *
 *   node scripts/run-prop-lab-backtest.js
 */
const fs = require("fs");
const path = require("path");
const { runWalkForward, ablationDelta } = require("../netlify/functions/_lib/prop-lab/walkforward");
const { DOUBLE_COUNT_AUDIT } = require("../netlify/functions/_lib/prop-lab/audit");
const { PROP_MODEL_VERSION } = require("../netlify/functions/_lib/prop-lab/version");

function pct(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Number((n * 100).toFixed(1));
}

function main() {
  const started = Date.now();
  const run = runWalkForward({ seed: 20260 });
  const valAblation = ablationDelta(run.reports, "val");
  const testAblation = ablationDelta(run.reports, "test");
  const test = run.reports.full.test;
  const val = run.reports.full.val;

  const payload = {
    baselineVersion: PROP_MODEL_VERSION,
    frozen: true,
    elapsedMs: Date.now() - started,
    protocol: run.protocol,
    official: {
      split: "test",
      overall: test.overall,
      byStat: test.byStat,
      byConfidence: test.byConfidence,
      byPropScore: test.byPropScore,
      bySample: test.bySample,
      bySpread: test.bySpread,
      byRole: test.byRole,
      calibration: test.calibration,
    },
    validation: {
      split: "val",
      overall: val.overall,
      calibration: val.calibration,
      ablations: valAblation,
    },
    train: {
      split: "train",
      overall: run.reports.full.train.overall,
    },
    testAblationsConfirm: testAblation,
    ablationsFull: Object.fromEntries(
      Object.entries(run.reports).map(([k, v]) => [
        k,
        { n: v.n, train: v.train.overall, val: v.val.overall, test: v.test.overall },
      ])
    ),
    doubleCountAudit: DOUBLE_COUNT_AUDIT,
    generatedAt: run.generatedAt,
  };

  payload.findings = [
    {
      rank: 1,
      title: "Tail probabilities are not calibrated",
      evidence:
        "TEST 70%+ band: predicted 74.0% vs actual 44.1% (n=34). 55–59% and 60–64% bands are also ~13–14 points overconfident. Overall ECE 0.044 hides a severe tail problem.",
      v21:
        "Fit a monotone calibrator (isotonic or temperature) on TRAIN only, freeze it on VAL, and never touch TEST while choosing the map. Cap displayed P(hit) until the 70%+ band is within ~5 points.",
    },
    {
      rank: 2,
      title: "Recency and role trend double-count the same recent games",
      evidence:
        "VAL MAE improves when recency/role is removed (−0.16). TEST then reverses slightly (+0.08). The sign flip across splits is exactly why we must not ship a VAL-only tweak — but the audit is still valid: EWMA weights plus a ±12% Rising bump reuse last-3 usage.",
      v21:
        "Keep a single recency channel on opportunity share, not a second multiplicative role bump on yards. Re-evaluate on VAL; confirm on a later season, not this TEST freeze.",
    },
    {
      rank: 3,
      title: "Opportunity blend re-injects usage already inside the season mean",
      evidence:
        "Baseline is built from the same game logs as rec/carry/attempt share. Full model still beats raw season average on VAL and TEST (TEST MAE +0.24 without the full stack), so opportunity is not useless — it is just entangled with the mean.",
      v21:
        "Project volume × share × efficiency, and treat residual yards as the shrinkage target. Do not average a usage-derived projection with a usage-laden yards/game mean.",
    },
    {
      rank: 4,
      title: "Confidence letters track sample size, not hit quality",
      evidence:
        "TEST grade A (n=275) hits 46.6% with predicted 46.6% — a coin flip with an A sticker. Grade D hits 56.1%. Late-season 8+ samples auto-promote to A/A- even when the line is on top of the mean.",
      v21:
        "Require both sample and a minimum |pHit−0.5| (or Brier skill vs 0.25) before A/A-. Confidence should mean 'the distribution is trustworthy', not 'we have seen eight games'.",
    },
    {
      rank: 5,
      title: "Yardage MAE is large; TD/count stats are the better-behaved family",
      evidence:
        "TEST rec_yds MAE 29.3 / pass_yds MAE 46.2 vs rec_td 0.60 and pass_int 0.65. MedAE is much lower than MAE (overall 1.73 vs 10.20) — a fat error tail. Dog 7–13 ECE 0.122. Prop Score 'Strong' (n=37) predicted 29.8% vs actual 51.4% — the ranking score is not a probability.",
      v21:
        "Use heavier-tailed yardage noise (Student-t / mixture) and collapse correlated pass-defense z-scores to one factor plus an explosive residual. Keep Prop Score as a ranker; never treat 76/100 as ~76% to hit.",
    },
  ];

  const outDir = path.join(__dirname, "..", "netlify", "functions", "_lib", "prop-lab", "baselines");
  fs.mkdirSync(outDir, { recursive: true });
  const frozenPath = path.join(outDir, "v2.0.0.json");
  fs.writeFileSync(frozenPath, JSON.stringify(payload, null, 2));

  const frontDir = path.join(__dirname, "..", "Frontend", "data");
  fs.mkdirSync(frontDir, { recursive: true });
  fs.writeFileSync(path.join(frontDir, "prop-lab-backtest-2.0.0.json"), JSON.stringify(payload));

  const o = test.overall;
  console.log(`Frozen ${PROP_MODEL_VERSION} TEST n=${o.n} MAE=${o.mae} Brier=${o.brier} ECE=${o.calibrationError}`);
  console.log(`Wrote ${frozenPath}`);
  console.log(
    "VAL ablation MAE deltas:",
    valAblation.map((a) => `${a.ablation}:${a.maeDeltaVsFull > 0 ? "+" : ""}${Number(a.maeDeltaVsFull).toFixed(3)}`).join(" ")
  );
}

main();
