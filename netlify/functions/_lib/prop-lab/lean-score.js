/**
 * Drop bulky bothSides trees before persisting. Keeping every More/Less eval in
 * scores_json made mid-board upserts balloon until the background job stalled.
 */
function leanPersistedScore(score) {
  if (!score || typeof score !== "object") return score;
  const { bothSides: _bothSides, ...rest } = score;
  return rest;
}

module.exports = {
  leanPersistedScore,
};
