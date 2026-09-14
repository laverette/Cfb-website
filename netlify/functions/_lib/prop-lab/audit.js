/**
 * Static audit of Model 2.0.0 overlap. Not a runtime metric —
 * each item is a code-path finding from evaluate.js / matchup.js / opportunity.js.
 */
const DOUBLE_COUNT_AUDIT = [
  {
    id: "opportunity_vs_baseline",
    severity: "high",
    overlap: ["current-season average", "opportunity × efficiency"],
    finding:
      "Baseline already embeds this season's usage (yards/receptions from the same game logs). Opportunity then re-estimates rec/carry/attempt share from those logs and blends 0–35% of that projection back in. Early-season weight is reduced, but weeks 5+ still double-count the same usage.",
    v21:
      "Make opportunity the primary structure and treat raw yards as a residual, or blend opportunity only when share is estimated from a different source than the stat being projected.",
  },
  {
    id: "recency_vs_role",
    severity: "high",
    overlap: ["exponential recency weights", "role Rising/Falling usageDelta"],
    finding:
      "Last-3 games are already upweighted in the current-season mean. Role trend then adds ±10–12% of baseline when last-3 usage diverges from season usage — the same recent games, twice.",
    v21:
      "Keep one recency channel. Prefer a usage-share state (carries/targets) with a small EWMA, and do not also multiply the yardage mean by a role bump.",
  },
  {
    id: "stacked_pass_defense",
    severity: "medium",
    overlap: ["pass yards allowed", "pass PPA", "explosive passes allowed"],
    finding:
      "Receiving and passing matchups sum correlated defensive z-scores (yards + PPA + explosiveness). Caps (±14% total, 55% WR haircut) prevent 2.0's old +21% blow-up, but the factors are not orthogonal — a single leaky secondary still stacks.",
    v21:
      "Collapse to one pass-defense factor (PPA or success rate) plus one explosive residual, or PCA/partial-out correlated metrics before summing.",
  },
  {
    id: "script_vs_volume",
    severity: "medium",
    overlap: ["team pass/rush volume opportunity", "spread-based game script"],
    finding:
      "Opportunity uses season team pass/rush attempts. Game environment then scales the whole projection for large favorites/dogs. Season volume already includes how often the team led; script applies again using this week's spread.",
    v21:
      "Condition opportunity on expected plays given THIS spread/total, not on season-average volume plus a second script multiplier.",
  },
  {
    id: "power_fallback_plus_yards",
    severity: "low",
    overlap: ["team season yards allowed", "power ranking gap fallback"],
    finding:
      "When advanced pools are empty, matchup falls back to offense vs defense ratings. If yards-allowed is also present, both can fire. Walk-forward fixtures usually have yards-allowed, so the fallback is rare — still a live-CFBD risk when advanced endpoints 404.",
    v21:
      "Use a strict hierarchy: advanced PPA if present, else yards allowed vs FBS, else power gap — never sum two of these.",
  },
];

module.exports = { DOUBLE_COUNT_AUDIT };
