/**
 * Scheduled: grade weekly picks when games finalize.
 * Also callable manually with ?secret=CRON_SECRET for testing.
 *
 * ALWAYS runs in background execution context → CFBD is structurally blocked.
 */
const { json } = require("./_http");
const { runGradePicks } = require("./_lib/grade-picks");
const { withExecutionContext } = require("./_lib/execution-context");
const { cfbdUsageSnapshot } = require("./_lib/cfbd-guard");

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
  const weekId =
    qs.weekId != null && String(qs.weekId).trim() !== ""
      ? Number(qs.weekId)
      : null;

  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runGradePicks({
          weekId: Number.isFinite(weekId) ? weekId : null,
          force: qs.force === "1" || qs.force === "true",
        });
        const usage = cfbdUsageSnapshot();
        console.log(
          "grade-picks:",
          JSON.stringify({ ...result, cfbdAllowed: usage.allowed, cfbdBlocked: usage.blocked })
        );
        return json(200, {
          ...result,
          cfbd: { allowed: usage.allowed, blocked: usage.blocked },
        });
      } catch (err) {
        console.error("grade-picks:", err);
        return json(500, {
          ok: false,
          error: err.message || "Internal server error",
          code: err.code || null,
        });
      }
    },
    { caller: "grade-picks-cron" }
  );
};

exports.config = {
  // Hourly is enough for finals grading. Previous */15 burned CFBD quota.
  schedule: "0 * * * *",
};
