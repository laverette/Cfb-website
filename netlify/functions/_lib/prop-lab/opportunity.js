const { mean, toNum, clamp } = require("./math");
const { extractStatValue } = require("./parse");

function num(v, fallback = null) {
  const n = toNum(v);
  return n == null ? fallback : n;
}

function teamVolume(bundle) {
  const off = bundle.teamOffense || {};
  const adv = bundle.teamAdv?.offense || {};
  const games = Math.max(1, Number(off.games) || bundle.gameLogs?.length || 1);
  const passAtt = num(off.passattempts ?? off["passingattempts"] ?? off.attempts);
  const rushAtt = num(off.rushingattempts ?? off["rushattempts"]);
  const completions = num(off.completions ?? off.passcompletions);
  const plays = num(adv.plays) || (passAtt != null && rushAtt != null ? passAtt + rushAtt : null);
  return {
    games,
    passAttPerGame: passAtt != null ? passAtt / games : null,
    rushAttPerGame: rushAtt != null ? rushAtt / games : null,
    completionsPerGame: completions != null ? completions / games : null,
    playsPerGame: plays != null ? plays / games : null,
    passRate:
      plays && passAtt != null ? passAtt / Math.max(plays, 1) : passAtt != null && rushAtt != null
        ? passAtt / Math.max(passAtt + rushAtt, 1)
        : null,
  };
}

function playerAverages(logs, statId) {
  const values = (logs || [])
    .map((g) => (statId ? extractStatValue(g.stats || {}, statId) : g.value))
    .filter((n) => Number.isFinite(n));
  return {
    games: values.length,
    avg: mean(values),
    values,
  };
}

function share(playerPerGame, teamPerGame) {
  if (!Number.isFinite(playerPerGame) || !Number.isFinite(teamPerGame) || teamPerGame <= 0) {
    return null;
  }
  return clamp(playerPerGame / teamPerGame, 0, 1);
}

/**
 * Opportunity × efficiency. Inferred shares are labeled as estimates.
 */
