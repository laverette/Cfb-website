/**
 * Stable prop / leg identity helpers.
 *
 * A prop must never be identified by stat type alone. Keys include player,
 * stat, line, side, and optional source / session ids so probability results
 * cannot be reused across different players or lines.
 */

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesCompatible(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const pa = na.split(" ");
  const pb = nb.split(" ");
  const la = pa[pa.length - 1];
  const lb = pb[pb.length - 1];
  if (la && lb && la === lb && pa[0]?.[0] && pb[0]?.[0] && pa[0][0] === pb[0][0]) return true;
  return false;
}

/**
 * Content identity for a prop (stable across sessions when playerId is known).
 * Does not use array index. Does not key by stat alone.
 */
function propIdentityKey(input = {}) {
  const playerId = input.playerId ?? input.player?.id ?? null;
  const playerName = input.playerName ?? input.player?.name ?? input.name ?? "";
  const team = input.team ?? input.player?.team ?? "";
  const opponent =
    typeof input.opponent === "string"
      ? input.opponent
      : input.opponent?.name || "";
  const league = input.league || input.sport || "";
  const statId = input.statId ?? input.stat?.id ?? input.stat ?? "";
  const line = Number(input.line);
  const side = String(input.side || "more").toLowerCase() === "less" ? "less" : "more";
  const sourcePropId = input.sourcePropId ?? input.prizePicksId ?? input.propId ?? "";

  const playerPart =
    playerId != null && String(playerId).trim() !== ""
      ? `id:${String(playerId).trim()}`
      : `name:${norm(playerName) || "unknown"}`;

  const linePart = Number.isFinite(line) ? String(line) : "";
  const parts = [
    playerPart,
    norm(team),
    norm(opponent),
    norm(league),
    String(statId || ""),
    linePart,
    side,
    sourcePropId ? `src:${String(sourcePropId)}` : "",
  ];
  return parts.join("|");
}

/**
 * Session / analysis key: prefer clientId, else content identity.
 */
function legSessionKey(leg) {
  if (leg?.clientId) return String(leg.clientId);
  return propIdentityKey({
    playerId: leg?.playerId ?? leg?.player?.id,
    playerName: leg?.playerName ?? leg?.player?.name ?? leg?.name,
    team: leg?.team ?? leg?.player?.team,
    opponent: leg?.opponent,
    league: leg?.league,
    statId: leg?.statId ?? leg?.stat?.id,
    line: leg?.line,
    side: leg?.side,
    sourcePropId: leg?.sourcePropId,
  });
}

/**
 * Canonical legIdentity used for duplicate detection. Prefer player id;
 * never fall back to a bare display name without a prefix.
 */
function legIdentity(leg) {
  return propIdentityKey({
    playerId: leg?.playerId ?? leg?.player?.id,
    playerName: leg?.playerName ?? leg?.player?.name ?? leg?.name,
    team: leg?.team ?? leg?.player?.team,
    opponent: leg?.opponent,
    league: leg?.league,
    statId: leg?.statId ?? leg?.stat?.id,
    line: leg?.line,
    side: leg?.side,
    sourcePropId: leg?.sourcePropId,
  });
}

function isSameLeg(a, b) {
  return Boolean(a && b && legIdentity(a) === legIdentity(b));
}

function stampClientId(evaluation, clientId) {
  if (!evaluation || clientId == null || clientId === "") return evaluation;
  if (evaluation.clientId === clientId) return evaluation;
  return { ...evaluation, clientId };
}

/**
 * Verify evaluation player matches the requested leg. Returns warnings;
 * never silently reassigns identity.
 */
