/**
 * Weekly Picks mobile helpers — layout offsets, compact copy, and dock visibility.
 * Used by weeklypicks.html and unit tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeeklyPicksMobile = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRIMARY_AWARDS = ["top dog", "chalkiest", "upset king"];

  function formatKickoffCompact(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const weekday = d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
    const md = d.toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });
    const tm = d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${weekday} ${md} · ${tm} ET`;
  }

  function formatVenueLine(dateValue, venue) {
    const kick = formatKickoffCompact(dateValue);
    const place = String(venue || "").trim();
    if (kick && place) return `${kick} · ${place}`;
    return kick || place;
  }

  function dockShouldShow({ picksView, submitted, editing, total, submitHidden }) {
    if (!picksView) return false;
    if (!total) return false;
    if (submitHidden && !editing) return false;
    if (submitted && !editing) return false;
    return true;
  }

  function corsoBottomOffset(barHeightPx, safeInsetPx) {
    const bar = Math.max(0, Number(barHeightPx) || 0);
    const safe = Math.max(0, Number(safeInsetPx) || 0);
    return bar + safe + 12;
  }

  function recordWithPending(entry) {
    const w = entry?.correctPicks || 0;
    const l = entry?.incorrectPicks || 0;
    const pending = entry?.pendingPicks || 0;
    if (pending > 0 && w + l === 0) return `${pending} pending`;
    if (pending > 0) return `${w}–${l} · ${pending} pending`;
    return `${w}–${l}`;
  }

  function nameListCompact(names) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return "—";
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} & ${list[1]}`;
    if (list.length === 3) return `${list[0]}, ${list[1]} & ${list[2]}`;
    return `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
  }

  function isPrimaryAward(title) {
    const t = String(title || "").toLowerCase();
    return PRIMARY_AWARDS.some((key) => t.includes(key));
  }

  function captureIgnoresSelector() {
    return ".corso-widget, .picks-mobile-dock, .hub-switch-dock, .hub-subnav, .picks-share-actions, .site-nav, .weeklypicks-navbar";
  }

  return {
    formatKickoffCompact,
    formatVenueLine,
    dockShouldShow,
    corsoBottomOffset,
    recordWithPending,
    nameListCompact,
    isPrimaryAward,
    captureIgnoresSelector,
    PRIMARY_AWARDS,
  };
});
