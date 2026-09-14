const { clamp, toNum } = require("./math");

function blowoutRisk({ spread, total, homeAway }) {
  const abs = Math.abs(Number(spread) || 0);
  if (abs >= 28) return "High";
  if (abs >= 17) return "Medium";
  if (abs >= 10) return "Low";
  return "Low";
}

function gameEnvironment(bundle, def, marketOdds) {
  const market = marketOdds || bundle.market || null;
  const spread = toNum(market?.spread);
  const total = toNum(market?.total);
  const homeAway = bundle.opponent?.homeAway || null;
  const risk = blowoutRisk({ spread, total, homeAway });

  let adjPct = 0;
  const notes = [];

  if (homeAway === "home") {
    adjPct += 0.015;
    notes.push("Slight home environment bump");
  } else if (homeAway === "away") {
    adjPct -= 0.01;
    notes.push("Slight road haircut");
  }

  if (Number.isFinite(spread)) {
    const fav = spread < 0;
    const abs = Math.abs(spread);
    if (fav && abs >= 21) {
      if (def.family === "passing" || def.family === "receiving") {
        adjPct -= clamp((abs - 17) * 0.004, 0, 0.08);
        notes.push("Large favorite: late-game pass volume may shrink");
      }
      if (def.family === "rushing") {
        adjPct += clamp((abs - 17) * 0.003, 0, 0.06);
        notes.push("Large favorite: rushing volume may increase if they sit on a lead");
      }
    }
    if (!fav && abs >= 14) {
      if (def.family === "passing" || def.family === "receiving") {
        adjPct += clamp((abs - 10) * 0.003, 0, 0.06);
        notes.push("Underdog: more likely to live in passing situations");
      }
      if (def.family === "rushing" && def.id !== "rush_td") {
        adjPct -= clamp((abs - 10) * 0.0025, 0, 0.05);
        notes.push("Underdog: traditional rushing volume often compressed");
      }
    }
  }

  if (Number.isFinite(total) && total >= 65 && (def.family === "passing" || def.family === "receiving")) {
    adjPct += 0.02;
    notes.push("High expected total");
  }
  if (Number.isFinite(total) && total <= 42) {
    adjPct -= 0.015;
    notes.push("Low expected total");
  }

  adjPct = clamp(adjPct, -0.1, 0.1);

  const passVolume =
    bundle.teamAdv?.offense?.plays && bundle.teamOffense
      ? null
      : null;

  return {
    spread,
    total,
    homeAway,
    blowoutRisk: risk,
    adjPct,
    notes,
    passVolume,
    source: market?.source || (market ? "odds" : null),
    available: Boolean(market && (spread != null || total != null)),
  };
}

module.exports = { gameEnvironment, blowoutRisk };
