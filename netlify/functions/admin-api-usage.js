/**
 * GET /api/admin/api-usage?days=14
 * CFBD / Odds call volume by product feature (admin chart).
 */
const { json } = require("./_http");
const { requireAdmin } = require("./_auth");
const { loadApiUsageSummary } = require("./_lib/api-usage");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const qs = event.queryStringParameters || {};
  const days = qs.days != null ? Number(qs.days) : 14;

  try {
    const summary = await loadApiUsageSummary({ days });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error("admin-api-usage:", err);
    return json(500, {
      ok: false,
      error: err.message || "Failed to load API usage",
    });
  }
};
