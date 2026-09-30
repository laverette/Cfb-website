/**
 * Scheduled: Saturday ~9 AM Central pick-deadline reminder emails.
 * Also callable manually with ?secret=CRON_SECRET for testing.
 *
 * Runs in background context (no CFBD — reminders don't need it).
 */
const { json } = require("./_http");
const { runPickReminders } = require("./_lib/pick-reminders");
const { withExecutionContext } = require("./_lib/execution-context");

function isAuthorized(event) {
  const cronSecret = (process.env.CRON_SECRET && String(process.env.CRON_SECRET).trim()) || "";
  const qs = event.queryStringParameters || {};
  if (cronSecret && qs.secret === cronSecret) return true;

  const source =
    event.headers?.["x-netlify-event"] ||
    event.headers?.["X-Netlify-Event"] ||
    "";
  if (String(source).toLowerCase() === "schedule") return true;
  if (event.isScheduled || event.source === "netlify-scheduled-function") return true;

  return false;
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return json(401, { error: "Unauthorized" });
  }

  const qs = event.queryStringParameters || {};
  const dryRun = qs.dryRun === "1" || qs.dryRun === "true";
  const force = qs.force === "1" || qs.force === "true";
  const toEmail = qs.to || qs.email || null;

  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runPickReminders({ dryRun, force, toEmail });
        console.log("pick-reminders:", JSON.stringify(result));
        return json(200, result);
      } catch (err) {
        console.error("pick-reminders:", err);
        return json(500, {
          ok: false,
          error: err.message || "Internal server error",
          code: err.code || null,
        });
      }
    },
    { caller: "pick-reminders-cron" }
  );
};

exports.config = {
  // Saturdays 14:00 + 15:00 UTC ≈ 9 AM Central across DST.
  schedule: "0 14,15 * * 6",
};
