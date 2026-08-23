const { loadGamesByWeek } = require("./db");
const { parseWeekId, invalidWeekIdPayload } = require("./_parseWeekId");

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const weekId = parseWeekId(event);
  if (weekId == null || !Number.isFinite(weekId) || weekId < 1) {
    return json(400, invalidWeekIdPayload(event));
  }

  try {
    const games = await loadGamesByWeek(weekId);
    return json(200, { games });
  } catch (err) {
    console.error("picks-games-by-week:", err);
    if (err.code === "NO_DATABASE_URL") {
      return json(500, { error: "Server misconfiguration" });
    }
    return json(500, { error: "Internal server error" });
  }
};
