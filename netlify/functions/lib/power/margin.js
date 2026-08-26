/**
 * Soft margin transforms — isolated for backtesting alternate forms.
 */

function sign(x) {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

/** signed_log_margin = sign(m) * log(1 + |m|) */
function softMargin(margin, _params = {}) {
  const m = Number(margin) || 0;
  return sign(m) * Math.log(1 + Math.abs(m));
}

/** Inverse-ish scaling so soft margins map back toward point-ish units for blending. */
function softMarginToPoints(soft, scale = 6.5) {
  return soft * scale;
}

module.exports = {
  softMargin,
  softMarginToPoints,
  sign,
};