function estimateOpportunity(bundle, def) {
  const vol = teamVolume(bundle);
  const logs = bundle.gameLogs || [];
  const usage = bundle.usage || {};
  const inferred = [];

  const recAvg = usage.rec;
  const recYds = usage.recYds;
  const rushAtt = usage.rushAtt;
  const rushYds = usage.rushYds;
  const passAtt = usage.passAtt;
  const passYds = usage.passYds;

  const recShare = share(recAvg, vol.completionsPerGame);
  const carryShare = share(rushAtt, vol.rushAttPerGame);
  const attShare = share(passAtt, vol.passAttPerGame);

  if (recShare != null) inferred.push("receiving share estimated from receptions / team completions");
  if (carryShare != null) inferred.push("carry share estimated from rushes / team rush attempts");

  const ypr = recAvg > 0 && recYds != null ? recYds / recAvg : null;
  const ypc = rushAtt > 0 && rushYds != null ? rushYds / rushAtt : null;
  const ypa = passAtt > 0 && passYds != null ? passYds / passAtt : null;
  const compPct =
    passAtt > 0 && usage.passAtt
      ? (logs.reduce((s, g) => s + (g.stats?.pass_comp || 0), 0) / logs.length) / passAtt
      : null;

  let opportunity = null;
  let efficiency = null;
  let rawOppProj = null;

  if (def.family === "receiving") {
    opportunity = recAvg;
    efficiency = def.id === "rec" ? 1 : ypr;
    if (vol.completionsPerGame && recShare != null) {
      opportunity = vol.completionsPerGame * recShare;
    }
    rawOppProj =
      def.id === "rec"
        ? opportunity
        : def.id === "rec_td"
          ? (opportunity || 0) * (usage.recTd && recAvg ? usage.recTd / recAvg : 0.08)
          : opportunity != null && efficiency != null
            ? opportunity * efficiency
            : null;
  } else if (def.family === "rushing") {
    opportunity = rushAtt;
    efficiency = def.id === "rush_att" ? 1 : ypc;
    if (vol.rushAttPerGame && carryShare != null) {
      opportunity = vol.rushAttPerGame * carryShare;
    }
    rawOppProj =
      def.id === "rush_att"
        ? opportunity
        : def.id === "rush_td"
          ? (opportunity || 0) * (usage.rushTd && rushAtt ? usage.rushTd / rushAtt : 0.05)
          : opportunity != null && efficiency != null
            ? opportunity * efficiency
            : null;
  } else if (def.family === "passing" || def.family === "qb") {
    opportunity = passAtt;
    if (vol.passAttPerGame && attShare != null) opportunity = vol.passAttPerGame * Math.min(attShare, 1.05);
    if (def.id === "pass_yds" || def.id === "pass_rush_yds") efficiency = ypa;
    if (def.id === "pass_comp") efficiency = compPct;
    if (def.id === "pass_att") efficiency = 1;
    rawOppProj =
      def.id === "pass_att"
        ? opportunity
        : def.id === "pass_td"
          ? (opportunity || 0) * (usage.passTd && passAtt ? usage.passTd / passAtt : 0.045)
          : def.id === "pass_int"
            ? (opportunity || 0) * (passAtt ? (usage.pass_int || 0.02) : 0.02)
            : opportunity != null && efficiency != null
              ? opportunity * efficiency
              : null;
  } else if (def.id === "rush_rec_yds") {
    const rushPart =
      rushAtt != null && ypc != null ? (carryShare && vol.rushAttPerGame ? vol.rushAttPerGame * carryShare : rushAtt) * ypc : rushYds;
    const recPart =
      recAvg != null && ypr != null
        ? (recShare && vol.completionsPerGame ? vol.completionsPerGame * recShare : recAvg) * ypr
        : recYds;
    rawOppProj = (rushPart || 0) + (recPart || 0);
    opportunity = (rushAtt || 0) + (recAvg || 0);
    efficiency = opportunity ? rawOppProj / opportunity : null;
  } else if (def.id === "total_td") {
    rawOppProj = (usage.passTd || 0) + (usage.rushTd || 0) + (usage.recTd || 0);
    opportunity = rawOppProj;
    efficiency = 1;
  } else if (def.family === "kicking") {
    const fgMade = usage.fgMade;
    const fgAtt = usage.fgAtt;
    const kickingPts = usage.kickingPts;
    if (def.id === "fg_made") {
      opportunity = Number.isFinite(fgAtt) && fgAtt > 0 ? fgAtt : fgMade;
      efficiency =
        Number.isFinite(fgAtt) && fgAtt > 0 && Number.isFinite(fgMade) ? fgMade / fgAtt : 1;
      rawOppProj =
        Number.isFinite(fgMade)
          ? fgMade
          : opportunity != null && efficiency != null
            ? opportunity * efficiency
            : null;
    } else {
      opportunity = kickingPts;
      efficiency = 1;
      rawOppProj = kickingPts;
    }
  }

  return {
    teamVolume: vol,
    recShare,
    carryShare,
    attShare,
    ypr,
    ypc,
    ypa,
    opportunity,
    efficiency,
    rawOppProj: Number.isFinite(rawOppProj) && rawOppProj > 0 ? rawOppProj : null,
    inferred: inferred.length > 0,
    inferredNotes: inferred,
  };
}

function roleTrend(bundle, def) {
  const season = bundle.usage;
  const l3 = bundle.usageL3;
  if (!season || !l3 || season.games < 2 || l3.games < 2) {
    return { role: "Stable", deltaPct: 0, detail: "Not enough games to read a role shift." };
  }
  let seasonU = null;
  let recentU = null;
  if (def.family === "receiving") {
    seasonU = season.rec;
    recentU = l3.rec;
  } else if (def.family === "rushing") {
    seasonU = season.rushAtt;
    recentU = l3.rushAtt;
  } else if (def.family === "kicking") {
    seasonU = def.id === "fg_made" ? season.fgMade : season.kickingPts;
    recentU = def.id === "fg_made" ? l3.fgMade : l3.kickingPts;
  } else {
    seasonU = season.passAtt;
    recentU = l3.passAtt;
  }
  if (!Number.isFinite(seasonU) || seasonU <= 0 || !Number.isFinite(recentU)) {
    return { role: "Stable", deltaPct: 0, detail: "Usage not available." };
  }
  const deltaPct = (recentU - seasonU) / seasonU;
  let role = "Stable";
  if (deltaPct >= 0.15) role = "Rising";
  else if (deltaPct <= -0.15) role = "Falling";
  const signed = `${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct * 100)}%`;
  return {
    role,
    deltaPct,
    detail:
      role === "Rising"
        ? `↑ Usage ${signed} over last ${l3.games}`
        : role === "Falling"
          ? `↓ Usage ${signed} over last ${l3.games}`
          : `Usage steady (${signed} last ${l3.games})`,
  };
}

module.exports = { teamVolume, estimateOpportunity, roleTrend, playerAverages };
