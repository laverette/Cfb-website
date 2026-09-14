const { ordinal } = require("./math");

function sideLabel(side) {
  return String(side || "more").toLowerCase() === "less" ? "Less" : "More";
}

function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || name || "Player";
}

function legCaption(leg) {
  const name = leg?.player?.name || "Player";
  const stat = leg?.stat?.short || leg?.stat?.label || leg?.stat?.id || leg?.statId || "Prop";
  const line = Number.isFinite(Number(leg?.line)) ? String(leg.line) : "";
  return `${name} — ${stat} ${line} ${sideLabel(leg?.side)}`.replace(/\s+/g, " ").trim();
}

function compactLegCaption(leg) {
  const stat = leg?.stat?.short || leg?.stat?.label || leg?.stat?.id || "Prop";
  const line = Number.isFinite(Number(leg?.line)) ? String(leg.line) : "";
  return `${lastName(leg?.player?.name)} ${stat} ${line} ${sideLabel(leg?.side)} · Score ${leg?.propScore ?? "—"}`;
}

function legIdentity(leg) {
  const player = leg?.playerId || leg?.player?.id || leg?.name || "";
  const stat = leg?.statId || leg?.stat?.id || "";
  const line = Number(leg?.line);
  const side = String(leg?.side || "more").toLowerCase();
  return `${player}|${stat}|${Number.isFinite(line) ? line : ""}|${side}`;
}

function isSameLeg(a, b) {
  return Boolean(a && b && legIdentity(a) === legIdentity(b));
}

function hitCountLabel(hits, n) {
  const total = Number(n) || 0;
  const h = Number(hits) || 0;
  if (!total) return "Hit: —";
  const pct = Math.round((h / total) * 100);
  if (total < 5) return `${h}/${total} (${pct}%) · Small sample`;
  return `${h}/${total} (${pct}%)`;
}

function dropdownPlacement({
  inputTop,
  inputBottom,
  inputLeft,
  inputWidth,
  viewportH,
  viewportW = 1200,
  maxH = 240,
  gap = 4,
}) {
  const spaceBelow = viewportH - inputBottom;
  const spaceAbove = inputTop;
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
  const available = Math.max(96, (openUp ? spaceAbove : spaceBelow) - gap - 8);
  const height = Math.min(maxH, available);
  const left = Math.max(8, Math.min(inputLeft, viewportW - inputWidth - 8));
  if (openUp) {
    return {
      openUp: true,
      top: null,
      bottom: viewportH - inputTop + gap,
      left,
      width: inputWidth,
      maxHeight: height,
    };
  }
  return {
    openUp: false,
    top: inputBottom + gap,
    bottom: null,
    left,
    width: inputWidth,
    maxHeight: height,
  };
}

const FLAG_HELP = {
  "Small Sample": "Fewer than three current-season games in the projection sample.",
  "FCS-Heavy Sample": "A large share of the current sample came against FCS opponents.",
  "High Variance": "Week-to-week results swing more than typical for this stat.",
  "Role Change": "Recent usage does not match the rest of the sample.",
  "New Starter": "Limited established role or freshman/new starter flag.",
  Transfer: "Player changed teams — prior-year stats are a weaker prior.",
  "Missing Data": "Some CFBD fields were unavailable.",
  "Limited History": "Thin or missing prior-year history.",
  "Missing Prior": "No usable prior-season sample for this stat.",
  "Low Usage Stability": "Opportunity share is inferred or moving quickly.",
  "Weak Opponent Sample": "The sample is tilted toward weaker or FCS defenses.",
  "Unusual Line": "This line sits far outside the typical range for the selected stat.",
};

module.exports = {
  ordinal,
  sideLabel,
  lastName,
  legCaption,
  compactLegCaption,
  hitCountLabel,
  dropdownPlacement,
  FLAG_HELP,
  legIdentity,
  isSameLeg,
};
