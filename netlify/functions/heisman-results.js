/**
 * POST /api/heisman/results — admin sets official Heisman winner
 * Body: { winnerPlayerKey, winnerName?, season? }
 */
const { json, parseJsonBody } = require("./_http");
const { requireAdmin, requireAuth } = require("./_auth");
const { setWinner } = require("./_lib/heisman");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const adminErr = requireAdmin(event);
  if (adminErr) return adminErr;

  const auth = requireAuth(event);
  if (auth.statusCode) return auth;
  const setBy = parseInt(String(auth.payload.userId), 10);

  const body = parseJsonBody(event) || {};
  try {
    const out = await setWinner({
      season: body.season ?? body.seasonYear,
      winnerPlayerKey: body.winnerPlayerKey ?? body.playerKey ?? body.id,
      winnerName: body.winnerName ?? body.playerName,
      setBy: Number.isFinite(setBy) ? setBy : null,
    });
    return json(200, { message: "Heisman winner set", ...out });
  } catch (err) {
    console.error("heisman-results:", err);
    if (err.code === "BAD_REQUEST") {
      return json(400, { error: err.message, code: err.code });
    }
    return json(500, { error: "Failed to set Heisman winner" });
  }
};
