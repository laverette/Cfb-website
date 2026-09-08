/**
 * GET /api/awards/week?weekId=3
 */
const { json } = require("./_http");
const { getWeekAwards } = require("./_lib/week-awards");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const weekId =
    q.weekId != null && String(q.weekId).trim() !== ""
      ? Number(q.weekId)
      : null;

  try {
    const result = await getWeekAwards(
      Number.isFinite(weekId) && weekId > 0 ? weekId : null
    );
    return json(200, result, {
      "cache-control": "public, max-age=30, s-maxage=30",
    });
  } catch (err) {
    console.error("awards-week:", err);
    return json(500, {
      error: "Failed to load awards",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
