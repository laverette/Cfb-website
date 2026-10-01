/**
 * POST /api/analytics/track
 * Body: { event, properties?, anonymousSessionId? }
 * Auth optional. Fire-and-forget from clients — never blocks product UX.
 * Does NOT call CFBD or ESPN.
 */
const { json, parseJsonBody } = require("./_http");
const { optionalAuth } = require("./_auth");
const {
  insertProductEvent,
  sanitizeEventName,
  sanitizeAnonId,
} = require("./_lib/product-analytics");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const body = parseJsonBody(event);
  if (!body || typeof body !== "object") {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const eventName = sanitizeEventName(body.event || body.eventName || body.name);
  if (!eventName) {
    return json(400, { ok: false, error: "Unknown or missing event" });
  }

  const auth = optionalAuth(event);
  const userId = auth && auth.payload ? auth.payload.userId : null;
  const anonymousSessionId = sanitizeAnonId(
    body.anonymousSessionId || body.sessionId || body.anonymous_session_id
  );

  if (!userId && !anonymousSessionId) {
    return json(400, {
      ok: false,
      error: "anonymousSessionId required when not authenticated",
    });
  }

  const properties =
    body.properties && typeof body.properties === "object" ? body.properties : {};

  // Always succeed from the client's perspective if the event is valid —
  // insert failures are logged server-side and must not break product flows.
  try {
    await insertProductEvent({
      eventName,
      userId,
      anonymousSessionId,
      properties,
    });
  } catch (err) {
    console.warn("analytics-track:", err?.message || err);
  }

  return json(202, { ok: true });
};
