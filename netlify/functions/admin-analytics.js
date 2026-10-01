/**
 * GET /api/admin/analytics
 * Admin-only product analytics dashboard data.
 * Does NOT call CFBD or ESPN — reads product_events / users / api_usage_daily only.
 */
const { json } = require("./_http");
const { requireAdmin } = require("./_auth");
const { loadAdminAnalytics } = require("./_lib/product-analytics");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const qs = event.queryStringParameters || {};

  try {
    const payload = await loadAdminAnalytics(qs);
    return json(200, payload);
  } catch (err) {
    console.error("admin-analytics:", err);
    return json(500, {
      ok: false,
      error: err.message || "Failed to load analytics",
    });
  }
};