function identityWarnings(leg, evaluation) {
  const warnings = [];
  if (!leg || !evaluation || evaluation.error) return warnings;
  const reqId = leg.playerId != null ? String(leg.playerId) : "";
  const gotId = evaluation.player?.id != null ? String(evaluation.player.id) : "";
  if (reqId && gotId && reqId !== gotId) {
    warnings.push({
      code: "PLAYER_ID_MISMATCH",
      message: `Requested playerId ${reqId} but evaluation returned ${gotId}`,
      requested: { playerId: reqId, name: leg.name || leg.playerName || null },
      evaluated: { playerId: gotId, name: evaluation.player?.name || null },
    });
  }
  const reqName = leg.name || leg.playerName || "";
  const gotName = evaluation.player?.name || "";
  if (reqName && gotName && !namesCompatible(reqName, gotName)) {
    warnings.push({
      code: "PLAYER_NAME_MISMATCH",
      message: `Requested player "${reqName}" but evaluation returned "${gotName}"`,
      requested: { playerId: reqId || null, name: reqName },
      evaluated: { playerId: gotId || null, name: gotName },
    });
  }
  const reqStat = leg.statId || leg.stat;
  const gotStat = evaluation.stat?.id;
  if (reqStat && gotStat && String(reqStat) !== String(gotStat)) {
    warnings.push({
      code: "STAT_MISMATCH",
      message: `Requested stat ${reqStat} but evaluation returned ${gotStat}`,
    });
  }
  if (
    Number.isFinite(Number(leg.line)) &&
    Number.isFinite(Number(evaluation.line)) &&
    Number(leg.line) !== Number(evaluation.line)
  ) {
    warnings.push({
      code: "LINE_MISMATCH",
      message: `Requested line ${leg.line} but evaluation returned ${evaluation.line}`,
    });
  }
  return warnings;
}

/**
 * Detect impossible model states: same player+stat+side with materially
 * different lines but effectively identical hit probabilities.
 */
function identicalProbabilityWarnings(legs, { eps = 1e-4, minLineGap = 5 } = {}) {
  const warnings = [];
  const ok = (legs || []).filter((l) => l && !l.error && Number.isFinite(Number(l.pHit)));
  for (let i = 0; i < ok.length; i += 1) {
    for (let j = i + 1; j < ok.length; j += 1) {
      const a = ok[i];
      const b = ok[j];
      const idA = String(a.player?.id || a.playerId || "");
      const idB = String(b.player?.id || b.playerId || "");
      const samePlayer =
        (idA && idB && idA === idB) ||
        (!idA && !idB && namesCompatible(a.player?.name || a.name, b.player?.name || b.name));
      const sameStat = String(a.stat?.id || a.statId) === String(b.stat?.id || b.statId);
      const sameSide =
        String(a.side || "more").toLowerCase() === String(b.side || "more").toLowerCase();
      if (!samePlayer || !sameStat || !sameSide) continue;
      const lineGap = Math.abs(Number(a.line) - Number(b.line));
      if (!(lineGap >= minLineGap)) continue;
      if (Math.abs(Number(a.pHit) - Number(b.pHit)) <= eps) {
        warnings.push({
          code: "IDENTICAL_LINE_PROBABILITY",
          message:
            `Same player/stat model returned effectively identical pHit (${a.pHit}) for lines ${a.line} and ${b.line}. ` +
            `Probabilities must be computed per player+stat+line+side.`,
          playerId: idA || idB || null,
          playerName: a.player?.name || b.player?.name || null,
          statId: a.stat?.id || a.statId,
          lines: [Number(a.line), Number(b.line)],
          pHit: Number(a.pHit),
        });
      }
    }
  }
  return warnings;
}

/**
 * Probability cache key — must include every input that materially affects pHit.
 */
function probabilityCacheKey({
  playerId,
  playerName,
  team,
  opponent,
  league,
  statId,
  line,
  side,
  matchupKey,
  projection,
  sd,
  dist,
  modelVersion,
}) {
  return [
    "pHit",
    propIdentityKey({ playerId, playerName, team, opponent, league, statId, line, side }),
    matchupKey || "",
    Number.isFinite(Number(projection)) ? Number(projection).toFixed(4) : "",
    Number.isFinite(Number(sd)) ? Number(sd).toFixed(4) : "",
    dist || "",
    modelVersion || "",
  ].join("::");
}

module.exports = {
  norm,
  namesCompatible,
  propIdentityKey,
  legSessionKey,
  legIdentity,
  isSameLeg,
  stampClientId,
  identityWarnings,
  identicalProbabilityWarnings,
  probabilityCacheKey,
};
