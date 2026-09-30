/**
 * Map ESPN team metrics → rating rows consumed by predictMatchup().
 * Missing metrics stay null and are skipped in weighted blends (not treated as 0).
 */

const { clamp, round } = require("./normalize");

const FBS_AVG_PPG = 28;
const FBS_AVG_YPG = 380;

function weightedMean(parts) {
  let sum = 0;
  let w = 0;
  for (const p of parts) {
    if (!Number.isFinite(p?.value) || !Number.isFinite(p?.weight) || p.weight <= 0) continue;
    sum += p.value * p.weight;
    w += p.weight;
  }
  if (w <= 0) return null;
  return sum / w;
}

function offenseRatingFromMetrics(m) {
  if (!m) return null;
  return weightedMean([
    { value: m.pointsPerGame != null ? m.pointsPerGame - FBS_AVG_PPG : null, weight: 1.0 },
    {
      value: m.yardsPerGame != null ? ((m.yardsPerGame - FBS_AVG_YPG) / 50) * 2.5 : null,
      weight: 0.55,
    },
    {
      value:
        m.passingYardsPerGame != null && m.rushingYardsPerGame != null
          ? (((m.passingYardsPerGame + m.rushingYardsPerGame) / 2 - FBS_AVG_YPG / 2) / 40) * 2
          : null,
      weight: 0.25,
    },
  ]);
}

function defenseRatingFromMetrics(m) {
  if (!m) return null;
  // Higher is better (fewer points/yards allowed).
  return weightedMean([
    {
      value: m.pointsAllowedPerGame != null ? FBS_AVG_PPG - m.pointsAllowedPerGame : null,
      weight: 1.0,
    },
    {
      value:
        m.yardsAllowedPerGame != null ? ((FBS_AVG_YPG - m.yardsAllowedPerGame) / 50) * 2.5 : null,
      weight: 0.55,
    },
  ]);
}

function recentFormPoints(form) {
  if (!form || !Number.isFinite(form.avgMargin)) return null;
  // Soften margins so early cupcake blowouts don't dominate.
  const soft = Math.sign(form.avgMargin) * Math.log1p(Math.abs(form.avgMargin));
  return clamp(soft * 1.35, -6, 6);
}

/**
 * Build a predictMatchup-compatible team object from ESPN matchup side.
 */
function teamFromEspnSide(side, { snapshotTeam = null } = {}) {
  const metrics = side.metrics || {};
  const off = offenseRatingFromMetrics(metrics);
  const def = defenseRatingFromMetrics(metrics);
  const formPts = recentFormPoints(side.recentForm);

  const units = [];
  if (Number.isFinite(off)) units.push({ value: off, weight: 1 });
  if (Number.isFinite(def)) units.push({ value: def, weight: 1.05 });
  if (Number.isFinite(formPts)) units.push({ value: formPts, weight: 0.55 });

  let rawPower = weightedMean(units);
  // Soft blend with existing snapshot if present (still zero CFBD calls).
  if (snapshotTeam && Number.isFinite(Number(snapshotTeam.rawPower)) && Number.isFinite(rawPower)) {
    rawPower = rawPower * 0.65 + Number(snapshotTeam.rawPower) * 0.35;
  } else if (!Number.isFinite(rawPower) && snapshotTeam && Number.isFinite(Number(snapshotTeam.rawPower))) {
    rawPower = Number(snapshotTeam.rawPower);
  }

  if (!Number.isFinite(rawPower)) {
    throw new Error(`Insufficient ESPN metrics for ${side.name || side.espnId}`);
  }

  const talentRating =
    snapshotTeam && Number.isFinite(Number(snapshotTeam.talentRating))
      ? Number(snapshotTeam.talentRating)
      : 50;

  const powerScore = clamp(50 + rawPower * 2.2, 0, 100);

  return {
    teamId: Number(side.espnId) || side.espnId,
    name: side.name,
    abbreviation: side.abbreviation || null,
    rawPower: round(rawPower, 2),
    powerScore: round(powerScore, 1),
    offenseRating: off != null ? round(off, 2) : snapshotTeam?.offenseRating ?? null,
    defenseRating: def != null ? round(def, 2) : snapshotTeam?.defenseRating ?? null,
    specialTeamsRating: snapshotTeam?.specialTeamsRating ?? 0,
    talentRating: round(talentRating, 1),
    sosRating: snapshotTeam?.sosRating ?? null,
    record: side.record || snapshotTeam?.record || null,
    metrics,
    recentForm: side.recentForm || null,
    source: "espn",
  };
}

function buildEspnRatingPair(input, { snapshotById = new Map() } = {}) {
  const awaySnap = snapshotById.get(String(input.awayTeam.espnId)) || null;
  const homeSnap = snapshotById.get(String(input.homeTeam.espnId)) || null;
  return {
    teamA: teamFromEspnSide(input.awayTeam, { snapshotTeam: awaySnap }),
    teamB: teamFromEspnSide(input.homeTeam, { snapshotTeam: homeSnap }),
    venue: input.neutralSite ? "neutral" : "b_home",
  };
}

module.exports = {
  offenseRatingFromMetrics,
  defenseRatingFromMetrics,
  recentFormPoints,
  teamFromEspnSide,
  buildEspnRatingPair,
  FBS_AVG_PPG,
  FBS_AVG_YPG,
};
