const { clamp, normalCdf, mulberry32, sampleNormal } = require("./math");

function invNorm(p) {
  const target = clamp(p, 1e-12, 1 - 1e-12);
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid, 0, 1) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function toAmerican(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function formatAmerican(odds) {
  if (!Number.isFinite(odds)) return null;
  const n = Math.round(odds);
  return n > 0 ? `+${n}` : String(n);
}

function formatTogetherPct(p) {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.005) return "<1%";
  if (p < 0.15) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}

function independentProduct(ps) {
  return ps.reduce((a, b) => a * b, 1);
}

function frechetBounds(ps) {
  const n = ps.length;
  return {
    lo: Math.max(0, ps.reduce((s, p) => s + p, 0) - (n - 1)),
    hi: Math.min(...ps),
  };
}

function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = matrix[i][j];
      for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = L[j][j] > 1e-12 ? s / L[j][j] : 0;
      }
    }
  }
  return L;
}

function cholCorr(R) {
  const n = R.length;
  for (const lam of [0, 0.02, 0.05, 0.1, 0.2, 0.4, 1]) {
    const M = R.map((row, i) => row.map((v, j) => (i === j ? 1 : v * (1 - lam))));
    const L = cholesky(M);
    if (L) return L;
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function corrMatrix(keys, pairs) {
  const n = keys.length;
  const idx = new Map(keys.map((k, i) => [k, i]));
  const R = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const p of pairs || []) {
    const i = idx.get(p.a);
    const j = idx.get(p.b);
    if (i == null || j == null || i === j) continue;
    const r = clamp(Number(p.corr) || 0, -0.92, 0.92);
    R[i][j] = r;
    R[j][i] = r;
  }
  return R;
}

function maxAbsOffDiag(R) {
  let m = 0;
  for (let i = 0; i < R.length; i += 1) {
    for (let j = i + 1; j < R.length; j += 1) m = Math.max(m, Math.abs(R[i][j]));
  }
  return m;
}

function gaussianCopulaAllHit(ps, R, { sims = 18000, seed = 20260916 } = {}) {
  const n = ps.length;
  const t = ps.map(invNorm);
  const L = cholCorr(R);
  const rng = mulberry32(seed);
  let hits = 0;
  for (let s = 0; s < sims; s += 1) {
    const g = Array.from({ length: n }, () => sampleNormal(rng, 0, 1));
    let all = true;
    for (let i = 0; i < n; i += 1) {
      let v = 0;
      for (let j = 0; j <= i; j += 1) v += L[i][j] * g[j];
      if (v > t[i]) {
        all = false;
        break;
      }
    }
    if (all) hits += 1;
  }
  return hits / sims;
}

function pairwiseBernoulli(p1, p2, rho) {
  const cov = rho * Math.sqrt(Math.max(0, p1 * (1 - p1) * p2 * (1 - p2)));
  return clamp(p1 * p2 + cov, Math.max(0, p1 + p2 - 1), Math.min(p1, p2));
}

function jointAllHit(legs, pairs, opts = {}) {
  const ok = (legs || []).filter((l) => l && !l.error && Number.isFinite(Number(l.pHit)));
  if (!ok.length) return null;
  const ps = ok.map((l) => clamp(Number(l.pHit), 0.01, 0.99));
  const independent = independentProduct(ps);
  const bounds = frechetBounds(ps);
  const keys = ok.map((l) => l.clientId || `${l.player?.id}:${l.stat?.id}:${l.line}:${l.side}`);
  const R = corrMatrix(keys, pairs);
  const maxAbs = maxAbsOffDiag(R);
  let p = independent;
  let method = ok.length === 1 ? "single" : "independent";
  if (ok.length === 1) {
    p = ps[0];
  } else if (maxAbs >= 0.02 && ok.length === 2) {
    p = pairwiseBernoulli(ps[0], ps[1], R[0][1]);
    method = "pairwise";
  } else if (maxAbs >= 0.02) {
    p = gaussianCopulaAllHit(ps, R, opts);
    method = "gaussian_copula";
  }
  p = clamp(p, bounds.lo, bounds.hi);
  const american = toAmerican(p);
  const pctLabel = formatTogetherPct(p);
  const oddsLabel = formatAmerican(american);
  return {
    p: Number(p.toFixed(4)),
    independent: Number(independent.toFixed(4)),
    american,
    americanLabel: oddsLabel,
    pctLabel,
    label: oddsLabel ? `${pctLabel} (${oddsLabel})` : pctLabel,
    n: ok.length,
    method,
    corrUsed: maxAbs >= 0.02,
    tooltip:
      "Estimated chance every listed leg hits, using each prop's probability and the same correlation model as the entry. Positive correlation raises the all-hit chance; negative correlation lowers it. This is a model estimate, not a sportsbook price.",
  };
}

module.exports = {
  jointAllHit,
  toAmerican,
  formatAmerican,
  formatTogetherPct,
  invNorm,
  independentProduct,
};
