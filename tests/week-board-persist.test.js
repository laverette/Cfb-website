const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { leanPersistedScore } = require(path.join(
  __dirname,
  "..",
  "netlify",
  "functions",
  "_lib",
  "prop-lab",
  "lean-score.js"
));

describe("week board persistence", () => {
  it("strips bothSides before persisting scores", () => {
    const lean = leanPersistedScore({
      projectionId: "1",
      propScore: 88,
      bothSides: {
        more: { propScore: 88 },
        less: { propScore: 40 },
      },
    });
    assert.equal(lean.projectionId, "1");
    assert.equal(lean.propScore, 88);
    assert.equal(lean.bothSides, undefined);
  });
});
