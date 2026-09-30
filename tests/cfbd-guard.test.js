/**
 * CFBD background guard + execution context tests.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "../netlify/functions/_lib");
const {
  withExecutionContext,
  getExecutionContext,
  isBackgroundContext,
} = require(path.join(root, "execution-context"));
const {
  assertCfbdAllowed,
  recordCfbdCall,
  cfbdUsageSnapshot,
  policyAllowsCfbd,
  providersFor,
  CfbdBackgroundUsageError,
  _resetCfbdCounters,
} = require(path.join(root, "cfbd-guard"));
const { createClient } = require(path.join(root, "prop-lab/cfbd-client"));

describe("execution context", () => {
  it("defaults to interactive", () => {
    assert.equal(getExecutionContext(), "interactive");
    assert.equal(isBackgroundContext(), false);
  });

  it("sets background inside withExecutionContext", async () => {
    await withExecutionContext("background", async () => {
      assert.equal(getExecutionContext(), "background");
      assert.equal(isBackgroundContext(), true);
    });
    assert.equal(getExecutionContext(), "interactive");
  });
});

describe("provider policy", () => {
  it("background never lists cfbd", () => {
    for (const cap of ["playerStats", "teamStats", "schedule", "scores", "grading"]) {
      assert.equal(policyAllowsCfbd(cap, "background"), false);
      assert.ok(!providersFor(cap, "background").includes("cfbd"));
    }
  });

  it("interactive allows cfbd for analytics caps", () => {
    assert.equal(policyAllowsCfbd("playerStats", "interactive"), true);
    assert.equal(policyAllowsCfbd("teamStats", "interactive"), true);
  });
});

describe("CFBD hard guard", () => {
  beforeEach(() => {
    _resetCfbdCounters();
    delete process.env.ALLOW_BACKGROUND_CFBD;
  });

  it("allows interactive CFBD", () => {
    withExecutionContext("interactive", () => {
      assert.doesNotThrow(() =>
        assertCfbdAllowed({ caller: "test", endpoint: "/games" })
      );
      recordCfbdCall({ caller: "test", endpoint: "/games" });
      const snap = cfbdUsageSnapshot();
      assert.equal(snap.allowed, 1);
      assert.equal(snap.blocked, 0);
    });
  });

  it("blocks background CFBD", async () => {
    await withExecutionContext("background", async () => {
      assert.throws(
        () => assertCfbdAllowed({ caller: "grade-picks", endpoint: "/games" }),
        (err) => err instanceof CfbdBackgroundUsageError || err.code === "CFBD_BACKGROUND_BLOCKED"
      );
      const snap = cfbdUsageSnapshot();
      assert.equal(snap.blocked, 1);
      assert.equal(snap.allowed, 0);
    });
  });

  it("background createClient network path is blocked", async () => {
    await withExecutionContext(
      "background",
      async () => {
        const client = createClient("fake-key", { caller: "scheduled-job" });
        await assert.rejects(
          () => client.rawGet("/games", { year: 2026, week: 5 }),
          (err) => err.code === "CFBD_BACKGROUND_BLOCKED"
        );
      },
      { caller: "scheduled-job" }
    );
  });

  it("ALLOW_BACKGROUND_CFBD=true is the only override", async () => {
    process.env.ALLOW_BACKGROUND_CFBD = "true";
    await withExecutionContext("background", async () => {
      assert.doesNotThrow(() =>
        assertCfbdAllowed({ caller: "forced", endpoint: "/games" })
      );
    });
    delete process.env.ALLOW_BACKGROUND_CFBD;
  });
});

describe("scheduled function config", () => {
  it("grade-picks is hourly not every-minute/15", () => {
    const grade = require(path.join(
      __dirname,
      "../netlify/functions/grade-picks.js"
    ));
    assert.equal(grade.config.schedule, "0 * * * *");
    assert.ok(!String(grade.config.schedule).startsWith("*/"));
  });

  it("pick-reminders remains Saturday dual UTC hours", () => {
    const rem = require(path.join(
      __dirname,
      "../netlify/functions/pick-reminders.js"
    ));
    assert.equal(rem.config.schedule, "0 14,15 * * 6");
  });

  it("grade-picks lib has no collegefootballdata URL", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "../netlify/functions/_lib/grade-picks.js"),
      "utf8"
    );
    assert.ok(!src.includes("api.collegefootballdata.com"));
  });

  it("live-scores has no collegefootballdata URL", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "../netlify/functions/live-scores.js"),
      "utf8"
    );
    assert.ok(!src.includes("api.collegefootballdata.com"));
  });
});
