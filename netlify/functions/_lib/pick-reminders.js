/**
 * Send pick-deadline reminder emails to opted-in users who haven't submitted.
 */
const {
  loadCurrentWeek,
  loadGamesByWeek,
  getEffectiveWeekLockTime,
  listUsersForPickReminders,
  recordPickReminderSent,
} = require("../db");
const {
  sendEmail,
  isEmailConfigured,
  siteBaseUrl,
  buildPickReminderEmail,
} = require("./email");

/** Send when first kickoff is this many ms away (default: 2 hours). */
const REMINDER_WINDOW_MS = Number(process.env.PICK_REMINDER_HOURS_BEFORE || 2) * 60 * 60 * 1000;

function weekLabel(week) {
  if (!week) return "This week";
  const n = week.week_number ?? week.weekNumber;
  const y = week.season_year ?? week.seasonYear;
  if (n && y) return `Week ${n} · ${y}`;
  if (n) return `Week ${n}`;
  return "This week";
}

function withinReminderWindow(locksAt, now = new Date()) {
  if (!locksAt) return false;
  const lockMs = new Date(locksAt).getTime();
  if (!Number.isFinite(lockMs)) return false;
  const msUntil = lockMs - now.getTime();
  return msUntil > 0 && msUntil <= REMINDER_WINDOW_MS;
}

async function runPickReminders({ dryRun = false } = {}) {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "email_not_configured",
      sent: 0,
    };
  }

  const week = await loadCurrentWeek();
  if (!week || !week.id) {
    return { ok: true, skipped: true, reason: "no_active_week", sent: 0 };
  }

  const games = await loadGamesByWeek(week.id);
  if (!games.length) {
    return { ok: true, skipped: true, reason: "no_games", sent: 0 };
  }

  const locksAt = getEffectiveWeekLockTime(games);
  if (!withinReminderWindow(locksAt)) {
    return {
      ok: true,
      skipped: true,
      reason: "outside_reminder_window",
      locksAt,
      sent: 0,
    };
  }

  const candidates = await listUsersForPickReminders(week.id);
  if (!candidates.length) {
    return { ok: true, skipped: true, reason: "no_recipients", locksAt, sent: 0 };
  }

  const base = siteBaseUrl() || "https://example.com";
  const label = weekLabel(week);
  const picksUrl = `${base}/weeklypicks.html`;
  const settingsUrl = `${base}/user-profile.html`;

  let sent = 0;
  const errors = [];

  for (const user of candidates) {
    const displayName = user.display_name || user.username || "Player";
    const mail = buildPickReminderEmail({
      displayName,
      weekLabel: label,
      locksAt,
      picksUrl,
      settingsUrl,
    });

    if (dryRun) {
      sent += 1;
      continue;
    }

    try {
      await sendEmail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      await recordPickReminderSent(user.id, week.id);
      sent += 1;
    } catch (err) {
      console.error("pick-reminder send failed", user.id, err.message || err);
      errors.push({ userId: user.id, message: err.message || String(err) });
    }
  }

  return {
    ok: errors.length === 0,
    weekId: week.id,
    weekLabel: label,
    locksAt,
    candidates: candidates.length,
    sent,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = {
  runPickReminders,
  withinReminderWindow,
  REMINDER_WINDOW_MS,
};
