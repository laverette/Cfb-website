/**
 * Send Saturday-morning pick reminder emails to opted-in users who haven't submitted.
 *
 * Scheduled for ~9 AM America/Chicago on Saturdays. Test a single inbox:
 *   GET /api/cron/pick-reminders?secret=CRON_SECRET&to=you@example.com&force=1
 */
const {
  loadCurrentWeek,
  loadGamesByWeek,
  getEffectiveWeekLockTime,
  listUsersForPickReminders,
  recordPickReminderSent,
  findUserByUsernameOrEmail,
  getUserWeekSubmission,
} = require("../db");
const {
  sendEmail,
  isEmailConfigured,
  siteBaseUrl,
  buildPickReminderEmail,
} = require("./email");

const CENTRAL_TZ = "America/Chicago";

/**
 * True during the 9 AM Central hour on Saturday.
 * Netlify cron fires at 14:00 and 15:00 UTC on Saturdays so both CDT and CST
 * land on local hour 9; this gate ensures only the matching hour sends.
 */
function isSaturdayNineAmCentral(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  let hour = Number(parts.find((p) => p.type === "hour")?.value);
  // Some engines report midnight as 24 under h23.
  if (hour === 24) hour = 0;
  return weekday === "Sat" && hour === 9;
}

function weekLabel(week) {
  if (!week) return "This week";
  const n = week.week_number ?? week.weekNumber;
  const y = week.season_year ?? week.seasonYear;
  if (n && y) return `Week ${n} · ${y}`;
  if (n) return `Week ${n}`;
  return "This week";
}

function normalizeTestEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

async function runPickReminders({
  dryRun = false,
  toEmail = null,
  force = false,
  now = new Date(),
} = {}) {
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

  const locksAt = getEffectiveWeekLockTime(games, now);
  const testTo = normalizeTestEmail(toEmail);
  // force=1 bypasses the Saturday window / lock checks. It does NOT bypass
  // "already submitted" on the normal recipient list — only an explicit test
  // recipient (?to=) can get mail after submitting, for inbox testing.
  const forceSend = Boolean(force) || Boolean(testTo);

  if (!forceSend && !isSaturdayNineAmCentral(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "outside_saturday_9am_ct",
      locksAt,
      sent: 0,
      centralNow: now.toLocaleString("en-US", { timeZone: CENTRAL_TZ }),
    };
  }

  if (!forceSend && locksAt && new Date(locksAt).getTime() <= now.getTime()) {
    return {
      ok: true,
      skipped: true,
      reason: "already_locked",
      locksAt,
      sent: 0,
    };
  }

  let candidates = [];
  if (testTo) {
    const user = await findUserByUsernameOrEmail(testTo);
    if (!user || !user.email) {
      return {
        ok: false,
        skipped: true,
        reason: "test_recipient_not_found",
        to: testTo,
        sent: 0,
      };
    }
    candidates = [
      {
        id: user.id,
        email: user.email,
        username: user.username,
        display_name: user.display_name,
      },
    ];
  } else {
    // Already excludes anyone with user_picks for this week.
    candidates = await listUsersForPickReminders(week.id);
  }

  if (!candidates.length) {
    return { ok: true, skipped: true, reason: "no_recipients", locksAt, sent: 0 };
  }

  const base = siteBaseUrl() || "https://example.com";
  const label = weekLabel(week);
  const picksUrl = `${base}/weeklypicks.html`;
  const settingsUrl = `${base}/user-profile.html`;

  let sent = 0;
  let skippedSubmitted = 0;
  const errors = [];

  for (const user of candidates) {
    // Final guard: never email someone who submitted between the list query
    // and this send (or who slipped through on an id-type mismatch).
    if (!testTo) {
      try {
        const status = await getUserWeekSubmission(user.id, week.id, {
          lock: { picksLocked: false, locksAt },
        });
        if (status.hasSubmitted) {
          skippedSubmitted += 1;
          continue;
        }
      } catch (err) {
        console.error("pick-reminder submission check failed", user.id, err.message || err);
        errors.push({ userId: user.id, message: err.message || String(err) });
        continue;
      }
    }

    const displayName = user.display_name || user.username || "Player";
    const mail = buildPickReminderEmail({
      displayName,
      weekLabel: label,
      locksAt: locksAt || null,
      picksUrl,
      settingsUrl,
      isTest: Boolean(testTo),
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
      // Don't mark test sends in pick_reminder_log — keeps the real cron eligible.
      if (!testTo) {
        await recordPickReminderSent(user.id, week.id);
      }
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
    test: Boolean(testTo),
    to: testTo || undefined,
    force: forceSend,
    candidates: candidates.length,
    skippedSubmitted,
    sent,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = {
  runPickReminders,
  isSaturdayNineAmCentral,
  CENTRAL_TZ,
};
