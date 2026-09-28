/**
 * POST /api/admin/grade-picks
 * Admin-only manual recovery: same grading path as the scheduled cron.
 * Body/query: { weekId?: number, force?: boolean }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { runGradePicks } = require("./_lib/grade-picks");

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

  try {
    const result = await runGradePicks({
      weekId: Number.isFinite(weekId) ? weekId : null,
      force: true,
    });
    console.log("admin-grade-picks:", JSON.stringify(result));
    return json(200, { ok: true, ...result });
  } catch (err) {
    console.error("admin-grade-picks:", err);
    return json(500, {
      ok: false,
      error: err.message || "Internal server error",
      code: err.code || null,
    });
  }
};
