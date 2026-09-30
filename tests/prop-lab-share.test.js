/**
 * Prop Lab share snapshot unit tests (no live network required for core helpers).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  snapshotLeg,
  serializePropCard,
  payloadContentHash,
  slimAnalysis,
} = require("../netlify/functions/_lib/prop-lab/store");

describe("serializePropCard", () => {
  const leg = {
    player: { id: "espn:1", name: "Test Player", team: "Alabama", position: "WR" },
    opponent: { name: "Georgia", homeAway: "home", week: 4 },
    stat: { id: "rec_yds", label: "Receiving yards", short: "REC YDS" },
    line: 82.5,
    side: "more",
    projection: 91.2,
    pMore: 0.63,
    pLess: 0.37,
    pHit: 0.63,
    confidence: "B",
    propScore: 86,
    propScoreLabel: "Lean",
    flags: ["Small Sample"],
    why: ["Strong recent form"],
    caution: ["Small sample"],
    matchup: {
      headline: "Favorable",
      adjPctDisplay: 4.2,
      factors: [{ label: "Pass yards allowed", quality: "Poor", adj: 0.04 }],
    },
    form: { season: 88, l3: 95, games: 3 },
    modelVersion: "2.1.0",
  };

  it("stores snapshot legs without re-eval fields dumping secrets", () => {
    const card = serializePropCard({
      legs: [leg],
      analysis: {
        grade: "B",
        together: { p: 0.4, label: "40%" },
        value: { verdictLabel: "Lean", summary: "ok", payout: { label: "3x" } },
      },
      title: "Test card",
      seasonYear: 2026,
      weekNumber: 4,
      payoutOdds: "3x",
    });
    assert.equal(card.v, 2);
    assert.equal(card.legs.length, 1);
    assert.equal(card.legs[0].playerName, "Test Player");
    assert.equal(card.legs[0].opponent.name, "Georgia");
    assert.equal(card.legs[0].matchup.headline, "Favorable");
    assert.equal(card.payoutOdds, "3x");
    assert.ok(!JSON.stringify(card).includes("CFBD_API_KEY"));
    assert.ok(!JSON.stringify(card).includes("service_role"));
  });

  it("content hash is stable for identical cards", () => {
    const a = serializePropCard({ legs: [leg], title: "A", seasonYear: 2026, weekNumber: 4 });
    const b = serializePropCard({ legs: [leg], title: "A", seasonYear: 2026, weekNumber: 4 });
    assert.equal(payloadContentHash(a), payloadContentHash(b));
  });

  it("snapshotLeg freezes display fields", () => {
    const snap = snapshotLeg(leg);
    assert.equal(snap.frozen, true);
    assert.equal(snap.statId, "rec_yds");
    assert.equal(snap.projection, 91.2);
  });

  it("slimAnalysis drops heavy strongest/weakest dumps", () => {
    const slim = slimAnalysis({
      grade: "C",
      strongest: { debug: { huge: true } },
      weakest: { debug: { huge: true } },
      strongestCaption: "Cap",
      riskDrivers: ["a"],
    });
    assert.equal(slim.grade, "C");
    assert.equal(slim.strongestCaption, "Cap");
    assert.equal(slim.strongest, undefined);
  });
});
