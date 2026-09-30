/**
 * Week-scoped game lookup — includes completed/final games.
 * Never use nextUnplayed for historical Prop Lab week selection.
 */
function getTeamGameForWeek(schedule, week) {
  if (week == null || !Array.isArray(schedule)) return null;
  const w = Number(week);
  if (!Number.isFinite(w)) return null;
  const hits = schedule.filter((g) => Number(g.week) === w && g.opponent);
  if (!hits.length) return null;
  // Prefer non-canceled; completed finals are valid
  const active = hits.find((g) => !/cancel/i.test(String(g.notes || g.status || "")));
  return active || hits[0];
}

module.exports = {
  getTeamGameForWeek,
};
