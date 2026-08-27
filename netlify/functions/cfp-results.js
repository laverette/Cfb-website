/**
 * POST /api/cfp/results — admin: set official playoff results & regrade
 * Body: { season, results: { frL1: { winnerName, seed }, ... }, locked? }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin } = require("./_auth");
const { saveOfficialResults } = require("./_lib/cfp-brackets");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { message: "Invalid JSON body" });
  }

  try {
    const result = await saveOfficialResults({
      season: body.season ?? body.seasonYear,
      results: body.results || {},
      locked: body.locked,
    });
    return json(200, {
      message: "Official results saved; brackets regraded",
      ...result,
    });
  } catch (err) {
    console.error("cfp-results:", err);
    return json(500, { message: "Failed to save official results" });
  }
};
