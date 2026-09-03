/**
 * GET /api/team-roster-meta?team=Alabama&year=2026
 * Optional: espnTeamId=333, logoUrl=...
 *
 * Returns ESPN headshots (+ depth ranks when available) for merging onto CFBD roster.
 */
const { json } = require("./_http");
const { getTeamRosterMeta } = require("./_lib/team-roster-meta");

function readCfbdKey() {
  return (process.env.CFBD_API_KEY && String(process.env.CFBD_API_KEY).trim()) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const q = event.queryStringParameters || {};
  const team = String(q.team || q.school || "").trim();
  const year = Number(q.year || q.season);
  const espnTeamId = q.espnTeamId || q.espnId || "";
  const logoUrl = q.logoUrl || q.logo || "";

  if (!team && !espnTeamId && !logoUrl) {
    return json(400, { error: "Provide team, espnTeamId, or logoUrl" });
  }

  try {
    const meta = await getTeamRosterMeta({
      team,
      year: Number.isFinite(year) ? year : undefined,
      espnTeamId,
      logoUrl,
      apiKey: readCfbdKey(),
    });
    return json(
      200,
      {
        team: team || null,
        year: Number.isFinite(year) ? year : null,
        ...meta,
      },
      {
        "cache-control": "public, max-age=300, s-maxage=900",
      }
    );
  } catch (err) {
    console.error("team-roster-meta:", err);
    return json(502, {
      error: "Failed to load roster portraits",
      details: err && err.message ? String(err.message).slice(0, 200) : "unknown",
    });
  }
};
