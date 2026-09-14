const { clamp, mean, stddev } = require("./math");

/**
 * Predictive SD. Small samples widen the distribution, but we do not apply a
 * giant blanket multiplier on top of an already mixed historical SD.
 */
function buildPredictiveSd({
  sampleValues,
  priorValues,
  def,
  roleStable = true,
  matchupMissing = false,
  blowoutRisk = "Low",
  projection = null,
}) {
  const sampleSd = stddev(sampleValues);
  const priorSd = stddev(priorValues);
  const games = (sampleValues || []).filter((n) => Number.isFinite(n)).length;
  const catalog = Number(def?.priorSd) || 20;
  const poisson = def?.dist === "poisson";

  let historical = null;
  if (Number.isFinite(sampleSd) && games >= 4) historical = sampleSd;
  else {
    const mix = [];
    if (Number.isFinite(sampleSd) && sampleSd >= catalog * 0.4) mix.push(sampleSd);
    if (Number.isFinite(priorSd)) mix.push(priorSd);
    mix.push(catalog);
    historical = mean(mix);
  }
  const base = Math.max(historical || catalog, catalog * 0.45);

  let sampleComp = 0;
  if (games <= 2) sampleComp = catalog * 0.2;
  else if (games === 3) sampleComp = catalog * 0.1;
  else if (games < 6) sampleComp = catalog * 0.05;

  const roleComp = roleStable ? 0 : catalog * 0.08;
  const matchupComp = matchupMissing ? catalog * 0.05 : 0;
  const envComp =
    blowoutRisk === "High" ? catalog * 0.07 : blowoutRisk === "Medium" ? catalog * 0.03 : 0;

  const combined = Math.sqrt(base ** 2 + sampleComp ** 2 + roleComp ** 2 + matchupComp ** 2 + envComp ** 2);
  const floor = catalog * (poisson ? 0.4 : 0.5);
  const ceil = catalog * (poisson ? 1.35 : 1.48);
  const poissonMean = Number.isFinite(projection) ? projection : mean(sampleValues) || 1;
  const final = poisson
    ? clamp(Math.sqrt(Math.max(poissonMean, 0.25)), floor, ceil)
    : clamp(combined, floor, ceil);

  return {
    base: Number(base.toFixed(3)),
    historical: Number((historical || catalog).toFixed(3)),
    sampleSd: sampleSd == null ? null : Number(sampleSd.toFixed(3)),
    priorSd: priorSd == null ? null : Number(priorSd.toFixed(3)),
    sampleComponent: Number(sampleComp.toFixed(3)),
    roleComponent: Number(roleComp.toFixed(3)),
    matchupComponent: Number(matchupComp.toFixed(3)),
    environmentComponent: Number(envComp.toFixed(3)),
    final: Number(final.toFixed(3)),
    floor,
    ceil,
    games,
  };
}

module.exports = { buildPredictiveSd };
