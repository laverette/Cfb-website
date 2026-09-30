/**
 * POST /api/admin/grade-picks
 * Admin-only manual recovery: same grading path as the scheduled cron (ESPN-only).
 * Body/query: { weekId?: number, force?: boolean }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { runGradePicks } = require("./_lib/grade-picks");
const { withExecutionContext } = require("./_lib/execution-context");
const { cfbdUsageSnapshot } = require("./_lib/cfbd-guard");

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return json(204, {});
  if (method !== "POST" && method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const q = event.queryStringParameters || {};
  const body = method === "POST" ? parseJsonBody(event) || {} : {};
  const weekRaw = body.weekId ?? body.week_id ?? q.weekId ?? q.week_id;
  const weekId =
    weekRaw != null && String(weekRaw).trim() !== ""
      ? Number(weekRaw)
      : null;

  // Admin grading uses the same ESPN-only path; mark background so CFBD stays blocked.
  return withExecutionContext(
    "background",
    async () => {
      try {
        const result = await runGradePicks({
          weekId: Number.isFinite(weekId) ? weekId : null,
          force: true,
        });
        const usage = cfbdUsageSnapshot();
        console.log(
          "admin-grade-picks:",
          JSON.stringify({ ...result, cfbdAllowed: usage.allowed, cfbdBlocked: usage.blocked })
        );
        return json(200, {
          ok: true,
          ...result,
          cfbd: { allowed: usage.allowed, blocked: usage.blocked },
        });
      } catch (err) {
        console.error("admin-grade-picks:", err);
        return json(500, {
          ok: false,
          error: err.message || "Internal server error",
          code: err.code || null,
        });
      }
    },
    { caller: "admin-grade-picks" }
  );
};
