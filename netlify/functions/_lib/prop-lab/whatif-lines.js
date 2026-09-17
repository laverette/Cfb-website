const { getPropDef } = require("./definitions");

const TD_MENU = {
  rec_td: [0.5, 1.5, 2.5],
  rush_td: [0.5, 1.5, 2.5],
  pass_td: [0.5, 1.5, 2.5, 3.5, 4.5],
  pass_int: [0.5, 1.5, 2.5],
  total_td: [0.5, 1.5, 2.5, 3.5],
};

const COUNT_DELTAS = {
  rec: [1, 2],
  pass_comp: [2, 4],
  pass_att: [3, 6],
  rush_att: [2, 4],
  fg_made: [1],
  kicking_pts: [2, 4],
};

const YARD_DELTAS = {
  rec_yds: [10, 20],
  rush_yds: [10, 20],
  // Long-rush lines sit near 15, so the standard 10/20 steps would straddle zero.
  rush_long: [5, 10],
  pass_yds: [15, 30],
  rush_rec_yds: [10, 20],
  pass_rush_yds: [15, 30],
};

function asLine(n) {
  const x = Math.max(0, Number(n));
  if (!Number.isFinite(x)) return null;
  const stepped = Math.round(x * 2) / 2;
  return stepped < 0.5 && stepped > 0 ? 0.5 : stepped;
}

function uniqueLines(xs) {
  const out = [];
  const seen = new Set();
  for (const raw of xs) {
    const n = asLine(raw);
    if (n == null || n < 0) continue;
    const key = n.toFixed(1);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function suggestWhatIfLines(statId, currentLine) {
  const def = getPropDef(statId);
  const line = Number(currentLine);
  const base = Number.isFinite(line) ? line : 0.5;
  if (TD_MENU[statId]) {
    return uniqueLines([...TD_MENU[statId], base]).filter((n) => n <= (def?.ceil ?? 8) && n < 8);
  }
  if (COUNT_DELTAS[statId]) {
    const xs = [base];
    for (const d of COUNT_DELTAS[statId]) {
      xs.push(base - d, base + d);
    }
    return uniqueLines(xs).filter((n) => n <= (def?.ceil ?? 80));
  }
  const deltas = YARD_DELTAS[statId] || [10, 20];
  const xs = [base];
  for (const d of deltas) xs.push(base - d, base + d);
  return uniqueLines(xs).filter((n) => n <= (def?.ceil ?? 650) && n < 400);
}

function isPlausibleWhatIf(statId, line) {
  if (!Number.isFinite(Number(line))) return false;
  const n = Number(line);
  if (n < 0) return false;
  if (TD_MENU[statId] && n >= 8) return false;
  if ((statId === "rec_td" || statId === "rush_td") && n >= 4) return false;
  return true;
}

module.exports = { suggestWhatIfLines, isPlausibleWhatIf, TD_MENU, asLine };
